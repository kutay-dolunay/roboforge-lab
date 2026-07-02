/*
 * RoboForge — Çizgi Labirenti Simülasyon Çekirdeği
 * Pure, dependency-free. Browser (window.LineMazeCore) + Node (module.exports).
 *
 * Dersler: (1) SOL-EL KURALI (LSRB önceliği) her ağaç labirenti çözer,
 * (2) kavşak kararları bir ÖNCELİK SIRASIDIR — sırayı değiştir, rota değişsin,
 * (3) YOL KISALTMA: keşif turunda kaydettiğin L/S/R/B dizisini cebirle sadeleştir
 * (LBR→B, LBS→R, SBL→R...) — ikinci tur çıkmazsız ve HIZLI.
 */
(function () {
  'use strict';

  // labirentler: seed'li ağaç üretici (sol-el GARANTİLİ) + bir el yapımı döngü seviyesi
  const MISSIONS = [
    { id: 'ilkcatal', name: 'İlk Çatal', difficulty: 'Başlangıç', dur: 45, seed: 7, gw: 7, gh: 5,
      desc: 'Küçük ağaç labirent. SOL-el kuralı: her kavşakta önce sol, sonra düz, sonra sağ, mecbursan geri. Kaydı izle!' },
    { id: 'tarak', name: 'Tarak', difficulty: 'Başlangıç', dur: 60, seed: 19, gw: 9, gh: 5,
      desc: 'Çıkmaz dişleri: keşif turu uzun. Kaydettiğin dizideki her B budanabilir bir yol demek.' },
    { id: 'catallar', name: 'Çatallar Bahçesi', difficulty: 'Orta', dur: 75, seed: 33, gw: 9, gh: 7,
      desc: 'İç içe çatallar. Sol-el sabırla hepsini gezer; yarış modu budanmış rotayla uçar.' },
    { id: 'sarmal', name: 'Derin Dallar', difficulty: 'Orta', dur: 85, seed: 51, gw: 11, gh: 7,
      desc: 'Uzun yanıltıcı dallar: yanlış dal seni dakikalarca gezdirir. Keşif pahalı, kestirme altın.' },
    { id: 'cikmazlar', name: 'Çıkmaz Ormanı', difficulty: 'İleri', dur: 100, seed: 77, gw: 11, gh: 9,
      desc: 'Çıkmaz dolu orman. Sadeleştirme cebirinin gösterisi: LBR→B, LBS→R, SBS→B…' },
    { id: 'buyukdongu', name: 'Büyük Döngü', difficulty: 'İleri', dur: 90, loop: true,
      grid: ['.######.',
             'S#....#.',
             '.#....#G',
             '.######.'],
      desc: 'DÖNGÜ var! Sol-el kuralı ağaçlarda garantidir, döngülerde değil — bu yerleşimde yine kazanır. Neden? Düşün.' },
    { id: 'kabuslabirent', name: 'Kâbus Labirenti', difficulty: 'Uzman', dur: 150, seed: 101, gw: 13, gh: 9,
      desc: 'Dev ağaç: onlarca kavşak. Yarış modunda budanmış rotanın farkı çarpıcıdır.' },
  ];

  function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  // tek yollu ağaç labirent: recursive backtracker (hücreler çift koordinatta, koridorlar arada)
  function genMaze(m) {
    const rnd = lcg(m.seed);
    const W = m.gw, H = m.gh;                     // tek sayı olmalı
    const cells = new Set();
    const visited = new Set();
    const stack = [[0, 0]];
    visited.add('0,0'); cells.add('0,0');
    let far = [0, 0], farD = 0;
    const dist = { '0,0': 0 };
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const opts = [];
      [[0,-2],[2,0],[0,2],[-2,0]].forEach(([dx,dy])=>{
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && !visited.has(nx + ',' + ny)) opts.push([nx, ny, cx + dx/2, cy + dy/2]);
      });
      if (!opts.length) { stack.pop(); continue; }
      const [nx, ny, mx, my] = opts[Math.floor(rnd() * opts.length)];
      visited.add(nx + ',' + ny);
      cells.add(mx + ',' + my); cells.add(nx + ',' + ny);
      dist[nx + ',' + ny] = (dist[cx + ',' + cy] || 0) + 1;
      if (dist[nx + ',' + ny] > farD) { farD = dist[nx + ',' + ny]; far = [nx, ny]; }
      stack.push([nx, ny]);
    }
    return { cells, start: [0, 0], goal: far, w: W, h: H };
  }
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // N E S W

  function parseMaze(m) {
    if (!m.grid) return genMaze(m);
    const g = m.grid;
    const cells = new Set();
    let start = null, goal = null;
    for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) {
      const c = g[y][x];
      if (c === '#' || c === 'S' || c === 'G' || c === 'N') {
        cells.add(x + ',' + y);
        if (c === 'S') start = [x, y];
        if (c === 'G') goal = [x, y];
      }
    }
    return { cells, start, goal, w: Math.max(...g.map(r => r.length)), h: g.length };
  }
  function neighbors(mz, x, y) {
    const out = [];
    DIRS.forEach(([dx, dy], d) => { if (mz.cells.has((x + dx) + ',' + (y + dy))) out.push(d); });
    return out;
  }

  // öncelik: göreli yön listesi, ör. ['L','S','R','B']
  function chooseDir(mz, x, y, heading, prio) {
    const nbs = neighbors(mz, x, y);
    const rel = { L: (heading + 3) % 4, S: heading, R: (heading + 1) % 4, B: (heading + 2) % 4 };
    for (const p of prio) {
      const d = rel[p];
      if (nbs.includes(d)) return { dir: d, move: p };
    }
    return null;
  }

  // yol sadeleştirme (LSRB cebiri): B içeren üçlüleri indirge
  const REDUCE = { 'LBR': 'B', 'RBL': 'B', 'LBS': 'R', 'SBL': 'R', 'RBS': 'L', 'SBR': 'L', 'SBS': 'B', 'LBL': 'S', 'RBR': 'S' };
  function reducePath(moves) {
    let arr = moves.slice();
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i + 2 < arr.length; i++) {
        if (arr[i + 1] === 'B') {
          const key = arr[i] + 'B' + arr[i + 2];
          if (REDUCE[key]) { arr.splice(i, 3, REDUCE[key]); changed = true; break; }
        }
      }
    }
    return arr;
  }

  function bfsPath(mz) {
    const q = [[mz.start[0], mz.start[1]]];
    const prev = { [mz.start[0] + ',' + mz.start[1]]: null };
    while (q.length) {
      const [cx, cy] = q.shift();
      if (cx === mz.goal[0] && cy === mz.goal[1]) break;
      for (const d of neighbors(mz, cx, cy)) {
        const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        const k = nx + ',' + ny;
        if (!(k in prev)) { prev[k] = cx + ',' + cy; q.push([nx, ny]); }
      }
    }
    const path = [];
    let cur = mz.goal[0] + ',' + mz.goal[1];
    while (cur) { const [a, b] = cur.split(',').map(Number); path.unshift([a, b]); cur = prev[cur]; }
    return path;
  }

  function createSim(cfg) {
    const m = cfg.mission;
    const mz = parseMaze(m);
    // başlangıç yönü: start'ın tek komşusuna doğru
    const h0 = neighbors(mz, mz.start[0], mz.start[1])[0];
    return {
      cfg, mission: m, mz, t: 0, status: 'running', reason: null,
      x: mz.start[0], y: mz.start[1], heading: h0,
      px: mz.start[0], py: mz.start[1], prog: 1,       // hücreler arası ilerleme
      tx: mz.start[0], ty: mz.start[1],
      turnT: 0, lap: 1, moves: [], shortcut: null, scIdx: 0,
      visits: {}, trail: [[mz.start[0], mz.start[1], 1]],
      lapTimes: [], lapStart: 0,
      events: [], lastEvt: {}, totalTicks: 0,
    };
  }
  function pushEvt(sim, key, msg) {
    if (sim.lastEvt[key]) return;
    sim.lastEvt[key] = true;
    sim.events.push([+sim.t.toFixed(1), msg]);
    if (sim.events.length > 40) sim.events.shift();
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return;
    const m = sim.mission;
    const p = sim.cfg.params || defaultParams();
    const mode = sim.cfg.mode || 'prio';
    const racing = mode === 'race' && sim.lap === 2;
    const speed = (2.3 * (p.vMax || 1)) * (racing ? 1.2 : 1);

    sim.t += dt;
    if (sim.t > m.dur) { sim.status = 'failed'; sim.reason = 'sure'; return; }
    if (sim.turnT > 0) { sim.turnT -= dt; return; }

    // hücre içi ilerleme
    if (sim.prog < 1) {
      sim.prog = Math.min(1, sim.prog + speed * dt);
      sim.x = sim.px + (sim.tx - sim.px) * sim.prog;
      sim.y = sim.py + (sim.ty - sim.py) * sim.prog;
      return;
    }
    // hücre merkezindeyiz
    const cx = sim.tx, cy = sim.ty;
    sim.x = cx; sim.y = cy;
    const key = cx + ',' + cy;
    sim.visits[key] = (sim.visits[key] || 0) + 1;
    if (sim.visits[key] > 14) { sim.status = 'failed'; sim.reason = 'kayboldu';
      pushEvt(sim, 'lost', '😵 Aynı kavşaktan 14. geçiş — robot döngüde KAYBOLDU!'); return; }

    // hedef?
    if (cx === sim.mz.goal[0] && cy === sim.mz.goal[1]) {
      sim.lapTimes.push(sim.t - sim.lapStart);
      if (mode === 'race' && sim.lap === 1) {
        sim.shortcut = reducePath(sim.moves);
        sim.route = bfsPath(sim.mz); sim.routeIdx = 1;
        pushEvt(sim, 'lap1', '🗺️ Keşif bitti: ' + sim.moves.length + ' karar kaydı → sadeleşti: ' + sim.shortcut.join('') + ' (' + sim.shortcut.length + ' karar). Harita hazır!');
        // başa dön (ışınlan — pist sıfırlama)
        sim.lap = 2; sim.scIdx = 0; sim.lapStart = sim.t;
        sim.px = sim.tx = sim.mz.start[0]; sim.py = sim.ty = sim.mz.start[1];
        sim.heading = neighbors(sim.mz, sim.mz.start[0], sim.mz.start[1])[0];
        sim.prog = 1; sim.visits = {};
        sim.trail.push(null);
        return;
      }
      sim.status = 'success'; sim.reason = 'vardi';
      pushEvt(sim, 'fin', '🏁 HEDEF! ' + (mode === 'race' ? 'Yarış turu ' + (sim.t - (sim.lapTimes[0] || 0)).toFixed(1) + ' sn' : sim.t.toFixed(1) + ' sn'));
      return;
    }

    // kavşak kararı
    const nbs = neighbors(sim.mz, cx, cy);
    let decision;
    if (racing && sim.route) {
      const nxt = sim.route[sim.routeIdx];
      if (!nxt) { sim.status = 'failed'; sim.reason = 'kayboldu'; return; }
      const dir = DIRS.findIndex(([dx3, dy3]) => cx + dx3 === nxt[0] && cy + dy3 === nxt[1]);
      if (dir < 0) { sim.status = 'failed'; sim.reason = 'kayboldu'; return; }
      sim.routeIdx++;
      decision = { dir, move: 'S' };
    } else {
      const isJunction = nbs.length > 2;
      if (nbs.length === 1 && sim.totalTicks > 2) {
        decision = { dir: nbs[0], move: 'B' };   // çıkmaz → U dönüşü
        pushEvt(sim, 'dead' + key, '🔙 Çıkmaz! Geri dön (B)');
      } else if (isJunction) {
        decision = chooseDir(sim.mz, cx, cy, sim.heading, sim.cfg.prio || ['L','S','R','B']);
      } else {
        const fwd = nbs.filter(d => d !== (sim.heading + 2) % 4);
        decision = { dir: fwd[0] !== undefined ? fwd[0] : nbs[0], move: 'S' };
      }
      if (isJunction || nbs.length === 1) sim.moves.push(decision.move);
    }
    if (!decision) { sim.status = 'failed'; sim.reason = 'kayboldu'; return; }

    // dönüş süresi (turn cost)
    const turnCost = decision.dir === sim.heading ? 0 : decision.dir === (sim.heading + 2) % 4 ? 0.55 : 0.3;
    sim.turnT = turnCost / (p.turn || 1) * (racing ? 0.75 : 1);
    sim.heading = decision.dir;
    const [dx2, dy2] = DIRS[decision.dir];
    sim.px = cx; sim.py = cy;
    sim.tx = cx + dx2; sim.ty = cy + dy2;
    sim.prog = 0;
    sim.trail.push([sim.tx, sim.ty, sim.lap]);
    if (sim.trail.length > 4000) sim.trail.shift();
    sim.totalTicks++;
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const m = sim.mission;
    const tScore = Math.max(0, 100 - sim.t / m.dur * 90);
    if (sim.cfg.mode === 'race' && sim.lapTimes.length >= 1) {
      const imp = sim.lapTimes[0] > 0 ? (1 - (sim.t - sim.lapTimes[0]) / sim.lapTimes[0]) * 100 : 0;
      if (imp > 30) return { name: '🏆 Labirent Kartografı', cmt: 'Yarış turu keşiften %' + Math.round(imp) + ' hızlı — harita cebirinin zaferi!' };
      if (imp > 8) return { name: '🥈 İz Sürücü', cmt: 'Kestirme çalıştı. Daha fazla çıkmaz budanabilirdi — kayıt dizisine bak.' };
      return { name: '🥉 Kâşif', cmt: 'İki tur tamam ama kestirme kazancı az — bu labirent zaten kısa olabilir.' };
    }
    if (tScore > 55) return { name: '🏆 Labirent Kartografı', cmt: 'Kararlı kavşak disiplini, akıcı tur. Sol-el kuralı elinde silah gibi!' };
    if (tScore > 25) return { name: '🥈 İz Sürücü', cmt: 'Hedefe vardın. Süreyi kısaltmak için Yarış moduna geç — keşif + kestirme.' };
    return { name: '🥉 Kâşif', cmt: 'Ucu ucuna. Çıkmazlarda kaybedilen zamanı yarış modu geri kazandırır.' };
  }
  function coach(sim) {
    const tips = [];
    const r = sim.reason || '';
    if (r === 'kayboldu') tips.push('Robot döngüde kayboldu! Sol-el kuralı yalnız AĞAÇ labirentlerde garantidir; döngülerde öncelik sırası veya harita gerekir. Öncelik dizilimini değiştir ya da Yarış moduna geç.');
    if (r === 'sure') tips.push('Süre doldu. Keşif pahalıdır: her çıkmaz gidiş-dönüş iki kat zaman. Yarış modunda ilk tur yatırım, ikinci tur hasattır.');
    if (sim.status === 'success' && sim.moves.filter(x => x === 'B').length > 2 && sim.cfg.mode !== 'race')
      tips.push('Kaydında ' + sim.moves.filter(x => x === 'B').length + ' tane B (geri dönüş) var — her biri budanabilir yol demek. Yarış modu bu diziyi cebirle sadeleştirir: LBR→B, LBS→R…');
    if (!tips.length) tips.push('LSRB cebiri: keşif dizisindeki her "B" komşularıyla birleşip sadeleşir. Kâğıtta dene: L S B L → L R? Kurallar tabloda, robot kanıtı sahada.');
    return tips;
  }

  function runHeadless(cfg, maxTime, dt) {
    const sim = createSim(cfg);
    const step = dt || 1 / 60, mt = maxTime || (cfg.mission.dur + 2);
    while (sim.status === 'running' && sim.t < mt) tickSim(sim, step);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(1),
      moves: sim.moves.length, laps: sim.lapTimes.map(x => +x.toFixed(1)) };
  }

  function defaultPrio() { return ['L', 'S', 'R', 'B']; }
  function defaultParams() { return { vMax: 1.0, turn: 1.0 }; }

  const API = {
    MISSIONS, DIRS, parseMaze, genMaze, neighbors, chooseDir, reducePath, REDUCE,
    createSim, tickSim, robotClass, coach, runHeadless, defaultPrio, defaultParams,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.LineMazeCore = API;
})();
