// launch-map.js — a world globe of launch sites, agency HQs, GNSS ground
// stations, observatories, ICBM ranges and more. Two globe styles
// (realistic Blue Marble / political country map with hover-labels), cone
// markers colour-coded by category, and a per-category checkbox filter.
(function () {
  'use strict';

  var IMG = 'https://unpkg.com/three-globe@2.31.1/example/img/';
  var BLUE = IMG + 'earth-blue-marble.jpg';
  var TOPO = IMG + 'earth-topology.png';
  var NIGHT = IMG + 'night-sky.png';
  var DARK = IMG + 'earth-dark.jpg';

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
  var PAL = ['#2e4a6b', '#3a5a54', '#5a4a6b', '#6b5a3a', '#3a6b5a', '#6b3a4a', '#43536b', '#5a6b3a'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var fmt = function (n) { return Number(n).toLocaleString('en-US'); };
  function polyName(f) { return (f.properties && (f.properties.NAME || f.properties.name || f.properties.ADMIN)) || ''; }
  function fillColor(f) {
    var n = polyName(f), h = 0;
    for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    return PAL[h % PAL.length];
  }

  function row(k, v) { return '<span class="k">' + k + '</span><span class="v">' + v + '</span>'; }
  function tip(d) {
    var t = CAT[d.t] || CAT.facility, rows = [];
    rows.push(row('Altitude', d.el != null ? fmt(d.el) + ' m' : '—'));
    if (d.ar != null) rows.push(row('Area', fmt(d.ar) + ' km²'));
    if (d.t === 'launch' && d.la != null) rows.push(row('Launches', '≈ ' + fmt(d.la) + ' <span style="color:#7d93ab">(approx.)</span>'));
    if (d.t === 'icbm' && d.la != null) rows.push(row('Test launches', '≈ ' + fmt(d.la)));
    if (d.est) rows.push(row('Established', d.est));
    if (d.op) rows.push(row('Operator', esc(d.op)));
    return '<div class="lm-tip">' +
      '<div class="name">' + esc(d.n) + '</div>' +
      '<div class="type" style="color:' + t.color + '">' + t.icon + ' ' + t.label + ' · ' + esc(d.cty) + '</div>' +
      '<div class="rows">' + rows.join('') + '</div>' +
      (d.nb ? '<div class="note">' + esc(d.nb) + '</div>' : '') +
    '</div>';
  }

  // Cone marker — apex points radially outward. globe.gl's Objects layer
  // orients each object's local +Y away from the surface when
  // objectFacesSurface(false), and ConeGeometry's apex is at +Y.
  function coneMesh(d) {
    var col = (CAT[d.t] || CAT.facility).color;
    var geo = new THREE.ConeGeometry(0.82, 2.9, 18);
    var mat = new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.45 });
    return new THREE.Mesh(geo, mat);
  }

  var globe, countries = { features: [] }, political = false, sites = [];
  var active = {}; ORDER.forEach(function (k) { active[k] = true; });

  function visible() { return sites.filter(function (d) { return active[d.t]; }); }
  function refresh() { globe.objectsData(visible()); }

  function setStyle(mode) {
    political = mode === 'political';
    if (political) globe.globeImageUrl(DARK).bumpImageUrl(null).polygonsData(countries.features);
    else globe.globeImageUrl(BLUE).bumpImageUrl(TOPO).polygonsData([]);
    document.querySelectorAll('.lm-toggle button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.globe === mode);
    });
  }

  function buildLegend() {
    var counts = {}; ORDER.forEach(function (k) { counts[k] = sites.filter(function (d) { return d.t === k; }).length; });
    var el = document.getElementById('lm-legend');
    el.innerHTML = ORDER.map(function (k) {
      var c = CAT[k];
      return '<label class="lm-cat"><input type="checkbox" data-cat="' + k + '" checked>' +
        '<span class="sw" style="background:' + c.color + ';color:' + c.color + '"></span>' +
        '<span class="nm">' + c.icon + ' ' + esc(c.label) + '</span>' +
        '<b>' + counts[k] + '</b></label>';
    }).join('');
    el.addEventListener('change', function (e) {
      var cb = e.target.closest('input[data-cat]'); if (!cb) return;
      active[cb.dataset.cat] = cb.checked;
      refresh();
      document.getElementById('lm-status').textContent = visible().length + ' of ' + sites.length + ' shown';
    });
    // quick all / none
    document.getElementById('lm-all').addEventListener('click', function () { setAll(true); });
    document.getElementById('lm-none').addEventListener('click', function () { setAll(false); });
  }
  function setAll(v) {
    ORDER.forEach(function (k) { active[k] = v; });
    document.querySelectorAll('#lm-legend input[data-cat]').forEach(function (cb) { cb.checked = v; });
    refresh();
    document.getElementById('lm-status').textContent = visible().length + ' of ' + sites.length + ' shown';
  }

  function boot(data, geo) {
    sites = data; countries = geo || { features: [] };
    var el = document.getElementById('globe');
    globe = Globe()(el)
      .backgroundImageUrl(NIGHT)
      .globeImageUrl(BLUE)
      .bumpImageUrl(TOPO)
      .showAtmosphere(true).atmosphereColor('#5aa9ff').atmosphereAltitude(0.16)
      .objectsData(sites)
      .objectLat('lat').objectLng('lon')
      .objectAltitude(0.01)
      .objectFacesSurface(false)
      .objectThreeObject(coneMesh)
      .objectLabel(tip)
      .polygonsData([])
      .polygonCapColor(fillColor)
      .polygonSideColor(function () { return 'rgba(0,0,0,0)'; })
      .polygonStrokeColor(function () { return 'rgba(190,210,230,0.35)'; })
      .polygonAltitude(0.006)
      .polygonLabel(function (f) { return '<div class="lm-country">' + esc(polyName(f)) + '</div>'; });

    globe.pointOfView({ lat: 25, lng: 10, altitude: 2.4 }, 0);

    buildLegend();
    document.getElementById('lm-status').textContent = sites.length + ' sites plotted';

    document.querySelector('.lm-toggle').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (b) setStyle(b.dataset.globe);
    });
    function resize() { globe.width(el.clientWidth).height(el.clientHeight); }
    window.addEventListener('resize', resize);

    // orientation self-check (no screenshot available): is a cone's apex
    // farther from globe centre than its base? → pointing outward.
    setTimeout(function () {
      try {
        var found = null;
        globe.scene().traverse(function (o) {
          if (!found && o.isMesh && o.geometry && o.geometry.type === 'ConeGeometry') found = o;
        });
        if (found) {
          found.updateWorldMatrix(true, false);
          var apex = new THREE.Vector3(0, 1.45, 0).applyMatrix4(found.matrixWorld);
          var base = new THREE.Vector3(0, -1.45, 0).applyMatrix4(found.matrixWorld);
          window.__lmCone = { apexR: apex.length().toFixed(1), baseR: base.length().toFixed(1), outward: apex.length() > base.length() };
        }
      } catch (e) { window.__lmCone = { err: e.message }; }
    }, 1500);
  }

  Promise.all([
    fetch('data/launch-map.json').then(function (r) { return r.json(); }),
    fetch('data/countries-110m.geojson').then(function (r) { return r.json(); }).catch(function () { return { features: [] }; }),
  ]).then(function (res) { boot(res[0], res[1]); })
    .catch(function (err) {
      var s = document.getElementById('lm-status');
      if (s) s.textContent = 'Failed to load: ' + err.message;
    });
})();
