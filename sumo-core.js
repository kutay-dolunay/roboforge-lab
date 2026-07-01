/* =============================================================================
 * RoboForge — Mini Sumo :: Simulation Core
 * -----------------------------------------------------------------------------
 * Pure, dependency-free. Runs in browser (window.SumoCore) and Node.
 *
 * A round ring (dohyo). The player robot must shove the opponent out while
 * staying in itself. Player = block-rule controlled over 4 sensors:
 *   [DÜŞMAN(ön), SOL, SAĞ, KENAR]  (opponent-front, opp-left, opp-right, edge).
 * Opponent = a simple search-and-shove AI (3 difficulties). Motor spec ->
 * push power & speed (continuity); wheel spec -> turn agility.
 *
 * World: origin = ring center. +x right, +y up. th = heading.
 * ========================================================================== */
(function (global) {
  'use strict';

  const R = 6.0;            // ring radius
  const RR = 0.72;          // robot collision radius
  const EDGE_BAND = 0.9;    // white border width (edge sensors fire here)
  const DETECT = 4.6;       // opponent detection range
  const PUSH = 4.0;         // shove strength
  const PIN = 0.2;          // how much a robot loses steering while being shoved
  const MATCH_TIME = 20;    // seconds -> draw if nobody out
  const MAX_OM = 3.4;

  const OPPONENTS = [
    { id: 'novice', name: 'Acemi', difficulty: 'Kolay', blurb: 'Yavaş ve temkinli. İyi bir ilk rakip.',
      aggr: 0.55, steer: 1.6, speed: 2.2, edgeMargin: 1.4, retreat: true, wander: 0.35 },
    { id: 'balanced', name: 'Dengeli', difficulty: 'Orta', blurb: 'Dengeli hız ve saldırı. Ciddi bir rakip.',
      aggr: 0.8, steer: 2.2, speed: 2.9, edgeMargin: 1.1, retreat: true, wander: 0.12 },
    { id: 'champ', name: 'Şampiyon', difficulty: 'Zor', blurb: 'Hızlı, agresif ve kenarı iyi tanır. İyi bir robot ister.',
      aggr: 1.0, steer: 2.8, speed: 3.6, edgeMargin: 0.9, retreat: true, wander: 0.03 },
  ];

  function norm(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

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

  // ---- player sensors (role based) ----
  // roles: opp_front, opp_left, opp_right, edge
  function readSensors(player, opp, sensors) {
    const dx = opp.x - player.x, dy = opp.y - player.y;
    const dist = Math.hypot(dx, dy);
    const rel = norm(Math.atan2(dy, dx) - player.th);
    const inRange = dist < DETECT;
    return sensors.map((s) => {
      if (s.role === 'edge') { const [wx, wy] = localToWorld(player, s.fwd, s.right); return Math.hypot(wx, wy) > R - EDGE_BAND; }
      if (s.role === 'opp_front') return inRange && Math.abs(rel) < 0.5;
      if (s.role === 'opp_left') return inRange && rel > 0.22 && rel < 1.5;
      if (s.role === 'opp_right') return inRange && rel < -0.22 && rel > -1.5;
      if (s.role === 'opp_any') return inRange;
      return false;
    });
  }

  function stepDiff(rb, mL, mR, params, dt) {
    const vMax = params.vMax;
    const v = (mL * vMax + mR * vMax) / 2;
    const om = clamp(((mR - mL) * vMax / params.wheelBase) * (params.turnGain || 1), -MAX_OM, MAX_OM);
    rb.th += om * dt; rb.x += v * Math.cos(rb.th) * dt; rb.y += v * Math.sin(rb.th) * dt;
    rb.v = v;
    return v;
  }

  function oppAI(opp, player, o, dt, contact) {
    const distC = Math.hypot(opp.x, opp.y);
    let targetAng, drive;
    if (distC > R - o.edgeMargin) {                 // near own edge -> turn inward
      targetAng = Math.atan2(-opp.y, -opp.x);
      drive = 0.25;
    } else {
      targetAng = Math.atan2(player.y - opp.y, player.x - opp.x) + (Math.random() - 0.5) * o.wander;
      drive = o.aggr;
    }
    let steer = o.steer; if (contact) steer *= PIN;      // being shoved -> can't freely turn away
    const dh = norm(targetAng - opp.th);
    const om = clamp(dh * steer, -MAX_OM, MAX_OM);
    opp.th += om * dt;
    const v = drive * o.speed;
    opp.x += v * Math.cos(opp.th) * dt; opp.y += v * Math.sin(opp.th) * dt; opp.v = v;
  }

  // Decisive shove: the aggressor (higher forward speed into the contact) drives
  // the defender back ALONG THE AGGRESSOR'S HEADING (toward the far edge).
  function collide(player, opp, dt) {
    const dx = opp.x - player.x, dy = opp.y - player.y; let dist = Math.hypot(dx, dy);
    if (dist >= RR * 2 || dist < 1e-4) return false;
    const nx = dx / dist, ny = dy / dist;
    const overlap = RR * 2 - dist;
    player.x -= nx * overlap / 2; player.y -= ny * overlap / 2;
    opp.x += nx * overlap / 2; opp.y += ny * overlap / 2;
    const pF = [Math.cos(player.th), Math.sin(player.th)], oF = [Math.cos(opp.th), Math.sin(opp.th)];
    const pAgg = Math.max(0, player.v || 0) * Math.max(0, pF[0] * nx + pF[1] * ny);
    const oAgg = Math.max(0, opp.v || 0) * Math.max(0, oF[0] * (-nx) + oF[1] * (-ny));
    const net = pAgg - oAgg;
    if (net > 0) { opp.x += pF[0] * net * PUSH * dt; opp.y += pF[1] * net * PUSH * dt;
      player.x += pF[0] * net * PUSH * dt * 0.3; player.y += pF[1] * net * PUSH * dt * 0.3; }
    else if (net < 0) { player.x += oF[0] * (-net) * PUSH * dt; player.y += oF[1] * (-net) * PUSH * dt;
      opp.x += oF[0] * (-net) * PUSH * dt * 0.3; opp.y += oF[1] * (-net) * PUSH * dt * 0.3; }
    return true;
  }

  function makePlayer() { return { x: -R * 0.42, y: 0, th: 0, v: 0 }; }
  function makeOpp() { return { x: R * 0.42, y: 0, th: Math.PI, v: 0 }; }

  function createSim(cfg) {
    return { cfg, player: makePlayer(), opp: makeOpp(), t: 0, status: 'running', reason: null,
      contact: false, lastStates: null, ptrail: [], otrail: [] };
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return;
    const { sensors, rules, defaultRule, params, opponent } = sim.cfg;
    const states = readSensors(sim.player, sim.opp, sensors);
    const cmd = evalRules(rules, defaultRule, states);
    stepDiff(sim.player, cmd.mL, cmd.mR, params, dt);
    oppAI(sim.opp, sim.player, opponent, dt, sim.contact);
    sim.contact = collide(sim.player, sim.opp, dt);
    sim.t += dt; sim.lastStates = states; sim.lastCmd = cmd;

    if (Math.round(sim.t * 60) % 3 === 0) {
      sim.ptrail.push([sim.player.x, sim.player.y]); sim.otrail.push([sim.opp.x, sim.opp.y]);
      if (sim.ptrail.length > 500) { sim.ptrail.shift(); sim.otrail.shift(); }
    }

    const pOut = Math.hypot(sim.player.x, sim.player.y) > R;
    const oOut = Math.hypot(sim.opp.x, sim.opp.y) > R;
    if (pOut && oOut) { sim.status = 'failed'; sim.reason = 'double'; }
    else if (oOut) { sim.status = 'success'; sim.reason = 'push_out'; }
    else if (pOut) { sim.status = 'failed'; sim.reason = 'fell_out'; }
    else if (sim.t >= MATCH_TIME) { sim.status = 'failed'; sim.reason = 'timeout'; }
  }

  function coach(sim) {
    const t = [];
    if (sim.reason === 'fell_out') {
      t.push('Robotun ringden düştü. KENAR sensörü beyaz çizgiyi görünce hemen geri gelip dönmesini sağla — bu kuralı en üste koy.');
    } else if (sim.reason === 'timeout') {
      t.push('Süre doldu, kimse çıkmadı. Rakibi bulunca daha kararlı saldır (iki motor tam ileri) ve onu kenara doğru it.');
    } else if (sim.reason === 'double') {
      t.push('İkiniz de çıktınız. Saldırırken kendi kenarına dikkat et — hız yüksekse fren mesafen de artar.');
    } else if (sim.status === 'success') {
      t.push('Rakibi dışarı attın! Daha hızlı bir motorla ilk vuruşu sen yaparsan şampiyona karşı da şansın artar.');
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
      { id: 'd', role: 'opp_front', label: 'DÜŞMAN', color: '#ef4444', fwd: 0.85, right: 0 },
      { id: 'l', role: 'opp_left', label: 'SOL', color: '#22c55e', fwd: 0.55, right: -0.55 },
      { id: 'r', role: 'opp_right', label: 'SAĞ', color: '#f59e0b', fwd: 0.55, right: 0.55 },
      { id: 'e', role: 'edge', label: 'KENAR', color: '#38bdf8', fwd: 0.8, right: 0 },
    ];
  }
  // order = [DÜŞMAN, SOL, SAĞ, KENAR]. Enemy ahead -> push THROUGH (even at edge);
  // edge-avoidance only kicks in when there is no enemy to shove.
  function starterRules() {
    return [
      { pattern: ['on', 'any', 'any', 'any'], left: { dir: 'fwd', speed: 100 }, right: { dir: 'fwd', speed: 100 } }, // enemy ahead -> charge through
      { pattern: ['off', 'any', 'any', 'on'], left: { dir: 'rev', speed: 85 }, right: { dir: 'rev', speed: 55 } },   // edge & no enemy -> back off + veer
      { pattern: ['off', 'on', 'any', 'off'], left: { dir: 'fwd', speed: 40 }, right: { dir: 'fwd', speed: 95 } },    // enemy left -> veer left
      { pattern: ['off', 'any', 'on', 'off'], left: { dir: 'fwd', speed: 95 }, right: { dir: 'fwd', speed: 40 } },    // enemy right -> veer right
    ];
  }
  function starterDefault() { return { left: { dir: 'fwd', speed: 60 }, right: { dir: 'rev', speed: 20 } }; } // no enemy -> search-spin
  function defaultParams() { return { vMax: 3.4, wheelBase: 1.1, turnGain: 1.0 }; }

  const API = {
    R, RR, EDGE_BAND, DETECT, MATCH_TIME, OPPONENTS,
    motorFraction, ruleMatches, evalRules, readSensors, localToWorld,
    stepDiff, oppAI, collide, makePlayer, makeOpp, createSim, tickSim, coach, runHeadless,
    starterSensors, starterRules, starterDefault, defaultParams,
  };
  global.SumoCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
