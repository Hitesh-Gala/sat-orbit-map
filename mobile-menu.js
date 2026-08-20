// ---------------------------------------------------------------------------
// Service-worker cleanup (defensive belt-and-braces).
//
// The site used to ship a cache-first SW at /service-worker.js between
// 2026-05-27 and 2026-06-01.  The SW was removed from the repo by a
// rollback, but it remains installed in any browser that visited
// during that window — serving stale HTML / JS / data on every visit
// (the "second laptop only sees 725 sats" report).
//
// The primary fix is the kill-switch service-worker.js at the site
// root, which uninstalls itself when the browser revalidates the SW
// JS.  This block here is the secondary safety net: any fresh HTML
// that successfully loads mobile-menu.js gets an immediate cleanup,
// so even users whose SW revalidation lags behind end up SW-free.
// No-op for users who never had the legacy SW.
// ---------------------------------------------------------------------------
(function killLegacySW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => { for (const r of regs) r.unregister(); })
      .catch(() => {});
  }
  if (window.caches && caches.keys) {
    caches.keys()
      .then((keys) => keys.forEach((k) => caches.delete(k)))
      .catch(() => {});
  }
})();

// ---------------------------------------------------------------------------
// Space-policy credit that hugs the lighthouse logo, on every page.  Injected
// here (rather than in each page's markup) so all ~15 pages stay in sync from
// one place.  Two compact lines; styled via .logo-credit (beside / beneath the
// logo) in styles.css, or via each self-contained page's own inline .logo-credit.
//
// Placement depends on where the logo lives:
//   • logo is a direct <body> child (the shared-CSS pages) → append the credit
//     to <body> too, so .logo-credit (position:absolute, top-right) can sit
//     beside or beneath the mark and scroll with it just like the logo does.
//   • logo sits inside a sticky/backdrop-filtered header (the self-contained
//     pages) → insert the credit right after the logo, in that header's flow,
//     so it rides along with the sticky bar instead of being trapped or adrift.
// ---------------------------------------------------------------------------
(function insertLogoCredit() {
  function run() {
    const logo = document.querySelector('.top-logo');
    if (!logo) return;                                  // NAZAR pages only
    if (document.querySelector('.logo-credit')) return; // never duplicate
    const credit = document.createElement('div');
    credit.className = 'logo-credit';
    credit.innerHTML =
      'Hitesh Gala is a Researcher in Space<br>' +
      'and a Defence Fellow at -<br>' +
      '<a href="https://takshashila.org.in" target="_blank" rel="noopener noreferrer">www.takshashila.org.in</a>';
    // Main-page desktop only: a slightly larger, brighter 2-line credit, broken
    // after the full stop with the top line centred over the (longer) bottom line.
    if (document.body.classList.contains('page-main') && window.innerWidth > 720) {
      credit.innerHTML =
        'Hitesh Gala is a Space Researcher &amp;<br>' +
        'A Defence Fellow at <a href="https://takshashila.org.in" target="_blank" rel="noopener noreferrer">www.takshashila.org.in</a>';
      credit.style.fontSize = '11px';
      credit.style.color = '#b6c6d6';
      credit.style.textAlign = 'center';
    }
    if (logo.parentElement === document.body) document.body.appendChild(credit);
    else logo.insertAdjacentElement('afterend', credit);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

// Universal mobile menu — loaded on every page.
//
// On phones (≤ 720 px) the page is otherwise unreadable because the
// globe + satellites get covered by stacked HUD panels and nav bars.
// This script:
//   1. Injects a single ☰ MENU button at the top-left.
//   2. Moves every chrome panel on the page (.left-nav, .hud-tr, .hud-tl,
//      .viz-shell, .goc-shell, .repo-header .right, .page-2d-header
//      .right, compendium .header-right) into a unified drop-down drawer.
//   3. Hides that drawer (and therefore everything in it) by default so
//      the globe canvas is the dominant visual element.
//   4. Toggles the drawer via the ☰ button, a backdrop tap, or Escape.
//   5. Auto-closes when the user taps a navigation link inside the
//      drawer (so they don't have to dismiss the menu manually before
//      the next page loads).
//
// On desktop the script is a no-op — panels stay in their original DOM
// positions and the button + backdrop are absent.

(function () {
  // "Phone" = narrow OR short-and-not-wide.  The second arm catches
  // landscape phones, whose width (e.g. 844 px on an iPhone) sails past
  // the old 720-px cut-off and used to drop them into the DESKTOP
  // layout.  Their height (~390–430 px) is what gives them away.  The
  // max-width:950 guard keeps landscape tablets (height ≥ 768) on the
  // desktop layout.  This string must stay identical to the matching
  // CSS media queries in styles.css.
  const PHONE_MQ = '(max-width: 720px), (max-height: 500px) and (max-width: 950px)';
  const MOBILE_MQ = window.matchMedia(PHONE_MQ);

  // Order matters: this is the top-to-bottom stacking order inside the
  // drawer.  Navigation first, then page-specific controls, then HUD.
  const PANEL_SELECTORS = [
    '.left-nav',
    '.viz-shell',
    '.goc-shell',
    '.sbo-shell',
    '.hud-tl',
    '.hud-tr',
    '.repo-header .right',
    '.page-2d-header .right',
    '.header-inner .header-right',
  ];

  // Tag globe pages so the CSS can keep the globe visible behind / beside
  // the open drawer (a black void where the globe used to be is jarring).
  // The mobile-menu.js script tag sits at the end of <body>, so the body
  // exists by now.
  if (document.getElementById('globe')) document.body.classList.add('has-globe');

  let menuBtn = null;
  let backdrop = null;
  let drawer = null;
  const moved = [];   // [{ elem, parent, nextSibling }, …]

  function build() {
    if (menuBtn) return;

    menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'mobile-menu-btn';
    menuBtn.setAttribute('aria-label', 'Toggle navigation menu');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.innerHTML = '<span class="ico">☰</span><span class="lbl">MENU</span>';

    backdrop = document.createElement('div');
    backdrop.className = 'mobile-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    drawer = document.createElement('div');
    drawer.className = 'mobile-drawer';
    drawer.setAttribute('role', 'menu');
    drawer.setAttribute('aria-hidden', 'true');

    document.body.appendChild(menuBtn);
    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);

    // Relocate every existing chrome panel into the drawer.  Remember
    // each one's previous home so we can restore it if the viewport
    // grows back to desktop width.
    for (const sel of PANEL_SELECTORS) {
      const elems = document.querySelectorAll(sel);
      for (const elem of elems) {
        moved.push({
          elem,
          parent: elem.parentNode,
          nextSibling: elem.nextSibling,
        });
        drawer.appendChild(elem);
      }
    }

    menuBtn.addEventListener('click', toggle);
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    drawer.addEventListener('click', onDrawerClick);
  }

  function destroy() {
    if (!menuBtn) return;
    close();
    document.removeEventListener('keydown', onKey);

    // Restore moved panels to their original DOM positions.
    for (const { elem, parent, nextSibling } of moved) {
      if (!parent || !parent.isConnected) continue;
      if (nextSibling && nextSibling.isConnected) parent.insertBefore(elem, nextSibling);
      else                                        parent.appendChild(elem);
    }
    moved.length = 0;

    menuBtn.remove();
    backdrop.remove();
    drawer.remove();
    menuBtn = backdrop = drawer = null;
  }

  function setOpen(open) {
    document.body.classList.toggle('menu-open', open);
    if (menuBtn) {
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.querySelector('.ico').textContent = open ? '✕' : '☰';
      menuBtn.querySelector('.lbl').textContent = open ? 'CLOSE' : 'MENU';
    }
    if (drawer)   drawer.setAttribute('aria-hidden', String(!open));
    if (backdrop) backdrop.setAttribute('aria-hidden', String(!open));
  }
  function toggle() { setOpen(!document.body.classList.contains('menu-open')); }
  function close()  { setOpen(false); }

  function onKey(e) {
    if (e.key === 'Escape' && document.body.classList.contains('menu-open')) close();
  }

  // Tap on an <a> inside the drawer → close after the navigation kicks
  // in.  Buttons (theme toggle, tab switches, sliders) leave the menu
  // open so the user can keep adjusting controls.
  function onDrawerClick(e) {
    const link = e.target.closest('a');
    if (!link) return;
    setTimeout(close, 50);
  }

  function apply() {
    if (MOBILE_MQ.matches) build();
    else                   destroy();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
  // matchMedia.addEventListener is the modern API; the older addListener
  // is needed for Safari < 14.
  if (MOBILE_MQ.addEventListener) MOBILE_MQ.addEventListener('change', apply);
  else                            MOBILE_MQ.addListener(apply);

  // -------------------------------------------------------------------------
  // Rotate-to-landscape prompt.
  //
  // The globe is the star of every visual page, and it has far more room
  // in landscape.  A web page can't force a device to rotate (no API does
  // this reliably, and iOS Safari blocks it outright), so instead we show
  // a gentle full-screen hint while a globe page is held in portrait.  It
  // auto-vanishes the moment the phone is turned to landscape, and the
  // user can dismiss it to read in portrait anyway (remembered for the
  // session).  Only appears on pages that actually have a globe.
  // -------------------------------------------------------------------------
  (function rotatePrompt() {
    if (!document.getElementById('globe')) return;   // text pages read fine upright
    if (document.body.classList.contains('page-main')) return;  // main page is built for portrait too

    const PORTRAIT_MQ = window.matchMedia(
      '(orientation: portrait) and (max-width: 720px), ' +
      '(orientation: portrait) and (max-height: 950px) and (pointer: coarse)');
    let el = null;

    function dismissed() {
      try { return sessionStorage.getItem('nazar.rotate.dismissed') === '1'; } catch { return false; }
    }
    function build() {
      if (el) return;
      el = document.createElement('div');
      el.className = 'rotate-prompt';
      el.innerHTML =
        '<div class="rotate-icon" aria-hidden="true">↻</div>' +
        '<div class="rotate-title">Rotate your device</div>' +
        '<div class="rotate-sub">NAZAR’s globe is best viewed in landscape.</div>' +
        '<button type="button" class="rotate-dismiss">View in portrait anyway</button>';
      el.querySelector('.rotate-dismiss').addEventListener('click', () => {
        try { sessionStorage.setItem('nazar.rotate.dismissed', '1'); } catch {}
        teardown();
      });
      document.body.appendChild(el);
    }
    function teardown() { if (el) { el.remove(); el = null; } }
    function sync() {
      if (PORTRAIT_MQ.matches && !dismissed()) build();
      else teardown();
    }
    sync();
    if (PORTRAIT_MQ.addEventListener) PORTRAIT_MQ.addEventListener('change', sync);
    else                              PORTRAIT_MQ.addListener(sync);
  })();

  // -------------------------------------------------------------------------
  // Maximise the globe: enter fullscreen on the first touch.
  //
  // A page can't go fullscreen on load (browsers require a user gesture),
  // so we arm a one-shot listener for the first tap on a globe page and
  // request fullscreen then.  Where supported (Android Chrome etc.) this
  // hides the browser chrome and hands all that height to the globe.
  // Skipped on the Orbit Visualisation page, which runs its own immersive
  // fullscreen via the Play-NAZAR button, and on iOS where the element
  // Fullscreen API is unavailable (the try/catch makes it a silent no-op).
  // -------------------------------------------------------------------------
  (function fullscreenOnFirstTap() {
    if (!document.getElementById('globe')) return;           // visual pages only
    if (document.getElementById('nazar-audio')) return;      // orbits owns its own fullscreen
    if (!window.matchMedia('(pointer: coarse)').matches) return;  // touch devices only
    const el = document.documentElement;
    if (!el.requestFullscreen && !el.webkitRequestFullscreen) return;

    function go() {
      window.removeEventListener('pointerdown', go);
      try {
        if (document.fullscreenElement) return;
        (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      } catch { /* unsupported / blocked — leave the page as-is */ }
    }
    window.addEventListener('pointerdown', go, { once: true, passive: true });
  })();

  // -------------------------------------------------------------------------
  // NAZAR-button drop-down (desktop).
  //
  // The top-left logo and the various "NAZAR" / back buttons used to jump
  // straight to the main page.  Now they open a drop-down listing every
  // page (the same set as the main page's left-hand nav), and choosing one
  // opens that page maximised.  On phones the ☰ MENU drawer already owns
  // navigation, so there the buttons keep their plain "go home" behaviour.
  // -------------------------------------------------------------------------
  (function nazarDropdown() {
    const PAGES = [
      { href: 'index.html',         icon: '◯', label: 'Live Globe (Home)' },
      { href: 'about.html',         icon: 'ℹ', label: 'About / Help' },
      { href: 'orbits.html',        icon: '↻', label: 'Orbit Visualisation' },
      { href: 'orbit-maker.html',   icon: '🪐', label: 'Orbit Maker' },
      { href: 'game-of-cones.html', icon: '◭', label: 'Game of Cones' },
      { href: 'chinrepo.html',      icon: '★', label: 'China Sat Repo' },
      { href: 'viz3d.html',         icon: '⬢', label: 'God Mode' },
      { href: '2d-views.html',      icon: '⊞', label: '2D View' },
      { href: 'sats-by-ops.html',   icon: '⊕', label: 'SATs-by-OPs' },
      { href: 'overpass.html',      icon: '⌖', label: 'Overpass' },
      { href: 'debris.html',        icon: '✷', label: 'Debris Tracker' },
      { href: 'launch-map.html',    icon: '🌐', label: 'Global Launch Sites' },
    ];

    // Collect the "go to NAZAR home" controls: the logo + the labelled
    // NAZAR/back buttons.  Skip content links (about-page cards / CTAs).
    // The lighthouse + satellite logo (.top-logo) is deliberately NOT a trigger:
    // it stays a plain link straight to the home page (no drop-down, no
    // fullscreen).  Only the labelled "NAZAR" / back buttons open the menu.
    const triggers = new Set();
    document.querySelectorAll('.top-nazar-btn, .btn-nazar').forEach((el) => triggers.add(el));
    document.querySelectorAll('a[href="index.html"]').forEach((a) => {
      if (a.matches('.top-logo, .page-card, .about-cta')) return;
      if (/nazar/i.test((a.textContent || '').trim())) triggers.add(a);
    });
    if (!triggers.size) return;

    // Inject the drop-down's styles here so it also works on the two pages
    // (compendium, china-sat-series) that ship their own inline CSS instead
    // of the shared styles.css.  Vars fall back to a dark floating panel.
    const style = document.createElement('style');
    style.textContent =
      ".nazar-dropdown{position:fixed;z-index:200;min-width:214px;max-width:calc(100vw - 16px);" +
      "padding:6px;display:flex;flex-direction:column;gap:3px;background:var(--panel,rgba(8,16,28,0.97));" +
      "border:1px solid var(--line,rgba(120,170,220,0.28));border-radius:8px;box-shadow:0 14px 40px rgba(0,0,0,0.55);" +
      "backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:nazar-dd-in .12s ease-out;" +
      "font-family:var(--mono,'JetBrains Mono',ui-monospace,monospace)}" +
      ".nazar-dropdown[hidden]{display:none}" +
      "@keyframes nazar-dd-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}" +
      ".nazar-dd-item{display:flex;align-items:center;gap:9px;padding:7px 11px;border:1px solid transparent;" +
      "border-radius:5px;color:var(--accent,#67c8ff);font-size:13px;letter-spacing:.04em;text-decoration:none;" +
      "white-space:nowrap;transition:background .12s,border-color .12s}" +
      ".nazar-dd-item:hover{background:rgba(103,200,255,.14);border-color:var(--line,rgba(120,170,220,.28))}" +
      ".nazar-dd-ico{flex:0 0 auto;width:16px;text-align:center;opacity:.9}";
    document.head.appendChild(style);

    const menu = document.createElement('div');
    menu.className = 'nazar-dropdown';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    menu.innerHTML = PAGES.map((p) =>
      `<a class="nazar-dd-item" role="menuitem" href="${p.href}">` +
      `<span class="nazar-dd-ico" aria-hidden="true">${p.icon}</span><span>${p.label}</span></a>`
    ).join('');
    document.body.appendChild(menu);

    let openTrigger = null;
    function openAt(trigger) {
      openTrigger = trigger;
      menu.hidden = false;
      const r = trigger.getBoundingClientRect();
      const mw = menu.offsetWidth, mh = menu.offsetHeight;
      let left = Math.min(r.left, window.innerWidth - 8 - mw);
      left = Math.max(8, left);
      let top = r.bottom + 6;
      if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - 6 - mh);  // flip up if no room below
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
    }
    function closeMenu() { menu.hidden = true; openTrigger = null; }

    triggers.forEach((t) => {
      t.addEventListener('click', (e) => {
        if (MOBILE_MQ.matches) return;             // phones: keep plain go-home
        e.preventDefault();
        e.stopPropagation();
        if (!menu.hidden && openTrigger === t) { closeMenu(); return; }
        openAt(t);
      });
    });

    // Choosing a page: flag it to open maximised, then let the link navigate.
    menu.addEventListener('click', (e) => {
      if (!e.target.closest('a.nazar-dd-item')) return;
      try { sessionStorage.setItem('nazar.enterFS', '1'); } catch { /* private mode */ }
    });

    document.addEventListener('click', (e) => {
      if (menu.hidden) return;
      if (menu.contains(e.target)) return;
      for (const t of triggers) if (t.contains(e.target)) return;
      closeMenu();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
  })();

  // -------------------------------------------------------------------------
  // Open maximised after a drop-down navigation.
  //
  // A page can't enter fullscreen on load (a user gesture is required and
  // it does not survive navigation), so when the previous page flagged the
  // jump we request fullscreen on the visitor's first interaction here.
  // -------------------------------------------------------------------------
  (function enterFullscreenAfterNav() {
    let want = false;
    try { want = sessionStorage.getItem('nazar.enterFS') === '1'; } catch { /* private mode */ }
    if (!want) return;
    try { sessionStorage.removeItem('nazar.enterFS'); } catch {}
    const el = document.documentElement;
    if (!el.requestFullscreen && !el.webkitRequestFullscreen) return;
    const evs = ['pointerdown', 'keydown', 'click', 'touchstart'];
    function go() {
      evs.forEach((ev) => window.removeEventListener(ev, go, true));
      try {
        if (!document.fullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      } catch { /* blocked — leave the page as-is */ }
    }
    evs.forEach((ev) => window.addEventListener(ev, go, true));
  })();
})();
