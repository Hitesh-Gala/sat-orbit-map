// Phone UX layer — the globe first, everything else one tap away.
//
// Desktop is untouched: every rule here is gated on the same phone media
// query the rest of the site uses, and the layer tears itself down if the
// viewport grows back (a rotated tablet, a resized desktop window).
//
// What it does on a phone:
//   1. Collects the loose floating controls — Connect with me, the ticker
//      tape, the music toggle and "View everything over India" — into one
//      bottom-right tools cluster.  They stay hidden until the user opens it.
//   2. Hides the Takshashila credit until the lighthouse mark is tapped.
//   3. Folds the drawer's panels into labelled, collapsible sections with
//      thumb-sized rows.
//
// Loaded after mobile-menu.js, which owns the ☰ drawer itself.
(function () {
  'use strict';

  // Must stay identical to the media queries in styles.css / mobile-menu.js.
  const PHONE_MQ = '(max-width: 720px), (max-height: 500px) and (max-width: 950px)';
  const mq = window.matchMedia(PHONE_MQ);

  const $ = s => document.querySelector(s);
  let tools = null, logoTap = null;

  // ---- bottom-right tools cluster -----------------------------------------
  // Each entry points at a control that already exists on the page; the
  // chip just drives it, so the underlying behaviour (and its desktop
  // button) stays exactly as it was.
  function toolSpecs() {
    return [
      { key: 'india', ic: '🛰', label: 'Over India', el: '#allsats-btn', act: el => el.click(), close: true },
      { key: 'connect', ic: '💬', label: 'Connect', el: '.fb-fab', act: el => el.click(), close: true },
      { key: 'ticker', ic: '📰', label: 'Ticker tape', el: '.news-ticker',
        act: () => document.body.classList.toggle('nz-ticker-on'),
        state: () => document.body.classList.contains('nz-ticker-on') },
      { key: 'music', ic: '♪', label: 'Music', el: '#nazar-bgm-toggle',
        act: el => el.click(), state: el => el.getAttribute('aria-pressed') === 'true' },
    ].filter(t => $(t.el));
  }

  function buildTools() {
    if (!document.body.classList.contains('page-main')) return;
    const specs = toolSpecs();
    if (!specs.length) return;
    // Rebuild when a control has appeared since the last pass (feedback.js
    // injects its button on load, after this script first runs).
    if (tools) {
      if (tools.querySelectorAll('.nz-chip').length === specs.length) return;
      destroyTools();
    }

    tools = document.createElement('div');
    tools.className = 'nz-tools';
    const list = document.createElement('div');
    list.className = 'nz-tools-list';

    for (const spec of specs) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'nz-chip';
      chip.dataset.key = spec.key;
      chip.innerHTML = `<span class="ic">${spec.ic}</span><span>${spec.label}</span>`;
      chip.addEventListener('click', () => {
        const el = $(spec.el);
        if (!el) return;
        spec.act(el);
        if (spec.state) chip.classList.toggle('on', !!spec.state(el));
        if (spec.close) setOpen(false);
      });
      list.appendChild(chip);
    }

    const fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'nz-fab';
    fab.setAttribute('aria-label', 'Tools');
    fab.setAttribute('aria-expanded', 'false');
    fab.innerHTML = '<span class="ic">⋯</span>';
    fab.addEventListener('click', () => setOpen(!tools.classList.contains('open')));

    tools.append(list, fab);
    document.body.appendChild(tools);

    // A tap anywhere else closes the cluster, so it never sits over the globe.
    document.addEventListener('pointerdown', onOutside, true);
  }

  function setOpen(open) {
    if (!tools) return;
    tools.classList.toggle('open', open);
    // The open chips stand where the ticker runs, so it steps aside for them.
    document.body.classList.toggle('nz-tools-open', open);
    tools.querySelector('.nz-fab').setAttribute('aria-expanded', String(open));
    tools.querySelector('.nz-fab .ic').textContent = open ? '✕' : '⋯';
  }

  function onOutside(e) {
    if (tools && tools.classList.contains('open') && !tools.contains(e.target)) setOpen(false);
  }

  function destroyTools() {
    if (!tools) return;
    document.removeEventListener('pointerdown', onOutside, true);
    tools.remove();
    tools = null;
    document.body.classList.remove('nz-ticker-on', 'nz-tools-open');
  }

  // ---- the lighthouse opens the credit ------------------------------------
  // On a phone the mark's "go home" tap is redundant (the ☰ drawer and the
  // NAZAR button both do it), so it earns its keep as the credit's handle.
  function buildLogoTap() {
    const logo = $('.top-logo');
    if (!logo || logoTap) return;
    logoTap = e => {
      if (!mq.matches) return;
      e.preventDefault();
      document.body.classList.toggle('nz-credit-on');
    };
    logo.addEventListener('click', logoTap);
  }

  function destroyLogoTap() {
    const logo = $('.top-logo');
    if (logo && logoTap) logo.removeEventListener('click', logoTap);
    logoTap = null;
    document.body.classList.remove('nz-credit-on');
  }

  // ---- drawer panels become collapsible sections ---------------------------
  const SECTIONS = [
    { sel: '.left-nav', title: 'Explore NAZAR', open: true },
    { sel: '.hud-tr', title: 'Live data & controls', open: false },
    { sel: '.hud-tl', title: 'Details', open: false },
    { sel: '.viz-shell', title: 'Controls', open: true },
    { sel: '.goc-shell', title: 'Controls', open: true },
    { sel: '.sbo-shell', title: 'Controls', open: true },
    { sel: '.debris-shell', title: 'Controls', open: true },
  ];

  function foldDrawer() {
    const drawer = document.querySelector('.mobile-drawer');
    if (!drawer) return;
    for (const { sel, title, open } of SECTIONS) {
      const panel = drawer.querySelector(':scope > ' + sel);
      if (!panel) continue;
      const box = document.createElement('details');
      box.className = 'nz-sec';
      box.open = open;
      const head = document.createElement('summary');
      head.textContent = title;
      const body = document.createElement('div');
      body.className = 'nz-sec-body';
      drawer.insertBefore(box, panel);
      box.append(head, body);
      body.appendChild(panel);
    }
  }

  // mobile-menu.js restores the panels to the page when it tears the drawer
  // down, so the wrappers are all that is left behind — drop them.
  function unfoldDrawer() {
    document.querySelectorAll('.nz-sec').forEach(sec => sec.remove());
  }

  // ---- wiring --------------------------------------------------------------
  function apply() {
    if (mq.matches) {
      document.body.classList.add('nz-mobile');
      buildTools();
      buildLogoTap();
      // mobile-menu.js builds the drawer on the same media-query event; wait
      // a frame so the panels are inside it before folding them.
      requestAnimationFrame(foldDrawer);
    } else {
      document.body.classList.remove('nz-mobile');
      destroyTools();
      destroyLogoTap();
      unfoldDrawer();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
  window.addEventListener('load', () => { if (mq.matches) buildTools(); });
  if (mq.addEventListener) mq.addEventListener('change', apply);
  else mq.addListener(apply);
})();
