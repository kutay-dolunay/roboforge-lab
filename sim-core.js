/* =============================================================================
 * RoboForge — Line Follower Lab :: Simulation Core
 * -----------------------------------------------------------------------------
 * Pure, dependency-free simulation logic. Runs in the browser (window.SimCore)
 * and in Node (module.exports) so it can be unit-tested headlessly.
 *
 * Coordinate system (top-down, world units):
 *   +x = right, +y = up (screen), angle th measured from +x (CCW positive).
 *   forwardVec = (cos th, sin th); rightVec = (sin th, -cos th)
 *   A sensor's local placement is (fwd, right).
 * ========================================================================== */
(function (global) {
  'use strict';

  const LINE_HALF_WIDTH = 0.38;
  const OFF_TRACK_DIST = 1.5;
  const LINE_LOST_GRACE = 1.6;
  const STALL_GRACE = 3.5;
  const ON_LINE_TIGHT = 0.55;
  const ANALOG_FALLOFF = 0.40;

  // ---- Tracks ---------------------------------------------------------------
  // Optional per-track challenge fields:
  //   gaps: [[startProg,endProg],...]  line is ABSENT in these progress ranges
  //   dash: {on, off}                  auto-generated dashed line
  // 7-level ladder: Başlangıç ×2, Orta ×2, İleri ×2, Uzman ×1
  const TRACKS = [
    {
      id: 'oval', name: 'Klasik Oval', difficulty: 'Başlangıç',
      points: [[-8, 0], [-4, 8], [4, 8], [8, 0], [4, -8], [-4, -8]],
      tension: 0.5, closed: true,
    },
    {
      id: 'wide', name: 'Geniş Tur', difficulty: 'Başlangıç',
      points: [[-8, -3.5], [-8, 3.5], [-3.5, 8], [3.5, 8], [8, 3.5], [8, -3.5], [3.5, -8], [-3.5, -8]],
      tension: 0.5, closed: true,
    },
    {
      id: 'grid', name: 'Keskin Köşeler', difficulty: 'Orta',
      points: [[-6, -6], [-6, 6], [0, 6], [0, 0], [6, 0], [6, -6]],
      tension: 0.0, closed: true,
    },
    {
      id: 'mix', name: 'Şikan + Kavis', difficulty: 'Orta',
      points: [[-8, -4], [-8, 4], [-4, 6], [0, 2], [4, 6], [8, 4], [8, -4], [0, -8]],
      tension: 0.3, closed: true,
    },
    {
      id: 'hairpin', name: 'Çift Firkete', difficulty: 'İleri',
      points: [[-7, -6], [-7, 6], [-2, 6], [-2, -2], [2, -2], [2, 6], [7, 6], [7, -6]],
      tension: 0.18, closed: true,
    },
    {
      id: 'gapped', name: 'Boşluklu Pist', difficulty: 'İleri',
      points: [[-8, 0], [-4, 8], [4, 8], [8, 0], [4, -8], [-4, -8]],
      tension: 0.5, closed: true,
      // gaps placed on the straight top & bottom so the robot can coast through
      gaps: [[0.235, 0.255], [0.735, 0.755]],
    },
    {
      id: 'nightmare', name: 'Kâbus', difficulty: 'Uzman',
      // tight triple serpentine — Kural kuralları yetmez, iyi bir PID + güçlü robot ister
      points: [[-8, -6], [-8, 6], [-4.5, 6], [-4.5, -4], [-1, -4], [-1, 6], [2.5, 6], [2.5, -4], [6, -4], [6, 6], [8, 6], [8, -6]],
      tension: 0.15, closed: true,
    },
  ];

  function cardinalPoint(p0, p1, p2, p3, t, s) {
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const m1x = s * (p2[0] - p0[0]), m1y = s * (p2[1] - p0[1]);
    const m2x = s * (p3[0] - p1[0]), m2y = s * (p3[1] - p1[1]);
    return [
      h00 * p1[0] + h10 * m1x + h01 * p2[0] + h11 * m2x,
      h00 * p1[1] + h10 * m1y + h01 * p2[1] + h11 * m2y,
    ];
  }

  function dist(a, b) { const dx = a[0] - b[0], dy = a[1] - b[1]; return Math.hypot(dx, dy); }

  function buildGapRanges(meta) {
    if (meta.gaps) return meta.gaps.map((g) => g.slice());
    if (meta.dash) {
      const on = meta.dash.on, off = meta.dash.off, span = on + off, arr = [];
      let p = on; // line starts present at progress 0 (keeps start marker on a line)
      while (p < 1) { arr.push([p, Math.min(1, p + off)]); p += span; }
      return arr;
    }
    return [];
  }

  function buildTrack(track, subdiv) {
    subdiv = subdiv || 40;
    const P = track.points;
    const n = P.length;
    const closed = track.closed;
    const s = track.tension;
    const samples = [];
    const segCount = closed ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
      const p0 = P[(i - 1 + n) % n];
      const p1 = P[i % n];
      const p2 = P[(i + 1) % n];
      const p3 = P[(i + 2) % n];
      for (let j = 0; j < subdiv; j++) samples.push(cardinalPoint(p0, p1, p2, p3, j / subdiv, s));
    }
    if (!closed) samples.push(P[n - 1].slice());
    let len = 0;
    const cum = [0];
    for (let i = 1; i < samples.length; i++) { len += dist(samples[i - 1], samples[i]); cum.push(len); }
    if (closed) len += dist(samples[samples.length - 1], samples[0]);
    return { samples, cum, length: len, closed, meta: track, gapRanges: buildGapRanges(track) };
  }

  function inGap(track, progress) {
    const g = track.gapRanges;
    if (!g || !g.length) return false;
    for (let i = 0; i < g.length; i++) { if (progress >= g[i][0] && progress < g[i][1]) return true; }
    return false;
  }

  function nearestOnTrack(track, x, y) {
    const s = track.samples;
    const N = s.length;
    let best = Infinity, bestI = 0, bestT = 0;
    const segN = track.closed ? N : N - 1;
    for (let i = 0; i < segN; i++) {
      const a = s[i], b = s[(i + 1) % N];
      const abx = b[0] - a[0], aby = b[1] - a[1];
      const apx = x - a[0], apy = y - a[1];
      const ab2 = abx * abx + aby * aby || 1e-9;
      let t = (apx * abx + apy * aby) / ab2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const cx = a[0] + abx * t, cy = a[1] + aby * t;
      const d = Math.hypot(x - cx, y - cy);
      if (d < best) { best = d; bestI = i; bestT = t; }
    }
    return { dist: best, index: bestI, progress: (bestI + bestT) / segN };
  }

  function sensorWorld(robot, sensor) {
    const c = Math.cos(robot.th), sn = Math.sin(robot.th);
    return {
      x: robot.x + sensor.fwd * c + sensor.right * sn,
      y: robot.y + sensor.fwd * sn + sensor.right * (-c),
    };
  }

  function readSensors(robot, sensors, track) {
    return sensors.map((s) => {
      const w = sensorWorld(robot, s);
      const nr = nearestOnTrack(track, w.x, w.y);
      return nr.dist <= LINE_HALF_WIDTH && !inGap(track, nr.progress);
    });
  }

  function readSensorsAnalog(robot, sensors, track) {
    return sensors.map((s) => {
      const w = sensorWorld(robot, s);
      const nr = nearestOnTrack(track, w.x, w.y);
      if (inGap(track, nr.progress)) return 0;
      const d = nr.dist;
      if (d <= LINE_HALF_WIDTH) return 1;
      if (d >= LINE_HALF_WIDTH + ANALOG_FALLOFF) return 0;
      return 1 - (d - LINE_HALF_WIDTH) / ANALOG_FALLOFF;
    });
  }

  function lineError(sensors, readings) {
    let num = 0, den = 0;
    for (let i = 0; i < sensors.length; i++) { num += readings[i] * sensors[i].right; den += readings[i]; }
    if (den < 0.05) return null;
    return num / den;
  }

  function motorFraction(m) {
    if (!m || m.dir === 'stop') return 0;
    const f = (m.speed || 0) / 100;
    return m.dir === 'rev' ? -f : f;
  }

  function ruleMatches(rule, states) {
    for (let i = 0; i < states.length; i++) {
      const p = rule.pattern[i] || 'any';
      if (p === 'any') continue;
      if (p === 'on' && !states[i]) return false;
      if (p === 'off' && states[i]) return false;
    }
    return true;
  }

  function evalRules(rules, defaultRule, states) {
    for (let i = 0; i < rules.length; i++) {
      if (ruleMatches(rules[i], states)) {
        return { mL: motorFraction(rules[i].left), mR: motorFraction(rules[i].right), ruleIndex: i };
      }
    }
    return { mL: motorFraction(defaultRule.left), mR: motorFraction(defaultRule.right), ruleIndex: -1 };
  }

  function makeRobot(track) {
    const s = track.samples;
    const a = s[0], b = s[1 % s.length];
    return { x: a[0], y: a[1], th: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }

  function stepRobot(robot, mL, mR, params, dt) {
    const vMax = params.vMax;
    const vL = mL * vMax, vR = mR * vMax;
    const v = (vL + vR) / 2;
    const om = ((vR - vL) / params.wheelBase) * (params.turnGain || 1);
    robot.th += om * dt;
    robot.x += v * Math.cos(robot.th) * dt;
    robot.y += v * Math.sin(robot.th) * dt;
    return v;
  }

  function createSim(config) {
    const robot = makeRobot(config.track);
    return {
      cfg: config, robot, t: 0, laps: 0, passedHalf: false,
      prevProg: nearestOnTrack(config.track, robot.x, robot.y).progress,
      timeOffLine: 0, timeStalled: 0, onLineTicks: 0, totalTicks: 0,
      maxDeviation: 0, sumDeviation: 0, status: 'running', reason: null,
      pidPrev: 0, pidInt: 0, lastErrSign: 1, last: null, trail: [],
    };
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return sim.last;
    const { track, sensors, rules, defaultRule, params } = sim.cfg;
    const mode = sim.cfg.mode || 'rules';

    let states, cmd, readings = null, error = null;
    if (mode === 'pid') {
      readings = readSensorsAnalog(sim.robot, sensors, track);
      const pid = sim.cfg.pid || { base: 60, kp: 1.4, kd: 0.5, ki: 0 };
      const eRaw = lineError(sensors, readings);
      const base = (pid.base || 0) / 100;
      let turn;
      if (eRaw === null) {
        // line not visible (gap / lost): gentle lean toward last seen side, no D/I kick
        const eRec = sim.lastErrSign * 0.4;
        turn = (pid.kp || 0) * eRec;
        error = eRec;
      } else {
        sim.lastErrSign = eRaw >= 0 ? 1 : -1;
        const dErr = (eRaw - sim.pidPrev) / dt;
        sim.pidInt += eRaw * dt;
        if (sim.pidInt > 2) sim.pidInt = 2; else if (sim.pidInt < -2) sim.pidInt = -2;
        sim.pidPrev = eRaw;
        turn = (pid.kp || 0) * eRaw + (pid.kd || 0) * dErr + (pid.ki || 0) * sim.pidInt;
        error = eRaw;
      }
      if (turn > 1) turn = 1; else if (turn < -1) turn = -1;
      let mL = base + turn, mR = base - turn;
      mL = Math.max(-1, Math.min(1, mL)); mR = Math.max(-1, Math.min(1, mR));
      cmd = { mL, mR, ruleIndex: null };
      states = readings.map((r) => r > 0.3);
    } else {
      states = readSensors(sim.robot, sensors, track);
      cmd = evalRules(rules, defaultRule, states);
    }
    const v = stepRobot(sim.robot, cmd.mL, cmd.mR, params, dt);

    const near = nearestOnTrack(track, sim.robot.x, sim.robot.y);
    sim.t += dt;
    sim.totalTicks++;
    sim.sumDeviation += near.dist;
    if (near.dist > sim.maxDeviation) sim.maxDeviation = near.dist;
    if (near.dist <= ON_LINE_TIGHT) sim.onLineTicks++;

    const anyOn = states.some(Boolean);
    sim.timeOffLine = anyOn ? 0 : sim.timeOffLine + dt;
    sim.timeStalled = Math.abs(v) < 0.05 ? sim.timeStalled + dt : 0;

    const prog = near.progress;
    if (prog > 0.5) sim.passedHalf = true;
    if (sim.passedHalf && sim.prevProg > 0.75 && prog < 0.2 && v > 0) { sim.laps++; sim.passedHalf = false; }
    sim.prevProg = prog;

    if (sim.totalTicks % 3 === 0) {
      sim.trail.push([sim.robot.x, sim.robot.y]);
      if (sim.trail.length > 400) sim.trail.shift();
    }

    if (near.dist > OFF_TRACK_DIST) { sim.status = 'failed'; sim.reason = 'off_track'; }
    else if (sim.timeOffLine > LINE_LOST_GRACE) { sim.status = 'failed'; sim.reason = 'line_lost'; }
    else if (sim.timeStalled > STALL_GRACE) { sim.status = 'failed'; sim.reason = 'stalled'; }
    else if (sim.laps >= 1) { sim.status = 'success'; sim.reason = 'lap_complete'; }

    sim.last = { states, cmd, near, v, anyOn, readings, error };
    return sim.last;
  }

  function accuracy(sim) {
    return sim.totalTicks ? Math.round((sim.onLineTicks / sim.totalTicks) * 100) : 0;
  }

  function lateralSpread(sensors) {
    if (!sensors.length) return 0;
    let mn = Infinity, mx = -Infinity;
    sensors.forEach((s) => { mn = Math.min(mn, s.right); mx = Math.max(mx, s.right); });
    return mx - mn;
  }
  function defaultRuleMoves(defaultRule) {
    return motorFraction(defaultRule.left) !== 0 || motorFraction(defaultRule.right) !== 0;
  }

  function coach(sim) {
    const tips = [];
    const cfg = sim.cfg;
    const mode = cfg.mode || 'rules';
    const spread = lateralSpread(cfg.sensors);
    const acc = accuracy(sim);
    const hasGaps = sim.cfg.track.gapRanges && sim.cfg.track.gapRanges.length;

    if (sim.reason === 'line_lost' || sim.reason === 'off_track') {
      if (hasGaps) {
        tips.push('Bu pistte çizgide boşluklar/kesikler var. Robot boşlukta düz gitmeli — boşluk öncesi iyi hizalanmış olmalı. Hızı biraz düşürmek boşlukları aşmayı kolaylaştırır.');
      }
      if (mode === 'pid') {
        tips.push('PID robotun çizgiden çıktı. Kp çok düşükse virajı dönemez, çok yüksekse zikzak yapıp savrulur — Kp ve Kd değerlerini ince ayarla.');
        if (spread < 0.5 && cfg.sensors.length >= 2) tips.push('Sensörlerin birbirine çok yakın (' + spread.toFixed(2) + ' birim). Daha geniş diziye yayarsan hata ölçümü daha hassas olur.');
      } else {
        const covered = cfg.rules.some((r) => r.pattern.every((p) => p === 'off' || p === 'any') && r.pattern.some((p) => p === 'off'));
        if (!covered && !defaultRuleMoves(cfg.defaultRule)) tips.push('Hiçbir sensör çizgiyi görmediğinde robot durdu/sürüklendi. "Hepsi KAPALI" durumu için bir kurtarma kuralı ekle (ör. düz devam et ya da yavaşça ara).');
        else tips.push('Robot çizgiden çıktı. Sensörlerini biraz daha öne ya da yana taşıyıp köşeyi daha erken yakalamayı dene.');
        if (spread < 0.5 && cfg.sensors.length >= 2) tips.push('Sensörlerin birbirine çok yakın (' + spread.toFixed(2) + ' birim). Daha geniş yerleştirirsen keskin virajları daha erken fark eder.');
        if (cfg.params.vMax >= 4.5) tips.push('Motor hızın yüksek; köşelerde aşıp çıkmış olabilir. Viraj kurallarında hızı düşürmeyi dene.');
      }
    } else if (sim.status === 'success') {
      if (acc >= 95) tips.push('Mükemmel takip! Çizgi üzerinde neredeyse hiç sapma yok.');
      else if (acc >= 85) tips.push(mode === 'pid' ? 'Temiz bir tur. Kd değerini biraz artırırsan zikzakları daha da yumuşatabilirsin.' : 'Temiz bir tur. Viraj kurallarında hızları biraz dengeleyerek daha da düzgün hale getirebilirsin.');
      else tips.push('Turu tamamladın ama robot zikzak yaptı. ' + (mode === 'pid' ? 'Kp\'yi biraz düşür, Kd\'yi artır.' : 'Sensör yerleşimini ve viraj hızlarını ince ayarla.'));
    }
    if (cfg.sensors.length === 1) tips.push('Tek sensörle çizgi takibi çok zordur — yönü ayırt edemez. 3 sensör (sol-orta-sağ) klasik başlangıçtır.');
    return tips;
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const acc = accuracy(sim);
    const t = sim.t;
    const pid = (sim.cfg.mode || 'rules') === 'pid';
    if (pid && acc >= 96 && t < 16) return { key: 'pid_avcisi', name: '🏆 PID Avcısı' };
    if (acc >= 96 && t < 16) return { key: 'pist_hakimi', name: '🏆 Pist Hâkimi' };
    if (acc >= 92) return { key: 'viraj_ustasi', name: '🥇 Viraj Ustası' };
    if (acc >= 82) return { key: 'cizgi_kasifi', name: '🧭 Çizgi Kâşifi' };
    return { key: 'cizgi_ciragi', name: '🎓 Çizgi Çırağı' };
  }

  function runHeadless(config, maxTime, dt) {
    dt = dt || 1 / 60;
    maxTime = maxTime || 60;
    const sim = createSim(config);
    let guard = 0;
    while (sim.status === 'running' && sim.t < maxTime && guard < 1e6) { tickSim(sim, dt); guard++; }
    return {
      status: sim.status, reason: sim.reason, laps: sim.laps,
      time: +sim.t.toFixed(2), accuracy: accuracy(sim),
      maxDeviation: +sim.maxDeviation.toFixed(3), trailLen: sim.trail.length,
    };
  }

  function starterSensors() {
    return [
      { id: 's1', label: 'SOL', color: '#22c55e', fwd: 0.9, right: -0.45 },
      { id: 's2', label: 'ORTA', color: '#38bdf8', fwd: 1.0, right: 0.0 },
      { id: 's3', label: 'SAĞ', color: '#f59e0b', fwd: 0.9, right: 0.45 },
    ];
  }
  function starterRules() {
    return [
      { pattern: ['any', 'on', 'any'], left: { dir: 'fwd', speed: 85 }, right: { dir: 'fwd', speed: 85 } },
      { pattern: ['on', 'off', 'off'], left: { dir: 'fwd', speed: 35 }, right: { dir: 'fwd', speed: 90 } },
      { pattern: ['off', 'off', 'on'], left: { dir: 'fwd', speed: 90 }, right: { dir: 'fwd', speed: 35 } },
    ];
  }
  function starterDefault() { return { left: { dir: 'fwd', speed: 45 }, right: { dir: 'fwd', speed: 45 } }; }
  function defaultParams() { return { vMax: 3.6, wheelBase: 1.1, turnGain: 1.0 }; }
  function starterPID() { return { base: 60, kp: 1.4, kd: 0.5, ki: 0 }; }

  const API = {
    LINE_HALF_WIDTH, OFF_TRACK_DIST, LINE_LOST_GRACE, ANALOG_FALLOFF,
    TRACKS, buildTrack, nearestOnTrack, inGap, sensorWorld, readSensors, readSensorsAnalog, lineError,
    evalRules, ruleMatches, motorFraction, makeRobot, stepRobot,
    createSim, tickSim, accuracy, coach, robotClass, runHeadless,
    starterSensors, starterRules, starterDefault, defaultParams, starterPID,
  };

  global.SimCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
