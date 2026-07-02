/* =============================================================================
 * RoboForge — Sürü Robotları (Swarm Robotics) :: Simulation Core
 * -----------------------------------------------------------------------------
 * Pure, dependency-free. Browser (window.SwarmCore) + Node (module.exports).
 *
 * 6 identical robots, NO leader, NO map. Each one only sees neighbours within
 * its sensing radius and blends four instincts (the student's sliders):
 *   AYRILMA (separation) · HİZALANMA (alignment) · TOPLANMA (cohesion) ·
 *   HEDEF ÇEKİMİ (goal attraction)
 * From these local rules, flock behaviour EMERGES — the swarm lesson.
 * ========================================================================== */
(function (global) {
  'use strict';

  const N = 6;
  const SENSE_R = 3.6;
  const ROBOT_R = 0.34;
  const ARENA_X = 9, ARENA_Y = 5.5;
  const TURN_RATE = 3.6;
  const HOLD_T = 1.5;
  const CELL = 2.2; // coverage grid cell

  // ---- levels ------------------------------------------------------------------------
  // task: {type:'gather',x,y,r} | {type:'cover',pct} | {type:'spread',d}
  // walls: [[x1,y1,x2,y2]] · start: fixed scatter
  const LEVELS = [
    { id: 'toplan', name: 'Toplanma', difficulty: 'Başlangıç', time: 30,
      task: { type: 'gather', x: 0, y: 0, r: 2.6 }, walls: [] },
    { id: 'goc', name: 'Sürü Göçü', difficulty: 'Başlangıç', time: 40,
      task: { type: 'gather', x: 6.5, y: 0, r: 2.6 }, walls: [] },
    { id: 'gecit', name: 'Dar Geçit', difficulty: 'Orta', time: 55,
      task: { type: 'gather', x: 6.5, y: 0, r: 2.7 },
      walls: [[0, -5.5, 0, -1.3], [0, 1.3, 0, 5.5]] },
    { id: 'tarama', name: 'Alan Tarama', difficulty: 'Orta', time: 55,
      task: { type: 'cover', pct: 80 }, walls: [] },
    { id: 'dagil', name: 'Eşit Dağılım', difficulty: 'İleri', time: 40,
      task: { type: 'spread', d: 2.9 }, walls: [] },
    { id: 'cift', name: 'Çifte Geçit', difficulty: 'İleri', time: 70,
      task: { type: 'gather', x: 7, y: 0, r: 2.6 },
      walls: [[-3, -5.5, -3, 0.6], [-3, 3.0, -3, 5.5], [2.5, -3.0, 2.5, -0.6], [2.5, -5.5, 2.5, -5.4], [2.5, 1.0, 2.5, 5.5]] },
    { id: 'kabus', name: 'Kâbus Görevi', difficulty: 'Uzman', time: 90,
      task: { type: 'gather', x: 7, y: -3.4, r: 2.6 },
      walls: [[-2, -5.5, -2, -1.1], [-2, 1.3, -2, 5.5], [3.5, -1.0, 3.5, 5.5], [3.5, -5.5, 3.5, -3.6]] },
  ];

  const STARTS = [[-7.5, 3.8], [-6.2, -3.6], [-7.8, -1.2], [-5.0, 2.2], [-6.8, 0.8], [-5.6, -1.8]];

  function segDist(px, py, w) {
    const ax = w[0], ay = w[1], bx = w[2], by = w[3];
    const abx = bx - ax, aby = by - ay;
    const ab2 = abx * abx + aby * aby || 1e-9;
    let t = ((px - ax) * abx + (py - ay) * aby) / ab2;
    t = Math.max(0, Math.min(1, t));
    return { d: Math.hypot(px - (ax + abx * t), py - (ay + aby * t)),
      cx: ax + abx * t, cy: ay + aby * t };
  }

  // ---- sim ----------------------------------------------------------------------------
  function createSim(cfg) {
    const bots = STARTS.map(([x, y], i) => ({
      id: i, x, y, th: 0.3 * i, v: 0,
    }));
    return {
      cfg, level: cfg.level, bots,
      t: 0, status: 'running', reason: null,
      holdT: 0, covered: {}, coveredN: 0,
      trail: [], totalTicks: 0, last: null,
    };
  }

  function botGoal(sim, b, task) {
    if (task.type === 'gather') return [task.x - b.x, task.y - b.y];
    if (task.type === 'cover') {
      const ANCH = [[-7, 4], [0, 4], [7, 4], [7, -4], [0, -4], [-7, -4]];
      const a = ANCH[(b.id + Math.floor(sim.t / 6)) % ANCH.length];
      return [a[0] - b.x, a[1] - b.y];
    }
    if (task.type === 'spread') {
      const POSTS = [[-6, 3], [0, 3], [6, 3], [-6, -3], [0, -3], [6, -3]];
      const p = POSTS[b.id];
      return [p[0] - b.x, p[1] - b.y];
    }
    return [0, 0];
  }

  function taskProgress(sim) {
    const task = sim.level.task;
    if (task.type === 'gather') {
      let inside = 0;
      for (const b of sim.bots) if (Math.hypot(b.x - task.x, b.y - task.y) < task.r) inside++;
      return { label: inside + '/' + N, done: inside === N, frac: inside / N };
    }
    if (task.type === 'cover') {
      const total = Math.ceil(ARENA_X * 2 / CELL) * Math.ceil(ARENA_Y * 2 / CELL);
      const pct = Math.round(100 * sim.coveredN / total);
      return { label: '%' + pct, done: pct >= task.pct, frac: pct / task.pct };
    }
    if (task.type === 'spread') {
      let minD = 99;
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const d = Math.hypot(sim.bots[i].x - sim.bots[j].x, sim.bots[i].y - sim.bots[j].y);
        if (d < minD) minD = d;
      }
      return { label: minD.toFixed(1) + '/' + task.d, done: minD >= task.d, frac: Math.min(1, minD / task.d) };
    }
    return { label: '—', done: false, frac: 0 };
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
      if (ruleMatches(rules[i], arr)) {
        return { mL: motorFraction(rules[i].left), mR: motorFraction(rules[i].right), ruleIndex: i };
      }
    }
    return { mL: motorFraction(defaultRule.left), mR: motorFraction(defaultRule.right), ruleIndex: -1 };
  }
  function wrapA(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return sim.last;
    const level = sim.level;
    const mode = sim.cfg.mode || 'weights';
    const w = sim.cfg.weights;   // { sep, ali, coh, goal }
    const speed = ((sim.cfg.params && sim.cfg.params.vMax) || 3.6) * 0.62;
    const task = level.task;

    for (const b of sim.bots) {
      // neighbours
      let sepX = 0, sepY = 0, aliX = 0, aliY = 0, cohX = 0, cohY = 0, nN = 0;
      for (const o of sim.bots) {
        if (o === b) continue;
        const dx = o.x - b.x, dy = o.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d > SENSE_R || d < 1e-6) continue;
        nN++;
        sepX -= dx / (d * d); sepY -= dy / (d * d);
        aliX += Math.cos(o.th); aliY += Math.sin(o.th);
        cohX += dx; cohY += dy;
      }
      let g0 = botGoal(sim, b, task);
      let gx = g0[0], gy = g0[1];
      const gm = Math.hypot(gx, gy) || 1e-9;
      gx /= gm; gy /= gm;

      // wall + border avoidance (built-in reflex)
      let wx = 0, wy = 0;
      let wallTx = 0, wallTy = 0, nearWall = false, wallEnd = null;
      for (const wall of level.walls) {
        const r = segDist(b.x, b.y, wall);
        if (r.d < 1.1) {
          nearWall = true;
          wx += (b.x - r.cx) / (r.d * r.d + 0.05);
          wy += (b.y - r.cy) / (r.d * r.d + 0.05);
          wallTx = -(b.y - r.cy) / (r.d + 0.05); wallTy = (b.x - r.cx) / (r.d + 0.05);
          // openings live at the INTERIOR wall ends: prefer the end nearer the arena center
          const c1 = Math.hypot(wall[0], wall[1]);
          const c2 = Math.hypot(wall[2], wall[3]);
          wallEnd = c1 < c2 ? [wall[0], wall[1]] : [wall[2], wall[3]];
        }
      }
      if (b.x > ARENA_X - 1) wx -= 1.4; if (b.x < -ARENA_X + 1) wx += 1.4;
      if (b.y > ARENA_Y - 1) wy -= 1.4; if (b.y < -ARENA_Y + 1) wy += 1.4;
      if (nearWall) { // slide along the wall TOWARD the goal side (or the nearest opening)
        let dot = wallTx * gx + wallTy * gy;
        if (Math.abs(dot) < 0.25 && wallEnd) {
          const ex = wallEnd[0] - b.x, ey = wallEnd[1] - b.y;
          dot = wallTx * ex + wallTy * ey;
        }
        const sgn = dot >= 0 ? 1 : -1;
        wx += wallTx * sgn * 0.9; wy += wallTy * sgn * 0.9;
      }

      let sp;
      if (mode === 'rules') {
        // discrete chips: nearest-neighbour side + goal bearing
        let nd = 1e9, nb = null;
        for (const o of sim.bots) {
          if (o === b) continue;
          const d = Math.hypot(o.x - b.x, o.y - b.y);
          if (d < nd) { nd = d; nb = o; }
        }
        const seen = nd <= SENSE_R;
        const kb = seen ? wrapA(Math.atan2(nb.y - b.y, nb.x - b.x) - b.th) : 0;
        const gb = wrapA(Math.atan2(gy, gx) - b.th);
        const bits = [
          !seen,                                  // YALNIZ
          seen && kb > 0.35,                      // KOMŞU solda
          seen && kb < -0.35,                     // KOMŞU sağda
          seen && nd < 1.0,                       // ÇOK YAKIN
          gb > 0.4,                               // HEDEF solda
          Math.abs(gb) <= 0.4,                    // HEDEF önde
          gb < -0.4,                              // HEDEF sağda
        ];
        const cmd = evalRules(sim.cfg.rules || [], sim.cfg.defaultRule || { left: { dir: 'fwd', speed: 55 }, right: { dir: 'fwd', speed: 55 } }, bits);
        b.lastRule = cmd.ruleIndex;
        let om = (cmd.mR - cmd.mL) * 3.4;
        // wall reflex still steers (safety instinct)
        const wm = Math.hypot(wx, wy);
        if (wm > 0.6) {
          const dthW = wrapA(Math.atan2(wy, wx) - b.th);
          om += Math.max(-2.2, Math.min(2.2, dthW * 2.0 * Math.min(1, wm * 0.4)));
        }
        b.th += Math.max(-TURN_RATE * 1.4, Math.min(TURN_RATE * 1.4, om)) * dt;
        sp = Math.max(0, (cmd.mL + cmd.mR) / 2) * speed * 1.35;
      } else {
        let vx = (w.sep || 0) * sepX + (w.coh || 0) * cohX * 0.12 + (w.goal || 0) * gx * 1.6 + wx * 2.0;
        let vy = (w.sep || 0) * sepY + (w.coh || 0) * cohY * 0.12 + (w.goal || 0) * gy * 1.6 + wy * 2.0;
        if (nN > 0) { vx += (w.ali || 0) * aliX / nN; vy += (w.ali || 0) * aliY / nN; }
        const vm = Math.hypot(vx, vy);
        if (vm > 1e-6) {
          const targetTh = Math.atan2(vy, vx);
          let dth = wrapA(targetTh - b.th);
          b.th += Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, dth));
        }
        sp = speed * (0.4 + 0.6 * Math.min(1, vm * 0.5));
      }
      const nx = b.x + Math.cos(b.th) * sp * dt;
      const ny = b.y + Math.sin(b.th) * sp * dt;
      // hard wall block
      let blocked = false;
      for (const wall of level.walls) if (segDist(nx, ny, wall).d < ROBOT_R + 0.08) { blocked = true; break; }
      if (!blocked) {
        b.x = Math.max(-ARENA_X + ROBOT_R, Math.min(ARENA_X - ROBOT_R, nx));
        b.y = Math.max(-ARENA_Y + ROBOT_R, Math.min(ARENA_Y - ROBOT_R, ny));
      }
      // coverage
      if (task.type === 'cover') {
        const key = Math.floor((b.x + ARENA_X) / CELL) + '_' + Math.floor((b.y + ARENA_Y) / CELL);
        if (!sim.covered[key]) { sim.covered[key] = true; sim.coveredN++; }
      }
    }

    sim.t += dt; sim.totalTicks++;
    const prog = taskProgress(sim);
    if (prog.done) {
      sim.holdT += dt;
      if (sim.holdT >= HOLD_T) { sim.status = 'success'; sim.reason = 'done'; }
    } else sim.holdT = 0;
    if (sim.status === 'running' && sim.t > (level.time || 45)) {
      sim.status = 'failed'; sim.reason = 'timeout';
    }

    if (sim.totalTicks % 5 === 0) {
      sim.trail.push(sim.bots.map(b => [b.x, b.y]));
      if (sim.trail.length > 1400) sim.trail.shift();
    }
    sim.last = { prog };
    return sim.last;
  }

  function coach(sim) {
    const tips = [];
    const w = sim.cfg.weights;
    const task = sim.level.task;
    if (sim.reason === 'timeout') {
      if (task.type === 'gather') {
        if ((w.goal || 0) < 0.6) tips.push('Sürü hedefe gitmedi — Hedef Çekimi çok zayıf. Ama dikkat: çok yüksek yaparsan geçitlerde birbirlerini ezerler, Ayrılma da lazım.');
        else if ((w.sep || 0) > 2.2) tips.push('Robotlar birbirini o kadar itiyor ki bölgeye sığamıyorlar! Ayrılmayı azalt ya da Toplanmayı artır.');
        else tips.push('Az kaldı! Dar geçitlerde sürü sıkışır: Ayrılma + Hedef dengesi geçiş sırasını kendiliğinden oluşturur. Hizalanma da akışı düzleştirir.');
      }
      if (task.type === 'cover') tips.push('Alan yeterince taranamadı. Ayrılmayı artır — birbirini iten robotlar doğal olarak farklı bölgelere dağılır. Toplanma bu görevde düşmanın!');
      if (task.type === 'spread') tips.push('Eşit dağılım sağlanamadı. Ayrılmayı artır, Toplanmayı kıs — bu görev yalnızlık ister!');
    }
    if (sim.status === 'success') {
      const T = sim.level.time || 45;
      if (sim.t < T * 0.5) tips.push('Kusursuz sürü! Tek tek aptal, birlikte akıllı — sürü zekâsının özü bu.');
      else tips.push('Görev tamam! Ağırlıkların dansını ince ayarlayarak süreyi kısaltabilirsin.');
    }
    return tips;
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const T = sim.level.time || 45, t = sim.t;
    if (t < T * 0.45) return { key: 'suru_beyni', name: '🏆 Sürü Beyni', cmt: 'Altı robot tek organizma gibi aktı.' };
    if (t < T * 0.65) return { key: 'koloni_sefi', name: '🥇 Koloni Şefi', cmt: 'Uyumlu sürü. Ağırlık dengesini biraz daha oturt.' };
    if (t < T * 0.85) return { key: 'cobanbasi', name: '🧭 Çobanbaşı', cmt: 'Sürü görevi tamamladı — biraz dağınık ama tamamladı.' };
    return { key: 'caylak_coban', name: '🎓 Çaylak Çoban', cmt: 'Son anda toparlandılar — ağırlıklarla oyna.' };
  }

  function runHeadless(cfg, maxTime, dt) {
    dt = dt || 1 / 60;
    const sim = createSim(cfg);
    const mt = maxTime || (cfg.level.time || 45) + 2;
    let g = 0;
    while (sim.status === 'running' && sim.t < mt && g++ < 2e6) tickSim(sim, dt);
    const prog = taskProgress(sim);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(2), prog: prog.label };
  }

  function defaultWeights() { return { sep: 1.1, ali: 0.6, coh: 0.9, goal: 1.0 }; }
  // pattern = [yalniz, komsuSol, komsuSag, cokYakin, hedefSol, hedefOn, hedefSag]
  function starterRules() {
    return [
      { pattern: ['off', 'on', 'any', 'on', 'any', 'any', 'any'], left: { dir: 'fwd', speed: 80 }, right: { dir: 'fwd', speed: 32 } }, // çok yakın soldaki: sağa kaç
      { pattern: ['off', 'any', 'on', 'on', 'any', 'any', 'any'], left: { dir: 'fwd', speed: 32 }, right: { dir: 'fwd', speed: 80 } }, // çok yakın sağdaki: sola kaç
      { pattern: ['any', 'any', 'any', 'off', 'any', 'on', 'any'], left: { dir: 'fwd', speed: 75 }, right: { dir: 'fwd', speed: 75 } }, // hedef önde: düz
      { pattern: ['any', 'any', 'any', 'off', 'on', 'off', 'any'], left: { dir: 'fwd', speed: 30 }, right: { dir: 'fwd', speed: 75 } }, // hedef solda: sola
      { pattern: ['any', 'any', 'any', 'off', 'any', 'off', 'on'], left: { dir: 'fwd', speed: 75 }, right: { dir: 'fwd', speed: 30 } }, // hedef sağda: sağa
    ];
  }
  function starterDefault() { return { left: { dir: 'fwd', speed: 55 }, right: { dir: 'fwd', speed: 55 } }; }
  function defaultParams() { return { vMax: 3.6 }; }

  const API = {
    N, SENSE_R, ROBOT_R, ARENA_X, ARENA_Y, CELL,
    LEVELS, STARTS, segDist, createSim, tickSim, taskProgress,
    coach, robotClass, runHeadless, defaultWeights, defaultParams,
    starterRules, starterDefault, evalRules, ruleMatches, motorFraction, botGoal,
  };
  global.SwarmCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
