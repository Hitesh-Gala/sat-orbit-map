// NAZAR ambient background music.
//
// Plays one looping track site-wide from the moment any page loads, resuming
// its position across page navigations so it feels continuous, and stops only
// when "Play NAZAR" is pressed on the Orbit Visualisation page (which calls
// window.NazarBGM.silence()).
//
// Notes:
//   * Browser autoplay policies block audible sound until the user has
//     interacted with the page, so we attempt to play immediately AND on the
//     first pointer/key/touch gesture — whichever the browser allows first.
//   * Resume position + the "silenced" flag live in sessionStorage: continuous
//     within a browsing session, and a fresh session (new tab / reopen) starts
//     the music again.  Pressing "Play NAZAR" silences it for the rest of the
//     session so the two tracks never overlap.

(function () {
  const SRC     = 'audio/social-network-theme.mp3';
  const POS_KEY = 'nazar.bgm.pos';   // sessionStorage: resume position (seconds)
  const OFF_KEY = 'nazar.bgm.off';   // sessionStorage: silenced ("Play NAZAR" pressed)
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

  function tryPlay() {
    if (silenced) return;
    const p = audio.play();
    if (p && p.catch) p.catch(() => { /* autoplay blocked → wait for a gesture */ });
  }

  // Autoplay-unlock: start on the first user interaction if the browser
  // blocked the immediate attempt.  Remove the listeners once it's playing.
  function onGesture() { tryPlay(); }
  const GESTURES = ['pointerdown', 'keydown', 'touchstart', 'click'];
  GESTURES.forEach(ev => window.addEventListener(ev, onGesture, { passive: true }));
  audio.addEventListener('playing', () => {
    GESTURES.forEach(ev => window.removeEventListener(ev, onGesture));
  }, { once: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryPlay);
  } else {
    tryPlay();
  }

  // Public API — Orbit Visualisation's "Play NAZAR" button calls silence().
  window.NazarBGM = {
    silence() {
      silenced = true;
      try { sessionStorage.setItem(OFF_KEY, '1'); } catch {}
      GESTURES.forEach(ev => window.removeEventListener(ev, onGesture));
      try { audio.pause(); } catch {}
    },
    isSilenced() { return silenced; },
    audio,
  };
})();
