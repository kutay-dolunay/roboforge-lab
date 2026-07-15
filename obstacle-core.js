/* =============================================================================
 * RoboForge - Engelden Kaçış (Obstacle Avoidance) :: Simulation Core
 * -----------------------------------------------------------------------------
 * Pure, dependency-free. Runs in browser (window.ObstacleCore) and Node.
 *
 * The robot must cross a bounded field from bottom to the GOAL band at the top
 * without hitting the round obstacles. Three forward distance sensors
 * (front / left / right) raycast to the nearest obstacle or wall. Control is an
 * ANALOG avoidance controller (a Braitenberg "avoider"):
 *   - steer toward the more-open side  (avoid, "Kaçınma Gücü")
 *   - steer toward the goal / up        (goal, "Hedef Çekimi")
 *   - slow down + swerve hard when something is close within "safe" ("Güvenli
 *     Mesafe") - this is the speed↔safety balance the scenario is about.
 * Motor spec -> vMax (speed), wheel spec -> turnGain (agility)  => a fast but
 * sluggish robot clips corners; a balanced one weaves through.
 *
 * World: origin = field center. +x right, +y up. Goal band at y > GOAL_Y.
 * ========================================================================== */
(function (global) {
  'use strict';

  const W = 6.0;           // half width (walls at x = ±W)
  const YB = -11.5;        // start / bottom
  const GOAL_Y = 10.5;     // reach y > GOAL_Y to win
  const RR = 0.5;          // robot radius
  const RANGE = 5.0;       // max sensor range
  const MATCH_TIME = 30;   // seconds -> timeout
  const MAX_OM = 3.8;
  const PANIC = 4.0;       // extra swerve when very close
  const MINV = 0.2;        // never fully stop while a path exists
  const BASE = 0.9;        // cruise fraction of vMax
  const DIG_DETECT = 2.6;  // Kural (digital) mode: obstacle "near" threshold

  const OFFSET = { front: 0, left: 0.5, right: -0.5 };

  // 7-level ladder: Başlangıç ×2, Orta ×2, İleri ×2, Uzman ×1 (alternating gates, tightening)
  const SCENES = [
    { id: 'open', name: 'Açık Yol', difficulty: 'Başlangıç',
      blurb: 'Geniş aralıklı engeller. Rahatça dolaş.',
      obstacles: [ [-2.9,-6,1.5], [2.9,-1,1.5], [-2.9,4,1.5], [2.9,8.5,1.5] ] },
    { id: 'gates', name: 'Geçitler', difficulty: 'Başlangıç',
      blurb: 'Sırayla açılan geçitler. Yönünü koru.',
      obstacles: [ [-2.8,-6.5,1.6], [2.8,-2.5,1.6], [-2.8,1.5,1.6], [2.8,5.5,1.6], [-2.8,9,1.5] ] },
    { id: 'dense', name: 'Sık Geçit', difficulty: 'Orta',
      blurb: 'Daha sık engeller. Hız-güvenlik dengesi önemli.',
      obstacles: [ [-2.75,-7,1.7], [2.75,-3.3,1.7], [-2.75,0.4,1.7], [2.75,4.1,1.7], [-2.75,7,1.7], [2.6,9.5,1.6] ] },
    { id: 'slide', name: 'Kaydırma', difficulty: 'Orta',
      blurb: 'Biraz daha dar. Erken kararlar ver.',
      obstacles: [ [-2.7,-7,1.8], [2.7,-3.4,1.8], [-2.7,0.2,1.8], [2.7,3.8,1.8], [-2.7,7,1.8], [2.6,9.5,1.7] ] },
    { id: 'zigzag', name: 'Dar Zikzak', difficulty: 'İleri',
      blurb: 'Dar zikzak. Çevik ol, fazla hızlanma.',
      obstacles: [ [-2.65,-7.2,1.9], [2.65,-3.7,1.9], [-2.65,-0.2,1.9], [2.65,3.3,1.9], [-2.65,6.8,1.9], [2.6,9.6,1.8] ] },
    { id: 'tight', name: 'Sık Zikzak', difficulty: 'İleri',
      blurb: 'Sıkışık zikzak. İnce ayar ister.',
      obstacles: [ [-2.6,-7.4,2.0], [2.6,-4,2.0], [-2.6,-0.6,2.0], [2.6,2.8,2.0], [-2.6,6.2,2.0], [2.5,9.6,1.9] ] },
    { id: 'kabus', name: 'Kâbus', difficulty: 'Uzman',
      blurb: 'Çok dar, uzun bir geçit. Güçlü robot + ince PID ayarı şart.',
      obstacles: [ [-2.5,-7.8,2.1], [2.5,-4.8,2.1], [-2.5,-1.8,2.1], [2.5,1.2,2.1], [-2.5,4.2,2.1], [2.5,7.2,2.1], [-2.4,9.7,1.9] ] },
  ];

  function norm(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function angLerp(a, t, k) { return a + norm(t - a) * k; }

  // ---- block-rule engine (Kural mode) ----
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

  function buildScene(def) {
    return { meta: def, obstacles: def.obstacles.map((o) => ({ x: o[0], y: o[1], r: o[2] })),
      goal: { x: 0, y: GOAL_Y } };
  }

  function localToWorld(rb, fwd, right) {
    const c = Math.cos(rb.th), s = Math.sin(rb.th);
    return [rb.x + fwd * c + right * s, rb.y + fwd * s + right * (-c)];
  }

  function rayDist(ox, oy, dx, dy, obstacles) {
    let t = 0.05;
    while (t < RANGE) {
      const px = ox + dx * t, py = oy + dy * t;
      if (px < -W || px > W || py > GOAL_Y + 2) return t;
      for (let i = 0; i < obstacles.length; i++) { const o = obstacles[i];
        if ((px - o.x) * (px - o.x) + (py - o.y) * (py - o.y) < o.r * o.r) return t; }
      t += 0.1;
    }
    return RANGE;
  }
  function readDists(rb, sensors, obstacles) {
    return sensors.map((s) => { const facing = rb.th + (OFFSET[s.role] || 0);
      const [px, py] = localToWorld(rb, s.fwd, s.right);
      return rayDist(px, py, Math.cos(facing), Math.sin(facing), obstacles); });
  }

  function hitsObstacle(rb, obstacles) {
    for (let i = 0; i < obstacles.length; i++) { const o = obstacles[i];
      const dx = rb.x - o.x, dy = rb.y - o.y; if (dx * dx + dy * dy < (RR + o.r) * (RR + o.r)) return true; }
    return false;
  }

  function makeRobot() { return { x: 0, y: YB, th: Math.PI / 2 }; }

  function createSim(cfg) {
    return { cfg, robot: makeRobot(), t: 0, status: 'running', reason: null,
      lastDists: null, lastV: 0, lastSteer: 0, lastStates: null, trail: [] };
  }

  // roles are fixed front/left/right; index by role for the controller
  function distByRole(sensors, dists, role) {
    for (let i = 0; i < sensors.length; i++) if (sensors[i].role === role) return dists[i];
    return RANGE;
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return;
    const { scene, sensors, ctrl, params, mode, rules, defaultRule } = sim.cfg;
    const dists = readDists(sim.robot, sensors, scene.obstacles);
    const fD = distByRole(sensors, dists, 'front');
    const lD = distByRole(sensors, dists, 'left');
    const rD = distByRole(sensors, dists, 'right');
    let v, om;

    if (mode === 'rules') {
      const states = [fD < DIG_DETECT, lD < DIG_DETECT, rD < DIG_DETECT];
      const cmd = evalRules(rules, defaultRule, states);
      v = (cmd.mL * params.vMax + cmd.mR * params.vMax) / 2;
      om = clamp(((cmd.mR - cmd.mL) * params.vMax / params.wheelBase) * (params.turnGain || 1), -MAX_OM, MAX_OM);
      sim.robot.th += om * dt;
      sim.robot.x += v * Math.cos(sim.robot.th) * dt;
      sim.robot.y += v * Math.sin(sim.robot.th) * dt;
      if (!states[0] && !states[1] && !states[2] && v > 0.05) sim.robot.th = angLerp(sim.robot.th, Math.PI / 2, 0.05); // home toward goal when clear
      sim.lastStates = states;
    } else {
      let steer = ctrl.avoid * ((lD - rD) / RANGE) + ctrl.goal * norm(Math.PI / 2 - sim.robot.th);
      if (fD < ctrl.safe) steer += (rD >= lD ? -1 : 1) * PANIC * (1 - fD / ctrl.safe);
      v = params.vMax * clamp(fD / ctrl.safe, MINV, 1) * BASE;
      om = clamp(steer * (params.turnGain || 1), -MAX_OM, MAX_OM);
      sim.robot.th += om * dt;
      sim.robot.x += v * Math.cos(sim.robot.th) * dt;
      sim.robot.y += v * Math.sin(sim.robot.th) * dt;
      sim.lastStates = [fD < DIG_DETECT, lD < DIG_DETECT, rD < DIG_DETECT];
    }
    sim.robot.x = clamp(sim.robot.x, -W + RR, W - RR);
    sim.robot.y = Math.max(sim.robot.y, YB);

    sim.t += dt; sim.lastDists = dists; sim.lastV = v; sim.lastSteer = om;

    if (Math.round(sim.t * 60) % 3 === 0) { sim.trail.push([sim.robot.x, sim.robot.y]); if (sim.trail.length > 700) sim.trail.shift(); }

    if (hitsObstacle(sim.robot, scene.obstacles)) { sim.status = 'failed'; sim.reason = 'crash'; }
    else if (sim.robot.y > GOAL_Y) { sim.status = 'success'; sim.reason = 'reached'; }
    else if (sim.t >= MATCH_TIME) { sim.status = 'failed'; sim.reason = 'timeout'; }
  }

  function coach(sim) {
    const t = [];
    const rules = (sim.cfg.mode === 'rules');
    if (sim.reason === 'crash') {
      if (rules) {
        t.push('Robot bir engele sürdü. Kural (aç-kapa) kontrolü dar geçitlerde köşeyi sıyırır - bu yüzden gerçek robotlar orantılı (PID) kontrol kullanır. Dar pistlerde 📈 PID Modu\'na geç.');
      } else {
        t.push('Robot bir engele çarptı. "Güvenli Mesafe"yi artır (daha erken yavaşlar) ya da hızını düşür - hız-güvenlik dengesi tam da bu.');
        t.push('Hızlı ama hantal bir robot dar yerde dönemez; daha çevik tekerlek ya da daha düşük hız dene.');
      }
    } else if (sim.reason === 'timeout') {
      t.push(rules ? 'Süre doldu. Kural modu dar pistlerde takılır - 📈 PID Modu daha akıcıdır.'
        : 'Süre doldu. "Hedef Çekimi" çok düşükse robot yukarı ilerlemez; biraz artır. "Kaçınma Gücü" çok yüksekse yerinde savrulur, biraz azalt.');
    } else if (sim.status === 'success') {
      t.push('Hedefe vardın! Daha hızlı bir motorla süreyi kısaltmayı dene - ama çarpmadan.');
    }
    return t;
  }

  function runHeadless(cfg, dt) {
    dt = dt || 1 / 60; const sim = createSim(cfg); let g = 0;
    while (sim.status === 'running' && g < 2e5) { tickSim(sim, dt); g++; }
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(2), y: +sim.robot.y.toFixed(1) };
  }

  function starterSensors() {
    return [
      { id: 'f', role: 'front', label: 'ÖN', color: '#ef4444', fwd: 0.7, right: 0 },
      { id: 'l', role: 'left', label: 'SOL', color: '#22c55e', fwd: 0.5, right: -0.45 },
      { id: 'r', role: 'right', label: 'SAĞ', color: '#38bdf8', fwd: 0.5, right: 0.45 },
    ];
  }
  function starterCtrl() { return { avoid: 3.2, safe: 3.3, goal: 1.0 }; }
  // Kural mode: veer AWAY from the blocked side; hard turn if dead ahead
  function starterRules() {
    return [
      { pattern: ['any', 'on', 'off'], left: { dir: 'fwd', speed: 80 }, right: { dir: 'fwd', speed: 20 } }, // obstacle LEFT -> veer right
      { pattern: ['any', 'off', 'on'], left: { dir: 'fwd', speed: 20 }, right: { dir: 'fwd', speed: 80 } }, // obstacle RIGHT -> veer left
      { pattern: ['on', 'any', 'any'], left: { dir: 'fwd', speed: 75 }, right: { dir: 'rev', speed: 35 } }, // dead ahead -> hard right
      { pattern: ['off', 'any', 'any'], left: { dir: 'fwd', speed: 80 }, right: { dir: 'fwd', speed: 80 } },// clear -> go
    ];
  }
  function starterDefault() { return { left: { dir: 'rev', speed: 30 }, right: { dir: 'fwd', speed: 70 } }; }
  function defaultParams() { return { vMax: 3.2, wheelBase: 1.1, turnGain: 1.15 }; }

  const API = {
    W, YB, GOAL_Y, RR, RANGE, MATCH_TIME, DIG_DETECT, SCENES, buildScene,
    localToWorld, rayDist, readDists, hitsObstacle, makeRobot, createSim, tickSim, coach, runHeadless,
    distByRole, motorFraction, ruleMatches, evalRules,
    starterSensors, starterCtrl, starterRules, starterDefault, defaultParams,
  };
  global.ObstacleCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
