/*
 * RoboForge - Güneş Takipçisi Simülasyon Çekirdeği
 * Pure, dependency-free. Browser (window.SolarCore) + Node (module.exports).
 *
 * 1 eksenli güneş paneli takipçisi. Dersler: (1) kosinüs kaybı - panel güneşe
 * dik değilse verim düşer, (2) MOTOR DA ENERJİ YER: sürekli titreyen takipçi
 * kazandığından çok harcar (ölü bant dersi!), (3) bulutta ışık DAĞINIKTIR -
 * takip etmek israftır, bekle, (4) gece motoru kapat, sabaha park et.
 */
(function () {
  'use strict';

  const DAY = 45;                 // sim günü (sn)
  const PANEL_MAX = 3.2;          // tam dik güneşte üretim (birim/sn)
  const MOTOR_COST = 0.55;         // motor çalışırken gider (birim/sn)
  const IDLE_COST = 0.06;

  // clouds: [başlangıç_t, bitiş_t] pencereleri (ışık %15 ve DAĞINIK)
  const MISSIONS = [
    { id: 'acikgun', name: 'Açık Gün', difficulty: 'Başlangıç', clouds: [], noise: 0,
      arc: 75, target: 93, dur: DAY,
      desc: 'Bulutsuz gökyüzü: güneşi takip et, kosinüs kaybını yaşa. Sabit panel bile enerji toplar - takipçi ne kadar fazlasını toplar?' },
    { id: 'parcali', name: 'Parçalı Bulut', difficulty: 'Başlangıç', clouds: [[14, 19], [28, 32]], noise: 0,
      arc: 75, target: 69, dur: DAY,
      desc: 'İki bulut penceresi. Bulutta ışık dağınıktır - takip KAZANDIRMAZ, motor gideri kaybettirir. Beklemeyi öğren.' },
    { id: 'kiskisa', name: 'Kısa Kış Günü', difficulty: 'Orta', clouds: [[20, 24]], noise: 0,
      arc: 50, target: 70, dur: DAY * 0.8,
      desc: 'Güneş alçak yaydan geçer, gün kısa. Her dakika değerli - sabah panelini DOĞUYA park etmiş olan kazanır.' },
    { id: 'firtinali', name: 'Fırtınalı Gök', difficulty: 'Orta', clouds: [[8, 13], [17, 21], [30, 36]], noise: 0.05,
      arc: 70, target: 57, dur: DAY,
      desc: 'Üç bulut + hafif sensör gürültüsü. Ölü bandın dar ise gürültü motoru titretir - gider kazancı yer.' },
    { id: 'ruzgarli', name: 'Rüzgârlı Gün', difficulty: 'İleri', clouds: [[22, 26]], noise: 0.16,
      arc: 75, target: 82, dur: DAY,
      desc: 'Rüzgâr paneli sarsar: sensörler zıplıyor. Geniş ölü bant + sabırlı takip - yoksa motor bütün hasadı yer.' },
    { id: 'cifttepe', name: 'Vadi Gölgesi', difficulty: 'İleri', clouds: [[0, 6], [39, 45]], noise: 0.06,
      arc: 75, target: 86, dur: DAY,
      desc: 'Sabah ve akşam vadi gölgede: gün ortası her şeydir. Gölgede motor kapalı, güneş çıkınca hızlı yakala.' },
    { id: 'kabusgun', name: 'Kâbus Günü', difficulty: 'Uzman', clouds: [[6, 10], [16, 22], [31, 35]], noise: 0.14,
      arc: 60, target: 63, dur: DAY,
      desc: 'Alçak yay + üç bulut + sert gürültü + sıkı hedef. Enerji muhasebesinin ustalık sınavı.' },
  ];

  function sunAt(m, t) {
    const f = t / m.dur;
    const ang = -m.arc + 2 * m.arc * f;                       // -arc → +arc (derece)
    let inten = Math.min(1, Math.max(0, Math.sin(Math.PI * f) * 1.7));   // platolu gün profili
    let cloudy = false;
    for (const [a, b] of m.clouds) { if (t >= a && t < b) { cloudy = true; inten *= 0.15; } }
    return { ang, inten, cloudy };
  }

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
      if (ruleMatches(rules[i].pattern, bits)) return { cmd: rules[i].cmd, ruleIndex: i };
    }
    return { cmd: 0, ruleIndex: -1 };
  }

  function createSim(cfg) {
    const m = cfg.mission;
    return {
      cfg, mission: m, t: 0, status: 'running', reason: null,
      panel: 0, cmd: 0,
      energy: 0, motorSpent: 0, gathered: 0,
      seed: m.id.length * 3.7,
      log: [], events: [], lastEvt: {}, ruleIndex: -1, totalTicks: 0, moveTime: 0,
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
    if (sim.status !== 'running') return;
    const m = sim.mission;
    const p = sim.cfg.params || defaultParams();
    const mode = sim.cfg.mode || 'rules';
    const sun = sunAt(m, sim.t);

    // LDR farkı: güneş - panel açısı (+ gürültü; bulutta fark ≈ 0: dağınık ışık!)
    const nz = m.noise * 40 * (Math.sin(sim.t * 11.3 + sim.seed) * 0.6 + Math.sin(sim.t * 23.7) * 0.4);
    const ghost = 26 * Math.sin(sim.t * 0.8 + sim.seed);   // bulutta dağınık parlak nokta gezinir
    const rawDiff = sun.cloudy ? (ghost - sim.panel * 0.4 + nz) : (sun.ang - sim.panel) + nz;
    const dark = sun.inten < 0.06;

    if (mode === 'rules') {
      const bits = [
        rawDiff > 22,                 // 0 GÜNEŞ ÇOK SOLDA... (işaret: + = güneş ileride/sağda; adlandırma UI'da)
        rawDiff > 7,                  // 1 GÜNEŞ İLERİDE
        Math.abs(rawDiff) <= 7,       // 2 HİZALI
        rawDiff < -7,                 // 3 GÜNEŞ GERİDE
        sun.cloudy,                   // 4 BULUTLU
        dark,                         // 5 KARANLIK
        Math.abs(nz) > 8,             // 6 SENSÖR GÜRÜLTÜLÜ (sarsıntı)
      ];
      const r = evalRules(sim.cfg.rules || [], bits);
      sim.cmd = r.cmd; sim.ruleIndex = r.ruleIndex;
    } else {
      const pid = sim.cfg.pid || defaultPID();
      sim.cmd = Math.abs(rawDiff) < (pid.oluBant || 6) ? 0 : Math.max(-1, Math.min(1, rawDiff * (pid.kp || 0.06)));
      if (sun.cloudy || dark) sim.cmd = 0;    // firmware: dağınık ışıkta bekle
    }

    // motor
    const w = 14 * (p.motor || 1);            // derece/sn
    if (sim.cmd !== 0) {
      sim.panel += Math.max(-w * dt, Math.min(w * dt, sim.cmd * w * dt));
      sim.panel = Math.max(-85, Math.min(85, sim.panel));
      sim.motorSpent += MOTOR_COST * Math.abs(sim.cmd) * dt;
      sim.energy -= MOTOR_COST * Math.abs(sim.cmd) * dt;
      sim.moveTime += dt;
    }
    sim.energy -= IDLE_COST * dt;

    // üretim: kosinüs yasası (bulutta dağınık ışık açıdan bağımsız %60 verir)
    const misalign = Math.abs(sun.ang - sim.panel) * Math.PI / 180;
    const eff = sun.cloudy ? 0.6 : Math.pow(Math.max(0, Math.cos(misalign)), 1.6);
    const gain = PANEL_MAX * sun.inten * eff * (p.panel || 1) * dt;
    sim.energy += gain; sim.gathered += gain;

    if (sun.cloudy) pushEvt(sim, 'cl' + Math.floor(sim.t / 5), '☁️ Bulut geçiyor - ışık dağınık, takip kazandırmaz'); 

    sim.totalTicks++;
    if (sim.totalTicks % 5 === 0) {
      sim.log.push([sim.t, sun.ang, sim.panel, sim.energy, sun.inten]);
      if (sim.log.length > 3000) sim.log.shift();
    }
    sim.t += dt;
    if (sim.t >= m.dur) {
      if (sim.energy >= m.target) { sim.status = 'success'; sim.reason = 'hasat'; }
      else { sim.status = 'failed'; sim.reason = 'hedef_alti'; }
    }
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const marj = sim.energy / sim.mission.target;
    const verim = sim.motorSpent / Math.max(1, sim.gathered);
    if (marj > 1.25 && verim < 0.10) return { name: '🏆 Hasat Ustası', cmt: 'Panel güneşe yapışık, motor fısıltıyla çalıştı. Şebekeye satacak kadar enerji!' };
    if (marj > 1.05) return { name: '🥈 Enerji Teknisyeni', cmt: 'Hedef tamam. Motor gideri hasadın %' + Math.round(verim * 100) + 'ı - ölü bandı ayarla, israfı kıs.' };
    return { name: '🥉 Panel Bekçisi', cmt: 'Ucu ucuna. Grafikte panelin güneşi nerede kaçırdığına bak.' };
  }
  function coach(sim) {
    const tips = [];
    const verim = sim.motorSpent / Math.max(1, sim.gathered);
    if (sim.status === 'failed') {
      if (verim > 0.22) tips.push('Motor, hasadın %' + Math.round(verim * 100) + 'ını yedi! Sürekli titreyen takipçi kazandığından çok harcar. Ölü bandı genişlet ya da HİZALI bandında motoru DURDUR.');
      else if (sim.moveTime < sim.mission.dur * 0.05) tips.push('Panel neredeyse hiç dönmemiş - güneş yayı boyunca kosinüs kaybına teslim oldun. GÜNEŞ İLERİDE bitinde motoru döndür.');
      else tips.push('Enerji ' + sim.energy.toFixed(0) + ' / hedef ' + sim.mission.target + '. Grafiği incele: panel çizgisi güneş çizgisini ne kadar geriden izliyor?');
    }
    if (!tips.length && sim.mission.clouds.length) tips.push('Bulutta ışık DAĞINIKTIR: açı fark etmez, %60 sabit verim. O pencerede motor çalıştırmak katıksız israf - beklemeyi bilen kazanır.');
    if (!tips.length) tips.push('Kosinüs yasası: 25° sapma %10 kayıp, 45° sapma %30 kayıp. Küçük sapmaları kovalamak motor gideriyle başabaş - ölü bant tam bu dengedir.');
    return tips;
  }

  function runHeadless(cfg, maxTime, dt) {
    const sim = createSim(cfg);
    const step = dt || 1 / 60, mt = maxTime || (cfg.mission.dur + 1);
    while (sim.status === 'running' && sim.t < mt) tickSim(sim, step);
    return { status: sim.status, reason: sim.reason, energy: +sim.energy.toFixed(1),
      target: sim.mission.target, motor: +sim.motorSpent.toFixed(1) };
  }

  function starterRules() {
    return [
      // [ÇOK İLERİDE, İLERİDE, HİZALI, GERİDE, BULUTLU, KARANLIK, SARSINTI]
      { pattern: ['any', 'any', 'any', 'any', 'any', 'on', 'any'], cmd: 0 },    // karanlık → dur
      { pattern: ['any', 'any', 'any', 'any', 'on', 'any', 'any'], cmd: 0 },    // bulut → bekle (israf etme!)
      { pattern: ['any', 'any', 'on', 'any', 'any', 'any', 'any'], cmd: 0 },    // hizalı → dur
      { pattern: ['on', 'any', 'any', 'any', 'any', 'any', 'any'], cmd: 1 },    // çok ileride → tam hız
      { pattern: ['any', 'on', 'any', 'any', 'any', 'any', 'any'], cmd: 0.5 },  // ileride → yarım hız
      { pattern: ['any', 'any', 'any', 'on', 'any', 'any', 'any'], cmd: -0.5 }, // geride → geri dön
    ];
  }
  function defaultPID() { return { kp: 0.06, oluBant: 6 }; }
  function defaultParams() { return { motor: 1.0, panel: 1.0 }; }

  const API = {
    DAY, PANEL_MAX, MOTOR_COST, MISSIONS, sunAt, ruleMatches, evalRules,
    createSim, tickSim, robotClass, coach, runHeadless, starterRules, defaultPID, defaultParams,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.SolarCore = API;
})();
