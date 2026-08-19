// Comments & Feedback — a self-contained widget for the NAZAR main page.
//
// Injects a fixed bottom-left button and a submission modal (name, comment
// capped at 500 words, a REQUIRED private email/phone field).  Every
// submission is emailed straight to the owner via Web3Forms (see
// CONFIG.web3formsKey), together with the visitor's device and approximate
// location (looked up from their IP) — so comments never need to be shown or
// stored on the site itself.

(function () {
  'use strict';

  var CONFIG = {
    // Owner of the site — named in the reassurance text.
    owner: 'Hitesh Gala',
    // AUTO-EMAIL each new comment to the owner.  Set ONE of the two:
    //  • web3formsKey — a Web3Forms access key (web3forms.com).  Web3Forms
    //    relays the email to the address the key is bound to (hdgala@gmail.com).
    web3formsKey: '19a6f8ac-ba1f-4dcb-a3a3-6c12091a30aa',
    //  • endpoint — a Google Apps Script /exec URL (see feedback-backend.gs),
    //    which emails from your own Gmail.  Leave '' when using web3formsKey.
    endpoint: '',
  };

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

  // ── email delivery ───────────────────────────────────────────────────────
  function connected() { return !!(CONFIG.web3formsKey || CONFIG.endpoint); }

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
    // Alternative: Google Apps Script web app (see feedback-backend.gs).
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
    + '.fb-fab-lbl{display:flex;flex-direction:column;line-height:1.14;gap:1px;text-transform:uppercase;text-align:left}'
    + '.fb-fab-lbl .l1{font-size:12.5px;letter-spacing:.08em}'
    + '.fb-fab-lbl .l2{font-size:8.5px;letter-spacing:.12em;opacity:.82;color:#bcd0e6}'
    + '@media(max-width:720px){.fb-fab{bottom:76px;padding:9px 12px}.fb-fab-lbl .l1{font-size:11.5px}.fb-fab-lbl .l2{font-size:8px}}'
    + '.fb-modal{position:fixed;inset:0;z-index:1400;display:flex;align-items:center;justify-content:center;padding:22px;'
    + 'background:rgba(3,7,13,.74);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)}'
    + '.fb-modal[hidden]{display:none}'
    + '.fb-card{width:min(560px,100%);max-height:calc(100vh - 44px);overflow:auto;background:var(--panel);'
    + 'border:1px solid var(--line);border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.6);'
    + 'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}'
    + '.fb-head{position:sticky;top:0;z-index:2;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;'
    + 'padding:18px 20px 14px;background:linear-gradient(180deg,rgba(8,16,28,.96),rgba(8,16,28,.82));border-bottom:1px solid var(--line)}'
    + '.fb-title{font-family:"Orbitron",sans-serif;font-weight:700;font-size:17px;color:#fff;letter-spacing:.02em}'
    + '.fb-sub{margin-top:5px;font-family:var(--mono);font-size:12.5px;color:#bcd0e6;line-height:1.55}'
    + '.fb-x{flex:none;width:34px;height:34px;border-radius:8px;cursor:pointer;background:rgba(16,32,58,.7);color:#eaf2fb;'
    + 'border:1px solid var(--line);font-size:20px;line-height:1}'
    + '.fb-x:hover{border-color:var(--accent);color:var(--accent)}'
    + '.fb-body{padding:16px 20px 22px}'
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
    + 'background:rgba(103,200,255,.06);border:1px solid var(--line);border-radius:7px;padding:9px 11px;margin:0 0 16px}'
    + '.fb-note b{color:#ffd27f}'
    + '.fb-actions{display:flex;gap:10px;align-items:center;margin-top:4px}'
    + '.fb-btn{font-family:var(--mono);font-size:13px;font-weight:700;border-radius:8px;padding:10px 18px;cursor:pointer;'
    + 'border:1px solid var(--accent);background:rgba(103,200,255,.14);color:#eaf6ff;transition:background .14s,transform .12s}'
    + '.fb-btn:hover{background:rgba(103,200,255,.26)}.fb-btn:disabled{opacity:.5;cursor:not-allowed}'
    + '.fb-btn.ghost{border-color:var(--line);background:transparent;color:var(--text)}'
    + '.fb-btn.ghost:hover{border-color:var(--accent);color:var(--accent)}'
    + '.fb-status{font-family:var(--mono);font-size:12px;min-height:16px}'
    + '.fb-status.ok{color:#67e8a4}.fb-status.err{color:#ff6b6b}'
    + '.fb-thanks{text-align:center;padding:26px 8px}'
    + '.fb-thanks .big{font-size:34px}'
    + '.fb-thanks h3{font-family:"Orbitron",sans-serif;color:#fff;margin:10px 0 6px}'
    + '.fb-thanks p{font-family:var(--mono);font-size:12.5px;color:var(--dim);line-height:1.6}';

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
    fab.innerHTML = '<span class="ic">💬</span><span class="fb-fab-lbl"><span class="l1">Connect with me</span><span class="l2">Comments-Feedback</span></span>';
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
      + '    <div><div class="fb-title" id="fb-title">Connect with me</div>'
      + '      <div class="fb-sub" id="fb-headsub">Hi! I am excited to hear your views and feedback about the website. Write to me!</div></div>'
      + '    <button type="button" class="fb-x" id="fb-close" aria-label="Close">×</button>'
      + '  </div>'
      + '  <div class="fb-body">'
      // ── form view ──
      + '    <div id="fb-form-view">'
      + '      <div class="fb-field">'
      + '        <label class="fb-label" for="fb-name">Name <span style="color:var(--dim)">(optional)</span></label>'
      + '        <input class="fb-input" id="fb-name" type="text" maxlength="80" autocomplete="name" placeholder="How should I address you?">'
      + '      </div>'
      + '      <div class="fb-field">'
      + '        <label class="fb-label" for="fb-comment">Your comment <span class="req">*</span></label>'
      + '        <textarea class="fb-textarea" id="fb-comment" placeholder="Up to 500 words…"></textarea>'
      + '        <div class="fb-count" id="fb-count">0 / 500 words</div>'
      + '      </div>'
      + '      <div class="fb-field">'
      + '        <label class="fb-label" for="fb-contact">Email or phone <span class="req">* required</span></label>'
      + '        <input class="fb-input" id="fb-contact" type="text" maxlength="120" autocomplete="email" placeholder="you@example.com  or  +91 98765 43210">'
      + '        <div class="fb-note">🔒 <b>Required &amp; private.</b> Your email / phone is shared <b>only with ' + esc(CONFIG.owner) + '</b>, the owner of this website, so he can reply — it is never shown publicly or to other visitors.</div>'
      + '      </div>'
      + '      <div class="fb-actions">'
      + '        <button type="button" class="fb-btn" id="fb-submit">Send feedback</button>'
      + '        <span class="fb-status" id="fb-status"></span>'
      + '      </div>'
      + '    </div>'
      // ── thanks view ──
      + '    <div id="fb-thanks-view" hidden>'
      + '      <div class="fb-thanks"><div class="big">✅</div><h3>Feedback sent</h3>'
      + '        <p id="fb-thanks-msg">Thank you — your comment has been sent.</p></div>'
      + '      <div class="fb-actions" style="justify-content:center"><button type="button" class="fb-btn ghost" id="fb-another">Leave another</button></div>'
      + '    </div>'
      + '  </div>'
      + '</div>';
    document.body.appendChild(modal);

    refs = {
      fab: fab, modal: modal,
      close: document.getElementById('fb-close'),
      formView: document.getElementById('fb-form-view'),
      thanksView: document.getElementById('fb-thanks-view'),
      name: document.getElementById('fb-name'),
      comment: document.getElementById('fb-comment'),
      count: document.getElementById('fb-count'),
      contact: document.getElementById('fb-contact'),
      submit: document.getElementById('fb-submit'),
      status: document.getElementById('fb-status'),
      another: document.getElementById('fb-another'),
      thanksMsg: document.getElementById('fb-thanks-msg'),
    };
    wire();
  }

  // ── open / close + view switching ────────────────────────────────────
  function show(view) {
    refs.formView.hidden = view !== 'form';
    refs.thanksView.hidden = view !== 'thanks';
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
        ts: Date.now(),
        name: refs.name.value.trim(),
        comment: comment,
        contact: contact,
        ip: geo.ip || '', city: geo.city || '', region: geo.region || '', country: geo.country || '',
        device: di.device, ua: di.ua,
        page: location.pathname,
      };
      forward(rec);
      refs.submit.disabled = false;
      refs.name.value = ''; refs.comment.value = ''; refs.contact.value = ''; refreshCount();
      refs.status.textContent = '';
      refs.thanksMsg.textContent = connected()
        ? 'Thank you — your comment has been sent to ' + CONFIG.owner + '.'
        : 'Thank you — your comment has been recorded.';
      show('thanks');
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
    refs.another.addEventListener('click', function () { show('form'); setTimeout(function () { refs.comment.focus(); }, 40); });
    refreshCount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
