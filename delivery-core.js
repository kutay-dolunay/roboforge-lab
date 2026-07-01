/* =============================================================================
 * RoboForge — Teslimat Robotu (Delivery Robot) :: Simulation Core
 * -----------------------------------------------------------------------------
 * Pure, dependency-free. Browser (window.DeliveryCore) + Node (module.exports).
 *
 * A city grid of line "streets". The robot line-follows automatically between
 * intersections; the STUDENT writes the ROUTE PLAN — an ordered list of
 * directives (SOL / SAĞ / DÜZ), one consumed at every intersection (kavşak).
 * This is the state-machine / sequencing lesson.
 *
 * Modes: 'rules' = digital bang-bang driving · 'pid' = analog PID driving
 * (both consume the same plan; PID is smoother/faster and tunable).
 * ========================================================================== */
(function (global) {
  'use strict';

  const LINE_HALF_WIDTH = 0.36;
  const NODE_R = 0.7;          // intersection trigger radius
  const NODE_CLEAR = 1.5;      // must leave this radius before next trigger
  const DELIVER_R = 0.8;       // package drop radius
  const BARRIER_R = 0.55;      // barrier half-size (crash radius w/ robot)
  const ROBOT_R = 0.42;
  const CITY_MARGIN = 2.2;     // beyond street bbox => off_city
  const STALL_GRACE = 3.5;
  const LOST_GRACE = 3.0;

  // ---- city definitions -------------------------------------------------------
  // grid: W x H nodes, spacing S. node id = r*W+c (r=0 bottom). Position:
  //   x = (c-(W-1)/2)*S ; y = (r-(H-1)/2)*S
  // edges: list of [idA,idB] (adjacent nodes). start: {node, dir} dir=N/E/S/W.
  // deliveries: [nodeId,...] · barriers: [[idA,idB],...] (block mid-segment)
  // plan: shipped correct route (directives consumed at deg>=3 nodes)
  const CITIES = [
    { id: 'ilk', name: 'İlk Teslimat', difficulty: 'Başlangıç', time: 14,
      grid: { W: 3, H: 3, S: 4 },
      edges: [[0,1],[1,2],[1,4],[4,3],[4,5],[4,7],[7,6],[7,8]],
      start: { node: 0, dir: 'E' }, deliveries: [7],
      plan: ['L'] },
    { id: 'iki', name: 'İki Kavşak', difficulty: 'Başlangıç', time: 18,
      grid: { W: 3, H: 3, S: 4 },
      edges: [[0,1],[1,2],[0,3],[1,4],[2,5],[3,4],[4,5],[3,6],[4,7],[5,8],[6,7],[7,8]],
      start: { node: 0, dir: 'N' }, deliveries: [8],
      plan: ['R', 'L', 'R'] },
    { id: 'tur', name: 'Şehir Turu', difficulty: 'Orta', time: 18,
      grid: { W: 4, H: 4, S: 4 },
      edges: [[0,1],[1,2],[2,3],[4,5],[5,6],[6,7],[8,9],[9,10],[10,11],[12,13],[13,14],[14,15],
              [0,4],[4,8],[8,12],[1,5],[5,9],[9,13],[2,6],[6,10],[10,14],[3,7],[7,11],[11,15]],
      start: { node: 0, dir: 'E' }, deliveries: [10],
      plan: ['L', 'R', 'L'] },
    { id: 'uzak', name: 'Uzak Adres', difficulty: 'Orta', time: 26,
      grid: { W: 4, H: 4, S: 4 },
      edges: [[0,1],[1,2],[2,3],[4,5],[5,6],[6,7],[8,9],[9,10],[10,11],[12,13],[13,14],[14,15],
              [0,4],[4,8],[8,12],[1,5],[5,9],[9,13],[2,6],[6,10],[10,14],[3,7],[7,11],[11,15]],
      start: { node: 12, dir: 'E' }, deliveries: [3],
      plan: ['R', 'L', 'R', 'L', 'R'] },
    { id: 'kapali', name: 'Kapalı Yol', difficulty: 'İleri', time: 26,
      grid: { W: 4, H: 4, S: 4 },
      edges: [[0,1],[1,2],[2,3],[4,5],[5,6],[6,7],[8,9],[9,10],[10,11],[12,13],[13,14],[14,15],
              [0,4],[4,8],[8,12],[1,5],[5,9],[9,13],[2,6],[6,10],[10,14],[3,7],[7,11],[11,15]],
      start: { node: 0, dir: 'E' }, deliveries: [15],
      barriers: [[1, 2], [9, 10]],
      plan: ['L', 'R', 'F', 'L', 'F'] },
    { id: 'cifte', name: 'Çifte Teslimat', difficulty: 'İleri', time: 28,
      grid: { W: 4, H: 4, S: 4 },
      edges: [[0,1],[1,2],[2,3],[4,5],[5,6],[6,7],[8,9],[9,10],[10,11],[12,13],[13,14],[14,15],
              [0,4],[4,8],[8,12],[1,5],[5,9],[9,13],[2,6],[6,10],[10,14],[3,7],[7,11],[11,15]],
      start: { node: 12, dir: 'S' }, deliveries: [6, 3],
      plan: ['L', 'R', 'L', 'F', 'R'] },
    { id: 'buyuk', name: 'Büyük Şehir', difficulty: 'Uzman', time: 40,
      grid: { W: 5, H: 5, S: 3.6 },
      edges: (function () {
        const e = [];
        for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) e.push([r * 5 + c, r * 5 + c + 1]);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) e.push([r * 5 + c, (r + 1) * 5 + c]);
        return e;
      })(),
      start: { node: 0, dir: 'N' }, deliveries: [14, 22],
      barriers: [[6, 7], [12, 17], [8, 13]],
      plan: ['R', 'L', 'R', 'F', 'F', 'L', 'L', 'F', 'R'] },
  ];

  const DIRV = { E: [1, 0], N: [0, 1], W: [-1, 0], S: [0, -1] };

  function nodePos(city, id) {
    const g = city.grid;
    const c = id % g.W, r = Math.floor(id / g.W);
    return [(c - (g.W - 1) / 2) * g.S, (r - (g.H - 1) / 2) * g.S];
  }

  function buildCity(meta) {
    const nodes = [];
    const g = meta.grid;
    for (let i = 0; i < g.W * g.H; i++) nodes.push({ id: i, p: nodePos(meta, i), adj: [] });
    const segs = [];
    meta.edges.forEach(([a, b]) => {
      nodes[a].adj.push(b); nodes[b].adj.push(a);
      segs.push({ a: nodes[a].p, b: nodes[b].p, na: a, nb: b });
    });
    const barriers = (meta.barriers || []).map(([a, b]) => {
      const pa = nodes[a].p, pb = nodes[b].p;
      return { x: (pa[0] + pb[0]) / 2, y: (pa[1] + pb[1]) / 2, na: a, nb: b };
    });
    let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
    nodes.forEach(n => { if (!n.adj.length) return;
      mnx = Math.min(mnx, n.p[0]); mxx = Math.max(mxx, n.p[0]);
      mny = Math.min(mny, n.p[1]); mxy = Math.max(mxy, n.p[1]); });
    return { meta, nodes, segs, barriers,
      deliveries: meta.deliveries.slice(),
      bbox: { mnx, mny, mxx, mxy },
      start: { p: nodes[meta.start.node].p.slice(), dir: meta.start.dir } };
  }

  // ---- geometry ----------------------------------------------------------------
  function segDist(p, s) {
    const ax = s.a[0], ay = s.a[1], bx = s.b[0], by = s.b[1];
    const abx = bx - ax, aby = by - ay;
    const ab2 = abx * abx + aby * aby || 1e-9;
    let t = ((p[0] - ax) * abx + (p[1] - ay) * aby) / ab2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return Math.hypot(p[0] - (ax + abx * t), p[1] - (ay + aby * t));
  }
  function lineDistAt(city, x, y) {
    let d = Infinity;
    for (let i = 0; i < city.segs.length; i++) {
      const dd = segDist([x, y], city.segs[i]);
      if (dd < d) d = dd;
    }
    return d;
  }

  const LINE_SENSORS = [
    { id: 's1', label: 'SOL', color: '#22c55e', fwd: 0.9, right: -0.38 },
    { id: 's2', label: 'ORTA', color: '#38bdf8', fwd: 0.95, right: 0.0 },
    { id: 's3', label: 'SAĞ', color: '#f59e0b', fwd: 0.9, right: 0.38 },
  ];
  function sensorWorld(robot, s) {
    const c = Math.cos(robot.th), sn = Math.sin(robot.th);
    return [robot.x + s.fwd * c + s.right * sn, robot.y + s.fwd * sn + s.right * (-c)];
  }
  function readLine(robot, city) {
    return LINE_SENSORS.map(s => lineDistAt(city, ...sensorWorld(robot, s)) <= LINE_HALF_WIDTH);
  }
  function readLineAnalog(robot, city) {
    return LINE_SENSORS.map(s => {
      const d = lineDistAt(city, ...sensorWorld(robot, s));
      if (d <= LINE_HALF_WIDTH) return 1;
      if (d >= LINE_HALF_WIDTH + 0.4) return 0;
      return 1 - (d - LINE_HALF_WIDTH) / 0.4;
    });
  }

  // ---- robot -------------------------------------------------------------------
  function makeRobot(city) {
    const d = DIRV[city.start.dir];
    return { x: city.start.p[0], y: city.start.p[1], th: Math.atan2(d[1], d[0]) };
  }
  function stepRobot(robot, mL, mR, params, dt) {
    const vL = mL * params.vMax, vR = mR * params.vMax;
    const v = (vL + vR) / 2;
    robot.th += ((vR - vL) / params.wheelBase) * (params.turnGain || 1) * dt;
    robot.x += v * Math.cos(robot.th) * dt;
    robot.y += v * Math.sin(robot.th) * dt;
    return v;
  }
  function snapTh(th) { return Math.round(th / (Math.PI / 2)) * (Math.PI / 2); }

  // ---- sim ----------------------------------------------------------------------
  function createSim(cfg) {
    const city = cfg.city;
    return {
      cfg, city, robot: makeRobot(city), t: 0,
      status: 'running', reason: null,
      phase: 'follow',            // follow | turn | cross
      phaseTh: 0, phaseDir: 0, phaseNode: -1,
      planIdx: 0, kavsak: 0, handledNode: -1,
      pending: city.deliveries.slice(), delivered: [],
      pidPrev: 0, eF: 0, lastSide: 0,
      timeLost: 0, timeStalled: 0, onLineTicks: 0, totalTicks: 0,
      trail: [], last: null, events: [],
    };
  }

  function nodeDeg(city, id) { return city.nodes[id].adj.length; }

  function nearNode(sim) {
    const { city, robot } = sim;
    let best = -1, bd = Infinity;
    for (let i = 0; i < city.nodes.length; i++) {
      if (!city.nodes[i].adj.length) continue;
      const d = Math.hypot(robot.x - city.nodes[i].p[0], robot.y - city.nodes[i].p[1]);
      if (d < bd) { bd = d; best = i; }
    }
    return { id: best, dist: bd };
  }

  // pick auto-turn direction at a corner (deg-2 node): follow the street
  function cornerDir(sim, nodeId) {
    const { city, robot } = sim;
    const n = city.nodes[nodeId];
    const c = Math.cos(robot.th), s = Math.sin(robot.th);
    let bestDot = -2, straightest = null, side = 0;
    n.adj.forEach(adjId => {
      const q = city.nodes[adjId].p;
      const dx = q[0] - n.p[0], dy = q[1] - n.p[1];
      const m = Math.hypot(dx, dy) || 1e-9;
      const dot = (dx * c + dy * s) / m;
      if (dot > bestDot && dot > -0.5) { bestDot = dot; straightest = [dx / m, dy / m]; }
    });
    if (!straightest) return 0;
    if (bestDot > 0.7) return 0;                       // street continues straight
    const cross = c * straightest[1] - s * straightest[0]; // + = target is to the left
    side = cross > 0 ? 1 : -1;
    return side;
  }

  function tickSim(sim, dt) {
    if (sim.status !== 'running') return sim.last;
    const { city, params } = sim.cfg;
    const mode = sim.cfg.mode || 'rules';
    const robot = sim.robot;
    const plan = sim.cfg.plan || [];

    const lineB = readLine(robot, city);
    let readings = null;

    // ---- intersection / corner handling ----
    const nn = nearNode(sim);
    if (sim.phase === 'follow' && nn.dist < NODE_R && nn.id !== sim.handledNode) {
      const deg = nodeDeg(city, nn.id);
      const isDelivery = sim.pending.indexOf(nn.id) >= 0;
      if (deg >= 3) {
        sim.kavsak++;
        const dir = plan[sim.planIdx] || 'F';
        sim.planIdx++;
        sim.handledNode = nn.id;
        sim.phaseNode = nn.id;
        if (dir === 'L' || dir === 'R') {
          sim.phase = 'turn';
          sim.phaseDir = dir === 'L' ? 1 : -1;
          sim.phaseTh = snapTh(robot.th) + sim.phaseDir * Math.PI / 2;
        } else {
          sim.phase = 'cross';
          sim.phaseTh = snapTh(robot.th);
        }
        sim.events.push({ t: sim.t, type: 'kavsak', n: sim.kavsak, dir });
      } else if (deg === 2) {
        const side = cornerDir(sim, nn.id);
        sim.handledNode = nn.id;
        if (side !== 0) {
          sim.phase = 'turn'; sim.phaseNode = nn.id; sim.phaseDir = side;
          sim.phaseTh = snapTh(robot.th) + side * Math.PI / 2;
        }
      } else { sim.handledNode = nn.id; } // dead end tip
    }
    if (nn.dist > NODE_CLEAR && sim.handledNode >= 0 && nn.id === sim.handledNode) sim.handledNode = -1;

    // ---- command ----
    let cmd;
    if (sim.phase === 'turn') {
      const rem = (sim.phaseTh - robot.th) * sim.phaseDir;
      cmd = sim.phaseDir > 0 ? { mL: 0.1, mR: 0.66 } : { mL: 0.66, mR: 0.1 };
      if (rem <= 0.1) { sim.phase = 'cross'; sim.phaseTh = snapTh(robot.th); }
    } else if (sim.phase === 'cross') {
      // heading-locked straight until the node zone is cleared
      const err = sim.phaseTh - robot.th;
      cmd = { mL: 0.6 - err * 0.8, mR: 0.6 + err * 0.8 };
      cmd.mL = Math.max(0, Math.min(1, cmd.mL)); cmd.mR = Math.max(0, Math.min(1, cmd.mR));
      const nd = Math.hypot(robot.x - city.nodes[sim.phaseNode].p[0], robot.y - city.nodes[sim.phaseNode].p[1]);
      if (nd > 1.3) sim.phase = 'follow';
    } else if (mode === 'pid') {
      readings = readLineAnalog(robot, city);
      const pid = sim.cfg.pid || defaultPID();
      let num = 0, den = 0;
      for (let i = 0; i < 3; i++) { num += readings[i] * LINE_SENSORS[i].right; den += readings[i]; }
      const base = (pid.base || 0) / 100;
      let turn;
      if (den < 0.05) {
        turn = (pid.kp || 0) * 0.2 * sim.lastSide;
      } else {
        const e = num / den;
        sim.lastSide = e > 0.05 ? 1 : e < -0.05 ? -1 : sim.lastSide;
        sim.eF = sim.eF * 0.7 + e * 0.3;
        let dErr = (sim.eF - sim.pidPrev) / dt;
        if (dErr > 2.5) dErr = 2.5; else if (dErr < -2.5) dErr = -2.5;
        sim.pidPrev = sim.eF;
        turn = (pid.kp || 0) * e + (pid.kd || 0) * dErr;
      }
      if (turn > 1) turn = 1; else if (turn < -1) turn = -1;
      cmd = { mL: Math.max(-1, Math.min(1, base + turn)), mR: Math.max(-1, Math.min(1, base - turn)) };
    } else {
      // digital bang-bang
      if (lineB[1] && !lineB[0] && !lineB[2]) cmd = { mL: 0.8, mR: 0.8 };
      else if (lineB[0] && !lineB[2]) { cmd = { mL: 0.28, mR: 0.85 }; sim.lastSide = -1; }
      else if (lineB[2] && !lineB[0]) { cmd = { mL: 0.85, mR: 0.28 }; sim.lastSide = 1; }
      else if (lineB[0] && lineB[1] && lineB[2]) cmd = { mL: 0.75, mR: 0.75 };
      else cmd = sim.lastSide > 0 ? { mL: 0.7, mR: 0.42 } : sim.lastSide < 0 ? { mL: 0.42, mR: 0.7 } : { mL: 0.5, mR: 0.5 };
    }

    const v = stepRobot(robot, cmd.mL, cmd.mR, params, dt);
    sim.t += dt; sim.totalTicks++;

    // deliveries
    for (let i = sim.pending.length - 1; i >= 0; i--) {
      const p = city.nodes[sim.pending[i]].p;
      if (Math.hypot(robot.x - p[0], robot.y - p[1]) < DELIVER_R) {
        sim.delivered.push(sim.pending[i]);
        sim.events.push({ t: sim.t, type: 'deliver', node: sim.pending[i] });
        sim.pending.splice(i, 1);
      }
    }

    // barriers
    for (let i = 0; i < city.barriers.length; i++) {
      const b = city.barriers[i];
      if (Math.hypot(robot.x - b.x, robot.y - b.y) < BARRIER_R + ROBOT_R) {
        sim.status = 'failed'; sim.reason = 'crash';
      }
    }

    const ld = lineDistAt(city, robot.x, robot.y);
    if (ld <= 0.5) sim.onLineTicks++;
    sim.timeLost = (sim.phase === 'follow' && !lineB.some(Boolean)) ? sim.timeLost + dt : 0;
    sim.timeStalled = Math.abs(v) < 0.05 ? sim.timeStalled + dt : 0;

    if (sim.status === 'running') {
      const bb = city.bbox;
      if (robot.x < bb.mnx - CITY_MARGIN || robot.x > bb.mxx + CITY_MARGIN ||
          robot.y < bb.mny - CITY_MARGIN || robot.y > bb.mxy + CITY_MARGIN) {
        sim.status = 'failed'; sim.reason = 'off_city';
      }
      else if (sim.timeLost > LOST_GRACE) { sim.status = 'failed'; sim.reason = 'line_lost'; }
      else if (sim.timeStalled > STALL_GRACE) { sim.status = 'failed'; sim.reason = 'stalled'; }
      else if (!sim.pending.length) { sim.status = 'success'; sim.reason = 'delivered'; }
      else if (sim.t > (city.meta.time || 90)) { sim.status = 'failed'; sim.reason = 'timeout'; }
    }

    if (sim.totalTicks % 3 === 0) {
      sim.trail.push([robot.x, robot.y]);
      if (sim.trail.length > 3200) sim.trail.shift();
    }

    sim.last = { lineB, readings, cmd, v, phase: sim.phase, kavsak: sim.kavsak,
      planIdx: sim.planIdx, pending: sim.pending.length, nodeDist: nn.dist };
    return sim.last;
  }

  function accuracy(sim) { return sim.totalTicks ? Math.round((sim.onLineTicks / sim.totalTicks) * 100) : 0; }

  function coach(sim) {
    const tips = [];
    const plan = sim.cfg.plan || [];
    if (sim.reason === 'off_city') {
      if (sim.planIdx >= plan.length) tips.push('Rota planın bitti ama teslimat tamamlanmadı — robot plansız kavşakta DÜZ gider ve şehir dışına çıkabilir. Plana adım ekle.');
      else tips.push('Robot şehir dışına çıktı. Kavşak yönlerini kontrol et — bir dönüş ters olabilir.');
    }
    if (sim.reason === 'crash') tips.push('Yol bariyerine çarptın! Kapalı yolu haritadan gör ve rotanı etrafından planla.');
    if (sim.reason === 'timeout') {
      if (sim.pending.length && sim.delivered.length) tips.push('İlk paket teslim edildi ama ikincisine süre yetmedi — daha kısa bir rota dene.');
      else tips.push('Süre doldu. Rota çok uzun ya da yanlış — kavşak sayısını haritadan takip ederek planı yeniden yaz.');
    }
    if (sim.reason === 'line_lost') tips.push('Robot çizgiyi kaybetti. Bu genelde yanlış yöne dönmekle olur — plandaki SOL/SAĞ yönlerini kontrol et.');
    if (sim.status === 'success') {
      const T = sim.city.meta.time || 90;
      if (sim.t < T * 0.5) tips.push('Hızlı teslimat! Daha zor şehirlerde bu planlama becerisi altın değerinde.');
      else tips.push('Teslimat tamam! Süreyi kısaltmak için daha az kavşaklı bir rota var mı diye haritaya bak.');
    }
    if (plan.length > sim.kavsak + 2 && sim.status !== 'success') tips.push('Planında kullanılmayan adımlar kaldı (' + plan.length + ' adım, ' + sim.kavsak + ' kavşak geçildi).');
    return tips;
  }

  function robotClass(sim) {
    if (sim.status !== 'success') return null;
    const T = sim.city.meta.time || 90, t = sim.t;
    if (t < T * 0.45) return { key: 'simsek_kurye', name: '🏆 Şimşek Kurye', cmt: 'Adres şaşmadı, süre uçtu — kusursuz rota.' };
    if (t < T * 0.6) return { key: 'usta_kurye', name: '🥇 Usta Kurye', cmt: 'Temiz teslimat. Daha kısa rota var mı, haritaya bak.' };
    if (t < T * 0.8) return { key: 'mahalle_kuryesi', name: '🧭 Mahalle Kuryesi', cmt: 'Paket sahibinde! Rota biraz daha kısalabilir.' };
    return { key: 'caylak_kurye', name: '🎓 Çaylak Kurye', cmt: 'Teslim edildi — şimdi süreyi kısaltma zamanı.' };
  }

  function runHeadless(cfg, maxTime, dt) {
    dt = dt || 1 / 60;
    const sim = createSim(cfg);
    const mt = maxTime || (cfg.city.meta.time || 90) + 5;
    let g = 0;
    while (sim.status === 'running' && sim.t < mt && g++ < 2e6) tickSim(sim, dt);
    return { status: sim.status, reason: sim.reason, time: +sim.t.toFixed(2),
      kavsak: sim.kavsak, delivered: sim.delivered.length, accuracy: accuracy(sim) };
  }

  function defaultParams() { return { vMax: 3.6, wheelBase: 1.1, turnGain: 1.0 }; }
  function defaultPID() { return { base: 62, kp: 1.4, kd: 0.5 }; }
  function shippedPlan(city) { return (city.meta.plan || []).slice(); }

  const API = {
    LINE_HALF_WIDTH, NODE_R, DELIVER_R, BARRIER_R,
    CITIES, buildCity, nodePos, lineDistAt, segDist,
    LINE_SENSORS, sensorWorld, readLine, readLineAnalog,
    makeRobot, stepRobot, createSim, tickSim, accuracy, coach, robotClass, runHeadless,
    defaultParams, defaultPID, shippedPlan, nodeDeg,
  };
  global.DeliveryCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
