// Site Analytics — NAZAR's own visitor log.
//
//   • LOGGER (every page): one row per visit in the owner's Google Sheet —
//     IP + approximate location, device, OS, browser, pages seen and time spent
//     (foreground seconds, summed across every page of the visit).  Skipped on
//     the owner's machine (OWNER_FLAG), for automated browsers, on the
//     dashboard itself, and until CFG.endpoint is set.
//   • GATE (About page): the "Site Analytics" button asks for the owner
//     password, then opens the dashboard (site-analytics.html).
//
// Backend: site-analytics-backend.gs — an Apps Script bound to a Google Sheet
// (setup steps at the top of that file).  It returns the log only when the
// password checks out server-side; this public file holds just its SHA-256.

(function () {
  'use strict';

  var CFG = {
    endpoint: '',   // Apps Script web-app URL (…/exec) — see site-analytics-backend.gs
    passwordSha256: '06566c03087e9156bc49a006dc116d4a129c7ae7d0101f100219d644dc04a89a',
    heartbeatMs: 5 * 60 * 1000,   // safety-net update in case a tab dies without a pagehide
  };

  var OWNER_FLAG = 'nazar.owner';     // localStorage: the owner's machine → never logged
  var VID_KEY    = 'nazar.va.vid';    // localStorage: random visitor id → unique-user count
  var SESS_KEY   = 'nazar.va.sess';   // sessionStorage: this visit {sid, started, ms, pages}
  var PW_KEY     = 'nazar.va.pw';     // sessionStorage: password handed to the dashboard

  function sha256(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }

  // Shared with the dashboard page (site-analytics-view.js).
  window.NazarAnalytics = { CFG: CFG, sha256: sha256, PW_KEY: PW_KEY, OWNER_FLAG: OWNER_FLAG };

  function getItem(area, key) { try { return window[area].getItem(key); } catch (e) { return null; } }
  function setItem(area, key, val) { try { window[area].setItem(key, val); } catch (e) { /* storage blocked */ } }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  // ── device, OS, browser ────────────────────────────────────────────────
  function parseUA(ua) {
    var m;
    var touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;   // iPadOS requests desktop sites as a Mac
    var iosVer = (m = /(?:iPhone|CPU) OS (\d+)[_.](\d+)/.exec(ua)) ? ' ' + m[1] + '.' + m[2] : '';

    var os = 'Unknown';
    if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
    else if (/Windows NT 6\.3/.test(ua)) os = 'Windows 8.1';
    else if (/Windows NT 6\.1/.test(ua)) os = 'Windows 7';
    else if (/Windows/.test(ua)) os = 'Windows';
    else if (/iPad/.test(ua) || touchMac) os = 'iPadOS' + iosVer;
    else if (/iPhone|iPod/.test(ua)) os = 'iOS' + iosVer;
    else if ((m = /Android (\d+(?:\.\d+)?)/.exec(ua))) os = 'Android ' + m[1];
    else if (/CrOS/.test(ua)) os = 'ChromeOS';
    else if (/Mac OS X/.test(ua)) os = 'macOS';
    else if (/Linux/.test(ua)) os = 'Linux';

    var browser = 'Unknown';
    if ((m = /Edg(?:A|iOS)?\/(\d+)/.exec(ua))) browser = 'Edge ' + m[1];
    else if ((m = /(?:OPR|OPiOS)\/(\d+)/.exec(ua))) browser = 'Opera ' + m[1];
    else if ((m = /SamsungBrowser\/(\d+)/.exec(ua))) browser = 'Samsung Internet ' + m[1];
    else if (/FBAN|FBAV/.test(ua)) browser = 'Facebook app';
    else if (/Instagram/.test(ua)) browser = 'Instagram app';
    else if (/LinkedInApp/.test(ua)) browser = 'LinkedIn app';
    else if ((m = /(?:Firefox|FxiOS)\/(\d+)/.exec(ua))) browser = 'Firefox ' + m[1];
    else if ((m = /(?:CriOS|Chrome)\/(\d+)/.exec(ua))) browser = 'Chrome ' + m[1];
    else if ((m = /Version\/(\d+)[\d.]*.*Safari/.exec(ua))) browser = 'Safari ' + m[1];
    else if (/Safari/.test(ua)) browser = 'Safari';

    var type = 'Desktop';
    if (/iPad|Tablet/.test(ua) || touchMac || (/Android/.test(ua) && !/Mobile/.test(ua))) type = 'Tablet';
    else if (/Mobi|iPhone|iPod|Android/.test(ua)) type = 'Mobile';

    var name = 'Unknown';
    var android = /Android[^;)]*;\s*([^;)]+?)(?:\s+Build\/|;|\))/.exec(ua);   // "Android 13; SM-S918B)"
    if (/iPhone/.test(ua)) name = 'iPhone';
    else if (/iPad/.test(ua) || touchMac) name = 'iPad';
    else if (/iPod/.test(ua)) name = 'iPod';
    else if (android && android[1] !== 'K') name = android[1];               // "K" = Chrome's frozen placeholder
    else if (/Android/.test(ua)) name = 'Android ' + type.toLowerCase();
    else if (/CrOS/.test(ua)) name = 'Chromebook';
    else if (/Windows/.test(ua)) name = 'Windows PC';
    else if (/Macintosh/.test(ua)) name = 'Mac';
    else if (/Linux/.test(ua)) name = 'Linux PC';

    return { os: os, browser: browser, deviceType: type, deviceName: name };
  }

  function baseInfo() {
    var ua = navigator.userAgent || '', d = parseUA(ua);
    d.screen = window.screen ? screen.width + '×' + screen.height : '';
    d.lang = navigator.language || '';
    try { d.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { d.tz = ''; }
    d.referrer = document.referrer || '';
    d.page = location.pathname;
    d.ua = ua;
    return d;
  }

  // Chromium's client hints give the real model, Windows 11 vs 10, and the
  // browser brand (Brave, etc.) that the frozen user-agent string hides.
  function refineInfo(d) {
    var uad = navigator.userAgentData;
    if (!uad || !uad.getHighEntropyValues) return Promise.resolve(d);
    return uad.getHighEntropyValues(['model', 'platformVersion', 'fullVersionList']).then(function (h) {
      var major = parseInt(h.platformVersion, 10);
      if (h.model) d.deviceName = h.model;                                   // e.g. "SM-S918B", "Pixel 8"
      if (h.platform === 'Windows' && major) d.os = major >= 13 ? 'Windows 11' : 'Windows 10';
      else if (h.platform === 'macOS' && h.platformVersion) d.os = 'macOS ' + h.platformVersion.split('.').slice(0, 2).join('.');
      else if (h.platform === 'Android' && major) d.os = 'Android ' + major;
      var brand = (h.fullVersionList || []).filter(function (x) { return !/Not.?A.?Brand|Chromium/i.test(x.brand); })[0];
      if (brand && /^Chrome/.test(d.browser)) d.browser = brand.brand.replace(/^Google /, '') + ' ' + parseInt(brand.version, 10);
      return d;
    }).catch(function () { return d; });
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function withTimeout(p, ms) {
    return Promise.race([p.catch(function () { return {}; }),
                         new Promise(function (resolve) { setTimeout(function () { resolve({}); }, ms); })]);
  }
  function fetchGeo() {
    var p = fetchJson('https://ipwho.is/').then(function (d) {
      if (!d || d.success === false || !d.ip) throw new Error('ipwho');
      return { ip: d.ip, country: d.country || '', region: d.region || '', city: d.city || '',
               isp: (d.connection && (d.connection.isp || d.connection.org)) || '' };
    }).catch(function () {
      return fetchJson('https://get.geojs.io/v1/ip/geo.json').then(function (d) {
        return d && d.ip ? { ip: d.ip, country: d.country || '', region: d.region || '', city: d.city || '',
                             isp: d.organization_name || '' } : {};
      });
    });
    return withTimeout(p, 4500);
  }

  function beacon(msg) {
    var body = JSON.stringify(msg);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(CFG.endpoint, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
    } catch (e) { /* fall through */ }
    try { fetch(CFG.endpoint, { method: 'POST', mode: 'no-cors', keepalive: true, body: body }); } catch (e) { /* offline */ }
  }

  // ── logger ─────────────────────────────────────────────────────────────
  function startLogger() {
    if (!CFG.endpoint || navigator.webdriver) return;
    if (document.body.classList.contains('page-analytics')) return;          // the dashboard itself
    if (getItem('localStorage', OWNER_FLAG) === '1') return;

    var vid = getItem('localStorage', VID_KEY);
    if (!vid) { vid = uid(); setItem('localStorage', VID_KEY, vid); }
    var s = null;
    try { s = JSON.parse(getItem('sessionStorage', SESS_KEY) || 'null'); } catch (e) { s = null; }
    if (!s || !s.sid) s = { sid: uid(), started: false, ms: 0, pages: 0 };
    s.pages += 1;
    save();

    var info = baseInfo();
    var visibleSince = document.visibilityState === 'visible' ? Date.now() : 0;
    var lastSent = '';

    function save() { setItem('sessionStorage', SESS_KEY, JSON.stringify(s)); }

    function send() {
      var ms = s.ms + (visibleSince ? Date.now() - visibleSince : 0);
      var msg = { type: 'visit', sid: s.sid, vid: vid, seconds: Math.round(ms / 1000), pages: s.pages, page: location.pathname };
      if (!s.started) msg.info = info;             // details ride along until the located start has gone out
      var key = JSON.stringify(msg);
      if (key === lastSent) return;
      lastSent = key;
      beacon(msg);
    }

    function pause() {
      if (visibleSince) { s.ms += Date.now() - visibleSince; visibleSince = 0; }
      save();
      send();
    }

    if (!s.started) {
      Promise.all([refineInfo(info), fetchGeo()]).then(function (r) {
        Object.assign(info, r[1]);
        send();
        s.started = true;
        save();
      });
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') pause();
      else if (!visibleSince) visibleSince = Date.now();
    });
    window.addEventListener('pagehide', pause);
    setInterval(function () { if (visibleSince) send(); }, CFG.heartbeatMs);
  }

  // ── password gate (About page) ─────────────────────────────────────────
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
    + '.va-card{position:relative;width:min(420px,100%);background:var(--panel);border:1px solid var(--line);border-radius:12px;'
    + 'box-shadow:0 24px 70px rgba(0,0,0,.6);padding:24px 22px;text-align:center}'
    + '.va-title{font-family:"Orbitron",sans-serif;font-weight:700;font-size:16px;color:#fff;margin-bottom:12px}'
    + '.va-x{position:absolute;top:10px;right:10px;width:32px;height:32px;border-radius:8px;cursor:pointer;'
    + 'background:rgba(16,32,58,.7);color:#eaf2fb;border:1px solid var(--line);font-size:19px;line-height:1}'
    + '.va-x:hover{border-color:var(--accent);color:var(--accent)}'
    + '.va-card label{display:block;font-family:var(--mono);font-size:12px;color:var(--text);margin-bottom:10px}'
    + '.va-card input{font:14px var(--mono);color:var(--text);background:rgba(103,200,255,.06);border:1px solid var(--line);'
    + 'border-radius:7px;padding:9px 12px;width:min(240px,80%)}'
    + '.va-card input:focus{outline:none;border-color:var(--accent)}'
    + '.va-err{color:#ff6b6b;font-family:var(--mono);font-size:12px;min-height:16px;margin-top:10px}'
    + '.va-go{font-family:var(--mono);font-size:13px;font-weight:700;border-radius:8px;padding:9px 18px;cursor:pointer;'
    + 'border:1px solid var(--accent);background:rgba(103,200,255,.14);color:#eaf6ff;margin-top:12px}'
    + '.va-go:hover{background:rgba(103,200,255,.26)}';

  function buildGate() {
    if (document.getElementById('va-open')) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'va-open'; btn.className = 'va-btn';
    btn.innerHTML = '<span class="ic">📊</span><span>Site Analytics</span>';
    document.body.appendChild(btn);

    var modal = document.createElement('div');
    modal.className = 'va-modal'; modal.hidden = true;
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = '<div class="va-card">'
      + '<button type="button" class="va-x" aria-label="Close">×</button>'
      + '<div class="va-title">Site Analytics</div>'
      + '<label for="va-gate-pw">Enter the owner password to open visitor analytics</label>'
      + '<input id="va-gate-pw" type="password" autocomplete="off" placeholder="••••••••">'
      + '<div class="va-err" id="va-gate-err"></div>'
      + '<button type="button" class="va-go" id="va-gate-go">Unlock</button>'
      + '</div>';
    document.body.appendChild(modal);

    var pw = document.getElementById('va-gate-pw'), err = document.getElementById('va-gate-err');
    function open() { modal.hidden = false; err.textContent = ''; pw.value = ''; setTimeout(function () { pw.focus(); }, 60); }
    function close() { modal.hidden = true; }
    function unlock() {
      var value = pw.value;
      sha256(value).then(function (hash) {
        if (hash !== CFG.passwordSha256) { err.textContent = 'Incorrect password.'; pw.select(); return; }
        setItem('localStorage', OWNER_FLAG, '1');     // this machine → stop logging it
        setItem('sessionStorage', PW_KEY, value);     // the dashboard re-checks it with the backend
        location.href = 'site-analytics.html';
      }, function () { err.textContent = 'This browser can’t check the password here (it needs HTTPS).'; });
    }

    btn.addEventListener('click', open);
    modal.querySelector('.va-x').addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) close(); });
    document.getElementById('va-gate-go').addEventListener('click', unlock);
    pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') unlock(); });
  }

  // ── init ───────────────────────────────────────────────────────────────
  function init() {
    startLogger();
    if (document.body.classList.contains('page-about')) buildGate();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
