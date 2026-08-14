// launch-map.js — a world globe of every major rocket launch site,
// space-agency HQ and space facility. Two globe styles (realistic Blue
// Marble / political country map). Markers carry a hover tooltip with
// name, altitude, area and total launches.
(function () {
  'use strict';

  var IMG = 'https://unpkg.com/three-globe@2.31.1/example/img/';
  var BLUE = IMG + 'earth-blue-marble.jpg';
  var TOPO = IMG + 'earth-topology.png';
  var NIGHT = IMG + 'night-sky.png';
  var DARK = IMG + 'earth-dark.jpg';

  var TYPE = {
    launch:   { label: 'Launch site', color: '#ff7a3c' },
    agency:   { label: 'Space agency HQ', color: '#67c8ff' },
    facility: { label: 'Facility / centre', color: '#c9a0ff' },
  };
  var PAL = ['#2e4a6b', '#3a5a54', '#5a4a6b', '#6b5a3a', '#3a6b5a', '#6b3a4a', '#43536b', '#5a6b3a'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var fmt = function (n) { return Number(n).toLocaleString('en-US'); };
  function fillColor(f) {
    var n = (f.properties && (f.properties.NAME || f.properties.name)) || '';
    var h = 0; for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    return PAL[h % PAL.length];
  }

  function row(k, v) { return '<span class="k">' + k + '</span><span class="v">' + v + '</span>'; }
  function tip(d) {
    var t = TYPE[d.t] || TYPE.facility, rows = [];
    rows.push(row('Altitude', d.el != null ? fmt(d.el) + ' m' : '—'));
    rows.push(row('Area', d.ar != null ? fmt(d.ar) + ' km²' : '—'));
    if (d.t === 'launch') rows.push(row('Launches', d.la != null ? '≈ ' + fmt(d.la) + ' <span style="color:#7d93ab">(approx.)</span>' : '—'));
    if (d.est) rows.push(row('Established', d.est));
    if (d.op) rows.push(row('Operator', esc(d.op)));
    return '<div class="lm-tip">' +
      '<div class="name">' + esc(d.n) + '</div>' +
      '<div class="type" style="color:' + t.color + '">' + t.label + ' · ' + esc(d.cty) + '</div>' +
      '<div class="rows">' + rows.join('') + '</div>' +
      (d.nb ? '<div class="note">' + esc(d.nb) + '</div>' : '') +
    '</div>';
  }

  var globe, countries = { features: [] }, political = false;
  function setStyle(mode) {
    political = mode === 'political';
    if (political) globe.globeImageUrl(DARK).bumpImageUrl(null).polygonsData(countries.features);
    else globe.globeImageUrl(BLUE).bumpImageUrl(TOPO).polygonsData([]);
    document.querySelectorAll('.lm-toggle button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.globe === mode);
    });
  }

  function boot(sites, geo) {
    countries = geo || { features: [] };
    var el = document.getElementById('globe');
    globe = Globe()(el)
      .backgroundImageUrl(NIGHT)
      .globeImageUrl(BLUE)
      .bumpImageUrl(TOPO)
      .showAtmosphere(true).atmosphereColor('#5aa9ff').atmosphereAltitude(0.16)
      .pointsData(sites)
      .pointLat('lat').pointLng('lon')
      .pointColor(function (d) { return (TYPE[d.t] || TYPE.facility).color; })
      .pointAltitude(0.012)
      .pointRadius(function (d) { return d.t === 'launch' ? 0.42 : 0.34; })
      .pointLabel(tip)
      .polygonsData([])
      .polygonCapColor(fillColor)
      .polygonSideColor(function () { return 'rgba(0,0,0,0)'; })
      .polygonStrokeColor(function () { return 'rgba(190,210,230,0.35)'; })
      .polygonAltitude(0.006);

    globe.pointOfView({ lat: 25, lng: 10, altitude: 2.4 }, 0);

    // legend counts
    var c = { launch: 0, agency: 0, facility: 0 };
    sites.forEach(function (s) { c[s.t] = (c[s.t] || 0) + 1; });
    document.getElementById('lm-n-launch').textContent = c.launch;
    document.getElementById('lm-n-agency').textContent = c.agency;
    document.getElementById('lm-n-facility').textContent = c.facility;
    document.getElementById('lm-status').textContent = sites.length + ' sites plotted';

    document.querySelector('.lm-toggle').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (b) setStyle(b.dataset.globe);
    });

    function resize() { globe.width(el.clientWidth).height(el.clientHeight); }
    window.addEventListener('resize', resize);
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
