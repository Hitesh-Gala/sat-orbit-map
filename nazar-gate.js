// NAZAR password gate — one shared owner password for the protected sections.
//
//   Indi-Space   index.html's 🔒 button calls NazarGate.check() before opening it.
//   Space Stuff  every page of the section loads this file in <head> with
//                data-section="spacestuff": the page stays hidden behind a
//                password card until the password has been entered once in
//                this tab (sessionStorage); after that every Space Stuff page
//                opens straight away.
//
// Only the password's SHA-256 is kept here.  It is a client-side gate on a
// static site — it keeps casual visitors out, but the data files behind the
// pages stay publicly fetchable.  To change the password, put its new SHA-256
// here, in site-analytics.js (passwordSha256) and in the deployed Apps Script
// (PASSWORD_SHA256 in site-analytics-backend.gs).
(function () {
  var SHA256 = '073c5d092744e265c7726e0ab4c911c0295a91f022eb8d98fa8391b64769dbd1';
  var SECTIONS = {
    spacestuff: { key: 'nazar.spacestuff', icon: '🛰', title: 'Space Stuff', sub: 'Facts, figures, trackers & tools — password protected' },
  };

  function sha256(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  // Resolves true / false; rejects where the browser can't hash (no HTTPS).
  function check(pw) {
    if (!window.crypto || !crypto.subtle) return Promise.reject(new Error('insecure context'));
    return sha256(String(pw).trim()).then(function (h) { return h === SHA256; });
  }
  window.NazarGate = { check: check };

  var me = document.currentScript, section = SECTIONS[me && me.getAttribute('data-section')];
  if (!section) return;
  try { if (sessionStorage.getItem(section.key) === '1') return; } catch (e) { /* private mode: ask every time */ }

  var root = document.documentElement;
  root.classList.add('nz-locked');
  var css = document.createElement('style');
  css.textContent =
    'html.nz-locked body > :not(#nz-gate){visibility:hidden!important}' +
    '#nz-gate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;' +
      'background:radial-gradient(ellipse at center,#0b1624 0%,#03060b 72%);font-family:"JetBrains Mono","Fira Code",Consolas,ui-monospace,monospace}' +
    '#nz-gate .nz-card{position:relative;width:min(360px,92vw);text-align:center;background:#0a1119;border:1px solid #24384f;' +
      'border-radius:14px;padding:26px 24px 22px;box-shadow:0 26px 70px rgba(0,0,0,.7);color:#cfe0f2}' +
    '#nz-gate .nz-card.shake{animation:nz-shake .4s}' +
    '@keyframes nz-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}' +
    '#nz-gate .nz-ico{font-size:34px;line-height:1;margin-bottom:10px}' +
    '#nz-gate .nz-title{font-family:Orbitron,sans-serif;font-size:20px;font-weight:800;color:#fff;letter-spacing:.04em}' +
    '#nz-gate .nz-sub{margin-top:4px;font-size:11.5px;color:#8aa0b8}' +
    '#nz-gate label{display:block;margin:18px 0 7px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#9fb2c6}' +
    '#nz-gate .nz-row{display:flex;gap:8px}' +
    '#nz-gate input{flex:1;min-width:0;padding:10px 12px;border-radius:8px;border:1px solid #24384f;background:#050a11;color:#eaf2fb;' +
      'font-family:inherit;font-size:15px;letter-spacing:.2em;text-align:center;outline:none}' +
    '#nz-gate input:focus{border-color:#67c8ff;box-shadow:0 0 0 2px rgba(103,200,255,.25)}' +
    '#nz-gate button{flex:0 0 auto;padding:10px 14px;border-radius:8px;cursor:pointer;border:1px solid #67c8ff;' +
      'background:rgba(103,200,255,.18);color:#d6f0ff;font-family:inherit;font-size:13px;font-weight:700}' +
    '#nz-gate button:hover{background:rgba(103,200,255,.3)}' +
    '#nz-gate .nz-err{margin-top:10px;font-size:11.5px;color:#ff8b7d}' +
    '#nz-gate .nz-err[hidden]{display:none}' +
    '#nz-gate .nz-home{display:inline-block;margin-top:16px;font-size:12px;color:#67c8ff;text-decoration:none}' +
    '#nz-gate .nz-home:hover{text-decoration:underline}';
  document.head.appendChild(css);

  function mount() {
    var gate = document.createElement('div');
    gate.id = 'nz-gate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-labelledby', 'nz-title');
    gate.innerHTML =
      '<div class="nz-card">' +
        '<div class="nz-ico">' + section.icon + '</div>' +
        '<div class="nz-title" id="nz-title">' + section.title + '</div>' +
        '<div class="nz-sub">' + section.sub + '</div>' +
        '<label for="nz-pw">Enter password</label>' +
        '<div class="nz-row">' +
          '<input id="nz-pw" type="password" autocomplete="off" spellcheck="false" placeholder="••••••">' +
          '<button type="button" id="nz-go">Enter →</button>' +
        '</div>' +
        '<div class="nz-err" id="nz-err" hidden></div>' +
        '<a class="nz-home" href="index.html">← NAZAR Home</a>' +
      '</div>';
    document.body.appendChild(gate);

    var card = gate.querySelector('.nz-card'), pw = gate.querySelector('#nz-pw'), err = gate.querySelector('#nz-err');
    function fail(msg) {
      err.textContent = msg;
      err.hidden = false;
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
      pw.select();
    }
    function submit() {
      check(pw.value).then(function (ok) {
        if (!ok) return fail('Incorrect password — try again.');
        try { sessionStorage.setItem(section.key, '1'); } catch (e) { /* unlocks this page only */ }
        root.classList.remove('nz-locked');
        gate.remove();
      }, function () { fail('This browser can’t check the password here (it needs HTTPS).'); });
    }
    gate.querySelector('#nz-go').addEventListener('click', submit);
    pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    setTimeout(function () { pw.focus(); }, 60);
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
