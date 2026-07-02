/*
 * RoboForge — Robot Kol Simülasyon Çekirdeği
 * Pure, dependency-free. Browser (window.KolCore) + Node (module.exports).
 *
 * 2 eklemli düzlemsel kol (omuz + dirsek) + kıskaç. Yandan görünüm, masa üstü.
 * Dersler: (1) ileri kinematik — açılar uç noktayı NEREYE götürür,
 * (2) ters kinematik — hedefe giden İKİ çözüm var (dirsek yukarı/aşağı),
 * erişim sınırları (çok uzak / çok yakın nokta ÇÖZÜMSÜZ),
 * (3) servo gerçekliği — açılar ışınlanmaz, hızla döner; ağır yük SARKMA yapar,
 * (4) istifleme — yüksekten bırakılan kutu DEVRİLİR; nazik ol.
 */
(function () {
  'use strict';

  const L1 = 1.0, L2 = 0.8;          // uzuv boyları (m)
  const BASE = { x: 0, y: 0.10 };    // omuz mafsalı (masa üstünde küçük kaide)
  const TABLE_Y = 0;
  const SERVO_W = 1.6;               // rad/s taban servo hızı (build ile çarpılır)
  const GRAB_R = 0.12;               // kıskaç yakalama yarıçapı
  const DROP_SAFE = 0.22;            // güvenli bırakma yüksekliği (üstü = devrilme riski)
  const OBJ_H = 0.14;                // kutu kenarı
  const TH1_MIN = 0.05, TH1_MAX = Math.PI - 0.05;
  const TH2_MIN = -2.6, TH2_MAX = 2.6;

  // ---- kinematik ------------------------------------------------------------
  function fk(th1, th2) {
    const ex = BASE.x + L1 * Math.cos(th1), ey = BASE.y + L1 * Math.sin(th1);
    return { elbow: { x: ex, y: ey },
      ee: { x: ex + L2 * Math.cos(th1 + th2), y: ey + L2 * Math.sin(th1 + th2) } };
  }
  // ters kinematik: hedef (x,y), config 'up' | 'down' → {th1,th2} | null
  function ik(x, y, config) {
    const dx = x - BASE.x, dy = y - BASE.y;
    const d2 = dx * dx + dy * dy, d = Math.sqrt(d2);
    if (d > L1 + L2 - 1e-6 || d < Math.abs(L1 - L2) + 1e-6) return null;
    const c2 = (d2 - L1 * L1 - L2 * L2) / (2 * L1 * L2);
    if (c2 < -1 || c2 > 1) return null;
    let th2 = Math.acos(c2);
    if (config !== 'down') th2 = -th2;          // 'up' = dirsek yukarı (negatif iç açı)
    const k1 = L1 + L2 * Math.cos(th2), k2 = L2 * Math.sin(th2);
    const th1 = Math.atan2(dy, dx) - Math.atan2(k2, k1);
    if (th1 < TH1_MIN || th1 > TH1_MAX || th2 < TH2_MIN || th2 > TH2_MAX) {
      // diğer konfigürasyonu dene (sınır aşımı)
      if (config === undefined) return null;
      return null;
    }
    return { th1, th2 };
  }

  // ---- görevler ---------------------------------------------------------------
  // obj: {x, w(eight kg)} — masada dururlar; zone: {x, tol} hedef bölge; stack: üst üste sıra
  // obstacles: [{x,y,w,h}] dikdörtgen engeller
  const MISSIONS = [
    { id: 'dokunus', name: 'İlk Dokunuş', difficulty: 'Başlangıç', dur: 40,
      objs: [{ x: 1.30, w: 0.2 }], zones: [{ x: -1.10, tol: 0.16 }], obstacles: [], stackGoal: null,
      desc: 'Tek kutu: sağdan al, sola bırak. Açıların dansını öğren — omuz kaldırır, dirsek uzanır.' },
    { id: 'ikikutu', name: 'İki Kutu', difficulty: 'Başlangıç', dur: 60,
      objs: [{ x: 1.25, w: 0.2 }, { x: 1.52, w: 0.2 }], zones: [{ x: -1.00, tol: 0.15 }, { x: -1.40, tol: 0.15 }],
      obstacles: [], stackGoal: null,
      desc: 'İki kutu, iki bölge, sıra sende. Program uzuyor — adımların ekonomisini düşün.' },
    { id: 'istif', name: 'İstifleme', difficulty: 'Orta', dur: 60,
      objs: [{ x: 1.30, w: 0.2 }, { x: 1.60, w: 0.2 }], zones: [{ x: -1.10, tol: 0.15 }],
      obstacles: [], stackGoal: 2,
      desc: 'İki kutuyu AYNI bölgeye üst üste koy. Yüksekten bırakırsan üsttteki DEVRİLİR — nazik bırakış sanatı.' },
    { id: 'raf', name: 'Engelli Raf', difficulty: 'Orta', dur: 60,
      objs: [{ x: 1.45, w: 0.2 }], zones: [{ x: -1.15, tol: 0.15 }],
      obstacles: [{ x: 1.18, y: 0.80, w: 0.66, h: 0.10 }], stackGoal: null,
      desc: 'Kutu bir rafın ALTINDA! Yukarıdan dalış rafa çarpar — yandan, alçaktan gir, nazikçe geri çek. Erişim sanatı.' },
    { id: 'agir', name: 'Ağır Yük', difficulty: 'İleri', dur: 60,
      objs: [{ x: 1.35, w: 0.85 }], zones: [{ x: -1.05, tol: 0.15 }],
      obstacles: [], stackGoal: null,
      desc: 'Kutu ağır: servo SARKAR, uç nokta hedeflediğinden aşağı düşer. Telafi et — daha yukarıyı hedefle!' },
    { id: 'dizilim', name: 'Hassas Dizilim', difficulty: 'İleri', dur: 90,
      objs: [{ x: 1.20, w: 0.2 }, { x: 1.42, w: 0.2 }, { x: 1.62, w: 0.2 }],
      zones: [{ x: -0.85, tol: 0.10 }, { x: -1.16, tol: 0.10 }, { x: -1.47, tol: 0.10 }],
      obstacles: [], stackGoal: null,
      desc: 'Üç kutu, üç DAR bölge (±10 cm). Hassasiyet: yavaş yaklaş, doğru bırak.' },
    { id: 'vardiya', name: 'Kâbus Vardiyası', difficulty: 'Uzman', dur: 110,
      objs: [{ x: 1.30, w: 0.2 }, { x: 1.58, w: 0.75 }],
      zones: [{ x: -1.15, tol: 0.13 }],
      obstacles: [{ x: 1.15, y: 0.80, w: 0.62, h: 0.10 }], stackGoal: 2,
      desc: 'Hepsi birden: raf engeli + ağır kutu + istifleme + süre. Fabrika vardiyası böyle geçer.' },
  ];

  // ---- program adımları -------------------------------------------------------
  // joint modu: ['ACI', th1_deg, th2_deg] | ['TUT'] | ['BIRAK'] | ['BEKLE', s]
  // hedef modu: ['GIT', x, y, 'up'|'down'] | ['TUT'] | ['BIRAK'] | ['BEKLE', s]

  function createSim(cfg) {
    const m = cfg.mission;
    const p = cfg.params || defaultParams();
    return {
      cfg, mission: m, t: 0, status: 'running', reason: null,
      th1: Math.PI / 2, th2: -1.2,                     // park pozisyonu (yukarı katlanmış)
      tg1: Math.PI / 2, tg2: -1.2,                     // hedef açılar
      grip: 0, carrying: -1,                            // taşınan obj index
      stepIdx: 0, stepT: 0, settled: 0,
      objs: m.objs.map((o, i) => ({ x: o.x, y: OBJ_H / 2, w: o.w, vy: 0, falling: false, toppled: false, stackOn: -1 })),
      drops: 0, topples: 0,
      sag: 0, eeTrace: [], events: [], lastEvt: {},
      totalTicks: 0, maxErr: 0, placedAt: [],
    };
  }
  function pushEvt(sim, key, msg) {
    if (sim.lastEvt[key]) return;
    sim.lastEvt[key] = true;
    sim.events.push([+sim.t.toFixed(1), msg]);
    if (sim.events.length > 50) sim.events.shift();
  }
  function clearEvt(sim, key) { sim.lastEvt[key] = false; }

  function segRectHit(a, b, r) {
    // kaba: segmenti örnekle
    for (let s = 0; s <= 1; s += 0.08) {
      const x = a.x + (b.x - a.x) * s, y = a.y + (b.y - a.y) * s;
      if (x > r.x - r.w / 2 && x < r.x + r.w / 2 && y > r.y - r.h / 2 && y < r.y + r.h / 2) return true;
    }
    return false;
  }

  function currentStep(sim) {
    const prog = sim.cfg.program || [];
    return sim.stepIdx < prog.length ? prog[sim.stepIdx] : null;
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return;
    const m = sim.mission;
    const p = sim.cfg.params || defaultParams();
    const mode = sim.cfg.mode || 'joint';

    // ---- program yorumlayıcı ----
    const step = currentStep(sim);
    if (step) {
      sim.stepT += dt;
      const [op] = step;
      if (op === 'ACI' || op === 'GIT') {
        if (op === 'ACI') {
          sim.tg1 = Math.max(TH1_MIN, Math.min(TH1_MAX, step[1] * Math.PI / 180));
          sim.tg2 = Math.max(TH2_MIN, Math.min(TH2_MAX, step[2] * Math.PI / 180));
        } else {
          const sol = ik(step[1], step[2], step[3] || 'up');
          if (!sol) {
            sim.status = 'failed'; sim.reason = 'erisim';
            pushEvt(sim, 'ik', '🚫 IK çözümsüz: (' + step[1] + ', ' + step[2] + ') erişim dışında!');
            return;
          }
          sim.tg1 = sol.th1; sim.tg2 = sol.th2;
        }
        // hedefe oturdu mu?
        const e1 = Math.abs(sim.th1 - sim.tg1), e2 = Math.abs(sim.th2 - sim.tg2);
        if (e1 < 0.02 && e2 < 0.02) { sim.settled += dt; if (sim.settled > 0.15) { sim.stepIdx++; sim.stepT = 0; sim.settled = 0; } }
        else sim.settled = 0;
      } else if (op === 'TUT') {
        sim.grip = 1;
        // yakala: en yakın taşınmayan obje
        if (sim.carrying < 0) {
          const eePos = eeWithSag(sim, p);
          let best = -1, bd = GRAB_R;
          sim.objs.forEach((o, i) => {
            if (o.toppled) return;
            const d = Math.hypot(o.x - eePos.x, (o.y) - eePos.y);
            if (d < bd) { bd = d; best = i; }
          });
          if (best >= 0) { sim.carrying = best; pushEvt(sim, 'g' + best, '🤏 Kutu ' + (best + 1) + ' kavrandı'); }
          else pushEvt(sim, 'gmiss' + sim.stepIdx, '🫳 Kıskaç BOŞ kapandı — kutu menzilde değil (' + GRAB_R.toFixed(2) + ' m)');
        }
        sim.stepIdx++; sim.stepT = 0;
      } else if (op === 'BIRAK') {
        sim.grip = 0;
        if (sim.carrying >= 0) {
          const o = sim.objs[sim.carrying];
          o.falling = true; o.vy = 0;
          sim.drops++;
          sim.carrying = -1;
        }
        sim.stepIdx++; sim.stepT = 0;
      } else if (op === 'BEKLE') {
        if (sim.stepT >= (step[1] || 0.5)) { sim.stepIdx++; sim.stepT = 0; }
      } else { sim.stepIdx++; }
    }

    // ---- servo dinamiği ----
    const w = SERVO_W * (p.servo || 1);
    const d1 = sim.tg1 - sim.th1, d2 = sim.tg2 - sim.th2;
    sim.th1 += Math.max(-w * dt, Math.min(w * dt, d1));
    sim.th2 += Math.max(-w * 1.25 * dt, Math.min(w * 1.25 * dt, d2));

    // ---- sarkma (ağır yük + servo gücü) ----
    const load = sim.carrying >= 0 ? sim.objs[sim.carrying].w : 0;
    const sagT = load * 0.28 / (p.power || 1);
    sim.sag += (sagT - sim.sag) * Math.min(1, 5 * dt);
    if (sagT > 0.12) pushEvt(sim, 'sag', '⚠️ Ağır yük — kol ' + Math.round(sim.sag * 100) + ' cm sarkıyor!');
    else clearEvt(sim, 'sag');

    const kin = fk(sim.th1, sim.th2);
    const sagX = sim.sag * 0.8 * Math.sign(kin.ee.x - BASE.x);
    const ee = { x: kin.ee.x - sagX, y: kin.ee.y - sim.sag };

    // ---- çarpışma ----
    if (kin.elbow.y < TABLE_Y + 0.02 || ee.y < TABLE_Y - 0.01) {
      sim.status = 'failed'; sim.reason = 'masa';
      pushEvt(sim, 'crash', '💥 Kol masaya çarptı!'); return;
    }
    for (const r of m.obstacles) {
      if (segRectHit(BASE, kin.elbow, r) || segRectHit(kin.elbow, ee, r)) {
        sim.status = 'failed'; sim.reason = 'engel';
        pushEvt(sim, 'crash', '💥 Kol rafa çarptı! Dirsek konfigürasyonunu değiştir.'); return;
      }
    }

    // ---- objeler ----
    sim.objs.forEach((o, i) => {
      if (i === sim.carrying) { o.x = ee.x; o.y = ee.y; return; }
      if (o.falling) {
        o.vy -= 9.8 * dt;
        o.y += o.vy * dt;
        // zemine / istife oturma
        let floor = OBJ_H / 2;
        sim.objs.forEach((u, j) => {
          if (j === i || u.falling || j === sim.carrying || u.toppled) return;
          if (Math.abs(u.x - o.x) < OBJ_H * 0.85 && u.y + OBJ_H / 2 + OBJ_H / 2 > floor && o.y > u.y) {
            floor = u.y + OBJ_H;
            o.stackOn = j;
          }
        });
        if (o.y <= floor) {
          const impact = Math.abs(o.vy);
          o.y = floor; o.vy = 0; o.falling = false;
          const dropH = impact * impact / (2 * 9.8);
          if (o.stackOn >= 0 && dropH > DROP_SAFE) {
            o.toppled = true; o.x += 0.30; o.y = OBJ_H / 2; o.stackOn = -1;
            sim.topples++;
            pushEvt(sim, 'top' + i, '🫨 Kutu ' + (i + 1) + ' DEVRİLDİ — ' + Math.round(dropH * 100) + ' cm yüksekten bırakıldı (güvenli: ' + Math.round(DROP_SAFE * 100) + ' cm)');
          } else if (dropH > DROP_SAFE * 1.8) {
            o.toppled = true; o.x += 0.24; sim.topples++;
            pushEvt(sim, 'top' + i, '🫨 Kutu ' + (i + 1) + ' sekti ve DEVRİLDİ — çok yüksekten düştü!');
          } else {
            pushEvt(sim, 'set' + i + '_' + Math.round(sim.t), '📦 Kutu ' + (i + 1) + ' yerleşti (x=' + o.x.toFixed(2) + ')');
          }
        }
      }
    });

    // ---- iz + zaman ----
    sim.totalTicks++;
    if (sim.totalTicks % 4 === 0) {
      sim.eeTrace.push([ee.x, ee.y, sim.carrying >= 0 ? 1 : 0]);
      if (sim.eeTrace.length > 2600) sim.eeTrace.shift();
    }
    sim.t += dt;

    // ---- bitiş kontrolü ----
    const progDone = sim.stepIdx >= (sim.cfg.program || []).length;
    const allSettled = sim.objs.every(o => !o.falling) && sim.carrying < 0;
    if (progDone && allSettled) {
      const ok = missionOk(sim);
      if (ok.done) { sim.status = 'success'; sim.reason = 'tamam'; }
      else if (sim.t > m.dur * 0.5 || progDone) { sim.status = 'failed'; sim.reason = ok.why; }
    }
    if (sim.t > m.dur) { sim.status = 'failed'; sim.reason = 'sure'; }
    sim.eeNow = ee;
  }

  function eeWithSag(sim, p) {
    const kin = fk(sim.th1, sim.th2);
    const sagX = sim.sag * 0.8 * Math.sign(kin.ee.x - BASE.x);
    return { x: kin.ee.x - sagX, y: kin.ee.y - sim.sag };
  }

  function missionOk(sim) {
    const m = sim.mission;
    if (sim.objs.some(o => o.toppled)) return { done: false, why: 'devrildi' };
    if (m.stackGoal) {
      // stackGoal kadar kutu aynı bölgede üst üste
      const z = m.zones[0];
      const inZone = sim.objs.filter(o => Math.abs(o.x - z.x) < z.tol + OBJ_H * 0.4);
      if (inZone.length < m.stackGoal) return { done: false, why: 'eksik' };
      const heights = inZone.map(o => Math.round(o.y / OBJ_H * 2));
      const uniq = new Set(heights);
      if (uniq.size < m.stackGoal) return { done: false, why: 'istif' };
      return { done: true };
    }
    // her bölgede bir kutu
    for (const z of m.zones) {
      const found = sim.objs.some(o => Math.abs(o.x - z.x) <= z.tol && o.y < OBJ_H);
      if (!found) return { done: false, why: 'eksik' };
    }
    return { done: true };
  }

  // ---- değerlendirme ----------------------------------------------------------
  function precision(sim) {
    const m = sim.mission;
    let s = 0, n = 0;
    for (const z of m.zones) {
      let best = 1e9;
      sim.objs.forEach(o => { const d = Math.abs(o.x - z.x); if (d < best) best = d; });
      s += Math.max(0, 100 - best / Math.max(0.05, z.tol) * 60); n++;
    }
    return Math.round(s / Math.max(1, n));
  }
  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const pr = precision(sim);
    const tScore = Math.max(0, 100 - sim.t / sim.mission.dur * 90);
    const total = pr * 0.6 + tScore * 0.4;
    if (total > 72 && sim.topples === 0) return { name: '🏆 Usta Operatör', cmt: 'Milimetrik yerleştirme, akıcı hareket, sıfır kaza. Fabrika senin!' };
    if (total > 52) return { name: '🥈 Vinç Ustası', cmt: 'İş tamam. Madalya için: bırakma noktalarını bölge merkezine yaklaştır, boş hareketleri kırp.' };
    return { name: '🥉 Stajyer Operatör', cmt: 'Görev bitti ama tornavida titredi. Yaklaşma adımlarını yavaşlat, açıları ince ayarla.' };
  }
  function coach(sim) {
    const tips = [];
    const r = sim.reason || '';
    if (r === 'masa') tips.push('Kol masaya çarptı. Kutuya İNERKEN iki aşama kullan: önce üstüne gel (yüksek), sonra dik in. Tek hamlede çapraz dalış = çarpma.');
    if (r === 'engel') tips.push('Raf yolu kesiyor ama aynı noktaya İKİ dirsek çözümü var: dirsek YUKARI konfigürasyon rafın üstünden aşar. Hedef modunda her adımda config seçebilirsin.');
    if (r === 'erisim') tips.push('O nokta kolun erişim halkasının dışında! Maksimum uzanma = ' + (L1 + L2).toFixed(1) + ' m, minimum = ' + Math.abs(L1 - L2).toFixed(1) + ' m. Hedefi halkaya çek.');
    if (r === 'devrildi') tips.push('Kutu devrildi çünkü yüksekten bırakıldı. Güvenli bırakma: kutunun oturacağı yüzeyin ' + Math.round(DROP_SAFE * 100) + ' cm üstünden alçakta. İstifte üst kutu için bırakma yüksekliğini yeniden hesapla!');
    if (r === 'eksik') tips.push('Program bitti ama kutular hedef bölgelerde değil. Kayıt defterinde her kutunun nereye yerleştiğini gör — sapma varsa SARKMAYI telafi et (ağır yükte daha yukarıyı hedefle).');
    if (r === 'istif') tips.push('Kutular aynı bölgede ama üst üste değil. İkinci kutuyu ilkinin TAM üstüne bırak: aynı x, bir kutu boyu yukarıdan nazikçe.');
    if (r === 'sure') tips.push('Süre doldu. Boş BEKLE adımlarını kırp, ara noktaları azalt — ama hassas bırakışlardan çalma!');
    if (sim.topples > 0 && !tips.length) tips.push('Devrilen kutu görevden puan götürür. Bırakma yüksekliğini düşür.');
    if (!tips.length) tips.push('Uç nokta izini raporda incele: keskin köşeler zaman kaybıdır, akıcı yaylar hızlıdır. Ağır yükte sarkma izini gör — telafi sanattır.');
    return tips;
  }

  function runHeadless(cfg, maxTime, dt) {
    const sim = createSim(cfg);
    const step = dt || 1 / 60, mt = maxTime || (cfg.mission.dur + 3);
    while (sim.status === 'running' && sim.t < mt) tickSim(sim, step);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(1),
      precision: precision(sim), topples: sim.topples, steps: (cfg.program || []).length };
  }

  // ---- seviye başına hazır programlar (varsayılan build ile 7/7 geçer) --------
  // JOINT modu programları: kaba IK'yı bizim yerimize ik() çözer → açı adımlarına çevir
  function jointProgFor(mission) {
    // hedef modundaki planı açı adımlarına derle (öğrenciye "açı programı" olarak görünür)
    const plan = taskProgFor(mission);
    const prog = [];
    for (const st of plan) {
      if (st[0] === 'GIT') {
        const sol = ik(st[1], st[2], st[3]);
        if (sol) prog.push(['ACI', +(sol.th1 * 180 / Math.PI).toFixed(0), +(sol.th2 * 180 / Math.PI).toFixed(0)]);
      } else prog.push(st.slice());
    }
    return prog;
  }
  function yMaxAt(x) { return BASE.y + Math.sqrt(Math.max(0, Math.pow(L1 + L2 - 0.07, 2) - Math.pow(x - BASE.x, 2))); }
  function cfgFor(x) { return x < BASE.x ? 'down' : 'up'; }   // dirsek görsel olarak hep YUKARIDA
  function taskProgFor(mission) {
    const P = [];
    const hasObs = mission.obstacles.length > 0;
    const lift = hasObs ? 0.90 : 0.55;
    const zY = OBJ_H / 2 + 0.13;                          // bırakma yüksekliği (güvenli düşüş)
    const sagComp = o => Math.min(0.30, (o.w || 0.2) * 0.28);
    const capY = (x, y) => Math.max(0.16, Math.min(y, yMaxAt(x) - 0.04));
    mission.objs.forEach((o, i) => {
      const zone = mission.zones[Math.min(i, mission.zones.length - 1)];
      const stackH = mission.stackGoal && i > 0 ? OBJ_H * i : 0;
      const comp = sagComp(o);
      const cA = cfgFor(o.x), cB = cfgFor(zone.x);
      if (hasObs) {
        P.push(['GIT', 0.35, 1.05, 'up']);                                              // sola çekil (raf hizasından uzak)
        P.push(['GIT', 0.58, 0.42, 'up']);                                              // raf ağzına alçal
        P.push(['GIT', +o.x.toFixed(2), 0.40, cA]);                                     // raf altına uzan
      } else {
        P.push(['GIT', +o.x.toFixed(2), +capY(o.x, 0.50).toFixed(2), cA]);              // kutunun üstüne gel
      }
      P.push(['GIT', +o.x.toFixed(2), +(OBJ_H / 2 + 0.02).toFixed(2), cA]);             // dik in
      P.push(['TUT']);
      if (hasObs) {
        P.push(['GIT', +o.x.toFixed(2), 0.40, cA]);                                     // raf altında yüksel
        P.push(['GIT', 0.58, +(0.42 + comp).toFixed(2), 'up']);                          // yandan geri çek
        P.push(['GIT', 0.30, +capY(0.30, 1.00).toFixed(2), 'up']);                       // raf solunda yüksel
      } else {
        P.push(['GIT', +o.x.toFixed(2), +capY(o.x, lift + comp).toFixed(2), cA]);       // kaldır (sarkma telafili)
      }
      const zx = +(zone.x + Math.sign(zone.x - BASE.x) * comp * 0.8).toFixed(2);        // sarkma x-telafisi (dışarı hedefle)
      P.push(['GIT', zx, +capY(zx, 0.55 + comp).toFixed(2), cB]);                        // taşı
      P.push(['GIT', zx, +(zY + stackH + comp).toFixed(2), cB]);                         // alçal
      P.push(['BIRAK']);
      P.push(['GIT', +zone.x.toFixed(2), +capY(zone.x, 0.55).toFixed(2), cB]);          // çekil
    });
    return P;
  }
  function defaultParams() { return { servo: 1.0, power: 1.0 }; }

  const API = {
    L1, L2, BASE, TABLE_Y, SERVO_W, GRAB_R, DROP_SAFE, OBJ_H,
    TH1_MIN, TH1_MAX, TH2_MIN, TH2_MAX,
    MISSIONS, fk, ik, createSim, tickSim, missionOk, precision, robotClass, coach, runHeadless,
    jointProgFor, taskProgFor, defaultParams,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.KolCore = API;
})();
