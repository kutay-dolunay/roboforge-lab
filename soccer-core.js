/* =============================================================================
 * RoboForge — Robot Futbolu (1v1 Robot Soccer) :: Simulation Core
 * -----------------------------------------------------------------------------
 * Pure, dependency-free. Browser (window.SoccerCore) + Node (module.exports).
 *
 * 1v1: the student's robot (attacks the RIGHT goal, +x) vs an AI opponent
 * (attacks the LEFT goal). First goal wins. Opponent scores or time up = loss.
 *
 * Player sensors (robot frame, fixed roles):
 *   TOP-SOL / TOP-ÖN / TOP-SAĞ   : which third the ball is in
 *   KALE-SOL / KALE-ÖN / KALE-SAĞ : bearing of the OPPONENT goal (attack target)
 * Rule pattern = [tSol,tOn,tSag,kSol,kOn,kSag] with 'on'/'off'/'any'.
 * PID mode: built-in two-state striker (chase ball → drive ball to goal),
 * student tunes Temel Hız / Kp (yönelme) / Kd.
 * ========================================================================== */
(function (global) {
  'use strict';

  const PITCH_W = 17, PITCH_H = 11;     // half sizes: x in [-8.5,8.5], y in [-5.5,5.5]
  const GOAL_W = 4.6;                   // goal mouth height (y span)
  const BALL_R = 0.32, ROBOT_R = 0.55;
  const BALL_FRICTION = 1.15;
  const WALL_REST = 0.55;
  const KICK_GAIN = 1.5, KICK_MIN = 1.2;

  // ---- opponents (7-level ladder) ---------------------------------------------
  // spd: max speed · trn: turn rate (rad/s) · delay: kickoff reaction ·
  // def: defensive pull toward own goal (0..1) · shot: shot speed when clear
  const OPPONENTS = [
    { id: 'acemi', goals: 1, shot: 3.0, name: 'Acemi', difficulty: 'Başlangıç', time: 60,
      spd: 1.2, trn: 2.2, delay: 2.0, def: 0.0, react: 1.4 },
    { id: 'caylak', goals: 1, shot: 3.2, name: 'Çaylak', difficulty: 'Başlangıç', time: 60,
      spd: 1.6, trn: 2.6, delay: 1.5, def: 0.1, react: 1.1 },
    { id: 'savunmaci', goals: 1, shot: 3.4, name: 'Savunmacı', difficulty: 'Orta', time: 75,
      spd: 1.9, trn: 3.0, delay: 1.0, def: 0.8, react: 0.9 },
    { id: 'dengeli', goals: 1, shot: 3.6, name: 'Dengeli', difficulty: 'Orta', time: 90,
      spd: 2.1, trn: 3.2, delay: 0.8, def: 0.4, react: 0.8 },
    { id: 'atilgan', goals: 1, shot: 3.9, name: 'Atılgan', difficulty: 'İleri', time: 100,
      spd: 2.4, trn: 3.6, delay: 0.6, def: 0.2, react: 0.6 },
    { id: 'usta', goals: 2, shot: 4.1, name: 'Usta', difficulty: 'İleri', time: 110,
      spd: 2.6, trn: 4.0, delay: 0.5, def: 0.55, react: 0.45 },
    { id: 'sampiyon', goals: 2, shot: 4.4, name: 'Şampiyon', difficulty: 'Uzman', time: 130,
      spd: 2.7, trn: 4.2, delay: 0.4, def: 0.5, react: 0.45 },
  ];

  function wrapA(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

  // ---- sensors -----------------------------------------------------------------
  function bearing(robot, tx, ty) {
    return wrapA(Math.atan2(ty - robot.y, tx - robot.x) - robot.th);
  }
  function senseBits(sim) {
    const p = sim.player, b = sim.ball;
    const tb = bearing(p, b.x, b.y);
    const gb = bearing(p, PITCH_W / 2, 0);          // opponent goal center (+x)
    // committed turning: outside the front sector, keep turning the SAME way
    // bearing convention: tb > 0 = target to the LEFT (counterclockwise)
    let tSol, tSag;
    if (Math.abs(tb) < 1.2) {
      tSol = tb > 0.38; tSag = tb < -0.38;
      sim.sideMem = tb > 0.15 ? 1 : tb < -0.15 ? -1 : (sim.sideMem || 1);
    } else {
      if (sim.sideMem === undefined) sim.sideMem = tb > 0 ? 1 : -1;
      tSol = sim.sideMem > 0; tSag = sim.sideMem < 0;
    }
    const ballDist = Math.hypot(b.x - p.x, b.y - p.y);
    const ogb = bearing(p, -PITCH_W / 2, 0);
    const kkOn = Math.abs(ogb) < 0.55;
    return {
      kkOn,
      tSol, tOn: Math.abs(tb) <= 0.38, tSag,
      kSol: gb > 0.45, kOn: Math.abs(gb) <= 0.45, kSag: gb < -0.45,
      yakin: ballDist < 1.9,
      tb, gb, ballDist,
    };
  }

  // ---- rules -------------------------------------------------------------------
  function motorFraction(m) {
    if (!m || m.dir === 'stop') return 0;
    const f = (m.speed || 0) / 100;
    return m.dir === 'rev' ? -f : f;
  }
  function ruleMatches(rule, bits) {
    const arr = [bits.tSol, bits.tOn, bits.tSag, bits.kSol, bits.kOn, bits.kSag, bits.yakin, bits.kkOn];
    for (let i = 0; i < 8; i++) {
      const c = rule.pattern[i] || 'any';
      if (c === 'any') continue;
      if (c === 'on' && !arr[i]) return false;
      if (c === 'off' && arr[i]) return false;
    }
    return true;
  }
  function evalRules(rules, defaultRule, bits) {
    for (let i = 0; i < rules.length; i++) {
      if (ruleMatches(rules[i], bits)) {
        return { mL: motorFraction(rules[i].left), mR: motorFraction(rules[i].right), ruleIndex: i };
      }
    }
    return { mL: motorFraction(defaultRule.left), mR: motorFraction(defaultRule.right), ruleIndex: -1 };
  }

  // ---- physics helpers -----------------------------------------------------------
  function stepBody(b, mL, mR, spd, wb, tg, dt) {
    const vL = mL * spd, vR = mR * spd;
    const v = (vL + vR) / 2;
    b.th += ((vR - vL) / wb) * tg * dt;
    b.x += v * Math.cos(b.th) * dt;
    b.y += v * Math.sin(b.th) * dt;
    b.v = v;
    return v;
  }
  function clampRobot(r) {
    r.x = Math.max(-PITCH_W / 2 + ROBOT_R, Math.min(PITCH_W / 2 - ROBOT_R, r.x));
    r.y = Math.max(-PITCH_H / 2 + ROBOT_R, Math.min(PITCH_H / 2 - ROBOT_R, r.y));
  }

  // ---- sim -----------------------------------------------------------------------
  function createSim(cfg) {
    const opp = cfg.opponent;
    return {
      cfg, opp, t: 0, status: 'running', reason: null,
      player: { x: -3.2, y: 0, th: 0, v: 0 },   // kickoff is yours
      enemy: { x: 5.4, y: 0, th: Math.PI, v: 0 },
      ball: { x: 0, y: 0, vx: 0, vy: 0 },
      pidPrev: 0, eF: 0,
      touches: 0, lastTouch: 0, enemyTouches: 0, resets: 0, watch: { x: 0, y: 0, t: 0 },
      score: { p: 0, e: 0 },
      trail: [], ballTrail: [], totalTicks: 0, last: null,
    };
  }

  function enemyBrain(sim, dt) {
    const o = sim.opp, e = sim.enemy, b = sim.ball;
    if (sim.t < o.delay || sim.t < (sim.freezeUntil || 0)) return { mL: 0, mR: 0 };
    if (sim.nextThink === undefined) sim.nextThink = 0;
    if (sim.t < sim.nextThink && sim.eCmd) return sim.eCmd;   // reaction time: keep last command
    sim.nextThink = sim.t + (o.react || 0.8);
    // target: ball, pulled toward own goal (defense) when ball on their half
    let tx = b.x, ty = b.y;
    const ownGoalX = PITCH_W / 2;
    if (o.def > 0 && b.x < 1) { // ball on player's half: drop back
      tx = b.x * (1 - o.def) + ownGoalX * 0.55 * o.def;
      ty = b.y * (1 - o.def * 0.6);
    }
    // if close to ball, aim THROUGH it toward the player's goal (dribble/shot line)
    const bd = Math.hypot(b.x - e.x, b.y - e.y);
    if (bd < 1.6) {
      const gx = -PITCH_W / 2, gy = 0;
      const m = Math.hypot(b.x - gx, b.y - gy) || 1e-9;
      tx = b.x + (b.x - gx) / m * 0.8; ty = b.y + (b.y - gy) / m * 0.8;
    }
    const br = bearing(e, tx, ty);
    const maxM = o.spd / (sim.cfg.enemyVmax || 3.6);
    let turn = Math.max(-1, Math.min(1, -br * 1.4));
    let fwd = Math.abs(br) > 1.3 ? 0.15 : maxM;
    let mL = fwd + turn * (o.trn / 4.4), mR = fwd - turn * (o.trn / 4.4);
    const cap = maxM;
    mL = Math.max(-cap, Math.min(cap, mL)); mR = Math.max(-cap, Math.min(cap, mR));
    sim.eCmd = { mL, mR };
    return sim.eCmd;
  }

  function playerBrain(sim, bits, dt) {
    const mode = sim.cfg.mode || 'rules';
    if (mode === 'pid') {
      const pid = sim.cfg.pid || defaultPID();
      const base = (pid.base || 0) / 100;
      // two-state striker: far from ball -> chase; near ball -> steer ball line to goal
      let target;
      if (bits.ballDist > 0.8) {
        // approach a point slightly BEHIND the ball (between ball and own goal side)
        const b = sim.ball;
        const gx = PITCH_W / 2;
        const m = Math.hypot(gx - b.x, -b.y) || 1e-9;
        target = { x: b.x - (gx - b.x) / m * 0.85, y: b.y - (0 - b.y) / m * 0.85 };
      } else {
        target = { x: PITCH_W / 2, y: 0 };
      }
      const e = -bearing(sim.player, target.x, target.y); // + = target on the right
      sim.eF = sim.eF * 0.7 + e * 0.3;
      let dErr = (sim.eF - sim.pidPrev) / dt;
      if (dErr > 3) dErr = 3; else if (dErr < -3) dErr = -3;
      sim.pidPrev = sim.eF;
      let turn = (pid.kp || 0) * e + (pid.kd || 0) * dErr;
      if (turn > 1) turn = 1; else if (turn < -1) turn = -1;
      const fwd = Math.abs(e) > 1.4 ? base * 0.25 : base;
      return { mL: Math.max(-1, Math.min(1, fwd + turn)), mR: Math.max(-1, Math.min(1, fwd - turn)), ruleIndex: null };
    }
    return evalRules(sim.cfg.rules, sim.cfg.defaultRule, bits);
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return sim.last;
    const params = sim.cfg.params;
    const bits = senseBits(sim);

    const pcmd = playerBrain(sim, bits, dt);
    const ecmd = enemyBrain(sim, dt);

    stepBody(sim.player, pcmd.mL, pcmd.mR, params.vMax, params.wheelBase, params.turnGain || 1, dt);
    stepBody(sim.enemy, ecmd.mL, ecmd.mR, sim.cfg.enemyVmax || 3.6, 1.1, 1.1, dt);
    clampRobot(sim.player); clampRobot(sim.enemy);

    // robot-robot collision (push apart)
    {
      const dx = sim.enemy.x - sim.player.x, dy = sim.enemy.y - sim.player.y;
      const d = Math.hypot(dx, dy);
      if (d < ROBOT_R * 2 && d > 1e-6) {
        const push = (ROBOT_R * 2 - d) / 2;
        const nx = dx / d, ny = dy / d;
        sim.player.x -= nx * push; sim.player.y -= ny * push;
        sim.enemy.x += nx * push; sim.enemy.y += ny * push;
      }
    }

    // ball physics
    const B = sim.ball;
    B.x += B.vx * dt; B.y += B.vy * dt;
    const sp = Math.hypot(B.vx, B.vy);
    if (sp > 0) {
      const ns = Math.max(0, sp - BALL_FRICTION * dt);
      B.vx *= ns / sp; B.vy *= ns / sp;
    }
    // walls (except goal mouths)
    const gy = GOAL_W / 2;
    if (B.y > PITCH_H / 2 - BALL_R) { B.y = PITCH_H / 2 - BALL_R; B.vy = -Math.abs(B.vy) * WALL_REST; }
    if (B.y < -PITCH_H / 2 + BALL_R) { B.y = -PITCH_H / 2 + BALL_R; B.vy = Math.abs(B.vy) * WALL_REST; }
    if (B.x > PITCH_W / 2 - BALL_R && Math.abs(B.y) > gy) { B.x = PITCH_W / 2 - BALL_R; B.vx = -Math.abs(B.vx) * WALL_REST; }
    if (B.x < -PITCH_W / 2 + BALL_R && Math.abs(B.y) > gy) { B.x = -PITCH_W / 2 + BALL_R; B.vx = Math.abs(B.vx) * WALL_REST; }
    // corner cuts (bumpers) — the ball can't be pinned in a corner
    for (const [cxs, cys] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const ccx = cxs * PITCH_W / 2, ccy = cys * PITCH_H / 2;
      const dcx = B.x - ccx, dcy = B.y - ccy;
      const dd = Math.hypot(dcx, dcy);
      if (dd < 1.5) {
        const nx = dcx / (dd || 1e-9), ny = dcy / (dd || 1e-9);
        B.x = ccx + nx * 1.5; B.y = ccy + ny * 1.5;
        const vn = B.vx * nx + B.vy * ny;
        if (vn < 0) { B.vx -= 1.6 * vn * nx; B.vy -= 1.6 * vn * ny; }
        if (Math.abs(B.vx) + Math.abs(B.vy) < 0.4) { B.vx = nx * 0.9; B.vy = ny * 0.9; }
      }
    }

    // robot-ball kicks
    [ [sim.player, true], [sim.enemy, false] ].forEach(([r, isPlayer]) => {
      const dx = B.x - r.x, dy = B.y - r.y;
      const d = Math.hypot(dx, dy);
      if (d < ROBOT_R + BALL_R + 0.05 && d > 1e-6) {
        const nx = dx / d, ny = dy / d;
        // separate
        B.x = r.x + nx * (ROBOT_R + BALL_R + 0.06);
        B.y = r.y + ny * (ROBOT_R + BALL_R + 0.06);
        // kick direction: contact normal blended with robot heading (dribble physics)
        const hx = Math.cos(r.th), hy = Math.sin(r.th);
        let kx = nx * 0.45 + hx * 0.9, ky = ny * 0.45 + hy * 0.9;
        const km = Math.hypot(kx, ky) || 1e-9; kx /= km; ky /= km;
        const rs = Math.max(Math.abs(r.v || 0), 0.4);
        const kick = Math.max(KICK_MIN, rs * 1.05 + 0.25);
        B.vx = kx * kick; B.vy = ky * kick;
        if (isPlayer) { sim.touches++; sim.lastTouch = sim.t; } else sim.enemyTouches++;
      }
    });

    // enemy shot: close to ball and roughly aligned with the player's goal line
    {
      const e = sim.enemy, o = sim.opp;
      const bd = Math.hypot(B.x - e.x, B.y - e.y);
      if (sim.t > o.delay && bd < 0.95) {
        const ga = Math.atan2(0 - B.y, -PITCH_W / 2 - B.x);
        // shot is blocked if the player stands on the line ball -> goal
        const p = sim.player;
        const gx2 = -PITCH_W / 2, gy2 = 0;
        const abx = gx2 - B.x, aby = gy2 - B.y;
        const ab2 = abx * abx + aby * aby || 1e-9;
        let tt = ((p.x - B.x) * abx + (p.y - B.y) * aby) / ab2;
        tt = Math.max(0, Math.min(1, tt));
        const blockDist = Math.hypot(p.x - (B.x + abx * tt), p.y - (B.y + aby * tt));
        if (blockDist > 1.05 && Math.abs(wrapA(ga - e.th)) < 0.26) {
          B.vx = Math.cos(ga) * ((o.shot || 3.5) - 0.6); B.vy = Math.sin(ga) * ((o.shot || 3.5) - 0.6);
        }
      }
    }
    // referee: lack of progress -> ball to a neutral point
    {
      if (Math.hypot(B.x - sim.watch.x, B.y - sim.watch.y) > 0.7) {
        sim.watch = { x: B.x, y: B.y, t: sim.t };
      } else if (sim.t - sim.watch.t > 3) {
        const NEUTRAL = [[0, 0], [-3.8, 2.2], [-3.8, -2.2], [3.8, 2.2], [3.8, -2.2]];
        let pick = NEUTRAL[0];
        for (const n of NEUTRAL) {
          const dp = Math.hypot(n[0] - sim.player.x, n[1] - sim.player.y);
          const de = Math.hypot(n[0] - sim.enemy.x, n[1] - sim.enemy.y);
          if (dp > 1.2 && de > 1.2) { pick = n; break; }
        }
        B.x = pick[0]; B.y = pick[1]; B.vx = 0; B.vy = 0;
        sim.resets++; sim.watch = { x: B.x, y: B.y, t: sim.t };
        sim.freezeUntil = sim.t + Math.max(0.5, (sim.opp.delay || 0.5) * 0.6);
      }
    }

    sim.t += dt; sim.totalTicks++;

    // attack drill scoring: only YOUR goals count; own end = referee reset (gol sayılmaz)
    const scored = (B.x > PITCH_W / 2 + BALL_R * 0.5 && Math.abs(B.y) <= gy) ? 'p'
                 : (B.x < -PITCH_W / 2 - BALL_R * 0.5 && Math.abs(B.y) <= gy) ? 'e' : null;
    if (scored) {
      sim.events = sim.events || [];
      if (scored === 'p') { sim.score.p++; sim.events.push({ t: sim.t, type: 'goal' }); }
      else { sim.score.e++; sim.events.push({ t: sim.t, type: 'kacirdin' }); }
      // kickoff reset (kickoff is always yours)
      sim.player.x = -3.2; sim.player.y = 0; sim.player.th = 0;
      sim.enemy.x = 5.4; sim.enemy.y = 0; sim.enemy.th = Math.PI;
      B.x = 0; B.y = 0; B.vx = 0; B.vy = 0;
      sim.watch = { x: 0, y: 0, t: sim.t };
      sim.freezeUntil = sim.t + (sim.opp.delay || 0.5);
      sim.eCmd = null; sim.nextThink = sim.t;
      if (sim.score.p >= (sim.opp.goals || 1)) { sim.status = 'success'; sim.reason = 'win'; }
    }
    if (sim.status === 'running' && sim.t > (sim.opp.time || 90)) {
      sim.status = 'failed'; sim.reason = 'timeout';
    }

    if (sim.totalTicks % 3 === 0) {
      sim.trail.push([sim.player.x, sim.player.y]);
      sim.ballTrail.push([B.x, B.y]);
      if (sim.trail.length > 3000) { sim.trail.shift(); sim.ballTrail.shift(); }
    }

    sim.last = { bits, pcmd, ecmd, ball: { x: B.x, y: B.y } };
    return sim.last;
  }

  function coach(sim) {
    const tips = [];
    const mode = sim.cfg.mode || 'pid';
    if (sim.reason === 'timeout') {
      if (mode === 'rules') {
        tips.push('Kural modunda açık sahada top sürmek çok zordur — kesikli kararlar topu savurur. 📈 PID moduna geç: sürekli yönelme kontrolü top sürmeyi kararlı yapar (futbol robotlarının gerçek dersi budur).');
        if (sim.score.e > 2) tips.push('Top ' + sim.score.e + ' kez kendi yarı sahanın dibine gitti. Kendi kalene doğru asla sürme — KENDİ-KALE çipli koruma kuralını en üstte tut.');
      } else {
        if (sim.score.p > 0) tips.push('Gol geldi ama hedefe yetmedi. Temel Hız\'ı artır — topa rakipten önce ulaşan kazanır.');
        else if (sim.touches < 5) tips.push('Robot topa neredeyse hiç ulaşamadı. Temel Hız\'ı ve Kp\'yi artır.');
        else tips.push('Top kontrolü var ama bitiricilik yok. Kp\'yi biraz düşürüp Kd ekle — topa daha az zikzakla yaklaşırsın.');
      }
    }
    if (sim.status === 'success') {
      const T = sim.opp.time || 90;
      if (sim.t < T * 0.3) tips.push('Yıldırım gol! Daha güçlü rakiplerde de bu hızı koru.');
      else tips.push('Gol! Daha erken gol için topa rakipten önce ulaşmak kritik — hızlı bir robot kur.');
    }
    return tips;
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const T = sim.opp.time || 90, t = sim.t;
    if (t < T * 0.25) return { key: 'gol_makinesi', name: '🏆 Gol Makinesi', cmt: 'Rakip daha ne olduğunu anlamadan top ağlarda.' };
    if (t < T * 0.5) return { key: 'forvet', name: '🥇 Forvet', cmt: 'Temiz hücum, sağlam bitiriş.' };
    if (t < T * 0.75) return { key: 'orta_saha', name: '🧭 Orta Saha', cmt: 'Gol geldi! Daha erken bitirmek için top sürüşünü geliştir.' };
    return { key: 'caylak_forvet', name: '🎓 Çaylak Forvet', cmt: 'Kazandın — şimdi daha hızlı gol atmayı dene.' };
  }

  function runHeadless(cfg, maxTime, dt) {
    dt = dt || 1 / 60;
    const sim = createSim(cfg);
    const mt = maxTime || (cfg.opponent.time || 90) + 5;
    let g = 0;
    while (sim.status === 'running' && sim.t < mt && g++ < 2e6) tickSim(sim, dt);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(2),
      touches: sim.touches, enemyTouches: sim.enemyTouches, resets: sim.resets,
      score: sim.score.p + '-' + sim.score.e };
  }

  // ---- starters ------------------------------------------------------------------
  function starterRules() {
    return [
      // TEHLİKE: top yakın + kendi kalen önünde -> topu itme, yandan dolan!
      { pattern: ['any', 'any', 'any', 'any', 'any', 'any', 'on', 'on'], left: { dir: 'rev', speed: 35 }, right: { dir: 'fwd', speed: 88 } },
      // ball ahead & NEAR, goal ahead: full-power shot run
      { pattern: ['off', 'on', 'off', 'any', 'on', 'any', 'on'], left: { dir: 'fwd', speed: 95 }, right: { dir: 'fwd', speed: 95 } },
      // ball ahead & NEAR, goal to a side: dribble with a curve toward the goal
      { pattern: ['off', 'on', 'off', 'on', 'off', 'any', 'on'], left: { dir: 'fwd', speed: 45 }, right: { dir: 'fwd', speed: 92 } },
      { pattern: ['off', 'on', 'off', 'any', 'off', 'on', 'on'], left: { dir: 'fwd', speed: 92 }, right: { dir: 'fwd', speed: 45 } },
      // ball ahead but FAR: sprint straight at it
      { pattern: ['off', 'on', 'off', 'any', 'any', 'any', 'off'], left: { dir: 'fwd', speed: 92 }, right: { dir: 'fwd', speed: 92 } },
      // ball to a side: turn toward it
      { pattern: ['on', 'off', 'any', 'any', 'any', 'any', 'any'], left: { dir: 'fwd', speed: 20 }, right: { dir: 'fwd', speed: 85 } },
      { pattern: ['any', 'off', 'on', 'any', 'any', 'any', 'any'], left: { dir: 'fwd', speed: 85 }, right: { dir: 'fwd', speed: 20 } },
    ];
  }
  function starterDefault() { return { left: { dir: 'fwd', speed: 55 }, right: { dir: 'rev', speed: 25 } }; } // search spin
  function defaultParams() { return { vMax: 3.6, wheelBase: 1.1, turnGain: 1.0 }; }
  function defaultPID() { return { base: 78, kp: 1.6, kd: 0.35 }; }

  const API = {
    PITCH_W, PITCH_H, GOAL_W, BALL_R, ROBOT_R,
    OPPONENTS, bearing, senseBits, evalRules, ruleMatches, motorFraction,
    createSim, tickSim, coach, robotClass, runHeadless,
    starterRules, starterDefault, defaultParams, defaultPID,
  };
  global.SoccerCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
