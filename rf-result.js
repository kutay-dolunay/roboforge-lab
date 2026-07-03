/* =============================================================================
 * RoboForge — Shared result / coaching / run-graph toolkit  (rf-result.js) v1.0.0
 * -----------------------------------------------------------------------------
 * Reusable pieces for a DEEP end-of-run experience. Labs keep their own result
 * panel; they just CALL these helpers to render rich, teaching-focused content.
 *
 *   RFResult.graph(canvas, cfg)   — draw a themed line/area chart on a canvas
 *   RFResult.coachHTML(tips,opts) — structured "ne oldu → neden → ne yapmalı" block
 *   RFResult.celebrate(opts)      — win personality (confetti burst + medal shine)
 *   RFResult.line(series,cfg)     — returns an <canvas> element pre-drawn (convenience)
 *
 * NO external libraries. Pure canvas. Themeable via CSS variables (reads them off
 * :root at call time so it always matches rf-theme.css).
 * ========================================================================== */
(function (global) {
  'use strict';

  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  var PALETTE = function () {
    return {
      bg:      cssVar('--panel', '#0f172a'),
      grid:    'rgba(148,163,184,.13)',
      axis:    cssVar('--muted', '#64748b'),
      txt:     cssVar('--muted2', '#94a3b8'),
      sky:     cssVar('--sky', '#38bdf8'),
      green:   cssVar('--green', '#22c55e'),
      amber:   cssVar('--amber', '#f59e0b'),
      red:     cssVar('--red', '#ef4444'),
      purple:  cssVar('--purple', '#a855f7'),
    };
  };

  // -------------------------------------------------------------------------
  // graph(): draw one or more series on a canvas.
  // cfg = {
  //   series: [ { data:[{x,y}] | [y0,y1,...], color, label, area?, dashed? }, ... ],
  //   xlabel, ylabel, title,
  //   yZero (bool: include 0 in y-range), band:{from,to,color,label} (target zone),
  //   markers:[{x,y,color,label}], hline:{y,color,label}
  // }
  // -------------------------------------------------------------------------
  function graph(canvas, cfg) {
    if (!canvas || !canvas.getContext) return;
    cfg = cfg || {};
    var P = PALETTE();
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var cssW = canvas.clientWidth || canvas.width || 300;
    var cssH = canvas.clientHeight || canvas.height || 160;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var padL = 40, padR = 12, padT = cfg.title ? 22 : 10, padB = cfg.xlabel ? 30 : 18;
    var W = cssW - padL - padR, H = cssH - padT - padB;

    // normalize series data → arrays of {x,y}
    var series = (cfg.series || []).map(function (s) {
      var data = s.data || [];
      if (data.length && typeof data[0] === 'number') data = data.map(function (y, i) { return { x: i, y: y }; });
      return Object.assign({}, s, { data: data });
    });

    // compute ranges
    var xs = [], ys = [];
    series.forEach(function (s) { s.data.forEach(function (p) { xs.push(p.x); ys.push(p.y); }); });
    if (cfg.band) { ys.push(cfg.band.from); ys.push(cfg.band.to); }
    if (cfg.hline) ys.push(cfg.hline.y);
    if (cfg.yZero) ys.push(0);
    if (!xs.length) { xs = [0, 1]; ys = ys.length ? ys : [0, 1]; }
    var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    var ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
    if (xmax === xmin) xmax = xmin + 1;
    if (ymax === ymin) ymax = ymin + 1;
    var ypad = (ymax - ymin) * 0.08; ymin -= ypad; ymax += ypad;

    function X(x) { return padL + (x - xmin) / (xmax - xmin) * W; }
    function Y(y) { return padT + (1 - (y - ymin) / (ymax - ymin)) * H; }

    // title
    if (cfg.title) {
      ctx.fillStyle = P.txt; ctx.font = '700 11px system-ui,sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(cfg.title, padL, 13);
    }
    // grid + y ticks
    ctx.strokeStyle = P.grid; ctx.fillStyle = P.axis;
    ctx.font = '9px ui-monospace,monospace'; ctx.textAlign = 'right'; ctx.lineWidth = 1;
    var ticks = 4;
    for (var i = 0; i <= ticks; i++) {
      var yv = ymin + (ymax - ymin) * i / ticks, yy = Y(yv);
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + W, yy); ctx.stroke();
      ctx.fillText((Math.abs(yv) >= 100 ? yv.toFixed(0) : yv.toFixed(1)), padL - 5, yy + 3);
    }

    // target band (e.g. "good zone")
    if (cfg.band) {
      ctx.fillStyle = cfg.band.color || 'rgba(34,197,94,.10)';
      ctx.fillRect(padL, Y(cfg.band.to), W, Y(cfg.band.from) - Y(cfg.band.to));
      if (cfg.band.label) {
        ctx.fillStyle = P.green; ctx.font = '9px system-ui'; ctx.textAlign = 'left';
        ctx.fillText(cfg.band.label, padL + 4, Y(cfg.band.to) + 11);
      }
    }
    // horizontal reference line (e.g. target = 0)
    if (cfg.hline) {
      ctx.strokeStyle = cfg.hline.color || P.amber; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(padL, Y(cfg.hline.y)); ctx.lineTo(padL + W, Y(cfg.hline.y)); ctx.stroke();
      ctx.setLineDash([]);
    }

    // series
    series.forEach(function (s) {
      if (!s.data.length) return;
      var col = s.color || P.sky;
      if (s.area) {
        var grad = ctx.createLinearGradient(0, padT, 0, padT + H);
        grad.addColorStop(0, hexA(col, .28)); grad.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = grad; ctx.beginPath();
        ctx.moveTo(X(s.data[0].x), Y(Math.max(ymin, 0)));
        s.data.forEach(function (p) { ctx.lineTo(X(p.x), Y(p.y)); });
        ctx.lineTo(X(s.data[s.data.length - 1].x), Y(Math.max(ymin, 0)));
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      if (s.dashed) ctx.setLineDash([5, 4]);
      ctx.beginPath();
      s.data.forEach(function (p, i) { var px = X(p.x), py = Y(p.y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.stroke(); ctx.setLineDash([]);
    });

    // markers
    (cfg.markers || []).forEach(function (m) {
      ctx.fillStyle = m.color || P.red;
      ctx.beginPath(); ctx.arc(X(m.x), Y(m.y), 3.5, 0, 7); ctx.fill();
      if (m.label) { ctx.font = '9px system-ui'; ctx.textAlign = 'center'; ctx.fillText(m.label, X(m.x), Y(m.y) - 6); }
    });

    // axis labels
    ctx.fillStyle = P.axis; ctx.font = '9px system-ui';
    if (cfg.xlabel) { ctx.textAlign = 'center'; ctx.fillText(cfg.xlabel, padL + W / 2, cssH - 6); }
    if (cfg.ylabel) { ctx.save(); ctx.translate(11, padT + H / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(cfg.ylabel, 0, 0); ctx.restore(); }

    // legend (if >1 labeled series)
    var labeled = series.filter(function (s) { return s.label; });
    if (labeled.length > 1) {
      var lx = padL + 4, ly = padT + 4;
      ctx.textAlign = 'left'; ctx.font = '9px system-ui';
      labeled.forEach(function (s) {
        ctx.fillStyle = s.color || P.sky; ctx.fillRect(lx, ly - 6, 10, 3);
        ctx.fillStyle = P.txt; ctx.fillText(s.label, lx + 14, ly - 3);
        lx += 20 + ctx.measureText(s.label).width + 8;
      });
    }
  }

  // convenience: build a canvas element + draw
  function line(cfg, w, h) {
    var c = document.createElement('canvas');
    c.className = 'rf-graph';
    c.style.width = (w || '100%'); c.style.height = (h || 150) + 'px';
    // draw after it's in the DOM (needs clientWidth); caller should append then call graph,
    // but we also try a microtask fallback.
    requestAnimationFrame(function () { graph(c, cfg); });
    return c;
  }

  // -------------------------------------------------------------------------
  // bars(): draw a categorical bar chart. cfg = {
  //   data: [{label, value, color?}], max?(auto), title?, unit?, target?{value,label}
  // }  Each bar can also be a STACK: {label, parts:[{value,color,tag}]}.
  // -------------------------------------------------------------------------
  function bars(canvas, cfg) {
    if (!canvas || !canvas.getContext) return;
    cfg = cfg || {}; var P = PALETTE();
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var cssW = canvas.clientWidth || 300, cssH = canvas.clientHeight || 150;
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    var data = cfg.data || [];
    var padT = cfg.title ? 22 : 10, padB = 26, padL = 10, padR = 10;
    var W = cssW - padL - padR, H = cssH - padT - padB;
    var vals = data.map(function (d) { return d.parts ? d.parts.reduce(function (a, p) { return a + p.value; }, 0) : d.value; });
    var max = cfg.max || Math.max.apply(null, vals.concat(cfg.target ? [cfg.target.value] : [0]).concat([1]));
    if (cfg.title) { ctx.fillStyle = P.txt; ctx.font = '700 11px system-ui'; ctx.textAlign = 'left'; ctx.fillText(cfg.title, padL, 13); }
    var n = data.length || 1, gap = 12, bw = Math.max(8, (W - gap * (n - 1)) / n);
    var cols = [P.sky, P.green, P.amber, P.purple, P.red];
    // target line
    if (cfg.target) {
      var ty = padT + (1 - cfg.target.value / max) * H;
      ctx.strokeStyle = P.amber; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(padL, ty); ctx.lineTo(padL + W, ty); ctx.stroke(); ctx.setLineDash([]);
      if (cfg.target.label) { ctx.fillStyle = P.amber; ctx.font = '9px system-ui'; ctx.textAlign = 'right'; ctx.fillText(cfg.target.label, padL + W, ty - 3); }
    }
    data.forEach(function (d, i) {
      var x = padL + i * (bw + gap);
      if (d.parts) {
        var yb = padT + H;
        d.parts.forEach(function (pt) {
          var ph = pt.value / max * H; yb -= ph;
          ctx.fillStyle = pt.color || cols[0]; roundRectFill(ctx, x, yb, bw, ph, 3);
        });
      } else {
        var bh = Math.max(0, d.value / max * H), by = padT + H - bh;
        ctx.fillStyle = d.color || cols[i % cols.length]; roundRectFill(ctx, x, by, bw, bh, 4);
        ctx.fillStyle = P.txt; ctx.font = '700 10px system-ui'; ctx.textAlign = 'center';
        ctx.fillText((Math.round(d.value * 10) / 10) + (cfg.unit || ''), x + bw / 2, by - 4);
      }
      ctx.fillStyle = P.axis; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
      wrapLabel(ctx, d.label, x + bw / 2, padT + H + 12, bw + gap);
    });
  }

  // -------------------------------------------------------------------------
  // gauge(): a semicircular gauge. cfg = { value, max, label, unit, zones?:[{to,color}] }
  // Great for "how good was it" single-number results (accuracy, power, coverage).
  // -------------------------------------------------------------------------
  function gauge(canvas, cfg) {
    if (!canvas || !canvas.getContext) return;
    cfg = cfg || {}; var P = PALETTE();
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var cssW = canvas.clientWidth || 220, cssH = canvas.clientHeight || 130;
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    var max = cfg.max || 100, val = Math.max(0, Math.min(max, cfg.value || 0));
    var cx = cssW / 2, cy = cssH - 20, r = Math.min(cssW / 2 - 12, cssH - 34);
    var A0 = Math.PI, A1 = 2 * Math.PI; // left→right, top half
    // track
    ctx.lineWidth = 13; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(148,163,184,.16)'; ctx.beginPath(); ctx.arc(cx, cy, r, A0, A1); ctx.stroke();
    // zones (optional colored arcs)
    var zones = cfg.zones || [{ to: max, color: P.green }];
    var prev = 0;
    zones.forEach(function (z) {
      var a = A0 + (prev / max) * Math.PI, b = A0 + (z.to / max) * Math.PI;
      ctx.strokeStyle = hexA(z.color, .35); ctx.beginPath(); ctx.arc(cx, cy, r, a, b); ctx.stroke(); prev = z.to;
    });
    // value arc
    var frac = val / max, col = P.sky;
    zones.forEach(function (z) { if (val <= z.to && col === P.sky) col = z.color; });
    ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(cx, cy, r, A0, A0 + frac * Math.PI); ctx.stroke();
    // needle dot
    var na = A0 + frac * Math.PI;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx + Math.cos(na) * r, cy + Math.sin(na) * r, 5, 0, 7); ctx.fill();
    // center number
    ctx.fillStyle = P.txt; ctx.textAlign = 'center';
    ctx.font = '800 22px system-ui'; ctx.fillText((Math.round(val * 10) / 10) + (cfg.unit || ''), cx, cy - 6);
    if (cfg.label) { ctx.fillStyle = P.axis; ctx.font = '10px system-ui'; ctx.fillText(cfg.label, cx, cy + 12); }
  }

  function roundRectFill(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2); if (h <= 0) return;
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, 0);
    ctx.arcTo(x, y + h, x, y, 0); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
  }
  function wrapLabel(ctx, text, cx, y, maxw) {
    text = String(text || '');
    if (ctx.measureText(text).width <= maxw) { ctx.fillText(text, cx, y); return; }
    var words = text.split(' '), line = '', lines = [];
    words.forEach(function (w) { var t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxw && line) { lines.push(line); line = w; } else line = t; });
    if (line) lines.push(line);
    lines.slice(0, 2).forEach(function (ln, i) { ctx.fillText(ln, cx, y + i * 10); });
  }

  // -------------------------------------------------------------------------
  // coachHTML(): structured coaching. tips = array of strings from core coach(sim).
  // opts = { win:bool, headWin, headLose, reason }
  // -------------------------------------------------------------------------
  function coachHTML(tips, opts) {
    tips = (tips || []).filter(Boolean);
    opts = opts || {};
    if (!tips.length && !opts.reason) return '';
    var out = '<div class="rf-coach' + (opts.win ? ' win' : ' lose') + '">';
    var head = opts.win ? (opts.headWin || '🎓 Ne öğrendik?') : (opts.headLose || '🔍 Ne oldu, neden?');
    out += '<div class="rf-coach-h">' + head + '</div>';
    if (opts.reason && !opts.win) out += '<div class="rf-coach-why">' + esc(opts.reason) + '</div>';
    out += '<ul class="rf-coach-tips">';
    tips.forEach(function (t) { out += '<li>' + esc(t) + '</li>'; });
    out += '</ul></div>';
    return out;
  }

  // -------------------------------------------------------------------------
  // celebrate(): lightweight confetti burst for wins. opts={medal:'🏆', el}
  // -------------------------------------------------------------------------
  function celebrate(opts) {
    opts = opts || {};
    try {
      if (matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    } catch (e) {}
    var P = PALETTE();
    var cols = [P.sky, P.green, P.amber, P.purple, '#fff'];
    var cv = document.createElement('canvas');
    cv.className = 'rf-confetti';
    cv.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:200';
    document.body.appendChild(cv);
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    var ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    var N = 90, parts = [];
    for (var i = 0; i < N; i++) parts.push({
      x: innerWidth / 2 + (Math.random() - .5) * 120, y: innerHeight * 0.32,
      vx: (Math.random() - .5) * 9, vy: -6 - Math.random() * 9,
      s: 4 + Math.random() * 5, c: cols[i % cols.length], r: Math.random() * 6, vr: (Math.random() - .5) * .4
    });
    var t0 = performance.now();
    (function frame(now) {
      var dt = 16;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach(function (p) {
        p.vy += 0.28; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - (now - t0) / 1600);
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore();
      });
      if (now - t0 < 1600) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }

  // helpers
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function hexA(hex, a) {
    // accept #rrggbb or rgb()/var already-resolved; fallback to sky
    if (hex && hex[0] === '#' && hex.length >= 7) {
      var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }
    return 'rgba(56,189,248,' + a + ')';
  }

  var RFResult = { graph: graph, bars: bars, gauge: gauge, line: line, coachHTML: coachHTML, celebrate: celebrate, _palette: PALETTE };
  global.RFResult = RFResult;
  if (typeof module !== 'undefined' && module.exports) module.exports = RFResult;
})(typeof window !== 'undefined' ? window : globalThis);
/* rf-result v1.1 : + bars() + gauge() */
