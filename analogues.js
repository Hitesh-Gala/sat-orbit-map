// analogues.js — the analytical layer over Indi-Space.
//
// Two readings of one mapping (data/analogues.json): a global company and the
// Indian firms doing comparable work, and the same links read backwards.  Each
// is drawn as a spider web — hub in the middle, counterparts on a ring — and a
// click on any node opens that company's own web in the other section.
(function () {
  'use strict';

  var CATS = {
    launch: { label: 'Launch & Propulsion', color: '#ff7a3c' },
    sat:    { label: 'Satellites & Platforms', color: '#67c8ff' },
    eo:     { label: 'Earth Observation', color: '#58d68d' },
    rf:     { label: 'Electronics & RF', color: '#c9a0ff' },
    heavy:  { label: 'Heavy Engineering', color: '#ffcf5c' },
    ssa:    { label: 'Space Awareness', color: '#ff6f9c' },
  };
  var SVGNS = 'http://www.w3.org/2000/svg';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }
  function colorOf(cat) { return (CATS[cat] || CATS.sat).color; }

  var GLOBAL = {}, INDIAN = {}, BY_G = {}, BY_I = {}, NOTE = {}, LOGOS = {};
  var sel = { g: null, i: null };

  // Logos were fetched once into data/logos (see scripts/gen_analogues.py's
  // companion fetcher); the manifest says which ones exist, so a company
  // without one falls back to a monogram instead of a broken image.
  function logoSrc(slug) { return LOGOS[slug] ? 'data/logos/' + slug + '.png' : ''; }
  function markHtml(slug, name, color) {
    var src = logoSrc(slug);
    if (src) return '<img class="an-logo" src="' + esc(src) + '" alt="" loading="lazy">';
    return '<span class="an-mono" style="--c:' + color + '">' + esc((name || '?').charAt(0).toUpperCase()) + '</span>';
  }

  // ---- data -------------------------------------------------------------
  function index(an, ind) {
    an.global.forEach(function (g) { GLOBAL[g.id] = g; });
    ind.forEach(function (c) { INDIAN[c.num] = c; });
    an.links.forEach(function (l) {
      (BY_G[l.g] = BY_G[l.g] || []).push(l.i);
      (BY_I[l.i] = BY_I[l.i] || []).push(l.g);
      NOTE[l.g + '|' + l.i] = l.note || '';
    });
  }

  // A pair with no note of its own still deserves a reason: fall back to what
  // the global company is known for, which is what makes the two comparable.
  function why(gid, inum) {
    var n = NOTE[gid + '|' + inum];
    if (n) return n;
    var g = GLOBAL[gid];
    return g ? 'Comparable work: ' + g.focus.charAt(0).toLowerCase() + g.focus.slice(1) + '.' : '';
  }

  // ---- pickers ----------------------------------------------------------
  function renderList(which) {
    var box = $('list-' + which), q = ($('q-' + which).value || '').toLowerCase();
    var rows;
    if (which === 'g') {
      rows = Object.keys(BY_G).map(function (id) { return GLOBAL[id]; }).filter(Boolean)
        .sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; })
        .filter(function (g) { return !q || (g.name + ' ' + g.country + ' ' + g.focus).toLowerCase().indexOf(q) !== -1; })
        .map(function (g) {
          return { id: g.id, slug: 'g-' + g.id, name: g.name, cat: g.cat,
                   sub: g.country + ' · ' + (BY_G[g.id] || []).length + ' Indian counterpart' +
                        ((BY_G[g.id] || []).length === 1 ? '' : 's') };
        });
    } else {
      rows = Object.keys(BY_I).map(function (n) { return INDIAN[n]; }).filter(Boolean)
        .sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; })
        .filter(function (c) { return !q || (c.name + ' ' + c.sector).toLowerCase().indexOf(q) !== -1; })
        .map(function (c) {
          return { id: c.num, slug: 'in-' + c.num, name: c.name, cat: c.cat,
                   sub: (BY_I[c.num] || []).length + ' global counterpart' +
                        ((BY_I[c.num] || []).length === 1 ? '' : 's') };
        });
    }
    box.innerHTML = rows.map(function (r) {
      var col = colorOf(r.cat);
      return '<button type="button" class="an-opt' + (sel[which] === r.id ? ' on' : '') + '" data-id="' + esc(r.id) +
        '" style="--c:' + col + '">' + markHtml(r.slug, r.name, col) +
        '<span class="txt">' + esc(r.name) + '<span class="sub">' + esc(r.sub) + '</span></span></button>';
    }).join('') || '<div class="an-hint">Nothing matches that search.</div>';
  }

  // ---- the web ----------------------------------------------------------
  function el(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }

  // Names are long and the boxes are small: break on spaces into at most
  // `max` lines, hard-truncating only as a last resort.
  function wrap(text, perLine, max) {
    var words = String(text).split(/\s+/), lines = [''], i;
    for (i = 0; i < words.length; i++) {
      var cand = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + words[i] : words[i];
      if (cand.length <= perLine || !lines[lines.length - 1]) lines[lines.length - 1] = cand;
      else lines.push(words[i]);
    }
    if (lines.length > max) {
      lines = lines.slice(0, max);
      lines[max - 1] = lines[max - 1].replace(/.{0,3}$/, '…');
    }
    return lines;
  }

  function nodeBox(parent, x, y, title, sub, color, isHub, onPick, onHover, slug) {
    var lg = isHub ? 28 : 22;                       // the mark sits inside the box, at its left
    var w = (isHub ? 232 : 186) + lg + 6, lines = wrap(title, isHub ? 22 : 20, 2);
    var h = Math.max((isHub ? 30 : 24) + lines.length * (isHub ? 19 : 16) + (sub ? 15 : 0), lg + 16);
    var g = el('g', { class: 'node' + (isHub ? ' hub' : ''), style: '--cat:' + color, tabindex: '0',
                      role: 'button', 'aria-label': title }, parent);
    el('rect', { class: 'bg', x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 9 }, g);
    var lx = x - w / 2 + 10, ly = y - lg / 2, src = logoSrc(slug);
    if (src) {
      el('rect', { x: lx, y: ly, width: lg, height: lg, rx: 5, fill: '#fff' }, g);
      var im = el('image', { x: lx + 2, y: ly + 2, width: lg - 4, height: lg - 4,
                             preserveAspectRatio: 'xMidYMid meet' }, g);
      im.setAttribute('href', src);
      im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', src);
    } else {
      el('rect', { x: lx, y: ly, width: lg, height: lg, rx: 5, fill: color, 'fill-opacity': '.85' }, g);
      var mono = el('text', { x: lx + lg / 2, y: ly + lg / 2 + 5, 'text-anchor': 'middle',
                              style: 'font-size:' + (lg - 10) + 'px;fill:#04101c;font-weight:700' }, g);
      mono.textContent = (title || '?').charAt(0).toUpperCase();
    }
    var tx = x + (lg + 6) / 2;                      // text centres in what is left of the box
    var ty = y - h / 2 + (isHub ? 24 : 19);
    lines.forEach(function (ln) {
      var t = el('text', { x: tx, y: ty, 'text-anchor': 'middle' }, g);
      t.textContent = ln;
      ty += isHub ? 19 : 16;
    });
    if (sub) {
      var s = el('text', { class: 'sub', x: tx, y: ty + 1, 'text-anchor': 'middle' }, g);
      s.textContent = sub;
    }
    if (onPick) {
      g.addEventListener('click', onPick);
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } });
    }
    if (onHover) {
      g.addEventListener('mouseenter', onHover);
      g.addEventListener('focus', onHover);
    }
    return g;
  }

  function drawWeb(which) {
    var svg = $('web-' + which);
    svg.innerHTML = '';
    var id = sel[which];
    var hub, leaves, hubColor, hubSub;
    if (which === 'g') {
      hub = GLOBAL[id];
      if (!hub) return;
      hubColor = colorOf(hub.cat);
      hubSub = hub.country;
      leaves = (BY_G[id] || []).map(function (n) {
        var c = INDIAN[n];
        return { id: n, slug: 'in-' + n, name: c ? c.name : n,
                 sub: c ? (CATS[c.cat] || {}).label : '', color: colorOf(c && c.cat) };
      });
    } else {
      hub = INDIAN[id];
      if (!hub) return;
      hubColor = colorOf(hub.cat);
      hubSub = 'India · ' + ((CATS[hub.cat] || {}).label || '');
      leaves = (BY_I[id] || []).map(function (gid) {
        var g = GLOBAL[gid];
        return { id: gid, slug: 'g-' + gid, name: g ? g.name : gid,
                 sub: g ? g.country : '', color: colorOf(g && g.cat) };
      });
    }

    var W = 980, H = 660, cx = W / 2, cy = H / 2;
    var n = leaves.length;
    var rx = Math.min(360, 180 + n * 14), ry = Math.min(250, 120 + n * 12);
    el('ellipse', { class: 'ring', cx: cx, cy: cy, rx: rx, ry: ry }, svg);

    var edges = el('g', {}, svg), nodes = el('g', {}, svg);
    leaves.forEach(function (leaf, k) {
      // start at the top and go clockwise, so the first counterpart is where
      // the eye lands first
      var a = -Math.PI / 2 + (2 * Math.PI * k) / Math.max(n, 1);
      var x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a);
      var mx = cx + (x - cx) * 0.55, my = cy + (y - cy) * 0.55 + (y < cy ? -16 : 16);
      var edge = el('path', { class: 'edge', style: '--cat:' + leaf.color,
                              d: 'M ' + cx + ' ' + cy + ' Q ' + mx + ' ' + my + ' ' + x + ' ' + y }, edges);
      var detail = function () { showDetail(which, leaf, edge, edges); };
      nodeBox(nodes, x, y, leaf.name, leaf.sub, leaf.color, false, function () { jump(which, leaf.id); }, detail, leaf.slug);
    });
    nodeBox(nodes, cx, cy, hub.name, hubSub, hubColor, true, null, function () { showHub(which, hub); },
            which === 'g' ? 'g-' + hub.id : 'in-' + hub.num);
    showHub(which, hub);
  }

  // ---- detail strip -----------------------------------------------------
  function showHub(which, hub) {
    var box = $('det-' + which);
    var isG = which === 'g';
    var count = (isG ? BY_G[hub.id] : BY_I[hub.num]) || [];
    box.innerHTML = '<div class="nm">' + markHtml(isG ? 'g-' + hub.id : 'in-' + hub.num, hub.name, colorOf(hub.cat)) +
      '<span>' + esc(hub.name) + '</span>' +
      '<span class="flag">' + esc(isG ? hub.country : 'India') + '</span></div>' +
      '<div class="ft">' + esc(isG ? hub.focus : hub.sector) + '</div>' +
      '<div class="why">' + count.length + (isG ? ' Indian' : ' global') + ' counterpart' + (count.length === 1 ? '' : 's') +
      ' on the web around it.</div>' +
      (hub.website || hub.url ? '<div class="acts"><a href="' + esc(hub.website || hub.url) +
        '" target="_blank" rel="noopener noreferrer">' + esc(host(hub.website || hub.url)) + ' ↗</a></div>' : '');
  }

  function showDetail(which, leaf, edge, edges) {
    [].forEach.call(edges.querySelectorAll('.edge'), function (e) { e.classList.remove('hot'); });
    if (edge) edge.classList.add('hot');
    var isG = which === 'g';
    var gid = isG ? sel.g : leaf.id;
    var inum = isG ? leaf.id : sel.i;
    var ind = INDIAN[inum], glob = GLOBAL[gid];
    var subject = isG ? ind : glob;
    if (!subject) return;
    var box = $('det-' + which);
    box.innerHTML = '<div class="nm">' + markHtml(leaf.slug, subject.name, leaf.color) +
      '<span>' + esc(subject.name) + '</span>' +
      '<span class="flag">' + esc(isG ? 'India' : glob.country) + '</span></div>' +
      '<div class="ft">' + esc(isG ? ind.sector : glob.focus) + '</div>' +
      '<div class="why">' + esc(why(gid, inum)) + '</div>' +
      '<div class="acts">' +
      (subject.website || subject.url ? '<a href="' + esc(subject.website || subject.url) +
        '" target="_blank" rel="noopener noreferrer">' + esc(host(subject.website || subject.url)) + ' ↗</a>' : '') +
      (isG ? '<a href="indi-space.html#' + esc(ind.num) + '">Open its Indi-Space profile ↗</a>' : '') +
      '<button type="button" data-jump="' + esc(leaf.id) + '">Open ' + esc(subject.name) + '’s own web</button>' +
      '</div>';
    var btn = box.querySelector('[data-jump]');
    if (btn) btn.addEventListener('click', function () { jump(which, leaf.id); });
  }

  // Clicking a node crosses to the other section: a global node opens its own
  // Indian web, an Indian node opens its global one.
  function jump(fromWhich, id) {
    var to = fromWhich === 'g' ? 'i' : 'g';
    if (!(to === 'g' ? GLOBAL[id] : INDIAN[id])) return;
    select(to, id);
    var sec = $('sec-' + to);
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function select(which, id) {
    sel[which] = id;
    renderList(which);
    drawWeb(which);
    var on = $('list-' + which).querySelector('.an-opt.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }

  // ---- boot -------------------------------------------------------------
  function wire(which) {
    $('q-' + which).addEventListener('input', function () { renderList(which); });
    $('list-' + which).addEventListener('click', function (e) {
      var b = e.target.closest('.an-opt');
      if (b) select(which, b.dataset.id);
    });
  }

  Promise.all([
    fetch('data/analogues.json').then(function (r) { return r.json(); }),
    fetch('data/indi-space.json').then(function (r) { return r.json(); }),
    fetch('data/logos/_manifest.json').then(function (r) { return r.json(); }).catch(function () { return []; }),
  ]).then(function (res) {
    (res[2] || []).forEach(function (slug) { LOGOS[slug] = 1; });
    index(res[0], res[1]);
    wire('g');
    wire('i');
    select('g', 'iceye');
    select('i', '25');
    $('an-foot').innerHTML = esc(res[0].about) + ' Compiled ' + esc(res[0].compiled) + ' · ' +
      Object.keys(GLOBAL).length + ' global companies, ' + Object.keys(BY_I).length +
      ' Indian companies, ' + res[0].links.length + ' pairings.';
  }).catch(function (e) {
    $('an-foot').textContent = 'Could not load the mapping: ' + e.message;
  });
})();
