/* v1.0.1 */
/*
 * RoboForge - Progress module (local, per-student)
 * -----------------------------------------------------------------------------
 * Records per-sim / per-level results in localStorage, keyed by the logged-in
 * student (from rf-auth's rf_session.sub) or an anonymous device id. NO server -
 * this is a stepping stone; server sync (Supabase, keyed by Moodle `sub`) comes
 * later with the gamification DB.
 *
 * Storage shape (localStorage key `rf_progress`):
 *   { "<userKey>": { "<simId>": { "<levelIdx>": {best, medal, mode, pass, runs, ts}, ... }, ... } }
 *
 * API (window.RFProgress):
 *   RFProgress.record(simId, levelIdx, { pass, time, medal, mode })
 *   RFProgress.getSim(simId)      -> { levels:{idx:{...}}, cleared:n, bestMedal, played }
 *   RFProgress.getAll()           -> { simId: getSim(simId) }
 *   RFProgress.summary(levelsPerSim) -> { simsStarted, simsCleared, levelsCleared, totalLevels }
 *   RFProgress.userKey()          -> current user key (Moodle sub or 'anon')
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var KEY = 'rf_progress';
  // medal ranking (higher = better) - used to keep the best medal per level
  var MEDAL_RANK = { '🥉': 1, '🥈': 2, '🏆': 3, '🥇': 3 };

  function userKey() {
    // Tie progress to the logged-in Moodle student if available.
    try {
      var s = localStorage.getItem('rf_session');
      if (s) {
        var o = JSON.parse(s);
        if (o && o.sub) return o.sub;              // e.g. "rfa-2"
      }
    } catch (e) {}
    // Fallback: a stable anonymous device id (so guests still get local progress).
    try {
      var a = localStorage.getItem('rf_anonid');
      if (!a) {
        a = 'anon-' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('rf_anonid', a);
      }
      return a;
    } catch (e) { return 'anon'; }
  }

  function loadAll() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function saveAll(all) {
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
  }

  // Rank a medal string (medals may be like "🏆 Hoverslam Efsanesi" - take the first glyph).
  function medalRank(medal) {
    if (!medal) return 0;
    var g = medal.trim().charAt(0);
    // handle surrogate-pair emoji (medals are single emoji at start)
    var first = medal.match(/^\s*(\uD83C[\uDFC6\uDD47-\uDD49]|\u{1F3C6}|🥇|🥈|🥉|🏆)/u);
    var key = first ? first[1] : g;
    return MEDAL_RANK[key] || (medal.indexOf('🏆') === 0 ? 3 : medal.indexOf('🥈') === 0 ? 2 : medal.indexOf('🥉') === 0 ? 1 : 0);
  }

  var RFProgress = {
    userKey: userKey,

    // Record a finished run. Only PASSES update best time/medal; fails still bump `runs`.
    record: function (simId, levelIdx, result) {
      if (!simId || levelIdx == null) return;
      result = result || {};
      // expose the current sim/level so the shared result toolkit can offer a rating
      try { global.__rfLast = { sim: simId, level: levelIdx }; } catch (e) {}
      var all = loadAll();
      var uk = userKey();
      all[uk] = all[uk] || {};
      all[uk][simId] = all[uk][simId] || {};
      var lv = all[uk][simId][levelIdx] || { best: null, medal: null, mode: null, pass: false, runs: 0 };
      lv.runs = (lv.runs || 0) + 1;
      lv.ts = Date.now();
      if (result.mode) lv.lastMode = result.mode;
      if (result.pass) {
        lv.pass = true;
        // best (lowest) time among passes
        if (typeof result.time === 'number' && (lv.best == null || result.time < lv.best)) {
          lv.best = +result.time;
          if (result.mode) lv.mode = result.mode;
        }
        // best medal among passes
        if (result.medal && medalRank(result.medal) >= medalRank(lv.medal)) {
          lv.medal = result.medal;
        }
      }
      all[uk][simId][levelIdx] = lv;
      saveAll(all);
      return lv;
    },

    getSim: function (simId) {
      var all = loadAll();
      var uk = userKey();
      var levels = (all[uk] && all[uk][simId]) || {};
      var cleared = 0, played = 0, bestMedal = null;
      Object.keys(levels).forEach(function (k) {
        var lv = levels[k];
        if (lv.runs) played++;
        if (lv.pass) cleared++;
        if (lv.medal && medalRank(lv.medal) >= medalRank(bestMedal)) bestMedal = lv.medal;
      });
      return { levels: levels, cleared: cleared, played: played, bestMedal: bestMedal };
    },

    getAll: function () {
      var all = loadAll();
      var uk = userKey();
      var out = {};
      var mine = all[uk] || {};
      Object.keys(mine).forEach(function (simId) { out[simId] = RFProgress.getSim(simId); });
      return out;
    },

    // levelsPerSim: { simId: 7, ... } (usually 7 for every sim)
    summary: function (levelsPerSim) {
      var data = RFProgress.getAll();
      var simsStarted = 0, simsCleared = 0, levelsCleared = 0, totalLevels = 0;
      var lps = levelsPerSim || {};
      // total levels = sum over known sims
      Object.keys(lps).forEach(function (s) { totalLevels += lps[s]; });
      Object.keys(data).forEach(function (simId) {
        var d = data[simId];
        if (d.played) simsStarted++;
        levelsCleared += d.cleared;
        var need = lps[simId] || 7;
        if (d.cleared >= need) simsCleared++;
      });
      return { simsStarted: simsStarted, simsCleared: simsCleared,
        levelsCleared: levelsCleared, totalLevels: totalLevels };
    },

    // Wipe this user's progress (used by a "reset progress" affordance if desired).
    clearMine: function () {
      var all = loadAll();
      delete all[userKey()];
      saveAll(all);
    },
  };

  global.RFProgress = RFProgress;
  if (typeof module !== 'undefined' && module.exports) module.exports = RFProgress;

  // Auto-load the feedback widget on every page (avoids editing 32 HTML files).
  // Safe no-op if rf-feedback.js is absent. Browser only.
  try {
    if (typeof document !== 'undefined' && !global.RFFeedback && !global.__rfFeedbackLoading) {
      global.__rfFeedbackLoading = true;
      var fb = document.createElement('script');
      fb.src = 'rf-feedback.js?v=1'; fb.async = true;
      (document.head || document.documentElement).appendChild(fb);
    }
  } catch (e) {}

  // Auto-load the cloud-sync layer on every page (no-op for anonymous users).
  // Mirrors progress + feedback to Supabase only for logged-in Moodle students.
  try {
    if (typeof document !== 'undefined' && !global.RFCloud && !global.__rfCloudLoading) {
      global.__rfCloudLoading = true;
      var cl = document.createElement('script');
      cl.src = 'rf-cloud.js?v=2'; cl.async = true;
      (document.head || document.documentElement).appendChild(cl);
    }
  } catch (e) {}
})(typeof window !== 'undefined' ? window : globalThis);
