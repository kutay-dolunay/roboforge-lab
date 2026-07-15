/*
 * RoboForge - Altı Bacak (Hexapod Gait) Simülasyon Çekirdeği
 * Pure, dependency-free. Browser (window.HexapodCore) + Node (module.exports).
 *
 * Altı bacaklı robot bir hedefe yürür. Ders: YÜRÜMEK BİR RİTİMDİR. Bacaklar
 * gelişigüzel kalkarsa robot devrilir; doğru koordinasyonla (tripod yürüyüşü:
 * 3'erli iki grup sırayla) akıcı ve dengeli ilerler. Dersler:
 * (1) STATİK DENGE: her an yerde en az 3 bacak (ağırlık merkezini içeren üçgen)
 *     olmalı - yoksa gövde düşer,
 * (2) TRIPOD GAIT: bacak 1-3-5 bir grup, 2-4-6 öbür grup; biri kalkarken öbürü basar,
 * (3) DUTY FACTOR (yerde kalma oranı): düşükse havada çok bacak olur → devrilme;
 *     yüksekse yavaş ama güvenli - hız↔denge ödünleşimi,
 * (4) ADIM FREKANSI × ADIM BOYU = hız; ama zeminde patinaj ve engebe sınır koyar.
 */
(function () {
  'use strict';

  // 6 bacak: sol/sağ üçer. Tripod A = {0,2,4}, Tripod B = {1,3,5}
  // yerleşim (gövde merkezine göre, x ileri, y yana): [ileri_ofset, yan_ofset, taraf]
  const LEG_POS = [
    [1.0, 0.7],   // 0 sağ-ön    A
    [1.0, -0.7],  // 1 sol-ön    B
    [0.0, 0.9],   // 2 sağ-orta  A
    [0.0, -0.9],  // 3 sol-orta  B
    [-1.0, 0.7],  // 4 sağ-arka  A
    [-1.0, -0.7], // 5 sol-arka  B
  ];
  // gerçek tripod = ÇAPRAZ üçgen: sağ-ön + sol-orta + sağ-arka (ve aynası)
  const TRIPOD_A = [0, 3, 4], TRIPOD_B = [1, 2, 5];

  const MISSIONS = [
    { id: 'ilkadim', name: 'İlk Adım', difficulty: 'Başlangıç', dur: 30, dist: 10, terrain: 'flat', rough: 0, slope: 0, slip: 0,
      desc: 'Düz zeminde 10 metre yürü. Tripod ritmini kur: 1-3-5 kalkarken 2-4-6 bassın. Denge = her an 3 bacak yerde.' },
    { id: 'duzyol', name: 'Uzun Düzlük', difficulty: 'Başlangıç', dur: 34, dist: 16, terrain: 'flat', rough: 0, slope: 0, slip: 0,
      desc: 'Daha uzun bir düzlük. Ritmi bozmadan hızlan: adım boyu ve frekansı hızını belirler ama denge her şeyden önce gelir.' },
    { id: 'engebe', name: 'Engebeli Arazi', difficulty: 'Orta', dur: 42, dist: 15, terrain: 'rough', rough: 0.35, slope: 0, slip: 0.1,
      desc: 'Zemin engebeli: bacaklar farklı yüksekliklere basar. Yerde kalma oranını (duty) artır ki her an yeterli bacak temas etsin.' },
    { id: 'yokus', name: 'Yokuş Yukarı', difficulty: 'Orta', dur: 46, dist: 14, terrain: 'slope', rough: 0.15, slope: 0.35, slip: 0.15,
      desc: 'Yokuş dengeyi öne kaydırır ve patinaj riskini artırır. Daha kısa, sık adımlar + yüksek duty = tutunarak tırman.' },
    { id: 'ucurum', name: 'Uçurum Kenarı', difficulty: 'İleri', dur: 52, dist: 16, terrain: 'rough', rough: 0.5, slope: 0.1, slip: 0.2,
      desc: 'Çok engebeli ve kaygan. Havada 4 bacak olursa devrilirsin. Tripod grupları kusursuz sırayla - ritim disiplini.' },
    { id: 'hizli', name: 'Hız Denemesi', difficulty: 'İleri', dur: 40, dist: 22, terrain: 'rough', rough: 0.3, slope: 0.05, slip: 0.18,
      desc: 'Uzun mesafe, kısıtlı süre: hızlanmalısın ama fazla hız patinaj ve devrilme demek. Sınırı bul, ritmi koru.' },
    { id: 'kabus', name: 'Kâbus Patikası', difficulty: 'Uzman', dur: 60, dist: 24, terrain: 'nightmare', rough: 0.6, slope: 0.4, slip: 0.28,
      desc: 'Dik + engebeli + kaygan + uzun. Tripod yürüyüşünün her kuralı aynı anda sınanır. Gerçek arazi robotiği.' },
  ];

  function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function createSim(cfg) {
    const m = cfg.mission;
    const rnd = lcg(m.id.length * 71 + 13);
    // engebe profili (deterministik yükseklik alanı)
    const bumps = [];
    for (let i = 0; i < 60; i++) bumps.push((rnd() - 0.5) * 2 * m.rough);
    return {
      cfg, mission: m, rnd, t: 0, status: 'running', reason: null,
      x: 0, vx: 0, bodyTilt: 0, tiltVel: 0,
      phase: 0,                    // gait faz saati (0..1 döner)
      legDown: [true, false, true, false, true, false], // başlangıç: tripod A yerde
      legPhaseVal: [0, 0, 0, 0, 0, 0],
      bumps, fell: false, stumble: 0,
      minDownStreak: 6, worstDown: 6,
      path: [], log: [], events: [], lastEvt: {}, totalTicks: 0, gaitAcc: 0,
    };
  }
  function pushEvt(sim, key, msg) {
    if (sim.lastEvt[key]) return;
    sim.lastEvt[key] = true;
    sim.events.push([+sim.t.toFixed(1), msg]);
    if (sim.events.length > 40) sim.events.shift();
  }

  // bir bacağın verilen fazda yerde olup olmadığı
  // group: 0 (tripod A referans) / 1 (tripod B, yarım faz kaymış) / -1 (senkron/hatalı)
  // duty: yerde kalma oranı (0.5 = yarısı yerde)
  function legContact(phase, offset, duty) {
    let ph = (phase + offset) % 1; if (ph < 0) ph += 1;
    // yerde: fazın [0, duty) aralığı; havada (salınım): [duty, 1)
    return ph < duty;
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return;
    const m = sim.mission;
    const cfg = sim.cfg;
    const mode = cfg.mode || 'rules';

    // ---- gait parametreleri ----
    let stride, freq, duty, offsets;
    if (mode === 'rules') {
      // KURAL: her bacağa bir GRUP atanır (A=0 fazı, B=0.5 fazı, KAPALI=hiç basmaz)
      const g = cfg.groups || defaultGroups();     // 6 elemanlı: 'A' | 'B' | 'off'
      offsets = g.map(v => v === 'A' ? 0 : v === 'B' ? 0.5 : null);
      stride = cfg.stride != null ? cfg.stride : 1.1;
      freq = cfg.freq != null ? cfg.freq : 1.9;
      duty = 0.6;   // kural modunda sabit makul duty
    } else {
      // PID/analog: sürekli tripod gait üretici + ayarlanır parametreler
      const p = cfg.pid || defaultPID();
      stride = p.stride; freq = p.freq; duty = p.duty;
      // ideal ÇAPRAZ tripod: {0,3,4}=faz 0, {1,2,5}=faz 0.5
      offsets = [0, 0.5, 0.5, 0, 0, 0.5];
    }

    // ---- gait saati ----
    sim.phase = (sim.phase + freq * dt) % 1;

    // her bacağın temas durumu
    let downCount = 0;
    const downSides = { left: 0, right: 0, front: 0, back: 0 };
    for (let i = 0; i < 6; i++) {
      if (offsets[i] == null) { sim.legDown[i] = false; continue; } // kapalı bacak
      const down = legContact(sim.phase, offsets[i], duty);
      sim.legDown[i] = down;
      sim.legPhaseVal[i] = ((sim.phase + offsets[i]) % 1 + 1) % 1;
      if (down) {
        downCount++;
        if (LEG_POS[i][1] > 0) downSides.right++; else downSides.left++;
        if (LEG_POS[i][0] > 0) downSides.front++; else if (LEG_POS[i][0] < 0) downSides.back++;
      }
    }
    sim.worstDown = Math.min(sim.worstDown, downCount);

    // ---- STATİK DENGE kontrolü ----
    // en az 3 bacak + iki tarafta da en az 1 (yoksa yana devrilir)
    const stable = downCount >= 3 && downSides.left >= 1 && downSides.right >= 1;
    // devrilme momenti biriktir
    if (!stable) {
      sim.stumble += dt * (3 - Math.min(3, downCount) + (downSides.left < 1 || downSides.right < 1 ? 1.5 : 0));
      sim.tiltVel += (downSides.left < 1 ? -1 : downSides.right < 1 ? 1 : 0) * 3 * dt;
    } else {
      sim.stumble = Math.max(0, sim.stumble - dt * 1.5);
      sim.tiltVel *= 0.85;
    }
    sim.bodyTilt += sim.tiltVel * dt;

    // yokuş ekstra öne yatırır → yalnızca zaten dengesizken cezalandır
    if (m.slope > 0 && !stable && downSides.back < 1) sim.stumble += dt * m.slope * 1.2;

    // devrildi mi?
    if (sim.stumble > 1.6 || Math.abs(sim.bodyTilt) > 0.9) {
      sim.status = 'failed'; sim.reason = 'devrildi'; sim.fell = true;
      pushEvt(sim, 'fell', '💥 DEVRİLDİ! Havada çok bacak vardı - gövdeyi taşıyacak denge üçgeni kalmadı.');
      return;
    }

    // ---- ilerleme fiziği ----
    // yerdeki bacaklar geri iterek gövdeyi ileri sürer; duty içindeki "itme fazı"
    // hız ~ stride × freq × (yerde iten bacak oranı), patinaj ve yokuş düşürür
    const pushLegs = downCount;   // yerde iten bacak sayısı
    const traction = Math.max(0.2, 1 - m.slip * (freq / 1.6));   // hız arttıkça patinaj artar
    const slopePenalty = 1 - m.slope * 0.55;
    let targetV = stride * freq * 0.44 * Math.min(1, pushLegs / 3) * traction * slopePenalty;
    if (pushLegs < 3) targetV *= 0.3;   // yeterli bacak yoksa sürüklenir
    // engebe küçük hız dalgalanması
    const bump = sim.bumps[Math.floor(sim.x * 3) % sim.bumps.length] || 0;
    targetV *= (1 - Math.abs(bump) * 0.4);

    sim.vx += (targetV - sim.vx) * Math.min(1, dt * 6);
    sim.x += sim.vx * dt;

    // patinaj olayı
    if (traction < 0.6 && sim.vx < targetV * 0.5 && sim.t > 1) pushEvt(sim, 'slip' + Math.round(sim.x), '🧊 Patinaj! Zemin kaygan, adım frekansın çok yüksek - hız boşa gidiyor.');

    if (sim.totalTicks % 2 === 0) {
      sim.path.push([sim.x, sim.bodyTilt]);
      if (sim.path.length > 1200) sim.path.shift();
      sim.log.push([sim.t, sim.x, downCount, sim.vx]);
      if (sim.log.length > 4000) sim.log.shift();
    }

    // ---- hedefe ulaştı mı? ----
    if (sim.x >= m.dist) {
      sim.status = 'success'; sim.reason = 'vardi';
      pushEvt(sim, 'goal', '🏁 HEDEFE VARDI! ' + m.dist + ' m tripod ritmiyle yüründü.');
      return;
    }

    sim.totalTicks++;
    sim.t += dt;
    if (sim.t > m.dur) { sim.status = 'failed'; sim.reason = 'sure'; }
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const tScore = Math.max(0, 100 - sim.t / sim.mission.dur * 82);
    const stabScore = Math.min(100, sim.worstDown / 3 * 100);
    const total = tScore * 0.55 + stabScore * 0.45;
    if (total > 62) return { name: '🏆 Arazi Ustası', cmt: 'Kusursuz tripod ritmi: her an sağlam denge üçgeni, akıcı hız, engebeyi umursamadın. Mars gezgini ekibi seni istiyor!' };
    if (total > 40) return { name: '🥈 Yürüyüş Mühendisi', cmt: 'Hedefe vardın. Daha akıcı için: duty oranını dengede tut, en az 3 bacağı hep yerde bırak.' };
    return { name: '🥉 Acemi Böcek', cmt: 'Sallana sallana da olsa vardın. Ritmin ara ara bozuldu - tripod gruplarını netleştir, dengeyi kaybetme.' };
  }
  function coach(sim) {
    const tips = [];
    const r = sim.reason || '';
    if (r === 'devrildi') {
      tips.push('Devrildin: bir an havada 4+ bacak kaldı, gövdeyi taşıyacak 3-bacaklı denge üçgeni kalmadı. TRIPOD kuralı: 1-3-5 bir grup, 2-4-6 öbür grup - biri kalkarken öbürü MUTLAKA yerde. Aynı taraftaki bacakları aynı anda kaldırma!');
    }
    if (r === 'sure') {
      if (sim.mission.slip > 0.15) tips.push('Süre doldu - muhtemelen patinaj. Kaygan/engebeli zeminde adım frekansını çok açarsan bacaklar kayar, hız boşa gider. Frekansı düşür, adım boyunu artır: yavaş ama tutunan adım kazanır.');
      else tips.push('Süre doldu. Yeterince hızlı değildin: hız = adım boyu × frekans. İkisini de artır - ama her an 3 bacağı yerde tutacak dengeyi koru.');
    }
    if (sim.status === 'success' && sim.worstDown < 3) tips.push('Vardın ama bir an sadece ' + sim.worstDown + ' bacağın yerdeydi - kıl payı devrilmedin. Duty oranını biraz artır, güven marjın büyüsün.');
    if (!tips.length) tips.push('Tripod yürüyüşü doğanın çözümü: karıncalar, hamamböcekleri hep 3-3 yürür. İki üçgen sırayla basar, gövde hiç desteksiz kalmaz. Duty = bir bacağın yerde kaldığı süre oranı; %50 tripod için idealdir.');
    return tips;
  }

  function runHeadless(cfg, maxTime, dt) {
    const sim = createSim(cfg);
    const step = dt || 1 / 60, mt = maxTime || (cfg.mission.dur + 2);
    while (sim.status === 'running' && sim.t < mt) tickSim(sim, step);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(1),
      dist: +sim.x.toFixed(1), worstDown: sim.worstDown };
  }

  // starter: doğru ÇAPRAZ tripod gruplaması ({0,3,4}=A ; {1,2,5}=B)
  function defaultGroups() { return ['A', 'B', 'B', 'A', 'A', 'B']; }
  function defaultPID() { return { stride: 1.1, freq: 1.9, duty: 0.55 }; }

  const API = {
    LEG_POS, TRIPOD_A, TRIPOD_B, MISSIONS, legContact,
    createSim, tickSim, robotClass, coach, runHeadless, defaultGroups, defaultPID,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.HexapodCore = API;
})();
