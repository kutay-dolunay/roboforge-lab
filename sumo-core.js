/* =============================================================================
 * RoboForge - Mini Sumo :: Simulation Core
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

  // 7-level ladder: Başlangıç ×2, Orta ×2, İleri ×2, Uzman ×1
  const OPPONENTS = [
    { id: 'novice', name: 'Acemi', difficulty: 'Başlangıç', blurb: 'Yavaş ve temkinli. İyi bir ilk rakip.',
      aggr: 0.5, steer: 1.4, speed: 2.0, edgeMargin: 1.5, retreat: true, wander: 0.4 },
    { id: 'rookie', name: 'Çaylak', difficulty: 'Başlangıç', blurb: 'Biraz daha atak ama hâlâ acemi.',
      aggr: 0.62, steer: 1.7, speed: 2.3, edgeMargin: 1.4, retreat: true, wander: 0.28 },
    { id: 'balanced', name: 'Dengeli', difficulty: 'Orta', blurb: 'Dengeli hız ve saldırı. Ciddi bir rakip.',
      aggr: 0.75, steer: 2.1, speed: 2.8, edgeMargin: 1.2, retreat: true, wander: 0.15 },
    { id: 'bold', name: 'Atılgan', difficulty: 'Orta', blurb: 'Cesur ve hızlı saldırır. Savunmanı test eder.',
      aggr: 0.85, steer: 2.3, speed: 3.1, edgeMargin: 1.1, retreat: true, wander: 0.1 },
    { id: 'master', name: 'Usta', difficulty: 'İleri', blurb: 'Hızlı, isabetli ve kenarı iyi tanır. İyi bir robot ister.',
      aggr: 0.93, steer: 2.6, speed: 3.5, edgeMargin: 1.0, retreat: true, wander: 0.05 },
    { id: 'gladiator', name: 'Gladyatör', difficulty: 'İleri', blurb: 'Amansız bir saldırgan. Güçlü motor şart.',
      aggr: 1.0, steer: 2.8, speed: 3.8, edgeMargin: 0.95, retreat: true, wander: 0.03 },
    { id: 'champ', name: 'Şampiyon', difficulty: 'Uzman', blurb: 'En hızlı, en agresif. Ancak en güçlü robotla yenilir.',
      aggr: 1.0, steer: 3.1, speed: 4.3, edgeMargin: 0.85, retreat: true, wander: 0.01 },
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
      contact: false, lastStates: null, prevError: 0, lastError: 0, ptrail: [], otrail: [] };
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return;
    const { sensors, rules, defaultRule, params, opponent, mode, pid } = sim.cfg;
    if (mode === 'pid') {
      // PID: aim at the opponent and charge; back off the edge (safety reflex)
      const p = sim.player, o = sim.opp;
      const rel = norm(Math.atan2(o.y - p.y, o.x - p.x) - p.th);
      const [fx, fy] = localToWorld(p, 0.8, 0);
      const edge = Math.hypot(fx, fy) > R - EDGE_BAND;
      let om, v;
      if (edge) { const inward = Math.atan2(-p.y, -p.x); om = clamp(norm(inward - p.th) * 3, -MAX_OM, MAX_OM); v = -0.5 * params.vMax; }
      else { om = clamp((pid.kp || 0) * rel + (pid.kd || 0) * (rel - sim.prevError), -MAX_OM, MAX_OM); sim.prevError = rel; v = ((pid.base || 100) / 100) * params.vMax; }
      p.th += om * dt; p.x += v * Math.cos(p.th) * dt; p.y += v * Math.sin(p.th) * dt; p.v = v;
      sim.lastError = rel; sim.lastStates = readSensors(p, o, sensors);
    } else {
      const states = readSensors(sim.player, sim.opp, sensors);
      const cmd = evalRules(rules, defaultRule, states);
      stepDiff(sim.player, cmd.mL, cmd.mR, params, dt);
      sim.lastStates = states; sim.lastCmd = cmd;
    }
    oppAI(sim.opp, sim.player, opponent, dt, sim.contact);
    sim.contact = collide(sim.player, sim.opp, dt);
    sim.t += dt;

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
      t.push('Robotun ringden düştü. KENAR sensörü beyaz çizgiyi görünce hemen geri gelip dönmesini sağla - bu kuralı en üste koy.');
    } else if (sim.reason === 'timeout') {
      t.push('Süre doldu, kimse çıkmadı. Rakibi bulunca daha kararlı saldır (iki motor tam ileri) ve onu kenara doğru it.');
    } else if (sim.reason === 'double') {
      t.push('İkiniz de çıktınız. Saldırırken kendi kenarına dikkat et - hız yüksekse fren mesafen de artar.');
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
  function starterPID() { return { kp: 2.4, kd: 0.5, base: 100 }; } // aim at opponent + charge
  function defaultParams() { return { vMax: 3.4, wheelBase: 1.1, turnGain: 1.0 }; }

  const API = {
    R, RR, EDGE_BAND, DETECT, MATCH_TIME, OPPONENTS,
    motorFraction, ruleMatches, evalRules, readSensors, localToWorld,
    stepDiff, oppAI, collide, makePlayer, makeOpp, createSim, tickSim, coach, runHeadless,
    starterSensors, starterRules, starterDefault, starterPID, defaultParams,
  };
  global.SumoCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
