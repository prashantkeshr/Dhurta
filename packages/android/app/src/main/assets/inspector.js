/* Dhurta Inspector — on-device inspect-element + console for the mobile browser.
   Injected by MainActivity (menu → Inspect element). Toggle-safe: injecting the
   script again tears the panel down, so one menu tap = on, next tap = off. */
(function () {
  'use strict';
  if (window.__dhurtaInspector) { window.__dhurtaInspector.destroy(); return; }

  var Z = 2147483000;
  var panel, hl, tabEl, tabCon, bodyEl, picking = false, logs = [];

  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  // ── console capture (kept even while panel shows Elements) ──
  var orig = {};
  ['log', 'warn', 'error', 'info'].forEach(function (k) {
    orig[k] = console[k];
    console[k] = function () {
      var msg = Array.prototype.map.call(arguments, function (a) {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
        catch (e) { return String(a); }
      }).join(' ');
      logs.push({ k: k, m: msg });
      if (logs.length > 200) logs.shift();
      renderConsole();
      return orig[k].apply(console, arguments);
    };
  });
  var onErr = function (e) {
    logs.push({ k: 'error', m: (e.message || 'error') + ' @' + (e.filename || '') + ':' + (e.lineno || '') });
    renderConsole();
  };
  window.addEventListener('error', onErr);

  // ── highlight box ──
  hl = el('div', 'position:fixed;pointer-events:none;z-index:' + Z + ';border:1.5px solid #00e5ff;background:rgba(0,229,255,.14);border-radius:2px;display:none;');
  document.documentElement.appendChild(hl);

  // ── panel ──
  panel = el('div',
    'position:fixed;left:0;right:0;bottom:0;height:42vh;z-index:' + (Z + 1) +
    ';background:#0b0e14f2;color:#e8e8e8;font:11px/1.5 monospace;border-top:1px solid #00e5ff55;' +
    'display:flex;flex-direction:column;backdrop-filter:blur(8px);');
  var bar = el('div', 'display:flex;align-items:center;border-bottom:1px solid #ffffff22;flex:0 0 auto;');
  tabEl = el('div', 'padding:9px 14px;color:#00e5ff;border-bottom:2px solid #00e5ff;', 'Elements');
  tabCon = el('div', 'padding:9px 14px;color:#888;', 'Console');
  var pick = el('div', 'padding:9px 14px;margin-left:auto;color:#ffb300;', '◎ Pick');
  var close = el('div', 'padding:9px 14px;color:#ff5370;', '✕');
  bar.appendChild(tabEl); bar.appendChild(tabCon); bar.appendChild(pick); bar.appendChild(close);
  bodyEl = el('div', 'flex:1 1 auto;overflow:auto;padding:10px 12px;-webkit-overflow-scrolling:touch;');
  panel.appendChild(bar); panel.appendChild(bodyEl);
  document.documentElement.appendChild(panel);

  var view = 'el';
  function setView(v) {
    view = v;
    tabEl.style.color = v === 'el' ? '#00e5ff' : '#888';
    tabEl.style.borderBottom = v === 'el' ? '2px solid #00e5ff' : 'none';
    tabCon.style.color = v === 'con' ? '#00e5ff' : '#888';
    tabCon.style.borderBottom = v === 'con' ? '2px solid #00e5ff' : 'none';
    if (v === 'con') renderConsole(); else if (!bodyEl.__hasEl) showHint();
  }
  tabEl.addEventListener('click', function () { setView('el'); });
  tabCon.addEventListener('click', function () { setView('con'); });

  function showHint() {
    bodyEl.innerHTML = '';
    bodyEl.appendChild(el('div', 'color:#888;', 'Tap "◎ Pick", then tap any element on the page to inspect it.'));
  }

  function renderConsole() {
    if (view !== 'con' || !bodyEl) return;
    bodyEl.innerHTML = '';
    if (!logs.length) { bodyEl.appendChild(el('div', 'color:#888;', 'No console output yet.')); return; }
    logs.slice(-100).forEach(function (l) {
      var c = l.k === 'error' ? '#ff5370' : l.k === 'warn' ? '#ffb300' : '#a6e22e';
      bodyEl.appendChild(el('div', 'color:' + c + ';border-bottom:1px solid #ffffff11;padding:2px 0;word-break:break-all;', '[' + l.k + '] ' + l.m));
    });
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function cssPath(n) {
    var p = [];
    while (n && n.nodeType === 1 && p.length < 5) {
      var s = n.tagName.toLowerCase();
      if (n.id) { p.unshift(s + '#' + n.id); break; }
      if (n.className && typeof n.className === 'string' && n.className.trim())
        s += '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.');
      p.unshift(s);
      n = n.parentElement;
    }
    return p.join(' > ');
  }

  function inspect(t) {
    var r = t.getBoundingClientRect();
    hl.style.display = 'block';
    hl.style.left = r.left + 'px'; hl.style.top = r.top + 'px';
    hl.style.width = r.width + 'px'; hl.style.height = r.height + 'px';

    var cs = getComputedStyle(t);
    var keys = ['display', 'position', 'width', 'height', 'margin', 'padding', 'color',
      'background-color', 'font-size', 'font-family', 'z-index', 'opacity', 'flex', 'grid-area'];
    bodyEl.innerHTML = ''; bodyEl.__hasEl = true;
    bodyEl.appendChild(el('div', 'color:#00e5ff;font-size:12px;margin-bottom:4px;word-break:break-all;', cssPath(t)));
    bodyEl.appendChild(el('div', 'color:#ffb300;margin-bottom:6px;', Math.round(r.width) + ' × ' + Math.round(r.height) + ' px'));
    var attrs = Array.prototype.map.call(t.attributes || [], function (a) { return a.name + '="' + a.value + '"'; }).join(' ');
    if (attrs) bodyEl.appendChild(el('div', 'color:#c792ea;margin-bottom:6px;word-break:break-all;', '<' + t.tagName.toLowerCase() + ' ' + attrs + '>'));
    keys.forEach(function (k) {
      var v = cs.getPropertyValue(k);
      if (!v || v === 'none' || v === 'auto' || v === 'normal') return;
      var row = el('div', 'border-bottom:1px solid #ffffff11;padding:2px 0;');
      row.appendChild(el('span', 'color:#82aaff;', k + ': '));
      row.appendChild(el('span', 'color:#e8e8e8;word-break:break-all;', v));
      bodyEl.appendChild(row);
    });
    var html = t.outerHTML;
    if (html.length > 600) html = html.slice(0, 600) + '…';
    bodyEl.appendChild(el('pre', 'color:#a6e22e;white-space:pre-wrap;word-break:break-all;margin-top:8px;border-top:1px solid #ffffff22;padding-top:6px;', html));
  }

  function onPick(e) {
    if (!picking) return;
    var t = e.target;
    if (panel.contains(t)) return;
    e.preventDefault(); e.stopPropagation();
    picking = false;
    pick.style.color = '#ffb300';
    setView('el');
    inspect(t);
  }
  document.addEventListener('click', onPick, true);
  pick.addEventListener('click', function () {
    picking = !picking;
    pick.style.color = picking ? '#00ff9d' : '#ffb300';
    if (picking) { setView('el'); bodyEl.innerHTML = ''; bodyEl.appendChild(el('div', 'color:#00ff9d;', 'Picking… tap an element on the page.')); }
  });
  close.addEventListener('click', function () { window.__dhurtaInspector.destroy(); });

  showHint();

  window.__dhurtaInspector = {
    destroy: function () {
      try {
        ['log', 'warn', 'error', 'info'].forEach(function (k) { console[k] = orig[k]; });
        window.removeEventListener('error', onErr);
        document.removeEventListener('click', onPick, true);
        panel.remove(); hl.remove();
      } catch (e) { }
      delete window.__dhurtaInspector;
    }
  };
})();
