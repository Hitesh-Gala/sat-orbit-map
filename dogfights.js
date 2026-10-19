// dogfights.js — rendezvous and proximity operations on one globe.
//
// The globe starts empty on purpose: this page is about a handful of objects
// watched closely, not the whole catalogue. Search, add, then run the clock.
//
// Two things make a proximity operation readable. The first is time rate: at
// 1x nothing appears to happen, at 5,000x an hour-long approach plays in under
// a second. The second is the focus camera - locking the view to one satellite
// so the Earth and the other object move around it, which is the frame an
// operator would actually use.
(function () {
  'use strict';

  var A = window.Argos;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var EARTH_R = 6371, GLOBE_R = 100, SCALE = GLOBE_R / EARTH_R;
  var RATES = [0.5, 1, 10, 50, 100, 500, 1000, 2000, 5000];
  var COLOURS = ['#67c8ff', '#ff7a3c', '#58d68d', '#c9a0ff', '#ffcf5c', '#ff6f9c', '#4dd0e1', '#ffffff'];
  var TRAIL_MAX = 900;

  var catalogue = [];        // every satrec we can search
  var picked = [];           // what is on the globe
  var hits = [], selIdx = -1;
  var rate = 1, playing = false, simTime = new Date(), lastFrame = 0;
  var fromT = null, toT = null, focusId = '', trails = true;

  // ---- globe ------------------------------------------------------------
  var globe = Globe()($('globe'))
    .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
    .bumpImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png')
    .backgroundImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/night-sky.png')
    .showAtmosphere(true).atmosphereColor('#4ea8ff').atmosphereAltitude(0.17)
    .pointOfView({ lat: 20, lng: 78, altitude: 2.6 }, 0);

  var scene = globe.scene(), camera = globe.camera(), controls = globe.controls();
  controls.enableDamping = true;

  function resize() {
    globe.width(window.innerWidth).height(window.innerHeight);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- the objects we draw ----------------------------------------------
  function makeMarker(colour) {
    var g = new THREE.Group();
    var dot = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 14),
      new THREE.MeshBasicMaterial({ color: colour }));
    var halo = new THREE.Mesh(new THREE.SphereGeometry(3.4, 10, 10),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.16, depthWrite: false }));
    g.add(dot); g.add(halo);
    var geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
    geom.setDrawRange(0, 0);
    var trail = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.75 }));
    trail.frustumCulled = false;
    scene.add(g); scene.add(trail);
    return { group: g, trail: trail, geom: geom, n: 0 };
  }

  // ECI kilometres -> globe units, in globe.gl's Y-up frame.
  function eciToScene(p, gmst, out) {
    var c = Math.cos(-gmst), s = Math.sin(-gmst);
    var x = p.x * c - p.y * s, y = p.x * s + p.y * c;
    return out.set(x * SCALE, p.z * SCALE, -y * SCALE);
  }

  var _v = new THREE.Vector3();
  function positionAt(sat, when) {
    var pv;
    try { pv = satellite.propagate(sat.rec, when); } catch (e) { return null; }
    if (!pv || !pv.position) return null;
    var gmst = satellite.gstime(when);
    return eciToScene(pv.position, gmst, _v).clone();
  }

  function pushTrail(sat, pos) {
    if (!trails) return;
    var arr = sat.vis.geom.attributes.position.array;
    if (sat.vis.n >= TRAIL_MAX) { arr.copyWithin(0, 3); sat.vis.n = TRAIL_MAX - 1; }
    var o = sat.vis.n * 3;
    arr[o] = pos.x; arr[o + 1] = pos.y; arr[o + 2] = pos.z;
    sat.vis.n++;
    sat.vis.geom.setDrawRange(0, sat.vis.n);
    sat.vis.geom.attributes.position.needsUpdate = true;
  }

  function clearTrail(sat) {
    sat.vis.n = 0;
    sat.vis.geom.setDrawRange(0, 0);
    sat.vis.geom.attributes.position.needsUpdate = true;
  }

  // ---- drawing one frame -------------------------------------------------
  var focusOffset = null;      // camera offset from the focused satellite
  function draw() {
    var any = false;
    picked.forEach(function (sat) {
      var p = positionAt(sat, simTime);
      if (!p) { sat.vis.group.visible = false; return; }
      sat.vis.group.visible = true;
      sat.vis.group.position.copy(p);
      sat.pos = p;
      pushTrail(sat, p);
      any = true;
    });

    // Focus camera: hold the chosen satellite in the middle of the screen and
    // let the globe swing around it, keeping whatever angle the user has set.
    if (focusId) {
      var f = picked.find(function (s) { return String(s.noradId) === String(focusId); });
      if (f && f.pos) {
        if (!focusOffset) focusOffset = camera.position.clone().sub(controls.target);
        controls.target.copy(f.pos);
        camera.position.copy(f.pos).add(focusOffset);
      }
    }
    controls.update();
    $('df-clock').innerHTML = esc(simTime.toISOString().replace('T', ' ').slice(0, 19)) + '<span> UTC</span>';
    return any;
  }

  // Advance the clock by a number of milliseconds, stopping at the end of the
  // window. Kept separate from the frame loop so a run can be driven in tests.
  function advance(ms) {
    simTime = new Date(simTime.getTime() + ms);
    if (toT && simTime > toT) {
      simTime = new Date(toT);
      setPlaying(false);
    }
  }

  function tick(now) {
    requestAnimationFrame(tick);
    var dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.25) : 0;
    lastFrame = now;
    if (playing) {
      advance(dt * 1000 * rate);
    } else if (!focusId && !picked.length) {
      simTime = new Date();
    }
    draw();
  }
  requestAnimationFrame(tick);

  // ---- catalogue + search ------------------------------------------------
  function loadCatalogue() {
    return A.fetchTLEs().then(function (res) {
      catalogue = A.makeSatrecs(res.tles);
      $('df-status').textContent = catalogue.length.toLocaleString() + ' objects searchable · source: ' + res.source;
    }).catch(function (e) {
      $('df-status').textContent = 'Could not load the catalogue: ' + e.message;
    });
  }

  function search() {
    var q = $('df-q').value.trim().toLowerCase();
    if (!q) { hits = []; selIdx = -1; renderHits(); return; }
    hits = catalogue.filter(function (s) {
      return s.name.toLowerCase().indexOf(q) !== -1 || String(s.noradId).indexOf(q) === 0;
    }).slice(0, 60);
    selIdx = hits.length ? 0 : -1;
    renderHits();
  }

  function renderHits() {
    $('df-results').innerHTML = hits.map(function (s, i) {
      return '<div class="df-hit' + (i === selIdx ? ' sel' : '') + '" data-i="' + i + '">' +
        '<span>' + esc(s.name) + '</span><span class="no">' + esc(s.noradId) + '</span></div>';
    }).join('');
  }

  function addSelected() {
    var s = hits[selIdx];
    if (!s) { $('df-hint').textContent = 'Search for a satellite first, then pick a result to add.'; return; }
    if (picked.some(function (p) { return p.noradId === s.noradId; })) {
      $('df-hint').textContent = esc(s.name) + ' is already on the globe.';
      return;
    }
    var colour = COLOURS[picked.length % COLOURS.length];
    picked.push({ name: s.name, noradId: s.noradId, rec: s.rec, colour: colour, vis: makeMarker(colour), pos: null });
    renderPicked();
    $('df-hint').textContent = 'Added ' + s.name + '. Add another and run the clock to watch them close.';
  }

  function removeAt(i) {
    var s = picked[i];
    if (!s) return;
    scene.remove(s.vis.group); scene.remove(s.vis.trail);
    picked.splice(i, 1);
    if (String(focusId) === String(s.noradId)) { focusId = ''; focusOffset = null; }
    renderPicked();
  }

  function renderPicked() {
    $('df-list').innerHTML = picked.map(function (s, i) {
      return '<div class="df-item"><span class="sw" style="background:' + s.colour + ';color:' + s.colour + '"></span>' +
        '<span class="nm" title="' + esc(s.name) + '">' + esc(s.name) + '</span>' +
        '<button type="button" class="x" data-rm="' + i + '" aria-label="Remove">×</button></div>';
    }).join('');
    var sel = $('df-focus');
    var keep = focusId;
    sel.innerHTML = '<option value="">— free camera —</option>' + picked.map(function (s) {
      return '<option value="' + esc(s.noradId) + '">' + esc(s.name) + '</option>';
    }).join('');
    sel.value = keep;
    if (sel.value !== keep) { focusId = ''; focusOffset = null; }
    $('df-animate').disabled = !picked.length;
  }

  // ---- time window -------------------------------------------------------
  function localISO(d) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function setupWindow() {
    var now = new Date();
    var back = new Date(now.getTime() - 365 * 864e5);
    var fwd = new Date(now.getTime() + 15 * 864e5);
    var f = $('df-from'), t = $('df-to');
    f.min = t.min = localISO(back);
    f.max = t.max = localISO(fwd);
    f.value = localISO(new Date(now.getTime() - 3600e3));   // an hour back
    t.value = localISO(new Date(now.getTime() + 6 * 3600e3));
    readWindow();
  }

  function readWindow() {
    var f = new Date($('df-from').value), t = new Date($('df-to').value);
    fromT = isNaN(f) ? null : f;
    toT = isNaN(t) ? null : t;
    if (fromT && toT && toT <= fromT) toT = new Date(fromT.getTime() + 3600e3);
  }

  function setPlaying(on) {
    playing = on;
    var b = $('df-animate');
    b.classList.toggle('on', on);
    b.textContent = on ? '❚❚ Pause' : '▶ Animate';
  }

  // ---- wiring ------------------------------------------------------------
  $('df-q').addEventListener('input', search);
  $('df-q').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { selIdx = Math.min(selIdx + 1, hits.length - 1); renderHits(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { selIdx = Math.max(selIdx - 1, 0); renderHits(); e.preventDefault(); }
    if (e.key === 'Enter') { addSelected(); e.preventDefault(); }
  });
  $('df-results').addEventListener('click', function (e) {
    var h = e.target.closest('.df-hit');
    if (!h) return;
    selIdx = +h.dataset.i;
    renderHits();
    addSelected();
  });
  $('df-add').addEventListener('click', addSelected);
  $('df-clear').addEventListener('click', function () {
    while (picked.length) removeAt(0);
    $('df-hint').textContent = 'Globe cleared. Search for a satellite to start again.';
  });
  $('df-list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-rm]');
    if (b) removeAt(+b.dataset.rm);
  });

  $('df-speed').addEventListener('input', function (e) {
    rate = RATES[+e.target.value] || 1;
    $('df-speed-val').textContent = (rate < 1 ? rate : rate.toLocaleString()) + '×';
  });

  $('df-animate').addEventListener('click', function () {
    readWindow();
    if (!playing) {
      // Starting a run puts the clock at the start of the window and wipes the
      // trails, so what is drawn belongs to this run and no other.
      if (fromT) simTime = new Date(fromT);
      picked.forEach(clearTrail);
      setPlaying(true);
    } else {
      setPlaying(false);
    }
  });
  $('df-now').addEventListener('click', function () {
    setPlaying(false);
    simTime = new Date();
    picked.forEach(clearTrail);
    var now = new Date();
    $('df-from').value = localISO(new Date(now.getTime() - 3600e3));
    $('df-to').value = localISO(new Date(now.getTime() + 6 * 3600e3));
    readWindow();
  });
  ['df-from', 'df-to'].forEach(function (id) { $(id).addEventListener('change', readWindow); });

  $('df-focus').addEventListener('change', function (e) {
    focusId = e.target.value;
    focusOffset = null;                 // recompute the offset for the new target
    if (!focusId) controls.target.set(0, 0, 0);
  });
  $('df-trails').addEventListener('click', function () {
    trails = !trails;
    $('df-trails').textContent = 'Trails: ' + (trails ? 'on' : 'off');
    if (!trails) picked.forEach(clearTrail);
  });
  $('df-reset').addEventListener('click', function () {
    focusId = ''; focusOffset = null;
    $('df-focus').value = '';
    controls.target.set(0, 0, 0);
    globe.pointOfView({ lat: 20, lng: 78, altitude: 2.6 }, 600);
  });

  setupWindow();
  renderPicked();
  loadCatalogue();

  // Read-only handle for the headless checks.
  window.__df = {
    catalogue: function () { return catalogue.length; },
    picked: function () { return picked.map(function (p) { return p.name; }); },
    rate: function () { return rate; },
    simTime: function () { return simTime.toISOString(); },
    playing: function () { return playing; },
    focus: function () { return focusId; },
    screenPos: function (norad) {
      var s = picked.find(function (p) { return String(p.noradId) === String(norad); });
      if (!s || !s.pos) return null;
      var v = s.pos.clone().project(camera);
      return { x: +v.x.toFixed(3), y: +v.y.toFixed(3) };
    },
    step: function (seconds) { advance(seconds * 1000); draw(); },
  };
})();
