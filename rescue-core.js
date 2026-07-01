/* =============================================================================
 * RoboForge — Kurtarma Hattı (Rescue Line) :: Simulation Core
 * -----------------------------------------------------------------------------
 * Pure, dependency-free. Browser (window.RescueCore) + Node (module.exports).
 * Open (point-to-point) line course with: gaps, green junction markers,
 * obstacles on the line, and a rescue zone at the end.
 *
 * Sensors (fixed roles):
 *   0 SOL   line sensor (fwd 0.95, right -0.40)
 *   1 ORTA  line sensor (fwd 1.00, right  0.00)
 *   2 SAĞ   line sensor (fwd 0.95, right  0.40)
 *   3 ENGEL front distance (boolean: obstacle ahead < OBST_SENSE)
 *   4 YSOL  green marker under left  (boolean)
 *   5 YSAĞ  green marker under right (boolean)
 * Extra readable memory state (the one small memory a real robot has):
 *   lastSeen: 'L' | 'C' | 'R'  — which side the line was last seen on.
 *   Rules may condition on it via pattern[6]: 'L'|'C'|'R'|'any'.
 * ========================================================================== */
(function (global) {
  'use strict';

  const LINE_HALF_WIDTH = 0.38;
  const OFF_TRACK_DIST = 3.2;     // generous: detours legitimately leave the line
  const LINE_LOST_GRACE = 3.8;    // long enough for a detour arc
  const STALL_GRACE = 3.5;
  const ON_LINE_TIGHT = 0.55;
  const OBST_R = 0.5;             // obstacle (box) half-size
  const ROBOT_R = 0.45;
  const OBST_SENSE = 1.6;        // front sensor trigger distance (from robot front)
  const OBST_HIDE = 0.95;         // line is hidden this close to an obstacle
  const GREEN_R = 1.0;            // marker detection radius
  const ASSIST_TIME = 0.8;        // PID green-assist turn duration
  const END_PROG = 0.975;         // reaching this progress = rescued

  // ---- geometry helpers ------------------------------------------------------
  function cardinalPoint(p0, p1, p2, p3, t, s) {
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const m1x = s * (p2[0] - p0[0]), m1y = s * (p2[1] - p0[1]);
    const m2x = s * (p3[0] - p1[0]), m2y = s * (p3[1] - p1[1]);
    return [h00 * p1[0] + h10 * m1x + h01 * p2[0] + h11 * m2x,
            h00 * p1[1] + h10 * m1y + h01 * p2[1] + h11 * m2y];
  }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  // Open polyline path (Catmull-Rom, ends clamped)
  function buildPath(points, tension, subdiv) {
    subdiv = subdiv || 40;
    const P = points, n = P.length, samples = [];
    for (let i = 0; i < n - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n - 1, i + 2)];
      for (let j = 0; j < subdiv; j++) samples.push(cardinalPoint(p0, p1, p2, p3, j / subdiv, tension));
    }
    samples.push(P[n - 1].slice());
    let len = 0; const cum = [0];
    for (let i = 1; i < samples.length; i++) { len += dist(samples[i - 1], samples[i]); cum.push(len); }
    return { samples, cum, length: len };
  }

  function nearestOnPath(path, x, y) {
    const s = path.samples, N = s.length;
    let best = Infinity, bestI = 0, bestT = 0;
    for (let i = 0; i < N - 1; i++) {
      const a = s[i], b = s[i + 1];
      const abx = b[0] - a[0], aby = b[1] - a[1];
      const ab2 = abx * abx + aby * aby || 1e-9;
      let t = ((x - a[0]) * abx + (y - a[1]) * aby) / ab2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const d = Math.hypot(x - (a[0] + abx * t), y - (a[1] + aby * t));
      if (d < best) { best = d; bestI = i; bestT = t; }
    }
    return { dist: best, progress: (bestI + bestT) / (N - 1) };
  }
  function pointAt(path, prog) {
    const s = path.samples, N = s.length;
    const f = Math.max(0, Math.min(1, prog)) * (N - 1);
    const i = Math.min(N - 2, Math.floor(f)), t = f - i;
    return [s[i][0] + (s[i + 1][0] - s[i][0]) * t, s[i][1] + (s[i + 1][1] - s[i][1]) * t];
  }
  function tangentAt(path, prog) {
    const a = pointAt(path, Math.max(0, prog - 0.005)), b = pointAt(path, Math.min(1, prog + 0.005));
    const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1e-9;
    return [dx / m, dy / m];
  }

  // ---- Courses (7-level ladder) ----------------------------------------------
  // junctions: {pt:[x,y], side:'L'|'R'}  — marker on the turn side; stub = straight-on dead end
  // obstacles: {prog}                    — box centered on the line at that progress
  // gaps:      [[startProg,endProg]]     — line absent
  const COURSES = [
    { id: 'patika', name: 'Sakin Patika', difficulty: 'Başlangıç', time: 50, tension: 0.45,
      points: [[-8, -6], [-3, -5], [2, -6], [6, -3], [4, 1], [-1, 2], [-5, 4], [-1, 6], [4, 6], [8, 6]] },
    { id: 'kesik', name: 'Kesik Yol', difficulty: 'Başlangıç', time: 55, tension: 0.45,
      points: [[-8, -5], [-4, -5], [2, -5], [7, -4], [8, 0], [6, 4], [0, 5], [-5, 5], [-8, 5]],
      gaps: [[0.155, 0.185], [0.825, 0.85]] },
    { id: 'yesil', name: 'Yeşil Dönüş', difficulty: 'Orta', time: 60, tension: 0.1,
      points: [[-8, -6], [-2, -6], [-2, 0], [4, 0], [4, 6], [8, 6]],
      junctions: [{ pt: [-2, -6], side: 'L' }, { pt: [-2, 0], side: 'R' }],
      stubs: [[[-2, -6], [1.2, -6]], [[-2, 0], [-2, 3.2]]] },
    { id: 'karma', name: 'Kavşak Karmaşası', difficulty: 'Orta', time: 70, tension: 0.1,
      points: [[-8, -6], [-3, -6], [-3, -1], [2, -1], [2, -6], [7, -6], [7, 0], [2, 3], [2, 6], [8, 6]],
      junctions: [{ pt: [-3, -6], side: 'L' }, { pt: [-3, -1], side: 'R' }, { pt: [2, -1], side: 'R' }],
      stubs: [[[-3, -6], [0.2, -6]], [[-3, -1], [-3, 2.2]], [[2, -1], [5.2, -1]]],
      gaps: [[0.045, 0.065]] },
    { id: 'engelli', name: 'Yol Kapalı', difficulty: 'İleri', time: 60, tension: 0.3,
      points: [[-8, -6], [-2, -6], [4, -6], [7, -3], [7, 2], [4, 5], [-2, 5], [-8, 5]],
      obstacles: [{ prog: 0.24 }, { prog: 0.88 }] },
    { id: 'tam', name: 'Tam Görev', difficulty: 'İleri', time: 75, tension: 0.1,
      points: [[-8, -6], [-2, -6], [-2, 0], [5, 0], [5, 9], [8, 9]],
      junctions: [{ pt: [-2, -6], side: 'L' }, { pt: [-2, 0], side: 'R' }],
      stubs: [[[-2, -6], [1.2, -6]], [[-2, 0], [-2, 3.2]]],
      gaps: [[0.50, 0.525]],
      obstacles: [{ prog: 0.72 }] },
    { id: 'kabus', name: 'Kâbus Kurtarma', difficulty: 'Uzman', time: 90, tension: 0.1,
      points: [[-8, -7], [-3, -7], [-3, -2], [2, -2], [2, -7], [7, -7], [7, -1], [3, 2], [3, 4.5], [-4, 4.5], [-4, 8], [8, 8]],
      junctions: [{ pt: [-3, -7], side: 'L' }, { pt: [-3, -2], side: 'R' }, { pt: [2, -2], side: 'R' }, { pt: [3, 4.5], side: 'L' }],
      stubs: [[[-3, -7], [0.2, -7]], [[-3, -2], [-3, 1.2]], [[2, -2], [5.2, -2]], [[3, 4.5], [3, 7.5]]],
      gaps: [[0.04, 0.06]],
      obstacles: [{ prog: 0.55 }, { prog: 0.90 }] },
  ];

  // ---- world build ------------------------------------------------------------
  function buildCourse(meta, subdiv) {
    const path = buildPath(meta.points, meta.tension, subdiv || 40);
    const stubs = (meta.stubs || []).map((pts) => buildPath(pts, 0, 8));
    const junctions = (meta.junctions || []).map((j) => {
      const nr = nearestOnPath(path, j.pt[0], j.pt[1]);
      const t = tangentAt(path, Math.max(0, nr.progress - 0.02));
      const leftN = [-t[1], t[0]];
      const s = j.side === 'L' ? 1 : -1;
      return { prog: nr.progress, side: j.side,
        marker: [j.pt[0] + leftN[0] * 0.9 * s, j.pt[1] + leftN[1] * 0.9 * s] };
    });
    const obstacles = (meta.obstacles || []).map((o) => {
      const p = pointAt(path, o.prog);
      return { prog: o.prog, x: p[0], y: p[1] };
    });
    return { meta, path, stubs, junctions, obstacles,
      gaps: (meta.gaps || []).map((g) => g.slice()),
      start: pointAt(path, 0), end: pointAt(path, 1) };
  }
  function inGap(course, progress) {
    for (let i = 0; i < course.gaps.length; i++) {
      if (progress >= course.gaps[i][0] && progress < course.gaps[i][1]) return true;
    }
    return false;
  }

  // ---- robot & sensors ---------------------------------------------------------
  const LINE_SENSORS = [
    { id: 's1', label: 'SOL', color: '#22c55e', fwd: 0.95, right: -0.40 },
    { id: 's2', label: 'ORTA', color: '#38bdf8', fwd: 1.00, right: 0.00 },
    { id: 's3', label: 'SAĞ', color: '#f59e0b', fwd: 0.95, right: 0.40 },
  ];
  const GREEN_SENSORS = [{ fwd: 0.55, right: -0.5 }, { fwd: 0.55, right: 0.5 }];

  function sensorWorld(robot, s) {
    const c = Math.cos(robot.th), sn = Math.sin(robot.th);
    return { x: robot.x + s.fwd * c + s.right * sn, y: robot.y + s.fwd * sn + s.right * (-c) };
  }
  function lineDistAt(course, x, y) {
    // VISIBLE line distance: respects gaps and obstacle cover
    const nr = nearestOnPath(course.path, x, y);
    let d = inGap(course, nr.progress) ? Infinity : nr.dist;
    for (let i = 0; i < course.stubs.length; i++) {
      const ds = nearestOnPath(course.stubs[i], x, y).dist;
      if (ds < d) d = ds;
    }
    for (let i = 0; i < course.obstacles.length; i++) {
      const o = course.obstacles[i];
      if (Math.hypot(x - o.x, y - o.y) < OBST_HIDE) return Infinity; // covered
    }
    return d;
  }
  function geoDistAt(course, x, y) {
    // GEOMETRIC distance to the course (ignores gaps/cover) — for off-track checks
    let d = nearestOnPath(course.path, x, y).dist;
    for (let i = 0; i < course.stubs.length; i++) {
      const ds = nearestOnPath(course.stubs[i], x, y).dist;
      if (ds < d) d = ds;
    }
    return d;
  }
  function readLine(robot, course) {
    return LINE_SENSORS.map((s) => {
      const w = sensorWorld(robot, s);
      return lineDistAt(course, w.x, w.y) <= LINE_HALF_WIDTH;
    });
  }
  function readLineAnalog(robot, course) {
    return LINE_SENSORS.map((s) => {
      const w = sensorWorld(robot, s);
      const d = lineDistAt(course, w.x, w.y);
      if (d <= LINE_HALF_WIDTH) return 1;
      if (d >= LINE_HALF_WIDTH + 0.4) return 0;
      return 1 - (d - LINE_HALF_WIDTH) / 0.4;
    });
  }
  function readGreen(robot, course) {
    // marker within range AND clearly on one side of the robot (robot frame)
    const c = Math.cos(robot.th), sn = Math.sin(robot.th);
    let L = false, R = false;
    for (let i = 0; i < course.junctions.length; i++) {
      const m = course.junctions[i].marker;
      const dx = m[0] - robot.x, dy = m[1] - robot.y;
      if (Math.hypot(dx, dy) > GREEN_R + 0.55) continue;
      const fwdC = dx * c + dy * sn;             // ahead of the rear axle
      const rightC = dx * sn - dy * c;           // + = robot's right
      if (fwdC < -0.2) continue;
      if (rightC < -0.12) L = true; else if (rightC > 0.12) R = true;
    }
    return [L, R];
  }
  function readObstacle(robot, course) {
    const c = Math.cos(robot.th), sn = Math.sin(robot.th);
    const fx = robot.x + 0.55 * c, fy = robot.y + 0.55 * sn;
    let best = Infinity;
    for (let i = 0; i < course.obstacles.length; i++) {
      const o = course.obstacles[i];
      const dx = o.x - fx, dy = o.y - fy;
      const d = Math.hypot(dx, dy) - OBST_R;
      const ahead = (dx * c + dy * sn) / (Math.hypot(dx, dy) || 1e-9);
      if (ahead > 0.05 && d < best) best = d;
    }
    return best; // Infinity if none ahead
  }

  // ---- rules -------------------------------------------------------------------
  // pattern = [s1,s2,s3,engel,ysol,ysag,lastSeen]
  //   s*/engel/ysol/ysag: 'on'|'off'|'any' ; lastSeen: 'L'|'C'|'R'|'any'
  function motorFraction(m) {
    if (!m || m.dir === 'stop') return 0;
    const f = (m.speed || 0) / 100;
    return m.dir === 'rev' ? -f : f;
  }
  function ruleMatches(rule, st) {
    const p = rule.pattern;
    for (let i = 0; i < 6; i++) {
      const c = p[i] || 'any';
      if (c === 'any') continue;
      if (c === 'on' && !st.bits[i]) return false;
      if (c === 'off' && st.bits[i]) return false;
    }
    const ls = p[6] || 'any';
    if (ls !== 'any' && ls !== st.lastSeen) return false;
    return true;
  }
  function evalRules(rules, defaultRule, st) {
    for (let i = 0; i < rules.length; i++) {
      if (ruleMatches(rules[i], st)) {
        return { mL: motorFraction(rules[i].left), mR: motorFraction(rules[i].right), ruleIndex: i };
      }
    }
    return { mL: motorFraction(defaultRule.left), mR: motorFraction(defaultRule.right), ruleIndex: -1 };
  }

  // ---- sim ----------------------------------------------------------------------
  function makeRobot(course) {
    const a = course.path.samples[0], b = course.path.samples[2];
    return { x: a[0], y: a[1], th: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }
  function stepRobot(robot, mL, mR, params, dt) {
    const vL = mL * params.vMax, vR = mR * params.vMax;
    const v = (vL + vR) / 2;
    robot.th += ((vR - vL) / params.wheelBase) * (params.turnGain || 1) * dt;
    robot.x += v * Math.cos(robot.th) * dt;
    robot.y += v * Math.sin(robot.th) * dt;
    return v;
  }

  function createSim(cfg) {
    const course = cfg.course;
    return {
      cfg, course, robot: makeRobot(course), t: 0,
      status: 'running', reason: null,
      timeOffLine: 0, timeStalled: 0, onLineTicks: 0, totalTicks: 0, backT: 0,
      maxProg: 0, curProg: 0, lastSeen: 'C',
      pidPrev: 0, pidInt: 0, eF: 0, assistT: 0, assistDir: 0, assistCool: 0, assistTh: 0,
      avoidPhase: 0, avoidT: 0, avoidDir: (cfg.pid && cfg.pid.avoidDir === 'L') ? 1 : -1,
      trail: [], last: null,
    };
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return sim.last;
    const { course, params } = sim.cfg;
    const mode = sim.cfg.mode || 'rules';
    const robot = sim.robot;

    const lineB = readLine(robot, course);
    const green = readGreen(robot, course);
    const obstD = readObstacle(robot, course);
    const engel = obstD < OBST_SENSE;

    // lastSeen memory
    if (lineB[0] && !lineB[2]) sim.lastSeen = 'L';
    else if (lineB[2] && !lineB[0]) sim.lastSeen = 'R';
    else if (lineB[1]) sim.lastSeen = 'C';

    let cmd, error = null, readings = null;
    if (mode === 'pid') {
      const pid = sim.cfg.pid || defaultPID();
      readings = readLineAnalog(robot, course);
      // obstacle maneuver state machine (built-in for PID mode; direction = student's pick)
      if (sim.avoidPhase === 0 && engel) { sim.avoidPhase = 1; sim.avoidT = 0; }
      if (sim.avoidPhase === 1) { // rotate away
        sim.avoidT += dt;
        cmd = { mL: -0.55 * sim.avoidDir, mR: 0.55 * sim.avoidDir };
        if (sim.avoidT > 0.5) { sim.avoidPhase = 2; sim.avoidT = 0; }
      } else if (sim.avoidPhase === 2) { // wide arc back toward the line
        sim.avoidT += dt;
        const inner = 0.42, outer = 0.75;
        cmd = sim.avoidDir < 0 ? { mL: inner, mR: outer } : { mL: outer, mR: inner };
        const anyOn = lineB.some(Boolean);
        if ((sim.avoidT > 0.6 && anyOn) || sim.avoidT > 3.4) sim.avoidPhase = 0;
      }
      if (!cmd) {
        // green assist: strong committed turn toward the marker side
        sim.assistCool -= dt;
        if (sim.assistT <= 0 && sim.assistCool <= 0 && (green[0] || green[1])) {
          sim.assistT = 1.4; sim.assistCool = 2.2; sim.assistDir = green[0] ? 1 : -1;
          sim.assistTh = robot.th + sim.assistDir * 1.35;   // ~90° committed turn
        }
        if (sim.assistT > 0) {
          sim.assistT -= dt;
          cmd = sim.assistDir > 0 ? { mL: 0.08, mR: 0.62 } : { mL: 0.62, mR: 0.08 };
          const rem = (sim.assistTh - robot.th) * sim.assistDir;
          if (rem <= 0.15) sim.assistT = 0;                 // turn complete
        } else {
          let num = 0, den = 0;
          for (let i = 0; i < 3; i++) { num += readings[i] * LINE_SENSORS[i].right; den += readings[i]; }
          const base = (pid.base || 0) / 100;
          let turn;
          if (den < 0.05) {
            const e = (sim.lastSeen === 'L' ? -0.2 : sim.lastSeen === 'R' ? 0.2 : 0);
            turn = (pid.kp || 0) * e; error = e;
          } else {
            const e = num / den;
            sim.eF = sim.eF * 0.7 + e * 0.3;      // smoothed error for D
            let dErr = (sim.eF - sim.pidPrev) / dt;
            if (dErr > 2.5) dErr = 2.5; else if (dErr < -2.5) dErr = -2.5;
            sim.pidPrev = sim.eF; error = e;
            turn = (pid.kp || 0) * e + (pid.kd || 0) * dErr;
          }
          if (turn > 1) turn = 1; else if (turn < -1) turn = -1;
          cmd = { mL: Math.max(-1, Math.min(1, base + turn)), mR: Math.max(-1, Math.min(1, base - turn)) };
        }
      }
    } else {
      const st = { bits: [lineB[0], lineB[1], lineB[2], engel, green[0], green[1]], lastSeen: sim.lastSeen };
      cmd = evalRules(sim.cfg.rules, sim.cfg.defaultRule, st);
    }

    const v = stepRobot(robot, cmd.mL, cmd.mR, params, dt);
    sim.t += dt; sim.totalTicks++;

    // crash into obstacle
    for (let i = 0; i < course.obstacles.length; i++) {
      const o = course.obstacles[i];
      if (Math.hypot(robot.x - o.x, robot.y - o.y) < OBST_R + ROBOT_R) {
        sim.status = 'failed'; sim.reason = 'crash';
      }
    }

    const nr = nearestOnPath(course.path, robot.x, robot.y);
    if (Math.abs(nr.progress - sim.curProg) < 0.15) sim.curProg = nr.progress;
    if (sim.curProg > sim.maxProg && nr.dist < 1.2) sim.maxProg = sim.curProg;
    if (nr.progress < sim.maxProg - 0.08 && nr.dist < 1.6 && Math.abs(v) > 0.3) sim.backT += dt;
    else if (nr.progress >= sim.maxProg - 0.04) sim.backT = 0;
    if (nr.dist <= ON_LINE_TIGHT) sim.onLineTicks++;

    const anyOn = lineB.some(Boolean);
    sim.timeOffLine = anyOn ? 0 : sim.timeOffLine + ((mode === 'pid' && sim.avoidPhase) ? 0 : dt);
    sim.timeStalled = Math.abs(v) < 0.05 ? sim.timeStalled + dt : 0;

    // detours & stubs legitimately leave the main line — geometric distance to ANY line
    const geoDist = geoDistAt(course, robot.x, robot.y);
    if (sim.status === 'running') {
      if (geoDist > OFF_TRACK_DIST) { sim.status = 'failed'; sim.reason = 'off_track'; }
      else if (sim.timeOffLine > LINE_LOST_GRACE) { sim.status = 'failed'; sim.reason = 'line_lost'; }
      else if (sim.timeStalled > STALL_GRACE) { sim.status = 'failed'; sim.reason = 'stalled'; }
      else if (sim.backT > 2.5) { sim.status = 'failed'; sim.reason = 'wrong_way'; }
      else if (sim.maxProg >= END_PROG) { sim.status = 'success'; sim.reason = 'rescued'; }
      else if (sim.t > (course.meta.time || 60)) { sim.status = 'failed'; sim.reason = 'timeout'; }
    }

    if (sim.totalTicks % 3 === 0) {
      sim.trail.push([robot.x, robot.y]);
      if (sim.trail.length > 500) sim.trail.shift();
    }

    sim.last = { lineB, green, engel, obstD, cmd, v, error, readings, progress: nr.progress, lastSeen: sim.lastSeen };
    return sim.last;
  }

  function accuracy(sim) { return sim.totalTicks ? Math.round((sim.onLineTicks / sim.totalTicks) * 100) : 0; }

  function coach(sim) {
    const tips = [], mode = sim.cfg.mode || 'rules';
    const hasJ = sim.course.junctions.length, hasO = sim.course.obstacles.length, hasG = sim.course.gaps.length;
    if (sim.reason === 'crash') {
      tips.push(mode === 'pid'
        ? 'Robot engele çarptı. Engel manevrası yönünü değiştirmeyi ve Temel Hız\'ı düşürmeyi dene — hızlı gelen robot manevraya vakit bulamaz.'
        : 'Robot engele çarptı. ENGEL: VAR durumu için bir kaçınma kuralı ekle (örn. yerinde sağa dön), sonra kaybolan çizgiyi SON GÖRÜLEN yönünden geri bul.');
    }
    if (sim.reason === 'line_lost' || sim.reason === 'off_track') {
      if (hasJ && sim.maxProg < 0.9) tips.push('Bir kavşakta yanlış yöne gitmiş olabilirsin. Yeşil işaret dönülecek yönü gösterir — "hepsi AÇIK + YEŞİL" durumuna keskin bir dönüş kuralı ekle.');
      if (hasG) tips.push('Kesik çizgide robot boşluğa iyi hizalanmış girmeli. Boşluktan önce hızını dengele; SON GÖRÜLEN: ORTA iken düz devam et.');
      if (hasO) tips.push('Engel manevrasından sonra çizgiyi geri bulmak için SON GÖRÜLEN yönüne doğru kavis çiz (örn. kayıpta SOL ise sola kavis).');
      if (!hasJ && !hasO && !hasG) tips.push('Robot çizgiden çıktı. Viraj kurallarındaki hız farkını artır ya da PID modunda Kp/Kd ayarla.');
    }
    if (sim.reason === 'timeout') tips.push('Süre doldu. Düzlüklerde hızı artır; sadece viraj ve manevralarda yavaşla.');
    if (sim.reason === 'stalled') tips.push('Robot durup kaldı. Hiçbir kural eşleşmeyince çalışacak varsayılan kuralın robotu hareket ettirdiğinden emin ol.');
    if (sim.status === 'success') {
      const acc = accuracy(sim);
      if (acc >= 90) tips.push('Temiz bir kurtarma! Görev süresini kısaltmak için düzlük hızını artırmayı dene.');
      else tips.push('Kurtarma tamam ama rota dalgalıydı. Viraj kurallarını (veya Kp/Kd) ince ayarla.');
    }
    return tips;
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const acc = accuracy(sim), t = sim.t, T = sim.course.meta.time || 60;
    if (acc >= 90 && t < T * 0.55) return { key: 'kurtarma_kahramani', name: '🏆 Kurtarma Kahramanı' };
    if (t < T * 0.7) return { key: 'saha_uzmani', name: '🥇 Saha Uzmanı' };
    if (acc >= 80) return { key: 'gorev_eri', name: '🧭 Görev Eri' };
    return { key: 'caylak_kurtarici', name: '🎓 Çaylak Kurtarıcı' };
  }

  function runHeadless(cfg, maxTime, dt) {
    dt = dt || 1 / 60;
    const sim = createSim(cfg);
    let guard = 0;
    const mt = maxTime || (cfg.course.meta.time || 60) + 5;
    while (sim.status === 'running' && sim.t < mt && guard < 1e6) { tickSim(sim, dt); guard++; }
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(2),
      accuracy: accuracy(sim), maxProg: +sim.maxProg.toFixed(3) };
  }

  // ---- starters -----------------------------------------------------------------
  function starterRules() {
    return [
      { pattern: ['any', 'on', 'any', 'off', 'off', 'off', 'any'], left: { dir: 'fwd', speed: 80 }, right: { dir: 'fwd', speed: 80 } },
      { pattern: ['on', 'off', 'off', 'off', 'any', 'any', 'any'], left: { dir: 'fwd', speed: 30 }, right: { dir: 'fwd', speed: 88 } },
      { pattern: ['off', 'off', 'on', 'off', 'any', 'any', 'any'], left: { dir: 'fwd', speed: 88 }, right: { dir: 'fwd', speed: 30 } },
      // lost line: gentle curve back toward the side it was last seen
      { pattern: ['off', 'off', 'off', 'off', 'any', 'any', 'L'], left: { dir: 'fwd', speed: 48 }, right: { dir: 'fwd', speed: 78 } },
      { pattern: ['off', 'off', 'off', 'off', 'any', 'any', 'R'], left: { dir: 'fwd', speed: 78 }, right: { dir: 'fwd', speed: 48 } },
    ];
  }
  function fullRules() {
    return [
      // obstacle: pivot right in place until it is no longer ahead
      { pattern: ['any', 'any', 'any', 'on', 'any', 'any', 'any'], left: { dir: 'fwd', speed: 70 }, right: { dir: 'rev', speed: 70 } },
      // junction: committed spin toward green
      { pattern: ['any', 'any', 'any', 'off', 'on', 'off', 'any'], left: { dir: 'fwd', speed: 15 }, right: { dir: 'fwd', speed: 90 } },
      { pattern: ['any', 'any', 'any', 'off', 'off', 'on', 'any'], left: { dir: 'fwd', speed: 90 }, right: { dir: 'fwd', speed: 15 } },
      // normal follow
      { pattern: ['any', 'on', 'any', 'off', 'off', 'off', 'any'], left: { dir: 'fwd', speed: 80 }, right: { dir: 'fwd', speed: 80 } },
      { pattern: ['on', 'off', 'off', 'off', 'any', 'any', 'any'], left: { dir: 'fwd', speed: 30 }, right: { dir: 'fwd', speed: 88 } },
      { pattern: ['off', 'off', 'on', 'off', 'any', 'any', 'any'], left: { dir: 'fwd', speed: 88 }, right: { dir: 'fwd', speed: 30 } },
      // lost line: wide curve back toward the side it was last seen
      { pattern: ['off', 'off', 'off', 'off', 'any', 'any', 'L'], left: { dir: 'fwd', speed: 48 }, right: { dir: 'fwd', speed: 78 } },
      { pattern: ['off', 'off', 'off', 'off', 'any', 'any', 'R'], left: { dir: 'fwd', speed: 78 }, right: { dir: 'fwd', speed: 48 } },
    ];
  }
  function starterDefault() { return { left: { dir: 'fwd', speed: 45 }, right: { dir: 'fwd', speed: 45 } }; }
  function defaultParams() { return { vMax: 3.6, wheelBase: 1.1, turnGain: 1.0 }; }
  function defaultPID() { return { base: 55, kp: 1.5, kd: 0.55, avoidDir: 'R' }; }

  const API = {
    LINE_HALF_WIDTH, OFF_TRACK_DIST, OBST_R, GREEN_R, END_PROG,
    COURSES, buildCourse, buildPath, nearestOnPath, pointAt, tangentAt, inGap, lineDistAt, geoDistAt,
    LINE_SENSORS, GREEN_SENSORS, sensorWorld, readLine, readLineAnalog, readGreen, readObstacle,
    evalRules, ruleMatches, motorFraction, makeRobot, stepRobot,
    createSim, tickSim, accuracy, coach, robotClass, runHeadless,
    starterRules, fullRules, starterDefault, defaultParams, defaultPID,
  };
  global.RescueCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
