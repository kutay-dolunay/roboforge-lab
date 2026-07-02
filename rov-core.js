/*
 * RoboForge — Sualtı ROV Simülasyon Çekirdeği
 * Pure, dependency-free. Browser (window.RovCore) + Node (module.exports).
 *
 * Dersler: (1) KALDIRMA KUVVETİ: balast tankı su alınca batar, boşalınca yüzer —
 * itki değil DENGE ana silahtır, (2) bang-bang derinlik kontrolü salınır, PID oturur,
 * (3) akıntı katmanları yatayda sürükler, (4) tether (kablo) menzili aşılmaz,
 * (5) hızlı yüzeye çıkış YASAK (vurgun teması) — kontrollü çıkış planla,
 * (6) derinlik = karanlık = far = enerji.
 */
(function () {
  'use strict';

  const MAX_D = 12;              // havuz derinliği (m)
  const ASCENT_LIMIT = 0.9;      // sığ suda maks çıkış hızı (m/s)
  const ASCENT_ZONE = 4;         // bu derinlikten sığda limit uygulanır
  const TETHER_TOL = 0.3;

  // ---- görevler ----------------------------------------------------------------
  // wps: inceleme noktaları [{x, d}]; currents: [üstD, altD, akıntı] katmanları
  const MISSIONS = [
    { id: 'ilkdalis', name: 'İlk Dalış', difficulty: 'Başlangıç', dur: 75,
      wps: [{ x: 2, d: 5 }], currents: [[0, 12, 0]], tether: 14, energy: 100, dark: false, seabed: 11,
      desc: 'Tek nokta: 5 metreye in, 1.5 saniye sabit dur, kontrollü yüzeye dön. Balast doldukça batarsın — itki değil DENGE.' },
    { id: 'resif', name: 'Resif Turu', difficulty: 'Başlangıç', dur: 110,
      wps: [{ x: 1.5, d: 3.5 }, { x: 4, d: 6 }, { x: 6.5, d: 4 }], currents: [[0, 12, 0]], tether: 16, energy: 100, dark: false, seabed: 11,
      desc: 'Üç inceleme noktası, farklı derinlikler. Her derinlik değişimi bir balast kararı — pompayı boşa çalıştırma.' },
    { id: 'batik', name: 'Batık Gemi', difficulty: 'Orta', dur: 120,
      wps: [{ x: 5, d: 9 }, { x: 7, d: 10 }], currents: [[0, 12, 0.12]], tether: 14.5, energy: 100, dark: true, seabed: 11,
      desc: 'Derin batık: 10 metre, karanlık (far yanar, enerji akar) ve kablo sınırda. Rotanı kabloya göre planla.' },
    { id: 'kanyon', name: 'Akıntı Kanyonu', difficulty: 'Orta', dur: 120,
      wps: [{ x: 4, d: 4 }, { x: 6, d: 8 }], currents: [[0, 5, 0.45], [5, 12, -0.3]], tether: 16, energy: 100, dark: false, seabed: 11,
      desc: 'Üst katman sağa, alt katman SOLA akıyor. Derinliğin yatay rotanı değiştirir — katmanları oku.' },
    { id: 'karanlik', name: 'Karanlık Çukur', difficulty: 'İleri', dur: 130,
      wps: [{ x: 3, d: 10.5 }, { x: 5.5, d: 9.5 }, { x: 7, d: 10.5 }], currents: [[0, 12, 0.18]], tether: 17, energy: 80, dark: true, seabed: 11.5,
      desc: 'Üç derin nokta + kısıtlı batarya. Far dipte şart ve enerji yer — dipte oyalanma, işini bitir çık.' },
    { id: 'vurgun', name: 'Çıkış Protokolü', difficulty: 'İleri', dur: 130,
      wps: [{ x: 6, d: 10 }], currents: [[0, 6, 0.35], [6, 12, 0.1]], tether: 15, energy: 90, dark: true, seabed: 11,
      desc: 'Derine in, İKİ kademede çık: 4 metrede güvenlik molası ver (otomatik). Sığ suda hızlı çıkış = görev iptali. Balast boşaltıp roket gibi fırlamak yok!' },
    { id: 'kabusdip', name: 'Kâbus Derinliği', difficulty: 'Uzman', dur: 150,
      wps: [{ x: 3, d: 10.5 }, { x: 6.5, d: 9 }, { x: 8, d: 10.8 }], currents: [[0, 4, 0.5], [4, 8, -0.35], [8, 12, 0.15]],
      tether: 16.5, energy: 75, dark: true, seabed: 11.5,
      desc: 'Üç katman akıntı + üç derin nokta + dar enerji + kablo sınırı. Tam ROV pilotluğu sınavı.' },
  ];

  function currentAt(m, d) {
    for (const [top, bot, c] of m.currents) { if (d >= top && d < bot) return c; }
    return 0;
  }

  // ---- kural motoru --------------------------------------------------------------
  // bits: [YÜZEYE YAKIN, HEDEF ÜSTÜNDE(sığ), HEDEF BANDI, HEDEF ALTINDA(derin), ÇOK DERİN, İNİŞ HIZLI, ÇIKIŞ HIZLI]
  // rule: { pattern, device: 'balast'|'itici', act: -1|0|1 }  (balast: -1 boşalt/0 tut/1 doldur · itici: -1 yukarı/0 kapalı/1 aşağı)
  function ruleMatches(pattern, bits) {
    for (let i = 0; i < bits.length; i++) {
      const p = pattern[i] || 'any';
      if (p === 'on' && !bits[i]) return false;
      if (p === 'off' && bits[i]) return false;
    }
    return true;
  }
  function evalRules(rules, bits, out) {
    const set = {};
    let fired = -1;
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (set[r.device] !== undefined) continue;
      if (ruleMatches(r.pattern, bits)) { set[r.device] = r.act; if (fired < 0) fired = i; }
    }
    if (set.balast !== undefined) out.balast = set.balast;
    if (set.itici !== undefined) out.itici = set.itici;
    return fired;
  }

  function createSim(cfg) {
    const m = cfg.mission;
    return {
      cfg, mission: m, t: 0, status: 'running', reason: null,
      x: 0.5, d: 0.3, vx: 0, vd: 0,
      ballast: 0.35, cmd: { balast: 0, itici: 0 },
      wpIdx: 0, hold: 0, phase: 'gorev',        // gorev → cikis → molada → yuzey
      safetyStop: 0,
      energy: (m.energy) * ((cfg.params && cfg.params.battMul) || 1),
      energyMax: (m.energy) * ((cfg.params && cfg.params.battMul) || 1), battOut: false,
      sensedD: 0.3, lastSample: -9, iErr: 0, ruleIndex: -1,
      maxAscent: 0, tetherMax: 0,
      log: [], events: [], lastEvt: {}, trace: [], totalTicks: 0,
    };
  }
  function pushEvt(sim, key, msg) {
    if (sim.lastEvt[key]) return;
    sim.lastEvt[key] = true;
    sim.events.push([+sim.t.toFixed(1), msg]);
    if (sim.events.length > 50) sim.events.shift();
  }
  function clearEvt(sim, key) { sim.lastEvt[key] = false; }

  function targetOf(sim) {
    const m = sim.mission;
    if (sim.phase === 'gorev' && sim.wpIdx < m.wps.length) return m.wps[sim.wpIdx];
    if (sim.phase === 'cikis' || sim.phase === 'molada') {
      const homeX = Math.min(sim.x, 2.2);           // kabloyu sar — içeri süzül
      if (sim.safetyStop < 2 && sim.d > 1.2) return { x: homeX, d: 4 };
      return { x: homeX, d: 0.2 };
    }
    return { x: Math.min(sim.x, 2.2), d: 0.2 };
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return;
    const m = sim.mission;
    const p = sim.cfg.params || defaultParams();
    const mode = sim.cfg.mode || 'rules';
    const tg = targetOf(sim);

    // ---- derinlik sensörü (0.5 sn örnekleme, hafif gürültü) ----
    if (sim.t - sim.lastSample > 0.12) { sim.lastSample = sim.t;
      sim.sensedD = sim.d + Math.sin(sim.t * 9.7) * 0.05; }

    // ---- kontrol ----
    if (!sim.battOut) {
      const e = sim.sensedD - tg.d;                 // + = hedeften derin
      const bits = [
        sim.sensedD < 0.8,                          // 0 YÜZEYE YAKIN
        e < -0.55,                                  // 1 HEDEFTEN SIĞ
        Math.abs(e) <= 0.55,                        // 2 HEDEF BANDI
        e > 0.55,                                   // 3 HEDEFTEN DERİN
        sim.sensedD > m.seabed - 0.9,               // 4 DİBE YAKIN
        sim.vd > 0.5,                               // 5 İNİŞ HIZLI
        sim.vd < -0.55,                             // 6 ÇIKIŞ HIZLI
      ];
      if (mode === 'rules') {
        sim.ruleIndex = evalRules(sim.cfg.rules || [], bits, sim.cmd);
      } else {
        const pid = sim.cfg.pid || defaultPID();
        sim.iErr = Math.max(-3, Math.min(3, sim.iErr + e * dt));
        let u = (pid.kp || 0) * e + (pid.ki || 0) * sim.iErr + (pid.kd || 0) * sim.vd;
        // u>0: hedeften derin → yukarı itki; balast trim yavaş entegral
        sim.cmd.itici = Math.max(-1, Math.min(1, -u));
        sim.cmd.balast = e < -0.6 ? 1 : e > 0.6 ? -1 : (Math.abs(sim.iErr) > 1.5 ? Math.sign(-sim.iErr) : 0);
        // çıkış valisi (firmware): sığ suda yükselişi frenle
        if (sim.d < ASCENT_ZONE + 1.5 && sim.vd < -0.55) { sim.cmd.itici = 1; if (sim.vd < -0.7) sim.cmd.balast = 1; }
      }
    } else { sim.cmd.balast = 0; sim.cmd.itici = 0; }

    // ---- balast pompası (yavaş!) ----
    sim.ballast = Math.max(0, Math.min(1, sim.ballast + sim.cmd.balast * 0.11 * dt * (p.pump || 1)));

    // ---- dikey fizik: kaldırma kuvveti dengesi ----
    // net batma ivmesi: (ballast-0.5)*3.2  (0.5 = nötr) + itici katkısı + sürükleme
    const buoy = (sim.ballast - 0.5) * 2.3;
    const thr = sim.cmd.itici * 1.6 * (p.thrust || 1);
    sim.vd += (buoy + thr - sim.vd * Math.abs(sim.vd) * 0.9 - sim.vd * 0.4) * dt;
    sim.d += sim.vd * dt;
    if (sim.d < 0) { sim.d = 0; sim.vd = Math.max(0, sim.vd); }
    sim.maxAscent = Math.max(sim.maxAscent, sim.d < ASCENT_ZONE ? -sim.vd : 0);

    // ---- yatay: otomatik sürüş + akıntı ----
    const cur = currentAt(m, sim.d);
    const dx = tg.x - sim.x;
    const vxDes = Math.max(-0.75, Math.min(0.75, dx * 1.2)) * (p.thrust || 1);
    sim.vx += ((vxDes + cur) - sim.vx) * Math.min(1, 2.2 * dt);
    sim.x += sim.vx * dt;
    if (sim.x < 0) { sim.x = 0; sim.vx = 0; }

    // ---- tether ----
    const tlen = Math.hypot(sim.x, sim.d);
    sim.tetherMax = Math.max(sim.tetherMax, tlen);
    if (tlen > m.tether + TETHER_TOL) {
      sim.status = 'failed'; sim.reason = 'tether';
      pushEvt(sim, 'tet', '🪢 KABLO GERİLDİ! ' + tlen.toFixed(1) + ' m > ' + m.tether + ' m — ROV asılı kaldı.');
      return;
    } else if (tlen > m.tether - 0.8) pushEvt(sim, 'tetw', '⚠️ Kablo sınıra yaklaşıyor: ' + tlen.toFixed(1) + '/' + m.tether + ' m');
    else clearEvt(sim, 'tetw');

    // ---- taban çarpması ----
    if (sim.d > m.seabed) {
      if (sim.vd > 0.7) { sim.status = 'failed'; sim.reason = 'carpma';
        pushEvt(sim, 'cr', '💥 Tabana çarptın! İniş hızı ' + sim.vd.toFixed(1) + ' m/s'); return; }
      sim.d = m.seabed; sim.vd = Math.min(0, sim.vd);
    }

    // ---- hızlı çıkış (vurgun protokolü) ----
    if (sim.d < ASCENT_ZONE && sim.d > 0.4 && -sim.vd > ASCENT_LIMIT) {
      sim.status = 'failed'; sim.reason = 'hizli_cikis';
      pushEvt(sim, 'asc', '🫧 HIZLI ÇIKIŞ! ' + (-sim.vd).toFixed(1) + ' m/s (limit ' + ASCENT_LIMIT + ') — kontrollü çıkış protokolü ihlali.');
      return;
    }

    // ---- enerji ----
    if (!sim.battOut) {
      const light = m.dark && sim.d > 5 ? 0.30 : 0;
      const drain = 0.10 + Math.abs(sim.cmd.itici) * 0.42 + Math.abs(sim.cmd.balast) * 0.30
        + Math.abs(vxDes) * 0.25 + light;
      sim.energy -= drain * dt;
      if (sim.energy <= 0) { sim.energy = 0; sim.battOut = true;
        pushEvt(sim, 'batt', '🪫 Enerji bitti — ROV kontrolsüz! Balast neredeyse orada kalır…'); }
    }

    // ---- görev akışı ----
    if (sim.phase === 'gorev' && sim.wpIdx < m.wps.length) {
      const wp = m.wps[sim.wpIdx];
      if (Math.abs(sim.d - wp.d) < 0.65 && Math.abs(sim.x - wp.x) < 0.6) {
        sim.hold += dt;
        if (sim.hold > 1.5) {
          pushEvt(sim, 'wp' + sim.wpIdx, '📸 Nokta ' + (sim.wpIdx + 1) + ' incelendi (' + wp.d + ' m)');
          sim.wpIdx++; sim.hold = 0;
          if (sim.wpIdx >= m.wps.length) { sim.phase = 'cikis';
            pushEvt(sim, 'up', '⬆️ Görev tamam — kontrollü yüzeye çıkış başladı'); }
        }
      } else sim.hold = 0;
    } else if (sim.phase === 'cikis') {
      if (Math.abs(sim.d - 4) < 0.85 && sim.safetyStop < 2) {
        sim.safetyStop += dt;
        if (sim.safetyStop >= 2) pushEvt(sim, 'stop', '🫧 Güvenlik molası tamam (4 m / 2 sn) — yüzeye devam');
      }
      if (sim.d < 0.45) {
        if (sim.safetyStop >= 2 || m.id !== 'vurgun') {
          sim.status = 'success'; sim.reason = 'tamam';
          pushEvt(sim, 'fin', '🎉 ROV güvenle yüzeyde!');
        } else { sim.status = 'failed'; sim.reason = 'molasiz';
          pushEvt(sim, 'nostop', '🫧 Güvenlik molası ATLANDI — protokol ihlali!'); }
      }
    }

    // ---- kayıt ----
    sim.totalTicks++;
    if (sim.totalTicks % 5 === 0) {
      sim.trace.push([sim.x, sim.d]);
      sim.log.push([sim.t, sim.d, sim.vd, sim.ballast, sim.energy / sim.energyMax * 100]);
      if (sim.trace.length > 3000) sim.trace.shift();
      if (sim.log.length > 3000) sim.log.shift();
    }
    sim.t += dt;
    if (sim.t > m.dur) { sim.status = 'failed'; sim.reason = 'sure'; }
    if (sim.battOut && sim.t > m.dur * 0.4 && sim.d > 1 && Math.abs(sim.vd) < 0.05) {
      sim.status = 'failed'; sim.reason = 'enerji';
    }
  }

  // ---- değerlendirme --------------------------------------------------------------
  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const en = sim.energy / sim.energyMax * 100;
    const tScore = Math.max(0, 100 - sim.t / sim.mission.dur * 85);
    const total = en * 0.4 + tScore * 0.6;
    if (total > 55) return { name: '🏆 Derin Deniz Pilotu', cmt: 'Akıcı dalış profili, tutumlu enerji, kusursuz çıkış protokolü. Batıklar seni bekler!' };
    if (total > 35) return { name: '🥈 ROV Operatörü', cmt: 'Görev tamam. Madalya için: balastı bir kez ayarla, pompayı boşuna çalıştırma.' };
    return { name: '🥉 Kursiyer Dalgıç', cmt: 'Yüzeye döndün ama profil dişli gibi tırtıklı. Derinlik grafiğine bak — salınımlar enerji yer.' };
  }
  function coach(sim) {
    const tips = [];
    const r = sim.reason || '';
    if (r === 'tether') tips.push('Kablo gerildi: √(x² + derinlik²) ≤ kablo boyu olmalı. Derine inerken yatayda geri çekil — rota bir üçgen problemi.');
    if (r === 'carpma') tips.push('Tabana çarptın. DİBE YAKIN biti tam bunun için: o bantta itici yukarı + balast boşalt. Balast yavaştır — freni erken yap.');
    if (r === 'hizli_cikis') tips.push('Sığ suda çıkış limiti 0.9 m/s! Balastı tamamen boşaltıp roket gibi fırlamak protokol ihlali. ÇIKIŞ HIZLI bitinde itici AŞAĞI ver — frenle.');
    if (r === 'molasiz') tips.push('4 metrede 2 saniyelik güvenlik molasını atladın. Çıkışta 4 m bandında dur, sonra devam et — otopilot molayı kendisi sayar, senin işin orada YAVAŞ geçmek.');
    if (r === 'enerji') tips.push('Enerji bitti, ROV suda asılı kaldı. En büyük gider salınımdır: bang-bang balast pompası sürekli çalışır. PID ile bir kez otur, bir kez çık.');
    if (r === 'sure') tips.push('Süre doldu. Derinlik salınımların turu uzatıyor — hedef bandına girip KALAMAYAN kontrol zaman yer. Kd (fren) terimini artır.');
    if (!tips.length && sim.maxAscent > 0.6) tips.push('Çıkışın ' + sim.maxAscent.toFixed(1) + ' m/s ile limitin dibindeydi — bir dahaki sefere balastı kademeli boşalt.');
    if (!tips.length) tips.push('Balast pompası yavaş, itici hızlıdır. Usta pilot dengeyi balastla kurar, iticiyi sadece ince ayar ve fren için kullanır.');
    return tips;
  }

  function runHeadless(cfg, maxTime, dt) {
    const sim = createSim(cfg);
    const step = dt || 1 / 60, mt = maxTime || (cfg.mission.dur + 3);
    while (sim.status === 'running' && sim.t < mt) tickSim(sim, step);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(1),
      energy: Math.round(sim.energy / sim.energyMax * 100), wps: sim.wpIdx,
      maxAscent: +sim.maxAscent.toFixed(2), tetherMax: +sim.tetherMax.toFixed(1) };
  }

  // ---- başlangıç kodları -------------------------------------------------------------
  function starterRules() {
    return [
      // [YÜZEYE YAKIN, SIĞ, BANT, DERİN, DİBE YAKIN, İNİŞ HIZLI, ÇIKIŞ HIZLI]
      { pattern: ['any', 'any', 'any', 'any', 'any', 'any', 'on'],  device: 'itici',  act: 1 },   // çıkış hızlı → aşağı fren
      { pattern: ['any', 'any', 'any', 'any', 'any', 'on', 'any'],  device: 'itici',  act: -1 },  // iniş hızlı → yukarı fren
      { pattern: ['any', 'any', 'any', 'any', 'on', 'any', 'any'],  device: 'balast', act: -1 },  // dibe yakın → boşalt
      { pattern: ['any', 'on', 'any', 'any', 'off', 'any', 'any'],  device: 'balast', act: 1 },   // hedeften sığ → doldur
      { pattern: ['any', 'any', 'any', 'on', 'any', 'any', 'any'],  device: 'balast', act: -1 },  // hedeften derin → boşalt
      { pattern: ['any', 'any', 'on', 'any', 'any', 'off', 'off'],  device: 'balast', act: 0 },   // bandta → tut
      { pattern: ['any', 'any', 'any', 'any', 'any', 'off', 'off'], device: 'itici',  act: 0 },   // hız sakinse → itici kapat (fren bırak!)
    ];
  }
  function defaultPID() { return { kp: 1.3, ki: 0.12, kd: 2.1 }; }
  function defaultParams() { return { thrust: 1.0, pump: 1.0, battMul: 1.0 }; }

  const API = {
    MAX_D, ASCENT_LIMIT, ASCENT_ZONE, MISSIONS, currentAt, ruleMatches, evalRules,
    createSim, tickSim, targetOf, robotClass, coach, runHeadless,
    starterRules, defaultPID, defaultParams,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.RovCore = API;
})();
