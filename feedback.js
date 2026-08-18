// Comments & Feedback — a self-contained widget for the NAZAR main page.
//
// It injects a fixed bottom-left button, a submission modal (name, comment
// capped at 500 words, a REQUIRED private contact field), and a
// password-gated "Review comments" panel for the owner that shows each
// submission's IP address, device, country and city and lets them edit or
// delete entries.
//
// ── Static-site reality ─────────────────────────────────────────────────
// GitHub Pages has no backend, so by default every submission is stored in
// the visitor's OWN browser (localStorage): the review panel on a given
// device shows the feedback left on that device only.  To collect feedback
// from ALL visitors — and get each one EMAILED to you automatically — set
// CONFIG.endpoint below to your backend URL.  feedback-backend.gs is a ready
// ~2-minute Google Apps Script that emails every new comment (with its
// contact / IP / geo / device) to your inbox from your own Gmail, and can
// optionally log to a private Sheet too.  When an endpoint is set, every
// submission is forwarded there; the in-page review stays local.

(function () {
  'use strict';

  var CONFIG = {
    // Owner of the site — named in the reassurance text.
    owner: 'Hitesh Gala',
    // Gate for the "Review comments" panel.  ⚠ Client-side only (visible in
    // this file), so treat it as a convenience lock, not real security —
    // real privacy comes from the backend below.  CHANGE THIS.
    adminPassword: 'nazar-admin',
    // AUTO-EMAIL each new comment to the owner.  Set ONE of the two:
    //  • web3formsKey — a Web3Forms access key (web3forms.com).  No server to
    //    deploy; Web3Forms relays the email to the address the key is bound to
    //    (hdgala@gmail.com).  This key is meant to live in client code.
    web3formsKey: '19a6f8ac-ba1f-4dcb-a3a3-6c12091a30aa',
    //  • endpoint — a Google Apps Script /exec URL (see feedback-backend.gs),
    //    which emails from your own Gmail.  Leave '' when using web3formsKey.
    endpoint: '',
  };

  var LS_KEY   = 'nazar.feedback.v1';
  var ADMIN_SS = 'nazar.fb.admin';
  var WORD_MAX = 500;

  // ── tiny helpers ───────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function wordCount(s) {
    var t = String(s || '').trim();
    return t ? t.split(/\s+/).length : 0;
  }
  function validContact(v) {
    v = String(v || '').trim();
    if (!v) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || /^[+]?[0-9][0-9\s().\-]{6,}$/.test(v);
  }
  function fmtTime(ms) {
    try { return new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return String(ms); }
  }

  // Friendly device / OS / browser string from the user agent.
  function deviceInfo() {
    var ua = navigator.userAgent || '';
    var os = 'Unknown OS';
    if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
    else if (/Windows NT/.test(ua)) os = 'Windows';
    else if (/iPhone/.test(ua)) os = 'iPhone (iOS)';
    else if (/iPad/.test(ua)) os = 'iPad';
    else if (/Mac OS X/.test(ua)) os = 'macOS';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/CrOS/.test(ua)) os = 'ChromeOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    var br = 'Unknown browser';
    if (/Edg\//.test(ua)) br = 'Edge';
    else if (/OPR\/|Opera/.test(ua)) br = 'Opera';
    else if (/Chrome\/(\d+)/.test(ua)) br = 'Chrome ' + RegExp.$1;
    else if (/Firefox\/(\d+)/.test(ua)) br = 'Firefox ' + RegExp.$1;
    else if (/Version\/(\d+)[\d.]*\s+.*Safari/.test(ua)) br = 'Safari ' + RegExp.$1;
    else if (/Safari/.test(ua)) br = 'Safari';
    var model = '';
    var m = ua.match(/Android [\d.]+; ([^;)]+)/);
    if (m) model = m[1].replace(/\s+Build.*/, '').trim();
    return { ua: ua, device: (model ? model + ' · ' : '') + os + ' · ' + br };
  }

  // Best-effort IP + approximate location from a free, key-less API, with a
  // fallback and a hard timeout so a slow/blocked call never stalls submit.
  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw 0; return r.json(); });
  }
  function withTimeout(p, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve({}); } }, ms);
      p.then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
             function () { if (!done) { done = true; clearTimeout(t); resolve({}); } });
    });
  }
  function fetchGeo() {
    var primary = fetchJson('https://ipwho.is/').then(function (d) {
      if (d && d.success !== false && d.ip) return { ip: d.ip, city: d.city || '', region: d.region || '', country: d.country || '' };
      throw 0;
    }).catch(function () {
      return fetchJson('https://get.geojs.io/v1/ip/geo.json').then(function (d) {
        return (d && d.ip) ? { ip: d.ip, city: d.city || '', region: d.region || '', country: d.country || '' } : {};
      });
    });
    return withTimeout(primary, 4500);
  }

  // ── storage (local) ────────────────────────────────────────────────────
  function load() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') || []; } catch (e) { return []; } }
  function save(a) { try { localStorage.setItem(LS_KEY, JSON.stringify(a)); } catch (e) {} }

  // True when an auto-email backend is configured.
  function connected() { return !!(CONFIG.web3formsKey || CONFIG.endpoint); }

  // Forward each submission so the owner is emailed automatically.
  function forward(record) {
    // Preferred: Web3Forms — a client-side email relay, no server to deploy.
    if (CONFIG.web3formsKey) {
      var loc = [record.city, record.region, record.country].filter(Boolean).join(', ') || '—';
      var payload = {
        access_key: CONFIG.web3formsKey,
        subject: 'NAZAR feedback from ' + (record.name || 'Anonymous'),
        from_name: 'NAZAR Feedback',
        Name: record.name || 'Anonymous',
        Comment: record.comment || '',
        Contact: record.contact || '—',
        IP: record.ip || '—',
        Location: loc,
        Device: record.device || '—',
        Browser: record.ua || '—',
        Page: record.page || '—',
        Submitted: fmtTime(record.ts),
      };
      // Make the email's Reply go straight to the visitor when they left one.
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(record.contact || '').trim())) {
        payload.replyto = String(record.contact).trim();
      }
      try {
        fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (e) {}
      return;
    }
    // Alternative: Google Apps Script web app (fire-and-forget; text/plain
    // avoids a CORS preflight so the simple endpoint accepts it).
    if (CONFIG.endpoint) {
      try {
        fetch(CONFIG.endpoint, {
          method: 'POST', mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'add', record: record }),
        });
      } catch (e) {}
    }
  }

  // ── styles ─────────────────────────────────────────────────────────────
  var CSS = ''
    + '.fb-fab{position:fixed;left:16px;bottom:92px;z-index:1200;display:inline-flex;align-items:center;gap:8px;'
    + 'padding:10px 15px;border-radius:999px;cursor:pointer;font-family:var(--mono);font-size:13px;font-weight:700;'
    + 'letter-spacing:.02em;color:#eaf6ff;background:linear-gradient(135deg,rgba(16,40,66,.96),rgba(10,24,40,.96));'
    + 'border:1px solid var(--accent);box-shadow:0 6px 22px rgba(0,0,0,.5),0 0 16px rgba(103,200,255,.25);'
    + 'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:transform .14s,box-shadow .14s,border-color .14s}'
    + '.fb-fab:hover{transform:translateY(-2px);border-color:#9ad8ff;box-shadow:0 10px 28px rgba(0,0,0,.55),0 0 22px rgba(103,200,255,.45)}'
    + '.fb-fab .ic{font-size:15px}'
    + '@media(max-width:720px){.fb-fab{bottom:76px;padding:9px 12px;font-size:12px}}'
    + '.fb-modal{position:fixed;inset:0;z-index:1400;display:flex;align-items:center;justify-content:center;padding:22px;'
    + 'background:rgba(3,7,13,.74);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)}'
    + '.fb-modal[hidden]{display:none}'
    + '.fb-card{width:min(620px,100%);max-height:calc(100vh - 44px);overflow:auto;background:var(--panel);'
    + 'border:1px solid var(--line);border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.6);'
    + 'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}'
    + '.fb-head{position:sticky;top:0;z-index:2;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;'
    + 'padding:18px 20px 14px;background:linear-gradient(180deg,rgba(8,16,28,.96),rgba(8,16,28,.82));border-bottom:1px solid var(--line)}'
    + '.fb-title{font-family:"Orbitron",sans-serif;font-weight:700;font-size:17px;color:#fff;letter-spacing:.02em}'
    + '.fb-sub{margin-top:4px;font-family:var(--mono);font-size:12px;color:var(--dim);line-height:1.5}'
    + '.fb-x{flex:none;width:34px;height:34px;border-radius:8px;cursor:pointer;background:rgba(16,32,58,.7);color:#eaf2fb;'
    + 'border:1px solid var(--line);font-size:20px;line-height:1}'
    + '.fb-x:hover{border-color:var(--accent);color:var(--accent)}'
    + '.fb-body{padding:16px 20px 20px}'
    + '.fb-field{margin-bottom:14px}'
    + '.fb-label{display:block;font-family:var(--mono);font-size:12px;color:var(--text);margin-bottom:6px;letter-spacing:.03em}'
    + '.fb-label .req{color:#ff9a6b}'
    + '.fb-input,.fb-textarea{width:100%;box-sizing:border-box;font:14px var(--mono);color:var(--text);'
    + 'background:rgba(103,200,255,.05);border:1px solid var(--line);border-radius:7px;padding:10px 12px}'
    + '.fb-textarea{min-height:120px;resize:vertical;line-height:1.5}'
    + '.fb-input:focus,.fb-textarea:focus{outline:none;border-color:var(--accent);background:rgba(103,200,255,.09)}'
    + '.fb-input.bad,.fb-textarea.bad{border-color:#ff6b6b;background:rgba(255,107,107,.08)}'
    + '.fb-count{margin-top:5px;font-family:var(--mono);font-size:11px;color:var(--dim);text-align:right}'
    + '.fb-count.over{color:#ff6b6b}'
    + '.fb-note{font-family:var(--mono);font-size:11.5px;line-height:1.55;color:var(--dim);'
    + 'background:rgba(103,200,255,.06);border:1px solid var(--line);border-radius:7px;padding:9px 11px;margin-bottom:14px}'
    + '.fb-note b{color:#ffd27f}'
    + '.fb-note.privacy{margin-top:8px;margin-bottom:0}'
    + '.fb-actions{display:flex;gap:10px;align-items:center;margin-top:4px}'
    + '.fb-btn{font-family:var(--mono);font-size:13px;font-weight:700;border-radius:8px;padding:10px 18px;cursor:pointer;'
    + 'border:1px solid var(--accent);background:rgba(103,200,255,.14);color:#eaf6ff;transition:background .14s,transform .12s}'
    + '.fb-btn:hover{background:rgba(103,200,255,.26)}.fb-btn:disabled{opacity:.5;cursor:not-allowed}'
    + '.fb-btn.ghost{border-color:var(--line);background:transparent;color:var(--text)}'
    + '.fb-btn.ghost:hover{border-color:var(--accent);color:var(--accent)}'
    + '.fb-btn.danger{border-color:#ff6b6b;color:#ff9a8a;background:rgba(255,107,107,.10)}'
    + '.fb-btn.danger:hover{background:rgba(255,107,107,.2)}'
    + '.fb-status{font-family:var(--mono);font-size:12px;min-height:16px}'
    + '.fb-status.ok{color:#67e8a4}.fb-status.err{color:#ff6b6b}'
    + '.fb-foot{margin-top:16px;padding-top:12px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}'
    + '.fb-link{font-family:var(--mono);font-size:12px;color:var(--accent);background:none;border:none;cursor:pointer;text-decoration:underline;padding:0}'
    + '.fb-thanks{text-align:center;padding:26px 8px}'
    + '.fb-thanks .big{font-size:34px}'
    + '.fb-thanks h3{font-family:"Orbitron",sans-serif;color:#fff;margin:10px 0 6px}'
    + '.fb-thanks p{font-family:var(--mono);font-size:12.5px;color:var(--dim);line-height:1.6}'
    // admin
    + '.fb-modebar{font-family:var(--mono);font-size:11.5px;line-height:1.55;padding:9px 11px;border-radius:7px;margin-bottom:14px}'
    + '.fb-modebar.local{color:#ffd27f;background:rgba(255,210,127,.10);border:1px solid rgba(255,210,127,.4)}'
    + '.fb-modebar.remote{color:#67e8a4;background:rgba(103,232,164,.10);border:1px solid rgba(103,232,164,.4)}'
    + '.fb-cmt{border:1px solid var(--line);border-radius:9px;padding:12px 13px;margin-bottom:11px;background:rgba(0,0,0,.25)}'
    + '.fb-cmt .top{display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap}'
    + '.fb-cmt .who{font-family:var(--mono);font-size:13px;color:#fff}.fb-cmt .who b{color:#67c8ff}'
    + '.fb-cmt .when{font-family:var(--mono);font-size:11px;color:var(--dim)}'
    + '.fb-cmt .msg{font-family:var(--mono);font-size:13px;color:var(--text);line-height:1.55;margin:8px 0;white-space:pre-wrap;word-break:break-word}'
    + '.fb-cmt .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:5px 12px;'
    + 'font-family:var(--mono);font-size:11px;color:var(--dim);border-top:1px dashed var(--line);padding-top:8px;margin-top:8px}'
    + '.fb-cmt .meta .k{color:var(--dim)}.fb-cmt .meta .v{color:var(--text)}'
    + '.fb-cmt .meta .v.priv{color:#ffd27f}'
    + '.fb-cmt .row-actions{display:flex;gap:7px;margin-top:10px}'
    + '.fb-cmt .row-actions .fb-btn{padding:6px 12px;font-size:12px}'
    + '.fb-cmt textarea{width:100%;box-sizing:border-box;font:13px var(--mono);color:var(--text);background:rgba(103,200,255,.06);border:1px solid var(--accent);border-radius:6px;padding:8px;min-height:80px;margin:6px 0}'
    + '.fb-empty{text-align:center;color:var(--dim);font-family:var(--mono);font-size:13px;padding:30px 10px}'
    + '.fb-gate{padding:8px 0}'
    + '.fb-gate .fb-input{max-width:260px;display:inline-block;width:auto}';

  // ── DOM ────────────────────────────────────────────────────────────────
  var refs = {};

  function build() {
    if (document.getElementById('fb-open')) return;   // guard against double-load

    var style = document.createElement('style');
    style.id = 'fb-styles';
    style.textContent = CSS;
    document.head.appendChild(style);

    var fab = document.createElement('button');
    fab.type = 'button';
    fab.id = 'fb-open';
    fab.className = 'fb-fab';
    fab.setAttribute('aria-haspopup', 'dialog');
    fab.innerHTML = '<span class="ic">💬</span><span>Comments &amp; Feedback</span>';
    document.body.appendChild(fab);

    var modal = document.createElement('div');
    modal.className = 'fb-modal';
    modal.id = 'fb-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'fb-title');
    modal.innerHTML = ''
      + '<div class="fb-card">'
      + '  <div class="fb-head">'
      + '    <div><div class="fb-title" id="fb-title">Comments &amp; Feedback</div>'
      + '      <div class="fb-sub" id="fb-headsub">Tell us what you think of NAZAR — bugs, ideas, anything.</div></div>'
      + '    <button type="button" class="fb-x" id="fb-close" aria-label="Close">×</button>'
      + '  </div>'
      + '  <div class="fb-body">'
      // ── form view ──
      + '    <div id="fb-form-view">'
      + '      <div class="fb-field">'
      + '        <label class="fb-label" for="fb-name">Name <span style="color:var(--dim)">(optional)</span></label>'
      + '        <input class="fb-input" id="fb-name" type="text" maxlength="80" autocomplete="name" placeholder="How should we address you?">'
      + '      </div>'
      + '      <div class="fb-field">'
      + '        <label class="fb-label" for="fb-comment">Your comment <span class="req">*</span></label>'
      + '        <textarea class="fb-textarea" id="fb-comment" placeholder="Up to 500 words…"></textarea>'
      + '        <div class="fb-count" id="fb-count">0 / 500 words</div>'
      + '      </div>'
      + '      <div class="fb-field">'
      + '        <label class="fb-label" for="fb-contact">Email or phone <span class="req">* required</span></label>'
      + '        <input class="fb-input" id="fb-contact" type="text" maxlength="120" autocomplete="email" placeholder="you@example.com  or  +91 98765 43210">'
      + '        <div class="fb-note privacy">🔒 <b>Required &amp; private.</b> Your email / phone is shared <b>only with ' + esc(CONFIG.owner) + '</b>, the owner of this website, so he can reply — it is never shown publicly or to other visitors.</div>'
      + '      </div>'
      + '      <div class="fb-note">ℹ When you submit, basic technical details (your approximate location and device, derived from your IP address) are attached to help ' + esc(CONFIG.owner) + ' understand and follow up on feedback.</div>'
      + '      <div class="fb-actions">'
      + '        <button type="button" class="fb-btn" id="fb-submit">Send feedback</button>'
      + '        <span class="fb-status" id="fb-status"></span>'
      + '      </div>'
      + '      <div class="fb-foot">'
      + '        <span style="font-family:var(--mono);font-size:11px;color:var(--dim)">Thanks for helping improve NAZAR.</span>'
      + '        <button type="button" class="fb-link" id="fb-review">🔑 Review comments (owner)</button>'
      + '      </div>'
      + '    </div>'
      // ── thanks view ──
      + '    <div id="fb-thanks-view" hidden>'
      + '      <div class="fb-thanks"><div class="big">✅</div><h3>Feedback sent</h3>'
      + '        <p id="fb-thanks-msg">Thank you — your comment has been recorded.</p></div>'
      + '      <div class="fb-actions" style="justify-content:center"><button type="button" class="fb-btn ghost" id="fb-another">Leave another</button></div>'
      + '    </div>'
      // ── admin view ──
      + '    <div id="fb-admin-view" hidden>'
      + '      <div id="fb-gate" class="fb-gate">'
      + '        <label class="fb-label" for="fb-pw">Owner password</label>'
      + '        <div class="fb-actions"><input class="fb-input" id="fb-pw" type="password" placeholder="••••••••" autocomplete="off">'
      + '          <button type="button" class="fb-btn" id="fb-unlock">Unlock</button></div>'
      + '        <div class="fb-status err" id="fb-gate-err" style="margin-top:8px"></div>'
      + '      </div>'
      + '      <div id="fb-admin-panel" hidden>'
      + '        <div class="fb-modebar" id="fb-modebar"></div>'
      + '        <div id="fb-list"></div>'
      + '        <div class="fb-foot">'
      + '          <button type="button" class="fb-btn ghost" id="fb-back">← Back to form</button>'
      + '          <span style="display:flex;gap:16px;align-items:center">'
      + '            <button type="button" class="fb-link" id="fb-export-pdf">⬇ All as PDF</button>'
      + '            <button type="button" class="fb-link" id="fb-export">⬇ CSV</button>'
      + '          </span>'
      + '        </div>'
      + '      </div>'
      + '    </div>'
      + '  </div>'
      + '</div>';
    document.body.appendChild(modal);

    refs = {
      fab: fab, modal: modal,
      close: document.getElementById('fb-close'),
      formView: document.getElementById('fb-form-view'),
      thanksView: document.getElementById('fb-thanks-view'),
      adminView: document.getElementById('fb-admin-view'),
      name: document.getElementById('fb-name'),
      comment: document.getElementById('fb-comment'),
      count: document.getElementById('fb-count'),
      contact: document.getElementById('fb-contact'),
      submit: document.getElementById('fb-submit'),
      status: document.getElementById('fb-status'),
      review: document.getElementById('fb-review'),
      another: document.getElementById('fb-another'),
      thanksMsg: document.getElementById('fb-thanks-msg'),
      gate: document.getElementById('fb-gate'),
      pw: document.getElementById('fb-pw'),
      unlock: document.getElementById('fb-unlock'),
      gateErr: document.getElementById('fb-gate-err'),
      panel: document.getElementById('fb-admin-panel'),
      modebar: document.getElementById('fb-modebar'),
      list: document.getElementById('fb-list'),
      back: document.getElementById('fb-back'),
      exportBtn: document.getElementById('fb-export'),
      exportPdf: document.getElementById('fb-export-pdf'),
    };
    wire();
  }

  // ── open / close + view switching ────────────────────────────────────
  function show(view) {
    refs.formView.hidden = view !== 'form';
    refs.thanksView.hidden = view !== 'thanks';
    refs.adminView.hidden = view !== 'admin';
  }
  function open() {
    refs.modal.hidden = false;
    refs.modal.setAttribute('aria-hidden', 'false');
    show('form');
    setTimeout(function () { refs.comment.focus(); }, 60);
  }
  function close() {
    refs.modal.hidden = true;
    refs.modal.setAttribute('aria-hidden', 'true');
  }

  // ── form logic ─────────────────────────────────────────────────────────
  function refreshCount() {
    var n = wordCount(refs.comment.value);
    refs.count.textContent = n + ' / ' + WORD_MAX + ' words';
    refs.count.classList.toggle('over', n > WORD_MAX);
  }

  function doSubmit() {
    var comment = refs.comment.value.trim();
    var contact = refs.contact.value.trim();
    var n = wordCount(comment);
    var bad = false;
    refs.comment.classList.remove('bad'); refs.contact.classList.remove('bad');
    if (!comment || n > WORD_MAX) { refs.comment.classList.add('bad'); bad = true; }
    if (!validContact(contact)) { refs.contact.classList.add('bad'); bad = true; }
    if (bad) {
      refs.status.className = 'fb-status err';
      refs.status.textContent = !validContact(contact)
        ? 'Please add a valid email or phone number (required).'
        : (n > WORD_MAX ? 'Comment is over the 500-word limit.' : 'Please write a comment first.');
      return;
    }
    refs.submit.disabled = true;
    refs.status.className = 'fb-status';
    refs.status.textContent = 'Sending…';

    var di = deviceInfo();
    fetchGeo().then(function (geo) {
      var rec = {
        id: 'fb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        ts: Date.now(),
        name: refs.name.value.trim(),
        comment: comment,
        contact: contact,
        ip: geo.ip || '', city: geo.city || '', region: geo.region || '', country: geo.country || '',
        device: di.device, ua: di.ua,
        page: location.pathname,
      };
      var all = load(); all.unshift(rec); save(all);
      forward(rec);
      refs.submit.disabled = false;
      refs.name.value = ''; refs.comment.value = ''; refs.contact.value = ''; refreshCount();
      refs.status.textContent = '';
      refs.thanksMsg.textContent = connected()
        ? 'Thank you — your comment has been sent to ' + CONFIG.owner + '.'
        : 'Thank you — your comment has been recorded on this device.';
      show('thanks');
    });
  }

  // ── admin logic ────────────────────────────────────────────────────────
  function openReview() {
    show('admin');
    if (sessionStorage.getItem(ADMIN_SS) === '1') { unlock(); }
    else { refs.gate.hidden = false; refs.panel.hidden = true; refs.gateErr.textContent = ''; refs.pw.value = ''; setTimeout(function () { refs.pw.focus(); }, 60); }
  }
  function tryUnlock() {
    if (refs.pw.value === CONFIG.adminPassword) {
      try { sessionStorage.setItem(ADMIN_SS, '1'); } catch (e) {}
      unlock();
    } else {
      refs.gateErr.textContent = 'Incorrect password.';
      refs.pw.select();
    }
  }
  function unlock() {
    refs.gate.hidden = true;
    refs.panel.hidden = false;
    renderList();
  }
  function renderList() {
    refs.modebar.className = 'fb-modebar ' + (connected() ? 'remote' : 'local');
    refs.modebar.innerHTML = connected()
      ? '✅ <b>Auto-email is on.</b> Every new comment is emailed to the owner automatically. The list below is only what was captured on <b>this browser</b>; your inbox holds the complete all-visitor record.'
      : '⚠ <b>Local mode.</b> This site has no backend, so the list below is only feedback submitted on <b>this browser / device</b>. To collect from every visitor in one private place, connect a backend (see <code>feedback-backend.gs</code>).';
    var all = load();
    if (!all.length) { refs.list.innerHTML = '<div class="fb-empty">No comments captured on this device yet.</div>'; return; }
    refs.list.innerHTML = all.map(function (r) { return cardHtml(r); }).join('');
  }
  function cardHtml(r) {
    var loc = [r.city, r.region, r.country].filter(Boolean).join(', ') || '—';
    return ''
      + '<div class="fb-cmt" data-id="' + esc(r.id) + '">'
      + '  <div class="top"><span class="who"><b>' + (r.name ? esc(r.name) : 'Anonymous') + '</b></span>'
      + '    <span class="when">' + esc(fmtTime(r.ts)) + '</span></div>'
      + '  <div class="msg">' + esc(r.comment) + '</div>'
      + '  <div class="meta">'
      + '    <div><span class="k">Contact</span> <span class="v priv">' + (esc(r.contact) || '—') + '</span></div>'
      + '    <div><span class="k">IP</span> <span class="v priv">' + (esc(r.ip) || '—') + '</span></div>'
      + '    <div><span class="k">Location</span> <span class="v">' + esc(loc) + '</span></div>'
      + '    <div><span class="k">Device</span> <span class="v">' + (esc(r.device) || '—') + '</span></div>'
      + '  </div>'
      + '  <div class="row-actions">'
      + '    <button type="button" class="fb-btn ghost" data-act="pdf">⬇ PDF</button>'
      + '    <button type="button" class="fb-btn ghost" data-act="edit">Edit</button>'
      + '    <button type="button" class="fb-btn danger" data-act="del">Delete</button>'
      + '  </div>'
      + '</div>';
  }
  function onListClick(e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var card = btn.closest('.fb-cmt');
    var id = card.getAttribute('data-id');
    if (btn.dataset.act === 'pdf') {
      var rec = load().filter(function (r) { return r.id === id; })[0];
      if (!rec) return;
      var lbl = btn.textContent; btn.disabled = true; btn.textContent = '…';
      commentToPdf(rec).catch(function (err) { alert(err.message); })
        .then(function () { btn.disabled = false; btn.textContent = lbl; });
      return;
    }
    if (btn.dataset.act === 'del') {
      if (!confirm('Delete this comment permanently?')) return;
      save(load().filter(function (r) { return r.id !== id; }));
      renderList();
    } else if (btn.dataset.act === 'edit') {
      startEdit(card, id);
    } else if (btn.dataset.act === 'save') {
      var ta = card.querySelector('textarea');
      var all = load();
      for (var i = 0; i < all.length; i++) if (all[i].id === id) { all[i].comment = ta.value.trim(); all[i].edited = Date.now(); }
      save(all); renderList();
    } else if (btn.dataset.act === 'cancel') {
      renderList();
    }
  }
  function startEdit(card, id) {
    var rec = load().filter(function (r) { return r.id === id; })[0];
    if (!rec) return;
    var msg = card.querySelector('.msg');
    var ta = document.createElement('textarea');
    ta.value = rec.comment;
    msg.replaceWith(ta);
    var actions = card.querySelector('.row-actions');
    actions.innerHTML = '<button type="button" class="fb-btn" data-act="save">Save</button>'
      + '<button type="button" class="fb-btn ghost" data-act="cancel">Cancel</button>';
    ta.focus();
  }
  function exportCsv() {
    var all = load();
    if (!all.length) { alert('Nothing to export on this device.'); return; }
    var cols = ['ts', 'name', 'comment', 'contact', 'ip', 'city', 'region', 'country', 'device', 'ua'];
    var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var rows = [['time'].concat(cols.slice(1)).join(',')];
    all.forEach(function (r) {
      rows.push([fmtTime(r.ts)].concat(cols.slice(1).map(function (c) { return r[c]; })).map(q).join(','));
    });
    var blob = new Blob([rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'nazar-feedback-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ── PDF export (owner) ──────────────────────────────────────────────────
  // Lazy-load jsPDF only when the owner first exports, so visitors never pay
  // for it.  Downloads land in the browser's download folder (set Chrome's
  // download location to the Desktop, or enable "ask where to save", to keep
  // them on the desktop).
  var _jspdf = null;
  function loadJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (_jspdf) return _jspdf;
    _jspdf = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
      s.onload = function () { resolve(window.jspdf.jsPDF); };
      s.onerror = function () { _jspdf = null; reject(new Error('Could not load the PDF library (are you offline?).')); };
      document.head.appendChild(s);
    });
    return _jspdf;
  }
  function slug(s) { return (String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)) || 'anon'; }
  function stamp(ms) { var d = new Date(ms || Date.now()), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); }

  function pdfHeader(doc, subtitle) {
    var pageW = doc.internal.pageSize.getWidth();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(15, 22, 34);
    doc.text('NAZAR', 16, 20);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(90, 100, 115);
    doc.text('· ' + subtitle, 44, 20);
    doc.setDrawColor(120, 160, 200); doc.setLineWidth(0.4); doc.line(16, 24, pageW - 16, 24); doc.setLineWidth(0.2);
  }
  function pdfFooter(doc) {
    var n = doc.internal.getNumberOfPages();
    var pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
    var gen = 'Generated ' + fmtTime(Date.now()) + ' · NAZAR feedback export';
    for (var i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(140, 150, 165);
      doc.text(gen, 16, pageH - 10);
      doc.text('Page ' + i + ' of ' + n, pageW - 16, pageH - 10, { align: 'right' });
    }
  }
  // Lay one comment into the doc from cursor y; returns the new y.
  function pdfDrawComment(doc, r, y) {
    var pageH = doc.internal.pageSize.getHeight(), pageW = doc.internal.pageSize.getWidth();
    var M = 16, valX = M + 30, maxVal = pageW - valX - M;
    function ensure(h) { if (y + h > pageH - 16) { doc.addPage(); y = 20; } }
    function field(label, value, size) {
      var wrapped = doc.splitTextToSize(String(value == null || value === '' ? '—' : value), maxVal);
      ensure(wrapped.length * 5 + 2);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(120, 130, 145);
      doc.text(label, M, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(size || 10); doc.setTextColor(25, 33, 46);
      doc.text(wrapped, valX, y);
      y += wrapped.length * (size ? size * 0.5 : 5) + 2.5;
    }
    ensure(10);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20, 28, 42);
    doc.text((r.name ? r.name : 'Anonymous') + '   —   ' + fmtTime(r.ts), M, y); y += 2;
    doc.setDrawColor(210, 218, 228); doc.line(M, y, pageW - M, y); y += 6;
    field('Comment', r.comment, 11); y += 2;
    ensure(8);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(150, 95, 20);
    doc.text('PRIVATE — owner only', M, y); y += 5;
    field('Contact', r.contact);
    field('IP address', r.ip);
    field('Location', [r.city, r.region, r.country].filter(Boolean).join(', '));
    field('Device', r.device);
    field('User agent', r.ua, 8);
    field('Page', r.page);
    return y;
  }
  function commentToPdf(r) {
    return loadJsPdf().then(function (JsPDF) {
      var doc = new JsPDF({ unit: 'mm', format: 'a4' });
      pdfHeader(doc, 'User feedback');
      pdfDrawComment(doc, r, 34);
      pdfFooter(doc);
      doc.save('NAZAR-comment-' + slug(r.name) + '-' + stamp(r.ts) + '.pdf');
    });
  }
  function allToPdf(list) {
    return loadJsPdf().then(function (JsPDF) {
      var doc = new JsPDF({ unit: 'mm', format: 'a4' });
      pdfHeader(doc, 'User feedback — all comments (' + list.length + ')');
      var y = 34;
      for (var i = 0; i < list.length; i++) {
        if (i > 0) { y += 5; if (y > doc.internal.pageSize.getHeight() - 44) { doc.addPage(); y = 20; } }
        y = pdfDrawComment(doc, list[i], y);
      }
      pdfFooter(doc);
      doc.save('NAZAR-comments-' + stamp(Date.now()) + '.pdf');
    });
  }

  // ── wiring ─────────────────────────────────────────────────────────────
  function wire() {
    refs.fab.addEventListener('click', open);
    refs.close.addEventListener('click', close);
    refs.modal.addEventListener('click', function (e) { if (e.target === refs.modal) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !refs.modal.hidden) close(); });
    refs.comment.addEventListener('input', refreshCount);
    refs.submit.addEventListener('click', doSubmit);
    refs.review.addEventListener('click', openReview);
    refs.another.addEventListener('click', function () { show('form'); setTimeout(function () { refs.comment.focus(); }, 40); });
    refs.unlock.addEventListener('click', tryUnlock);
    refs.pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryUnlock(); });
    refs.back.addEventListener('click', function () { show('form'); });
    refs.list.addEventListener('click', onListClick);
    refs.exportBtn.addEventListener('click', exportCsv);
    refs.exportPdf.addEventListener('click', function () {
      var all = load();
      if (!all.length) { alert('No comments to export on this device.'); return; }
      allToPdf(all).catch(function (err) { alert(err.message); });
    });
    refreshCount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
