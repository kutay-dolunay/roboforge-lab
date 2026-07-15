/* =============================================================================
 * RoboForge - Drone Görevi (Altitude & Waypoint Flight) :: Simulation Core
 * -----------------------------------------------------------------------------
 * Pure, dependency-free. Browser (window.DroneCore) + Node (module.exports).
 *
 * SIDE-VIEW quadcopter. Thrust fights gravity - hover control is the purest
 * altitude PID… and the home of the Ki lesson: with P-only control the drone
 * hovers BELOW the target (steady-state error, gravity offset). Ki erases it.
 *
 * PID mode (DEFAULT): thrust = Kp·(h_hedef−h) − Kd·vy + Ki·∫err.
 * Horizontal: gentle auto-P toward the current waypoint (Yatay Kazanç slider).
 * Kural mode: altitude bands -> thrust %, target side -> tilt.
 * ========================================================================== */
(function (global) {
  'use strict';

  const GRAV = 6.5;
  const DRAG = 0.55;
  const H_AUTH = 5.0;          // horizontal accel authority
  const WP_R = 0.95, WP_HOLD = 1.0;
  const LAND_V = 1.4;          // soft landing max |vy|
  const PAD_W = 2.4;
  const X_LIM = 10.5, Y_LIM = 13;
  const BAND1 = 0.5, BAND2 = 1.6; // altitude error bands

  // ---- missions (7-level ladder) --------------------------------------------------
  // wps: [{x,y}] hover-visit in order · land: {x} landing pad at ground ·
  // wind: {base,gustT,gustImp} · mass: weight multiplier · gates: [{x, gapY, gapH}] obstacles
  const MISSIONS = [
    { id: 'havalan', name: 'Havalan ve Dur', difficulty: 'Başlangıç', dur: 20,
      wps: [{ x: 0, y: 6 }], land: null, mass: 1 },
    { id: 'inis', name: 'Yumuşak İniş', difficulty: 'Başlangıç', dur: 30,
      wps: [{ x: 0, y: 6 }], land: { x: 4 }, mass: 1 },
    { id: 'teslimat', name: 'Teslimat Uçuşu', difficulty: 'Orta', dur: 40,
      wps: [{ x: -5, y: 7 }, { x: 5, y: 5 }], land: { x: 7 }, mass: 1 },
    { id: 'ruzgar', name: 'Rüzgârda Uçuş', difficulty: 'Orta', dur: 45,
      wps: [{ x: -4, y: 6 }, { x: 4, y: 8 }], land: { x: 0 }, mass: 1,
      wind: { base: 0.9, gustT: 4.5, gustImp: 1.1 } },
    { id: 'gecit', name: 'Dar Geçit', difficulty: 'İleri', dur: 45,
      wps: [{ x: -6, y: 3.2 }, { x: 0, y: 3.2 }, { x: 6, y: 4 }], land: { x: 8 }, mass: 1,
      gates: [{ x: -3, gapY: 3.2, gapH: 2.6 }, { x: 3, gapY: 3.2, gapH: 2.6 }] },
    { id: 'kargo', name: 'Ağır Kargo', difficulty: 'İleri', dur: 50,
      wps: [{ x: -5, y: 6 }, { x: 5, y: 6 }], land: { x: 7 }, mass: 1.55 },
    { id: 'firtina', name: 'Fırtına Kurtarma', difficulty: 'Uzman', dur: 60,
      wps: [{ x: -6, y: 4 }, { x: 0, y: 7.5 }, { x: 6, y: 4 }], land: { x: -8 }, mass: 1.25,
      wind: { base: 1.1, gustT: 3.2, gustImp: 1.4 },
      gates: [{ x: 3, gapY: 5.5, gapH: 5.4 }] },
  ];

  function windAt(m, t) {
    const w = m.wind;
    if (!w) return 0;
    const phase = Math.floor(t / w.gustT);
    const inGust = (t - phase * w.gustT) < w.gustT * 0.45;
    const sign = phase % 2 === 0 ? 1 : -1;
    return w.base * Math.sin(t * 0.6 + 1) + (inGust ? sign * w.gustImp * 0.6 : 0);
  }

  // ---- rules -----------------------------------------------------------------------
  function altBands(err) { // err = hedef - h (+ = drone is too LOW)
    return {
      cokAlcak: err > BAND2,
      alcak: err > BAND1 && err <= BAND2,
      tamam: Math.abs(err) <= BAND1,
      yuksek: err < -BAND1 && err >= -BAND2,
      cokYuksek: err < -BAND2,
    };
  }
  function motorFraction(m) {
    if (!m || m.dir === 'stop') return 0;
    const f = (m.speed || 0) / 100;
    return m.dir === 'rev' ? -f : f;
  }
  function ruleMatches(rule, arr) {
    for (let i = 0; i < arr.length; i++) {
      const c = rule.pattern[i] || 'any';
      if (c === 'any') continue;
      if (c === 'on' && !arr[i]) return false;
      if (c === 'off' && arr[i]) return false;
    }
    return true;
  }
  function evalRules(rules, defaultRule, arr) {
    for (let i = 0; i < rules.length; i++) {
      if (ruleMatches(rules[i], arr)) return { m: motorFraction(rules[i].left), ruleIndex: i };
    }
    return { m: motorFraction(defaultRule.left), ruleIndex: -1 };
  }

  // ---- sim --------------------------------------------------------------------------
  function createSim(cfg) {
    return {
      cfg, mission: cfg.mission,
      x: -8, y: 0.4, vx: 0, vy: 0,
      t: 0, status: 'running', reason: null,
      wpIdx: 0, wpHold: 0, landing: false,
      batt: (cfg.params && cfg.params.battery) || 120, battMax: (cfg.params && cfg.params.battery) || 120, battOut: false,
      iErr: 0, sumHerr: 0, totalTicks: 0,
      log: [], last: null,
    };
  }
  function currentGoal(sim) {
    const M = sim.mission;
    if (sim.wpIdx < M.wps.length) return { type: 'wp', ...M.wps[sim.wpIdx] };
    if (M.land) return { type: 'land', x: M.land.x, y: 0.4 };
    return null;
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return sim.last;
    const M = sim.mission;
    const params = sim.cfg.params;
    const mode = sim.cfg.mode || 'pid';
    const mass = M.mass || 1;
    const thrustAuth = (params.vMax / 3.6) * 13.5;

    const goal = currentGoal(sim);
    let gy = goal ? goal.y : 6;
    if (goal && goal.type === 'land' && Math.abs(goal.x - sim.x) >= 1.1) gy = Math.max(3.4, gy); // cruise to pad first
    const err = gy - sim.y;

    let thr, tilt, ruleIndex = null;
    if (mode === 'pid') {
      const pid = sim.cfg.pid || defaultPID();
      sim.iErr += err * dt;
      sim.iErr = Math.max(-2.2, Math.min(2.2, sim.iErr));
      thr = (pid.kp || 0) * err * 0.28 - (pid.kd || 0) * sim.vy * 0.22 + (pid.ki || 0) * sim.iErr * 0.30 + 0.30;
      thr = Math.max(0, Math.min(1, thr));
      const dx = goal ? goal.x - sim.x : -sim.x;
      tilt = Math.max(-1, Math.min(1, dx * (pid.kx || 1) * 0.35 - sim.vx * 0.55));
      if (goal && goal.type === 'land' && Math.abs(dx) < 1.1) {
        const vT = -0.85;                                  // controlled descent rate
        const hover = GRAV * mass / thrustAuth;
        thr = Math.max(0, Math.min(1, 0.5 * (vT - sim.vy) + hover));
      }
    } else {
      const b = altBands(err);
      const dx = goal ? goal.x - sim.x : 0;
      const hedefSol = dx < -0.7, hedefSag = dx > 0.7;
      const arr = [b.cokAlcak, b.alcak, b.tamam, b.yuksek, b.cokYuksek, hedefSol, hedefSag];
      const r = evalRules(sim.cfg.rules, sim.cfg.defaultRule, arr);
      thr = Math.max(0, r.m); ruleIndex = r.ruleIndex;
      tilt = Math.max(-1, Math.min(1, dx * 0.4 - sim.vx * 0.5));
      if (goal && goal.type === 'land' && Math.abs(dx) < 1.1) {
        const vT = -0.85;
        const hover = GRAV * mass / thrustAuth;
        thr = Math.max(0, Math.min(1, 0.5 * (vT - sim.vy) + hover));
      }
    }

    // battery: thrust costs energy (quadratic - hovering hot burns fast)
    if (sim.batt > 0) sim.batt -= (2.2 * thr * thr + 0.45) * dt;
    if (sim.batt <= 0) { sim.batt = 0; sim.battOut = true; thr = 0; }

    const wind = windAt(M, sim.t);
    sim.vy += (thr * thrustAuth / mass - GRAV - DRAG * sim.vy) * dt;
    sim.vx += (tilt * H_AUTH / mass + wind - DRAG * sim.vx) * dt;
    sim.y += sim.vy * dt;
    sim.x += sim.vx * dt;

    sim.t += dt; sim.totalTicks++;
    if (sim.t > 2.5) { sim.sumHerr += Math.abs(err); sim.precTicks = (sim.precTicks || 0) + 1; }

    // waypoints
    if (goal && goal.type === 'wp') {
      if (Math.hypot(sim.x - goal.x, sim.y - goal.y) < WP_R) {
        sim.wpHold += dt;
        if (sim.wpHold >= WP_HOLD) { sim.wpIdx++; sim.wpHold = 0; }
      } else sim.wpHold = 0;
    }

    // gates (obstacle towers with a gap)
    for (const g of (M.gates || [])) {
      if (Math.abs(sim.x - g.x) < 0.45) {
        const inGap = sim.y > g.gapY - g.gapH / 2 && sim.y < g.gapY + g.gapH / 2;
        if (!inGap && sim.y < Y_LIM - 0.5) { sim.status = 'failed'; sim.reason = 'crash_gate'; }
      }
    }

    // ground / landing
    if (sim.y <= 0.35) {
      const onPad = M.land && Math.abs(sim.x - M.land.x) < PAD_W / 2;
      const soft = Math.abs(sim.vy) < LAND_V;
      const wpsDone = sim.wpIdx >= M.wps.length;
      if (M.land && onPad && soft && wpsDone) { sim.status = 'success'; sim.reason = 'landed'; }
      else if (sim.t < 1.5 && sim.vy > -0.5) { sim.y = 0.4; sim.vy = Math.max(0, sim.vy); } // takeoff grace
      else { sim.status = 'failed'; sim.reason = sim.battOut ? 'battery' : (soft ? 'wrong_pad' : 'crash_ground'); }
    }
    if (sim.y > Y_LIM) { sim.y = Y_LIM; sim.vy = Math.min(0, sim.vy); }
    if (Math.abs(sim.x) > X_LIM) { sim.status = 'failed'; sim.reason = 'out'; }

    // no-land missions: hover completion
    if (sim.status === 'running' && !M.land && sim.wpIdx >= M.wps.length) {
      sim.status = 'success'; sim.reason = 'hovered';
    }
    if (sim.status === 'running' && sim.t > M.dur) {
      sim.status = 'failed'; sim.reason = 'timeout';
    }

    if (sim.totalTicks % 4 === 0) {
      sim.log.push([sim.t, sim.y, sim.x, gy]);
      if (sim.log.length > 2200) sim.log.shift();
    }

    sim.last = { thr, tilt, ruleIndex, wind, goal, err };
    return sim.last;
  }

  function precision(sim) {
    const n = sim.precTicks || 0;
    return n ? Math.max(0, Math.round(100 * (1 - (sim.sumHerr / n) / 2.2))) : 0;
  }

  function coach(sim) {
    const tips = [];
    const mode = sim.cfg.mode || 'pid';
    if (sim.reason === 'battery') {
      tips.push('Enerji bitti ve drone gökten düştü! İtki maliyeti kareseldir: %90 itki, %45 itkinin DÖRT katı yakar. Daha alçak uç, salınımı azalt (Kd/Ki) - pürüzsüz uçuş = verimli uçuş.');
    }
    if (sim.reason === 'crash_ground') {
      tips.push(mode === 'pid'
        ? 'Sert çakılma! İnişte Kd hayat kurtarır - alçalma hızını görüp itkiyi artırır. Kd değerini yükselt.'
        : 'Sert çakılma! ÇOK ALÇAK bandında güçlü itki (85+) olmalı; TAMAM bandında bile askı için ~%45 itki gerekir - sıfır itki = taş gibi düşersin.');
    }
    if (sim.reason === 'wrong_pad') tips.push('Yumuşak indin ama pistin dışına! Görev bitmeden ya da hedef pist üstüne gelmeden alçalma.');
    if (sim.reason === 'crash_gate') tips.push('Kuleye çarptın! Geçitten geçmek için önce geçit yüksekliğine hizalan, sonra yatay ilerle.');
    if (sim.reason === 'out') tips.push('Rüzgâr seni sahneden attı! Yatay Kazanç hedefe daha sıkı tutunmanı sağlar.');
    if (sim.reason === 'timeout') {
      if (mode === 'pid' && (sim.cfg.pid.ki || 0) < 0.05 && sim.wpIdx < sim.mission.wps.length)
        tips.push('Süre doldu - drone hedefin hep BİRAZ ALTINDA asılı kaldı, değil mi? Bu kalıcı hata (steady-state error) yerçekimi yüzünden: P tek başına yetmez. Ki değerini artır - integral terimi bu açığı zamanla kapatır. Bu, bu görevin en büyük dersi!');
      else tips.push('Süre doldu. Hedef noktalarında 1 saniye sabit durman gerekiyor - salınımı azalt (Kd) ve rotayı hızlandır.');
    }
    if (sim.status === 'success') {
      const p = precision(sim);
      if (p >= 85) tips.push('Kusursuz uçuş! Gerçek drone otopilotları tam böyle çalışır.');
      else tips.push('Görev tamam! İrtifa takibi biraz dalgalıydı (%' + p + ') - Ki/Kd ince ayarıyla çizgiyi düzleştir.');
    }
    return tips;
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const p = precision(sim);
    if (p >= 85) return { key: 'hava_kurdu', name: '🏆 Hava Kurdu', cmt: 'İrtifa çizgisi cetvel gibi - otopilot mühendisliği.' };
    if (p >= 70) return { key: 'pilot', name: '🥇 Pilot', cmt: 'Temiz uçuş. Ki ile son salınımları da söndür.' };
    if (p >= 55) return { key: 'amator_pilot', name: '🧭 Amatör Pilot', cmt: 'Görev tamam! İrtifa takibin gelişebilir.' };
    return { key: 'caylak_pilot', name: '🎓 Çaylak Pilot', cmt: 'İndin ya, gerisi ayrıntı!' };
  }

  function runHeadless(cfg, maxTime, dt) {
    dt = dt || 1 / 60;
    const sim = createSim(cfg);
    const mt = maxTime || (cfg.mission.dur || 40) + 2;
    let g = 0;
    while (sim.status === 'running' && sim.t < mt && g++ < 2e6) tickSim(sim, dt);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(2),
      precision: precision(sim), wps: sim.wpIdx + '/' + cfg.mission.wps.length,
      batt: Math.round(sim.batt) };
  }

  // pattern = [cokAlcak, alcak, tamam, yuksek, cokYuksek, hedefSol, hedefSag]
  function starterRules() {
    return [
      { pattern: ['on', 'any', 'any', 'any', 'any', 'any', 'any'], left: { dir: 'fwd', speed: 90 } },
      { pattern: ['off', 'on', 'any', 'any', 'any', 'any', 'any'], left: { dir: 'fwd', speed: 62 } },
      { pattern: ['any', 'any', 'on', 'any', 'any', 'any', 'any'], left: { dir: 'fwd', speed: 45 } },
      { pattern: ['any', 'any', 'any', 'on', 'off', 'any', 'any'], left: { dir: 'fwd', speed: 28 } },
      { pattern: ['any', 'any', 'any', 'any', 'on', 'any', 'any'], left: { dir: 'fwd', speed: 8 } },
    ];
  }
  function starterDefault() { return { left: { dir: 'fwd', speed: 45 } }; }
  function defaultParams() { return { vMax: 3.6, wheelBase: 1.1, turnGain: 1.0 }; }
  function defaultPID() { return { kp: 1.6, kd: 1.1, ki: 0.45, kx: 1.0 }; }

  const API = {
    GRAV, WP_R, PAD_W, LAND_V, X_LIM, Y_LIM, BAND1, BAND2,
    MISSIONS, windAt, altBands, evalRules, ruleMatches, motorFraction,
    createSim, tickSim, precision, coach, robotClass, runHeadless, currentGoal,
    starterRules, starterDefault, defaultParams, defaultPID,
  };
  global.DroneCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
