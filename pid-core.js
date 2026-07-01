/* =============================================================================
 * RoboForge — PID Çizgi Yarışı (PID Racing) :: Scenario config
 * -----------------------------------------------------------------------------
 * The RACING scenario reuses the line-follower physics engine (window.SimCore).
 * This module only supplies the racing content: 7 racing circuits, a dense
 * 5-sensor analog array, racing-tuned PID defaults, and Kural rules. The lab
 * (pid.html) builds tracks with SimCore.buildTrack and runs SimCore.tickSim.
 *
 * Goal of the scenario: the FASTEST clean lap. Tune Kp/Kd + build a fast robot
 * to cut lap time — but push too hard on a technical corner and you fly off.
 * ========================================================================== */
(function (global) {
  'use strict';

  // 7-level ladder: Başlangıç ×2, Orta ×2, İleri ×2, Uzman ×1
  const RACING_TRACKS = [
    { id: 'warmup', name: 'Isınma Turu', difficulty: 'Başlangıç',
      blurb: 'Geniş, akıcı bir oval. Gazı köklemek için birebir.',
      points: [[-8.5, 0], [-4.5, 7.5], [4.5, 7.5], [8.5, 0], [4.5, -7.5], [-4.5, -7.5]], tension: 0.6, closed: true },
    { id: 'broad', name: 'Geniş Pist', difficulty: 'Başlangıç',
      blurb: 'Yuvarlak köşeli hızlı bir tur. Temiz ve hızlı git.',
      points: [[-8, -4.5], [-8, 4.5], [-4, 8], [4, 8], [8, 4.5], [8, -4.5], [4, -8], [-4, -8]], tension: 0.5, closed: true },
    { id: 'chicane', name: 'Şikan', difficulty: 'Orta',
      blurb: 'Ortada keskin bir şikan. Frenle, çık, hızlan.',
      points: [[-8, -2], [-8, 4], [-3, 7], [0, 3], [3, 7], [8, 4], [8, -4], [2, -7], [-3, -7]], tension: 0.4, closed: true },
    { id: 'eight', name: 'Sekiz', difficulty: 'Orta',
      blurb: 'Sekiz biçimli geçiş. Hızla girersen savrulursun.',
      points: [[-7, -6], [-7, 6], [0, 1], [7, 6], [7, -6], [0, -1]], tension: 0.25, closed: true },
    { id: 'technical', name: 'Teknik Viraj', difficulty: 'İleri',
      blurb: 'Peş peşe teknik virajlar. Kd burada hayat kurtarır.',
      points: [[-8, -5], [-8, 5], [-4, 7], [-4, 1], [0, 1], [0, 7], [4, 7], [4, -3], [8, -3], [8, -7], [-2, -7]], tension: 0.2, closed: true },
    { id: 'circuit', name: 'Yarış Pisti', difficulty: 'İleri',
      blurb: 'Düzlükler + şikanlı tam bir pist. Ritmi yakala.',
      points: [[-8.5, -3], [-8.5, 4], [-4, 8], [3, 7], [3, 1], [8.5, 4], [8.5, -4], [3, -8], [-4, -8], [-8.5, -6]], tension: 0.4, closed: true },
    { id: 'gp', name: 'Grand Prix', difficulty: 'Uzman',
      blurb: 'Zorlu bir GP pisti. Temiz hızlı tur = kusursuz PID + güçlü robot.',
      points: [[-9, -6], [-9, 3], [-5, 7], [-5, 1], [-1, 1], [-1, 7], [3, 8], [7, 5], [4, 0], [8, -2], [9, -6], [2, -8], [-4, -7]], tension: 0.2, closed: true },
  ];

  // dense 5-sensor analog array (racing setup) — order = [SOL2, SOL, ORTA, SAĞ, SAĞ2]
  function starterSensors() {
    return [
      { id: 's1', role: 'l2', label: 'SOL2', color: '#22c55e', fwd: 0.9, right: -0.6 },
      { id: 's2', role: 'l1', label: 'SOL', color: '#38bdf8', fwd: 0.95, right: -0.3 },
      { id: 's3', role: 'c', label: 'ORTA', color: '#eab308', fwd: 1.0, right: 0.0 },
      { id: 's4', role: 'r1', label: 'SAĞ', color: '#f59e0b', fwd: 0.95, right: 0.3 },
      { id: 's5', role: 'r2', label: 'SAĞ2', color: '#ef4444', fwd: 0.9, right: 0.6 },
    ];
  }
  // Kural (5-sensor) — center on => straight; sides steer proportionally
  function starterRules() {
    return [
      { pattern: ['any', 'any', 'on', 'any', 'any'], left: { dir: 'fwd', speed: 80 }, right: { dir: 'fwd', speed: 80 } },
      { pattern: ['off', 'on', 'off', 'off', 'off'], left: { dir: 'fwd', speed: 45 }, right: { dir: 'fwd', speed: 85 } },
      { pattern: ['off', 'off', 'off', 'on', 'off'], left: { dir: 'fwd', speed: 85 }, right: { dir: 'fwd', speed: 45 } },
      { pattern: ['on', 'any', 'off', 'off', 'off'], left: { dir: 'fwd', speed: 25 }, right: { dir: 'fwd', speed: 90 } },
      { pattern: ['off', 'off', 'off', 'any', 'on'], left: { dir: 'fwd', speed: 90 }, right: { dir: 'fwd', speed: 25 } },
    ];
  }
  function starterDefault() { return { left: { dir: 'fwd', speed: 55 }, right: { dir: 'fwd', speed: 55 } }; }
  function starterPID() { return { base: 70, kp: 1.6, kd: 0.6, ki: 0 }; }
  function defaultParams() { return { vMax: 3.8, wheelBase: 1.1, turnGain: 1.0 }; }

  const API = { RACING_TRACKS, starterSensors, starterRules, starterDefault, starterPID, defaultParams };
  global.PidCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
