/* =============================================================================
 * RoboForge - Işık Takibi (Light Follower) :: Simulation Core
 * -----------------------------------------------------------------------------
 * Pure, dependency-free. Runs in browser (window.LightCore) and Node.
 *
 * Phototaxis with directional LDR sensors (front/left/right). TWO control modes:
 *   • KURAL  - block rules over a tunable brightness THRESHOLD (bright/dark).
 *   • PID    - proportional: steer ∝ (leftBright − rightBright); Kp/Kd/base.
 * Motor spec -> speed (continuity); wheel spec -> turn agility.
 *
 * 7-level ladder: Başlangıç ×2, Orta ×2, İleri ×2, Uzman ×1.
 * World: origin = arena center. +x right, +y up. Bounded box.
 * ========================================================================== */
(function (global) {
  'use strict';

  const A = 10.0;
  const K = 8.0;
  const CAPTURE = 1.0;
  const LOST_GRACE = 4.5;
  const DARK = 0.035;
  const MATCH_TIME = 30;
  const MAX_OM = 3.4;

  const OFFSET = { front: 0, left: 0.62, right: -0.62 };

  const SCENES = [
    { id: 'beacon', name: 'Fener', difficulty: 'Başlangıç',
      blurb: 'Tek, sabit bir ışık. Ona doğru sür ve yakala.',
      start: [0, -8, Math.PI / 2], lights: [{ x: 0, y: 7.5, power: 1.0 }], target: 0 },
    { id: 'near', name: 'Yakın Işık', difficulty: 'Başlangıç',
      blurb: 'Hafif yana kaymış yakın bir ışık. Doğru yöne kır.',
      start: [0, -5, Math.PI / 2], lights: [{ x: 1.6, y: 6, power: 1.0 }], target: 0 },
    { id: 'roam', name: 'Gezen Işık', difficulty: 'Orta',
      blurb: 'Işık yavaşça gezinir. Onu kovala ve yakala.',
      start: [-7, -7, Math.PI / 2], lights: [{ x: 0, y: 5, power: 1.1, move: { ax: 5.5, ay: 1.2, sx: 0.32, sy: 0.5 } }], target: 0 },
    { id: 'far', name: 'Uzak Fener', difficulty: 'Orta',
      blurb: 'Köşedeki uzak bir ışık. Zayıf sinyali kaybetmeden takip et.',
      start: [-8, -8, Math.PI / 2], lights: [{ x: 6, y: 7, power: 1.15 }], target: 0 },
    { id: 'two', name: 'İki Fener', difficulty: 'İleri',
      blurb: 'İki ışık var - parlak olana git, sönük olan tuzak.',
      start: [0, -8, Math.PI / 2], lights: [{ x: 5.5, y: 6.5, power: 1.25 }, { x: -6, y: 3, power: 0.55 }], target: 0 },
    { id: 'flee', name: 'Kaçan Işık', difficulty: 'İleri',
      blurb: 'Hızlı gezinen bir ışık. Onu köşeye sıkıştır.',
      start: [-8, -8, Math.PI / 2], lights: [{ x: 0, y: 4, power: 1.15, move: { ax: 6, ay: 2, sx: 0.5, sy: 0.7 } }], target: 0 },
    { id: 'game', name: 'Işık Oyunu', difficulty: 'Uzman',
      blurb: 'Hızlı kaçan parlak ışık + şaşırtan bir sönük ışık. Hızlı bir robot şart.',
      start: [0, -8, Math.PI / 2],
      lights: [{ x: 0, y: 5, power: 1.3, move: { ax: 7.5, ay: 3.5, sx: 1.1, sy: 1.5 } }, { x: -5, y: 0, power: 0.72, move: { ax: 3.5, ay: 0, sx: 0.5, sy: 0 } }], target: 0 },
  ];

  function norm(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function buildScene(def) {
    const lights = def.lights.map((l) => ({ x: l.x, y: l.y, x0: l.x, y0: l.y, power: l.power, move: l.move || null }));
    return { meta: def, lights, target: def.target || 0, start: def.start.slice() };
  }

  // ---- rule engine ----
  function motorFraction(m) { if (!m || m.dir === 'stop') return 0; const f = (m.speed || 0) / 100; return m.dir === 'rev' ? -f : f; }
  function ruleMatches(rule, states) {
    for (let i = 0; i < states.length; i++) { const p = rule.pattern[i] || 'any';
      if (p === 'any') continue; if (p === 'on' && !states[i]) return false; if (p === 'off' && states[i]) return false; }
    return true;
  }
  function evalRules(rules, def, states) {
    for (let i = 0; i < rules.length; i++) if (ruleMatches(rules[i], states))
      return { mL: motorFraction(rules[i].left), mR: motorFraction(rules[i].right), ruleIndex: i };
    return { mL: motorFraction(def.left), mR: motorFraction(def.right), ruleIndex: -1 };
  }

  function localToWorld(rb, fwd, right) {
    const c = Math.cos(rb.th), s = Math.sin(rb.th);
    return [rb.x + fwd * c + right * s, rb.y + fwd * s + right * (-c)];
  }
  function sensorBrightness(rb, sensor, lights) {
    const [sx, sy] = localToWorld(rb, sensor.fwd, sensor.right);
    const facing = rb.th + (OFFSET[sensor.role] || 0);
    let inten = 0;
    for (const L of lights) {
      const dx = L.x - sx, dy = L.y - sy; const d = Math.hypot(dx, dy);
      const dAng = norm(Math.atan2(dy, dx) - facing);
      const c = Math.max(0, Math.cos(dAng));
      const lobe = 0.14 + 0.86 * c * c;
      inten += L.power * lobe / (1 + (d / K) * (d / K));
    }
    return inten;
  }
  function readBrightness(rb, sensors, lights) { return sensors.map((s) => sensorBrightness(rb, s, lights)); }
  function readSensors(rb, sensors, lights, threshold) { return readBrightness(rb, sensors, lights).map((b) => b >= threshold); }
  function brightByRole(sensors, bright, role) { for (let i = 0; i < sensors.length; i++) if (sensors[i].role === role) return bright[i]; return 0; }

  function stepDiff(rb, mL, mR, params, dt) {
    const vMax = params.vMax;
    const v = (mL * vMax + mR * vMax) / 2;
    const om = clamp(((mR - mL) * vMax / params.wheelBase) * (params.turnGain || 1), -MAX_OM, MAX_OM);
    rb.th += om * dt; rb.x += v * Math.cos(rb.th) * dt; rb.y += v * Math.sin(rb.th) * dt;
    rb.x = clamp(rb.x, -A, A); rb.y = clamp(rb.y, -A, A);
    return v;
  }

  function moveLights(scene, t) {
    for (const L of scene.lights) { if (!L.move) continue; const m = L.move;
      L.x = clamp(L.x0 + m.ax * Math.sin(t * m.sx), -A + 1, A - 1);
      L.y = clamp(L.y0 + m.ay * Math.sin(t * m.sy), -A + 1, A - 1);
    }
  }

  function makeRobot(scene) { const [x, y, th] = scene.start; return { x, y, th }; }

  function createSim(cfg) {
    return { cfg, robot: makeRobot(cfg.scene), t: 0, status: 'running', reason: null,
      timeDark: 0, lastStates: null, lastBright: null, lastError: 0, prevError: 0, trail: [] };
  }
  function targetLight(scene) { return scene.lights[scene.target] || scene.lights[0]; }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return;
    const { scene, sensors, rules, defaultRule, params, threshold, mode, pid } = sim.cfg;
    moveLights(scene, sim.t);
    const bright = readBrightness(sim.robot, sensors, scene.lights);

    if (mode === 'pid') {
      const lB = brightByRole(sensors, bright, 'left'), rB = brightByRole(sensors, bright, 'right');
      const err = lB - rB;
      const om = clamp((pid.kp * err + pid.kd * (err - sim.prevError)) * (params.turnGain || 1), -MAX_OM, MAX_OM);
      sim.prevError = err; sim.lastError = err;
      const v = params.vMax * (pid.base / 100);
      sim.robot.th += om * dt; sim.robot.x += v * Math.cos(sim.robot.th) * dt; sim.robot.y += v * Math.sin(sim.robot.th) * dt;
      sim.robot.x = clamp(sim.robot.x, -A, A); sim.robot.y = clamp(sim.robot.y, -A, A);
      sim.lastStates = bright.map((b) => b >= (threshold || 0.22));
    } else {
      const states = bright.map((b) => b >= threshold);
      const cmd = evalRules(rules, defaultRule, states);
      stepDiff(sim.robot, cmd.mL, cmd.mR, params, dt);
      sim.lastStates = states; sim.lastCmd = cmd;
    }
    sim.t += dt; sim.lastBright = bright;

    const maxB = Math.max.apply(null, bright);
    sim.timeDark = maxB < DARK ? sim.timeDark + dt : 0;

    if (Math.round(sim.t * 60) % 3 === 0) { sim.trail.push([sim.robot.x, sim.robot.y]); if (sim.trail.length > 700) sim.trail.shift(); }

    const tg = targetLight(scene);
    const dTarget = Math.hypot(sim.robot.x - tg.x, sim.robot.y - tg.y);
    if (dTarget < CAPTURE) { sim.status = 'success'; sim.reason = 'reached'; }
    else if (sim.timeDark > LOST_GRACE) { sim.status = 'failed'; sim.reason = 'lost'; }
    else if (sim.t >= MATCH_TIME) { sim.status = 'failed'; sim.reason = 'timeout'; }
  }

  function coach(sim) {
    const t = [];
    if (sim.reason === 'lost') {
      t.push('Robot ışığı kaybedip karanlıkta kaldı. Kural modunda "ara" kuralı ekle; PID modunda taban hızı düşürüp Kp\'yi artır.');
    } else if (sim.reason === 'timeout') {
      t.push('Süre doldu, ışığa varamadı. PID modunda Kp\'yi artır (daha keskin dönsün) ya da ışık eşiğini düşür. Hızlı ışık için daha hızlı bir motor gerekir.');
    } else if (sim.status === 'success') {
      t.push('Işığı yakaladın! PID modunda Kp/Kd ile daha yumuşak ve hızlı takip ayarlayabilirsin.');
    }
    return t;
  }

  function runHeadless(cfg, dt) {
    dt = dt || 1 / 60; const sim = createSim(cfg); let g = 0;
    while (sim.status === 'running' && g < 2e5) { tickSim(sim, dt); g++; }
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(2) };
  }

  function starterSensors() {
    return [
      { id: 'f', role: 'front', label: 'ÖN', color: '#f59e0b', fwd: 0.75, right: 0 },
      { id: 'l', role: 'left', label: 'SOL', color: '#22c55e', fwd: 0.4, right: -0.55 },
      { id: 'r', role: 'right', label: 'SAĞ', color: '#38bdf8', fwd: 0.4, right: 0.55 },
    ];
  }
  function starterRules() {
    return [
      { pattern: ['any', 'on', 'off'], left: { dir: 'fwd', speed: 30 }, right: { dir: 'fwd', speed: 85 } },
      { pattern: ['any', 'off', 'on'], left: { dir: 'fwd', speed: 85 }, right: { dir: 'fwd', speed: 30 } },
      { pattern: ['on', 'any', 'any'], left: { dir: 'fwd', speed: 75 }, right: { dir: 'fwd', speed: 75 } },
    ];
  }
  function starterDefault() { return { left: { dir: 'fwd', speed: 55 }, right: { dir: 'rev', speed: 25 } }; }
  function starterPID() { return { kp: 2.6, kd: 0.8, base: 70 }; }
  function defaultParams() { return { vMax: 3.2, wheelBase: 1.1, turnGain: 1.0 }; }
  function defaultThreshold() { return 0.22; }

  const API = {
    A, K, CAPTURE, DARK, MATCH_TIME, SCENES, buildScene,
    motorFraction, ruleMatches, evalRules, localToWorld, sensorBrightness, readBrightness, readSensors, brightByRole,
    stepDiff, moveLights, makeRobot, createSim, targetLight, tickSim, coach, runHeadless,
    starterSensors, starterRules, starterDefault, starterPID, defaultParams, defaultThreshold,
  };
  global.LightCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
