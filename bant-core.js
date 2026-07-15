/*
 * RoboForge - Ayıklama Bandı Simülasyon Çekirdeği
 * Pure, dependency-free. Browser (window.BantCore) + Node (module.exports).
 *
 * Fabrika otomasyonu: konveyörde ürünler akar, sensör istasyonu okur
 * (renk / boyut / ağırlık), kurallar hangi kapaktan hangi kutuya gideceğine
 * karar verir. Dersler: (1) karar tablosu tasarımı - öncelik sırası her şeydir,
 * (2) hız ↔ doğruluk: bant hızlanınca sensör yanlış okur, (3) kapsam: hiçbir
 * kurala uymayan ürün SON kutuya düşer - "diğerleri" kutusunu unutan yanar,
 * (4) iki düşünme modeli: ürün-merkezli kural zinciri vs kutu-merkezli filtre.
 */
(function () {
  'use strict';

  const BELT_LEN = 10;
  const SENSOR_X = 2.2;
  const GATES_X = [4.2, 6.0, 7.8];    // kapak 1-2-3; bant sonu = SON kutusu
  const SPAWN_GAP = 1.5;               // ürünler arası mesafe (bant birimi)

  // ---- ürün akışı (deterministik LCG) --------------------------------------------
  function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  const RENK = ['kirmizi', 'yesil', 'mavi'];
  function makeItems(m) {
    const rnd = lcg(m.seed);
    const pal = m.renkler === 2 ? ['kirmizi', 'mavi'] : RENK;
    const items = [];
    for (let i = 0; i < m.count; i++) {
      const renk = pal[Math.floor(rnd() * pal.length)];
      const buyuk = rnd() < 0.5;
      const agir = rnd() < 0.4;
      items.push({ renk, buyuk, agir });
    }
    return items;
  }

  // ---- görevler --------------------------------------------------------------------
  // hedef: her ürünün DOĞRU kutusu missionRule(item) ile tanımlı (kalite kontrol standardı)
  const MISSIONS = [
    { id: 'renkayrimi', name: 'Renk Ayrımı', difficulty: 'Başlangıç', dur: 75, count: 12, seed: 11, renkler: 2,
      bins: ['KIRMIZI', 'MAVİ', '-', 'DİĞER'], maxWrong: 1,
      want: it => it.renk === 'kirmizi' ? 0 : 1,
      desc: 'İki renk, iki kutu. Kırmızılar 1 numaraya, maviler 2 numaraya. Karar tablosunun ilk dersi.' },
    { id: 'ucrenk', name: 'Üç Renk Hattı', difficulty: 'Başlangıç', dur: 90, count: 15, seed: 23, renkler: 3,
      bins: ['KIRMIZI', 'YEŞİL', 'MAVİ', 'DİĞER'], maxWrong: 1,
      want: it => it.renk === 'kirmizi' ? 0 : it.renk === 'yesil' ? 1 : 2,
      desc: 'Üç renk, üç kapak. Kural sayısı artıyor - sıralama hâlâ kolay, ama dikkat dağılmasın.' },
    { id: 'boyut', name: 'Boyut Kontrolü', difficulty: 'Orta', dur: 90, count: 15, seed: 37, renkler: 2,
      bins: ['BÜYÜK KIRMIZI', 'KÜÇÜK KIRMIZI', 'MAVİLER', 'DİĞER'], maxWrong: 1,
      want: it => it.renk === 'kirmizi' ? (it.buyuk ? 0 : 1) : 2,
      desc: 'Kırmızılar boyuta göre ayrılır, maviler tek kutuya. İKİ özelliği birleştiren ilk kurallar: VE mantığı.' },
    { id: 'agirlik', name: 'Ağırlık Terazisi', difficulty: 'Orta', dur: 95, count: 16, seed: 51, renkler: 3,
      bins: ['AĞIRLAR', 'KIRMIZI HAFİF', 'DİĞER HAFİF', 'DİĞER'], maxWrong: 1,
      want: it => it.agir ? 0 : it.renk === 'kirmizi' ? 1 : 2,
      desc: 'ÖNCELİK dersi: ağır ürün rengine bakılmaksızın 1 numaraya! Ağırlık kuralı listenin TEPESİNDE olmalı.' },
    { id: 'hizlikota', name: 'Hızlı Kota', difficulty: 'İleri', dur: 55, count: 16, seed: 67, renkler: 2,
      bins: ['KIRMIZI', 'MAVİ', '-', 'DİĞER'], maxWrong: 2,
      want: it => it.renk === 'kirmizi' ? 0 : 1,
      desc: 'Basit ayrım ama süre DAR: bant hızını artırmak zorundasın. Hızlı bant sensörü yanıltır - ödünleşimi yaşa.' },
    { id: 'siparis', name: 'Karışık Sipariş', difficulty: 'İleri', dur: 110, count: 18, seed: 83, renkler: 3,
      bins: ['BÜYÜK AĞIR', 'KIRMIZI KÜÇÜK', 'MAVİ + YEŞİL BÜYÜK', 'DİĞER'], maxWrong: 1,
      want: it => (it.buyuk && it.agir) ? 0 : (it.renk === 'kirmizi' && !it.buyuk) ? 1 : (it.buyuk && (it.renk === 'mavi' || it.renk === 'yesil')) ? 2 : 3,
      desc: 'Gerçek sipariş listesi: üç özellik, dört kutu, çakışan koşullar. SON kutusu artık meşru bir hedef - kapsama dikkat!' },
    { id: 'kabusvardiya', name: 'Kâbus Vardiyası', difficulty: 'Uzman', dur: 75, count: 20, seed: 97, renkler: 3,
      bins: ['AĞIR KIRMIZI', 'HAFİF BÜYÜK', 'MAVİ KÜÇÜK', 'DİĞER'], maxWrong: 1,
      want: it => (it.agir && it.renk === 'kirmizi') ? 0 : (!it.agir && it.buyuk) ? 1 : (it.renk === 'mavi' && !it.buyuk) ? 2 : 3,
      desc: 'Dar süre + karmaşık tablo + tek yanlış hakkı. Bant hızı, kural sırası, kapsam: hepsi aynı anda doğru olacak.' },
  ];

  // ---- eşleştirme -------------------------------------------------------------------
  // bits: [KIRMIZI, YEŞİL, MAVİ, BÜYÜK, AĞIR]
  function itemBits(it) {
    return [it.renk === 'kirmizi', it.renk === 'yesil', it.renk === 'mavi', it.buyuk, it.agir];
  }
  function ruleMatches(pattern, bits) {
    for (let i = 0; i < bits.length; i++) {
      const p = pattern[i] || 'any';
      if (p === 'on' && !bits[i]) return false;
      if (p === 'off' && bits[i]) return false;
    }
    return true;
  }
  // rules modu: sıralı kurallar → bin (0,1,2) | eşleşmeyen → 3 (SON)
  function decideRules(rules, bits) {
    for (let i = 0; i < rules.length; i++) {
      if (ruleMatches(rules[i].pattern, bits)) return { bin: rules[i].bin, ruleIndex: i };
    }
    return { bin: 3, ruleIndex: -1 };
  }
  // filtre modu: her kapağın kabul filtresi; İLK kabul eden kapak alır
  function decideFilters(filters, bits) {
    for (let g = 0; g < 3; g++) {
      const f = filters[g];
      if (f && f.aktif && ruleMatches(f.pattern, bits)) return { bin: g, ruleIndex: g };
    }
    return { bin: 3, ruleIndex: -1 };
  }

  function misreadChance(speed) {
    // 0.9 hıza kadar kusursuz; sonrası hızla artar
    return Math.max(0, (speed - 0.9)) * 0.22;
  }

  function createSim(cfg) {
    const m = cfg.mission;
    return {
      cfg, mission: m, t: 0, status: 'running', reason: null,
      items: makeItems(m).map((it, i) => ({ ...it, x: -i * SPAWN_GAP - 1, read: null, bin: -1, gone: false, pushed: 0, misread: false })),
      rnd: lcg(m.seed * 7 + 3),
      speed: (cfg.line && cfg.line.speed) || 0.9,
      counts: [[0, 0], [0, 0], [0, 0], [0, 0]],   // [doğru, yanlış] per bin
      wrong: 0, sorted: 0, misreads: 0,
      ruleIndex: -1, events: [], lastEvt: {}, totalTicks: 0,
    };
  }
  function pushEvt(sim, key, msg) {
    if (sim.lastEvt[key]) return;
    sim.lastEvt[key] = true;
    sim.events.push([+sim.t.toFixed(1), msg]);
    if (sim.events.length > 60) sim.events.shift();
  }

  const RENK_TR = { kirmizi: 'kırmızı', yesil: 'yeşil', mavi: 'mavi' };
  function itemDesc(it) {
    return RENK_TR[it.renk] + ' ' + (it.buyuk ? 'büyük' : 'küçük') + (it.agir ? ' ağır' : '');
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return;
    const m = sim.mission;
    const mode = sim.cfg.mode || 'rules';
    const v = sim.speed;

    sim.items.forEach((it, i) => {
      if (it.gone) return;
      it.x += v * dt;
      // sensör okuma
      if (it.read === null && it.x >= SENSOR_X) {
        let sensed = { renk: it.renk, buyuk: it.buyuk, agir: it.agir };
        if (sim.rnd() < misreadChance(v)) {
          it.misread = true; sim.misreads++;
          const which = Math.floor(sim.rnd() * 3);
          if (which === 0) { const pal2 = m.renkler === 2 ? ['kirmizi', 'mavi'] : RENK; sensed.renk = pal2[(pal2.indexOf(it.renk) + 1) % pal2.length]; }
          else if (which === 1) sensed.buyuk = !sensed.buyuk;
          else sensed.agir = !sensed.agir;
          pushEvt(sim, 'mr' + i, '👁️ Sensör YANLIŞ okudu (#' + (i + 1) + ' ' + itemDesc(it) + ' → "' + itemDesc(sensed) + '") - bant çok hızlı!');
        }
        it.read = sensed;
        const bits = itemBits(sensed);
        const d = mode === 'rules' ? decideRules(sim.cfg.rules || [], bits) : decideFilters(sim.cfg.filters || [], bits);
        it.bin = d.bin;
        sim.ruleIndex = d.ruleIndex;
      }
      // kapak / bant sonu
      if (it.read !== null) {
        const gateX = it.bin < 3 ? GATES_X[it.bin] : BELT_LEN;
        if (it.x >= gateX && !it.gone) {
          if (it.bin < 3) it.pushed = Math.min(1, it.pushed + 3 * dt);
          if (it.bin === 3 || it.pushed >= 1 || it.x >= BELT_LEN) {
            it.gone = true;
            sim.sorted++;
            const correct = m.want(it) === it.bin;
            sim.counts[it.bin][correct ? 0 : 1]++;
            if (!correct) {
              sim.wrong++;
              pushEvt(sim, 'w' + i, '❌ #' + (i + 1) + ' (' + itemDesc(it) + ') YANLIŞ kutuda: ' + (m.bins[it.bin] || 'SON') + (it.misread ? ' - sensör hatası!' : ' - kural hatası!'));
              if (sim.wrong > m.maxWrong) {
                sim.status = 'failed'; sim.reason = 'yanlis';
                return;
              }
            }
          }
        }
      }
    });
    if (sim.status !== 'running') return;

    sim.t += dt;
    sim.totalTicks++;
    if (sim.sorted >= m.count) {
      sim.status = 'success'; sim.reason = 'vardiya_tamam';
      pushEvt(sim, 'fin', '🏁 Vardiya tamam: ' + (m.count - sim.wrong) + '/' + m.count + ' doğru');
    }
    if (sim.t > m.dur) { sim.status = 'failed'; sim.reason = 'kota'; }
  }

  // ---- değerlendirme -----------------------------------------------------------------
  function accuracy(sim) { return Math.round((sim.sorted - sim.wrong) / Math.max(1, sim.mission.count) * 100); }
  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const acc = accuracy(sim);
    const tScore = Math.max(0, 100 - sim.t / sim.mission.dur * 88);
    const total = acc * 0.65 + tScore * 0.35;
    if (total > 85 && sim.wrong === 0) return { name: '🏆 Vardiya Şefi', cmt: 'Sıfır hata, akan hat, erken paydos. Kalite kontrol duvarına fotoğrafın asılır!' };
    if (total > 68) return { name: '🥈 Hat Operatörü', cmt: 'Kota tamam. Madalya için: bant hızını sensörün sınırına kadar it - ama sınırı geçme.' };
    return { name: '🥉 Stajyer', cmt: 'Ucu ucuna yetişti. Kural sıranı ve bant hızını gözden geçir - vardiya şefliği detayda gizli.' };
  }
  function coach(sim) {
    const tips = [];
    const r = sim.reason || '';
    const m = sim.mission;
    if (r === 'yanlis') {
      if (sim.misreads > 0) tips.push('Yanlışların bir kısmı SENSÖR hatası: bant ' + sim.speed.toFixed(1) + ' hızında sensör %' + Math.round(misreadChance(sim.speed) * 100) + ' yanlış okur. 0.9 altı kusursuzdur - hız her zaman kâr değil.');
      else tips.push('Yanlışlar kural hatası: kayıt defterinde hangi ürünün nereye gittiğine bak. Kural SIRASI kritik - üstteki kural kazanır. "Ağır → 1" kuralı en üstte mi?');
    }
    if (r === 'kota') tips.push('Süre doldu, hat yavaş kaldı. Bant hızını artır - ama sensör hata payını hesaba kat: 1.4 hızda %8 hata, ' + m.maxWrong + ' yanlış hakkınla çarpışabilir.');
    if (!tips.length && sim.misreads > 0) tips.push('Bu vardiyada ' + sim.misreads + ' sensör hatası oldu ama kurtardın. Hız-doğruluk sınırında geziniyorsun - bilinçliysen sorun yok!');
    if (!tips.length) tips.push('Kapsam kontrolü: hiçbir kurala uymayan ürün SON kutusuna düşer. SON kutusunun da doğru hedef olduğu görevlerde bu bir özellik, diğerlerinde sessiz bir hatadır.');
    return tips;
  }

  function runHeadless(cfg, maxTime, dt) {
    const sim = createSim(cfg);
    const step = dt || 1 / 30, mt = maxTime || (cfg.mission.dur + 2);
    while (sim.status === 'running' && sim.t < mt) tickSim(sim, step);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(1),
      acc: accuracy(sim), wrong: sim.wrong, misreads: sim.misreads };
  }

  // ---- hazır kodlar --------------------------------------------------------------------
  function starterRulesFor(m) {
    // görev standardını birebir karşılayan kural zinciri (öncelik sırası önemli!)
    switch (m.id) {
      case 'renkayrimi': case 'hizlikota':
        return [
          { pattern: ['on', 'any', 'any', 'any', 'any'], bin: 0 },
          { pattern: ['any', 'any', 'on', 'any', 'any'], bin: 1 },
        ];
      case 'ucrenk':
        return [
          { pattern: ['on', 'any', 'any', 'any', 'any'], bin: 0 },
          { pattern: ['any', 'on', 'any', 'any', 'any'], bin: 1 },
          { pattern: ['any', 'any', 'on', 'any', 'any'], bin: 2 },
        ];
      case 'boyut':
        return [
          { pattern: ['on', 'any', 'any', 'on', 'any'], bin: 0 },
          { pattern: ['on', 'any', 'any', 'off', 'any'], bin: 1 },
          { pattern: ['any', 'any', 'on', 'any', 'any'], bin: 2 },
        ];
      case 'agirlik':
        return [
          { pattern: ['any', 'any', 'any', 'any', 'on'], bin: 0 },   // ÖNCE ağırlar - sıra bozulursa her şey bozulur
          { pattern: ['on', 'any', 'any', 'any', 'any'], bin: 1 },   // kalan kırmızılar (öncelik korur!)
          { pattern: ['any', 'any', 'any', 'any', 'any'], bin: 2 },  // kalan herkes
        ];
      case 'siparis':
        return [
          { pattern: ['any', 'any', 'any', 'on', 'on'], bin: 0 },
          { pattern: ['on', 'any', 'any', 'off', 'any'], bin: 1 },
          { pattern: ['off', 'any', 'any', 'on', 'any'], bin: 2 },
        ];
      case 'kabusvardiya':
        return [
          { pattern: ['on', 'any', 'any', 'any', 'on'], bin: 0 },
          { pattern: ['any', 'any', 'any', 'on', 'off'], bin: 1 },
          { pattern: ['any', 'any', 'on', 'off', 'any'], bin: 2 },
        ];
    }
    return [];
  }
  function starterFiltersFor(m) {
    const r = starterRulesFor(m);
    const f = [{ aktif: false, pattern: ['any','any','any','any','any'] },
               { aktif: false, pattern: ['any','any','any','any','any'] },
               { aktif: false, pattern: ['any','any','any','any','any'] }];
    r.forEach(rule => { if (rule.bin < 3 && !f[rule.bin].aktif) f[rule.bin] = { aktif: true, pattern: rule.pattern.slice() }; });
    return f;
  }
  function defaultLine(m) { return { speed: m.id === 'hizlikota' || m.id === 'kabusvardiya' ? 1.25 : 0.9 }; }

  const API = {
    BELT_LEN, SENSOR_X, GATES_X, SPAWN_GAP, RENK, RENK_TR, MISSIONS,
    makeItems, itemBits, ruleMatches, decideRules, decideFilters, misreadChance, itemDesc,
    createSim, tickSim, accuracy, robotClass, coach, runHeadless,
    starterRulesFor, starterFiltersFor, defaultLine,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.BantCore = API;
})();
