// NAZAR ambient background music — user-controlled toggle.
//
// A small floating button (lighthouse + sound-wave icon) turns the
// "Intriguing Possibilities" score ON or OFF.  Default is OFF.  Pressing it
// starts the track and lights the button; the ON state persists across every
// page (localStorage) and each page resumes playback where the last left off.
// Pressing again stops it and reverts the button.
//
// Because playback is always started by a real button press, browser autoplay
// blocking is never an issue on the first play.  On later pages (while ON) we
// try to resume automatically; if the browser blocks that fresh-page autoplay,
// the next click anywhere resumes it.
//
// This script is NOT loaded on the Orbit Visualisation page, so it never
// competes with the "Play NAZAR" soundtrack there.

(function () {
  const SRC     = 'audio/social-network-theme.mp3';
  const ON_KEY  = 'nazar.bgm.on';    // localStorage: user has it toggled on
  const POS_KEY = 'nazar.bgm.pos';   // sessionStorage: resume position (seconds)
  const VOLUME  = 0.4;

  let on = false;
  try { on = localStorage.getItem(ON_KEY) === '1'; } catch {}

  const audio = new Audio();
  audio.src = SRC;
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = VOLUME;

  // Resume where the previous page left off.
  let startAt = 0;
  try { startAt = parseFloat(sessionStorage.getItem(POS_KEY)) || 0; } catch {}
  audio.addEventListener('loadedmetadata', () => {
    if (startAt > 0 && Number.isFinite(audio.duration) && startAt < audio.duration) {
      try { audio.currentTime = startAt; } catch {}
    }
  });
  function persistPos() {
    try { if (audio.currentTime > 0) sessionStorage.setItem(POS_KEY, String(audio.currentTime)); } catch {}
  }
  setInterval(() => { if (!audio.paused) persistPos(); }, 4000);
  window.addEventListener('pagehide', persistPos);

  // ---- lighthouse + sound-wave icon ------------------------------------
  const ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M4.5 21h8"/>' +                       /* ground */
      '<path d="M6 21 7 11h3.5l1 10z"/>' +            /* tapered tower */
      '<path d="M7.15 16.2h3.2"/>' +                  /* stripe */
      '<path d="M7 11 7.3 8h2.9l.3 3z"/>' +           /* lamp gallery */
      '<path d="M6.9 8 8.75 6.1 10.6 8"/>' +          /* roof */
      '<path d="M13 8.4a4.2 4.2 0 0 1 3 3.4"/>' +     /* inner wave / beam */
      '<path d="M14.4 5.7a7.6 7.6 0 0 1 4.9 5.6"/>' + /* outer wave / beam */
    '</svg>';

  const style = document.createElement('style');
  style.textContent =
    '#nazar-bgm-toggle{position:fixed;right:16px;bottom:16px;z-index:95;width:42px;height:42px;' +
    'border-radius:50%;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;' +
    'background:rgba(8,16,28,0.80);border:1px solid rgba(110,200,255,0.30);color:#8aa0b8;' +
    'box-shadow:0 4px 16px rgba(0,0,0,0.45);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);' +
    'transition:color .2s,border-color .2s,box-shadow .2s,transform .15s;-webkit-appearance:none;appearance:none;}' +
    '#nazar-bgm-toggle svg{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:1.5;' +
    'stroke-linecap:round;stroke-linejoin:round;}' +
    '#nazar-bgm-toggle:hover{transform:scale(1.08);color:#cfe8ff;border-color:rgba(110,200,255,0.6);}' +
    '#nazar-bgm-toggle.on{color:#ffce6b;border-color:#ffce6b;' +
    'box-shadow:0 0 15px rgba(255,206,107,0.55),0 4px 16px rgba(0,0,0,0.45);}' +
    '@media print{#nazar-bgm-toggle{display:none;}}';

  let btn;
  function reflect() {
    if (!btn) return;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on ? 'Background score: ON — click to stop'
                   : 'Background score: OFF — click to play';
  }

  function build() {
    document.head.appendChild(style);
    btn = document.createElement('button');
    btn.id = 'nazar-bgm-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle background score');
    btn.innerHTML = ICON;
    btn.addEventListener('click', () => {
      on = !on;
      try { localStorage.setItem(ON_KEY, on ? '1' : '0'); } catch {}
      if (on) { audio.muted = false; audio.play().catch(() => {}); }
      else    { audio.pause(); }
      reflect();
    });
    document.body.appendChild(btn);
    reflect();
  }

  // ---- resume playback on load if it was left ON -----------------------
  const ACT = ['pointerdown', 'mousedown', 'keydown', 'touchend', 'click'];
  function detach() { ACT.forEach(e => window.removeEventListener(e, onGesture, true)); }
  function onGesture() {
    if (!on) { detach(); return; }
    audio.muted = false;
    const p = audio.play();
    if (p && p.then) p.then(() => { if (!audio.paused) detach(); }).catch(() => {});
  }
  function resume() {
    if (!on) return;
    audio.muted = false;
    const p = audio.play();
    if (p && p.catch) {
      p.catch(() => {
        // Fresh-page autoplay blocked — resume on the next interaction.
        ACT.forEach(e => window.addEventListener(e, onGesture, true));
      });
    }
  }

  function init() { build(); resume(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.NazarBGM = { audio, isOn() { return on; } };
})();
