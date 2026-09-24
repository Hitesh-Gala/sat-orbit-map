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
  const isMain = () => document.body.classList.contains('page-main');
  // Pages whose drawer holds page controls rather than navigation: there the
  // drawer becomes a floating, movable card and the button says CONTROLS.
  const CONTROL_PANELS = '.viz-shell, .goc-shell, .sbo-shell, .debris-shell';
  const hasControls = () => !!document.querySelector(CONTROL_PANELS);
  let tools = null, logoTap = null, strap = null, drag = null;

  // ---- bottom-right tools cluster -----------------------------------------
  // Each entry points at a control that already exists on the page; the
  // chip just drives it, so the underlying behaviour (and its desktop
  // button) stays exactly as it was.
  // One letter each, sized like the music button they replace.
  function toolSpecs() {
    return [
      { key: 'connect', txt: 'C', label: 'Connect with me', el: '.fb-fab', act: el => el.click(), close: true },
      { key: 'india', txt: 'V', label: 'View everything over India', el: '#allsats-btn', act: el => el.click(), close: true },
      { key: 'ticker', txt: 'TT', label: 'Ticker tape', el: '.news-ticker',
        act: () => document.body.classList.toggle('nz-ticker-on'),
        state: () => document.body.classList.contains('nz-ticker-on') },
      { key: 'music', txt: '♪', label: 'Music', el: '#nazar-bgm-toggle',
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
      chip.textContent = spec.txt;
      chip.title = spec.label;
      chip.setAttribute('aria-label', spec.label);
      chip.addEventListener('click', () => {
        const el = $(spec.el);
        if (!el) return;
        spec.act(el);
        if (spec.state) chip.classList.toggle('on', !!spec.state(el));
        if (spec.close) setOpen(false);
      });
      list.appendChild(chip);
    }

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'nz-pill';
    pill.setAttribute('aria-label', 'Show controls');
    pill.setAttribute('aria-expanded', 'false');
    pill.innerHTML = '<span class="ic">•••</span>';
    pill.addEventListener('click', () => setOpen(!tools.classList.contains('open')));

    tools.append(list, pill);
    document.body.appendChild(tools);

    // A tap anywhere else closes the cluster, so it never sits over the globe.
    document.addEventListener('pointerdown', onOutside, true);
  }

  function setOpen(open) {
    if (!tools) return;
    tools.classList.toggle('open', open);
    // The open buttons stand where the ticker runs, so it steps aside for them.
    document.body.classList.toggle('nz-tools-open', open);
    const pill = tools.querySelector('.nz-pill');
    pill.setAttribute('aria-expanded', String(open));
    pill.querySelector('.ic').textContent = open ? '✕' : '•••';
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

  // ---- one-line strap under the top row (main page only) -------------------
  function buildStrap() {
    if (strap || !isMain()) return;
    strap = document.createElement('div');
    strap.className = 'nz-strap';
    strap.textContent = 'Your friendly satellite-tracker site. Works better on desktops';
    document.body.appendChild(strap);
  }

  function destroyStrap() {
    if (strap) strap.remove();
    strap = null;
  }

  // ---- the drawer button, and HOME under the mark --------------------------
  function labelChrome() {
    const btn = $('.mobile-menu-btn');
    if (btn && hasControls()) {
      btn.querySelector('.lbl').textContent =
        document.body.classList.contains('menu-open') ? 'CLOSE' : 'CONTROLS';
    }
    const home = $('.top-nazar-btn');
    if (home) {
      const lbl = home.querySelector('.lbl');
      if (lbl) lbl.textContent = 'HOME';
      home.title = 'Back to the NAZAR main page';
    }
  }

  // mobile-menu.js rewrites MENU/CLOSE on every toggle, so the CONTROLS name
  // is re-applied right after each one.
  let relabel = null;
  function watchLabel() {
    const btn = $('.mobile-menu-btn');
    if (!btn || relabel) return;
    relabel = () => setTimeout(labelChrome, 0);
    btn.addEventListener('click', relabel);
  }

  function unwatchLabel() {
    const btn = $('.mobile-menu-btn');
    if (btn && relabel) btn.removeEventListener('click', relabel);
    relabel = null;
  }

  function unlabelChrome() {
    const btn = $('.mobile-menu-btn');
    if (btn) btn.querySelector('.lbl').textContent =
      document.body.classList.contains('menu-open') ? 'CLOSE' : 'MENU';
    const home = $('.top-nazar-btn');
    const lbl = home && home.querySelector('.lbl');
    if (lbl) lbl.textContent = 'NAZAR';
  }

  // ---- the controls card can be dragged out of the way ---------------------
  function makeDraggable(card, handle) {
    let id = null, dx = 0, dy = 0;
    const down = e => {
      if (e.target.closest('button, a, input, select, summary')) return;
      id = e.pointerId;
      const r = card.getBoundingClientRect();
      dx = e.clientX - r.left;
      dy = e.clientY - r.top;
      card.style.right = 'auto';
      card.style.left = r.left + 'px';
      card.style.top = r.top + 'px';
      handle.setPointerCapture(id);
      e.preventDefault();
    };
    const move = e => {
      if (e.pointerId !== id) return;
      const w = card.offsetWidth, h = card.offsetHeight;
      card.style.left = Math.min(Math.max(4, e.clientX - dx), innerWidth - w - 4) + 'px';
      card.style.top = Math.min(Math.max(4, e.clientY - dy), innerHeight - Math.min(h, 120) - 4) + 'px';
    };
    const up = e => { if (e.pointerId === id) id = null; };
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    drag = { handle, down, move, up };
  }

  function floatDrawer() {
    const drawer = document.querySelector('.mobile-drawer');
    if (!drawer || !hasControls() || drawer.querySelector('.nz-drag')) return;
    document.body.classList.add('nz-floating');
    const bar = document.createElement('div');
    bar.className = 'nz-drag';
    bar.innerHTML = '<span class="nz-drag-grip">⠿</span><span>Controls</span>' +
                    '<button type="button" class="nz-drag-x" aria-label="Close controls">✕</button>';
    drawer.insertBefore(bar, drawer.firstChild);
    bar.querySelector('.nz-drag-x').addEventListener('click', () => {
      const btn = $('.mobile-menu-btn');
      if (btn) btn.click();                    // mobile-menu.js owns open/closed
      setTimeout(labelChrome, 0);
    });
    makeDraggable(drawer, bar);
  }

  function unfloatDrawer() {
    document.body.classList.remove('nz-floating');
    const bar = document.querySelector('.mobile-drawer .nz-drag');
    if (bar) bar.remove();
    drag = null;
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

  // ---- the name shows its full form and tagline on tap ---------------------
  // The top bar carries just "NAZAR" on a phone; the expansion and the
  // Hinglish tagline appear under it for a few seconds when it is tapped.
  let titleTap = null, titleTimer = 0;

  function buildTitleTap() {
    const brand = $('.brand');
    if (!brand || titleTap) return;
    if (!$('.nz-title-card')) {
      const long = ($('.brand-long') || {}).textContent || '';
      const sub = ($('.sub') || {}).textContent || '';
      const card = document.createElement('div');
      card.className = 'nz-title-card';
      card.innerHTML = `<div class="nz-title-long">${long.replace(/^[\s—·]+/, '')}</div>` +
                       (sub ? `<div class="nz-title-sub">${sub}</div>` : '');
      document.body.appendChild(card);
    }
    titleTap = () => {
      if (!mq.matches) return;
      document.body.classList.add('nz-title-on');
      clearTimeout(titleTimer);
      titleTimer = setTimeout(() => document.body.classList.remove('nz-title-on'), 4500);
    };
    brand.addEventListener('click', titleTap);
  }

  function destroyTitleTap() {
    const brand = $('.brand');
    if (brand && titleTap) brand.removeEventListener('click', titleTap);
    titleTap = null;
    clearTimeout(titleTimer);
    document.body.classList.remove('nz-title-on');
    const card = $('.nz-title-card');
    if (card) card.remove();
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
    // On a control page the floating card's own header names it, so its panel
    // is left bare rather than wrapped in a second collapsible header.
    const floating = hasControls();
    for (const { sel, title, open } of SECTIONS) {
      if (floating && sel !== '.left-nav' && sel !== '.hud-tr') continue;
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
      buildTitleTap();
      buildStrap();
      labelChrome();
      watchLabel();
      // mobile-menu.js builds the drawer on the same media-query event; wait
      // a frame so the panels are inside it before folding them.
      requestAnimationFrame(() => { foldDrawer(); floatDrawer(); labelChrome(); });
    } else {
      document.body.classList.remove('nz-mobile');
      destroyTools();
      destroyLogoTap();
      destroyTitleTap();
      destroyStrap();
      unlabelChrome();
      unwatchLabel();
      unfloatDrawer();
      unfoldDrawer();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
  window.addEventListener('load', () => { if (mq.matches) buildTools(); });
  if (mq.addEventListener) mq.addEventListener('change', apply);
  else mq.addListener(apply);
})();
