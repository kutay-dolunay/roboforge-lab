/*
 * RoboForge - CanSat Kapsülü (Model Uydu) Simülasyon Çekirdeği
 * Pure, dependency-free. Browser (window.CansatCore) + Node (module.exports).
 *
 * Fiction: TEKNOFEST tarzı model uydu görevi. Taşıyıcı roket kapsülü bırakma
 * irtifasına çıkarır; kapsül ayrılır, serbest düşer. Öğrencinin UÇUŞ BİLGİSAYARI
 * kodu paraşütleri zamanlar: DROGUE (küçük, hızlı-kontrollü iniş) + ANA (büyük,
 * yumuşak iniş). Erken ana = rüzgâr sürüklenmesi, geç = sert iniş, drogue'suz
 * yüksek hızda ana = YIRTILIR. Telemetri yer istasyonuna akar; RF karartmada
 * ekran kör + uplink ölü ama cihaz kodu uçmaya devam eder.
 *
 * Dersler: (1) çift paraşüt zamanlaması = sürüklenme ↔ iniş hızı ödünleşimi,
 * (2) açılma şoku fiziği (hızlıyken büyük paraşüt açılmaz),
 * (3) cihaz-üstü otonomi > yer istasyonu komutu (RF karartma),
 * (4) parafoil modunda Ki = rüzgâr kompanzasyonu,
 * (5) veri kapsama: jüri veri ister - örnekleme hızı görevin parçası.
 */
(function () {
  'use strict';

  const G = 9.8;
  const VT_FREE = 55;        // serbest düşüş terminal hızı (m/s)
  const VT_DROGUE = 18;      // drogue ile iniş
  const VT_MAIN = 6.5;       // ana paraşüt ile iniş
  const VT_PARA = 4.6;       // parafoil dikey süzülme
  const SHOCK_DROGUE = 70;   // drogue açılma hız limiti
  const SHOCK_MAIN = 26;     // ana paraşüt açılma hız limiti (drogue'suz serbest düşüşte AŞILIR)
  const SAFE_LAND = 9;       // güvenli iniş hızı
  const HARD_LAND = 14;      // bunun üstü çakılma
  const ASCENT_V = 90;       // taşıyıcı tırmanış hızı (m/s, scripted)

  // ---- görevler --------------------------------------------------------------
  // wind katmanları: üstten alta [üstSınır, altSınır, rüzgâr m/s (+ = sağa)]
  // blackouts: [başlangıç_irtifa, bitiş_irtifa] arası RF yok (inişte irtifaya bağlı - gerçekçi: mesafe/anten)
  const MISSIONS = [
    { id: 'ilkucus', startX: 0, name: 'İlk Uçuş', difficulty: 'Başlangıç', drop: 500,
      layers: [[9999, 0, 0]], turb: 0, noise: 1.2, blackouts: [], batt: 100,
      targetR: 120, coverageMin: 40, dur: 95,
      desc: 'Rüzgârsız deneme günü. Tepe noktasında drogue, alçakta ana paraşüt - zamanlama dersi.' },
    { id: 'ruzgarli', startX: -225, name: 'Rüzgârlı Gün', difficulty: 'Başlangıç', drop: 550,
      layers: [[9999, 150, 7], [150, 0, 2.5]], turb: 0.4, noise: 1.6, blackouts: [], batt: 100,
      targetR: 85, coverageMin: 45, dur: 100,
      desc: 'Sürekli rüzgâr kapsülü sürükler. Ana paraşütü ne kadar geç açarsan o kadar az sürüklenirsin - ama şok limitini unutma!' },
    { id: 'yuksek', startX: -287, name: 'Yüksek Bırakma', difficulty: 'Orta', drop: 900,
      layers: [[9999, 400, 9], [400, 120, 5], [120, 0, 1.5]], turb: 0.5, noise: 2.2, blackouts: [], batt: 100,
      targetR: 90, coverageMin: 45, dur: 120,
      desc: '900 metre! Serbest düşüş 55 m/s’ye ulaşır - drogue olmadan ana paraşüt YIRTILIR. Kademeli fren şart.' },
    { id: 'tersruzgar', startX: 57, name: 'Ters Akıntı', difficulty: 'Orta', drop: 700,
      layers: [[9999, 350, 10], [350, 120, -6], [120, 0, -2]], turb: 0.6, noise: 2.4, blackouts: [], batt: 100,
      targetR: 75, coverageMin: 50, dur: 110,
      desc: 'Üst katman sağa, alt katman SOLA esiyor. Katmanları akıllıca kullan: hangi irtifada ne kadar süre kalacaksın?' },
    { id: 'karartma', startX: -232, name: 'RF Karartması', difficulty: 'İleri', drop: 750,
      layers: [[9999, 300, 8], [300, 0, 3]], turb: 0.7, noise: 3.2, blackouts: [[620, 420], [260, 140]], batt: 95,
      targetR: 80, coverageMin: 55, dur: 110,
      desc: 'İki irtifa bandında telsiz kör: ekran donar, uplink ölür. Uçuş bilgisayarındaki kurallar tek başına uçurur.' },
    { id: 'firtina', startX: -231, name: 'Fırtına İnişi', difficulty: 'İleri', drop: 800,
      layers: [[9999, 380, 12], [380, 130, 6], [130, 0, -3]], turb: 2.2, noise: 4.0, blackouts: [[540, 400]], batt: 90,
      targetR: 70, coverageMin: 55, dur: 115,
      desc: 'Türbülans kapsülü savurur, sensörler gürültülü. Dar hedef + sıkı şok limitleri: gerçek pilotaj.' },
    { id: 'yarisma', startX: -139, name: 'Yarışma Günü', difficulty: 'Uzman', drop: 700,
      layers: [[9999, 420, 11], [420, 160, 5.5], [160, 0, -2.5]], turb: 1.6, noise: 3.5,
      blackouts: [[600, 470], [300, 190]], batt: 80,
      targetR: 60, coverageMin: 65, dur: 105,
      desc: 'TEKNOFEST profili: katmanlı rüzgâr, çift karartma, dar hedef, kısıtlı batarya ve %65 veri kapsama şartı. Jüri izliyor!' },
  ];

  function windAt(mission, alt, t, seed) {
    let w = 0;
    for (const [top, bot, val] of mission.layers) { if (alt <= top && alt > bot) { w = val; break; } }
    if (mission.turb > 0) {
      // deterministik türbülans (seed'li sinüs karışımı)
      w += mission.turb * (Math.sin(t * 1.7 + seed) * 0.6 + Math.sin(t * 4.3 + seed * 2.1) * 0.4);
    }
    return w;
  }
  function inBlackout(mission, alt, phase) {
    if (phase === 'tasima') return false;
    for (const [hi, lo] of mission.blackouts) { if (alt <= hi && alt >= lo) return true; }
    return false;
  }

  // ---- kural motoru (ev deseni) ---------------------------------------------
  function ruleMatches(pattern, bits) {
    for (let i = 0; i < bits.length; i++) {
      const p = pattern[i] || 'any';
      if (p === 'on' && !bits[i]) return false;
      if (p === 'off' && bits[i]) return false;
    }
    return true;
  }
  const DEVICES = ['drogue', 'ana', 'beacon'];
  function evalRules(rules, bits, act) {
    const set = {};
    let fired = -1;
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (set[r.device] !== undefined) continue;
      if (ruleMatches(r.pattern, bits)) { set[r.device] = r.state ? 1 : 0; if (fired < 0) fired = i; }
    }
    for (const d of DEVICES) if (set[d] !== undefined) {
      // paraşütler tek yönlü: açıldıysa kapanmaz
      if ((d === 'drogue' || d === 'ana') && act[d] === 1) continue;
      act[d] = set[d];
    }
    return fired;
  }

  // ---- sim -------------------------------------------------------------------
  function createSim(cfg) {
    const m = cfg.mission;
    const p = cfg.params || defaultParams();
    return {
      cfg, mission: m, t: 0, status: 'running', reason: null,
      phase: 'tasima',                 // tasima → ucus → indi
      alt: 0, vy: 0, x: m.startX || 0, vx: 0,      // taşıyıcı hedefin RÜZGÂR ÜSTÜNE bırakır (görev planı) - hedef x=0
      maxAlt: 0, seed: (m.id.length * 7.3) % 6.28,
      act: { drogue: 0, ana: 0, beacon: 0 },
      chuteState: 'yok',               // yok | drogue | ana | parafoil | yirtik
      shockPeak: 0, tornAt: null,
      sensed: { alt: 0, vy: 0, x: 0, freefall: false },
      lastSample: -99, samples: 0,
      batt: m.batt * (p.battMul || 1), battMax: m.batt * (p.battMul || 1), battOut: false,
      link: true, iErr: 0, ruleIndex: -1,
      manual: {},
      log: [], events: [], lastEvt: {},
      landVy: null, landX: null,
      totalTicks: 0,
    };
  }
  function pushEvt(sim, key, msg) {
    if (sim.lastEvt[key]) return;
    sim.lastEvt[key] = true;
    sim.events.push([+sim.t.toFixed(1), Math.round(sim.alt), msg]);
    if (sim.events.length > 60) sim.events.shift();
  }
  function clearEvt(sim, key) { sim.lastEvt[key] = false; }

  function deploy(sim, which) {
    // which: 'drogue' | 'ana' | 'parafoil'
    if (sim.phase === 'tasima') { sim.status = 'failed'; sim.reason = 'erken_ayrilma';
      sim.events.push([+sim.t.toFixed(1), Math.round(sim.alt), '💥 Paraşüt taşıyıcı içinde açıldı - görev iptal!']); return; }
    const spd = Math.abs(sim.vy);
    if (which === 'drogue') {
      if (sim.chuteState !== 'yok') return;
      if (spd > SHOCK_DROGUE) { sim.chuteState = 'yirtik'; sim.tornAt = sim.t;
        pushEvt(sim, 'torn', '💥 DROGUE KOPTU! Açılma hızı ' + spd.toFixed(0) + ' m/s (limit ' + SHOCK_DROGUE + ')'); return; }
      sim.chuteState = 'drogue';
      sim.shockPeak = Math.max(sim.shockPeak, spd);
      pushEvt(sim, 'dro', '🪂 Drogue açıldı (' + spd.toFixed(0) + ' m/s, ' + Math.round(sim.alt) + ' m)');
    } else if (which === 'ana' || which === 'parafoil') {
      if (sim.chuteState === 'ana' || sim.chuteState === 'parafoil' || sim.chuteState === 'yirtik') return;
      if (spd > SHOCK_MAIN) { sim.chuteState = 'yirtik'; sim.tornAt = sim.t;
        pushEvt(sim, 'torn', '💥 ANA PARAŞÜT YIRTILDI! Açılma hızı ' + spd.toFixed(0) + ' m/s (limit ' + SHOCK_MAIN + ') - önce drogue ile yavaşla!'); return; }
      sim.chuteState = which === 'ana' ? 'ana' : 'parafoil';
      sim.shockPeak = Math.max(sim.shockPeak, spd);
      pushEvt(sim, 'main', (which === 'ana' ? '🪂 ANA paraşüt açıldı (' : '🪁 Parafoil açıldı (') + spd.toFixed(0) + ' m/s, ' + Math.round(sim.alt) + ' m)');
    }
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return sim.lastOut;
    const m = sim.mission;
    const pid = sim.cfg.pid || defaultPID();
    const mode = sim.cfg.mode || 'rules';

    // ---- faz: taşıma ----
    if (sim.phase === 'tasima') {
      sim.vy = ASCENT_V;
      sim.alt += ASCENT_V * dt;
      if (sim.alt >= m.drop) { sim.phase = 'ucus'; sim.vy = 0;
        pushEvt(sim, 'sep', '🚀 Kapsül taşıyıcıdan ayrıldı - ' + Math.round(sim.alt) + ' m'); }
    }

    // ---- RF / link ----
    sim.link = !inBlackout(m, sim.alt, sim.phase) && !sim.battOut;
    if (!sim.link && sim.phase === 'ucus' && !sim.battOut) pushEvt(sim, 'rf', '📡 RF KARARTMASI - telemetri kesildi'); 
    if (sim.link) clearEvt(sim, 'rf');

    // ---- örnekleme (baro gürültüsü + Hz kilidi; kayıt CİHAZDA - karartma kaydı etkilemez) ----
    const hz = Math.max(0.5, sim.cfg.sampleHz || 2);
    if (sim.t - sim.lastSample >= 1 / hz && !sim.battOut) {
      sim.lastSample = sim.t;
      const n = m.noise;
      const nz = (Math.sin(sim.t * 13.7 + sim.seed) + Math.sin(sim.t * 7.1)) * 0.5 * n;
      sim.sensed.alt = Math.max(0, sim.alt + nz);
      sim.sensed.vy = sim.vy + nz * 0.35;
      sim.sensed.x = sim.x + nz * 2.2;
      sim.sensed.freefall = sim.phase === 'ucus' && sim.chuteState === 'yok';
      sim.samples++;
    }

    // ---- kontrol ----
    if ((sim.phase === 'ucus' || sim.phase === 'tasima') && !sim.battOut) {
      const sn = sim.sensed;
      const apogee = sim.chuteState === 'yok' && sn.vy < 2 && sim.alt > m.drop * 0.5;
      const bits = [
        sn.vy > 2,                        // 0 TIRMANIYOR
        apogee || sn.freefall,            // 1 DÜŞÜŞTE (tepe geçildi / serbest düşüş)
        sn.alt < 500,                     // 2 İRT < 500
        sn.alt < 250,                     // 3 İRT < 250
        sn.alt < 120,                     // 4 İRT < 120
        Math.abs(sn.vy) > 25,             // 5 HIZLI
        sim.alt < 3,                      // 6 YERDE
      ];
      if (mode === 'rules') {
        const before = { ...sim.act };
        sim.ruleIndex = evalRules(sim.cfg.rules || [], bits, sim.act);
        if (sim.act.drogue && !before.drogue) deploy(sim, 'drogue');
        if (sim.act.ana && !before.ana) deploy(sim, 'ana');
        if (sim.act.drogue && sim.chuteState === 'yok') sim.act.drogue = sim.chuteState === 'drogue' ? 1 : sim.act.drogue;
        if (sim.act.beacon && !before.beacon) pushEvt(sim, 'bea', '📢 Beacon aktif - kurtarma ekibi sinyali aldı');
      } else {
        // 📈 Parafoil otopilotu: drogue apogee'de (firmware), parafoil pid.acilis irtifasında
        if (sim.chuteState === 'yok' && bits[1]) deploy(sim, 'drogue');
        if (sim.chuteState === 'drogue' && sn.alt < (pid.acilis || 260)) deploy(sim, 'parafoil');
        if (sim.alt < 3) sim.act.beacon = 1;
        if (sim.chuteState === 'parafoil') {
          const err = sn.x - 0;                     // hedef x = 0
          sim.iErr = Math.max(-600, Math.min(600, sim.iErr + err * dt));
          const cmd = -((pid.kp || 0) * err + (pid.ki || 0) * sim.iErr);
          sim.paraCmd = Math.max(-8, Math.min(8, cmd));
        }
      }
      // manuel uplink kilitleri (yalnız link varken gönderilmiş olabilir)
      for (const d of DEVICES) {
        if (sim.manual[d] !== undefined) {
          if (d === 'drogue' && sim.manual[d]) deploy(sim, 'drogue');
          if (d === 'ana' && sim.manual[d]) deploy(sim, 'ana');
          if (d === 'beacon') sim.act.beacon = sim.manual[d];
          delete sim.manual[d];
        }
      }
    }

    // ---- fizik: uçuş ----
    if (sim.phase === 'ucus') {
      const vt = sim.chuteState === 'drogue' ? VT_DROGUE
        : sim.chuteState === 'ana' ? VT_MAIN
        : sim.chuteState === 'parafoil' ? VT_PARA
        : VT_FREE;   // yok veya yirtik → serbest
      // dikey: yerçekimi + hıza karşı sürükleme (terminal hız modeli)
      const drag = G * (sim.vy * sim.vy) / (vt * vt) * (sim.vy < 0 ? 1 : 0.25);
      sim.vy += (-G + (sim.vy < 0 ? drag : -drag * 0.3)) * dt;
      // paraşüt açılınca ekstra sönümleme (hızlı geçiş)
      if (sim.chuteState !== 'yok' && sim.chuteState !== 'yirtik' && sim.vy < -vt) {
        sim.vy += (Math.abs(sim.vy) - vt) * 2.2 * dt;
      }
      // yatay: rüzgâr sürüklenmesi (paraşüt tipine göre bağlanma oranı) + parafoil komutu
      const w = windAt(m, sim.alt, sim.t, sim.seed);
      const couple = sim.chuteState === 'ana' ? 1.0 : sim.chuteState === 'parafoil' ? 0.85
        : sim.chuteState === 'drogue' ? 0.55 : 0.15;
      let targetVx = w * couple;
      if (sim.chuteState === 'parafoil') targetVx += (sim.paraCmd || 0);
      sim.vx += (targetVx - sim.vx) * Math.min(1, 2.5 * dt);
      sim.x += sim.vx * dt;
      sim.alt += sim.vy * dt;
      if (sim.alt > sim.maxAlt) sim.maxAlt = sim.alt;

      // ---- iniş ----
      if (sim.alt <= 0) {
        sim.alt = 0; sim.phase = 'indi';
        sim.landVy = Math.abs(sim.vy); sim.landX = sim.x;
        const onTarget = Math.abs(sim.x) <= m.targetR;
        const coverage = coverageOf(sim);
        if (sim.landVy > HARD_LAND) { sim.status = 'failed'; sim.reason = 'cakilma'; }
        else if (sim.landVy > SAFE_LAND) { sim.status = 'failed'; sim.reason = 'sert_inis'; }
        else if (!onTarget) { sim.status = 'failed'; sim.reason = 'hedef_disi'; }
        else if (coverage < m.coverageMin) { sim.status = 'failed'; sim.reason = 'veri_yetersiz'; }
        else { sim.status = 'success'; sim.reason = 'gorev_tamam'; }
        pushEvt(sim, 'land', (sim.status === 'success' ? '🎯 ' : '⬇️ ') + 'İniş: ' + sim.landVy.toFixed(1) + ' m/s, hedefe ' + Math.abs(Math.round(sim.x)) + ' m' + (sim.act.beacon ? ' · beacon açık' : ''));
      }
    }

    // ---- batarya ----
    if (!sim.battOut && sim.phase !== 'indi') {
      const hz2 = Math.max(0.5, sim.cfg.sampleHz || 2);
      const drain = 0.10 + 0.24 * hz2 + (sim.act.beacon ? 0.35 : 0);
      sim.batt -= drain * dt;
      if (sim.batt <= 0) { sim.batt = 0; sim.battOut = true;
        pushEvt(sim, 'batt', '🪫 Batarya bitti - kayıt VE kontrol durdu!'); }
    }

    // ---- kayıt ----
    sim.totalTicks++;
    if (sim.totalTicks % 5 === 0) {
      sim.log.push([sim.t, sim.alt, sim.vy, sim.x, sim.link ? 1 : 0, sim.batt / sim.battMax * 100, sim.chuteState === 'yok' ? 0 : sim.chuteState === 'drogue' ? 1 : sim.chuteState === 'yirtik' ? 3 : 2]);
      if (sim.log.length > 3000) sim.log.shift();
    }

    sim.t += dt;
    if (sim.t > m.dur && sim.status === 'running') { sim.status = 'failed'; sim.reason = 'timeout'; }
    sim.lastOut = { wind: windAt(m, sim.alt, sim.t, sim.seed) };
    return sim.lastOut;
  }

  function coverageOf(sim) {
    // jüri şartı: uçuş boyunca saniyede ≥2 kayıt ideali
    const flightT = Math.max(1, sim.t - sim.mission.drop / ASCENT_V);
    return Math.min(100, Math.round(sim.samples / (flightT * 2) * 100));
  }

  // yer istasyonu uplink - yalnız link varken
  function sendCommand(sim, device, state) {
    if (!sim.link) return { ok: false, msg: 'RF KARARTMASI - komut kapsüle ulaşmadı!' };
    if (sim.battOut) return { ok: false, msg: 'Kapsül sessiz (batarya).' };
    if (sim.phase !== 'ucus') return { ok: false, msg: 'Kapsül uçuşta değil.' };
    sim.manual[device] = state ? 1 : 0;
    sim.events.push([+sim.t.toFixed(1), Math.round(sim.alt), '🎮 Uplink: ' + device.toUpperCase() + (state ? ' AÇ' : ' KAPAT')]);
    return { ok: true };
  }

  // ---- değerlendirme ----------------------------------------------------------
  function score(sim) {
    const m = sim.mission;
    const acc = sim.landX == null ? 0 : Math.max(0, 100 - Math.abs(sim.landX) / m.targetR * 100);
    const soft = sim.landVy == null ? 0 : Math.max(0, 100 - sim.landVy / SAFE_LAND * 60);
    return { acc: Math.round(acc), soft: Math.round(soft), coverage: coverageOf(sim) };
  }
  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const s = score(sim);
    const total = s.acc * 0.4 + s.soft * 0.3 + s.coverage * 0.3;
    if (total > 80 && sim.act.beacon) return { name: '🏆 Görev Komutanı', cmt: 'Hedefin ortasına kuş gibi indin, veri paketi eksiksiz, beacon açık. Jüri ayakta!' };
    if (total > 62) return { name: '🥈 Uçuş Mühendisi', cmt: 'Sağlam uçuş. Madalya için: ana paraşütü biraz daha geç aç, sürüklenmeyi kıs.' };
    return { name: '🥉 Kadet', cmt: 'Kapsül sağlam indi ama puanlar sınırda. Zamanlamayı ve örnekleme hızını gözden geçir.' };
  }
  function coach(sim) {
    const tips = [];
    const r = sim.reason || '';
    if (r === 'cakilma') {
      if (sim.chuteState === 'yirtik') tips.push('Paraşüt YIRTILDI çünkü çok hızlıyken açtın. Sıralama: önce DROGUE (55 m/s’de bile dayanır), hız 18’e düşünce ANA. Şok limiti fiziktir, pazarlık olmaz.');
      else if (sim.chuteState === 'yok') tips.push('Paraşüt hiç açılmadı! DÜŞÜŞTE bitini yakalayıp DROGUE aç, sonra alçak irtifada ANA. Kuralların hangi bitlere baktığını kontrol et.');
      else if (sim.chuteState === 'drogue') tips.push('Sadece drogue ile indin - 18 m/s çakılmadır. İRT<250 civarında ANA paraşütü açmayı unutma.');
      else tips.push('Ana paraşüt çok GEÇ açıldı - yavaşlamaya vakit kalmadı. Açılma irtifasını yükselt.');
    }
    if (r === 'sert_inis') tips.push('İniş 9 m/s sınırının üstünde. Ana paraşüt daha erken açılmalı ki hız otursun - ama çok erken de sürüklenme demek. 120-250 m bandını dene.');
    if (r === 'hedef_disi') tips.push('Kapsül hedef bölge dışına indi: ' + Math.round(Math.abs(sim.landX || 0)) + ' m. Büyük paraşüt = yelken! Rüzgârlı katmanları drogue ile HIZLI geç, anayı alçakta aç.');
    if (r === 'veri_yetersiz') tips.push('Jüri raporu reddetti: veri kapsama %' + coverageOf(sim) + ' < %' + sim.mission.coverageMin + '. Örnekleme hızını artır - ama batarya dengesini gözet.');
    if (r === 'erken_ayrilma') tips.push('Paraşüt TAŞIYICININ İÇİNDE açıldı! TIRMANIYOR biti EVET iken hiçbir paraşüt kuralı ateşlememeli. Kurallarına "TIRMANIYOR: HAYIR" çipi ekle.');
    if (r === 'timeout') tips.push('Süre doldu - kapsül çok uzun süre havada kaldı. Drogue inişi daha hızlıdır; anayı gereksiz erken açma.');
    if (sim.battOut) tips.push('Batarya uçuş bitmeden öldü: kayıt da kontrol de durdu. Örnekleme hızını düşür veya beacon’ı yerde aç.');
    if (sim.status === 'success' && !sim.act.beacon) tips.push('İniş güzel ama beacon KAPALI - kurtarma ekibi kapsülü tarlada arayacak. YERDE → BEACON AÇ kuralı ekle.');
    if (!tips.length) tips.push('Rüzgâr katmanlarını raporda incele: drogue rüzgâra %55, ana %100 bağlanır. Zamanlama = yatay hedefleme aracıdır.');
    return tips;
  }

  function runHeadless(cfg, maxTime, dt) {
    const sim = createSim(cfg);
    const step = dt || 1 / 60, mt = maxTime || (cfg.mission.dur + 5);
    while (sim.status === 'running' && sim.t < mt) tickSim(sim, step);
    const s = score(sim);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(1),
      landVy: sim.landVy == null ? null : +sim.landVy.toFixed(1),
      landX: sim.landX == null ? null : Math.round(sim.landX),
      acc: s.acc, coverage: s.coverage, batt: Math.round(sim.batt / sim.battMax * 100),
      chute: sim.chuteState, shock: Math.round(sim.shockPeak) };
  }

  // ---- başlangıç kodları -------------------------------------------------------
  function starterRules() {
    return [
      // [TIRMANIYOR, DÜŞÜŞTE, İRT<500, İRT<250, İRT<120, HIZLI, YERDE]
      { pattern: ['off', 'on', 'any', 'any', 'any', 'any', 'off'], device: 'drogue', state: 1 }, // düşüş başladı → drogue
      { pattern: ['off', 'any', 'any', 'on', 'any', 'any', 'off'], device: 'ana', state: 1 },    // 250 m altı → ana
      { pattern: ['off', 'any', 'any', 'any', 'any', 'any', 'on'], device: 'beacon', state: 1 }, // yerde (tırmanışta değil) → beacon
    ];
  }
  function defaultPID() { return { acilis: 260, kp: 0.06, ki: 0.010 }; }
  function defaultParams() { return { battMul: 1.0 }; }

  const API = {
    G, VT_FREE, VT_DROGUE, VT_MAIN, VT_PARA, SHOCK_DROGUE, SHOCK_MAIN, SAFE_LAND, HARD_LAND, ASCENT_V,
    MISSIONS, DEVICES, windAt, inBlackout, ruleMatches, evalRules,
    createSim, tickSim, sendCommand, deploy, coverageOf, score, robotClass, coach, runHeadless,
    starterRules, defaultPID, defaultParams,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.CansatCore = API;
})();
