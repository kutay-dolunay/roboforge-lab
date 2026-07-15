/*
 * RoboForge - Akıllı Sera (Telemetri Kiti) Simülasyon Çekirdeği
 * Pure, dependency-free. Browser (window.SeraCore) + Node (module.exports).
 *
 * Fiction: ESP32'li mini sera → öğrencinin telefonuna Wi-Fi telemetri.
 * Sensörler: sıcaklık/nem (DHT), toprak nemi, ışık (LDR), su deposu (ultrasonik), IMU (fırtına sarsıntısı).
 * Aktüatörler: havalandırma kapağı (servo), fan, sulama pompası, bitki LED'i.
 * Dersler: (1) cihaz-üstü kurallar > telefondan kumanda (Wi-Fi kopar!),
 *          (2) örnekleme hızı ↔ batarya ödünleşimi (bayat veri geç tepki demek),
 *          (3) sera etkisi: kapalı kapak + güneş = fırın.
 */
(function () {
  'use strict';

  const DAY = 48;              // 1 sera günü = 48 sn simülasyon
  const KC = 0.55;             // ısı bağlaşım katsayısı (vent ile çarpılır)
  const SUN_HEAT = 0.5;        // güneşin iç ısıtması (kapak kapalıyken tam)
  const LED_HEAT = 0.25;       // LED'in minik ısı katkısı
  const T_MIN = 15, T_MAX = 29;    // bitki konfor bandı (°C)
  const S_MIN = 33, S_MAX = 78;    // toprak nemi konfor bandı (%)
  const L_NEED = 0.28;         // gündüz ışık ihtiyacı

  // ---- seviyeler ----------------------------------------------------------
  const LEVELS = [
    { id: 'ilkgun', name: 'İlk Gün', difficulty: 'Başlangıç', days: 1,
      base: 19, swing: 7, outH: 45, evap: 1.0, sunMul: 1.0, tank: 100, batt: 100, startS: 40,
      drops: [], winds: [], stuck: null, minHealth: 45, minGrowth: 55,
      desc: 'Tanışma günü: ılık hava, bol güneş. Kapak ve fanla sıcaklığı bantta tut.' },
    { id: 'kurak', name: 'Kurak Hafta', difficulty: 'Başlangıç', days: 1,
      base: 22, swing: 8, outH: 22, evap: 1.8, sunMul: 1.05, tank: 55, batt: 100, startS: 40,
      drops: [], winds: [], stuck: null, minHealth: 45, minGrowth: 32,
      desc: 'Toprak hızla kuruyor, depo yarım. Pompayı akıllı kullan - su israfı = kuruyan bitki.' },
    { id: 'sicak', name: 'Sıcak Dalga', difficulty: 'Orta', days: 1,
      base: 26, swing: 10, outH: 30, evap: 1.5, sunMul: 1.3, tank: 80, batt: 100,
      drops: [], winds: [], stuck: null, minHealth: 45, minGrowth: 32,
      desc: 'Öğlen dışarısı 36°. Kapalı sera fırına döner - sera etkisini yönet.' },
    { id: 'don', name: 'Don Gecesi', difficulty: 'Orta', days: 1,
      base: 13, swing: 12, outH: 50, evap: 0.7, sunMul: 1.25, tank: 100, batt: 100,
      drops: [], winds: [], stuck: null, minHealth: 55, minGrowth: 26,
      desc: 'Gece dışarısı 3°C! Kapağı açık unutan bitkiyi dondurur. Yalıtım + LED ısısı hayat kurtarır.' },
    { id: 'firtina', name: 'Fırtına', difficulty: 'İleri', days: 1,
      base: 21, swing: 8, outH: 88, evap: 0.9, sunMul: 1.0, tank: 90, batt: 100,
      drops: [[27, 5], [39, 4]], winds: [[26, 7, 1.0], [38, 5, 1.0]], stuck: null, minHealth: 45, minGrowth: 24,
      desc: 'Rüzgâr sarsıyor (IMU!), Wi-Fi kesiliyor. Fırtınada kapak AÇIK kalırsa bitki hırpalanır.' },
    { id: 'sinyal', name: 'Sinyal Kâbusu', difficulty: 'İleri', days: 1,
      base: 24, swing: 9, outH: 35, evap: 1.4, sunMul: 1.15, tank: 75, batt: 95,
      drops: [[8, 10], [24, 12], [40, 8]], winds: [], stuck: [30, 8], minHealth: 45, minGrowth: 28,
      desc: 'Günün yarısında bağlantı yok + sıcaklık sensörü bir ara donuyor. Telefon kumandası seni KURTARAMAZ - cihaz üstü kurallar kurtarır.' },
    { id: 'kabus', name: 'Kâbus Serası', difficulty: 'Uzman', days: 2,
      base: 19, swing: 13, outH: 30, evap: 1.6, sunMul: 1.2, tank: 60, batt: 85, startS: 46,
      drops: [[14, 8], [43, 9], [68, 10], [88, 6]], winds: [[52, 8, 1.0]], stuck: [70, 7],
      minHealth: 45, minGrowth: 55,
      desc: 'İki tam gün: 32° öğlen, 8° gece, fırtına, kesintiler, kısıtlı depo ve batarya. Tam otomasyon sınavı.' },
  ];

  // ---- çevre ---------------------------------------------------------------
  function envAt(level, t) {
    const dayT = t % DAY, f = dayT / DAY;
    // güneş: f 0.05–0.60 arası (gün), tepe 0.325'te
    let sun = Math.max(0, Math.sin(Math.PI * (f - 0.05) / 0.55));
    sun *= level.sunMul;
    const outT = level.base + level.swing * Math.sin(Math.PI * (f - 0.08) / 0.55 - 0) * (f < 0.63 ? 1 : 0)
      - (f >= 0.63 ? level.swing * 0.55 * Math.sin(Math.PI * (f - 0.63) / 0.37) : 0);
    let wind = 0, rain = 0;
    for (const [t0, dur, str] of level.winds) {
      if (t >= t0 && t < t0 + dur) { wind = str; rain = 1; sun *= 0.25; }
    }
    let linkUp = true;
    for (const [t0, dur] of level.drops) { if (t >= t0 && t < t0 + dur) linkUp = false; }
    const outH = rain ? 92 : level.outH;
    return { sun, outT, outH, wind, rain, linkUp, isDay: sun > 0.05 };
  }

  // ---- kural değerlendirme (ev deseni: on/off/any × 7 bit) -----------------
  function ruleMatches(pattern, bits) {
    for (let i = 0; i < bits.length; i++) {
      const p = pattern[i] || 'any';
      if (p === 'on' && !bits[i]) return false;
      if (p === 'off' && bits[i]) return false;
    }
    return true;
  }

  const DEVICES = ['kapak', 'fan', 'pompa', 'led'];

  function evalRules(rules, bits, act) {
    // yukarıdan aşağı; her cihaz için İLK eşleşen kural kazanır; eşleşmeyen cihaz MEVCUT halini korur (latch)
    const set = {};
    let fired = -1;
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (set[r.device] !== undefined) continue;
      if (ruleMatches(r.pattern, bits)) { set[r.device] = r.state ? 1 : 0; if (fired < 0) fired = i; }
    }
    for (const d of DEVICES) if (set[d] !== undefined) act[d] = set[d];
    return fired;
  }

  // ---- sim ------------------------------------------------------------------
  function createSim(cfg) {
    const level = cfg.level;
    const p = cfg.params || defaultParams();
    return {
      cfg, level, t: 0, status: 'running', reason: null,
      T: 21, H: 50, S: (level.startS || 52), L: 0,
      tank: level.tank, batt: level.batt * (p.battMul || 1), battMax: level.batt * (p.battMul || 1),
      health: 100, growth: 0, stressNote: null,
      act: { kapak: 0, fan: 0, pompa: 0, led: 0 },
      kapakPos: 0,                          // görsel/termal gerçek açıklık (0..1, süzülür)
      sensed: { T: 21, H: 50, S: 62, L: 0, tank: level.tank, shake: 0 },
      lastSample: -99, stuckUntil: -1,
      link: true, battOut: false,
      iErr: 0, ruleIndex: -1,
      manual: {},                            // UI: manuel komut kilitleri {device: expireT}
      log: [], events: [], lastEvt: {},
      totalTicks: 0, dayCount: level.days,
    };
  }

  function pushEvt(sim, key, msg) {
    if (sim.lastEvt[key]) return;
    sim.lastEvt[key] = true;
    sim.events.push([+sim.t.toFixed(1), msg]);
    if (sim.events.length > 40) sim.events.shift();
  }
  function clearEvt(sim, key) { sim.lastEvt[key] = false; }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return sim.lastOut;
    const level = sim.level, p = sim.cfg.params || defaultParams();
    const env = envAt(level, sim.t);
    const pw = p.pw || 1;

    // ---- bağlantı ----
    sim.link = env.linkUp && !sim.battOut;
    if (!env.linkUp) pushEvt(sim, 'drop', '📵 Wi-Fi koptu'); else clearEvt(sim, 'drop');

    // ---- örnekleme (sensörler sampleHz ile tazelenir; bayat veri = geç tepki) ----
    const hz = Math.max(0.4, sim.cfg.sampleHz || 2);
    const stuck = level.stuck && sim.t >= level.stuck[0] && sim.t < level.stuck[0] + level.stuck[1];
    if (stuck) pushEvt(sim, 'stuck', '🥶 Sıcaklık sensörü takıldı (donuk veri!)'); else clearEvt(sim, 'stuck');
    if (sim.t - sim.lastSample >= 1 / hz && !sim.battOut) {
      sim.lastSample = sim.t;
      if (!stuck) sim.sensed.T = sim.T;
      sim.sensed.H = sim.H; sim.sensed.S = sim.S; sim.sensed.L = sim.L;
      sim.sensed.tank = sim.tank; sim.sensed.shake = env.wind;
    }

    // ---- kontrol ----
    const sn = sim.sensed;
    const bits = [sn.T > 30, sn.T > 27, sn.T < 16, sn.S < 38, sn.S > 72, sn.L < 0.25, sn.shake > 0.5];
    if (sim.battOut) {
      sim.act.kapak = 0; sim.act.fan = 0; sim.act.pompa = 0; sim.act.led = 0;   // cihaz öldü
    } else if ((sim.cfg.mode || 'rules') === 'rules') {
      sim.ruleIndex = evalRules(sim.cfg.rules || [], bits, sim.act);
    } else {
      // 📈 Termostat: kapak açıklığı sürekli (PID) + yerleşik sulama/gece/fırtına firmware'i
      const pid = sim.cfg.pid || defaultPID();
      const err = sn.T - (pid.hedefT || 24);
      sim.iErr = Math.max(-6, Math.min(6, sim.iErr + err * dt * (err > 0 ? 1 : 0.6)));
      let u = (pid.kp || 0) * err + (pid.ki || 0) * sim.iErr;
      sim.act.kapak = Math.max(0, Math.min(1, u));
      sim.act.fan = u > 1.25 ? 1 : (u < 0.9 ? 0 : sim.act.fan);
      const hS = pid.hedefS || 52;
      if (sn.S < hS - 9) sim.act.pompa = 1; else if (sn.S > hS + 9) sim.act.pompa = 0;
      sim.act.led = sn.L < 0.25 ? 1 : 0;
      if (sn.shake > 0.5) { sim.act.kapak = 0; sim.act.fan = 0; }   // güvenlik firmware'i
    }
    // manuel kilitler (UI komutları kuralı ezher - kısa süreli)
    for (const d of DEVICES) {
      if (sim.manual[d] !== undefined) {
        if (sim.t < sim.manual[d].until) sim.act[d] = sim.manual[d].state;
        else delete sim.manual[d];
      }
    }

    // ---- fizik ----
    const target = (sim.cfg.mode || 'rules') === 'rules' ? sim.act.kapak : sim.act.kapak;
    sim.kapakPos += Math.max(-dt / 1.2, Math.min(dt / 1.2, target - sim.kapakPos));   // servo süzülür
    const kp = sim.kapakPos;
    const vent = 0.10 + 0.9 * kp + 1.4 * sim.act.fan * pw;
    const dT = KC * vent * (env.outT - sim.T)
      + env.sun * SUN_HEAT * (1 - 0.55 * kp - 0.25 * sim.act.fan)
      + sim.act.led * LED_HEAT;
    sim.T += dT * dt;
    sim.H += (0.10 * vent * (env.outH - sim.H) + sim.act.pompa * 6 - sim.act.fan * 3) * dt;
    sim.H = Math.max(5, Math.min(100, sim.H));
    const evap = (0.50 + Math.max(0, sim.T - 24) * 0.06) * level.evap;
    let pump = 0;
    if (sim.act.pompa && sim.tank > 0) { pump = 5.5 * pw; sim.tank = Math.max(0, sim.tank - 1.8 * dt); }
    if (sim.act.pompa && sim.tank <= 0) pushEvt(sim, 'depo', '🪣 Su deposu BOŞ - pompa kuru çalışıyor');
    sim.S = Math.max(0, Math.min(100, sim.S + (pump - evap) * dt));
    sim.L = env.sun * 0.85 + sim.act.led * 0.45;

    // ---- batarya (güneş paneli + tüketim) ----
    if (!sim.battOut) {
      const drain = 0.14 + 0.14 * hz + sim.act.fan * 0.7 + (sim.act.pompa && sim.tank > 0 ? 0.8 : 0.2 * sim.act.pompa) + sim.act.led * 0.5;
      sim.batt = Math.min(sim.battMax, sim.batt - drain * dt + env.sun * 0.45 * dt);
      if (sim.batt <= 0) { sim.batt = 0; sim.battOut = true; pushEvt(sim, 'batt', '🪫 Batarya bitti - sera KÖR ve SAĞIR'); }
    }

    // ---- bitki ----
    let stress = 0; sim.stressNote = null;
    if (sim.T < T_MIN) { stress += (T_MIN - sim.T) * 0.55; sim.stressNote = 'soguk'; }
    if (sim.T > T_MAX) { stress += (sim.T - T_MAX) * 0.42; sim.stressNote = 'sicak'; }
    if (sim.S < S_MIN) { stress += (S_MIN - sim.S) * 0.09; if (!sim.stressNote) sim.stressNote = 'kuru'; }
    if (sim.S > 94) { stress += (sim.S - 94) * 0.55; sim.stressNote = 'sel'; }
    if (env.wind > 0.5 && kp > 0.35) { stress += 6.0; sim.stressNote = 'firtina'; pushEvt(sim, 'wstress', '🌪️ Fırtına açık kapaktan giriyor - bitki hırpalanıyor!'); }
    sim.health = Math.max(0, Math.min(100, sim.health - stress * dt + (stress === 0 ? 0.35 * dt : 0)));
    const comfy = sim.T >= T_MIN && sim.T <= T_MAX && sim.S >= S_MIN && sim.S <= S_MAX && sim.L >= L_NEED;
    if (comfy && env.isDay) sim.growth = Math.min(100, sim.growth + dt * (100 / (level.days * DAY * 0.42)));

    // ---- kayıt ----
    sim.totalTicks++;
    if (sim.totalTicks % 6 === 0) {
      sim.log.push([sim.t, sim.sensed.T, sim.sensed.S, sim.L, sim.batt / sim.battMax * 100, sim.link ? 1 : 0, sim.health]);
      if (sim.log.length > 2400) sim.log.shift();
    }

    sim.t += dt;
    // ---- bitiş ----
    if (sim.health <= 20) { sim.status = 'failed'; sim.reason = 'bitki_' + (sim.stressNote || 'stres'); }
    else if (sim.t >= level.days * DAY) {
      if (sim.health >= level.minHealth && sim.growth >= level.minGrowth) { sim.status = 'success'; sim.reason = 'hasat'; }
      else if (sim.growth < level.minGrowth) { sim.status = 'failed'; sim.reason = 'buyume'; }
      else { sim.status = 'failed'; sim.reason = 'sagliksiz'; }
    }
    sim.lastOut = { env, bits };
    return sim.lastOut;
  }

  // UI: telefon komutu - sadece bağlantı varken! Kural motoru 6 sn sonra devralır.
  function sendCommand(sim, device, state) {
    if (!sim.link) return { ok: false, msg: 'SİNYAL YOK - komut ulaşmadı!' };
    if (sim.battOut) return { ok: false, msg: 'Cihaz kapalı (batarya).' };
    sim.manual[device] = { state: state ? 1 : 0, until: sim.t + 6 };
    sim.events.push([+sim.t.toFixed(1), '📱 Manuel: ' + device.toUpperCase() + (state ? ' AÇ' : ' KAPAT')]);
    return { ok: true };
  }

  // ---- değerlendirme --------------------------------------------------------
  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const g = sim.growth, h = sim.health, b = sim.batt / sim.battMax * 100;
    const score = g * 0.5 + h * 0.3 + b * 0.2;
    if (score > 72 && h > 70) return { name: '🏆 Usta Bahçıvan', cmt: 'Bitki mutlu, batarya dolu, telemetri pürüzsüz - gerçek kiti hak ettin!' };
    if (score > 58) return { name: '🥈 Sera Teknisyeni', cmt: 'Sağlam otomasyon. Büyüme skorunu artırmak için konfor bandında daha uzun kal.' };
    return { name: '🥉 Çaylak Bahçıvan', cmt: 'Bitki hayatta ama zor günler geçirdi. Kuralların tepki eşiklerini gözden geçir.' };
  }

  function coach(sim) {
    const tips = [];
    const r = sim.reason || '';
    if (r === 'bitki_sicak') tips.push('Bitki SICAKTAN gitti. Sera etkisi: kapak kapalıyken güneş içeriyi dışarıdan 10° daha sıcak yapar. SICAK bitinde kapağı aç, ÇOK SICAK bitinde fanı ekle.');
    if (r === 'bitki_soguk') tips.push('Bitki DONDU. Gece dışarısı buz gibi - SOĞUK bitinde kapağı VE fanı kapat. LED minik bir ısıtıcıdır: karanlıkta açık tutmak geceyi atlatır.');
    if (r === 'bitki_kuru') tips.push('Toprak çöl oldu. TOPRAK KURU → POMPA AÇ kuralın var mı? Depo boşsa pompa kuru çalışır - depo seviyesini telemetriden izle.');
    if (r === 'bitki_sel') tips.push('Bitkiyi boğdun! Pompa latch kalır: TOPRAK ISLAK → POMPA KAPAT kuralı olmadan pompa sonsuza dek basar.');
    if (r === 'bitki_firtina') tips.push('Fırtına açık kapaktan girdi. IMU sarsıntıyı görür: FIRTINA → KAPAK KAPAT kuralını EN ÜSTE koy - öncelik yukarıdan aşağı!');
    if (r === 'buyume') tips.push('Bitki hayatta ama yeterince BÜYÜMEDİ. Büyüme sadece konfor bandında (sıcaklık+toprak+ışık) işler. Bandın kıyısında gezinmek yerine ortasında tut.');
    if (r === 'sagliksiz') tips.push('Gün bitti ama bitki yorgun. Stres anlarını rapordaki sağlık çizgisinden bul - hangi saatte ne ters gitti?');
    if (sim.battOut) tips.push('Batarya öldü ve sera kör kaldı. Örnekleme hızını düşür (her ölçüm enerji!), fanı gereksiz çalıştırma, LED’i gündüz kapat. Güneş paneli gündüz şarj eder - geceyi planla.');
    if (sim.level.drops.length && !tips.length) tips.push('Wi-Fi koptuğunda telefon komutları ULAŞMAZ ama cihaz üstü kurallar çalışmaya devam eder. Gerçek IoT dersi: otomasyonu cihaza göm, telefona değil.');
    if (!tips.length) tips.push('Örnekleme hızıyla oyna: 0.5 Hz’te grafikler taşlaşır ve kurallar geç tepki verir; 10 Hz’te batarya erir. Tatlı nokta görevin temposuna bağlı.');
    return tips;
  }

  function runHeadless(cfg, maxTime, dt) {
    const sim = createSim(cfg);
    const step = dt || 1 / 60, mt = maxTime || (cfg.level.days * DAY + 2);
    while (sim.status === 'running' && sim.t < mt) tickSim(sim, step);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(1),
      health: Math.round(sim.health), growth: Math.round(sim.growth),
      batt: Math.round(sim.batt / sim.battMax * 100), tank: Math.round(sim.tank) };
  }

  // ---- başlangıç kodları ----------------------------------------------------
  function starterRules() {
    return [
      { pattern: ['any', 'any', 'any', 'any', 'any', 'any', 'on'],  device: 'kapak', state: 0 }, // FIRTINA → kapak kapat
      { pattern: ['on', 'any', 'any', 'any', 'any', 'any', 'off'],  device: 'fan',   state: 1 }, // ÇOK SICAK → fan aç
      { pattern: ['off', 'any', 'any', 'any', 'any', 'any', 'any'], device: 'fan',   state: 0 }, // değilse fan kapat
      { pattern: ['any', 'on', 'any', 'any', 'any', 'any', 'off'],  device: 'kapak', state: 1 }, // SICAK → kapak aç
      { pattern: ['any', 'any', 'on', 'any', 'any', 'any', 'any'],  device: 'kapak', state: 0 }, // SOĞUK → kapak kapat
      { pattern: ['any', 'any', 'any', 'on', 'any', 'any', 'any'],  device: 'pompa', state: 1 }, // TOPRAK KURU → pompa aç
      { pattern: ['any', 'any', 'any', 'any', 'on', 'any', 'any'],  device: 'pompa', state: 0 }, // TOPRAK ISLAK → pompa kapat
      { pattern: ['any', 'any', 'any', 'any', 'any', 'on', 'any'],  device: 'led',   state: 1 }, // KARANLIK → LED aç
      { pattern: ['any', 'any', 'any', 'any', 'any', 'off', 'any'], device: 'led',   state: 0 }, // aydınlıkta LED kapat
    ];
  }
  function defaultPID() { return { hedefT: 24, kp: 0.28, ki: 0.05, hedefS: 52 }; }
  function defaultParams() { return { battMul: 1.0, pw: 1.0 }; }

  const API = {
    DAY, LEVELS, T_MIN, T_MAX, S_MIN, S_MAX, L_NEED, DEVICES,
    envAt, ruleMatches, evalRules, createSim, tickSim, sendCommand,
    robotClass, coach, runHeadless, starterRules, defaultPID, defaultParams,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.SeraCore = API;
})();
