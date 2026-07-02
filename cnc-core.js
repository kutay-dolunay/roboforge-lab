/*
 * RoboForge — CNC Çizici Simülasyon Çekirdeği
 * Pure, dependency-free. Browser (window.CncCore) + Node (module.exports).
 *
 * 2 eksenli gantry + kalem. Dersler: (1) G-code mantığı — makine ADIM listesi
 * yürütür, (2) hız ↔ kalite: hızlı eksen köşeleri YUVARLAR (takip gecikmesi),
 * (3) BACKLASH: dişli boşluğu yön değişiminde ölü bant yaratır — telafi edilir,
 * (4) köşe yavaşlama: akıllı hız profili hem hızlı hem keskindir.
 */
(function () {
  'use strict';

  const PAPER = { w: 10, h: 7 };
  const BACKLASH = 0.15;          // dişli boşluğu (birim — yıpranmış makine!)
  const COV_TOL = 0.12;           // hedef örnekleri bu mesafede çizilmişse "kapsandı"
  const EXTRA_TOL = 0.28;         // hedeften bu kadar uzak mürekkep "fazlalık"

  // ---- şekiller (hedef poliline listeleri; her poliline = kalem-aşağı segmenti) -----
  function star(cx, cy, R, r, n) {
    const pts = [];
    for (let i = 0; i <= n * 2; i++) {
      const a = -Math.PI / 2 + i * Math.PI / n;
      const rr = i % 2 === 0 ? R : r;
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
    return pts;
  }
  const MISSIONS = [
    { id: 'kare', name: 'Kare', difficulty: 'Başlangıç', dur: 40, covMin: 86, extraMax: 12,
      shape: [[[3, 2], [7, 2], [7, 6], [3, 6], [3, 2]]],
      desc: 'Dört çizgi, dört köşe. Ama köşeler KESKİN mi? Hız takip gecikmesi köşeleri yuvarlar — kaliteyle tanış.' },
    { id: 'ucgen', name: 'Üçgen', difficulty: 'Başlangıç', dur: 40, covMin: 86, extraMax: 12,
      shape: [[[5, 1.6], [8, 5.8], [2, 5.8], [5, 1.6]]],
      desc: 'Eğik çizgiler iki eksenin senkron dansıdır: X ve Y aynı anda, orantılı hızda. Gantry bunu sever.' },
    { id: 'merdiven', name: 'Merdiven', difficulty: 'Orta', dur: 55, covMin: 85, extraMax: 12,
      shape: [[[2, 6], [2, 5], [3.2, 5], [3.2, 4], [4.4, 4], [4.4, 3], [5.6, 3], [5.6, 2], [8, 2]]],
      desc: 'Sekiz yön değişimi = sekiz BACKLASH tuzağı. Dişli boşluğu her dönüşte çizgini kaydırır — telafiyi keşfet.' },
    { id: 'yildiz', name: 'Yıldız', difficulty: 'Orta', dur: 60, covMin: 82, extraMax: 14,
      shape: [star(5, 4, 2.6, 1.05, 5)],
      desc: 'On sivri köşe! Yüksek hızda yıldız pataese döner. Köşe yavaşlama burada altın değerinde.' },
    { id: 'ev', name: 'Ev Çizimi', difficulty: 'İleri', dur: 75, covMin: 84, extraMax: 12,
      shape: [ [[3, 2], [7, 2], [7, 4.6], [3, 4.6], [3, 2]], [[3, 4.6], [5, 6.2], [7, 4.6]], [[4.4, 2], [4.4, 3.6], [5.6, 3.6], [5.6, 2]] ],
      desc: 'Üç ayrı parça: gövde, çatı, kapı. Kalem YUKARI seyahatler araya girer — kalem kontrolü program disiplinidir.' },
    { id: 'simsek', name: 'Şimşek', difficulty: 'İleri', dur: 60, covMin: 82, extraMax: 14,
      shape: [[[5.8, 1.2], [4.2, 3.6], [5.4, 3.6], [3.9, 6.4], [6.4, 3.2], [5.1, 3.2], [6.6, 1.2]]],
      desc: 'Sivri, ters, çapraz: her segment farklı yön. Hız + backlash + köşe hepsi aynı şekilde sınanır.' },
    { id: 'imza', name: 'RF İmzası', difficulty: 'Uzman', dur: 90, covMin: 80, extraMax: 14,
      shape: [ [[2, 6], [2, 2], [3.6, 2], [3.6, 3.8], [2, 3.8]], [[2.6, 3.8], [3.8, 6]], [[5, 6], [5, 2]], [[5, 2], [6.8, 2]], [[5, 3.8], [6.3, 3.8]] ],
      desc: 'RoboForge imzası: R ve F harfleri. Beş parça, keskin köşeler, dar süre. Usta işi kalibrasyondur.' },
  ];

  // ---- hedef örnekleme ---------------------------------------------------------------
  function sampleShape(shape, step) {
    const pts = [];
    for (const poly of shape) {
      for (let i = 1; i < poly.length; i++) {
        const [x1, y1] = poly[i - 1], [x2, y2] = poly[i];
        const d = Math.hypot(x2 - x1, y2 - y1);
        const n = Math.max(2, Math.ceil(d / step));
        for (let k = 0; k <= n; k++) pts.push([x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n]);
      }
    }
    return pts;
  }

  // ---- program üretici -----------------------------------------------------------------
  // adımlar: ['GIT', x, y] | ['KALEM', 1|0]  (1 = aşağı/çiz)
  function progFor(mission) {
    const P = [];
    for (const poly of mission.shape) {
      P.push(['KALEM', 0]);
      P.push(['GIT', +poly[0][0].toFixed(2), +poly[0][1].toFixed(2)]);
      P.push(['KALEM', 1]);
      for (let i = 1; i < poly.length; i++) P.push(['GIT', +poly[i][0].toFixed(2), +poly[i][1].toFixed(2)]);
    }
    P.push(['KALEM', 0]);
    return P;
  }
  function defaultCal() { return { hiz: 2.2, koseYavas: true, blTelafi: true }; }

  function createSim(cfg) {
    const m = cfg.mission;
    return {
      cfg, mission: m, t: 0, status: 'running', reason: null,
      x: 0.6, y: 0.6, pen: 0,
      cx: 0.6, cy: 0.6,                     // komut edilen (hedeflenen) pozisyon
      stepIdx: 0, segFrom: [0.6, 0.6], segTo: null, segProg: 0,
      lastDirX: 0, lastDirY: 0, slackX: 0, slackY: 0, pcx: 0.6, pcy: 0.6, axc: 0.6, ayc: 0.6,
      ink: [], target: sampleShape(m.shape, 0.1),
      events: [], lastEvt: {}, totalTicks: 0, drawn: 0,
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
    const cal = sim.cfg.cal || defaultCal();
    const P = sim.cfg.program || [];

    // ---- adım yürütücü ----
    if (sim.segTo === null) {
      if (sim.stepIdx >= P.length) {
        // bitti → değerlendir
        const sc = score(sim);
        if (sc.cov >= m.covMin && sc.extra <= m.extraMax) { sim.status = 'success'; sim.reason = 'tamam'; }
        else if (sc.cov < m.covMin) { sim.status = 'failed'; sim.reason = 'kapsama'; }
        else { sim.status = 'failed'; sim.reason = 'fazlalik'; }
        return;
      }
      const st = P[sim.stepIdx];
      if (st[0] === 'KALEM') { sim.pen = st[1] ? 1 : 0; sim.stepIdx++; return; }
      if (st[0] === 'GIT') {
        const tx = Math.max(0.2, Math.min(PAPER.w - 0.2, st[1]));
        const ty = Math.max(0.2, Math.min(PAPER.h - 0.2, st[2]));
        if (st[1] < 0 || st[1] > PAPER.w || st[2] < 0 || st[2] > PAPER.h) {
          sim.status = 'failed'; sim.reason = 'kagit_disi';
          pushEvt(sim, 'out', '📄 Kağıt dışına GIT komutu: (' + st[1] + ', ' + st[2] + ')'); return;
        }
        sim.segFrom = [sim.cx, sim.cy];
        sim.segTo = [tx, ty];
        sim.segProg = 0;
        // backlash: yön değişiminde ölü bant
        const dirX = Math.sign(tx - sim.cx), dirY = Math.sign(ty - sim.cy);
        if (dirX !== 0 && sim.lastDirX !== 0 && dirX !== sim.lastDirX) sim.slackX = BACKLASH;
        if (dirY !== 0 && sim.lastDirY !== 0 && dirY !== sim.lastDirY) sim.slackY = BACKLASH;
        if (dirX !== 0) sim.lastDirX = dirX;
        if (dirY !== 0) sim.lastDirY = dirY;
        sim.stepIdx++;
      } else sim.stepIdx++;
      return;
    }

    // ---- segment ilerlet (komut pozisyonu) ----
    const [fx, fy] = sim.segFrom, [tx, ty] = sim.segTo;
    const segLen = Math.max(0.001, Math.hypot(tx - fx, ty - fy));
    let v = cal.hiz;
    if (cal.koseYavas) {
      // köşeye/başlangıca yakınken yavaşla (trapez profil)
      const distEnd = (1 - sim.segProg) * segLen;
      const distStart = sim.segProg * segLen;
      v = Math.min(v, 0.6 + Math.min(distEnd, distStart) * 3.2);
    }
    sim.segProg = Math.min(1, sim.segProg + (v / segLen) * dt);
    sim.cx = fx + (tx - fx) * sim.segProg;
    sim.cy = fy + (ty - fy) * sim.segProg;
    if (sim.segProg >= 1) sim.segTo = null;

    // ---- backlash: yön değişiminde komut, boşluk yenene kadar eksene ULAŞMAZ ----
    let ax, ay;
    if (cal.blTelafi) { ax = sim.cx; ay = sim.cy; sim.axc = sim.cx; sim.ayc = sim.cy; }
    else {
      const dxc = sim.cx - sim.pcx, dyc = sim.cy - sim.pcy;
      if (sim.slackX > 0 && dxc !== 0) { const use = Math.min(sim.slackX, Math.abs(dxc)); sim.slackX -= use; sim.axc += (Math.abs(dxc) - use) * Math.sign(dxc); }
      else sim.axc += dxc;
      if (sim.slackY > 0 && dyc !== 0) { const use = Math.min(sim.slackY, Math.abs(dyc)); sim.slackY -= use; sim.ayc += (Math.abs(dyc) - use) * Math.sign(dyc); }
      else sim.ayc += dyc;
      ax = sim.axc; ay = sim.ayc;
    }
    sim.pcx = sim.cx; sim.pcy = sim.cy;

    // ---- eksen takip gecikmesi (hız → köşe yuvarlama) ----
    const lag = 3.6 - Math.min(2.4, cal.hiz * 0.55);    // hızlı = tembel takip
    sim.x += (ax - sim.x) * Math.min(1, lag * dt * 3.2);
    sim.y += (ay - sim.y) * Math.min(1, lag * dt * 3.2);

    // ---- mürekkep ----
    if (sim.pen) {
      const last = sim.ink[sim.ink.length - 1];
      if (!last || Math.hypot(sim.x - last[0], sim.y - last[1]) > 0.045) {
        sim.ink.push([sim.x, sim.y]);
        sim.drawn += last ? Math.hypot(sim.x - last[0], sim.y - last[1]) : 0;
      }
    } else sim.ink.push(null);   // kalem yukarı: iz kes

    sim.totalTicks++;
    sim.t += dt;
    if (sim.t > m.dur) { sim.status = 'failed'; sim.reason = 'sure'; }
  }

  // ---- skor ------------------------------------------------------------------------
  function score(sim) {
    const inkPts = sim.ink.filter(p => p);
    if (!inkPts.length) return { cov: 0, extra: 0 };
    let covered = 0;
    for (const [tx2, ty2] of sim.target) {
      for (const [ix, iy] of inkPts) {
        if (Math.abs(ix - tx2) < COV_TOL && Math.abs(iy - ty2) < COV_TOL &&
            Math.hypot(ix - tx2, iy - ty2) < COV_TOL) { covered++; break; }
      }
    }
    let extra = 0;
    for (const [ix, iy] of inkPts) {
      let near = false;
      for (const [tx2, ty2] of sim.target) {
        if (Math.abs(ix - tx2) < EXTRA_TOL && Math.abs(iy - ty2) < EXTRA_TOL &&
            Math.hypot(ix - tx2, iy - ty2) < EXTRA_TOL) { near = true; break; }
      }
      if (!near) extra++;
    }
    return { cov: Math.round(covered / sim.target.length * 100),
             extra: Math.round(extra / inkPts.length * 100) };
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const sc = score(sim);
    const tScore = Math.max(0, 100 - sim.t / sim.mission.dur * 85);
    const total = sc.cov * 0.55 + (100 - sc.extra * 3) * 0.15 + tScore * 0.30;
    if (total > 82) return { name: '🏆 Usta Gravürcü', cmt: 'Jilet gibi köşeler, tertemiz çizgi, akan makine. Bu çizim çerçevelenir!' };
    if (total > 64) return { name: '🥈 CNC Operatörü', cmt: 'Şekil tamam. Madalya için: hızı artırıp köşe yavaşlamaya güven — süre puanı seni bekliyor.' };
    return { name: '🥉 Çırak Çizer', cmt: 'Şekil tanınıyor ama titrek. Kalibrasyon sekmesindeki üç ayar senin atölyen — kurcala.' };
  }
  function coach(sim) {
    const tips = [];
    const r = sim.reason || '';
    const sc = score(sim);
    const cal = sim.cfg.cal || defaultCal();
    if (r === 'kapsama') {
      if (!cal.koseYavas && cal.hiz > 2.6) tips.push('Kapsama %' + sc.cov + ' — köşeler yuvarlandı. Hız ' + cal.hiz.toFixed(1) + ' + köşe yavaşlama KAPALI = keskin şekil imkânsız. Ya yavaşla ya köşe yavaşlamayı aç.');
      else if (!cal.blTelafi) tips.push('Kapsama düşük ve çizgiler kaymış: BACKLASH! Her yön değişiminde dişli boşluğu çizgini ' + (BACKLASH * 100).toFixed(0) + ' salise kaydırır. Telafiyi aç — firmware boşluğu önceden alır.');
      else tips.push('Kapsama %' + sc.cov + ' < %' + sim.mission.covMin + '. Program şeklin tüm köşelerinden geçiyor mu? Kalem doğru yerlerde aşağı mı?');
    }
    if (r === 'fazlalik') tips.push('Fazla mürekkep %' + sc.extra + ': kalem YUKARI olması gereken seyahatlerde AŞAĞI kalmış. Parçalar arasında KALEM yukarı adımını unutma.');
    if (r === 'kagit_disi') tips.push('Kağıt ' + PAPER.w + '×' + PAPER.h + ' birim. GIT koordinatların bu dikdörtgenin içinde kalmalı.');
    if (r === 'sure') tips.push('Süre doldu. Hız kalibrasyonunu yükselt — köşe yavaşlama açıkken yüksek hız güvenlidir: düzlüklerde uçar, köşelerde kendisi frenler.');
    if (!tips.length) tips.push('Pro ipucu: köşe yavaşlama + backlash telafisi + yüksek hız = hem hızlı hem keskin. Üçlünün dengesi gerçek CNC kalibrasyonudur.');
    return tips;
  }

  function runHeadless(cfg, maxTime, dt) {
    const sim = createSim(cfg);
    const step = dt || 1 / 60, mt = maxTime || (cfg.mission.dur + 2);
    while (sim.status === 'running' && sim.t < mt) tickSim(sim, step);
    const sc = score(sim);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(1), cov: sc.cov, extra: sc.extra };
  }

  const API = {
    PAPER, BACKLASH, COV_TOL, EXTRA_TOL, MISSIONS,
    sampleShape, progFor, defaultCal, createSim, tickSim, score, robotClass, coach, runHeadless,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.CncCore = API;
})();
