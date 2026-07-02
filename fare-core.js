/*
 * RoboForge — Mikro Fare Simülasyon Çekirdeği (Katalog Kapanışı)
 * Pure, dependency-free. Browser (window.FareCore) + Node (module.exports).
 *
 * Klasik micromouse: duvarlı labirent, hedef MERKEZDE. Dersler:
 * (1) DUVAR TAKİBİ tuzağı: merkez, dış duvara bağlı olmayan bir "ada" olabilir —
 * sol-el kuralı sonsuza dek dolanır, (2) FLOOD-FILL: her hücreye "hedefe kaç adım"
 * değeri yaz, hep küçüğe yürü; bilinmeyeni iyimser say, gördükçe güncelle,
 * (3) KEŞİF ↔ HIZ: önce haritala, sonra bilinen en kısa yoldan uç.
 */
(function () {
  'use strict';

  // duvarlar: her hücre için 4-bit (N=1,E=2,S=4,W=8)
  const MISSIONS = [
    { id: 'minik', name: 'Minik Kutu', difficulty: 'Başlangıç', dur: 60, n: 5, seed: 5, rings: 0,
      desc: '5×5 klasik labirent. Flood-fill ile tanış: her hücrede "hedefe kaç adım?" sorusu, cevabı sayılar verir.' },
    { id: 'yedi', name: 'Yedi Kat', difficulty: 'Başlangıç', dur: 90, n: 7, seed: 17, rings: 0,
      desc: '7×7: keşif uzuyor. Fare bilmediği hücreyi İYİMSER sayar — gördükçe harita gerçekleşir.' },
    { id: 'dokuz', name: 'Dokuz Oda', difficulty: 'Orta', dur: 120, n: 9, seed: 29, rings: 0,
      desc: '9×9 ağaç labirent. Duvar takibi de çözer — ama kaç adımda? Raporda iki stratejiyi kıyasla.' },
    { id: 'delikli', name: 'Delikli Peynir', difficulty: 'Orta', dur: 120, n: 9, seed: 43, rings: 0, holes: 6,
      desc: 'Duvarlarda delikler = DÖNGÜLER. Flood-fill umursamaz; duvar takipçisi turlamaya başlayabilir…' },
    { id: 'onbir', name: 'On Bir Salonu', difficulty: 'İleri', dur: 160, n: 11, seed: 61, rings: 0, holes: 4,
      desc: '11×11 + döngüler. Keşif yatırımdır: hız turundaki her saniye keşifteki haritanın faizidir.' },
    { id: 'adamerkez', name: 'Ada Merkez', difficulty: 'İleri', dur: 160, n: 11, seed: 79, rings: 1, holes: 3,
      desc: 'Merkezin etrafında HALKA koridor: hedef artık dış duvara bağlı değil. Sol-el kuralı burada MATEMATİKSEL olarak çaresiz. Flood-fill gülümser.' },
    { id: 'kabusfare', name: 'Kâbus Faresi', difficulty: 'Uzman', dur: 220, n: 13, seed: 97, rings: 1, holes: 6,
      desc: '13×13 + halka + döngüler. Gerçek micromouse finali: haritala, planla, uç. Katalogdaki son sınav!' },
  ];

  function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // N E S W
  const WBIT = [1, 2, 4, 8];
  const OPP = [2, 3, 0, 1];

  function genMaze(m) {
    const n = m.n, rnd = lcg(m.seed);
    const walls = new Array(n * n).fill(15);          // hepsi kapalı
    const idx = (x, y) => y * n + x;
    // recursive backtracker
    const visited = new Set(['0,0']);
    const stack = [[0, 0]];
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const opts = [];
      DIRS.forEach(([dx, dy], d) => {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && ny >= 0 && nx < n && ny < n && !visited.has(nx + ',' + ny)) opts.push([nx, ny, d]);
      });
      if (!opts.length) { stack.pop(); continue; }
      const [nx, ny, d] = opts[Math.floor(rnd() * opts.length)];
      walls[idx(cx, cy)] &= ~WBIT[d];
      walls[idx(nx, ny)] &= ~WBIT[OPP[d]];
      visited.add(nx + ',' + ny);
      stack.push([nx, ny]);
    }
    const c = Math.floor(n / 2);
    // merkez halkası: merkezi çevreleyen koridoru aç (ada etkisi)
    if (m.rings) {
      for (let x = c - 1; x <= c + 1; x++) for (let y = c - 1; y <= c + 1; y++) {
        if (x === c && y === c) continue;
        DIRS.forEach(([dx, dy], d) => {
          const nx = x + dx, ny = y + dy;
          if (nx < c - 1 || nx > c + 1 || ny < c - 1 || ny > c + 1) return;
          if (nx === c && ny === c) return;
          walls[idx(x, y)] &= ~WBIT[d];
          walls[idx(nx, ny)] &= ~WBIT[OPP[d]];
        });
      }
      // merkeze tek kapı (halkadan)
      const doors = [[c, c - 1, 2], [c + 1, c, 3], [c, c + 1, 0], [c - 1, c, 1]];
      const [px, py, pd] = doors[Math.floor(rnd() * 4)];
      walls[idx(px, py)] &= ~WBIT[pd];
      walls[idx(c, c)] &= ~WBIT[OPP[pd]];
    }
    // döngü delikleri
    for (let h = 0; h < (m.holes || 0); h++) {
      const x = 1 + Math.floor(rnd() * (n - 2)), y = 1 + Math.floor(rnd() * (n - 2));
      const d = Math.floor(rnd() * 4);
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      if (nx >= 0 && ny >= 0 && nx < n && ny < n) {
        walls[idx(x, y)] &= ~WBIT[d];
        walls[idx(nx, ny)] &= ~WBIT[OPP[d]];
      }
    }
    return { n, walls, start: [0, 0], goal: [c, c] };
  }

  function hasWall(mz, x, y, d) { return (mz.walls[y * mz.n + x] & WBIT[d]) !== 0; }

  // flood-fill: bilinen duvarlarla hedeften mesafe alanı (bilinmeyen = açık iyimserliği)
  function flood(mz, known, goal) {
    const n = mz.n;
    const dist = new Array(n * n).fill(Infinity);
    const q = [goal];
    dist[goal[1] * n + goal[0]] = 0;
    while (q.length) {
      const [cx, cy] = q.shift();
      const d0 = dist[cy * n + cx];
      DIRS.forEach(([dx, dy], d) => {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) return;
        const k = cy * n + cx;
        // bilinen hücrede gerçek duvar; bilinmeyende iyimser (duvar yok say)
        const blocked = known.has(k) ? hasWall(mz, cx, cy, d)
          : (known.has(ny * n + nx) ? hasWall(mz, nx, ny, OPP[d]) : false);
        if (blocked) return;
        if (d0 + 1 < dist[ny * n + nx]) { dist[ny * n + nx] = d0 + 1; q.push([nx, ny]); }
      });
    }
    return dist;
  }

  function createSim(cfg) {
    const m = cfg.mission;
    const mz = genMaze(m);
    return {
      cfg, mission: m, mz, t: 0, status: 'running', reason: null,
      x: 0, y: 0, heading: hasWall(mz, 0, 0, 1) ? 2 : 1,
      px: 0, py: 0, tx: 0, ty: 0, prog: 1, turnT: 0,
      phase: 'kesif', lap: 1, lapStart: 0, lapTimes: [],
      known: new Set([0]), visits: {},
      route: null, routeIdx: 0,
      trail: [[0, 0, 1]], events: [], lastEvt: {}, totalTicks: 0, cellsSeen: 1,
    };
  }
  function pushEvt(sim, key, msg) {
    if (sim.lastEvt[key]) return;
    sim.lastEvt[key] = true;
    sim.events.push([+sim.t.toFixed(1), msg]);
    if (sim.events.length > 40) sim.events.shift();
  }

  function bfsKnown(sim) {
    // hız turu rotası: TAM haritada (keşifte görülen gerçek duvarlar; görünmeyen = kapalı say)
    const mz = sim.mz, n = mz.n;
    const q = [[0, 0]];
    const prev = { '0,0': null };
    while (q.length) {
      const [cx, cy] = q.shift();
      DIRS.forEach(([dx, dy], d) => {
        if (hasWall(mz, cx, cy, d)) return;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) return;
        if (!sim.known.has(ny * n + nx)) return;       // yalnız görülen hücrelerden geç
        const k = nx + ',' + ny;
        if (!(k in prev)) { prev[k] = cx + ',' + cy; q.push([nx, ny]); }
      });
    }
    const gk = mz.goal[0] + ',' + mz.goal[1];
    if (!(gk in prev)) return null;
    const path = [];
    let cur = gk;
    while (cur) { const [a, b] = cur.split(',').map(Number); path.unshift([a, b]); cur = prev[cur]; }
    return path;
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return;
    const m = sim.mission;
    const p = sim.cfg.params || defaultParams();
    const mode = sim.cfg.mode || 'flood';
    const racing = sim.phase === 'hiz';
    const speed = 2.4 * (p.vMax || 1) * (racing ? 1.25 : 1);

    sim.t += dt;
    if (sim.t > m.dur) { sim.status = 'failed'; sim.reason = 'sure'; return; }
    if (sim.turnT > 0) { sim.turnT -= dt; return; }
    if (sim.prog < 1) {
      sim.prog = Math.min(1, sim.prog + speed * dt);
      sim.x = sim.px + (sim.tx - sim.px) * sim.prog;
      sim.y = sim.py + (sim.ty - sim.py) * sim.prog;
      return;
    }
    const cx = sim.tx, cy = sim.ty;
    sim.x = cx; sim.y = cy;
    const n = sim.mz.n;
    const ck = cy * n + cx;
    if (!sim.known.has(ck)) { sim.known.add(ck); sim.cellsSeen++; }
    const vk = cx + ',' + cy;
    sim.visits[vk] = (sim.visits[vk] || 0) + 1;
    if (sim.visits[vk] > 16) { sim.status = 'failed'; sim.reason = 'kayboldu';
      pushEvt(sim, 'lost', '😵 Aynı hücreden 16. geçiş — fare DÖNGÜDE! (Sol-el merkez adasına giremez…)'); return; }

    // hedef?
    if (cx === sim.mz.goal[0] && cy === sim.mz.goal[1]) {
      sim.lapTimes.push(sim.t - sim.lapStart);
      if (sim.phase === 'kesif') {
        const route = bfsKnown(sim);
        pushEvt(sim, 'found', '🧀 MERKEZ! Keşif ' + (sim.t - sim.lapStart).toFixed(1) + ' sn · harita %' + Math.round(sim.cellsSeen / (n * n) * 100) + ' — hız turu başlıyor');
        sim.phase = 'hiz'; sim.lap = 2; sim.lapStart = sim.t;
        sim.route = route; sim.routeIdx = 1;
        sim.px = sim.tx = 0; sim.py = sim.ty = 0;
        sim.heading = hasWall(sim.mz, 0, 0, 1) ? 2 : 1;
        sim.prog = 1; sim.visits = {};
        sim.trail.push(null);
        return;
      }
      sim.status = 'success'; sim.reason = 'peynir';
      pushEvt(sim, 'fin', '🏁 HIZ TURU: ' + (sim.t - sim.lapStart).toFixed(1) + ' sn — peynir kapıldı!');
      return;
    }

    // karar
    let dir = null;
    if (racing && sim.route) {
      const nxt = sim.route[sim.routeIdx];
      if (!nxt) { sim.status = 'failed'; sim.reason = 'kayboldu'; return; }
      dir = DIRS.findIndex(([dx, dy]) => cx + dx === nxt[0] && cy + dy === nxt[1]);
      sim.routeIdx++;
    } else if (mode === 'flood') {
      const dist = flood(sim.mz, sim.known, sim.mz.goal);
      let best = Infinity, bd = -1;
      DIRS.forEach(([dx, dy], d) => {
        if (hasWall(sim.mz, cx, cy, d)) return;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) return;
        let v = dist[ny * n + nx];
        if (d === sim.heading) v -= 0.2;          // düz gitmeyi hafif tercih et (dönüş maliyeti)
        if (v < best) { best = v; bd = d; }
      });
      dir = bd;
    } else {
      // duvar takibi (sol-el / sağ-el)
      const hand = sim.cfg.hand === 'R' ? [1, 0, 3, 2] : [3, 0, 1, 2];  // rölatif: L,S,R,B / R,S,L,B
      for (const rel of hand) {
        const d = (sim.heading + rel) % 4;
        if (!hasWall(sim.mz, cx, cy, d)) { dir = d; break; }
      }
    }
    if (dir === null || dir < 0) { sim.status = 'failed'; sim.reason = 'kayboldu'; return; }

    const turnCost = dir === sim.heading ? 0 : dir === (sim.heading + 2) % 4 ? 0.5 : 0.28;
    sim.turnT = turnCost / (p.turn || 1) * (racing ? 0.7 : 1);
    sim.heading = dir;
    sim.px = cx; sim.py = cy;
    sim.tx = cx + DIRS[dir][0]; sim.ty = cy + DIRS[dir][1];
    sim.prog = 0;
    sim.trail.push([sim.tx, sim.ty, sim.lap]);
    if (sim.trail.length > 6000) sim.trail.shift();
    sim.totalTicks++;
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const explore = sim.lapTimes[0] || 1, race = sim.lapTimes[1] || sim.t;
    const cov = sim.cellsSeen / (sim.mz.n * sim.mz.n);
    const tScore = Math.max(0, 100 - sim.t / sim.mission.dur * 85);
    if (tScore > 45 && race < explore * 0.75) return { name: '🏆 Peynir İmparatoru', cmt: 'Cerrah gibi keşif, jet gibi hız turu. Micromouse finali kazanıldı — katalog senin!' };
    if (tScore > 20) return { name: '🥈 Usta Fare', cmt: 'Peynir kapıldı. Keşif turun ' + explore.toFixed(0) + ' sn — flood-fill her adımda yeniden hesaplıyor, güven ona.' };
    return { name: '🥉 Yavru Fare', cmt: 'Ucu ucuna. Harita kapsaman %' + Math.round(cov * 100) + ' — bazen biraz daha keşif, çok daha kısa hız turu demek.' };
  }
  function coach(sim) {
    const tips = [];
    const r = sim.reason || '';
    if (r === 'kayboldu') {
      if ((sim.cfg.mode || 'flood') === 'duvar') tips.push('Duvar takibi merkez ADASINA giremez: elin dış duvarda, merkez dış duvara bağlı değil — sonsuza dek halkada dönersin. Bu matematiksel bir imkânsızlık. Flood-fill moduna geç!');
      else tips.push('Fare döngüde kayboldu — bu olmamalıydı, haritayı raporda incele.');
    }
    if (r === 'sure') tips.push('Süre doldu. Keşif çok gezindi: flood-fill bilinmeyeni iyimser sayar, bu yüzden bazen çıkmaz umutlara dalar — normaldir, harita büyüdükçe düzelir.');
    if (sim.status === 'success' && (sim.cfg.mode || 'flood') === 'duvar') tips.push('Duvar takibi bu labirentte işledi — çünkü merkez hâlâ dış duvara bağlıydı. Ada Merkez seviyesinde aynı stratejiyi dene ve farkı gör!');
    if (!tips.length) tips.push('Flood-fill sırrı: sayılar hedeften dışa doğru dalga gibi yayılır. Fare her hücrede sadece "hangi komşu daha küçük?" diye sorar — küresel zekâ, yerel karar.');
    return tips;
  }

  function runHeadless(cfg, maxTime, dt) {
    const sim = createSim(cfg);
    const step = dt || 1 / 60, mt = maxTime || (cfg.mission.dur + 2);
    while (sim.status === 'running' && sim.t < mt) tickSim(sim, step);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(1),
      laps: sim.lapTimes.map(x => +x.toFixed(1)), seen: sim.cellsSeen };
  }

  function defaultParams() { return { vMax: 1.0, turn: 1.0 }; }

  const API = {
    MISSIONS, DIRS, WBIT, OPP, genMaze, hasWall, flood,
    createSim, tickSim, robotClass, coach, runHeadless, defaultParams,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.FareCore = API;
})();
