/* =============================================================================
 * RoboForge - Labirent Çözen (Maze Solver) :: Simulation Core
 * -----------------------------------------------------------------------------
 * Pure, dependency-free. Runs in browser (window.MazeCore) and Node
 * (module.exports).
 *
 * MODEL - discrete "scan → decide → step":
 *   The robot sits at a cell center, reads the walls around it (front / left /
 *   right, relative to its heading), the block-rules pick an action, and it
 *   glides one cell (optionally turning first). Deterministic and crisp - no
 *   analog oscillation. Motor spec -> drive/turn speed (continuity); wheel spec
 *   -> turn agility.
 *
 * World: cell (r,c) center = (c*CELL, -r*CELL). +x = right(east), +y = up(north).
 * grid[r][c]: 1 = wall, 0 = path.
 * ========================================================================== */
(function (global) {
  'use strict';

  const CELL = 2.4;
  const ROBOT_R = 0.42;
  const DRIVE_FRAC = 0.72;   // fraction of vMax used when crossing a cell
  const TURN_RATE = 4.6;     // rad/s base pivot speed (scaled by turnGain)
  const MAX_STEPS = 400;     // give-up guard (lost / looping)
  const LOOP_LIMIT = 6;      // same (cell,heading) revisits => lost
  // PID (wall-follower) mode constants
  const MAX_OM = 4.6;
  const MATCH_TIME = 80;     // pid-mode timeout (s)
  const WF_TARGET = 1.0;     // target distance from the LEFT wall
  const WF_FRONT = 1.7;      // front wall -> swerve right
  const WF_GAIN = 3.8;
  const WF_RANGE = 3.0;
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ---- direction helpers (grid deltas) ----------------------------------
  const DIRS = { E: [0, 1], S: [1, 0], W: [0, -1], N: [-1, 0] };
  function thOf(hd) { const [dr, dc] = hd; if (dc > 0) return 0; if (dc < 0) return Math.PI; if (dr > 0) return -Math.PI / 2; return Math.PI / 2; }
  function rotL(hd) { return [-hd[1], hd[0]]; }   // turn left  (CCW): E->N
  function rotR(hd) { return [hd[1], -hd[0]]; }   // turn right (CW):  E->S
  function rev(hd) { return [-hd[0], -hd[1]]; }
  function eqd(a, b) { return a[0] === b[0] && a[1] === b[1]; }

  // 7-level ladder: Başlangıç ×2, Orta ×2, İleri ×2, Uzman ×1
  const MAZES = [
    {
      id: 'snake', name: 'Kıvrım', difficulty: 'Başlangıç',
      blurb: 'Tek yollu, dört büklüm bir koridor. Isınma turu.',
      grid: [
        [1,1,1,1,1,1,1,1,1],
        [1,0,0,0,0,0,0,0,1],
        [1,1,1,1,1,1,1,0,1],
        [1,0,0,0,0,0,0,0,1],
        [1,0,1,1,1,1,1,1,1],
        [1,0,0,0,0,0,0,0,1],
        [1,1,1,1,1,1,1,0,1],
        [1,0,0,0,0,0,0,0,1],
        [1,1,1,1,1,1,1,1,1],
      ], start: [1,1], end: [7,1],
    },
    {
      id: 'corner', name: 'Köşeler', difficulty: 'Başlangıç',
      blurb: 'Tek bir büyük dönüş - sağdan aşağı, soldan geri.',
      grid: [
        [1,1,1,1,1,1,1,1,1],
        [1,0,0,0,0,0,0,0,1],
        [1,1,1,1,1,1,1,0,1],
        [1,1,1,1,1,1,1,0,1],
        [1,1,1,1,1,1,1,0,1],
        [1,1,1,1,1,1,1,0,1],
        [1,1,1,1,1,1,1,0,1],
        [1,0,0,0,0,0,0,0,1],
        [1,1,1,1,1,1,1,1,1],
      ], start: [1,1], end: [7,1],
    },
    {
      id: 'branch', name: 'Çatallı', difficulty: 'Orta',
      blurb: 'Çıkmaz sokaklar ve çatallar. Bir duvar takip kuralı ister.',
      grid: [
        [1,1,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,1,0,0,0,0,0,1],
        [1,1,1,0,1,0,1,1,1,0,1],
        [1,0,0,0,0,0,0,0,1,0,1],
        [1,0,1,1,1,1,1,0,1,0,1],
        [1,0,0,0,1,0,0,0,0,0,1],
        [1,1,1,0,1,0,1,1,1,1,1],
        [1,0,0,0,0,0,0,0,0,0,1],
        [1,0,1,1,1,1,1,1,1,0,1],
        [1,0,0,0,0,0,0,0,0,0,1],
        [1,1,1,1,1,1,1,1,1,1,1],
      ], start: [1,1], end: [9,9],
    },
    {
      id: 'rooms', name: 'Odalar', difficulty: 'Orta',
      blurb: 'Küçük odalar ve çatallar. Doğru dönüşü bulmak gerek.',
      grid: [
        [1,1,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,1,0,0,0,1,0,1],
        [1,0,1,0,1,0,1,0,1,0,1],
        [1,0,1,0,0,0,1,0,0,0,1],
        [1,0,1,1,1,1,1,1,1,0,1],
        [1,0,0,0,0,0,0,0,1,0,1],
        [1,1,1,1,1,1,1,0,1,0,1],
        [1,0,0,0,0,0,0,0,1,0,1],
        [1,0,1,1,1,1,1,1,1,0,1],
        [1,0,0,0,0,0,0,0,0,0,1],
        [1,1,1,1,1,1,1,1,1,1,1],
      ], start: [1,1], end: [9,1],
    },
    {
      id: 'spiral', name: 'Sarmal', difficulty: 'İleri',
      blurb: 'İçe doğru kıvrılan sarmal. Sabır ve iyi bir strateji gerekir.',
      grid: [
        [1,1,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,0,0,0,0,0,0,1],
        [1,0,1,1,1,1,1,1,1,0,1],
        [1,0,1,0,0,0,0,0,1,0,1],
        [1,0,1,0,1,1,1,0,1,0,1],
        [1,0,1,0,1,0,0,0,1,0,1],
        [1,0,1,0,1,1,1,1,1,0,1],
        [1,0,1,0,0,0,0,0,0,0,1],
        [1,0,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,0,0,0,0,0,0,1],
        [1,1,1,1,1,1,1,1,1,1,1],
      ], start: [1,1], end: [5,5],
    },
    {
      id: 'puzzle', name: 'Bulmaca', difficulty: 'İleri',
      blurb: 'Bol çatallı, çıkmazlı gerçek bir bulmaca.',
      grid: [
        [1,1,1,1,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,0,0,1,0,0,0,0,0,1],
        [1,1,1,0,1,0,1,0,1,1,1,0,1],
        [1,0,0,0,1,0,0,0,1,0,0,0,1],
        [1,0,1,1,1,1,1,1,1,0,1,1,1],
        [1,0,0,0,0,0,0,0,0,0,1,0,1],
        [1,1,1,0,1,1,1,0,1,1,1,0,1],
        [1,0,0,0,1,0,0,0,0,0,0,0,1],
        [1,0,1,1,1,0,1,1,1,1,1,0,1],
        [1,0,1,0,0,0,0,0,0,0,1,0,1],
        [1,0,1,0,1,1,1,1,1,0,1,0,1],
        [1,0,0,0,1,0,0,0,0,0,1,0,1],
        [1,1,1,1,1,1,1,1,1,1,1,1,1],
      ], start: [1,1], end: [11,11],
    },
    {
      id: 'kabus', name: 'Kâbus', difficulty: 'Uzman',
      blurb: 'Devasa, çıkmaz dolu labirent. Kusursuz bir duvar-takip stratejisi ister.',
      grid: [
        [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,1,0,0,0,0,0,1,0,0,0,1],
        [1,1,1,0,1,0,1,1,1,0,1,0,1,0,1],
        [1,0,0,0,0,0,1,0,0,0,0,0,1,0,1],
        [1,0,1,1,1,1,1,0,1,1,1,1,1,0,1],
        [1,0,0,0,1,0,0,0,0,0,0,0,1,0,1],
        [1,1,1,0,1,0,1,1,1,1,1,0,1,0,1],
        [1,0,0,0,0,0,1,0,0,0,1,0,0,0,1],
        [1,0,1,1,1,1,1,0,1,0,1,1,1,0,1],
        [1,0,1,0,0,0,0,0,1,0,0,0,1,0,1],
        [1,0,1,0,1,1,1,1,1,1,1,0,1,0,1],
        [1,0,0,0,1,0,0,0,0,0,1,0,1,0,1],
        [1,1,1,1,1,0,1,1,1,0,1,0,1,0,1],
        [1,0,0,0,0,0,1,0,0,0,1,0,0,0,1],
        [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
      ], start: [1,1], end: [13,13],
    },
  ];

  function buildMaze(def) {
    return { grid: def.grid, rows: def.grid.length, cols: def.grid[0].length,
      start: def.start.slice(), end: def.end.slice(), meta: def };
  }
  function cellWall(mz, r, c) { if (r < 0 || r >= mz.rows || c < 0 || c >= mz.cols) return true; return mz.grid[r][c] === 1; }
  function cellCenter(r, c) { return [c * CELL, -r * CELL]; }
  function isWallXY(mz, x, y) { return cellWall(mz, Math.round(-y / CELL), Math.round(x / CELL)); }
  function rayDist(mz, ox, oy, dx, dy, mxr) { let t = 0.06; const M = mxr || WF_RANGE;
    while (t < M) { if (isWallXY(mz, ox + dx * t, oy + dy * t)) return t; t += 0.06; } return M; }

  // ---- rule engine (shared shape with the line follower) ----------------
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
  // map a (left,right) motor command to a discrete maze action
  function actionOf(mL, mR) {
    if (Math.abs(mL) < 0.02 && Math.abs(mR) < 0.02) return 'stop';
    const spd = (mL + mR) / 2, diff = mR - mL;
    if (spd < -0.02 && Math.abs(diff) < 0.35) return 'back';   // both reverse -> turn around
    if (diff > 0.15) return 'left';                            // right wheel faster -> pivot left
    if (diff < -0.15) return 'right';                          // left wheel faster -> pivot right
    return 'forward';
  }

  // sensors read the wall in a direction relative to heading (role-based)
  function roleDir(role, hd) { if (role === 'left') return rotL(hd); if (role === 'right') return rotR(hd); if (role === 'back') return rev(hd); return hd; }
  function readStates(mz, cell, hd, sensors) {
    return sensors.map((s) => { const d = roleDir(s.role, hd); return cellWall(mz, cell[0] + d[0], cell[1] + d[1]); });
  }

  function makeRobot(mz) {
    const [r, c] = mz.start; let hd = DIRS.E;
    for (const k of ['E', 'S', 'N', 'W']) { const d = DIRS[k]; if (!cellWall(mz, r + d[0], c + d[1])) { hd = d; break; } }
    const [x, y] = cellCenter(r, c);
    return { x, y, th: thOf(hd), hd: hd.slice(), cell: [r, c] };
  }

  function createSim(cfg) {
    const robot = makeRobot(cfg.maze);
    return { cfg, robot, t: 0, status: 'running', reason: null, mode: 'scan',
      steps: 0, driveTarget: null, targetTh: 0, pendingHd: null, lastAction: null,
      lastStates: null, ruleIndex: -1, visits: {}, trail: [[robot.x, robot.y]], decisions: [],
      prevError: 0, lastError: 0, lastDists: null, lastV: 0 };
  }

  // ---- PID mode: continuous LEFT-wall follower --------------------------
  function tickPID(sim, dt) {
    const { maze, params, pid } = sim.cfg; const R = sim.robot;
    const c = Math.cos(R.th), s = Math.sin(R.th);
    const fD = rayDist(maze, R.x, R.y, c, s, WF_RANGE);
    const lD = rayDist(maze, R.x, R.y, -s, c, WF_RANGE);
    const rD = rayDist(maze, R.x, R.y, s, -c, WF_RANGE);
    const err = lD - WF_TARGET;
    let om = (pid.kp || 0) * err + (pid.kd || 0) * (err - sim.prevError);
    sim.prevError = err; sim.lastError = err;
    if (fD < WF_FRONT) om -= WF_GAIN * (WF_FRONT - fD);
    om = clamp(om, -MAX_OM, MAX_OM);
    let v = (params.vMax || 2.8) * ((pid.base || 100) / 100);
    if (fD < WF_FRONT) v *= clamp(fD / WF_FRONT, 0.25, 1);
    R.th += om * dt; R.x += v * Math.cos(R.th) * dt; R.y += v * Math.sin(R.th) * dt;
    sim.t += dt; sim.lastDists = [fD, lD, rD]; sim.lastV = v;
    sim.lastStates = [fD < 1.35, lD < 1.35, rD < 1.35];  // [front,left,right] wall-near (for HUD)
    R.cell = [Math.round(-R.y / CELL), Math.round(R.x / CELL)];
    if (Math.round(sim.t * 60) % 3 === 0) { sim.trail.push([R.x, R.y]); if (sim.trail.length > 900) sim.trail.shift(); }
    if (isWallXY(maze, R.x, R.y)) { sim.status = 'failed'; sim.reason = 'crash'; return; }
    if (R.cell[0] === maze.end[0] && R.cell[1] === maze.end[1]) { sim.status = 'success'; sim.reason = 'solved'; return; }
    if (sim.t >= MATCH_TIME) { sim.status = 'failed'; sim.reason = 'timeout'; }
  }

  function turnSpeed(params) { return TURN_RATE * (params.turnGain || 1); }
  function driveSpeed(params) { return (params.vMax || 2.6) * DRIVE_FRAC; }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return;
    if (sim.cfg.mode === 'pid') { tickPID(sim, dt); return; }
    const { maze, sensors, rules, defaultRule, params } = sim.cfg;
    const R = sim.robot;

    if (sim.mode === 'scan') {
      const states = readStates(maze, R.cell, R.hd, sensors);
      const cmd = evalRules(rules, defaultRule, states);
      const action = actionOf(cmd.mL, cmd.mR);
      sim.lastStates = states; sim.ruleIndex = cmd.ruleIndex; sim.lastAction = action;
      sim.decisions.push({ cell: R.cell.slice(), states, action });

      if (action === 'stop') { sim.status = 'failed'; sim.reason = 'stalled'; return; }
      // loop / give-up guards
      const key = R.cell[0] + ',' + R.cell[1] + '|' + R.hd[0] + ',' + R.hd[1] + '|' + action;
      sim.visits[key] = (sim.visits[key] || 0) + 1;
      if (sim.visits[key] > LOOP_LIMIT || sim.steps > MAX_STEPS) { sim.status = 'failed'; sim.reason = 'lost'; return; }

      const nd = action === 'forward' ? R.hd : action === 'left' ? rotL(R.hd) : action === 'right' ? rotR(R.hd) : rev(R.hd);
      sim.pendingHd = nd; sim.targetTh = thOf(nd);
      sim.mode = eqd(nd, R.hd) ? 'drive' : 'turn';
      if (sim.mode === 'drive') { const [tx, ty] = cellCenter(R.cell[0] + nd[0], R.cell[1] + nd[1]); sim.driveTarget = [tx, ty]; }
      return;
    }

    if (sim.mode === 'turn') {
      let d = sim.targetTh - R.th; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      const step = turnSpeed(params) * dt;
      if (Math.abs(d) <= step) { R.th = sim.targetTh; R.hd = sim.pendingHd.slice(); sim.mode = 'drive';
        const [tx, ty] = cellCenter(R.cell[0] + R.hd[0], R.cell[1] + R.hd[1]); sim.driveTarget = [tx, ty]; }
      else { R.th += Math.sign(d) * step; }
      sim.t += dt; return;
    }

    if (sim.mode === 'drive') {
      const nr = R.cell[0] + R.hd[0], nc = R.cell[1] + R.hd[1];
      if (cellWall(maze, nr, nc)) { sim.status = 'failed'; sim.reason = 'crash'; return; } // rule drove into a wall
      const [tx, ty] = sim.driveTarget; const dx = tx - R.x, dy = ty - R.y; const dist = Math.hypot(dx, dy);
      const step = driveSpeed(params) * dt;
      if (dist <= step) { R.x = tx; R.y = ty; R.cell = [nr, nc]; sim.steps++; sim.mode = 'scan';
        sim.trail.push([R.x, R.y]); if (sim.trail.length > 800) sim.trail.shift();
        if (R.cell[0] === maze.end[0] && R.cell[1] === maze.end[1]) { sim.status = 'success'; sim.reason = 'solved'; } }
      else { R.x += (dx / dist) * step; R.y += (dy / dist) * step; }
      sim.t += dt; return;
    }
  }

  function exploredCount(sim) { const s = {}; for (const k in sim.visits) s[k.split('|')[0]] = 1; return Object.keys(s).length; }

  function coach(sim) {
    const tips = [];
    const pid = (sim.cfg.mode === 'pid');
    if (sim.reason === 'crash') {
      if (pid) tips.push('Robot duvara sürttü. PID modunda Kp çok yüksekse zikzak yapıp duvara vurur, hız çok yüksekse dönemez - Kp\'yi ve taban hızı düşürmeyi dene. Hızlı bir robotta bu labirentte yavaşlaman gerekir.');
      else tips.push('Robot bir duvara sürdü - kurallarından biri kapalı bir yöne "ileri" dedi. O kuralda önce yolun açık olduğundan emin ol.');
    } else if (sim.reason === 'lost') {
      tips.push('Robot aynı yerlerde dönüp durdu (kayboldu). Bir "duvar takip" mantığı dene: solun açıksa sola dön, değilse düz git, o da kapalıysa sağa dön.');
    } else if (sim.reason === 'timeout') {
      tips.push('Süre doldu. PID modunda taban hızı biraz artır (daha hızlı ilerlesin) ya da Kp\'yi ayarla ki koridorları daha akıcı takip etsin.');
    } else if (sim.reason === 'stalled') {
      tips.push('Robot hiçbir kurala uymayıp durdu. "Hiçbiri eşleşmezse" durumuna bir hareket (ör. geri dön) ekle.');
    } else if (sim.status === 'success') {
      tips.push(pid ? 'Çıkışı buldun! PID ile sol duvarı takip ettin. Kp/Kd ile daha hızlı ve pürüzsüz sürüş dene.' : 'Çıkışı buldun! Daha az adımda bitirmek için gereksiz dönüşleri azaltmayı dene.');
    }
    return tips;
  }

  function runHeadless(cfg, maxTime, dt) {
    dt = dt || 1 / 60; maxTime = maxTime || 120;
    const sim = createSim(cfg); let g = 0;
    while (sim.status === 'running' && sim.t < maxTime && g < 2e6) { tickSim(sim, dt); g++; }
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(2), steps: sim.steps, explored: exploredCount(sim) };
  }

  // ---- starters ---------------------------------------------------------
  function starterSensors() {
    return [
      { id: 'f', role: 'front', label: 'ÖN', color: '#38bdf8', fwd: 0.95, right: 0 },
      { id: 'l', role: 'left', label: 'SOL', color: '#22c55e', fwd: 0.2, right: -0.6 },
      { id: 'r', role: 'right', label: 'SAĞ', color: '#f59e0b', fwd: 0.2, right: 0.6 },
    ];
  }
  // order = [ÖN, SOL, SAĞ]; on = wall. Left-hand wall follower (solves any maze).
  function starterRules() {
    return [
      { pattern: ['any', 'off', 'any'], left: { dir: 'rev', speed: 55 }, right: { dir: 'fwd', speed: 55 } }, // left open  -> turn left + go
      { pattern: ['off', 'on', 'any'], left: { dir: 'fwd', speed: 60 }, right: { dir: 'fwd', speed: 60 } },  // front open -> go straight
      { pattern: ['on', 'on', 'off'], left: { dir: 'fwd', speed: 55 }, right: { dir: 'rev', speed: 55 } },   // only right open -> turn right + go
    ];
  }
  function starterDefault() { return { left: { dir: 'rev', speed: 55 }, right: { dir: 'rev', speed: 55 } }; } // dead end -> turn around
  function starterPID() { return { kp: 2.8, kd: 0.7, base: 100 }; } // left-wall follower
  function defaultParams() { return { vMax: 2.8, wheelBase: 1.1, turnGain: 1.0 }; }

  const API = {
    CELL, ROBOT_R, DIRS, MAZES, MATCH_TIME, WF_RANGE, buildMaze, cellWall, cellCenter, isWallXY, rayDist,
    thOf, rotL, rotR, rev, motorFraction, ruleMatches, evalRules, actionOf, roleDir, readStates, makeRobot,
    createSim, tickSim, tickPID, exploredCount, coach, runHeadless,
    starterSensors, starterRules, starterDefault, starterPID, defaultParams, turnSpeed, driveSpeed,
  };
  global.MazeCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
