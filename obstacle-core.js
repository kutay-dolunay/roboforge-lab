/* =============================================================================
 * RoboForge — Engelden Kaçış (Obstacle Avoidance) :: Simulation Core
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
 *     Mesafe") — this is the speed↔safety balance the scenario is about.
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

  const OFFSET = { front: 0, left: 0.5, right: -0.5 };

  const SCENES = [
    { id: 'wide', name: 'Geçitler', difficulty: 'Kolay',
      blurb: 'Geniş aralıklı engeller. Yolunu bul, yukarı çık.',
      obstacles: [ [-2.6,-6,1.9], [2.6,-1,1.9], [-2.6,4,1.9], [2.6,8.5,1.9] ] },
    { id: 'tight', name: 'Sık Geçit', difficulty: 'Orta',
      blurb: 'Daha sık engeller. Hız ve güvenlik dengesi burada önemli.',
      obstacles: [ [-2.9,-7,2.0], [2.9,-3,2.0], [-2.9,1,2.0], [2.9,5,2.0], [-2.7,8.7,1.9], [3.0,-9.5,1.2] ] },
    { id: 'zigzag', name: 'Dar Zikzak', difficulty: 'Zor',
      blurb: 'Dar zikzak. Çevik ol ve fazla hızlanma, yoksa çarparsın.',
      obstacles: [ [-3.1,-7.5,2.2], [3.1,-4,2.2], [-3.1,-0.5,2.2], [3.1,3,2.2], [-3.1,6.5,2.2], [3.0,9.7,2.0] ] },
  ];

  function norm(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

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
      lastDists: null, lastV: 0, lastSteer: 0, trail: [] };
  }

  // roles are fixed front/left/right; index by role for the controller
  function distByRole(sensors, dists, role) {
    for (let i = 0; i < sensors.length; i++) if (sensors[i].role === role) return dists[i];
    return RANGE;
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return;
    const { scene, sensors, ctrl, params } = sim.cfg;
    const dists = readDists(sim.robot, sensors, scene.obstacles);
    const fD = distByRole(sensors, dists, 'front');
    const lD = distByRole(sensors, dists, 'left');
    const rD = distByRole(sensors, dists, 'right');

    let steer = ctrl.avoid * ((lD - rD) / RANGE) + ctrl.goal * norm(Math.PI / 2 - sim.robot.th);
    if (fD < ctrl.safe) steer += (rD >= lD ? -1 : 1) * PANIC * (1 - fD / ctrl.safe);
    const v = params.vMax * clamp(fD / ctrl.safe, MINV, 1) * BASE;
    const om = clamp(steer * (params.turnGain || 1), -MAX_OM, MAX_OM);

    sim.robot.th += om * dt;
    sim.robot.x += v * Math.cos(sim.robot.th) * dt;
    sim.robot.y += v * Math.sin(sim.robot.th) * dt;
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
    if (sim.reason === 'crash') {
      t.push('Robot bir engele çarptı. "Güvenli Mesafe"yi artır (daha erken yavaşlayıp kaçınır) ya da hızını düşür — hız-güvenlik dengesi tam da bu.');
      t.push('Hızlı ama hantal bir robot dar yerde dönemez; daha çevik tekerlek ya da daha düşük hız dene.');
    } else if (sim.reason === 'timeout') {
      t.push('Süre doldu. "Hedef Çekimi" çok düşükse robot yukarı ilerlemez; biraz artır. "Kaçınma Gücü" çok yüksekse yerinde savrulur, biraz azalt.');
    } else if (sim.status === 'success') {
      t.push('Hedefe vardın! Daha hızlı bir motorla süreyi kısaltmayı dene — ama çarpmadan.');
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
  function defaultParams() { return { vMax: 3.2, wheelBase: 1.1, turnGain: 1.15 }; }

  const API = {
    W, YB, GOAL_Y, RR, RANGE, MATCH_TIME, SCENES, buildScene,
    localToWorld, rayDist, readDists, hitsObstacle, makeRobot, createSim, tickSim, coach, runHeadless,
    distByRole, starterSensors, starterCtrl, defaultParams,
  };
  global.ObstacleCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
