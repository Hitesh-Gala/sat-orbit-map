// Site Analytics — a lightweight, self-hosted visitor log for NAZAR.
//
// Two jobs:
//   1. LOGGER (every page): once per browsing session, record the visitor's
//      IP + approximate location, browser and OS to a central store — unless
//      this is the owner's own machine (see OWNER_FLAG) or the store isn't
//      configured yet.
//   2. VIEWER (About page only): a password-gated "Site Analytics" button
//      (top-left) opens a pop-up table of every logged visitor.
//
// ── Static-site reality ─────────────────────────────────────────────────
// GitHub Pages has no backend, so a browser cannot keep a shared visitor log
// on its own.  The list lives in a tiny cloud JSON store (jsonbin.io); set
// CFG.binId + CFG.key below to switch it on.  Until then everything here is a
// safe no-op — the site is unaffected and nothing is recorded.
//
// ⚠ PRIVACY: this records visitors' IP-derived location.  The store key sits
// in this (public) file, so treat the collected data as low-sensitivity and
// keep a visitor privacy note on the site.  A stricter, key-private option
// (Firebase/Apps Script with owner sign-in) is possible on request.

(function () {
  'use strict';

  var CFG = {
    password: 'QWqw!@12',      // opens the Site Analytics panel
    binId: '',                 // jsonbin.io bin id  (see setup in chat/README)
    key: '',                   // jsonbin access key (read + update on that bin)
    maxRows: 1000,             // keep the newest N visits
  };

  var OWNER_FLAG = 'nazar.owner';        // localStorage: this machine is the owner → never logged
  var SESS_FLAG  = 'nazar.va.logged';    // sessionStorage: already logged this session

  var configured = function () { return !!(CFG.binId && CFG.key); };

  // ── helpers ────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtTime(ms) {
    try { return new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return String(ms); }
  }
  function deviceInfo() {
    var ua = navigator.userAgent || '';
    var os = 'Unknown';
    if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
    else if (/Windows NT/.test(ua)) os = 'Windows';
    else if (/iPhone/.test(ua)) os = 'iOS (iPhone)';
    else if (/iPad/.test(ua)) os = 'iPadOS';
    else if (/Mac OS X/.test(ua)) os = 'macOS';
    else if (/Android[ ;]([\d.]+)/.test(ua)) os = 'Android ' + RegExp.$1;
    else if (/Android/.test(ua)) os = 'Android';
    else if (/CrOS/.test(ua)) os = 'ChromeOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    var br = 'Unknown';
    if (/Edg\/(\d+)/.test(ua)) br = 'Edge ' + RegExp.$1;
    else if (/OPR\/(\d+)/.test(ua)) br = 'Opera ' + RegExp.$1;
    else if (/Chrome\/(\d+)/.test(ua)) br = 'Chrome ' + RegExp.$1;
    else if (/Firefox\/(\d+)/.test(ua)) br = 'Firefox ' + RegExp.$1;
    else if (/Version\/(\d+)[\d.]*\s+.*Safari/.test(ua)) br = 'Safari ' + RegExp.$1;
    else if (/Safari/.test(ua)) br = 'Safari';
    return { browser: br, os: os };
  }
  function fetchJson(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }); }
  function withTimeout(p, ms) {
    return new Promise(function (resolve) {
      var done = false, t = setTimeout(function () { if (!done) { done = true; resolve({}); } }, ms);
      p.then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
             function () { if (!done) { done = true; clearTimeout(t); resolve({}); } });
    });
  }
  function fetchGeo() {
    var p = fetchJson('https://ipwho.is/').then(function (d) {
      if (d && d.success !== false && d.ip) return { ip: d.ip, city: d.city || '', region: d.region || '', country: d.country || '' };
      throw 0;
    }).catch(function () {
      return fetchJson('https://get.geojs.io/v1/ip/geo.json').then(function (d) {
        return (d && d.ip) ? { ip: d.ip, city: d.city || '', region: d.region || '', country: d.country || '' } : {};
      });
    });
    return withTimeout(p, 4500);
  }

  // ── jsonbin store ──────────────────────────────────────────────────────
  function jbGet() {
    return fetch('https://api.jsonbin.io/v3/b/' + CFG.binId + '/latest', { headers: { 'X-Access-Key': CFG.key } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { return Array.isArray(j.record) ? j.record : []; });
  }
  function jbPut(arr) {
    return fetch('https://api.jsonbin.io/v3/b/' + CFG.binId, {
      method: 'PUT',
      headers: { 'X-Access-Key': CFG.key, 'Content-Type': 'application/json', 'X-Bin-Versioning': 'false' },
      body: JSON.stringify(arr),
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r; });
  }

  // ── logger ─────────────────────────────────────────────────────────────
  function logVisit() {
    if (!configured()) return;
    try { if (localStorage.getItem(OWNER_FLAG) === '1') return; } catch (e) {}       // owner's own machine
    try { if (sessionStorage.getItem(SESS_FLAG) === '1') return; sessionStorage.setItem(SESS_FLAG, '1'); } catch (e) {}
    fetchGeo().then(function (geo) {
      var di = deviceInfo();
      var rec = {
        ts: Date.now(),
        ip: geo.ip || '', city: geo.city || '', region: geo.region || '', country: geo.country || '',
        browser: di.browser, os: di.os,
        page: location.pathname, ref: document.referrer || '',
        lang: navigator.language || '',
        screen: (window.screen ? screen.width + '×' + screen.height : ''),
        ua: navigator.userAgent || '',
      };
      jbGet().then(function (arr) {
        arr = Array.isArray(arr) ? arr : [];
        arr.unshift(rec);
        if (arr.length > CFG.maxRows) arr = arr.slice(0, CFG.maxRows);
        jbPut(arr).catch(function () {});
      }).catch(function () {});
    });
  }

  // ── viewer (About page) ──────────────────────────────────────────────────
  var CSS = ''
    + '.va-btn{position:fixed;top:14px;left:14px;z-index:60;display:inline-flex;align-items:center;gap:8px;'
    + 'padding:8px 15px;border-radius:6px;cursor:pointer;font-family:var(--mono);font-size:13px;font-weight:700;'
    + 'letter-spacing:.14em;text-transform:uppercase;color:var(--accent);background:rgba(2,6,13,.85);'
    + 'border:1px solid var(--accent);box-shadow:0 4px 16px rgba(0,0,0,.45);backdrop-filter:blur(8px);'
    + '-webkit-backdrop-filter:blur(8px);transition:background .15s,transform .15s}'
    + '.va-btn:hover{background:rgba(103,200,255,.22);transform:scale(1.03)}'
    + '.va-btn .ic{font-size:15px;color:#ffd166}'
    + '@media(max-width:720px){.va-btn{top:52px;left:8px;padding:6px 11px;font-size:11px;letter-spacing:.1em}}'
    + '.va-modal{position:fixed;inset:0;z-index:1500;display:flex;align-items:center;justify-content:center;padding:20px;'
    + 'background:rgba(3,7,13,.78);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)}'
    + '.va-modal[hidden]{display:none}'
    + '.va-card{width:min(1000px,100%);max-height:calc(100vh - 40px);display:flex;flex-direction:column;background:var(--panel);'
    + 'border:1px solid var(--line);border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.6);'
    + 'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}'
    + '.va-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 20px;'
    + 'border-bottom:1px solid var(--line)}'
    + '.va-title{font-family:"Orbitron",sans-serif;font-weight:700;font-size:16px;color:#fff}'
    + '.va-sum{margin-top:5px;font-family:var(--mono);font-size:12px;color:var(--dim);line-height:1.55}'
    + '.va-sum b{color:#ffd166}'
    + '.va-x{flex:none;width:34px;height:34px;border-radius:8px;cursor:pointer;background:rgba(16,32,58,.7);color:#eaf2fb;'
    + 'border:1px solid var(--line);font-size:20px;line-height:1}.va-x:hover{border-color:var(--accent);color:var(--accent)}'
    + '.va-body{padding:0;overflow:auto;flex:1 1 auto}'
    + '.va-gate{padding:26px 20px;text-align:center}'
    + '.va-gate label{display:block;font-family:var(--mono);font-size:12px;color:var(--text);margin-bottom:10px}'
    + '.va-gate input{font:14px var(--mono);color:var(--text);background:rgba(103,200,255,.06);border:1px solid var(--line);'
    + 'border-radius:7px;padding:9px 12px;width:min(240px,80%)}'
    + '.va-gate input:focus{outline:none;border-color:var(--accent)}'
    + '.va-gate .err{color:#ff6b6b;font-family:var(--mono);font-size:12px;min-height:16px;margin-top:10px}'
    + '.va-btn2{font-family:var(--mono);font-size:13px;font-weight:700;border-radius:8px;padding:9px 18px;cursor:pointer;'
    + 'border:1px solid var(--accent);background:rgba(103,200,255,.14);color:#eaf6ff;margin-top:14px}'
    + '.va-btn2:hover{background:rgba(103,200,255,.26)}'
    + '.va-btn2.ghost{border-color:var(--line);background:transparent;color:var(--text)}'
    + '.va-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 20px;border-bottom:1px solid var(--line)}'
    + '.va-toolbar input{flex:1 1 220px;min-width:150px;font:13px var(--mono);color:var(--text);'
    + 'background:rgba(103,200,255,.05);border:1px solid var(--line);border-radius:6px;padding:8px 11px}'
    + '.va-toolbar input:focus{outline:none;border-color:var(--accent)}'
    + '.va-toolbar .link{font-family:var(--mono);font-size:12px;color:var(--accent);background:none;border:none;cursor:pointer;text-decoration:underline}'
    + '.va-table{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12px;color:var(--text)}'
    + '.va-table thead th{position:sticky;top:0;background:rgba(2,6,13,.96);border-bottom:1px solid var(--line);'
    + 'color:var(--dim);font-weight:normal;font-size:10px;letter-spacing:.1em;text-transform:uppercase;text-align:left;padding:8px 10px;white-space:nowrap}'
    + '.va-table tbody td{padding:7px 10px;border-bottom:1px solid rgba(110,200,255,.07);white-space:nowrap;vertical-align:top}'
    + '.va-table tbody tr:hover td{background:rgba(103,200,255,.06)}'
    + '.va-table td.ipc{color:#ffd166}.va-table td.wrap{white-space:normal;max-width:220px;word-break:break-word;color:var(--dim)}'
    + '.va-empty{padding:30px 20px;text-align:center;color:var(--dim);font-family:var(--mono);font-size:13px;line-height:1.7}'
    + '.va-empty code{color:#ffd166}';

  function buildViewer() {
    if (document.getElementById('va-open')) return;
    var style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);

    var btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'va-open'; btn.className = 'va-btn';
    btn.innerHTML = '<span class="ic">📊</span><span>Site Analytics</span>';
    document.body.appendChild(btn);

    var modal = document.createElement('div');
    modal.className = 'va-modal'; modal.id = 'va-modal'; modal.hidden = true;
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = ''
      + '<div class="va-card">'
      + '  <div class="va-head">'
      + '    <div><div class="va-title">Site Analytics</div><div class="va-sum" id="va-sum">Visitors to NAZAR.</div></div>'
      + '    <button type="button" class="va-x" id="va-close" aria-label="Close">×</button>'
      + '  </div>'
      + '  <div class="va-body">'
      + '    <div id="va-gate" class="va-gate">'
      + '      <label for="va-pw">Enter the owner password to view visitor analytics</label>'
      + '      <input id="va-pw" type="password" autocomplete="off" placeholder="••••••••">'
      + '      <div class="err" id="va-err"></div>'
      + '      <button type="button" class="va-btn2" id="va-unlock">Unlock</button>'
      + '    </div>'
      + '    <div id="va-panel" hidden>'
      + '      <div class="va-toolbar">'
      + '        <input type="search" id="va-filter" placeholder="Filter by IP, city, country, browser…">'
      + '        <button type="button" class="link" id="va-refresh">↻ Refresh</button>'
      + '        <button type="button" class="link" id="va-clear">🗑 Clear log</button>'
      + '      </div>'
      + '      <div id="va-list"></div>'
      + '    </div>'
      + '  </div>'
      + '</div>';
    document.body.appendChild(modal);

    var $ = function (id) { return document.getElementById(id); };
    var rows = [];

    function open() { modal.hidden = false; $('va-gate').hidden = false; $('va-panel').hidden = true; $('va-err').textContent = ''; $('va-pw').value = ''; setTimeout(function () { $('va-pw').focus(); }, 60); }
    function close() { modal.hidden = true; }
    function unlock() {
      if ($('va-pw').value !== CFG.password) { $('va-err').textContent = 'Incorrect password.'; $('va-pw').select(); return; }
      try { localStorage.setItem(OWNER_FLAG, '1'); } catch (e) {}   // this machine → stop logging it
      $('va-gate').hidden = true; $('va-panel').hidden = false;
      loadRows();
    }
    function loadRows() {
      $('va-list').innerHTML = '<div class="va-empty">Loading…</div>';
      if (!configured()) {
        $('va-list').innerHTML = '<div class="va-empty">The visitor log isn’t connected yet.<br>'
          + 'Create a free JSON bin at <code>jsonbin.io</code>, then set <code>binId</code> and <code>key</code> '
          + 'in <code>site-analytics.js</code> to switch it on.</div>';
        $('va-sum').textContent = 'Not connected.';
        return;
      }
      jbGet().then(function (arr) { rows = Array.isArray(arr) ? arr : []; render(); })
             .catch(function (e) { $('va-list').innerHTML = '<div class="va-empty">Could not load the log: ' + esc(e.message) + '</div>'; });
    }
    function render() {
      var q = ($('va-filter').value || '').trim().toLowerCase();
      var list = q ? rows.filter(function (r) { return (r.ip + ' ' + r.city + ' ' + r.country + ' ' + r.browser + ' ' + r.os + ' ' + r.page).toLowerCase().indexOf(q) !== -1; }) : rows;
      var ips = {}, countries = {};
      rows.forEach(function (r) { if (r.ip) ips[r.ip] = 1; if (r.country) countries[r.country] = 1; });
      var since = rows.length ? fmtTime(rows[rows.length - 1].ts) : '—';
      $('va-sum').innerHTML = '<b>' + rows.length + '</b> visits · <b>' + Object.keys(ips).length + '</b> unique IPs · <b>'
        + Object.keys(countries).length + '</b> countries · since ' + esc(since);
      if (!list.length) { $('va-list').innerHTML = '<div class="va-empty">' + (rows.length ? 'No visits match that filter.' : 'No visits logged yet.') + '</div>'; return; }
      var head = '<thead><tr><th>#</th><th>When</th><th>IP</th><th>City</th><th>Country</th><th>Browser</th><th>OS</th><th>Screen</th><th>Lang</th><th>Page</th><th>Referrer</th></tr></thead>';
      var body = list.map(function (r, i) {
        return '<tr>'
          + '<td>' + (i + 1) + '</td>'
          + '<td>' + esc(fmtTime(r.ts)) + '</td>'
          + '<td class="ipc">' + (esc(r.ip) || '—') + '</td>'
          + '<td>' + (esc([r.city, r.region].filter(Boolean).join(', ')) || '—') + '</td>'
          + '<td>' + (esc(r.country) || '—') + '</td>'
          + '<td>' + (esc(r.browser) || '—') + '</td>'
          + '<td>' + (esc(r.os) || '—') + '</td>'
          + '<td>' + (esc(r.screen) || '—') + '</td>'
          + '<td>' + (esc(r.lang) || '—') + '</td>'
          + '<td>' + (esc(r.page) || '—') + '</td>'
          + '<td class="wrap">' + (esc(r.ref) || '—') + '</td>'
          + '</tr>';
      }).join('');
      $('va-list').innerHTML = '<div style="overflow-x:auto"><table class="va-table">' + head + '<tbody>' + body + '</tbody></table></div>';
    }

    btn.addEventListener('click', open);
    $('va-close').addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) close(); });
    $('va-unlock').addEventListener('click', unlock);
    $('va-pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') unlock(); });
    $('va-refresh').addEventListener('click', loadRows);
    $('va-filter').addEventListener('input', render);
    $('va-clear').addEventListener('click', function () {
      if (!configured()) return;
      if (!confirm('Permanently delete the entire visitor log?')) return;
      jbPut([]).then(function () { rows = []; render(); }).catch(function (e) { alert('Could not clear: ' + e.message); });
    });
  }

  // ── init ─────────────────────────────────────────────────────────────────
  function init() {
    logVisit();
    if (document.body && document.body.classList.contains('page-about')) buildViewer();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
