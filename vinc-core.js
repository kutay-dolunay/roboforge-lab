/*
 * RoboForge — Kule Vinci Simülasyon Çekirdeği
 * Pure, dependency-free. Browser (window.VincCore) + Node (module.exports).
 *
 * Liman vinci: ray üzerinde araba (trolley) + halatta yük = SARKAÇ.
 * Dersler: (1) hızlanma sarkacı tetikler — kademeli hız = az salınım,
 * (2) sallanan yüke kanca TAKAMAZSIN, sallanırken BIRAKIRSAN yük kayar/devrilir,
 * (3) anti-sway: sarkaç açısını geri besleyen otopilot salınımı aktif söndürür,
 * (4) uzun halat = yavaş sarkaç (T=2π√(L/g)) — istife inerken fizik değişir.
 */
(function () {
  'use strict';

  const G = 9.8;
  const RAIL_Y = 2.7;             // ray yüksekliği (m)
  const X_MIN = -2.3, X_MAX = 2.3;
  const L_MIN = 0.45, L_MAX = 2.35;
  const BOX = 0.30;               // konteyner kenarı
  const HOOK_R = 0.16;            // kanca yakalama yarıçapı
  const SWING_HOOK = 0.13;        // kanca takmak için maks |φ| (rad)
  const DAMP = 0.10;              // doğal sönüm

  // ---- görevler ----------------------------------------------------------------
  const MISSIONS = [
    { id: 'ilkyuk', name: 'İlk Yük', difficulty: 'Başlangıç', dur: 55, wind: 0,
      boxes: [{ x: 1.6, w: 1 }], zones: [{ x: -1.5, tol: 0.20 }], walls: [], stackGoal: null,
      desc: 'Tek konteyner: sağdan al, sola bırak. Hızlı gidersen yük sallanır — sallanan yük tutulmaz, bırakılmaz!' },
    { id: 'ikikonteyner', name: 'İki Konteyner', difficulty: 'Başlangıç', dur: 90, wind: 0,
      boxes: [{ x: 1.4, w: 1 }, { x: 1.9, w: 1 }], zones: [{ x: -1.2, tol: 0.18 }, { x: -1.8, tol: 0.18 }],
      walls: [], stackGoal: null,
      desc: 'İki yük, iki bölge. Salınımı söndürmeden ikinci yüke geçersen zaman kaybedersin — ritmi bul.' },
    { id: 'istif', name: 'Yüksek İstif', difficulty: 'Orta', dur: 90, wind: 0,
      boxes: [{ x: 1.5, w: 1 }, { x: 1.95, w: 1 }], zones: [{ x: -1.5, tol: 0.18 }],
      walls: [], stackGoal: 2,
      desc: 'İki konteyneri üst üste koy. Üsttekini bırakırken halat KISA — sarkaç hızlı! Nazik ve sabırlı ol.' },
    { id: 'darbosluk', name: 'Dar Boşluk', difficulty: 'Orta', dur: 90, wind: 0,
      boxes: [{ x: 1.7, w: 1 }], zones: [{ x: -1.35, tol: 0.14 }],
      walls: [{ x: -0.85, h: 1.15 }, { x: -1.85, h: 1.15 }], stackGoal: null,
      desc: 'Hedef iki duvarın ARASINDA. Sallanan yük duvara çarpar — boşluğun üstünde tam dur, söndür, dik indir.' },
    { id: 'ruzgarli', name: 'Rüzgârlı Liman', difficulty: 'İleri', dur: 95, wind: 0.55,
      boxes: [{ x: 1.6, w: 1 }, { x: 2.0, w: 1 }], zones: [{ x: -1.3, tol: 0.16 }, { x: -1.85, tol: 0.16 }],
      walls: [], stackGoal: null,
      desc: 'Rüzgâr yükü sürekli itiyor — salınım kendiliğinden sönmüyor. Aktif söndürme olmadan liman kilitlenir.' },
    { id: 'agiryuk', name: 'Ağır Yük', difficulty: 'İleri', dur: 95, wind: 0.25,
      boxes: [{ x: 1.75, w: 2.2 }], zones: [{ x: -1.55, tol: 0.15 }],
      walls: [{ x: 0.1, h: 0.85 }], stackGoal: null,
      desc: 'Dev konteyner: atalet büyük, salınım zor söner, alçak duvarın üstünden geçmeli. Usta işi.' },
    { id: 'kabusliman', name: 'Kâbus Limanı', difficulty: 'Uzman', dur: 130, wind: 0.6,
      boxes: [{ x: 1.45, w: 1 }, { x: 1.95, w: 1.8 }], zones: [{ x: -1.5, tol: 0.13 }],
      walls: [{ x: -0.6, h: 1.0 }], stackGoal: 2,
      desc: 'Rüzgâr + duvar + ağır yük + dar istif + süre. Gerçek liman vardiyası: her hata dakika yakar.' },
  ];

  // ---- program: ['GIT', x, hız%] | ['HALAT', L] | ['TAK'] | ['BIRAK'] | ['BEKLE', s] | ['SONDUR']
  function createSim(cfg) {
    const m = cfg.mission;
    return {
      cfg, mission: m, t: 0, status: 'running', reason: null,
      x: 0, v: 0, L: 0.9, Ltg: 0.9, xtg: 0, spd: 1,
      phi: 0, om: 0,
      hooked: -1, boxes: m.boxes.map(b => ({ x: b.x, y: BOX / 2, w: b.w, vx: 0, vy: 0, falling: false, toppled: false })),
      stepIdx: 0, stepT: 0, mode: cfg.mode || 'prog',
      iErr: 0, maxSwing: 0, swingAtRelease: [],
      events: [], lastEvt: {}, trace: [], totalTicks: 0,
    };
  }
  function pushEvt(sim, key, msg) {
    if (sim.lastEvt[key]) return;
    sim.lastEvt[key] = true;
    sim.events.push([+sim.t.toFixed(1), msg]);
    if (sim.events.length > 50) sim.events.shift();
  }
  function loadPos(sim) {
    return { x: sim.x + sim.L * Math.sin(sim.phi), y: RAIL_Y - sim.L * Math.cos(sim.phi) };
  }
  function currentStep(sim) {
    const P = sim.cfg.program || [];
    return sim.stepIdx < P.length ? P[sim.stepIdx] : null;
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return;
    const m = sim.mission;
    const p = sim.cfg.params || defaultParams();
    const mode = sim.cfg.mode || 'prog';
    let accel = 0;

    // ---- kontrol ----
    if (mode === 'prog') {
      const st = currentStep(sim);
      if (st) {
        sim.stepT += dt;
        const [op] = st;
        if (op === 'GIT') {
          sim.xtg = Math.max(X_MIN, Math.min(X_MAX, st[1]));
          sim.spd = Math.max(0.1, Math.min(1, (st[2] || 60) / 100));
          const err = sim.xtg - sim.x;
          const vMax = 1.5 * sim.spd;                                   // hız% mutlak — program her vinçte aynı davranır
          const vDes = Math.max(-vMax, Math.min(vMax, err * 3));
          const aCap = 4.5 * sim.spd * (p.motor || 1);                  // motor gücü = ivme otoritesi
          accel = Math.max(-aCap, Math.min(aCap, (vDes - sim.v) / Math.max(dt, 0.016)));
          if (Math.abs(err) < 0.015 && Math.abs(sim.v) < 0.05) { sim.stepIdx++; sim.stepT = 0; }
        } else if (op === 'HALAT') {
          sim.Ltg = Math.max(L_MIN, Math.min(L_MAX, st[1]));
          if (Math.abs(sim.L - sim.Ltg) < 0.02) { sim.stepIdx++; sim.stepT = 0; }
        } else if (op === 'TAK') {
          tryHook(sim);
          if (sim.hooked >= 0 || sim.stepT > 5) { sim.stepIdx++; sim.stepT = 0; }
        } else if (op === 'BIRAK') {
          release(sim);
          sim.stepIdx++; sim.stepT = 0;
        } else if (op === 'BEKLE') {
          if (sim.stepT >= (st[1] || 0.5)) { sim.stepIdx++; sim.stepT = 0; }
        } else if (op === 'SONDUR') {
          // aktif söndürme: konuma DEMİRLE + sarkaç geri beslemesi (mini anti-sway)
          const err = sim.x - sim.xtg;
          accel = -2.4 * err - 3.0 * sim.v + 6.0 * sim.phi + 3.2 * sim.om;
          accel = Math.max(-5, Math.min(5, accel));
          if (Math.abs(sim.phi) < 0.05 && Math.abs(sim.om) < 0.09 && Math.abs(err) < 0.03 && Math.abs(sim.v) < 0.06) { sim.stepIdx++; sim.stepT = 0; }
          if (sim.stepT > 9) { sim.stepIdx++; sim.stepT = 0; }
        } else sim.stepIdx++;
      }
    } else {
      // 📈 Anti-Sway Otopilot: hedef listesi programdaki GIT/HALAT/TAK/BIRAK aynı, ama GIT sürüşü PID+sway
      const st = currentStep(sim);
      const pid = sim.cfg.pid || defaultPID();
      // otopilot HER AN açık: YÜKÜ hedefe oturt (trim entegratörü rüzgâr ofsetini siler)
      {
        const lpx = sim.x + sim.L * Math.sin(sim.phi);
        sim.trim = Math.max(-0.7, Math.min(0.7, (sim.trim || 0) + 0.55 * (lpx - sim.xtg) * dt));
        const err = sim.x - (sim.xtg - sim.trim);
        accel = -(pid.kp || 0) * err - (pid.kd || 0) * sim.v
                + (pid.ks || 0) * sim.phi + (pid.kw || 0) * sim.om;
        accel = Math.max(-5, Math.min(5, accel)) * (p.motor || 1);
      }
      if (st) {
        sim.stepT += dt;
        const [op] = st;
        if (op === 'GIT') {
          const nt = Math.max(X_MIN, Math.min(X_MAX, st[1]));
          if (nt !== sim.xtg) { sim.xtg = nt; sim.trim = 0; }
          const lpx = sim.x + sim.L * Math.sin(sim.phi);
          if (Math.abs(lpx - sim.xtg) < 0.045 && Math.abs(sim.v) < 0.08 && Math.abs(sim.om) < 0.12) { sim.stepIdx++; sim.stepT = 0; }
          if (sim.stepT > 25) { sim.stepIdx++; sim.stepT = 0; }
        } else if (op === 'HALAT') {
          sim.Ltg = Math.max(L_MIN, Math.min(L_MAX, st[1]));
          if (Math.abs(sim.L - sim.Ltg) < 0.02) { sim.stepIdx++; sim.stepT = 0; }
        } else if (op === 'TAK') { tryHook(sim); if (sim.hooked >= 0 || sim.stepT > 5) { sim.stepIdx++; sim.stepT = 0; } }
        else if (op === 'BIRAK') {
          // otopilot bırakışı: yük hedef üstünde ve sakinken (6 sn'de pes eder)
          const lpx = sim.x + sim.L * Math.sin(sim.phi);
          if ((Math.abs(lpx - sim.xtg) < 0.06 && Math.abs(sim.om) < 0.15) || sim.stepT > 6) { release(sim); sim.stepIdx++; sim.stepT = 0; }
        }
        else if (op === 'BEKLE') { if (sim.stepT >= (st[1] || 0.5)) { sim.stepIdx++; sim.stepT = 0; } }
        else sim.stepIdx++;
      }
    }

    // ---- istasyon tutuşu: konumu kilitle + rüzgâr pompalamasını engelle (TAM söndürme değil — o SONDUR'un işi) ----
    if (accel === 0) {
      accel = Math.max(-5, Math.min(5, -2.4 * (sim.x - sim.xtg) - 3.0 * sim.v + 1.3 * sim.phi + 0.7 * sim.om));
    }

    // ---- fizik ----
    const mLoad = sim.hooked >= 0 ? sim.boxes[sim.hooked].w : 0.25;
    sim.v += accel * dt;
    sim.v = Math.max(-2.2, Math.min(2.2, sim.v));
    sim.x += sim.v * dt;
    if (sim.x < X_MIN) { sim.x = X_MIN; sim.v = 0; }
    if (sim.x > X_MAX) { sim.x = X_MAX; sim.v = 0; }
    // halat vinci
    const hoistV = 0.55 * (p.motor || 1) / (0.6 + mLoad * 0.4);
    sim.L += Math.max(-hoistV * dt, Math.min(hoistV * dt, sim.Ltg - sim.L));
    // sarkaç (trolley ivmesi + rüzgâr bozucusu)
    const wind = m.wind * (Math.sin(sim.t * 0.9) * 0.6 + Math.sin(sim.t * 2.3) * 0.4 + 0.5);
    const inertia = 1 / (0.5 + mLoad * 0.5);
    sim.om += (-(G / sim.L) * Math.sin(sim.phi)
               - (accel / sim.L) * Math.cos(sim.phi)
               - DAMP * sim.om * inertia
               + wind / (sim.L * (0.4 + mLoad))) * dt;
    sim.phi += sim.om * dt;
    sim.maxSwing = Math.max(sim.maxSwing, Math.abs(sim.phi));

    const lp = loadPos(sim);
    // taşınan kutu kancayı izler
    if (sim.hooked >= 0) {
      const b = sim.boxes[sim.hooked];
      b.x = lp.x; b.y = lp.y - BOX / 2;
      // duvar çarpması
      for (const w of m.walls) {
        if (Math.abs(b.x - w.x) < BOX / 2 + 0.05 && b.y - BOX / 2 < w.h) {
          sim.status = 'failed'; sim.reason = 'duvar';
          pushEvt(sim, 'crash', '💥 Yük duvara çarptı! Sallanma + alçak taşıma = kaza.');
          return;
        }
      }
      // yere sürtme
      if (b.y - BOX / 2 < 0.01 && Math.abs(sim.v) + Math.abs(sim.om) * sim.L > 0.3) {
        sim.status = 'failed'; sim.reason = 'surtme';
        pushEvt(sim, 'drag', '💥 Yük yerde sürüklendi — halat çok uzun!');
        return;
      }
    }

    // ---- düşen kutular ----
    sim.boxes.forEach((b, i) => {
      if (i === sim.hooked || !b.falling) return;
      b.vy -= G * dt;
      b.y += b.vy * dt;
      b.x += b.vx * dt;
      let floor = BOX / 2;
      sim.boxes.forEach((u, j) => {
        if (j === i || u.falling || j === sim.hooked || u.toppled) return;
        if (Math.abs(u.x - b.x) < BOX * 0.8 && b.y > u.y) floor = Math.max(floor, u.y + BOX);
      });
      for (const w of m.walls) {
        if (Math.abs(b.x - w.x) < BOX / 2 + 0.04 && b.y - BOX / 2 < w.h) {
          b.toppled = true; b.falling = false; b.y = w.h + BOX / 2; b.vx = 0;
          pushEvt(sim, 'wtop' + i, '🫨 Konteyner duvara düştü!');
          return;
        }
      }
      if (b.y <= floor) {
        const impact = Math.abs(b.vy), slide = Math.abs(b.vx);
        b.y = floor; b.falling = false;
        const dropH = impact * impact / (2 * G);
        if (slide > 0.55 || (floor > BOX && dropH > 0.16) || dropH > 0.5) {
          b.toppled = true; b.x += Math.sign(b.vx || 1) * 0.3;
          if (floor > BOX) b.y = BOX / 2;
          pushEvt(sim, 'top' + i, '🫨 Konteyner ' + (slide > 0.55 ? 'KAYDI ve devrildi — sallanırken bırakıldı (yatay hız ' + slide.toFixed(1) + ' m/s)' : 'DEVRİLDİ — ' + Math.round(dropH * 100) + ' cm yüksekten düştü'));
        } else {
          pushEvt(sim, 'set' + i + '_' + Math.round(sim.t), '📦 Konteyner yerleşti (x=' + b.x.toFixed(2) + ')');
        }
        b.vx = 0; b.vy = 0;
      }
    });

    // ---- iz + bitiş ----
    sim.totalTicks++;
    if (sim.totalTicks % 4 === 0) {
      sim.trace.push([lp.x, lp.y, sim.hooked >= 0 ? 1 : 0, sim.phi]);
      if (sim.trace.length > 3000) sim.trace.shift();
    }
    sim.t += dt;
    const progDone = sim.stepIdx >= (sim.cfg.program || []).length;
    const settled = sim.boxes.every(b => !b.falling) && sim.hooked < 0;
    if (progDone && settled) {
      const ok = missionOk(sim);
      if (ok.done) { sim.status = 'success'; sim.reason = 'tamam'; }
      else { sim.status = 'failed'; sim.reason = ok.why; }
    }
    if (sim.t > m.dur) { sim.status = 'failed'; sim.reason = 'sure'; }
  }

  function tryHook(sim) {
    if (sim.hooked >= 0) return;
    if (Math.abs(sim.phi) > SWING_HOOK || Math.abs(sim.om) > 0.35) {
      pushEvt(sim, 'sw' + sim.stepIdx + '_' + Math.round(sim.t), '🫳 Kanca SALLANIRKEN takılamadı (|açı| ' + (Math.abs(sim.phi) * 57.3).toFixed(0) + '° > ' + (SWING_HOOK * 57.3).toFixed(0) + '°)');
      return;
    }
    const lp = loadPos(sim);
    let best = -1, bd = HOOK_R;
    sim.boxes.forEach((b, i) => {
      if (b.toppled || b.falling) return;
      const d = Math.hypot(b.x - lp.x, (b.y + BOX / 2) - lp.y);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) { sim.hooked = best; pushEvt(sim, 'h' + best, '🪝 Konteyner ' + (best + 1) + ' kancada'); }
    else pushEvt(sim, 'hm' + sim.stepIdx + '_' + Math.round(sim.t), '🫳 Kanca boş döndü — konteynerin tam üstünde ve doğru halat boyunda mısın?');
  }
  function release(sim) {
    if (sim.hooked < 0) return;
    const b = sim.boxes[sim.hooked];
    b.falling = true;
    b.vy = 0;
    b.vx = sim.v + sim.om * sim.L * Math.cos(sim.phi);   // yükün gerçek yatay hızı!
    sim.swingAtRelease.push(Math.abs(sim.phi));
    sim.hooked = -1;
  }

  function missionOk(sim) {
    const m = sim.mission;
    if (sim.boxes.some(b => b.toppled)) return { done: false, why: 'devrildi' };
    if (m.stackGoal) {
      const z = m.zones[0];
      const inZone = sim.boxes.filter(b => Math.abs(b.x - z.x) < z.tol + BOX * 0.4);
      if (inZone.length < m.stackGoal) return { done: false, why: 'eksik' };
      const lvls = new Set(inZone.map(b => Math.round(b.y / BOX * 2)));
      if (lvls.size < m.stackGoal) return { done: false, why: 'istif' };
      return { done: true };
    }
    for (const z of m.zones) {
      const found = sim.boxes.some(b => Math.abs(b.x - z.x) <= z.tol && b.y < BOX);
      if (!found) return { done: false, why: 'eksik' };
    }
    return { done: true };
  }

  function precision(sim) {
    const m = sim.mission;
    let s = 0, n = 0;
    for (const z of m.zones) {
      let best = 1e9;
      sim.boxes.forEach(b => { const d = Math.abs(b.x - z.x); if (d < best) best = d; });
      s += Math.max(0, 100 - best / Math.max(0.05, z.tol) * 55); n++;
    }
    return Math.round(s / Math.max(1, n));
  }
  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const pr = precision(sim);
    const sw = Math.max(0, 100 - sim.maxSwing * 57.3 * 2.2);
    const tScore = Math.max(0, 100 - sim.t / sim.mission.dur * 85);
    const total = pr * 0.4 + sw * 0.3 + tScore * 0.3;
    if (total > 68) return { name: '🏆 Liman Kaptanı', cmt: 'Yük hiç sallanmadı, milimetrik indi, vardiya erken bitti. Vinç senin uzuvun!' };
    if (total > 48) return { name: '🥈 Vinç Operatörü', cmt: 'İş tamam. Madalya için: tepe salınımı ' + Math.round(sim.maxSwing * 57.3) + '° — daha kademeli hızlan, sönümü bekle.' };
    return { name: '🥉 Çırak', cmt: 'Yükler yerinde ama liman sallandı durdu. Anti-sway modunu incele — sarkacı fizik değil, geri besleme yener.' };
  }
  function coach(sim) {
    const tips = [];
    const r = sim.reason || '';
    if (r === 'devrildi') tips.push('Konteyner kaydı/devrildi. Bırakma anında yükün YATAY hızı vardı: v_yük = araba hızı + sarkaç ucu hızı. İkisi de sıfıra yakın olmadan BIRAKMA. SONDUR adımı ya da anti-sway tam bunun için.');
    if (r === 'duvar') tips.push('Yük duvara çarptı. Duvar bölgesinden geçerken halatı KISA tut (yüksek taşı), boşluğun tam üstünde dur, salınımı söndür, sonra dik indir.');
    if (r === 'surtme') tips.push('Yük yerde sürüklendi. Taşıma sırasında halat uzunluğu + kutu boyu ray yüksekliğini aşmamalı — taşımadan önce HALAT ile yükü kaldır.');
    if (r === 'eksik') tips.push('Yükler hedefte değil. Kanca boş dönmüş olabilir: TAK anında |açı| < 6° ve kancanın kutunun ÜSTÜNDE olması şart. Olay kaydına bak — hangi TAK boş döndü?');
    if (r === 'istif') tips.push('Kutular üst üste oturmadı. İkinciyi ilkinin TAM üstüne, kısa halat sarkacının hızlı olduğunu unutmadan bırak: T = 2π√(L/g) — kısa halat = hızlı salınım.');
    if (r === 'sure') tips.push('Süre doldu. Paradoks: YAVAŞ hızlanmak toplamda HIZLIDIR çünkü sönüm beklemezsin. %40 hızla akıcı bir tur, %100 hızla dur-kalk turundan öndedir.');
    if (!tips.length && sim.maxSwing > 0.3) tips.push('Tepe salınım ' + Math.round(sim.maxSwing * 57.3) + '° — bu bir liman değil salıncak! GIT hızlarını düşür ya da anti-sway kazançlarını (ks, kw) artır.');
    if (!tips.length) tips.push('Halat uzunluğu sarkaç periyodunu değiştirir: T = 2π√(L/g). Uzun halat yavaş ve tembel, kısa halat hızlı ve sinirli. İstifte bunu hissedeceksin.');
    return tips;
  }

  function runHeadless(cfg, maxTime, dt) {
    const sim = createSim(cfg);
    const step = dt || 1 / 60, mt = maxTime || (cfg.mission.dur + 3);
    while (sim.status === 'running' && sim.t < mt) tickSim(sim, step);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(1),
      precision: precision(sim), maxSwing: +(sim.maxSwing * 57.3).toFixed(1) };
  }

  // ---- seviye başına hazır programlar -------------------------------------------
  function progFor(mission) {
    const P = [];
    const carryL = mission.walls.length ? Math.min(0.7, RAIL_Y - Math.max(...mission.walls.map(w => w.h)) - BOX - 0.25) : 0.9;
    mission.boxes.forEach((b, i) => {
      const zone = mission.zones[Math.min(i, mission.zones.length - 1)];
      const zx = +zone.x.toFixed(2);
      const stackH = mission.stackGoal && i > 0 ? BOX * i : 0;
      const spd = 45;                                        // kademeli hız: az salınım
      P.push(['HALAT', +carryL.toFixed(2)]);                 // yükü yukarı al
      P.push(['GIT', +b.x.toFixed(2), spd]);
      P.push(['SONDUR']);                                    // söndürme yükü ŞAKÜLE alır (rüzgârda bile)
      P.push(['HALAT', +(RAIL_Y - BOX - 0.02).toFixed(2)]);  // kancayı kutu üstüne indir
      P.push(['TAK']);
      P.push(['HALAT', +carryL.toFixed(2)]);                 // kaldır
      P.push(['GIT', zx, spd]);
      P.push(['SONDUR']);
      P.push(['HALAT', +(RAIL_Y - BOX - stackH - 0.05).toFixed(2)]);  // burnunun dibine indir
      P.push(['SONDUR']);
      P.push(['BIRAK']);
      P.push(['HALAT', +carryL.toFixed(2)]);
    });
    return P;
  }
  function defaultPID() { return { kp: 2.4, kd: 3.0, ks: 6.0, kw: 3.2 }; }
  function defaultParams() { return { motor: 1.0 }; }

  const API = {
    G, RAIL_Y, X_MIN, X_MAX, L_MIN, L_MAX, BOX, HOOK_R, SWING_HOOK,
    MISSIONS, createSim, tickSim, loadPos, missionOk, precision, robotClass, coach, runHeadless,
    progFor, defaultPID, defaultParams,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.VincCore = API;
})();
