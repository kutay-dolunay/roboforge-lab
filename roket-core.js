/*
 * RoboForge — Roket İniş (Hoverslam) Simülasyon Çekirdeği
 * Pure, dependency-free. Browser (window.RoketCore) + Node (module.exports).
 *
 * Suicide burn / hoverslam: motoru TAM DOĞRU anda ateşle. Erken = havada asılı
 * kalır, yakıt biter, düşersin. Geç = çakılırsın. Dersler: (1) h_yakma =
 * v²/(2·a_net) — fizik formülü hayat kurtarır, (2) yakıt yandıkça roket HAFİFLER
 * → itki ivmesi artar (değişken kütle!), (3) ateşleme gecikmesi varsa ERKEN başla,
 * (4) kısma (throttle) son metrelerde yumuşatır.
 */
(function () {
  'use strict';

  const G = 9.8;
  const SAFE_V = 3.0, HARD_V = 6.5;

  // dryMass + fuel; thrust sabit kuvvet → ivme = thrust/m - g (m küçüldükçe artar)
  const MISSIONS = [
    { id: 'ilkinis', name: 'İlk İniş', difficulty: 'Başlangıç', alt: 130, v0: -22,
      dry: 1.0, fuel: 46, burnRate: 6.0, thrust: 65, delay: 0, dur: 30,
      desc: 'Klasik hoverslam: 130 metreden 22 m/s ile düşüyorsun. Motoru doğru irtifada ateşle — ne erken ne geç.' },
    { id: 'agirkargo', name: 'Ağır Kargo', difficulty: 'Başlangıç', alt: 140, v0: -20,
      dry: 1.7, fuel: 52, burnRate: 6.0, thrust: 76, delay: 0, dur: 32,
      desc: 'Kargo ağır: itki ivmen düşük, yakma mesafen UZUN. Aynı formül, farklı sayılar — hesabı yeniden yap.' },
    { id: 'azyakit', name: 'Son Damla', difficulty: 'Orta', alt: 150, v0: -24,
      dry: 1.0, fuel: 26, burnRate: 6.0, thrust: 50, delay: 0, dur: 32,
      desc: 'Yakıt deposu neredeyse boş: hover lüksün YOK. Tek şansın kusursuz zamanlanmış tek yakma.' },
    { id: 'gecikme', name: 'Tembel Ateşleyici', difficulty: 'Orta', alt: 140, v0: -23,
      dry: 1.0, fuel: 44, burnRate: 6.0, thrust: 63, delay: 0.55, dur: 32,
      desc: 'Motor ateşleme komutundan 0.55 saniye SONRA çalışır. O yarım saniyede 13 metre düşersin — erken komuta!' },
    { id: 'hizligiris', name: 'Sıcak Giriş', difficulty: 'İleri', alt: 170, v0: -38,
      dry: 1.0, fuel: 50, burnRate: 6.5, thrust: 76, delay: 0.2, dur: 32,
      desc: '38 m/s ile dalıyorsun — yakma mesafesi hızın KARESİYLE büyür. Gözünle değil, formülle karar ver.' },
    { id: 'zayifmotor', name: 'Zayıf Motor', difficulty: 'İleri', alt: 160, v0: -20,
      dry: 1.3, fuel: 60, burnRate: 5.0, thrust: 57, delay: 0.2, dur: 40,
      desc: 'İtki/ağırlık oranı 1.3 — fren mesafen upuzun, hata payın sıfıra yakın. Sabırlı ve erken yakma.' },
    { id: 'kabusinis', name: 'Kâbus İnişi', difficulty: 'Uzman', alt: 180, v0: -34,
      dry: 1.4, fuel: 34, burnRate: 6.0, thrust: 55, delay: 0.5, dur: 36,
      desc: 'Hızlı giriş + ağır gövde + kıt yakıt + tembel ateşleyici. Gerçek roket mühendisliği: her şey aynı anda doğru olacak.' },
  ];

  function ruleMatches(pattern, bits) {
    for (let i = 0; i < bits.length; i++) {
      const p = pattern[i] || 'any';
      if (p === 'on' && !bits[i]) return false;
      if (p === 'off' && bits[i]) return false;
    }
    return true;
  }
  function evalRules(rules, bits) {
    for (let i = 0; i < rules.length; i++) {
      if (ruleMatches(rules[i].pattern, bits)) return { thr: rules[i].thr, ruleIndex: i };
    }
    return { thr: 0, ruleIndex: -1 };
  }

  function createSim(cfg) {
    const m = cfg.mission;
    return {
      cfg, mission: m, t: 0, status: 'running', reason: null,
      alt: m.alt, v: m.v0, fuel: m.fuel, mass: m.dry + m.fuel * 0.05,
      thrCmd: 0, thrAct: 0, igniteT: -1, burning: false,
      landV: null, peakA: 0, hoverT: 0,
      log: [], events: [], lastEvt: {}, ruleIndex: -1, totalTicks: 0,
    };
  }
  function pushEvt(sim, key, msg) {
    if (sim.lastEvt[key]) return;
    sim.lastEvt[key] = true;
    sim.events.push([+sim.t.toFixed(1), Math.round(sim.alt), msg]);
    if (sim.events.length > 40) sim.events.shift();
  }

  // yakma irtifası formülü (öğrenci aracı + otopilot çekirdeği)
  function burnAlt(m, v, margin) {
    const mass = m.dry + m.fuel * 0.05;
    const aNet = m.thrust / mass - G;                  // fren ivmesi (kötümser: dolu kütle)
    const delayDrop = Math.abs(v) * m.delay + 0.5 * G * m.delay * m.delay;
    return (v * v) / (2 * Math.max(0.5, aNet)) * (margin || 1.15) + delayDrop;
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return;
    const m = sim.mission;
    const mode = sim.cfg.mode || 'rules';

    // ---- kontrol ----
    let thr = 0;
    if (mode === 'rules') {
      const hb = burnAlt(m, sim.v, 1.15);
      const bits = [
        sim.alt > hb * 1.6,                    // 0 YAKMA NOKTASININ ÜSTÜNDE (serbest düş)
        sim.alt <= hb * 1.6 && sim.alt > hb,   // 1 YAKLAŞIYOR
        sim.alt <= hb,                          // 2 YAKMA NOKTASI! (formül hesapladı)
        sim.alt < 25,                           // 3 ALÇAK (<25 m)
        -sim.v > 30,                            // 4 ÇOK HIZLI
        -sim.v < 2.6,                           // 5 YAVAŞLADI (<2.6 m/s)
        sim.fuel < m.fuel * 0.25,               // 6 YAKIT AZ
      ];
      const r = evalRules(sim.cfg.rules || [], bits);
      thr = r.thr; sim.ruleIndex = r.ruleIndex;
    } else {
      const pid = sim.cfg.pid || defaultPID();
      const hb = burnAlt(m, sim.v, pid.marj || 1.15);
      if (sim.alt <= hb && sim.v < -1) thr = 1;
      if (sim.alt > 14 && -sim.v < 4.5) thr = 0;          // yüksekte yavaşladıysan kes — tekrar süzül (hover yok!)
      if (sim.alt < 14 && sim.v < 0) {
        const vWant = -Math.max(pid.sonHiz || 2, sim.alt * 0.55);
        if (sim.v < vWant) thr = 1;
        else if (pid.kisma) thr = Math.max(0.25, Math.min(0.6, 0.4 + (vWant - sim.v) * 0.3));
        else thr = 0;
      }
    }
    thr = Math.max(0, Math.min(1, thr));

    // ---- ateşleme gecikmesi ----
    if (thr > 0 && !sim.burning) {
      if (sim.igniteT < 0) { sim.igniteT = sim.t;
        if (m.delay > 0) pushEvt(sim, 'ign', '🔥 Ateşleme komutu — motor ' + m.delay + ' sn sonra çalışacak'); }
      if (sim.t - sim.igniteT >= m.delay) { sim.burning = true;
        pushEvt(sim, 'burn', '🚀 MOTOR ÇALIŞTI (' + Math.round(sim.alt) + ' m, ' + Math.abs(sim.v).toFixed(0) + ' m/s)'); }
    }
    if (thr === 0) { sim.igniteT = -1; if (sim.burning) { sim.burning = false; pushEvt(sim, 'cut' + Math.round(sim.t), '⏹ Motor kesildi (' + Math.round(sim.alt) + ' m)'); } }
    sim.thrCmd = thr;
    sim.thrAct = sim.burning && sim.fuel > 0 ? thr : 0;

    // ---- fizik ----
    if (sim.thrAct > 0) {
      sim.fuel = Math.max(0, sim.fuel - m.burnRate * sim.thrAct * dt);
      if (sim.fuel <= 0) pushEvt(sim, 'dry', '🪫 YAKIT BİTTİ — serbest düşüş!');
    }
    sim.mass = m.dry + sim.fuel * 0.05;
    const a = (sim.thrAct > 0 && sim.fuel > 0 ? (m.thrust * sim.thrAct) / sim.mass : 0) - G;
    sim.peakA = Math.max(sim.peakA, a + G);
    sim.v += a * dt;
    sim.alt += sim.v * dt;
    if (Math.abs(sim.v) < 1.2 && sim.alt > 8 && sim.thrAct > 0) sim.hoverT += dt; else sim.hoverT = Math.max(0, sim.hoverT - dt * 0.5);
    if (sim.hoverT > 2.5) pushEvt(sim, 'hover', '⚠️ HAVADA ASILISIN — her saniye yakıt, aşağıda hâlâ ' + Math.round(sim.alt) + ' m var');

    // ---- iniş ----
    if (sim.alt <= 0) {
      sim.alt = 0; sim.landV = Math.abs(sim.v);
      if (sim.landV <= SAFE_V) { sim.status = 'success'; sim.reason = 'indi';
        pushEvt(sim, 'land', '🎯 YUMUŞAK İNİŞ: ' + sim.landV.toFixed(1) + ' m/s' + (sim.fuel > 0 ? ' · kalan yakıt ' + sim.fuel.toFixed(0) : '')); }
      else if (sim.landV <= HARD_V) { sim.status = 'failed'; sim.reason = 'sert';
        pushEvt(sim, 'land', '💢 Sert iniş: ' + sim.landV.toFixed(1) + ' m/s — bacaklar kırıldı'); }
      else { sim.status = 'failed'; sim.reason = 'cakilma';
        pushEvt(sim, 'land', '💥 ÇAKILMA: ' + sim.landV.toFixed(1) + ' m/s'); }
    }

    sim.totalTicks++;
    if (sim.totalTicks % 3 === 0) {
      sim.log.push([sim.t, sim.alt, sim.v, sim.fuel / m.fuel * 100, sim.thrAct]);
      if (sim.log.length > 3000) sim.log.shift();
    }
    sim.t += dt;
    if (sim.t > m.dur) { sim.status = 'failed'; sim.reason = 'sure'; }
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const fuelPct = sim.fuel / sim.mission.fuel * 100;
    const soft = Math.max(0, 100 - sim.landV / SAFE_V * 55);
    const total = fuelPct * 0.55 + soft * 0.45;
    if (total > 52) return { name: '🏆 Hoverslam Efsanesi', cmt: 'Tek yakma, tüy gibi iniş, depoda yakıt. Booster kurtarma ekibi seni işe alır!' };
    if (total > 30) return { name: '🥈 Roket Pilotu', cmt: 'İndin! Madalya için: daha geç yak, daha az hover — yakıt marjı puandır.' };
    return { name: '🥉 Test Pilotu', cmt: 'Son damlayla indin. Yakma irtifanı formüle yaklaştır: h = v²/(2·a) + pay.' };
  }
  function coach(sim) {
    const tips = [];
    const r = sim.reason || '';
    const m = sim.mission;
    if (r === 'cakilma' || r === 'sert') {
      if (sim.fuel <= 0.5) tips.push('Yakıt bitti: motoru ÇOK ERKEN yaktın, hover yaptın, düştün. Hoverslam sabır işidir — h_yakma = v²/(2·a_net)' + (m.delay ? ' + gecikme payı' : '') + '. Geç yak, sert yak.');
      else tips.push('Çok GEÇ yaktın. Fren mesafesi hızın karesiyle büyür: ' + Math.abs(m.v0) + ' m/s girişte ~' + Math.round(burnAlt(m, m.v0, 1.0)) + ' m gerekir. Marjını artır' + (m.delay ? ' — ve ateşleme gecikmesini unutma: komut ' + m.delay + ' sn önce verilmeli!' : '.'));
    }
    if (r === 'sure') tips.push('Süre doldu — muhtemelen havada asılı kaldın. Hover, hoverslam DEĞİLDİR: yavaşladıysan kes, tekrar hızlan, alçakta tekrar yak. En iyisi: hiç hover etme.');
    if (sim.status === 'success' && sim.fuel < m.fuel * 0.1) tips.push('İndin ama depo bomboş. Erken yakma + hover = israf. Yakma irtifanı düşür, kalan yakıt madalya getirir.');
    if (!tips.length) tips.push('Değişken kütle cilvesi: yakıt yandıkça roket hafifler, aynı itki daha çok ivme verir — yakmanın SONU başından güçlüdür. Formüldeki kötümser (dolu kütle) hesap bu yüzden güvenlidir.');
    return tips;
  }

  function runHeadless(cfg, maxTime, dt) {
    const sim = createSim(cfg);
    const step = dt || 1 / 60, mt = maxTime || (cfg.mission.dur + 2);
    while (sim.status === 'running' && sim.t < mt) tickSim(sim, step);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(1),
      landV: sim.landV == null ? null : +sim.landV.toFixed(1),
      fuel: +(sim.fuel / cfg.mission.fuel * 100).toFixed(0) };
  }

  function starterRules() {
    return [
      // [ÜSTÜNDE, YAKLAŞIYOR, YAKMA NOKTASI, ALÇAK, ÇOK HIZLI, YAVAŞLADI, YAKIT AZ]
      { pattern: ['any', 'any', 'any', 'on', 'any', 'on', 'any'],  thr: 0.22 },  // alçak + yavaş → rölanti (alev SÖNMEZ — ateşleme gecikmesi tuzağı yok)
      { pattern: ['any', 'any', 'any', 'on', 'any', 'off', 'any'], thr: 1 },     // alçak ama hızlı → TAM GAZ
      { pattern: ['any', 'any', 'any', 'off', 'any', 'on', 'any'], thr: 0 },     // yüksekte yavaşladıysan kes — süzül
      { pattern: ['any', 'any', 'on', 'any', 'any', 'any', 'any'], thr: 1 },     // yakma noktası → TAM GAZ
      { pattern: ['on', 'any', 'any', 'any', 'any', 'any', 'any'], thr: 0 },     // hâlâ yüksekte → serbest düş
    ];
  }
  function defaultPID() { return { marj: 1.15, sonHiz: 2.0, kisma: true }; }

  const API = {
    G, SAFE_V, HARD_V, MISSIONS, ruleMatches, evalRules, burnAlt,
    createSim, tickSim, robotClass, coach, runHeadless, starterRules, defaultPID,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.RoketCore = API;
})();
