/* =============================================================================
 * RoboForge — Feedback capture  (rf-feedback.js) v1.0.0
 * -----------------------------------------------------------------------------
 * A small floating "🐞 Geri bildirim" button on every page. Opens a quick form
 * (category + free text), auto-captures context (page, sim, level, user, device,
 * URL, time), stores locally (localStorage 'rf_feedback'), and is ready for
 * server sync later (RFFeedback.exportAll() dumps everything as JSON).
 *
 * For the student test sessions: friction/notes get RECORDED, not lost.
 * Self-injects its own button + styles; just include the script. No deps.
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';
  var KEY = 'rf_feedback';

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} }

  function ctx() {
    var user = null;
    try { var s = localStorage.getItem('rf_session'); if (s) { var o = JSON.parse(s); user = o && (o.name || o.sub); } } catch (e) {}
    var sim = null, level = null;
    // best-effort: sim id from the build link or the page filename
    try {
      var page = (location.pathname.split('/').pop() || 'index.html');
      sim = page.replace('.html', '');
      // many labs expose a current level index on a global LAB — can't read (IIFE), so leave null
    } catch (e) {}
    return {
      page: (location.pathname.split('/').pop() || 'index.html'),
      title: document.title,
      sim: sim,
      user: user || 'anon',
      ua: navigator.userAgent,
      w: window.innerWidth, h: window.innerHeight,
      url: location.href,
      ts: new Date().toISOString(),
    };
  }

  var RFFeedback = {
    add: function (category, text) {
      var list = load();
      list.push(Object.assign({ category: category || 'genel', text: text || '' }, ctx()));
      save(list);
      return list.length;
    },
    getAll: function () { return load(); },
    count: function () { return load().length; },
    exportAll: function () { return JSON.stringify(load(), null, 2); },
    clear: function () { save([]); },
  };
  global.RFFeedback = RFFeedback;
  if (typeof module !== 'undefined' && module.exports) module.exports = RFFeedback;

  // ---------- UI (self-injected) ----------
  function injectStyles() {
    if (document.getElementById('rf-fb-style')) return;
    var css = ''
      + '.rf-fb-btn{position:fixed;right:14px;bottom:14px;z-index:150;display:flex;align-items:center;gap:7px;'
      + 'border:1px solid #1e3a5f;background:linear-gradient(180deg,#0ea5e9,#0369a1);color:#eaf6ff;font-weight:800;'
      + 'font-size:.78rem;font-family:inherit;padding:9px 13px;border-radius:22px;cursor:pointer;'
      + 'box-shadow:0 6px 20px rgba(0,0,0,.35);opacity:.9;transition:.15s}'
      + '.rf-fb-btn:hover{opacity:1;transform:translateY(-2px)}'
      + '@media(max-width:560px){.rf-fb-btn{right:10px;bottom:10px;font-size:.72rem;padding:8px 11px}}'
      + '.rf-fb-ov{position:fixed;inset:0;z-index:151;display:none;align-items:center;justify-content:center;'
      + 'padding:18px;background:rgba(5,8,16,.7);backdrop-filter:blur(4px)}'
      + '.rf-fb-ov.show{display:flex}'
      + '.rf-fb-card{max-width:420px;width:100%;border:1px solid #1e3a5f;border-radius:16px;padding:20px;'
      + 'background:linear-gradient(180deg,#101b31,#0b1220);box-shadow:0 24px 70px rgba(0,0,0,.6);color:#e2e8f0}'
      + '.rf-fb-card h3{margin:0 0 4px;font-size:1.1rem;color:#38bdf8}'
      + '.rf-fb-card p{margin:0 0 12px;font-size:.82rem;color:#94a3b8}'
      + '.rf-fb-cats{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}'
      + '.rf-fb-cat{border:1px solid #1e3a5f;background:#0f172a;color:#94a3b8;border-radius:16px;padding:6px 12px;'
      + 'font-size:.74rem;font-weight:700;cursor:pointer;font-family:inherit}'
      + '.rf-fb-cat.on{border-color:#38bdf8;color:#38bdf8;background:#0c1a30}'
      + '.rf-fb-card textarea{width:100%;min-height:84px;border:1px solid #1e3a5f;border-radius:10px;background:#0b1220;'
      + 'color:#e2e8f0;padding:10px;font-family:inherit;font-size:.86rem;resize:vertical}'
      + '.rf-fb-card textarea:focus{outline:none;border-color:#38bdf8;box-shadow:0 0 0 3px rgba(56,189,248,.15)}'
      + '.rf-fb-row{display:flex;gap:9px;justify-content:flex-end;margin-top:14px}'
      + '.rf-fb-x{border:1px solid #1e3a5f;background:transparent;color:#94a3b8;border-radius:10px;padding:9px 15px;'
      + 'font-weight:800;font-size:.8rem;cursor:pointer;font-family:inherit}'
      + '.rf-fb-send{border:1px solid #22c55e;background:linear-gradient(180deg,#16a34a,#15803d);color:#eafff0;'
      + 'border-radius:10px;padding:9px 18px;font-weight:800;font-size:.8rem;cursor:pointer;font-family:inherit}'
      + '.rf-fb-thanks{color:#86efac;font-size:.86rem;text-align:center;padding:10px 0}';
    var st = document.createElement('style'); st.id = 'rf-fb-style'; st.textContent = css;
    document.head.appendChild(st);
  }

  var CATS = [
    { id: 'takildim', label: '😕 Takıldım' },
    { id: 'hata', label: '🐞 Hata / bozuk' },
    { id: 'anlamadim', label: '❓ Anlamadım' },
    { id: 'fikir', label: '💡 Fikir' },
    { id: 'begendim', label: '❤️ Beğendim' },
  ];

  function build() {
    injectStyles();
    var btn = document.createElement('button');
    btn.className = 'rf-fb-btn'; btn.type = 'button';
    btn.innerHTML = '🐞 Geri bildirim';
    document.body.appendChild(btn);

    var ov = document.createElement('div'); ov.className = 'rf-fb-ov';
    var chosen = { c: 'takildim' };
    ov.innerHTML =
      '<div class="rf-fb-card" role="dialog" aria-modal="true" aria-label="Geri bildirim">'
      + '<h3>🐞 Geri bildirim</h3>'
      + '<p>Ne oldu? Hangisi olduğunu seç, birkaç kelime yaz — bize çok yardımcı olur.</p>'
      + '<div class="rf-fb-cats">' + CATS.map(function (c, i) { return '<button type="button" class="rf-fb-cat' + (i === 0 ? ' on' : '') + '" data-c="' + c.id + '">' + c.label + '</button>'; }).join('') + '</div>'
      + '<textarea placeholder="Kısaca anlat (örn. \'PID modunda buton çalışmadı\')"></textarea>'
      + '<div class="rf-fb-body"></div>'
      + '<div class="rf-fb-row"><button type="button" class="rf-fb-x">Vazgeç</button><button type="button" class="rf-fb-send">Gönder</button></div>'
      + '</div>';
    document.body.appendChild(ov);

    function open() { ov.classList.add('show'); var ta = ov.querySelector('textarea'); if (ta) setTimeout(function () { ta.focus(); }, 30); }
    function close() { ov.classList.remove('show'); }

    btn.onclick = open;
    ov.querySelector('.rf-fb-x').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelectorAll('.rf-fb-cat').forEach(function (b) {
      b.onclick = function () { ov.querySelectorAll('.rf-fb-cat').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); chosen.c = b.getAttribute('data-c'); };
    });
    ov.querySelector('.rf-fb-send').onclick = function () {
      var ta = ov.querySelector('textarea');
      RFFeedback.add(chosen.c, ta ? ta.value.trim() : '');
      var card = ov.querySelector('.rf-fb-card');
      card.innerHTML = '<h3>🐞 Geri bildirim</h3><div class="rf-fb-thanks">✅ Teşekkürler! Kaydedildi.</div>';
      setTimeout(close, 1100);
    };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})(typeof window !== 'undefined' ? window : globalThis);
