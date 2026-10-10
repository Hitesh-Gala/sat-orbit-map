// launch-map-2d.js — the launch-site atlas, flattened.
//
// The same data/launch-map.json the globe uses, drawn on an equirectangular
// SVG with the bundled Natural Earth outlines. Everything is plain SVG in one
// viewBox of degrees, so panning and zooming are just a viewBox edit and the
// pins stay a constant size on screen whatever the zoom.
(function () {
  'use strict';

  var CAT = {
    launch:      { label: 'Launch site',            color: '#ff7a3c', icon: '🚀' },
    agency:      { label: 'Space agency HQ',        color: '#67c8ff', icon: '🏛' },
    training:    { label: 'Astronaut training',     color: '#ff6f9c', icon: '🧑‍🚀' },
    facility:    { label: 'Mission control / DSN',  color: '#ffcf5c', icon: '📡' },
    gnss:        { label: 'GNSS ground station',    color: '#58d68d', icon: '🛰' },
    observatory: { label: 'Observatory',            color: '#c9a0ff', icon: '🔭' },
    icbm:        { label: 'ICBM / missile test',    color: '#ff4d4d', icon: '⚠️' },
  };
  var ORDER = ['launch', 'agency', 'training', 'facility', 'gnss', 'observatory', 'icbm'];
  var SVGNS = 'http://www.w3.org/2000/svg';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var fmt = function (n) { return Number(n).toLocaleString('en-US'); };

  // Equirectangular: longitude and latitude are the coordinate system, with the
  // origin moved to the top-left so the viewBox can stay positive.
  var W = 360, H = 180;
  var px = function (lon) { return lon + 180; };
  var py = function (lat) { return 90 - lat; };

  var svg = $('lm2-svg'), tip = null;
  var SITES = [], on = {}, query = '';
  var view = { x: 0, y: 0, w: W, h: H };

  function el(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function applyView() {
    svg.setAttribute('viewBox', view.x + ' ' + view.y + ' ' + view.w + ' ' + view.h);
    // Pins are drawn in degrees, so without this they would balloon as we zoom.
    var k = view.w / W;
    [].forEach.call(svg.querySelectorAll('.lm2-pin'), function (g) {
      g.setAttribute('transform', g.dataset.tf + ' scale(' + k + ')');
    });
    [].forEach.call(svg.querySelectorAll('.lm2-grat, .lm2-land'), function (p) {
      p.setAttribute('stroke-width', 0.5 * k);
    });
  }

  function zoom(factor, cx, cy) {
    var nw = Math.max(12, Math.min(W, view.w * factor));
    var nh = nw * (H / W);
    if (cx == null) { cx = view.x + view.w / 2; cy = view.y + view.h / 2; }
    view.x = cx - (cx - view.x) * (nw / view.w);
    view.y = cy - (cy - view.y) * (nh / view.h);
    view.w = nw; view.h = nh;
    clampView();
    applyView();
  }

  function clampView() {
    view.x = Math.max(0, Math.min(W - view.w, view.x));
    view.y = Math.max(0, Math.min(H - view.h, view.y));
  }

  // ---- land outlines ----------------------------------------------------
  function drawLand(geo, parent) {
    function ring(coords) {
      var d = '';
      for (var i = 0; i < coords.length; i++) {
        var c = coords[i];
        d += (i ? 'L' : 'M') + px(c[0]).toFixed(2) + ' ' + py(c[1]).toFixed(2);
      }
      return d + 'Z';
    }
    var d = '';
    (geo.features || []).forEach(function (f) {
      var g = f.geometry;
      if (!g) return;
      if (g.type === 'Polygon') g.coordinates.forEach(function (r) { d += ring(r); });
      else if (g.type === 'MultiPolygon') g.coordinates.forEach(function (p) { p.forEach(function (r) { d += ring(r); }); });
    });
    el('path', { d: d, class: 'lm2-land' }, parent);
  }

  function drawGraticule(parent) {
    var d = '';
    for (var lon = -180; lon <= 180; lon += 30) d += 'M' + px(lon) + ' 0V' + H;
    for (var lat = -60; lat <= 60; lat += 30) d += 'M0 ' + py(lat) + 'H' + W;
    el('path', { d: d, class: 'lm2-grat' }, parent);
    el('path', { d: 'M0 ' + py(0) + 'H' + W, class: 'lm2-grat lm2-eq' }, parent);
  }

  // ---- pins -------------------------------------------------------------
  function tipHtml(d) {
    var c = CAT[d.t] || CAT.facility, rows = '';
    var row = function (k, v) { return '<div><span>' + k + '</span><b>' + v + '</b></div>'; };
    rows += row('Altitude', d.el != null ? fmt(d.el) + ' m' : '—');
    if (d.ar != null) rows += row('Area', fmt(d.ar) + ' km²');
    if (d.t === 'launch' && d.la != null) rows += row('Launches', '≈ ' + fmt(d.la));
    if (d.t === 'icbm' && d.la != null) rows += row('Test launches', '≈ ' + fmt(d.la));
    if (d.est) rows += row('Established', esc(d.est));
    if (d.op) rows += row('Operator', esc(d.op));
    rows += row('Position', d.lat.toFixed(2) + '°, ' + d.lon.toFixed(2) + '°');
    return '<div class="name">' + esc(d.n) + '</div>' +
      '<div class="type" style="color:' + c.color + '">' + c.icon + ' ' + c.label + ' · ' + esc(d.cty) + '</div>' +
      '<div class="rows">' + rows + '</div>' +
      (d.nb ? '<div class="note">' + esc(d.nb) + '</div>' : '');
  }

  function showTip(d, ev) {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'lm2-tip';
      $('lm2-map').appendChild(tip);
    }
    tip.innerHTML = tipHtml(d);
    tip.hidden = false;
    var box = $('lm2-map').getBoundingClientRect();
    var x = ev.clientX - box.left + 16, y = ev.clientY - box.top + 16;
    tip.style.left = Math.min(x, box.width - tip.offsetWidth - 10) + 'px';
    tip.style.top = Math.min(y, box.height - tip.offsetHeight - 10) + 'px';
  }
  function hideTip() { if (tip) tip.hidden = true; }

  function matches(d) {
    if (!on[d.t]) return false;
    if (!query) return true;
    return (d.n + ' ' + d.cty + ' ' + (d.op || '')).toLowerCase().indexOf(query) !== -1;
  }

  function drawPins() {
    var layer = $('lm2-pins');
    layer.innerHTML = '';
    var shown = 0;
    SITES.forEach(function (d) {
      if (!matches(d)) return;
      shown++;
      var c = (CAT[d.t] || CAT.facility).color;
      var g = el('g', { class: 'lm2-pin' }, layer);
      g.dataset.tf = 'translate(' + px(d.lon).toFixed(3) + ' ' + py(d.lat).toFixed(3) + ')';
      el('circle', { class: 'halo', r: 3.4, fill: c }, g);
      el('circle', { class: 'core', r: 1.35, fill: c }, g);
      g.addEventListener('mouseenter', function (ev) { showTip(d, ev); g.classList.add('on'); });
      g.addEventListener('mousemove', function (ev) { showTip(d, ev); });
      g.addEventListener('mouseleave', function () { hideTip(); g.classList.remove('on'); });
      // The globe is the richer view, so a click hands the site over to it.
      g.addEventListener('click', function () {
        location.href = 'launch-map.html#site=' + encodeURIComponent(d.n);
      });
    });
    applyView();
    $('lm2-count').textContent = shown.toLocaleString() + ' of ' + SITES.length.toLocaleString() + ' markers shown';
  }

  function renderLegend() {
    var counts = {};
    SITES.forEach(function (d) { counts[d.t] = (counts[d.t] || 0) + 1; });
    $('lm2-legend').innerHTML = ORDER.filter(function (k) { return counts[k]; }).map(function (k) {
      var c = CAT[k];
      return '<label class="lm2-cat"><input type="checkbox" data-cat="' + k + '"' + (on[k] ? ' checked' : '') + '>' +
        '<span class="sw" style="background:' + c.color + ';color:' + c.color + '"></span>' +
        '<span class="nm">' + c.icon + ' ' + c.label + '</span><b>' + counts[k] + '</b></label>';
    }).join('');
    $('lm2-legend').addEventListener('change', function (e) {
      var cb = e.target.closest('input[data-cat]');
      if (!cb) return;
      on[cb.dataset.cat] = cb.checked;
      drawPins();
    });
  }

  // ---- pan / zoom -------------------------------------------------------
  function wirePanZoom() {
    var dragging = false, last = null;
    svg.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.lm2-pin')) return;
      dragging = true; last = { x: e.clientX, y: e.clientY };
      svg.classList.add('dragging');
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var r = svg.getBoundingClientRect();
      view.x -= (e.clientX - last.x) * (view.w / r.width);
      view.y -= (e.clientY - last.y) * (view.h / r.height);
      last = { x: e.clientX, y: e.clientY };
      clampView();
      applyView();
    });
    var end = function () { dragging = false; svg.classList.remove('dragging'); };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = svg.getBoundingClientRect();
      var cx = view.x + ((e.clientX - r.left) / r.width) * view.w;
      var cy = view.y + ((e.clientY - r.top) / r.height) * view.h;
      zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2, cx, cy);
    }, { passive: false });
    $('lm2-in').addEventListener('click', function () { zoom(1 / 1.4); });
    $('lm2-out').addEventListener('click', function () { zoom(1.4); });
    $('lm2-reset').addEventListener('click', function () {
      view = { x: 0, y: 0, w: W, h: H };
      applyView();
    });
  }

  // ---- boot -------------------------------------------------------------
  Promise.all([
    fetch('data/launch-map.json').then(function (r) { return r.json(); }),
    fetch('data/countries-110m.geojson').then(function (r) { return r.json(); }).catch(function () { return null; }),
  ]).then(function (res) {
    SITES = res[0] || [];
    ORDER.forEach(function (k) { on[k] = true; });

    var base = el('g', {}, svg);
    if (res[1]) drawLand(res[1], base);
    drawGraticule(base);
    el('g', { id: 'lm2-pins' }, svg);

    renderLegend();
    drawPins();
    wirePanZoom();

    $('lm2-q').addEventListener('input', function (e) {
      query = e.target.value.trim().toLowerCase();
      drawPins();
    });
    $('lm2-all').addEventListener('click', function () {
      ORDER.forEach(function (k) { on[k] = true; });
      renderLegend(); drawPins();
    });
    $('lm2-none').addEventListener('click', function () {
      ORDER.forEach(function (k) { on[k] = false; });
      renderLegend(); drawPins();
    });
  }).catch(function (e) {
    $('lm2-count').textContent = 'Could not load the sites: ' + e.message;
  });
})();
