// Welcome flash popup — main page only.
//
// Injects a red announcement popup ("NAZAR · YOUR EYE ON SATELLITES IN
// THE SKY") on top of the globe.  The popup auto-dismisses after
// AUTO_CLOSE_MS, or the user can close it manually via the × button,
// the backdrop, or the Escape key.

(function () {
  const TITLE          = 'NAZAR';
  const SUBTITLE       = 'YOUR EYE ON SATELLITES IN THE SKY';
  const AUTO_CLOSE_MS  = 10_000;
  const FADE_OUT_MS    = 320;   // must stay in sync with .closing CSS transition

  function build() {
    const backdrop = document.createElement('div');
    backdrop.className = 'flash-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const popup = document.createElement('div');
    popup.className = 'flash-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('aria-labelledby', 'flash-title');
    popup.innerHTML = `
      <img class="flash-logo" src="data/takshashila-logo.svg" alt="Takshashila Institution">
      <button type="button" class="flash-close" aria-label="Close announcement">×</button>
      <div class="flash-eye" aria-hidden="true">👁</div>
      <div class="flash-title" id="flash-title">${TITLE}</div>
      <div class="flash-subtitle">${SUBTITLE}</div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(popup);

    // Trigger the .shown transition from opacity:0 → 1.  Wait one
    // beat so the browser registers the initial state, otherwise the
    // class lands on the same paint as the append and the transition
    // is skipped.  setTimeout (not requestAnimationFrame) so the
    // popup also "arrives" in tabs that are currently hidden — rAF
    // is paused in those.
    setTimeout(() => {
      backdrop.classList.add('shown');
      popup.classList.add('shown');
    }, 16);

    let closed = false;
    let autoTimer = setTimeout(close, AUTO_CLOSE_MS);

    function close() {
      if (closed) return;
      closed = true;
      clearTimeout(autoTimer);
      backdrop.classList.remove('shown');
      popup.classList.remove('shown');
      popup.classList.add('closing');
      setTimeout(() => {
        backdrop.remove();
        popup.remove();
        document.removeEventListener('keydown', onKey);
      }, FADE_OUT_MS);
    }

    function onKey(e) {
      if (e.key === 'Escape') close();
    }

    popup.querySelector('.flash-close').addEventListener('click', close);
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
