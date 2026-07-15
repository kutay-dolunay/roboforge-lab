/* =============================================================================
 * RoboForge - Denge Robotu (Self-Balancing Robot) :: Simulation Core
 * -----------------------------------------------------------------------------
 * Pure, dependency-free. Browser (window.BalanceCore) + Node (module.exports).
 *
 * SIDE-VIEW inverted pendulum on wheels - the first UNSTABLE system in the
 * catalog. Do nothing and it falls. This is the real reason PID exists.
 *
 * State: x (position), v, th (tilt, + = leaning RIGHT), om (tilt rate).
 * Motor command m in [-1,1] drives the wheels; accelerating the base tips
 * the body the opposite way (cart-pole coupling).
 *
 * PID mode (DEFAULT): m = Kp·th + Kd·om, with a target-seeking tilt reference
 * (to move right you must LEAN right - position control goes through angle).
 * Kural mode: tilt bands (ÇOK SOL / SOL / DİK / SAĞ / ÇOK SAĞ) + HEDEF side.
 * ========================================================================== */
(function (global) {
  'use strict';

  const G = 14.0;              // gravity term (1/s^2 scaled)
  const CPL = 3.0;             // base-accel -> tilt coupling
  const FALL = 0.6;            // |tilt| beyond this = fell (rad)
  const V_FRICTION = 0.45;
  const X_LIM = 10;            // arena half-width
  const TARGET_R = 0.7;
  const BAND1 = 0.06, BAND2 = 0.22; // tilt band edges

  // ---- levels (7-ladder) ---------------------------------------------------------
  // dur: survive this long · targets: [{t:afterSec, x}] visit in order (within TARGET_R,
  // while |tilt|<FALL) · pokes: [{t, imp}] impulse on om · wind: {base, gustT, gustImp}
  // mass: tilt inertia multiplier (yük) - heavier = slower, harder recovery
  const LEVELS = [
    { id: 'ayakta', name: 'Ayakta Kal', difficulty: 'Başlangıç', dur: 12,
      init: 0.09, targets: [], pokes: [], mass: 1 },
    { id: 'durtme', name: 'Küçük Dürtme', difficulty: 'Başlangıç', dur: 20,
      init: 0.05, targets: [], mass: 1,
      pokes: [{ t: 4, imp: 0.5 }, { t: 9, imp: -0.65 }, { t: 14, imp: 0.75 }] },
    { id: 'hedef', name: 'Hedefe Git', difficulty: 'Orta', dur: 30,
      init: 0.04, mass: 1, pokes: [],
      targets: [{ x: 5 }, { x: -4 }] },
    { id: 'ruzgar', name: 'Rüzgârlı Gün', difficulty: 'Orta', dur: 30,
      init: 0.04, mass: 1, pokes: [],
      wind: { base: 0.55, gustT: 5, gustImp: 0.5 },
      targets: [{ x: 4 }] },
    { id: 'yuk', name: 'Yük Taşıma', difficulty: 'İleri', dur: 35,
      init: 0.04, mass: 1.6, pokes: [],
      targets: [{ x: 5 }, { x: -5 }] },
    { id: 'firtina', name: 'Fırtına', difficulty: 'İleri', dur: 35,
      init: 0.04, mass: 1.15,
      wind: { base: 0.75, gustT: 3.5, gustImp: 0.85 },
      pokes: [{ t: 12, imp: 0.7 }, { t: 24, imp: -0.8 }],
      targets: [{ x: 4 }, { x: -3 }] },
    { id: 'kabus', name: 'Kâbus Dengesi', difficulty: 'Uzman', dur: 45,
      init: 0.05, mass: 1.45,
      wind: { base: 0.6, gustT: 3, gustImp: 0.8 },
      pokes: [{ t: 6, imp: 0.85 }, { t: 15, imp: -0.9 }, { t: 26, imp: 0.95 }, { t: 36, imp: -0.9 }],
      targets: [{ x: 5 }, { x: -5 }, { x: 3 }] },
  ];

  // deterministic wind: base + square gusts alternating sign
  function windAt(level, t) {
    const w = level.wind;
    if (!w) return 0;
    const phase = Math.floor(t / w.gustT);
    const inGust = (t - phase * w.gustT) < w.gustT * 0.4;
    const sign = phase % 2 === 0 ? 1 : -1;
    return w.base * Math.sin(t * 0.7) + (inGust ? sign * w.gustImp * 0.55 : 0);
  }

  // ---- rules -----------------------------------------------------------------------
  function tiltBands(th) {
    return {
      cokSol: th < -BAND2,
      sol: th >= -BAND2 && th < -BAND1,
      dik: Math.abs(th) <= BAND1,
      sag: th > BAND1 && th <= BAND2,
      cokSag: th > BAND2,
    };
  }
  function motorFraction(m) {
    if (!m || m.dir === 'stop') return 0;
    const f = (m.speed || 0) / 100;
    return m.dir === 'rev' ? -f : f;
  }
  function ruleMatches(rule, arr) {
    for (let i = 0; i < arr.length; i++) {
      const c = rule.pattern[i] || 'any';
      if (c === 'any') continue;
      if (c === 'on' && !arr[i]) return false;
      if (c === 'off' && arr[i]) return false;
    }
    return true;
  }
  function evalRules(rules, defaultRule, arr) {
    for (let i = 0; i < rules.length; i++) {
      if (ruleMatches(rules[i], arr)) {
        return { m: motorFraction(rules[i].left), ruleIndex: i };
      }
    }
    return { m: motorFraction(defaultRule.left), ruleIndex: -1 };
  }

  // ---- sim --------------------------------------------------------------------------
  function createSim(cfg) {
    const level = cfg.level;
    return {
      cfg, level,
      x: 0, v: 0, th: level.init || 0.05, om: 0,
      t: 0, status: 'running', reason: null,
      targetIdx: 0, targetHold: 0, reached: [],
      pokeIdx: 0, lastPoke: -1,
      maxTilt: 0, sumTilt: 0, totalTicks: 0,
      log: [], last: null,
    };
  }

  function currentTarget(sim) {
    const T = sim.level.targets || [];
    return sim.targetIdx < T.length ? T[sim.targetIdx] : null;
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return sim.last;
    const level = sim.level;
    const params = sim.cfg.params;
    const mode = sim.cfg.mode || 'pid';
    const authority = (params.vMax / 3.6) * 8.0;   // motor accel authority
    const mass = level.mass || 1;

    // disturbances
    const pokes = level.pokes || [];
    if (sim.pokeIdx < pokes.length && sim.t >= pokes[sim.pokeIdx].t) {
      sim.om += pokes[sim.pokeIdx].imp / mass;
      sim.lastPoke = sim.t;
      sim.pokeIdx++;
    }
    const wind = windAt(level, sim.t) / mass;

    // controller
    const tgt = currentTarget(sim);
    let m, ruleIndex = null;
    if (mode === 'pid') {
      const pid = sim.cfg.pid || defaultPID();
      // target-seeking tilt reference: to go right, lean right a little
      let thRef = 0;
      if (tgt) {
        const dx = tgt.x - sim.x;
        thRef = Math.max(-0.12, Math.min(0.12, dx * (pid.kx || 0) * 0.02 - sim.v * 0.012));
      } else {
        thRef = Math.max(-0.08, Math.min(0.08, -sim.x * 0.008 - sim.v * 0.012)); // hold station
      }
      sim.iTh = Math.max(-1.2, Math.min(1.2, (sim.iTh || 0) + (sim.th - thRef) * dt));
      m = (pid.kp || 0) * (sim.th - thRef) + (pid.kd || 0) * sim.om + (pid.ki || 0) * sim.iTh;
      m = Math.max(-1, Math.min(1, m));
    } else {
      const b = tiltBands(sim.th);
      const hedefSol = !!(tgt && tgt.x < sim.x - TARGET_R);
      const hedefSag = !!(tgt && tgt.x > sim.x + TARGET_R);
      const arr = [b.cokSol, b.sol, b.dik, b.sag, b.cokSag, hedefSol, hedefSag];
      const r = evalRules(sim.cfg.rules, sim.cfg.defaultRule, arr);
      m = r.m; ruleIndex = r.ruleIndex;
    }

    // physics
    const a = m * authority;
    sim.om += (G * Math.sin(sim.th) / mass - CPL * a * Math.cos(sim.th) / mass + wind) * dt;
    sim.th += sim.om * dt;
    sim.v += (a - V_FRICTION * sim.v) * dt;
    sim.x += sim.v * dt;

    sim.t += dt; sim.totalTicks++;
    const absT = Math.abs(sim.th);
    if (absT > sim.maxTilt) sim.maxTilt = absT;
    sim.sumTilt += absT;

    // targets
    if (tgt && Math.abs(sim.x - tgt.x) < TARGET_R && absT < 0.3) {
      sim.targetHold += dt;
      if (sim.targetHold > 0.8) {
        sim.reached.push(sim.targetIdx);
        sim.targetIdx++; sim.targetHold = 0;
      }
    } else sim.targetHold = 0;

    if (sim.totalTicks % 4 === 0) {
      sim.log.push([sim.t, sim.th, sim.x, sim.om]);
      if (sim.log.length > 2000) sim.log.shift();
    }

    if (absT > FALL) { sim.status = 'failed'; sim.reason = 'fell'; }
    else if (Math.abs(sim.x) > X_LIM) { sim.status = 'failed'; sim.reason = 'out'; }
    else if (sim.t >= level.dur) {
      const allTargets = sim.targetIdx >= (level.targets || []).length;
      sim.status = allTargets ? 'success' : 'failed';
      sim.reason = allTargets ? 'balanced' : 'targets_missed';
    }

    sim.last = { m, ruleIndex, wind, tgt, poke: (sim.t - sim.lastPoke) < 0.5 };
    return sim.last;
  }

  function steadiness(sim) {
    return sim.totalTicks ? Math.max(0, Math.round(100 * (1 - (sim.sumTilt / sim.totalTicks) / 0.25))) : 0;
  }

  function coach(sim) {
    const tips = [];
    const mode = sim.cfg.mode || 'pid';
    if (sim.reason === 'fell') {
      if (mode === 'pid') {
        if ((sim.cfg.pid.kd || 0) < 0.15) tips.push("Robot devrildi. Kd çok düşük - açı DÜZELİRKEN bile hız kazanır ve öbür tarafa aşar. Kd devrilme hızını görür ve erken frenler; önce Kd değerini artır.");
        else if ((sim.cfg.pid.kp || 0) < 1.2) tips.push("Robot devrildi. Kp yetersiz - eğim büyüyünce yeterince sert tepki veremiyor. Kp değerini artır.");
        else tips.push("Devrildi! Kp/Kd oranını dengele: çok Kp titretir, çok Kd uyuşuk yapar. Dürtmelerden hemen sonra ne olduğuna denge grafiğinden bak.");
      } else {
        tips.push('Devrildi! Bant kuralları kesiklidir: DİK bandında motor 0 iken robot yine de hız kazanmış olabilir. ÇOK eğik bantlarda tam güç, az eğik bantlarda orta güç ver - ya da PID moduna geçip sürekli kontrolü dene (bu senaryonun asıl dersi!).');
      }
    }
    if (sim.reason === 'out') tips.push("Robot dengede ama sahneden kaçtı! Konumu geri çeken terim zayıf - Hedef Çekimi kazancını artır.");
    if (sim.reason === 'targets_missed') tips.push('Ayakta kaldın ama hedeflere uğramadın (' + sim.reached.length + '/' + (sim.level.targets || []).length + '). Hedefe gitmek için robot hedefe DOĞRU hafifçe eğilmeli - Hedef Çekimi kazancını artır.');
    if (sim.status === 'success') {
      const st = steadiness(sim);
      if (st >= 85) tips.push('Heykel gibi! Segway mühendisleri seninle gurur duyar.');
      else tips.push("Görev tamam ama salınım vardı (denge puanı %" + st + "). Kd değerini biraz artırıp titremeyi söndürmeyi dene.");
    }
    return tips;
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const st = steadiness(sim);
    if (st >= 85) return { key: 'denge_ustasi', name: '🏆 Denge Ustası', cmt: 'Fırtınada bile kıpırdamadı - kontrol mühendisliği bu.' };
    if (st >= 68) return { key: 'ip_cambazi', name: '🥇 İp Cambazı', cmt: 'Sağlam duruş. Salınımı biraz daha söndürebilirsin.' };
    if (st >= 50) return { key: 'dengeci', name: '🧭 Dengeci', cmt: 'Ayakta kaldın! Şimdi daha az sallanma zamanı.' };
    return { key: 'caylak_cambaz', name: '🎓 Çaylak Cambaz', cmt: 'Düşe kalka ama başardın - Kd seni bekliyor.' };
  }

  function runHeadless(cfg, maxTime, dt) {
    dt = dt || 1 / 60;
    const sim = createSim(cfg);
    const mt = maxTime || (cfg.level.dur || 30) + 2;
    let g = 0;
    while (sim.status === 'running' && sim.t < mt && g++ < 2e6) tickSim(sim, dt);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(2),
      steadiness: steadiness(sim), maxTilt: +(sim.maxTilt * 57.3).toFixed(1),
      reached: sim.reached.length, targets: (cfg.level.targets || []).length };
  }

  // ---- starters -----------------------------------------------------------------------
  // pattern = [cokSol, sol, dik, sag, cokSag, hedefSol, hedefSag]
  function starterRules() {
    return [
      { pattern: ['on', 'any', 'any', 'any', 'any', 'any', 'any'], left: { dir: 'rev', speed: 95 } },
      { pattern: ['off', 'on', 'any', 'any', 'any', 'any', 'any'], left: { dir: 'rev', speed: 40 } },
      { pattern: ['any', 'any', 'any', 'on', 'off', 'any', 'any'], left: { dir: 'fwd', speed: 40 } },
      { pattern: ['any', 'any', 'any', 'any', 'on', 'any', 'any'], left: { dir: 'fwd', speed: 95 } },
      // upright + target side: tiny push toward it (leans the body that way)
      { pattern: ['any', 'any', 'on', 'any', 'any', 'on', 'any'], left: { dir: 'rev', speed: 14 } },
      { pattern: ['any', 'any', 'on', 'any', 'any', 'any', 'on'], left: { dir: 'fwd', speed: 14 } },
    ];
  }
  function starterDefault() { return { left: { dir: 'stop', speed: 0 } }; }
  function defaultParams() { return { vMax: 3.6, wheelBase: 1.1, turnGain: 1.0 }; }
  function defaultPID() { return { kp: 2.6, kd: 0.55, ki: 0.35, kx: 1.0 }; }

  const API = {
    G, CPL, FALL, X_LIM, TARGET_R, BAND1, BAND2,
    LEVELS, windAt, tiltBands, evalRules, ruleMatches, motorFraction,
    createSim, tickSim, steadiness, coach, robotClass, runHeadless, currentTarget,
    starterRules, starterDefault, defaultParams, defaultPID,
  };
  global.BalanceCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
