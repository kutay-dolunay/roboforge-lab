/* =============================================================================
 * RoboForge - Cloud sync (rf-cloud.js) v1.0.0
 * -----------------------------------------------------------------------------
 * Mirrors local progress + feedback to Supabase for logged-in Moodle students.
 *
 *   • Anonymous users → DOES NOTHING (100% local, KVKK-clean).
 *   • Logged-in (RFAuth.getUser()) → upserts student + syncs on each result.
 *   • Single write boundary: the `rf_ingest` Postgres RPC (called with anon key).
 *   • Offline-safe: failed posts queue in localStorage, flush on next success.
 *
 * Load order: include AFTER rf-auth.js, rf-progress.js, rf-feedback.js.
 * (rf-progress.js can auto-append this the same way it appends rf-feedback.js.)
 * No per-HTML edits needed beyond the shared include.
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  // ---- CONFIG (anon key is public by design; safe to ship in the browser) ----
  var SUPA_URL  = 'https://qogjywlwbqsxoomjchpd.supabase.co';
  var SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvZ2p5d2x3YnFzeG9vbWpjaHBkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNjg5MzMsImV4cCI6MjA4OTc0NDkzM30._kE54hfMix_8GAkXiyNhAI57G3x29TPLOUGD2yW69Hw';
  var RPC       = SUPA_URL + '/rest/v1/rpc/rf_ingest';
  var QKEY      = 'rf_cloud_queue';   // offline queue

  function user() {
    try { return (global.RFAuth && RFAuth.getUser && RFAuth.getUser()) || null; } catch (e) { return null; }
  }
  function simFromPage() {
    try { return (location.pathname.split('/').pop() || 'index.html').replace('.html', ''); } catch (e) { return null; }
  }

  // ---- offline queue ----
  function qLoad() { try { return JSON.parse(localStorage.getItem(QKEY)) || []; } catch (e) { return []; } }
  function qSave(a) { try { localStorage.setItem(QKEY, JSON.stringify(a)); } catch (e) {} }
  function enqueue(body) { var a = qLoad(); a.push(body); if (a.length > 500) a = a.slice(-500); qSave(a); }

  function postRaw(body) {
    return fetch(RPC, {
      method: 'POST',
      headers: {
        'apikey': SUPA_ANON,
        'Authorization': 'Bearer ' + SUPA_ANON,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      keepalive: true            // let it complete even if the page is navigating away
    }).then(function (r) {
      if (!r.ok) throw new Error('rf_ingest HTTP ' + r.status);
      return true;
    });
  }

  // Send now; on failure, queue for later. Always merges the current user identity.
  function send(extra) {
    var u = user();
    if (!u || !u.sub) return Promise.resolve(false);   // anonymous → no-op
    var body = {
      p_sub: u.sub, p_name: u.name || null, p_email: u.email || null,
      p_role: u.role || null, p_idnumber: u.idnumber || null, p_class: (u.school_class || null)
    };
    for (var k in extra) if (extra.hasOwnProperty(k)) body[k] = extra[k];
    return postRaw(body).then(function () { flush(); return true; })
      .catch(function () { enqueue(body); return false; });
  }

  var flushing = false;
  function flush() {
    if (flushing) return;
    var a = qLoad(); if (!a.length) return;
    flushing = true;
    var next = function () {
      var arr = qLoad();
      if (!arr.length) { flushing = false; return; }
      var item = arr[0];
      postRaw(item).then(function () {
        var rest = qLoad(); rest.shift(); qSave(rest); next();
      }).catch(function () { flushing = false; /* stop; retry on next success */ });
    };
    next();
  }

  // ---- hook RFProgress.record → progress upsert + run_finish event ----
  function hookProgress() {
    if (!global.RFProgress || RFProgress.__cloud) return;
    var orig = RFProgress.record;
    RFProgress.record = function (simId, levelIdx, result) {
      var lv = orig.apply(this, arguments);          // keep local behavior
      try {
        result = result || {};
        send({
          p_sim: simId, p_level: levelIdx,
          p_cleared: !!result.pass,
          p_best_time: (typeof result.time === 'number' ? result.time : null),
          p_best_medal: result.medal || null,
          p_last_mode: result.mode || null,
          p_event_type: result.pass ? 'level_clear' : 'run_finish',
          p_payload: { time: result.time, medal: result.medal, mode: result.mode, pass: !!result.pass }
        });
      } catch (e) {}
      return lv;
    };
    RFProgress.__cloud = true;
  }

  // ---- hook RFFeedback.add → feedback row (incl. ratings) ----
  function hookFeedback() {
    if (!global.RFFeedback || RFFeedback.__cloud) return;
    var orig = RFFeedback.add;
    RFFeedback.add = function (category, text) {
      var n = orig.apply(this, arguments);           // keep local behavior
      try {
        var last = (global.__rfLast || {});
        send({
          p_sim: last.sim || simFromPage(),
          p_level: (last.level != null ? last.level : null),
          p_fb_category: category || 'genel',
          p_fb_text: text || '',
          p_fb_page: (location.pathname.split('/').pop() || 'index.html'),
          p_fb_device: navigator.userAgent,
          p_fb_w: window.innerWidth, p_fb_h: window.innerHeight,
          p_fb_url: location.href,
          // ratings also land in events for analytics
          p_event_type: (category === 'rating' ? 'rating' : 'feedback'),
          p_payload: { category: category, text: text }
        });
      } catch (e) {}
      return n;
    };
    RFFeedback.__cloud = true;
  }

  // ---- boot ----
  function boot() {
    // register student + flush any queued items once we know who they are
    if (user()) { send({ p_event_type: 'session_open' }); }
    hookProgress(); hookFeedback(); flush();
    // rf-feedback.js may load slightly later (async) - re-hook shortly after.
    setTimeout(function () { hookProgress(); hookFeedback(); }, 1500);
    global.addEventListener('online', flush);
  }

  var RFCloud = {
    version: '1.0.0',
    isEnabled: function () { return !!user(); },
    queued: function () { return qLoad().length; },
    flush: flush,
    // manual test from console
    _ping: function () {
      return send({ p_event_type: 'ping' }).then(function (ok) {
        console.log(ok ? 'rf_ingest ok' : 'rf_ingest failed/anon - check login + schema');
        return ok;
      });
    }
  };
  global.RFCloud = RFCloud;
  if (typeof module !== 'undefined' && module.exports) module.exports = RFCloud;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
