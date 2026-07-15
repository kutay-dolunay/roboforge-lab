/* =============================================================================
 * RoboForge - Konvoy Takibi (Adaptive Cruise Control) :: Simulation Core
 * -----------------------------------------------------------------------------
 * Pure, dependency-free. Browser (window.ConvoyCore) + Node (module.exports).
 *
 * A leader truck drives a speed PROFILE along the road; the robot follows.
 * Keep the gap: too close = crash, too far = convoy lost. Steering is on
 * rails - this scenario is 100% about SPEED CONTROL (the real ACC lesson).
 *
 * Sensors: front distance bands  ÇOK-YAKIN / YAKIN / İDEAL / UZAK
 * Rule pattern = [cok,yakin,ideal,uzak] with 'on'/'off'/'any' (bands are
 * mutually exclusive - one is always on).
 * PID mode: e = mesafe - hedef ; motor = Kp·e + Kd·de/dt  (cruise controller)
 * ========================================================================== */
(function (global) {
  'use strict';

  const CRASH_GAP = 0.7;
  const LOSE_GAP = 9.5;
  const START_GAP = 3.0;
  const BAND_COK = 1.4, BAND_YAKIN = 2.4, BAND_IDEAL = 4.2; // band edges
  const IDEAL_LO = 2.0, IDEAL_HI = 4.2;                     // accuracy window

  // ---- leader speed profiles (7-level ladder) ----------------------------------
  // profile: [[untilT, speed], ...]  (speed u/s; leader max 3.0 < default robot 3.42)
  const ROUTES = [
    { id: 'sabit', name: 'Sabit Hız', difficulty: 'Başlangıç', dur: 30,
      profile: [[30, 2.2]] },
    { id: 'ritim', name: 'Hızlan-Yavaşla', difficulty: 'Başlangıç', dur: 40,
      profile: [[8, 1.8], [16, 2.8], [24, 1.5], [32, 2.6], [40, 2.0]] },
    { id: 'durkalk', name: 'Dur-Kalk', difficulty: 'Orta', dur: 45,
      profile: [[8, 2.4], [13, 0], [21, 2.4], [26, 0], [34, 2.6], [39, 0], [45, 2.2]] },
    { id: 'sehir', name: 'Şehir Trafiği', difficulty: 'Orta', dur: 55,
      profile: [[5, 2.0], [9, 0.6], [14, 2.6], [17, 0], [23, 2.2], [27, 0.8], [33, 2.8], [37, 0], [44, 2.4], [48, 1.0], [55, 2.6]] },
    { id: 'anifren', name: 'Ani Frenler', difficulty: 'İleri', dur: 55,
      profile: [[7, 2.9], [8.2, 0], [15, 2.9], [16.2, 0], [24, 3.0], [25.2, 0], [33, 2.8], [34.2, 0], [43, 3.0], [44.5, 0], [55, 2.6]] },
    { id: 'dalgali', name: 'Dalgalı Akış', difficulty: 'İleri', dur: 60,
      profile: 'sine' },
    { id: 'kabus', name: 'Kâbus Trafik', difficulty: 'Uzman', dur: 70,
      profile: [[4, 3.0], [5, 0], [9, 2.9], [10, 0.4], [14, 3.0], [15.2, 0], [20, 2.7], [21, 0], [26, 3.0], [27.5, 0.3], [32, 2.9], [33, 0], [39, 3.0], [40.5, 0], [46, 2.8], [47, 0.5], [53, 3.0], [54, 0], [60, 2.9], [61.5, 0], [70, 2.5]] },
  ];

  function leaderSpeed(route, t) {
    if (route.profile === 'sine') {
      // smooth waves + two full stops
      if ((t > 22 && t < 26) || (t > 44 && t < 48)) return 0;
      return 1.6 + 1.3 * Math.sin(t * 0.55) * Math.sin(t * 0.23 + 1);
    }
    for (const [until, sp] of route.profile) if (t <= until) return sp;
    return route.profile[route.profile.length - 1][1];
  }

  // ---- the road (visual path; motion is 1-D progress along it) ------------------
  const ROAD_PTS = [[-11, -4.5], [-6, -5], [-1, -3.5], [2, 0], [0, 3.2], [-4, 4.6], [-7, 2.2], [-5.2, -1], [0.5, -1.6], [5, -0.4], [8, 2.4], [11, 4.5]];
  function cardinal(p0, p1, p2, p3, t, s) {
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    return [
      h00 * p1[0] + h10 * s * (p2[0] - p0[0]) + h01 * p2[0] + h11 * s * (p3[0] - p1[0]),
      h00 * p1[1] + h10 * s * (p2[1] - p0[1]) + h01 * p2[1] + h11 * s * (p3[1] - p1[1]),
    ];
  }
  function buildRoad() {
    const P = ROAD_PTS, n = P.length, samples = [];
    for (let i = 0; i < n - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n - 1, i + 2)];
      for (let j = 0; j < 30; j++) samples.push(cardinal(p0, p1, p2, p3, j / 30, 0.4));
    }
    samples.push(P[n - 1].slice());
    let len = 0; const cum = [0];
    for (let i = 1; i < samples.length; i++) {
      len += Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]);
      cum.push(len);
    }
    return { samples, cum, length: len };
  }
  const ROAD = buildRoad();
  function roadPoint(dist) {
    // wraps around (the convoy loops the course)
    const L = ROAD.length;
    let d = ((dist % L) + L) % L;
    const cum = ROAD.cum, S = ROAD.samples;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    const t = (d - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]);
    const p = [S[lo][0] + (S[hi][0] - S[lo][0]) * t, S[lo][1] + (S[hi][1] - S[lo][1]) * t];
    const th = Math.atan2(S[hi][1] - S[lo][1], S[hi][0] - S[lo][0]);
    return { p, th };
  }

  // ---- rules ---------------------------------------------------------------------
  function bands(gap) {
    return {
      cok: gap < BAND_COK,
      yakin: gap >= BAND_COK && gap < BAND_YAKIN,
      ideal: gap >= BAND_YAKIN && gap < BAND_IDEAL,
      uzak: gap >= BAND_IDEAL,
    };
  }
  function motorFraction(m) {
    if (!m || m.dir === 'stop') return 0;
    const f = (m.speed || 0) / 100;
    return m.dir === 'rev' ? -f : f;
  }
  function ruleMatches(rule, b) {
    const arr = [b.cok, b.yakin, b.ideal, b.uzak];
    for (let i = 0; i < 4; i++) {
      const c = rule.pattern[i] || 'any';
      if (c === 'any') continue;
      if (c === 'on' && !arr[i]) return false;
      if (c === 'off' && arr[i]) return false;
    }
    return true;
  }
  function evalRules(rules, defaultRule, b) {
    for (let i = 0; i < rules.length; i++) {
      if (ruleMatches(rules[i], b)) {
        return { mL: motorFraction(rules[i].left), mR: motorFraction(rules[i].right), ruleIndex: i };
      }
    }
    return { mL: motorFraction(defaultRule.left), mR: motorFraction(defaultRule.right), ruleIndex: -1 };
  }

  // ---- sim ------------------------------------------------------------------------
  function createSim(cfg) {
    return {
      cfg, route: cfg.route, t: 0, status: 'running', reason: null,
      sLead: START_GAP, sMe: 0, vLead: 0, vMe: 0,
      pidPrev: 0, eF: 0,
      inIdealTicks: 0, totalTicks: 0, sumAbsErr: 0, minGap: 99, maxGap: 0,
      gapLog: [], last: null,
    };
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return sim.last;
    const params = sim.cfg.params;
    const mode = sim.cfg.mode || 'rules';

    sim.vLead = leaderSpeed(sim.route, sim.t);
    sim.sLead += sim.vLead * dt;

    const gap = sim.sLead - sim.sMe;
    const b = bands(gap);

    let cmd;
    if (mode === 'pid') {
      const pid = sim.cfg.pid || defaultPID();
      const e = gap - (pid.hedef || 2.5);
      sim.eF = sim.eF * 0.75 + e * 0.25;
      let dErr = (sim.eF - sim.pidPrev) / dt;
      if (dErr > 4) dErr = 4; else if (dErr < -4) dErr = -4;
      sim.pidPrev = sim.eF;
      let m = (pid.kp || 0) * e + (pid.kd || 0) * dErr;
      m = Math.max(-0.35, Math.min(1, m));
      cmd = { mL: m, mR: m, ruleIndex: null };
    } else {
      cmd = evalRules(sim.cfg.rules, sim.cfg.defaultRule, b);
    }

    const mAvg = (cmd.mL + cmd.mR) / 2;
    sim.vMe = mAvg * params.vMax;
    sim.sMe += sim.vMe * dt;

    sim.t += dt; sim.totalTicks++;
    const newGap = sim.sLead - sim.sMe;
    const err = Math.abs(newGap - 2.8);
    sim.sumAbsErr += err;
    if (newGap >= IDEAL_LO && newGap <= IDEAL_HI) sim.inIdealTicks++;
    if (newGap < sim.minGap) sim.minGap = newGap;
    if (newGap > sim.maxGap) sim.maxGap = newGap;
    if (sim.totalTicks % 6 === 0) {
      sim.gapLog.push([sim.t, newGap]);
      if (sim.gapLog.length > 1200) sim.gapLog.shift();
    }

    if (newGap < CRASH_GAP) { sim.status = 'failed'; sim.reason = 'crash'; }
    else if (newGap > LOSE_GAP) { sim.status = 'failed'; sim.reason = 'lost'; }
    else if (sim.t >= (sim.route.dur || 45)) { sim.status = 'success'; sim.reason = 'arrived'; }

    sim.last = { gap: newGap, bands: b, cmd, vLead: sim.vLead, vMe: sim.vMe };
    return sim.last;
  }

  function accuracy(sim) { return sim.totalTicks ? Math.round((sim.inIdealTicks / sim.totalTicks) * 100) : 0; }

  function coach(sim) {
    const tips = [];
    if (sim.reason === 'crash') {
      tips.push((sim.cfg.mode === 'pid')
        ? 'Öndekine çarptın! Kd\'yi artır - türev terimi kapanma HIZINI görür ve lider frene basar basmaz seni yavaşlatır. Kp tek başına ancak mesafe kısalınca tepki verir, o da geç kalabilir.'
        : 'Öndekine çarptın! ÇOK-YAKIN bandında robotu tamamen DURDURAN bir kuralın var mı? Lider aniden durursa yavaşlamak yetmez.');
    }
    if (sim.reason === 'lost') {
      tips.push((sim.cfg.mode === 'pid')
        ? 'Konvoyu kaybettin - Kp\'yi artır: mesafe açılınca daha kararlı hızlanmalısın.'
        : 'Konvoyu kaybettin. UZAK bandında tam gaza yakın bir hızlanma kuralın olmalı.');
    }
    if (sim.status === 'success') {
      const acc = accuracy(sim);
      if (acc >= 85) tips.push('Kusursuz konvoy sürüşü! Gerçek araçlardaki adaptif hız sabitleyici tam olarak bu kontrolü yapar.');
      else if (acc >= 60) tips.push('Vardın! Ama mesafe çok dalgalandı (%' + acc + ' idealde). ' + (sim.cfg.mode === 'pid' ? 'Kd ile salınımı yumuşat.' : 'Bantların hızlarını birbirine yaklaştır - sert geçişler salınım yapar.'));
      else tips.push('Vardın ama takip çok savruktu. ' + (sim.cfg.mode === 'pid' ? 'Kp/Kd dengesini yeniden kur.' : 'PID modunu dene - oranlı kontrol bant zıplamalarını yok eder.'));
    }
    return tips;
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const acc = accuracy(sim);
    if (acc >= 88) return { key: 'konvoy_kaptani', name: '🏆 Konvoy Kaptanı', cmt: 'Mesafe iple çekilmiş gibi - gerçek ACC mühendisliği.' };
    if (acc >= 72) return { key: 'usta_surucu', name: '🥇 Usta Sürücü', cmt: 'Sağlam takip. Salınımı biraz daha yumuşatabilirsin.' };
    if (acc >= 55) return { key: 'trafik_surucusu', name: '🧭 Trafik Sürücüsü', cmt: 'Konvoy tamam! Mesafeyi daha sıkı tutmayı dene.' };
    return { key: 'caylak_surucu', name: '🎓 Çaylak Sürücü', cmt: 'Vardın - şimdi mesafeyi dalgalandırmadan sürme zamanı.' };
  }

  function runHeadless(cfg, maxTime, dt) {
    dt = dt || 1 / 60;
    const sim = createSim(cfg);
    const mt = maxTime || (cfg.route.dur || 45) + 3;
    let g = 0;
    while (sim.status === 'running' && sim.t < mt && g++ < 2e6) tickSim(sim, dt);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(2),
      accuracy: accuracy(sim), minGap: +sim.minGap.toFixed(2), maxGap: +sim.maxGap.toFixed(2) };
  }

  // ---- starters --------------------------------------------------------------------
  function starterRules() {
    return [
      { pattern: ['on', 'off', 'off', 'off'], left: { dir: 'stop', speed: 0 }, right: { dir: 'stop', speed: 0 } },   // ÇOK YAKIN: DUR!
      { pattern: ['off', 'on', 'off', 'off'], left: { dir: 'fwd', speed: 30 }, right: { dir: 'fwd', speed: 30 } },   // YAKIN: yavaşla
      { pattern: ['off', 'off', 'on', 'off'], left: { dir: 'fwd', speed: 62 }, right: { dir: 'fwd', speed: 62 } },   // İDEAL: eşleş
      { pattern: ['off', 'off', 'off', 'on'], left: { dir: 'fwd', speed: 92 }, right: { dir: 'fwd', speed: 92 } },   // UZAK: yetiş
    ];
  }
  function starterDefault() { return { left: { dir: 'fwd', speed: 50 }, right: { dir: 'fwd', speed: 50 } }; }
  function defaultParams() { return { vMax: 3.6, wheelBase: 1.1, turnGain: 1.0 }; }
  function defaultPID() { return { hedef: 2.8, kp: 0.55, kd: 0.65 }; }

  const API = {
    CRASH_GAP, LOSE_GAP, START_GAP, IDEAL_LO, IDEAL_HI, BAND_COK, BAND_YAKIN, BAND_IDEAL,
    ROUTES, leaderSpeed, ROAD, roadPoint, bands,
    evalRules, ruleMatches, motorFraction,
    createSim, tickSim, accuracy, coach, robotClass, runHeadless,
    starterRules, starterDefault, defaultParams, defaultPID,
  };
  global.ConvoyCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
