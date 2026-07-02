/*
 * RoboForge — Sinyal Avcısı (RSSI Trilateration) Simülasyon Çekirdeği
 * Pure, dependency-free. Browser (window.SinyalCore) + Node (module.exports).
 *
 * Gizli bir verici (hedef "işaretçi") sahada bir yerde. Robotun 3 sabit baz
 * istasyonundan (verici) aldığı SİNYAL GÜCÜYLE (RSSI) her birine olan mesafesini
 * TAHMİN eder — ama ölçüm GÜRÜLTÜLÜdür. Üç mesafe çemberinin kesişimi (trilaterasyon)
 * hedefi verir. Dersler: (1) RSSI → mesafe: d = d0·10^((P0−RSSI)/(10·n)) — sinyal
 * uzaklıkla ÜSTEL zayıflar, (2) tek ölçüm yalan söyler → ORTALAMA al (gürültü filtresi),
 * (3) üç çember bir noktada kesişmez, en iyi tahmin = en küçük kareler, (4) hareket
 * ettikçe tahmin güncellenir: yaklaştıkça netleşir (gradyan tırmanışı).
 */
(function () {
  'use strict';

  // log-distance path loss model
  const P0 = -40;      // 1 m'de referans RSSI (dBm)
  const N_PATH = 2.0;  // yol kaybı üsteli (serbest uzay ~2)
  const D0 = 1.0;
  const REACH = 1.0;   // hedefe bu kadar yaklaşınca "bulundu"
  const ARENA = 20;    // 0..20 kare saha
  const VBASE = 2.6;   // robot temel hızı (birim/sn) — trilaterasyon lehine yavaş

  // rssi(dbm) → tahmini mesafe
  function rssiToDist(rssi) {
    return D0 * Math.pow(10, (P0 - rssi) / (10 * N_PATH));
  }
  // gerçek mesafe → gürültüsüz rssi
  function distToRssi(d) {
    return P0 - 10 * N_PATH * Math.log10(Math.max(0.35, d) / D0);
  }

  // her görev: 3 verici konumu (bx), gizli hedef, gürültü, hedef hareketi
  const MISSIONS = [
    { id: 'ilkiz', name: 'İlk İz', difficulty: 'Başlangıç', dur: 45, noise: 1.2, avg: 6,
      bx: [[2, 2], [18, 2], [10, 18]], target: [10, 9], move: null,
      desc: 'Üç anten, gizli bir verici. Sinyal gücünden mesafeyi kestir, üç çemberi kes, kaynağa yürü. Gürültü az — sinyali tanı.' },
    { id: 'ucgen', name: 'Üçgen Kilit', difficulty: 'Başlangıç', dur: 50, noise: 1.6, avg: 6,
      bx: [[2, 3], [18, 3], [10, 18]], target: [6, 13], move: null,
      desc: 'Hedef üçgenin kenarına yakın. Trilaterasyon üç antenden eşit uzaklaşınca en isabetli — geometriyi hisset.' },
    { id: 'gurultu', name: 'Parazit', difficulty: 'Orta', dur: 55, noise: 3.2, avg: 10,
      bx: [[2, 2], [18, 2], [10, 18]], target: [13, 12], move: null,
      desc: 'Ortam gürültülü: tek ölçüm metrelerce şaşırtır. Sırrı ORTALAMA: çok örnek al, gürültü sönümlensin — acele eden kaybeder.' },
    { id: 'kenar', name: 'Kör Nokta', difficulty: 'Orta', dur: 60, noise: 3.4, avg: 10,
      bx: [[3, 3], [17, 4], [9, 16]], target: [17, 15], move: null,
      desc: 'Hedef antenlerin dışında bir köşede: çemberler dar açıyla kesişir, küçük ölçüm hatası büyür. Sabırla ortala, yaklaştıkça güncelle.' },
    { id: 'kacan', name: 'Kaçan Verici', difficulty: 'İleri', dur: 75, noise: 3.0, avg: 10,
      bx: [[2, 2], [18, 2], [10, 18]], target: [8, 8], move: { ax: 5, ay: 4, sx: 0.85, sy: 0.7 },
      desc: 'Verici hareketli! Sabit bir tahmin işe yaramaz — sürekli yeniden ölç, yeniden trilatere et, peşinden git. Ama gürültüde tek ölçüme koşarsan hayalet kovalarsın.' },
    { id: 'derin', name: 'Derin Saha', difficulty: 'İleri', dur: 80, noise: 5.0, avg: 12,
      bx: [[3, 2], [17, 3], [10, 17]], target: [15, 6], move: { ax: 3.5, ay: 3.5, sx: 0.7, sy: 0.85 },
      desc: 'Yüksek gürültü + hareketli hedef + uzak köşe. Ortalama penceresini genişlet, güvenini oturt, sonra yaklaş.' },
    { id: 'kabus', name: 'Kâbus Frekansı', difficulty: 'Uzman', dur: 100, noise: 7.0, avg: 14,
      bx: [[3, 3], [17, 3], [10, 17]], target: [16, 14], move: { ax: 6, ay: 5, sx: 1.0, sy: 0.85 },
      desc: 'Şiddetli parazit, hızlı kaçan verici, en zor köşe. Tek ölçüm 12 metre yalan söyler. Gerçek arama-kurtarma: gürültüyü ortalamayla yen, hedefi kıstır.' },
  ];

  function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  // gauss gürültü (Box-Muller, deterministik akış)
  function gauss(rnd) {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  // en küçük kareler trilaterasyon: 3 (baz, tahmini mesafe) → hedef tahmini
  // lineerleştirme: ilk baz istasyonunu referans al, farkları çöz
  function trilaterate(bx, dists) {
    // Ax = b (2 denklem), kapalı çözüm
    const [x1, y1] = bx[0], [x2, y2] = bx[1], [x3, y3] = bx[2];
    const r1 = dists[0], r2 = dists[1], r3 = dists[2];
    const A = 2 * (x2 - x1), B = 2 * (y2 - y1);
    const C = r1 * r1 - r2 * r2 - x1 * x1 + x2 * x2 - y1 * y1 + y2 * y2;
    const D = 2 * (x3 - x2), E = 2 * (y3 - y2);
    const F = r2 * r2 - r3 * r3 - x2 * x2 + x3 * x3 - y2 * y2 + y3 * y3;
    const den = (A * E - B * D);
    if (Math.abs(den) < 1e-6) return null;
    const px = (C * E - F * B) / den;
    const py = (A * F - D * C) / den;
    return [px, py];
  }

  function createSim(cfg) {
    const m = cfg.mission;
    const rnd = lcg(m.id.length * 101 + 17);
    // robot başlangıcı: sahanın alt-orta
    return {
      cfg, mission: m, rnd, t: 0, status: 'running', reason: null,
      rx: ARENA / 2, ry: 1.5, th: Math.PI / 2, v: 0,
      target: m.target.slice(), t0: m.target.slice(),
      samples: [[], [], []],      // her verici için son RSSI örnekleri
      est: null, estErr: null,    // trilaterasyon tahmini + hatası
      bestErr: 999,
      path: [], estPath: [], log: [], events: [], lastEvt: {},
      totalTicks: 0, sampleAcc: 0,
    };
  }
  function pushEvt(sim, key, msg) {
    if (sim.lastEvt[key]) return;
    sim.lastEvt[key] = true;
    sim.events.push([+sim.t.toFixed(1), msg]);
    if (sim.events.length > 40) sim.events.shift();
  }

  // gürültülü RSSI ölçümü al (her vericiden)
  function measure(sim) {
    const m = sim.mission;
    const rd = [];
    for (let i = 0; i < 3; i++) {
      const d = dist(sim.mission.bx[i], sim.target);
      const rssi = distToRssi(d) + gauss(sim.rnd) * m.noise;
      rd.push(rssi);
      const arr = sim.samples[i];
      arr.push(rssi);
      if (arr.length > m.avg) arr.shift();
    }
    return rd;
  }
  // ortalanmış örneklerden mesafe tahmini
  function estDists(sim) {
    return sim.samples.map(arr => {
      if (!arr.length) return null;
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      return rssiToDist(mean);
    });
  }

  function clampArena(p) {
    p[0] = Math.max(0.4, Math.min(ARENA - 0.4, p[0]));
    p[1] = Math.max(0.4, Math.min(ARENA - 0.4, p[1]));
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return;
    const m = sim.mission;
    const cfg = sim.cfg;
    const mode = cfg.mode || 'rules';

    // hedef hareketi (kaçan verici)
    if (m.move) {
      sim.target[0] = sim.t0[0] + m.move.ax * Math.sin(sim.t * m.move.sx);
      sim.target[1] = sim.t0[1] + m.move.ay * Math.sin(sim.t * m.move.sy * 1.3);
      clampArena(sim.target);
    }

    // ---- ölçüm (belirli frekansta örnekle) ----
    sim.sampleAcc += dt;
    const samplePeriod = 1 / 12;   // 12 Hz ölçüm
    if (sim.sampleAcc >= samplePeriod) {
      sim.sampleAcc -= samplePeriod;
      measure(sim);
      const ds = estDists(sim);
      if (ds.every(d => d != null)) {
        const est = trilaterate(m.bx, ds);
        if (est) {
          clampArena(est);
          // navigasyon için hafif EMA yumuşatma (zıplayan tahmini oturtur)
          if (!sim.est) sim.est = est.slice();
          else { sim.est[0] += (est[0] - sim.est[0]) * 0.35; sim.est[1] += (est[1] - sim.est[1]) * 0.35; }
          sim.estRaw = est;
          sim.estErr = dist(sim.est, sim.target);
          sim.bestErr = Math.min(sim.bestErr, sim.estErr);
          sim.estPath.push(sim.est.slice());
          if (sim.estPath.length > 400) sim.estPath.shift();
        }
      }
    }

    // ---- kontrol: nereye sür? ----
    let steer = 0, drive = 1;
    const params = mode === 'rules' ? (cfg.policy || defaultPolicy()) : (cfg.pid || defaultPID());

    // hedef yön: tahmin varsa ona, yoksa dur/ara
    let aim = sim.est;
    if (mode === 'rules') {
      // KURAL modu: eşik tabanlı davranış
      // kaç örnek toplandı? güven = min örnek sayısı / avg
      const conf = Math.min(...sim.samples.map(a => a.length)) / m.avg;
      if (!aim || conf < (params.guven || 0.5)) {
        // yeterli veri yok → yavaş ilerle + tara (dönerek örnek çeşitle)
        drive = 0.35; steer = 0.5;
      } else {
        const dx = aim[0] - sim.rx, dy = aim[1] - sim.ry;
        const want = Math.atan2(dy, dx);
        let e = want - sim.th;
        while (e > Math.PI) e -= 2 * Math.PI;
        while (e < -Math.PI) e += 2 * Math.PI;
        steer = Math.max(-1, Math.min(1, e * 2.2));
        const near = Math.hypot(dx, dy);
        drive = near < (params.yavasla || 2.5) ? 0.5 : 1.0;
      }
    } else {
      // PID modu: sürekli tahmine yönel (Kp/Kd üzerinden), yaklaşınca yavaşla
      if (!aim) { drive = 0.3; steer = 0.4; }
      else {
        const dx = aim[0] - sim.rx, dy = aim[1] - sim.ry;
        const want = Math.atan2(dy, dx);
        let e = want - sim.th;
        while (e > Math.PI) e -= 2 * Math.PI;
        while (e < -Math.PI) e += 2 * Math.PI;
        const d = (e - (sim._pe || 0)) / Math.max(dt, 1e-3);
        sim._pe = e;
        steer = Math.max(-1, Math.min(1, (params.kp || 2.4) * e + (params.kd || 0.4) * d));
        const near = Math.hypot(dx, dy);
        drive = Math.max(0.35, Math.min(1, near / (params.yaklas || 3)));
      }
    }

    // ---- diferansiyel sürüş ----
    const vMax = (cfg.vMax || VBASE);
    const turn = cfg.turnGain || 1.0;
    sim.th += steer * 2.6 * turn * dt;
    const spd = vMax * drive;
    sim.rx += Math.cos(sim.th) * spd * dt;
    sim.ry += Math.sin(sim.th) * spd * dt;
    const rp = [sim.rx, sim.ry]; clampArena(rp); sim.rx = rp[0]; sim.ry = rp[1];

    if (sim.totalTicks % 2 === 0) {
      sim.path.push([sim.rx, sim.ry]);
      if (sim.path.length > 900) sim.path.shift();
      sim.log.push([sim.t, sim.estErr == null ? 0 : sim.estErr, dist([sim.rx, sim.ry], sim.target)]);
      if (sim.log.length > 3000) sim.log.shift();
    }

    // ---- yakalandı mı? ----
    const realD = dist([sim.rx, sim.ry], sim.target);
    if (realD <= REACH) {
      sim.status = 'success'; sim.reason = 'bulundu';
      pushEvt(sim, 'found', '🎯 VERİCİ BULUNDU! Trilaterasyon hatası son: ' + (sim.estErr || 0).toFixed(1) + ' m');
      return;
    }

    sim.totalTicks++;
    sim.t += dt;
    if (sim.t > m.dur) { sim.status = 'failed'; sim.reason = 'sure'; }
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const tScore = Math.max(0, 100 - sim.t / sim.mission.dur * 85);
    const errScore = Math.max(0, 100 - sim.bestErr * 18);
    const total = tScore * 0.6 + errScore * 0.4;
    if (total > 60) return { name: '🏆 Sinyal Dedektifi', cmt: 'Gürültüyü ezdin, üç çemberi tek noktada kesiştirdin, doğruca kaynağa gittin. Arama-kurtarma ekibi seni istiyor!' };
    if (total > 38) return { name: '🥈 Telemetri Uzmanı', cmt: 'Vericiyi buldun. Daha isabetli için: ortalama penceresini artır, tahmin oturmadan koşma.' };
    return { name: '🥉 Frekans Çırağı', cmt: 'Ucu ucuna kıstırdın. Gürültü seni çok savurdu — daha çok örnek al, tahmin netleşsin.' };
  }
  function coach(sim) {
    const tips = [];
    const r = sim.reason || '';
    if (r === 'sure') {
      if (sim.mission.move) tips.push('Süre doldu. Verici HAREKETLİydi — sabit bir tahmine kilitlenmek işe yaramaz. Sürekli yeniden ölç, trilaterasyonu her an güncelle, tahminin peşinden git. Gürültü yüzünden yavaşladıysan ortalama penceresini biraz artır.');
      else tips.push('Süre doldu. Muhtemelen gürültülü tek ölçümlerin peşinden savruldun. RSSI tek başına 3 metre yalan söyler; çok örneğin ORTALAMASI gerçeği verir. Yeterli veri toplanmadan koşma.');
    }
    if (sim.status === 'success' && sim.bestErr > 3) tips.push('Buldun ama trilaterasyon tahminin ' + sim.bestErr.toFixed(1) + ' m kadar şaştı. Antenlerin dışındaki köşelerde çemberler dar açıyla kesişir; ortalama penceresi büyükse hata küçülür.');
    if (!tips.length) tips.push('RSSI → mesafe üsteldir: d = d0·10^((P0−RSSI)/(10·n)). Sinyal 6 dB düşerse mesafe İKİYE katlanır. Bu yüzden uzakta küçük gürültü büyük mesafe hatası yapar — yaklaştıkça tahminin doğallaşır.');
    return tips;
  }

  function runHeadless(cfg, maxTime, dt) {
    const sim = createSim(cfg);
    const step = dt || 1 / 60, mt = maxTime || (cfg.mission.dur + 2);
    while (sim.status === 'running' && sim.t < mt) tickSim(sim, step);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(1),
      bestErr: +sim.bestErr.toFixed(1), finalErr: sim.estErr == null ? null : +sim.estErr.toFixed(1) };
  }

  function defaultPolicy() { return { guven: 0.5, yavasla: 2.5 }; }
  function defaultPID() { return { kp: 2.4, kd: 0.4, yaklas: 3.0 }; }

  const API = {
    P0, N_PATH, D0, REACH, ARENA, MISSIONS,
    rssiToDist, distToRssi, trilaterate, dist,
    createSim, tickSim, measure, estDists, robotClass, coach, runHeadless,
    defaultPolicy, defaultPID,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.SinyalCore = API;
})();
