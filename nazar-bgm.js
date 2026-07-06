// NAZAR ambient background music.
//
// Plays one looping track site-wide, resuming its position across page
// navigations so it feels continuous, and stops only when "Play NAZAR" is
// pressed on the Orbit Visualisation page (which calls window.NazarBGM.silence()).
//
// Autoplay reality: browsers block AUDIBLE playback until the user has
// interacted with the page, but they always allow MUTED playback.  So we:
//   1. Try an audible autoplay immediately.
//   2. If that's blocked, start playing MUTED (always allowed) so the track is
//      running from load, then unmute on the very first user interaction —
//      pointer / mouse / key / touch.  (Once the site has some playback
//      history the browser tends to allow audible autoplay outright.)
// Resume position + the "silenced" flag live in sessionStorage: continuous
// within a browsing session; a fresh session (new tab / reopen) starts again.

(function () {
  const SRC     = 'audio/social-network-theme.mp3';
  const POS_KEY = 'nazar.bgm.pos';   // resume position (seconds)
  const OFF_KEY = 'nazar.bgm.off';   // silenced ("Play NAZAR" pressed)
  const VOLUME  = 0.35;

  let silenced = false;
  try { silenced = sessionStorage.getItem(OFF_KEY) === '1'; } catch {}

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
  window.addEventListener('beforeunload', persistPos);

  // Events that grant "user activation" (enough to start audible audio).
  const ACT_EVENTS = ['pointerdown', 'mousedown', 'keydown', 'touchend', 'click'];
  function detach() {
    ACT_EVENTS.forEach(ev => window.removeEventListener(ev, onGesture, true));
  }

  // First real interaction → make the track audible and playing.
  function onGesture() {
    if (silenced) { detach(); return; }
    audio.muted = false;
    const p = audio.play();
    if (p && p.then) {
      p.then(() => { if (!audio.paused && !audio.muted) detach(); }).catch(() => {});
    } else {
      detach();
    }
  }

  // On load: try audible autoplay; if blocked, fall back to muted playback so
  // the track is running, and let the first gesture unmute it.
  function start() {
    if (silenced) return;
    audio.muted = false;
    const p = audio.play();
    if (p && p.catch) {
      p.catch(() => {
        if (silenced) return;
        audio.muted = true;
        audio.play().catch(() => { /* even muted blocked — a gesture will start it */ });
      });
    }
  }

  ACT_EVENTS.forEach(ev => window.addEventListener(ev, onGesture, true));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Public API — Orbit Visualisation's "Play NAZAR" button calls silence().
  window.NazarBGM = {
    silence() {
      silenced = true;
      try { sessionStorage.setItem(OFF_KEY, '1'); } catch {}
      detach();
      try { audio.pause(); } catch {}
    },
    isSilenced() { return silenced; },
    audio,
  };
})();
