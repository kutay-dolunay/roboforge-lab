/* =============================================================================
 * RoboForge — Ateş Söndürme (Firefighting Robot) :: Simulation Core
 * -----------------------------------------------------------------------------
 * Pure, dependency-free. Browser (window.FireCore) + Node (module.exports).
 *
 * A house of rooms (wall segments). Somewhere a candle burns. The robot
 * explores (wall-follow), FINDS the flame (directional light sensors, walls
 * block light), approaches and extinguishes it with its fan (auto-fan when
 * the flame is close & ahead — hold it there!).
 *
 * Sensors (fixed roles):
 *   DUVAR-ÖN / DUVAR-SOL / DUVAR-SAĞ : raycast distance -> boolean "wall near"
 *   IŞIK-SOL / IŞIK-ÖN / IŞIK-SAĞ    : directional brightness -> boolean via threshold
 * Rule pattern = [dOn,dSol,dSag,iSol,iOn,iSag] with 'on'/'off'/'any'.
 * ========================================================================== */
(function (global) {
  'use strict';

  const ROBOT_R = 0.42;
  const WALL_NEAR_F = 1.5;     // front wall trigger distance
  const WALL_NEAR_S = 1.3;     // side wall trigger distance
  const RAY_MAX = 8;
  const LIGHT_K = 3.2;         // brightness falloff scale
  const LIGHT_THRESH = 0.10;   // boolean light threshold
  const WALL_BLOCK = 0.12;     // light multiplier through a wall
  const FAN_DIST = 2.2, FAN_CONE = 0.8, FAN_TIME = 1.0;
  const STALL_GRACE = 4.0;

  // ---- houses (7-level ladder) --------------------------------------------------
  // walls: [[x1,y1,x2,y2],...] INNER walls (border is implicit: ±8 x, ±5.5 y)
  // flame: [x,y] · start: {x,y,dir} (E/N/W/S)
  const HOUSES = [
    { id: 'salon', name: 'Tek Oda', difficulty: 'Başlangıç', time: 45,
      walls: [],
      flame: [5.5, 2.5], start: { x: -6, y: -3, dir: 'E' } },
    { id: 'iki_oda', name: 'İki Oda', difficulty: 'Başlangıç', time: 60,
      walls: [[0, -5.5, 0, -1.2], [0, 1.2, 0, 5.5]],
      flame: [5.5, 3], start: { x: -6, y: -3, dir: 'E' } },
    { id: 'koridor', name: 'Koridorlu Ev', difficulty: 'Orta', time: 80,
      walls: [[-2.5, -5.5, -2.5, 0.2], [-2.5, 3.2, -2.5, 5.5], [3, -5.5, 3, -3.2], [3, -0.2, 3, 5.5]],
      flame: [6, 3.5], start: { x: -6.5, y: -3.5, dir: 'N' } },
    { id: 'kose_oda', name: 'Köşe Odası', difficulty: 'Orta', time: 90,
      walls: [[-8, 0.5, -3.5, 0.5], [-1.5, 0.5, 3.5, 0.5], [3.5, 0.5, 3.5, 5.5], [1.5, -5.5, 1.5, -2.2]],
      flame: [-5.5, 3.5], start: { x: 5.5, y: -3.5, dir: 'N' } },
    { id: 'dort_oda', name: 'Dört Oda', difficulty: 'İleri', time: 110,
      walls: [[0, -5.5, 0, -3.2], [0, -1.0, 0, 1.0], [0, 3.2, 0, 5.5],
              [-8, 0, -5.6, 0], [-3.4, 0, 0, 0], [0, 0, 2.6, 0], [4.8, 0, 8, 0]],
      flame: [6, 3.5], start: { x: -6, y: -3.5, dir: 'E' } },
    { id: 'uzak_oda', name: 'Uzak Oda', difficulty: 'İleri', time: 120,
      walls: [[-3.5, -5.5, -3.5, -1.2], [-3.5, 1.2, -3.5, 5.5],
              [1.5, -5.5, 1.5, 2.2], [1.5, 4.4, 1.5, 5.5],
              [5, -2.4, 5, 5.5]],
      flame: [6.6, -4], start: { x: -6.5, y: 3.5, dir: 'S' } },
    { id: 'labirent_ev', name: 'Labirent Ev', difficulty: 'Uzman', time: 150,
      walls: [[-4.5, -5.5, -4.5, 1.4], [-4.5, 3.6, -4.5, 5.5],
              [-1, -1.6, -1, 5.5], [-1, -5.5, -1, -3.8],
              [2.5, -3.4, 2.5, 3.6],
              [5.5, -5.5, 5.5, -0.8], [2.5, -3.4, 5.5, -3.4]],
      flame: [7, -4.5], start: { x: -6.5, y: -3.5, dir: 'N' } },
  ];

  const DIRA = { E: 0, N: Math.PI / 2, W: Math.PI, S: -Math.PI / 2 };

  function allWalls(house) {
    const B = 8, H = 5.5;
    return house.walls.concat([[-B, -H, B, -H], [B, -H, B, H], [B, H, -B, H], [-B, H, -B, -H]]);
  }

  // ---- geometry -----------------------------------------------------------------
  function raySeg(px, py, dx, dy, w) {
    const x3 = w[0], y3 = w[1], x4 = w[2], y4 = w[3];
    const den = dx * (y4 - y3) - dy * (x4 - x3);
    if (Math.abs(den) < 1e-9) return Infinity;
    const t = ((x3 - px) * (y4 - y3) - (y3 - py) * (x4 - x3)) / den;
    const u = ((x3 - px) * dy - (y3 - py) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1) return t;
    return Infinity;
  }
  function rayDist(sim, ang) {
    const r = sim.robot;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let best = RAY_MAX;
    for (const w of sim.wallsAll) {
      const d = raySeg(r.x, r.y, dx, dy, w);
      if (d < best) best = d;
    }
    return best;
  }
  function segPointDist(px, py, w) {
    const ax = w[0], ay = w[1], bx = w[2], by = w[3];
    const abx = bx - ax, aby = by - ay;
    const ab2 = abx * abx + aby * aby || 1e-9;
    let t = ((px - ax) * abx + (py - ay) * aby) / ab2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
  }
  function segIntersects(x1, y1, x2, y2, w) {
    const d = raySeg(x1, y1, x2 - x1, y2 - y1, w);
    return d <= 1.0001 * Math.hypot(x2 - x1, y2 - y1) && d < Infinity &&
           d / Math.hypot(x2 - x1, y2 - y1) <= 1;
  }

  // ---- sensors -------------------------------------------------------------------
  function wrapA(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

  function lineOfSight(sim) {
    const r = sim.robot, f = sim.house.flame;
    for (const w of sim.house.walls) {           // only inner walls block (border can't be between)
      if (segIntersects(r.x, r.y, f[0], f[1], w)) return false;
    }
    return true;
  }
  function brightnessAt(sim, lobeAng) {
    // directional sensor with cos^2 lobe pointing at robot.th + relative angles
    const r = sim.robot, f = sim.house.flame;
    if (sim.flameHp <= 0) return 0;
    const d = Math.hypot(f[0] - r.x, f[1] - r.y);
    let b = 1 / (1 + (d / LIGHT_K) * (d / LIGHT_K));
    const bear = wrapA(Math.atan2(f[1] - r.y, f[0] - r.x) - (r.th + lobeAng));
    const lobe = Math.max(0, Math.cos(bear));
    b *= lobe * lobe;
    if (!sim.los) b *= WALL_BLOCK;
    const flick = 0.86 + 0.14 * Math.sin(sim.t * 7);
    return b * flick;
  }
  function sense(sim) {
    const vM = (sim.cfg.params && sim.cfg.params.vMax) || 3.6;
    const fNear = Math.max(1.3, Math.min(2.2, WALL_NEAR_F + 0.35 * (vM - 3.6)));
    const dOnD = rayDist(sim, sim.robot.th);
    const dSolD = rayDist(sim, sim.robot.th + Math.PI / 2 * 0.85);
    const dSagD = rayDist(sim, sim.robot.th - Math.PI / 2 * 0.85);
    sim.los = lineOfSight(sim);
    const iSolB = brightnessAt(sim, 0.55), iOnB = brightnessAt(sim, 0), iSagB = brightnessAt(sim, -0.55);
    return {
      dOn: dOnD < fNear, dSol: dSolD < WALL_NEAR_S, dSag: dSagD < WALL_NEAR_S,
      iSol: iSolB > LIGHT_THRESH, iOn: iOnB > LIGHT_THRESH, iSag: iSagB > LIGHT_THRESH,
      dOnD, dSolD, dSagD, iSolB, iOnB, iSagB,
    };
  }

  // ---- rules ---------------------------------------------------------------------
  function motorFraction(m) {
    if (!m || m.dir === 'stop') return 0;
    const f = (m.speed || 0) / 100;
    return m.dir === 'rev' ? -f : f;
  }
  function ruleMatches(rule, s) {
    const arr = [s.dOn, s.dSol, s.dSag, s.iSol, s.iOn, s.iSag];
    for (let i = 0; i < 6; i++) {
      const c = rule.pattern[i] || 'any';
      if (c === 'any') continue;
      if (c === 'on' && !arr[i]) return false;
      if (c === 'off' && arr[i]) return false;
    }
    return true;
  }
  function evalRules(rules, defaultRule, s) {
    for (let i = 0; i < rules.length; i++) {
      if (ruleMatches(rules[i], s)) {
        return { mL: motorFraction(rules[i].left), mR: motorFraction(rules[i].right), ruleIndex: i };
      }
    }
    return { mL: motorFraction(defaultRule.left), mR: motorFraction(defaultRule.right), ruleIndex: -1 };
  }

  // ---- sim ------------------------------------------------------------------------
  function createSim(cfg) {
    const house = cfg.house;
    return {
      cfg, house, wallsAll: allWalls(house),
      robot: { x: house.start.x, y: house.start.y, th: DIRA[house.start.dir] || 0 },
      t: 0, status: 'running', reason: null,
      flameHp: FAN_TIME, fanOn: false, los: false, foundAt: null,
      pidPrev: 0, eF: 0,
      timeStalled: 0, totalTicks: 0, trail: [], last: null,
    };
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return sim.last;
    const params = sim.cfg.params;
    const mode = sim.cfg.mode || 'rules';
    const r = sim.robot;
    const s = sense(sim);

    if (sim.foundAt === null && (s.iOn || s.iSol || s.iSag) && sim.los) sim.foundAt = sim.t;

    let cmd;
    if (mode === 'pid') {
      const pid = sim.cfg.pid || defaultPID();
      const base = (pid.base || 0) / 100;
      const anyLight = (s.iSolB + s.iOnB + s.iSagB) > LIGHT_THRESH && sim.los;
      if (anyLight) {
        // phototaxis: steer by brightness difference, slow down near the flame
        const e = (s.iSagB - s.iSolB) / Math.max(0.05, s.iSolB + s.iSagB + s.iOnB); // + = flame right
        sim.eF = sim.eF * 0.7 + e * 0.3;
        let dErr = (sim.eF - sim.pidPrev) / dt;
        if (dErr > 2.5) dErr = 2.5; else if (dErr < -2.5) dErr = -2.5;
        sim.pidPrev = sim.eF;
        let turn = (pid.kp || 0) * e + (pid.kd || 0) * dErr;
        if (turn > 1) turn = 1; else if (turn < -1) turn = -1;
        let fwd = base;
        if (s.dOnD < 1.2) fwd *= 0.45;                    // wall ahead: slow
        const near = Math.hypot(sim.house.flame[0] - r.x, sim.house.flame[1] - r.y);
        if (near < 2.2) fwd = Math.min(fwd, 0.35);        // approach gently
        cmd = { mL: Math.max(-1, Math.min(1, fwd + turn)), mR: Math.max(-1, Math.min(1, fwd - turn)) };
      } else {
        // explore: right-wall follow (same shape as the starter rules, scaled by Temel Hız)
        const k = base / 0.62;
        if (s.dOn) cmd = { mL: -0.30 * k, mR: 0.62 * k };
        else if (!s.dSag) cmd = { mL: 0.74 * k, mR: 0.30 * k };
        else cmd = { mL: 0.62 * k, mR: 0.62 * k };
      }
    } else {
      cmd = evalRules(sim.cfg.rules, sim.cfg.defaultRule, s);
    }

    // step + wall slide (no crash fail: touching walls just stops you)
    const vL = cmd.mL * params.vMax, vR = cmd.mR * params.vMax;
    const v = (vL + vR) / 2;
    r.th += ((vR - vL) / params.wheelBase) * (params.turnGain || 1) * dt;
    const nx = r.x + v * Math.cos(r.th) * dt;
    const ny = r.y + v * Math.sin(r.th) * dt;
    let blocked = false;
    for (const w of sim.wallsAll) {
      if (segPointDist(nx, ny, w) < ROBOT_R) { blocked = true; break; }
    }
    if (!blocked) { r.x = nx; r.y = ny; }
    else {
      // try axis-separated slide
      let okX = true, okY = true;
      for (const w of sim.wallsAll) {
        if (segPointDist(nx, r.y, w) < ROBOT_R) okX = false;
        if (segPointDist(r.x, ny, w) < ROBOT_R) okY = false;
      }
      if (okX) r.x = nx; else if (okY) r.y = ny;
    }

    sim.t += dt; sim.totalTicks++;

    // fan: auto when flame close, ahead, visible
    const f = sim.house.flame;
    const fd = Math.hypot(f[0] - r.x, f[1] - r.y);
    const fb = wrapA(Math.atan2(f[1] - r.y, f[0] - r.x) - r.th);
    sim.fanOn = sim.los && fd < FAN_DIST && Math.abs(fb) < FAN_CONE && sim.flameHp > 0;
    if (sim.fanOn) {
      sim.flameHp -= dt;
      if (sim.flameHp <= 0) { sim.status = 'success'; sim.reason = 'extinguished'; }
    }

    sim.timeStalled = Math.abs(v) < 0.04 ? sim.timeStalled + dt : 0;
    if (sim.status === 'running') {
      if (sim.timeStalled > STALL_GRACE) { sim.status = 'failed'; sim.reason = 'stalled'; }
      else if (sim.t > (sim.house.time || 90)) { sim.status = 'failed'; sim.reason = 'timeout'; }
    }

    if (sim.totalTicks % 3 === 0) {
      sim.trail.push([r.x, r.y]);
      if (sim.trail.length > 4000) sim.trail.shift();
    }

    sim.last = { s, cmd, v, fanOn: sim.fanOn, flameHp: sim.flameHp, fd };
    return sim.last;
  }

  function coach(sim) {
    const tips = [];
    if (sim.reason === 'timeout') {
      if (sim.foundAt === null) tips.push('Robot alevi hiç göremedi. Keşif kuralların evi dolaşıyor mu? Sağ-duvar takibi (sağda duvar yoksa sağa kavis, önde duvar varsa sola dön) kapalı evlerde her odayı gezer.');
      else tips.push('Alev görüldü (' + sim.foundAt.toFixed(0) + '. saniye) ama söndürülemedi. Işık kurallarının robotu aleve DOĞRU döndürdüğünden emin ol; alev önündeyken yavaş yaklaş — fan ancak yakında ve alev öndeyken çalışır.');
    }
    if (sim.reason === 'stalled') tips.push('Robot sıkıştı. Önde duvar varken dönen bir kuralın olmalı — ve varsayılan kural robotu hep hareket ettirmeli.');
    if (sim.status === 'success') {
      const T = sim.house.time || 90;
      if (sim.t < T * 0.4) tips.push('Hızlı müdahale! İtfaiyecilik böyle yapılır.');
      else tips.push('Yangın söndü! Daha hızlısı için keşif hızını artırmayı dene — ama duvarlara takılma.');
    }
    return tips;
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const T = sim.house.time || 90, t = sim.t;
    if (t < T * 0.35) return { key: 'alev_avcisi', name: '🏆 Alev Avcısı', cmt: 'Saniyeler içinde buldu, tereddütsüz söndürdü.' };
    if (t < T * 0.55) return { key: 'itfaiye_eri', name: '🥇 İtfaiye Eri', cmt: 'Sağlam keşif, temiz müdahale.' };
    if (t < T * 0.8) return { key: 'gonullu_itfaiyeci', name: '🧭 Gönüllü İtfaiyeci', cmt: 'Yangın söndü! Keşif rotası biraz daha kısalabilir.' };
    return { key: 'caylak_itfaiyeci', name: '🎓 Çaylak İtfaiyeci', cmt: 'Son anda ama söndürdün — şimdi hız zamanı.' };
  }

  function runHeadless(cfg, maxTime, dt) {
    dt = dt || 1 / 60;
    const sim = createSim(cfg);
    const mt = maxTime || (cfg.house.time || 90) + 5;
    let g = 0;
    while (sim.status === 'running' && sim.t < mt && g++ < 2e6) tickSim(sim, dt);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(2),
      foundAt: sim.foundAt === null ? -1 : +sim.foundAt.toFixed(1) };
  }

  // ---- starters ---------------------------------------------------------------------
  function starterRules() {
    return [
      // flame handling (highest priority)
      { pattern: ['off', 'any', 'any', 'off', 'on', 'off'], left: { dir: 'fwd', speed: 55 }, right: { dir: 'fwd', speed: 55 } }, // flame ahead: approach
      { pattern: ['any', 'any', 'any', 'on', 'any', 'off'], left: { dir: 'fwd', speed: 28 }, right: { dir: 'fwd', speed: 64 } }, // flame left: turn left
      { pattern: ['any', 'any', 'any', 'off', 'any', 'on'], left: { dir: 'fwd', speed: 64 }, right: { dir: 'fwd', speed: 28 } }, // flame right: turn right
      { pattern: ['on', 'any', 'any', 'off', 'on', 'off'], left: { dir: 'fwd', speed: 30 }, right: { dir: 'fwd', speed: 30 } },  // flame ahead but wall: creep
      // exploration: right-wall follow
      { pattern: ['on', 'any', 'any', 'off', 'off', 'off'], left: { dir: 'rev', speed: 30 }, right: { dir: 'fwd', speed: 62 } },  // wall ahead: turn left
      { pattern: ['off', 'any', 'off', 'off', 'off', 'off'], left: { dir: 'fwd', speed: 74 }, right: { dir: 'fwd', speed: 30 } }, // no right wall: curve right
      { pattern: ['off', 'any', 'on', 'off', 'off', 'off'], left: { dir: 'fwd', speed: 62 }, right: { dir: 'fwd', speed: 62 } },  // wall on right: cruise
    ];
  }
  function starterDefault() { return { left: { dir: 'fwd', speed: 45 }, right: { dir: 'fwd', speed: 45 } }; }
  function defaultParams() { return { vMax: 3.6, wheelBase: 1.1, turnGain: 1.0 }; }
  function defaultPID() { return { base: 62, kp: 2.2, kd: 0.4, duvar: 1.5 }; }

  const API = {
    ROBOT_R, RAY_MAX, LIGHT_THRESH, FAN_DIST, FAN_CONE, FAN_TIME,
    HOUSES, allWalls, raySeg, rayDist, segPointDist, lineOfSight, brightnessAt, sense,
    evalRules, ruleMatches, motorFraction,
    createSim, tickSim, coach, robotClass, runHeadless,
    starterRules, starterDefault, defaultParams, defaultPID,
  };
  global.FireCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
