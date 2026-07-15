/* =============================================================================
 * RoboForge - Otonom Park (Autonomous Parking) :: Simulation Core
 * -----------------------------------------------------------------------------
 * Pure, dependency-free. Browser (window.ParkCore) + Node (module.exports).
 *
 * A CAR-LIKE robot (can't spin in place - min turn radius!) must park into
 * the marked bay without touching parked cars or walls. The student writes a
 * MANEUVER PLAN: ordered steps of [İleri/Geri] + [Sol/Düz/Sağ] + mesafe.
 * This is the maneuver-sequencing / state-machine lesson.
 *
 * Steering convention: SOL/SAĞ = the direction the PATH curves (curvature),
 * both forward and reverse - like turning the wheel and holding it.
 * ========================================================================== */
(function (global) {
  'use strict';

  const TURN_R = 1.6;            // fixed steering radius
  const CAR_L = 1.1, CAR_W = 0.8;
  const ANG_TOL = 0.18;          // final heading tolerance (rad)
  const LOT_X = 9, LOT_Y = 5;    // lot half-size

  // ---- lots (7-level ladder) -----------------------------------------------------
  // bay: {x,y,w,h,ang} (axis-aligned rect, ang = required heading 0/±PI/2 .. any of ang, ang+PI ok for parallel)
  // cars: parked cars [{x,y,w,h}] · walls extra segments? (lot border implicit)
  // start: {x,y,th}
  const LOTS = [
    { id: 'duz', name: 'Düz Park', difficulty: 'Başlangıç', time: 30,
      bay: { x: 2, y: -3.4, w: 1.5, h: 2.0, ang: -Math.PI / 2 },
      cars: [],
      start: { x: -6, y: 2, th: 0 },
      plan: [['F', 'D', 6.40], ['F', 'R', 2.51], ['F', 'D', 3.80]] },
    { id: 'geri', name: 'Geri Park', difficulty: 'Başlangıç', time: 40,
      bay: { x: 2, y: -3.4, w: 1.5, h: 2.0, ang: Math.PI / 2 },
      cars: [],
      start: { x: -6, y: 2, th: 0 },
      plan: [['F', 'D', 9.60], ['G', 'R', 2.51], ['G', 'D', 3.80]] },
    { id: 'dar', name: 'Dar Alan', difficulty: 'Orta', time: 45,
      bay: { x: 2, y: -3.6, w: 1.4, h: 1.9, ang: Math.PI / 2 },
      cars: [{ x: 0.3, y: -3.6, w: 1.0, h: 1.8 }, { x: 3.7, y: -3.6, w: 1.0, h: 1.8 }],
      start: { x: -6, y: 2, th: 0 },
      plan: [['F', 'D', 9.60], ['G', 'R', 2.51], ['G', 'D', 4.00]] },
    { id: 'paralel', name: 'Paralel Park', difficulty: 'Orta', time: 50,
      bay: { x: 2, y: -4.3, w: 2.4, h: 1.1, ang: 0 },
      cars: [{ x: -0.6, y: -4.3, w: 1.4, h: 0.9 }, { x: 4.6, y: -4.3, w: 1.4, h: 0.9 }],
      start: { x: -6, y: -2.6, th: 0 },
      plan: [['F', 'D', 10.5], ['G', 'R', 1.70], ['G', 'L', 1.70], ['F', 'D', 0.30]] },
    { id: 'dar_paralel', name: 'Dar Paralel', difficulty: 'İleri', time: 60,
      bay: { x: 2, y: -4.3, w: 2.05, h: 1.1, ang: 0 },
      cars: [{ x: -0.35, y: -4.3, w: 1.4, h: 0.9 }, { x: 4.35, y: -4.3, w: 1.4, h: 0.9 }],
      start: { x: -6, y: -2.6, th: 0 },
      plan: [['F', 'D', 10.5], ['G', 'R', 1.70], ['G', 'L', 1.70], ['F', 'D', 0.30]] },
    { id: 'uc_nokta', name: 'Üç Nokta', difficulty: 'İleri', time: 60,
      bay: { x: 6.8, y: -3.6, w: 1.5, h: 1.9, ang: Math.PI / 2 },
      cars: [{ x: 5.0, y: -3.6, w: 1.0, h: 1.8 }, { x: 8.3, y: -3.7, w: 0.9, h: 1.7 }],
      start: { x: -6, y: 2, th: 0 },
      plan: [['F', 'D', 13.0], ['F', 'L', 0.60], ['G', 'R', 2.00], ['G', 'D', 4.20]] },
    { id: 'kabus', name: 'Kâbus Park', difficulty: 'Uzman', time: 75,
      bay: { x: 2, y: -4.3, w: 1.9, h: 1.1, ang: 0 },
      cars: [{ x: -0.28, y: -4.3, w: 1.4, h: 0.9 }, { x: 4.28, y: -4.3, w: 1.4, h: 0.9 },
             { x: 2, y: -0.6, w: 3.6, h: 0.9 }],
      start: { x: -6.5, y: -2.5, th: 0 },
      plan: [['F', 'D', 10.5], ['G', 'R', 1.80], ['G', 'L', 1.80], ['F', 'D', 0.70]] },
  ];

  // ---- motion (bicycle with fixed radius; curvature steering) --------------------
  function stepPose(p, dir, steer, ds) {
    // dir: +1 forward / -1 reverse · steer: 'L','D','R' · ds: small distance (>0)
    const s = dir * ds;
    if (steer === 'D') {
      p.x += Math.cos(p.th) * s;
      p.y += Math.sin(p.th) * s;
    } else {
      const k = (steer === 'L' ? 1 : -1) / TURN_R;
      const dth = k * s;
      // exact arc integration
      const R = 1 / k;
      p.x += R * (Math.sin(p.th + dth) - Math.sin(p.th));
      p.y += R * (-Math.cos(p.th + dth) + Math.cos(p.th));
      p.th += dth;
    }
  }

  // ---- collision -------------------------------------------------------------------
  function carCorners(p) {
    const c = Math.cos(p.th), s = Math.sin(p.th);
    const hx = CAR_L / 2, hy = CAR_W / 2;
    return [[hx, hy], [hx, -hy], [-hx, -hy], [-hx, hy]].map(([lx, ly]) =>
      [p.x + lx * c - ly * s, p.y + lx * s + ly * c]);
  }
  function pointInRect(px, py, r) {
    return px > r.x - r.w / 2 && px < r.x + r.w / 2 && py > r.y - r.h / 2 && py < r.y + r.h / 2;
  }
  function collides(sim, p) {
    const corners = carCorners(p);
    // perimeter samples
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      for (let j = 0; j <= 3; j++) pts.push([a[0] + (b[0] - a[0]) * j / 3, a[1] + (b[1] - a[1]) * j / 3]);
    }
    for (const [px, py] of pts) {
      if (Math.abs(px) > LOT_X || Math.abs(py) > LOT_Y) return 'duvar';
      for (const car of sim.lot.cars) if (pointInRect(px, py, car)) return 'arac';
    }
    // parked-car corners inside robot (coarse: center distance check then corner test)
    for (const car of sim.lot.cars) {
      const cc = [[car.x - car.w / 2, car.y - car.h / 2], [car.x + car.w / 2, car.y - car.h / 2],
                  [car.x - car.w / 2, car.y + car.h / 2], [car.x + car.w / 2, car.y + car.h / 2]];
      const c = Math.cos(-p.th), s = Math.sin(-p.th);
      for (const [qx, qy] of cc) {
        const lx = (qx - p.x) * c - (qy - p.y) * s;
        const ly = (qx - p.x) * s + (qy - p.y) * c;
        if (Math.abs(lx) < CAR_L / 2 && Math.abs(ly) < CAR_W / 2) return 'arac';
      }
    }
    return null;
  }

  // ---- park check --------------------------------------------------------------------
  function wrapA(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function parkScore(sim, p) {
    const bay = sim.lot.bay;
    const corners = carCorners(p);
    let inside = true;
    for (const [px, py] of corners) if (!pointInRect(px, py, bay)) inside = false;
    let aErr = Math.abs(wrapA(p.th - bay.ang));
    const aErr2 = Math.abs(wrapA(p.th - bay.ang - Math.PI));
    if (bay.ang === 0 || Math.abs(bay.ang) === Math.PI) aErr = Math.min(aErr, aErr2); // parallel: either way
    const posErr = Math.hypot(p.x - bay.x, p.y - bay.y);
    return { inside, aErr, posErr,
      ok: inside && aErr < ANG_TOL,
      pct: Math.max(0, Math.round(100 * (1 - posErr / 1.2) * (1 - aErr / 0.5))) };
  }

  // ---- sim -----------------------------------------------------------------------------
  function createSim(cfg) {
    const lot = cfg.lot;
    return {
      cfg, lot,
      pose: { x: lot.start.x, y: lot.start.y, th: lot.start.th },
      t: 0, status: 'running', reason: null,
      stepIdx: 0, stepDone: 0,
      trail: [], totalTicks: 0, last: null,
    };
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return sim.last;
    const plan = sim.cfg.plan || [];
    const speed = (sim.cfg.params && sim.cfg.params.vMax ? sim.cfg.params.vMax : 3.6) * 0.55;

    if (sim.stepIdx >= plan.length) {
      const sc = parkScore(sim, sim.pose);
      sim.status = sc.ok ? 'success' : 'failed';
      sim.reason = sc.ok ? 'parked' : 'dis';
      sim.last = { ...sim.last, score: sc };
      return sim.last;
    }
    const [dirC, steer, dist] = plan[sim.stepIdx];
    const dir = dirC === 'G' ? -1 : 1;
    const ds = Math.min(speed * dt, dist - sim.stepDone);
    stepPose(sim.pose, dir, steer, ds);
    sim.stepDone += ds;
    if (sim.stepDone >= dist - 1e-6) { sim.stepIdx++; sim.stepDone = 0; }

    sim.t += dt; sim.totalTicks++;
    const hit = collides(sim, sim.pose);
    if (hit) { sim.status = 'failed'; sim.reason = 'crash_' + hit; }
    else if (sim.t > (sim.lot.time || 45)) { sim.status = 'failed'; sim.reason = 'timeout'; }

    if (sim.totalTicks % 2 === 0) {
      sim.trail.push([sim.pose.x, sim.pose.y, sim.pose.th]);
      if (sim.trail.length > 4000) sim.trail.shift();
    }
    sim.last = { pose: { ...sim.pose }, stepIdx: sim.stepIdx, stepDone: sim.stepDone };
    return sim.last;
  }

  function coach(sim) {
    const tips = [];
    const sc = parkScore(sim, sim.pose);
    if (sim.reason === 'dis') {
      if (!sc.inside && sc.posErr > 1.5) tips.push('Araç park yerinin epey dışında kaldı. İlk düz gidiş mesafesini haritaya bakarak ayarla - manevra tam doğru noktada başlamalı.');
      else if (!sc.inside) tips.push('Az kaldı! Araç park cebine tam oturmadı (' + sc.posErr.toFixed(1) + ' birim sapma). Son adımların mesafelerini küçük adımlarla oynat.');
      else tips.push('Yer doğru ama açı yamuk (' + (sc.aErr * 57.3).toFixed(0) + '°). Kavisli adımların mesafesi dönüş açısını belirler: çeyrek dönüş ≈ 2.51 birim.');
    }
    if (sim.reason === 'crash_arac') tips.push('Park halindeki araca çarptın! Manevraya daha uzaktan başla ya da kavis yönünü değiştir. Gerçek şoförler gibi: önce hizalan, sonra kır.');
    if (sim.reason === 'crash_duvar') tips.push('Duvara/kaldırıma çarptın. Geri adımların mesafesini kısalt.');
    if (sim.status === 'success') {
      if (sc.pct >= 85) tips.push('Şoför ehliyetin hazır! Milimetrik park.');
      else tips.push('Park başarılı ama biraz eğri durdu (%' + sc.pct + ' hassasiyet). Mesafelerde ince ayarla mükemmelleştir.');
    }
    return tips;
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const sc = parkScore(sim, sim.pose);
    if (sc.pct >= 88) return { key: 'park_ustasi', name: '🏆 Park Ustası', cmt: 'Cetvelle çizilmiş gibi - vale bile bu kadar iyi park edemez.' };
    if (sc.pct >= 70) return { key: 'usta_sofor', name: '🥇 Usta Şoför', cmt: 'Temiz park. Bir tık daha ortalayabilirsin.' };
    if (sc.pct >= 50) return { key: 'ehliyetli', name: '🧭 Ehliyetli', cmt: 'Cebe girdin! Açıyı düzeltirsen usta olursun.' };
    return { key: 'caylak_sofor', name: '🎓 Çaylak Şoför', cmt: 'Park edildi - sınırda ama sayılır!' };
  }

  function runHeadless(cfg, maxTime, dt) {
    dt = dt || 1 / 60;
    const sim = createSim(cfg);
    const mt = maxTime || (cfg.lot.time || 45) + 3;
    let g = 0;
    while (sim.status === 'running' && sim.t < mt && g++ < 2e6) tickSim(sim, dt);
    const sc = parkScore(sim, sim.pose);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(2),
      pct: sc.pct, posErr: +sc.posErr.toFixed(2), aErr: +(sc.aErr * 57.3).toFixed(1) };
  }

  function shippedPlan(lot) { return (lot.plan || []).map(s => s.slice()); }

  // ---- sensor autopilot: template + tiny search, style perturbed by sliders ----------
  // sliders: { kavis: 0.8..1.3 (arc scale), pay: 0.7..1.4 (final leg scale) }
  function sensorTemplates(lot, s) {
    const bay = lot.bay;
    const Q = Math.PI / 2 * TURN_R;
    const gens = [];
    if (bay.ang === -Math.PI / 2) {
      gens.push(a => [['F', 'D', a], ['F', 'R', Q * s.kavis], ['F', 'D', 3.8 * s.pay]]);
    } else if (bay.ang === Math.PI / 2) {
      gens.push(a => [['F', 'D', a], ['G', 'R', Q * s.kavis], ['G', 'D', 3.8 * s.pay]]);
      gens.push(a => [['F', 'D', a], ['F', 'L', 0.6 * s.kavis], ['G', 'R', 2.0 * s.kavis], ['G', 'D', 4.2 * s.pay]]);
    } else {
      for (const arc of [1.6, 1.7, 1.8]) {
        gens.push(a => [['F', 'D', a], ['G', 'R', arc * s.kavis], ['G', 'L', arc * s.kavis], ['F', 'D', 0.3 * s.pay]]);
      }
    }
    return gens;
  }
  function solveSensorPlan(lot, sliders) {
    const s = sliders || defaultSensor();
    let best = null, bestScore = -1e9;
    for (const gen of sensorTemplates(lot, s)) {
      for (let a = 3; a <= 14.5; a += 0.25) {
        const plan = gen(a);
        const r = runHeadless({ lot, plan, params: { vMax: 4.5, wheelBase: 1.1, turnGain: 1 } }, 45, 1 / 30);
        let score = (r.status === 'success' ? 1000 : 0) + r.pct;
        if (r.reason && String(r.reason).indexOf('crash') === 0) score -= 400;
        if (score > bestScore) { bestScore = score; best = plan; }
      }
    }
    return { plan: best, score: bestScore };
  }
  function previewPath(lot, plan) {
    // pure kinematic trace of a plan (no collision) for the ghost preview
    const p = { x: lot.start.x, y: lot.start.y, th: lot.start.th };
    const pts = [[p.x, p.y]];
    for (const [dirC, steer, dist] of plan) {
      const dir = dirC === 'G' ? -1 : 1;
      let done = 0;
      while (done < dist) {
        const ds = Math.min(0.12, dist - done);
        stepPose(p, dir, steer, ds);
        done += ds;
        pts.push([p.x, p.y]);
      }
    }
    return { pts, end: { ...p } };
  }
  function defaultSensor() { return { kavis: 1.0, pay: 1.0 }; }
  function defaultParams() { return { vMax: 3.6, wheelBase: 1.1, turnGain: 1.0 }; }

  const API = {
    TURN_R, CAR_L, CAR_W, LOT_X, LOT_Y, ANG_TOL,
    LOTS, stepPose, carCorners, collides, parkScore, wrapA,
    createSim, tickSim, coach, robotClass, runHeadless, shippedPlan, defaultParams,
    solveSensorPlan, previewPath, defaultSensor,
  };
  global.ParkCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
