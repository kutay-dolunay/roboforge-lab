/* =============================================================================
 * RoboForge — Işık Takibi (Light Follower) :: Simulation Core
 * -----------------------------------------------------------------------------
 * Pure, dependency-free. Runs in browser (window.LightCore) and Node.
 *
 * Phototaxis: the robot chases a light with directional LDR sensors. Each
 * sensor reads a brightness (0..1) from the light sources; a tunable THRESHOLD
 * ("Işık Eşiği") turns that into a bright/dark boolean the block-rules use.
 * Motor spec -> speed (continuity); wheel spec -> turn agility.
 *
 * World: origin = arena center. +x right, +y up. th = heading. Bounded box.
 * ========================================================================== */
(function (global) {
  'use strict';

  const A = 10.0;          // arena half-size (box is 2A x 2A)
  const K = 8.0;           // distance falloff scale for brightness
  const CAPTURE = 1.0;     // reach the target light within this radius -> win
  const LOST_GRACE = 4.5;  // seconds in near-darkness -> lost
  const DARK = 0.035;      // "everything is dark" brightness level
  const MATCH_TIME = 30;   // seconds -> timeout
  const MAX_OM = 3.4;

  // sensor facing offsets (radians, relative to heading)
  const OFFSET = { front: 0, left: 0.62, right: -0.62 };

  const SCENES = [
    { id: 'beacon', name: 'Fener', difficulty: 'Kolay',
      blurb: 'Tek, sabit bir ışık. Ona doğru sür ve yakala.',
      start: [0, -8, Math.PI / 2], lights: [{ x: 0, y: 7.5, power: 1.0 }], target: 0 },
    { id: 'roam', name: 'Gezen Işık', difficulty: 'Orta',
      blurb: 'Işık yavaşça gezinir. Onu kovala ve yakala.',
      start: [-7, -7, Math.PI / 2], lights: [{ x: 0, y: 5, power: 1.1, move: { ax: 5.5, ay: 1.2, sx: 0.32, sy: 0.5 } }], target: 0 },
    { id: 'two', name: 'İki Fener', difficulty: 'Zor',
      blurb: 'İki ışık var — parlak olana git, sönük olan tuzak.',
      start: [0, -8, Math.PI / 2], lights: [{ x: 5.5, y: 6.5, power: 1.25 }, { x: -6, y: 3, power: 0.55 }], target: 0 },
  ];

  function norm(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function buildScene(def) {
    const lights = def.lights.map((l) => ({ x: l.x, y: l.y, x0: l.x, y0: l.y, power: l.power, move: l.move || null }));
    return { meta: def, lights, target: def.target || 0, start: def.start.slice() };
  }

  // ---- rule engine (shared shape) ----
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

  // brightness a sensor sees (0..1-ish): distance falloff * directional lobe
  function sensorBrightness(rb, sensor, lights) {
    const [sx, sy] = localToWorld(rb, sensor.fwd, sensor.right);
    const facing = rb.th + (OFFSET[sensor.role] || 0);
    let inten = 0;
    for (const L of lights) {
      const dx = L.x - sx, dy = L.y - sy; const d = Math.hypot(dx, dy);
      const dAng = norm(Math.atan2(dy, dx) - facing);
      const c = Math.max(0, Math.cos(dAng));
      const lobe = 0.14 + 0.86 * c * c;   // narrow forward lobe -> sharp left/right discrimination
      inten += L.power * lobe / (1 + (d / K) * (d / K));
    }
    return inten;
  }
  function readBrightness(rb, sensors, lights) { return sensors.map((s) => sensorBrightness(rb, s, lights)); }
  function readSensors(rb, sensors, lights, threshold) {
    return readBrightness(rb, sensors, lights).map((b) => b >= threshold);
  }

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
      timeDark: 0, lastStates: null, lastBright: null, trail: [] };
  }

  function targetLight(scene) { return scene.lights[scene.target] || scene.lights[0]; }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return;
    const { scene, sensors, rules, defaultRule, params, threshold } = sim.cfg;
    moveLights(scene, sim.t);
    const bright = readBrightness(sim.robot, sensors, scene.lights);
    const states = bright.map((b) => b >= threshold);
    const cmd = evalRules(rules, defaultRule, states);
    stepDiff(sim.robot, cmd.mL, cmd.mR, params, dt);
    sim.t += dt; sim.lastStates = states; sim.lastBright = bright; sim.lastCmd = cmd;

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
      t.push('Robot ışığı kaybedip karanlıkta kaldı. Hiçbir sensör ışık görmediğinde "ara" (yerinde dön) kuralını ekle ki ışığı yeniden bulsun.');
    } else if (sim.reason === 'timeout') {
      t.push('Süre doldu, ışığa varamadı. Işık eşiğini düşürmeyi (daha uzaktan görsün) ya da ön sensör ışığı görünce tam ileri gitmeyi dene.');
    } else if (sim.status === 'success') {
      t.push('Işığı yakaladın! Işık eşiğini ve dönüş hızını ayarlayarak daha hızlı varmayı dene.');
    }
    if (sim.cfg.scene.lights.length > 1 && sim.reason === 'timeout') {
      t.push('İki ışık varken sönük olana takılmış olabilirsin. Eşiği yükseltirsen robot sadece en parlak ışığa yönelir.');
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
  // order = [ÖN, SOL, SAĞ]; on = bright (light seen). Steer toward the brighter side first.
  function starterRules() {
    return [
      { pattern: ['any', 'on', 'off'], left: { dir: 'fwd', speed: 30 }, right: { dir: 'fwd', speed: 85 } },  // light to the left -> veer left
      { pattern: ['any', 'off', 'on'], left: { dir: 'fwd', speed: 85 }, right: { dir: 'fwd', speed: 30 } },  // light to the right -> veer right
      { pattern: ['on', 'any', 'any'], left: { dir: 'fwd', speed: 75 }, right: { dir: 'fwd', speed: 75 } },  // light dead ahead -> go straight
    ];
  }
  function starterDefault() { return { left: { dir: 'fwd', speed: 55 }, right: { dir: 'rev', speed: 25 } }; } // dark -> search-spin
  function defaultParams() { return { vMax: 3.2, wheelBase: 1.1, turnGain: 1.0 }; }
  function defaultThreshold() { return 0.22; }

  const API = {
    A, K, CAPTURE, DARK, MATCH_TIME, SCENES, buildScene,
    motorFraction, ruleMatches, evalRules, localToWorld, sensorBrightness, readBrightness, readSensors,
    stepDiff, moveLights, makeRobot, createSim, targetLight, tickSim, coach, runHeadless,
    starterSensors, starterRules, starterDefault, defaultParams, defaultThreshold,
  };
  global.LightCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
