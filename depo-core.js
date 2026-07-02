/*
 * RoboForge — Depo Filosu Simülasyon Çekirdeği
 * Pure, dependency-free. Browser (window.DepoCore) + Node (module.exports).
 *
 * Amazon tarzı depo: raf blokları arasında koridorlar, 3-4 AGV, sipariş görevleri.
 * Dersler: (1) KİLİTLENME (deadlock): iki robot dar koridorda burun buruna, ikisi de
 * beklerse SONSUZA DEK beklerler — bilgisayar biliminin en zarif tuzağı,
 * (2) kavşak önceliği bir SÖZLEŞMEDİR: herkes aynı kurala uyarsa akış olur,
 * (3) rezervasyon penceresi: ileriyi çok tutarsan güvenli ama hat tıkanır,
 * az tutarsan hızlı ama çarpışma riski — güven ↔ verim ödünleşimi.
 */
(function () {
  'use strict';

  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const COLORS = ['#38bdf8', '#fbbf24', '#4ade80', '#f472b6'];

  // grid: '.' koridor, '#' raf, 'S' istasyon (teslim), rakam = robot başlangıcı
  const MISSIONS = [
    { id: 'isinma', name: 'Isınma Turu', difficulty: 'Başlangıç', dur: 60, tasks: 4, bots: 1,
      grid: ['0.......',
             '.##.##..',
             '.##.##..',
             '........',
             '.##.##..',
             '.##.##..',
             '...S....'],
      desc: 'Tek robot, dört sipariş: rafa git, kutuyu al, istasyona getir. Trafik yok — akışı tanı.' },
    { id: 'kesisme', name: 'Kesişme', difficulty: 'Başlangıç', dur: 75, tasks: 6, bots: 2,
      grid: ['0.......',
             '.##.##..',
             '.##.##..',
             '........',
             '.##.##..',
             '.##.##..',
             '1..S....'],
      desc: 'İki robot, kesişen rotalar. Kavşakta kim önce geçer? Öncelik kuralın artık bir SÖZLEŞME.' },
    { id: 'darkoridor', name: 'Dar Koridor', difficulty: 'Orta', dur: 90, tasks: 6, bots: 2,
      grid: ['0.......',
             '.######.',
             '........',
             '.######.',
             '1......S'],
      desc: 'Uzun tek şeritli koridorlar: burun buruna gelen iki robottan biri YOL VERMELİ. İkisi de beklerse… kilitlenme!' },
    { id: 'yogun', name: 'Yoğun Sipariş', difficulty: 'Orta', dur: 100, tasks: 10, bots: 3,
      grid: ['0..1..2...',
             '.##..##...',
             '.##..##...',
             '..........',
             '.##..##...',
             '.##..##...',
             '....S.....'],
      desc: 'Üç robot, on sipariş, dar süre. Verim artık kural setinin kalitesi — bekleyen robot para kaybettirir.' },
    { id: 'rafarasi', name: 'Raf Arası', difficulty: 'İleri', dur: 110, tasks: 8, bots: 2,
      grid: ['0.......1',
             '.##.####.',
             '.##......',
             '....####.',
             '.##.####.',
             '.##......',
             '2...S....'],
      desc: 'Çıkmaz raf araları ve tek şeritler karışık: yeniden rota mı, geri çekilme mi? Yanlış politika kilitler.' },
    { id: 'rushhour', name: 'Mesai Sonu', difficulty: 'İleri', dur: 125, tasks: 12, bots: 4,
      grid: ['0..1...2..3.',
             '.##..##..##.',
             '.##..##..##.',
             '............',
             '.##..##..##.',
             '.##..##..##.',
             '.....S......'],
      desc: 'Dört robot aynı anda sahada. Kavşaklar kaynıyor — sözleşmene güven, akışı izle.' },
    { id: 'kabusdepo', name: 'Kâbus Deposu', difficulty: 'Uzman', dur: 155, tasks: 12, bots: 3,
      grid: ['0...1....2',
             '.######.#.',
             '........#.',
             '.######...',
             '.......##.',
             '.######...',
             '......S...'],
      desc: 'Tek şeritler + çıkmazlar + dört robot + on dört sipariş. Deadlock pususu her koridorda. Filoyu sen yönetiyorsun.' },
  ];

  function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function parseGrid(m) {
    const g = m.grid;
    const cells = new Set(); const shelves = []; let station = null; const starts = [];
    for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) {
      const c = g[y][x];
      if (c === '#') { shelves.push([x, y]); continue; }
      cells.add(x + ',' + y);
      if (c === 'S') station = [x, y];
      if (c >= '0' && c <= '9') starts[+c] = [x, y];
    }
    return { cells, shelves, station, starts, w: Math.max(...g.map(r => r.length)), h: g.length };
  }

  // raf hücresine komşu koridor hücresi = alım noktası
  function pickPoints(gr) {
    const pts = [];
    gr.shelves.forEach(([sx, sy]) => {
      DIRS.forEach(([dx, dy]) => {
        const k = (sx + dx) + ',' + (sy + dy);
        if (gr.cells.has(k)) pts.push({ shelf: [sx, sy], at: [sx + dx, sy + dy] });
      });
    });
    return pts;
  }

  function bfs(gr, from, to, blocked) {
    const q = [from]; const key = p => p[0] + ',' + p[1];
    const prev = { [key(from)]: null };
    while (q.length) {
      const cur = q.shift();
      if (cur[0] === to[0] && cur[1] === to[1]) break;
      for (const [dx, dy] of DIRS) {
        const nx = cur[0] + dx, ny = cur[1] + dy;
        const k = nx + ',' + ny;
        if (!gr.cells.has(k) || k in prev) continue;
        if (blocked && blocked.has(k) && !(nx === to[0] && ny === to[1])) continue;
        prev[k] = key(cur); q.push([nx, ny]);
      }
    }
    if (!(key(to) in prev)) return null;
    const path = []; let cur = key(to);
    while (cur) { const [a, b] = cur.split(',').map(Number); path.unshift([a, b]); cur = prev[cur]; }
    return path;
  }

  function createSim(cfg) {
    const m = cfg.mission;
    const gr = parseGrid(m);
    const rnd = lcg(m.id.length * 13 + 7);
    const pts = pickPoints(gr);
    // görev listesi: deterministik raf alım noktaları
    const tasks = [];
    for (let i = 0; i < m.tasks; i++) tasks.push(pts[Math.floor(rnd() * pts.length)]);
    const bots = [];
    for (let i = 0; i < m.bots; i++) {
      bots.push({ id: i, x: gr.starts[i][0], y: gr.starts[i][1],
        px: gr.starts[i][0], py: gr.starts[i][1], tx: gr.starts[i][0], ty: gr.starts[i][1],
        prog: 1, path: null, pi: 0, task: null, carrying: false, wait: 0, done: 0,
        stuckT: 0, replanCd: 0 });
    }
    return {
      cfg, mission: m, gr, t: 0, status: 'running', reason: null,
      bots, tasks, taskIdx: 0, delivered: 0,
      deadT: 0, events: [], lastEvt: {}, totalTicks: 0, waits: 0,
    };
  }
  function pushEvt(sim, key, msg) {
    if (sim.lastEvt[key]) return;
    sim.lastEvt[key] = true;
    sim.events.push([+sim.t.toFixed(1), msg]);
    if (sim.events.length > 50) sim.events.shift();
  }

  function occupiedCells(sim, exceptId) {
    const s = new Set();
    sim.bots.forEach(b => {
      if (b.id === exceptId) return;
      s.add(b.tx + ',' + b.ty);
      s.add(Math.round(b.x) + ',' + Math.round(b.y));
    });
    return s;
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return;
    const m = sim.mission;
    const cfg = sim.cfg;
    const mode = cfg.mode || 'rules';
    const pol = cfg.policy || defaultPolicy();
    const res = cfg.res || defaultRes();
    const speed = 2.0;

    let anyMoved = false;
    sim.bots.forEach(bot => {
      if (bot.replanCd > 0) bot.replanCd -= dt;
      // hücre içi hareket HERKES için önce işler (kenara çekilen boş robot dahil!)
      if (bot.prog < 1) {
        bot.prog = Math.min(1, bot.prog + speed * dt);
        bot.x = bot.px + (bot.tx - bot.px) * bot.prog;
        bot.y = bot.py + (bot.ty - bot.py) * bot.prog;
        anyMoved = true;
        return;
      }
      bot.x = bot.tx; bot.y = bot.ty;
      // görev ata
      if (!bot.task) {
        if (sim.taskIdx < sim.tasks.length) {
          bot.task = sim.tasks[sim.taskIdx++];
          bot.carrying = false;
          bot.path = bfs(sim.gr, [bot.tx, bot.ty], bot.task.at);
          bot.pi = 1;
          pushEvt(sim, 'a' + bot.id + '_' + sim.taskIdx, '📋 AGV-' + (bot.id + 1) + ' sipariş aldı (raf ' + bot.task.at[0] + ',' + bot.task.at[1] + ')');
        } else return;   // iş yok
      }
      // hedefe vardı mı? (teslimat istasyona KOMŞU hücrede de sayılır — rampa ağzı)
      const goal = bot.carrying ? sim.gr.station : bot.task.at;
      const atGoal = bot.carrying
        ? (Math.abs(bot.tx - goal[0]) + Math.abs(bot.ty - goal[1]) <= 1)
        : (bot.tx === goal[0] && bot.ty === goal[1]);
      if (atGoal) {
        if (!bot.carrying) {
          bot.carrying = true;
          bot.path = bfs(sim.gr, [bot.tx, bot.ty], sim.gr.station);
          bot.pi = 1;
          pushEvt(sim, 'p' + bot.id + '_' + Math.round(sim.t), '📦 AGV-' + (bot.id + 1) + ' kutuyu aldı');
        } else {
          sim.delivered++;
          pushEvt(sim, 'd' + sim.delivered, '✅ Teslimat ' + sim.delivered + '/' + m.tasks + ' (AGV-' + (bot.id + 1) + ')');
          bot.task = null; bot.carrying = false; bot.path = null;
        }
        anyMoved = true;
        return;
      }
      if (!bot.path || bot.pi >= bot.path.length) {
        bot.path = bfs(sim.gr, [bot.tx, bot.ty], goal);
        bot.pi = 1;
        if (!bot.path) return;
      }
      const next = bot.path[bot.pi];
      const nk = next[0] + ',' + next[1];
      // ---- çakışma çözümü ----
      const occ = occupiedCells(sim, bot.id);
      let blockedBy = null;
      sim.bots.forEach(o => {
        if (o.id === bot.id) return;
        if ((o.tx === next[0] && o.ty === next[1]) || (Math.round(o.x) === next[0] && Math.round(o.y) === next[1])) blockedBy = o;
      });
      // rezervasyon modu: ileri N hücreyi kontrol et
      if (mode === 'res' && !blockedBy) {
        for (let k = 1; k <= (res.pencere || 2) && bot.pi + k - 1 < bot.path.length; k++) {
          const c = bot.path[bot.pi + k - 1];
          sim.bots.forEach(o => {
            if (o.id === bot.id) return;
            // diğerinin rezervasyonu ile çakışma
            if (o.path) {
              for (let j = 0; j <= (res.pencere || 2) && o.pi + j - 1 < o.path.length; j++) {
                const oc = o.path[o.pi + j - 1];
                if (oc && oc[0] === c[0] && oc[1] === c[1]) {
                  // öncelik: küçük id kazanır (rezervasyon sözleşmesi)
                  if (o.id < bot.id) blockedBy = o;
                }
              }
            }
          });
        }
      }
      if (blockedBy) {
        bot.wait += dt; sim.waits += dt;
        const blockerIdle = !blockedBy.task;
        const headOn = blockedBy.task && blockedBy.path && blockedBy.path[blockedBy.pi] &&
          blockedBy.path[blockedBy.pi][0] === bot.tx && blockedBy.path[blockedBy.pi][1] === bot.ty;
        const canResolve = mode === 'rules' ? (pol.darKoridor !== 'bekle') : !!res.yenidenRota;
        let yield_ = false;
        if (pol.oncelik === 'yuklu') yield_ = (blockedBy.carrying && !bot.carrying) || (blockedBy.carrying === bot.carrying && bot.id > blockedBy.id);
        else yield_ = bot.id > blockedBy.id;
        const tryReplan = (avoidSet, tag) => {
          occ.forEach(c => avoidSet.add(c));            // TÜM dolu hücrelerden kaçın
          const alt = bfs(sim.gr, [bot.tx, bot.ty], goal, avoidSet);
          if (alt && alt.length > 1) { bot.path = alt; bot.pi = 1; bot.replanCd = 1.0 + bot.id * 0.3; bot.wait = 0; sim.progressed = true;
            pushEvt(sim, tag + bot.id + '_' + Math.round(sim.t), '🔀 AGV-' + (bot.id + 1) + ' yeniden rota'); return true; }
          return false;
        };
        const backOff = () => {
          const back = [bot.px, bot.py];
          if (back[0] === bot.tx && back[1] === bot.ty) return false;
          const occ2 = occupiedCells(sim, bot.id);
          if (occ2.has(back[0] + ',' + back[1])) return false;
          const rest = bfs(sim.gr, back, goal);
          bot.path = [[bot.tx, bot.ty], back].concat(rest ? rest.slice(1) : []);
          bot.pi = 1; bot.replanCd = 1.0 + bot.id * 0.3; bot.wait = 0; sim.progressed = true;
          pushEvt(sim, 'bk' + bot.id + '_' + Math.round(sim.t), '↩️ AGV-' + (bot.id + 1) + ' geri çekiliyor');
          return true;
        };
        if (blockerIdle) {
          // boştaki robot kenara çekilecek (aşağıda) — çok beklersek etrafından dolan
          if (bot.wait > 1.4 && bot.replanCd <= 0) { if (!tryReplan(new Set([nk]), 'ri')) backOff(); }
        } else if (headOn) {
          if (canResolve && yield_ && bot.replanCd <= 0) {
            const avoid = new Set([blockedBy.tx + ',' + blockedBy.ty, nk]);
            if (!tryReplan(avoid, 'rr')) backOff();
          }
          // 'bekle' politikası: ikisi de bekler → kilitlenme dersi
        } else {
          // kuyruk beklemesi: öndeki ilerliyor olmalı; uzarsa dolan
          if (bot.wait > 2.2 && canResolve && bot.replanCd <= 0) { if (!tryReplan(new Set([nk]), 'rq')) backOff(); }
        }
        return;
      }
      bot.wait = 0;
      // ilerle
      bot.px = bot.tx; bot.py = bot.ty;
      bot.tx = next[0]; bot.ty = next[1];
      bot.prog = 0; bot.pi++;
      anyMoved = true;
    });

    // ---- boştaki robot kenara çekilir ----
    sim.bots.forEach(idle => {
      if (idle.task || idle.prog < 1) return;
      const wanted = sim.bots.some(o => o.task && o.path &&
        o.path.slice(o.pi, o.pi + 3).some(c => c[0] === idle.tx && c[1] === idle.ty));
      if (!wanted) return;
      const occ3 = occupiedCells(sim, idle.id);
      for (const [dx, dy] of DIRS) {
        const nx = idle.tx + dx, ny = idle.ty + dy;
        const k = nx + ',' + ny;
        if (!sim.gr.cells.has(k) || occ3.has(k)) continue;
        // aktif rotaların üstüne çekilme (mümkünse)
        const onPath = sim.bots.some(o => o.task && o.path && o.path.slice(o.pi, o.pi + 2).some(c => c[0] === nx && c[1] === ny));
        if (onPath) continue;
        idle.px = idle.tx; idle.py = idle.ty; idle.tx = nx; idle.ty = ny; idle.prog = 0;
        anyMoved = true;
        pushEvt(sim, 'sa' + idle.id + '_' + Math.round(sim.t), '🚶 AGV-' + (idle.id + 1) + ' kenara çekildi');
        return;
      }
      // hiçbir yer yoksa: rota üstüne bile olsa çekil
      for (const [dx, dy] of DIRS) {
        const nx = idle.tx + dx, ny = idle.ty + dy;
        const k = nx + ',' + ny;
        if (!sim.gr.cells.has(k) || occ3.has(k)) continue;
        idle.px = idle.tx; idle.py = idle.ty; idle.tx = nx; idle.ty = ny; idle.prog = 0;
        anyMoved = true;
        return;
      }
    });

    // ---- kilitlenme algılama ----
    const activeBots = sim.bots.filter(b => b.task);
    if (activeBots.length && !anyMoved && !sim.progressed) sim.deadT += dt; else sim.deadT = 0;
    sim.progressed = false;
    if (sim.deadT > 4) {
      sim.status = 'failed'; sim.reason = 'kilitlenme';
      pushEvt(sim, 'dl', '💀 KİLİTLENME! Robotlar birbirini bekliyor — kimse kıpırdamıyor. Klasik deadlock.');
      return;
    }

    sim.totalTicks++;
    sim.t += dt;
    if (sim.delivered >= m.tasks) { sim.status = 'success'; sim.reason = 'vardiya'; return; }
    if (sim.t > m.dur) { sim.status = 'failed'; sim.reason = 'sure'; }
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const tScore = Math.max(0, 100 - sim.t / sim.mission.dur * 88);
    const waitPen = sim.waits / Math.max(1, sim.t) * 100;
    const total = tScore * 0.7 + Math.max(0, 100 - waitPen * 2) * 0.3;
    if (total > 62) return { name: '🏆 Lojistik Beyni', cmt: 'Filo saat gibi işledi: sıfır kilitlenme, akan kavşaklar, erken paydos. Depo müdürü seni arıyor!' };
    if (total > 40) return { name: '🥈 Vardiya Amiri', cmt: 'Siparişler tamam. Bekleme süresi ' + sim.waits.toFixed(0) + ' sn — politikayı incelt, akış artar.' };
    return { name: '🥉 Stajyer Sevkiyatçı', cmt: 'Ucu ucuna yetişti. Robotlar birbirine çok takıldı — kavşak sözleşmesini gözden geçir.' };
  }
  function coach(sim) {
    const tips = [];
    const r = sim.reason || '';
    if (r === 'kilitlenme') tips.push('Deadlock! Dar koridorda burun buruna gelen iki robot, ikisi de "bekle" politikasındaysa SONSUZA DEK bekler. Çözüm: biri yol vermeli — "yeniden rota" ya da "geri çekil" politikası seç. Bilgisayar bilimi bunu 60 yıldır öğretir: döngüsel bekleme kırılmalı.');
    if (r === 'sure') tips.push('Süre doldu. Bekleme toplamı ' + sim.waits.toFixed(0) + ' sn — robotlar çok bekleşmiş. Rezervasyon penceresini küçült ya da öncelik kuralını netleştir: kararsızlık en pahalı politikadır.');
    if (!tips.length && sim.waits > sim.t * 0.3) tips.push('Kazandın ama filo zamanının üçte birini bekleyerek geçirdi. Yüklü robot önceliği dene: teslimata gideni bekletmek çifte kayıptır.');
    if (!tips.length) tips.push('Rezervasyon penceresi ödünleşimi: geniş pencere çarpışmayı imkânsızlaştırır ama koridorları kilitler; dar pencere akıcıdır ama burun buruna riskini artırır. Güven ↔ verim.');
    return tips;
  }

  function runHeadless(cfg, maxTime, dt) {
    const sim = createSim(cfg);
    const step = dt || 1 / 30, mt = maxTime || (cfg.mission.dur + 2);
    while (sim.status === 'running' && sim.t < mt) tickSim(sim, step);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(1),
      delivered: sim.delivered, waits: +sim.waits.toFixed(1) };
  }

  function defaultPolicy() { return { oncelik: 'yuklu', darKoridor: 'yolver' }; }
  function defaultRes() { return { pencere: 2, yenidenRota: true }; }

  const API = {
    DIRS, COLORS, MISSIONS, parseGrid, pickPoints, bfs,
    createSim, tickSim, robotClass, coach, runHeadless, defaultPolicy, defaultRes,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.DepoCore = API;
})();
