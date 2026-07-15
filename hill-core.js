/* =============================================================================
 * RoboForge - Tepe Tırmanışı (Hill Climb) :: Simulation Core
 * -----------------------------------------------------------------------------
 * Pure, dependency-free. Browser (window.HillCore) + Node (module.exports).
 *
 * SIDE-VIEW terrain. Physics is the star: TORK yokuşu tırmandırır, TUTUŞ
 * patinajı önler, MOMENTUM kısa dik rampaları aşırtır. Parça seçimlerinin
 * en dolaysız karşılığı bu senaryoda.
 *
 * Kural mode (DEFAULT): slope bands -> throttle. PID mode: cruise control
 * (hedef hızı yokuşta-inişte sabit tut - Ki'nin yokuş dersi).
 * Traction: |F| <= grip·m·g·cos(φ)·surface ; aşarsan PATİNAJ (kayma, %45 güç).
 * ========================================================================== */
(function (global) {
  'use strict';

  const GRAV = 6.5;
  const DRAG = 0.35;
  const SLIP_EFF = 0.85;        // force efficiency while slipping
  const ROLLBACK_V = -0.4, ROLLBACK_T = 2.0;
  const STUCK_T = 5.0;
  const BAND1 = 0.12, BAND2 = 0.33; // slope bands (rad)
  const GEAR = { 1: { f: 1.35, cap: 5.5 }, 2: { f: 1.0, cap: 9.5 } };

  // ---- courses: terrain control points [x, y] (+ surface patches) ------------------
  // surface: [{x0,x1,mu}] grip multipliers (yağmur/çamur) · finish = last x
  const COURSES = [
    { id: 'duz', name: 'Isınma Turu', difficulty: 'Başlangıç', time: 30,
      pts: [[0, 0], [10, 0.4], [20, 0], [30, 0.8], [40, 0.2], [50, 0.5]] },
    { id: 'tatli', name: 'Tatlı Tepe', difficulty: 'Başlangıç', time: 40,
      pts: [[0, 0], [12, 0.3], [22, 3.6], [30, 4.0], [38, 1.0], [50, 0.5]] },
    { id: 'yamac', name: 'Dik Yamaç', difficulty: 'Orta', time: 45,
      pts: [[0, 0], [10, 0.3], [18, 4.6], [26, 5.2], [34, 2.0], [42, 2.4], [50, 0.8]] },
    { id: 'inisli', name: 'İnişli Çıkışlı', difficulty: 'Orta', time: 50,
      pts: [[0, 0], [8, 2.6], [15, 0.4], [22, 3.4], [29, 0.8], [36, 4.2], [43, 1.2], [50, 2.0]] },
    { id: 'kaygan', name: 'Yağmurlu Tepe', difficulty: 'İleri', time: 55,
      pts: [[0, 0], [12, 0.4], [22, 4.4], [30, 4.8], [40, 1.4], [50, 0.6]],
      surface: [{ x0: 14, x1: 32, mu: 0.62 }] },
    { id: 'merdiven', name: 'Merdiven', difficulty: 'İleri', time: 60,
      pts: [[0, 0], [8, 0.2], [13, 2.6], [19, 2.8], [24, 5.2], [30, 5.4], [35, 7.6], [42, 7.8], [50, 6.5]] },
    { id: 'zirve', name: 'Kâbus Zirvesi', difficulty: 'Uzman', time: 70,
      pts: [[0, 0], [9, 0.3], [16, 3.8], [22, 4.0], [27, 7.0], [33, 7.2], [38, 9.6], [45, 10.0], [50, 9.2]],
      surface: [{ x0: 23, x1: 30, mu: 0.7 }] },
  ];
  const FINISH_X = 48.5;

  function cardinal(p0, p1, p2, p3, t, s) {
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    return h00 * p1 + h10 * s * (p2 - p0) + h01 * p2 + h11 * s * (p3 - p1);
  }
  function buildTerrain(meta) {
    const P = meta.pts, n = P.length, xs = [], ys = [];
    for (let i = 0; i < n - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n - 1, i + 2)];
      for (let j = 0; j < 24; j++) {
        const t = j / 24;
        xs.push(p1[0] + (p2[0] - p1[0]) * t);
        ys.push(cardinal(p0[1], p1[1], p2[1], p3[1], t, 0.4));
      }
    }
    xs.push(P[n - 1][0]); ys.push(P[n - 1][1]);
    return { meta, xs, ys };
  }
  function heightAt(terr, x) {
    const xs = terr.xs, ys = terr.ys;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    let lo = 0, hi = xs.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    const t = (x - xs[lo]) / Math.max(1e-9, xs[hi] - xs[lo]);
    return ys[lo] + (ys[hi] - ys[lo]) * t;
  }
  function slopeAt(terr, x) {
    const d = 0.25;
    return Math.atan2(heightAt(terr, x + d) - heightAt(terr, x - d), 2 * d);
  }
  function surfaceAt(meta, x) {
    for (const s of (meta.surface || [])) if (x >= s.x0 && x <= s.x1) return s.mu;
    return 1;
  }

  // ---- rules -------------------------------------------------------------------------
  function slopeBands(phi) {
    return {
      dikYokus: phi > BAND2,
      yokus: phi > BAND1 && phi <= BAND2,
      duz: Math.abs(phi) <= BAND1,
      inis: phi < -BAND1 && phi >= -BAND2,
      dikInis: phi < -BAND2,
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

  // ---- sim ----------------------------------------------------------------------------
  function createSim(cfg) {
    return {
      cfg, terr: buildTerrain(cfg.course), course: cfg.course,
      x: 1, v: 0, t: 0, status: 'running', reason: null,
      slip: false, slipTime: 0, rollTime: 0, stuckTime: 0,
      maxX: 1, iErr: 0, pidPrev: 0,
      log: [], totalTicks: 0, last: null,
    };
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return sim.last;
    const params = sim.cfg.params;   // { force, grip, mass }
    const mode = sim.cfg.mode || 'rules';
    const phi = slopeAt(sim.terr, sim.x);
    const mu = surfaceAt(sim.course, sim.x);
    const m = params.mass || 1;

    let thr, ruleIndex = null, gear = 1;
    if (mode === 'pid') {
      const pid = sim.cfg.pid || defaultPID();
      const err = (pid.hedef || 3) - sim.v;
      sim.iErr = Math.max(-3, Math.min(3, sim.iErr + err * dt));
      thr = (pid.kp || 0) * err * 0.5 + (pid.ki || 0) * sim.iErr * 0.4;
      thr = Math.max(-1, Math.min(1, thr));
      const vs = pid.vites || 'auto';
      gear = vs === 'auto' ? ((phi > 0.12 || sim.v < 2.0) ? 1 : 2) : +vs;
    } else {
      const b = slopeBands(phi);
      const arr = [b.dikYokus, b.yokus, b.duz, b.inis, b.dikInis];
      const r = evalRules(sim.cfg.rules, sim.cfg.defaultRule, arr);
      thr = r.m; ruleIndex = r.ruleIndex;
      const rl = ruleIndex >= 0 ? sim.cfg.rules[ruleIndex] : sim.cfg.defaultRule;
      gear = rl.vites || 1;
    }
    sim.gear = gear;
    const G2 = GEAR[gear] || GEAR[1];

    // traction-limited drive (gear scales force; each gear has a top speed)
    let Fdemand = thr * (params.force || 8) * G2.f;
    if (thr > 0 && sim.v > G2.cap * 0.8) {          // vites tavanına yaklaştıkça güç düşer
      const taper = Math.max(0, 1 - (sim.v - G2.cap * 0.8) / (G2.cap * 0.55));
      Fdemand *= taper;
    }
    const Fmax = (params.grip || 0.55) * m * GRAV * Math.cos(phi) * mu;
    let F = Fdemand;
    sim.slip = Math.abs(Fdemand) > Fmax;
    if (sim.slip) { F = Math.sign(Fdemand) * Fmax * SLIP_EFF; sim.slipTime += dt; }

    const a = F / m - GRAV * Math.sin(phi) - DRAG * sim.v;
    sim.v += a * dt;
    sim.x += sim.v * Math.cos(phi) * dt;
    if (sim.x < 0.5) { sim.x = 0.5; sim.v = Math.max(0, sim.v); }

    sim.t += dt; sim.totalTicks++;
    if (sim.x > sim.maxX) sim.maxX = sim.x;

    sim.rollTime = sim.v < ROLLBACK_V ? sim.rollTime + dt : 0;
    sim.stuckTime = (Math.abs(sim.v) < 0.15 && sim.x < FINISH_X) ? sim.stuckTime + dt : 0;

    if (sim.totalTicks % 4 === 0) {
      sim.log.push([sim.t, sim.v, sim.x, sim.slip ? 1 : 0]);
      if (sim.log.length > 2200) sim.log.shift();
    }

    if (sim.x >= FINISH_X) { sim.status = 'success'; sim.reason = 'summit'; }
    else if (sim.rollTime > ROLLBACK_T) { sim.status = 'failed'; sim.reason = 'rollback'; }
    else if (sim.stuckTime > STUCK_T) { sim.status = 'failed'; sim.reason = 'stuck'; }
    else if (sim.t > (sim.course.time || 45)) { sim.status = 'failed'; sim.reason = 'timeout'; }

    sim.last = { thr, ruleIndex, phi, slip: sim.slip, mu, F, Fmax, gear };
    return sim.last;
  }

  function coach(sim) {
    const tips = [];
    const mode = sim.cfg.mode || 'rules';
    const slipPct = sim.totalTicks ? Math.round(100 * sim.slipTime * 60 / sim.totalTicks) : 0;
    if (sim.reason === 'stuck' || sim.reason === 'rollback') {
      if (slipPct > 20) tips.push('Tekerlekler boşa döndü (patinaj %' + slipPct + ')! Daha fazla gaz işe yaramaz - tutuş sınırını aşıyorsun. Ya yapışkan teker tak, ya da rampaya HIZLA gir: momentum, gücün yetmediği yerde seni taşır.');
      else tips.push('Yokuş robotu yendi. İki çare: daha torklu motor... ya da fizik hilesi: rampadan ÖNCE hızlan! Kinetik enerji kısa dik rampaları aşırtır. DÜZ bandında gazı artır.');
    }
    if (sim.reason === 'timeout') tips.push('Süre doldu. İnişlerde ve düzlüklerde kaybedilen zamanı geri kazan - ama dik inişte fren yoksa kalkış yapabilirsin!');
    if (sim.status === 'success') {
      if (slipPct < 4) tips.push('Zirve! Ve neredeyse hiç patinaj yok - tork/tutuş dengen mükemmel.');
      else tips.push('Zirveye vardın ama %' + slipPct + ' patinajla güç ziyan oldu. Dik bantlarda gazı tutuş sınırının hemen altında tut.');
    }
    return tips;
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const T = sim.course.time || 45, t = sim.t;
    if (t < T * 0.5) return { key: 'zirve_fatihi', name: '🏆 Zirve Fatihi', cmt: 'Dağ seni durduramadı - tork, tutuş ve momentum uyum içinde.' };
    if (t < T * 0.68) return { key: 'dag_kecisi', name: '🥇 Dağ Keçisi', cmt: 'Sağlam tırmanış. Rampalara daha hızlı girerek süre kazan.' };
    if (t < T * 0.85) return { key: 'tirmanisci', name: '🧭 Tırmanışçı', cmt: 'Zirve senin! Patinajı azaltırsan daha da hızlanırsın.' };
    return { key: 'caylak_dagci', name: '🎓 Çaylak Dağcı', cmt: 'Son anda ama vardın - momentum dersini unutma.' };
  }

  function runHeadless(cfg, maxTime, dt) {
    dt = dt || 1 / 60;
    const sim = createSim(cfg);
    const mt = maxTime || (cfg.course.time || 45) + 2;
    let g = 0;
    while (sim.status === 'running' && sim.t < mt && g++ < 2e6) tickSim(sim, dt);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(2),
      maxX: +sim.maxX.toFixed(1), slipT: +sim.slipTime.toFixed(1) };
  }

  // pattern = [dikYokus, yokus, duz, inis, dikInis]
  function starterRules() {
    return [
      { pattern: ['on', 'any', 'any', 'any', 'any'], left: { dir: 'fwd', speed: 100 }, vites: 1 },
      { pattern: ['off', 'on', 'any', 'any', 'any'], left: { dir: 'fwd', speed: 85 }, vites: 1 },
      { pattern: ['any', 'any', 'on', 'any', 'any'], left: { dir: 'fwd', speed: 72 }, vites: 2 },
      { pattern: ['any', 'any', 'any', 'on', 'off'], left: { dir: 'fwd', speed: 30 }, vites: 2 },
      { pattern: ['any', 'any', 'any', 'any', 'on'], left: { dir: 'rev', speed: 18 }, vites: 1 },
    ];
  }
  function starterDefault() { return { left: { dir: 'fwd', speed: 55 }, vites: 2 }; }
  // params from build: force ~ torque, grip ~ wheel; defaults = TT + plastik-ish
  function defaultParams() { return { force: 9.5, grip: 0.62, mass: 1 }; }
  function defaultPID() { return { hedef: 5.0, kp: 1.5, ki: 1.0, vites: 'auto' }; }

  const API = {
    GRAV, BAND1, BAND2, FINISH_X, SLIP_EFF, GEAR,
    COURSES, buildTerrain, heightAt, slopeAt, surfaceAt, slopeBands,
    evalRules, ruleMatches, motorFraction,
    createSim, tickSim, coach, robotClass, runHeadless,
    starterRules, starterDefault, defaultParams, defaultPID,
  };
  global.HillCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
