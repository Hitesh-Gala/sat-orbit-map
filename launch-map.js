// launch-map.js — a world globe of launch sites, agency HQs, GNSS ground
// stations, observatories, ICBM ranges and more.  A main globe (realistic /
// political) plus a right-side launcher of ~11 pop-up globe STYLES (textured
// and data-driven), each re-plotting the same site data.
(function () {
  'use strict';

  var IMG = 'https://unpkg.com/three-globe@2.31.1/example/img/';
  var BLUE = IMG + 'earth-blue-marble.jpg';
  var TOPO = IMG + 'earth-topology.png';
  var NIGHT = IMG + 'night-sky.png';
  var DARK = IMG + 'earth-dark.jpg';
  var WATER = IMG + 'earth-water.png';
  var G = 'data/globes/';

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

  // Pop-up globe styles. `layer` selects a data-driven look; otherwise textured.
  var STYLES = [
    { key: 'blue', icon: '🌍', name: 'Blue Marble', desc: 'Realistic satellite view + terrain relief', img: BLUE, bump: TOPO, bg: NIGHT, atmo: '#5aa9ff' },
    { key: 'satellite', icon: '🛰', name: 'Satellite (cloudless)', desc: 'True-colour land, ocean & ice', img: G + 'globe-realistic.jpg', bg: NIGHT, atmo: '#7fb6ff' },
    { key: 'physical', icon: '🗺', name: 'Physical map', desc: 'Natural-Earth terrain with a graticule', img: G + 'globe-physical.jpg', bg: '#050a12', atmo: '#88b6e0' },
    { key: 'night', icon: '🌃', name: 'Night lights', desc: 'City lights of the human world', img: G + 'globe-night.jpg', bg: NIGHT, atmo: '#3a6bd0' },
    { key: 'relief', icon: '⛰️', name: 'Topographic relief', desc: 'SRTM shaded elevation of the land', img: G + 'globe-elevation.jpg', bg: '#000000', atmo: null },
    { key: 'ocean', icon: '🌊', name: 'Land & ocean', desc: 'Simplified blue-planet mask', img: WATER, bg: '#04101c', atmo: '#4aa3ff' },
    { key: 'dark', icon: '⬛', name: 'Dark minimal', desc: 'Muted dark globe — markers pop', img: DARK, bg: '#000008', atmo: null },
    { key: 'political', icon: '🏛️', name: 'Political', desc: 'Countries in colour · hover for names', img: DARK, bg: '#020610', layer: 'political', atmo: null },
    { key: 'choropleth', icon: '📊', name: 'Launch sites by country', desc: 'Countries shaded by number of launch sites', img: DARK, bg: '#020610', layer: 'choropleth', atmo: null },
    { key: 'density', icon: '🔥', name: 'Site density', desc: 'Hex-bin heat-map of every plotted site', img: DARK, bg: NIGHT, layer: 'density', atmo: '#5aa9ff' },
    { key: 'wire', icon: '🕸️', name: 'Wireframe / graticule', desc: 'Dark globe with a coordinate grid', img: DARK, bg: '#01040a', graticule: true, atmo: '#3a6bd0' },
  ];

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

  // Cone marker — apex points radially outward (objectFacesSurface(false)).
  function coneMesh(d) {
    var col = (CAT[d.t] || CAT.facility).color;
    var geo = new THREE.ConeGeometry(0.82, 2.9, 18);
    var mat = new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.45 });
    return new THREE.Mesh(geo, mat);
  }

  // --- point-in-polygon (for the choropleth) --------------------------------
  function pointInRing(x, y, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function pointInFeature(lon, lat, f) {
    var g = f.geometry; if (!g) return false;
    var polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (var p = 0; p < polys.length; p++) if (pointInRing(lon, lat, polys[p][0])) return true;
    return false;
  }
  var choroMax = 1;
  function computeChoropleth() {
    sites.filter(function (s) { return s.t === 'launch'; }).forEach(function (s) {
      for (var i = 0; i < countries.features.length; i++) {
        if (pointInFeature(s.lon, s.lat, countries.features[i])) {
          countries.features[i].__lc = (countries.features[i].__lc || 0) + 1; break;
        }
      }
    });
    countries.features.forEach(function (f) { if (f.__lc > choroMax) choroMax = f.__lc; });
  }
  function choroColor(f) {
    var n = f.__lc || 0; if (!n) return 'rgba(38,52,72,0.72)';
    var t = Math.min(1, n / Math.max(3, choroMax));
    return 'rgba(' + Math.round(120 + 135 * t) + ',' + Math.round(150 - 60 * t) + ',' + Math.round(70 - 30 * t) + ',0.92)';
  }
  function choroLabel(f) {
    var n = f.__lc || 0;
    return '<div class="lm-country">' + esc(polyName(f)) + ' — <b>' + n + '</b> launch site' + (n === 1 ? '' : 's') + '</div>';
  }
  function hexColor(d) {
    var w = d.sumWeight || 1, t = Math.min(1, w / 6);
    return 'rgba(' + Math.round(90 + 165 * t) + ',' + Math.round(205 - 130 * t) + ',' + Math.round(190 - 130 * t) + ',0.85)';
  }

  // --- state ----------------------------------------------------------------
  var globe, gGlobe, gModal, gContainer;
  var countries = { features: [] }, sites = [], political = false;
  var active = {}; ORDER.forEach(function (k) { active[k] = true; });
  function visible() { return sites.filter(function (d) { return active[d.t]; }); }

  function setStyleMain(mode) {
    political = mode === 'political';
    if (political) globe.globeImageUrl(DARK).bumpImageUrl(null).polygonsData(countries.features);
    else globe.globeImageUrl(BLUE).bumpImageUrl(TOPO).polygonsData([]);
    document.querySelectorAll('.lm-toggle button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.globe === mode);
    });
  }
  function refreshMain() { globe.objectsData(visible()); }

  function buildLegend() {
    var counts = {}; ORDER.forEach(function (k) { counts[k] = sites.filter(function (d) { return d.t === k; }).length; });
    var el = document.getElementById('lm-legend');
    el.innerHTML = ORDER.map(function (k) {
      var c = CAT[k];
      return '<label class="lm-cat"><input type="checkbox" data-cat="' + k + '" checked>' +
        '<span class="sw" style="background:' + c.color + ';color:' + c.color + '"></span>' +
        '<span class="nm">' + c.icon + ' ' + esc(c.label) + '</span><b>' + counts[k] + '</b></label>';
    }).join('');
    el.addEventListener('change', function (e) {
      var cb = e.target.closest('input[data-cat]'); if (!cb) return;
      active[cb.dataset.cat] = cb.checked; refreshMain();
      document.getElementById('lm-status').textContent = visible().length + ' of ' + sites.length + ' shown';
    });
    document.getElementById('lm-all').addEventListener('click', function () { setAll(true); });
    document.getElementById('lm-none').addEventListener('click', function () { setAll(false); });
  }
  function setAll(v) {
    ORDER.forEach(function (k) { active[k] = v; });
    document.querySelectorAll('#lm-legend input[data-cat]').forEach(function (cb) { cb.checked = v; });
    refreshMain();
    document.getElementById('lm-status').textContent = visible().length + ' of ' + sites.length + ' shown';
  }

  // --- right-side style launcher + pop-up globe -----------------------------
  function buildStyleButtons() {
    var el = document.getElementById('lm-globes');
    el.innerHTML = '<div class="gh">🌐 Globe styles — open a pop-up</div>' + STYLES.map(function (s) {
      return '<button type="button" class="lm-gbtn" data-style="' + s.key + '">' +
        '<span class="gi">' + s.icon + '</span>' +
        '<span class="gt"><b>' + esc(s.name) + '</b><small>' + esc(s.desc) + '</small></span></button>';
    }).join('');
    el.addEventListener('click', function (e) {
      var b = e.target.closest('.lm-gbtn'); if (b) openStyle(b.dataset.style);
    });
    gModal = document.getElementById('lm-gmodal');
    gContainer = document.getElementById('lm-gmodal-globe');
    document.getElementById('lm-gm-close').addEventListener('click', closeStyle);
    gModal.addEventListener('click', function (e) { if (e.target === gModal) closeStyle(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !gModal.hidden) closeStyle(); });
    window.addEventListener('resize', function () { if (gGlobe && !gModal.hidden) gGlobe.width(gContainer.clientWidth).height(gContainer.clientHeight); });
  }

  function ensureGlobe() {
    if (gGlobe) return;
    gGlobe = Globe()(gContainer)
      .objectLat('lat').objectLng('lon').objectAltitude(0.012).objectFacesSurface(false)
      .objectThreeObject(coneMesh).objectLabel(tip)
      .polygonSideColor(function () { return 'rgba(0,0,0,0)'; }).polygonAltitude(0.006)
      .hexBinPointLat(function (d) { return d.lat; }).hexBinPointLng(function (d) { return d.lon; })
      .hexBinPointWeight(1).hexBinResolution(3).hexBinMerge(false)
      .hexTopColor(hexColor).hexSideColor(hexColor).hexAltitude(function (d) { return d.sumWeight * 0.012; });
  }

  function openStyle(key) {
    var s = STYLES.find(function (x) { return x.key === key; }); if (!s) return;
    document.getElementById('lm-gm-icon').textContent = s.icon;
    document.getElementById('lm-gm-title').textContent = s.name;
    document.getElementById('lm-gm-desc').textContent = s.desc;
    document.getElementById('lm-gm-legend').innerHTML = legendHtml(s);
    document.getElementById('lm-gm-cred').innerHTML = credit(s);
    gModal.hidden = false;
    setTimeout(function () {
      ensureGlobe();
      applyStyle(s);
      gGlobe.width(gContainer.clientWidth).height(gContainer.clientHeight);
      gGlobe.pointOfView({ lat: 22, lng: 8, altitude: 2.3 }, 600);
    }, 30);
  }
  function closeStyle() { gModal.hidden = true; }

  function applyStyle(s) {
    var g = gGlobe;
    if (s.bg && s.bg.charAt(0) === '#') g.backgroundImageUrl(null).backgroundColor(s.bg);
    else g.backgroundColor('#000010').backgroundImageUrl(s.bg || NIGHT);
    g.globeImageUrl(s.img).bumpImageUrl(s.bump || null);
    g.showAtmosphere(!!s.atmo).atmosphereColor(s.atmo || '#5aa9ff').atmosphereAltitude(0.16);
    g.showGraticules(!!s.graticule);
    var pol = s.layer === 'political' || s.layer === 'choropleth';
    g.polygonsData(pol ? countries.features : []);
    if (s.layer === 'choropleth') {
      g.polygonCapColor(choroColor).polygonLabel(choroLabel).polygonStrokeColor(function () { return 'rgba(180,200,220,0.22)'; });
    } else if (s.layer === 'political') {
      g.polygonCapColor(fillColor).polygonStrokeColor(function () { return 'rgba(190,210,230,0.35)'; })
        .polygonLabel(function (f) { return '<div class="lm-country">' + esc(polyName(f)) + '</div>'; });
    }
    g.hexBinPointsData(s.layer === 'density' ? visible() : []);
    g.objectsData(s.layer === 'density' ? [] : visible());
  }

  function legendHtml(s) {
    if (s.layer === 'density') return '<span class="lg"><i style="background:#5ac8be"></i>fewer</span><span class="lg"><i style="background:#ff8a4d"></i>more</span> sites per hex';
    if (s.layer === 'choropleth') return '<span class="lg"><i style="background:#263448"></i>none</span><span class="lg"><i style="background:#ff9a46"></i>most</span> launch sites · hover a country';
    return ORDER.filter(function (k) { return active[k]; }).map(function (k) {
      return '<span class="lg"><i style="background:' + CAT[k].color + '"></i>' + CAT[k].label + '</span>';
    }).join('');
  }
  function credit(s) {
    if (s.img.indexOf(G) === 0) {
      var f = s.img.slice(G.length);
      var c = (window.__globeCredits || []).find(function (x) { return x.file === f; });
      if (c) return 'Texture: ' + esc(c.author) + ', ' + esc(c.license) + ' — <a href="' + esc(c.page) + '" target="_blank" rel="noopener noreferrer">Wikimedia Commons ↗</a>';
    }
    if (s.layer) return 'Country outlines: Natural Earth (public domain)';
    return 'Texture: NASA / three-globe';
  }

  // --- boot -----------------------------------------------------------------
  function boot(data, geo, creds) {
    sites = data; countries = geo || { features: [] }; window.__globeCredits = creds || [];
    if (countries.features.length) computeChoropleth();
    var el = document.getElementById('globe');
    globe = Globe()(el)
      .backgroundImageUrl(NIGHT).globeImageUrl(BLUE).bumpImageUrl(TOPO)
      .showAtmosphere(true).atmosphereColor('#5aa9ff').atmosphereAltitude(0.16)
      .objectsData(sites).objectLat('lat').objectLng('lon').objectAltitude(0.012)
      .objectFacesSurface(false).objectThreeObject(coneMesh).objectLabel(tip)
      .polygonsData([]).polygonCapColor(fillColor).polygonSideColor(function () { return 'rgba(0,0,0,0)'; })
      .polygonStrokeColor(function () { return 'rgba(190,210,230,0.35)'; }).polygonAltitude(0.006)
      .polygonLabel(function (f) { return '<div class="lm-country">' + esc(polyName(f)) + '</div>'; });
    globe.pointOfView({ lat: 25, lng: 10, altitude: 2.4 }, 0);

    buildLegend();
    buildStyleButtons();
    document.getElementById('lm-status').textContent = sites.length + ' sites plotted';
    document.querySelector('.lm-toggle').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (b) setStyleMain(b.dataset.globe);
    });
    window.addEventListener('resize', function () { globe.width(el.clientWidth).height(el.clientHeight); });
  }

  Promise.all([
    fetch('data/launch-map.json').then(function (r) { return r.json(); }),
    fetch('data/countries-110m.geojson').then(function (r) { return r.json(); }).catch(function () { return { features: [] }; }),
    fetch('data/globes/credits.json').then(function (r) { return r.json(); }).catch(function () { return []; }),
  ]).then(function (res) { boot(res[0], res[1], res[2]); })
    .catch(function (err) {
      var s = document.getElementById('lm-status');
      if (s) s.textContent = 'Failed to load: ' + err.message;
    });
})();
