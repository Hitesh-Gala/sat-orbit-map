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
  var RATES = [0.5, 1, 10, 50, 100, 500, 1000, 2000, 5000, 10000];
  var COLOURS = ['#67c8ff', '#ff7a3c', '#58d68d', '#c9a0ff', '#ffcf5c', '#ff6f9c', '#4dd0e1', '#ffffff'];
  var TRAIL_MAX = 900;
  var DOT_R = 1.5, HALO_R = 3.4;

  var catalogue = [];        // every satrec we can search
  var picked = [];           // what is on the globe
  var hits = [], selIdx = -1;
  var rate = 1, playing = false, simTime = new Date(), lastFrame = 0;
  var fromT = null, toT = null, focusId = '', trails = true;
  var altScale = 1, sizeMul = 1;   // view-only exaggeration, never fed back into SGP4

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
    var dot = new THREE.Mesh(new THREE.SphereGeometry(DOT_R, 14, 14),
      new THREE.MeshBasicMaterial({ color: colour }));
    var halo = new THREE.Mesh(new THREE.SphereGeometry(HALO_R, 10, 10),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.16, depthWrite: false }));
    g.add(dot); g.add(halo);
    g.scale.setScalar(sizeMul);
    var geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
    geom.setDrawRange(0, 0);
    var trail = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.75 }));
    trail.frustumCulled = false;
    scene.add(g); scene.add(trail);
    // The trail keeps the true positions alongside the drawn ones, so moving
    // the altitude slider mid-run redraws the history at the new scale rather
    // than leaving a kinked line or wiping the run.
    return { group: g, trail: trail, geom: geom, raw: new Float32Array(TRAIL_MAX * 3), n: 0 };
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

  // Push the orbit radially away from the surface for display only.  A few
  // hundred kilometres is 1.6 globe units out of 100, so without this two
  // objects in a close approach sit on the skin of the Earth.
  function stretch(v) {
    if (altScale === 1) return v;
    var m = v.length();
    if (m <= GLOBE_R) return v;
    return v.multiplyScalar((GLOBE_R + (m - GLOBE_R) * altScale) / m);
  }

  function pushTrail(sat, pos) {
    if (!trails) return;
    var vis = sat.vis, arr = vis.geom.attributes.position.array;
    if (vis.n >= TRAIL_MAX) { arr.copyWithin(0, 3); vis.raw.copyWithin(0, 3); vis.n = TRAIL_MAX - 1; }
    var o = vis.n * 3;
    vis.raw[o] = pos.x; vis.raw[o + 1] = pos.y; vis.raw[o + 2] = pos.z;
    var d = stretch(pos.clone());
    arr[o] = d.x; arr[o + 1] = d.y; arr[o + 2] = d.z;
    vis.n++;
    vis.geom.setDrawRange(0, vis.n);
    vis.geom.attributes.position.needsUpdate = true;
  }

  function clearTrail(sat) {
    sat.vis.n = 0;
    sat.vis.geom.setDrawRange(0, 0);
    sat.vis.geom.attributes.position.needsUpdate = true;
  }

  var _r = new THREE.Vector3();
  function rescaleTrails() {
    picked.forEach(function (sat) {
      var vis = sat.vis, arr = vis.geom.attributes.position.array;
      for (var i = 0; i < vis.n * 3; i += 3) {
        _r.set(vis.raw[i], vis.raw[i + 1], vis.raw[i + 2]);
        stretch(_r);
        arr[i] = _r.x; arr[i + 1] = _r.y; arr[i + 2] = _r.z;
      }
      vis.geom.attributes.position.needsUpdate = true;
    });
  }

  // ---- drawing one frame -------------------------------------------------
  var focusOffset = null;      // camera offset from the focused satellite
  function draw() {
    var any = false;
    picked.forEach(function (sat) {
      var p = positionAt(sat, simTime);
      if (!p) { sat.vis.group.visible = false; return; }
      sat.vis.group.visible = true;
      pushTrail(sat, p);          // records the true position, before the stretch
      stretch(p);                 // in place: from here p is where it is drawn
      sat.vis.group.position.copy(p);
      sat.pos = p;
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
  var winMin = null, winMax = null;    // the ends of what may be chosen

  function pad2(n) { return String(n).padStart(2, '0'); }

  // The two fields are read-only text holding a local "YYYY-MM-DD HH:MM" that
  // the calendar below writes - not the browser's own datetime-local mask.
  function fieldText(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function parseField(s) {
    var m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)$/.exec(String(s || '').trim());
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
  }

  function setupWindow() {
    var now = new Date();
    winMin = new Date(now.getTime() - 365 * 864e5);
    winMax = new Date(now.getTime() + 15 * 864e5);
    $('df-from').value = fieldText(new Date(now.getTime() - 3600e3));   // an hour back
    $('df-to').value = fieldText(new Date(now.getTime() + 6 * 3600e3));
    readWindow();
  }

  function readWindow() {
    fromT = parseField($('df-from').value);
    toT = parseField($('df-to').value);
    if (fromT && toT && toT <= fromT) {
      // An end before the start is pushed an hour past it, and the field is
      // rewritten so the correction is on screen rather than only in the run.
      toT = new Date(fromT.getTime() + 3600e3);
      $('df-to').value = fieldText(toT);
    }
  }

  // ---- the calendar ------------------------------------------------------
  // The browser's own datetime-local popup commits the moment a day is
  // clicked and offers no way back, so these fields open this instead: it
  // writes the field only when OK is pressed, and Cancel leaves it alone.
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  var pickEl = null;

  function midnight(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  function closePicker() {
    if (!pickEl) return;
    pickEl.remove();
    pickEl = null;
    document.removeEventListener('pointerdown', onPickAway, true);
    document.removeEventListener('keydown', onPickKey, true);
    document.removeEventListener('scroll', onPickMove, true);
    window.removeEventListener('resize', onPickMove);
  }

  // The panel it hangs off scrolls, and the card is fixed to the viewport, so
  // it is re-placed rather than left pointing at nothing.
  function onPickMove() { if (pickEl) pickEl._place(); }

  function onPickAway(e) {
    // A click on either field is left to that field's own handler, which
    // reopens the calendar there.
    if (!pickEl || pickEl.contains(e.target) || e.target.closest('.df-field')) return;
    closePicker();
  }

  function onPickKey(e) {
    if (e.key === 'Escape') { closePicker(); e.preventDefault(); }
  }

  function openPicker(id) {
    var field = $(id).closest('.df-field');
    if (pickEl && pickEl.dataset.pickFor === id) { closePicker(); return; }   // same field: toggle shut
    closePicker();

    var sel = parseField($(id).value) || new Date();
    var view = new Date(sel.getFullYear(), sel.getMonth(), 1);
    var today = midnight(new Date());
    var lo = winMin ? midnight(winMin) : null, hi = winMax ? midnight(winMax) : null;

    pickEl = document.createElement('div');
    pickEl.className = 'df-pick';
    pickEl.dataset.pickFor = id;
    document.body.appendChild(pickEl);

    function monthStep(n) {
      var m = new Date(view.getFullYear(), view.getMonth() + n, 1);
      // A month is reachable if any of its days is inside the range.
      if (hi && m > hi) return null;
      if (lo && new Date(m.getFullYear(), m.getMonth() + 1, 0) < lo) return null;
      return m;
    }

    function paint() {
      var first = view.getDay(), days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
      var cells = DOW.map(function (d) { return '<span>' + d + '</span>'; });
      for (var i = 0; i < first; i++) cells.push('<i></i>');
      for (var d = 1; d <= days; d++) {
        var day = new Date(view.getFullYear(), view.getMonth(), d);
        var out = (lo && day < lo) || (hi && day > hi);
        var cls = [];
        if (!out && day.getTime() === midnight(sel).getTime()) cls.push('sel');
        if (day.getTime() === today.getTime()) cls.push('today');
        cells.push('<button type="button" data-d="' + d + '"' + (out ? ' disabled' : '') +
          (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '>' + d + '</button>');
      }
      pickEl.innerHTML =
        '<div class="df-pick-head">' +
          '<button type="button" data-mv="-1"' + (monthStep(-1) ? '' : ' disabled') + '>‹</button>' +
          '<b>' + MONTHS[view.getMonth()] + ' ' + view.getFullYear() + '</b>' +
          '<button type="button" data-mv="1"' + (monthStep(1) ? '' : ' disabled') + '>›</button>' +
        '</div>' +
        '<div class="df-pick-grid">' + cells.join('') + '</div>' +
        '<div class="df-pick-time"><label for="df-pick-t">Time</label>' +
          '<input type="time" id="df-pick-t" value="' + pad2(sel.getHours()) + ':' + pad2(sel.getMinutes()) + '"></div>' +
        '<div class="df-pick-foot"><span class="now">' + esc(fieldText(sel)) + '</span>' +
          '<button type="button" data-act="cancel">Cancel</button>' +
          '<button type="button" class="ok" data-act="ok">OK</button></div>';
    }

    function place() {
      var r = field.getBoundingClientRect(), h = pickEl.offsetHeight, w = pickEl.offsetWidth;
      var top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      pickEl.style.top = top + 'px';
      pickEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    }

    pickEl.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.mv) {
        var m = monthStep(+b.dataset.mv);
        if (m) { view = m; paint(); }
        return;
      }
      if (b.dataset.d) {
        sel = new Date(view.getFullYear(), view.getMonth(), +b.dataset.d, sel.getHours(), sel.getMinutes());
        paint();
        return;
      }
      if (b.dataset.act === 'cancel') { closePicker(); return; }
      if (b.dataset.act === 'ok') {
        if (winMin && sel < winMin) sel = new Date(winMin);
        if (winMax && sel > winMax) sel = new Date(winMax);
        $(id).value = fieldText(sel);
        readWindow();
        closePicker();
      }
    });

    pickEl.addEventListener('input', function (e) {
      var t = /^(\d\d):(\d\d)/.exec(e.target.value);
      if (!t) return;
      sel = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate(), +t[1], +t[2]);
      pickEl.querySelector('.df-pick-foot .now').textContent = fieldText(sel);
    });

    pickEl._place = place;
    paint();
    place();
    document.addEventListener('pointerdown', onPickAway, true);
    document.addEventListener('keydown', onPickKey, true);
    document.addEventListener('scroll', onPickMove, true);
    window.addEventListener('resize', onPickMove);
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

  $('df-alt').addEventListener('input', function (e) {
    altScale = parseFloat(e.target.value) || 1;
    $('df-alt-val').textContent = altScale.toFixed(1);
    rescaleTrails();
    draw();
  });
  $('df-size').addEventListener('input', function (e) {
    sizeMul = parseFloat(e.target.value) || 1;
    $('df-size-val').textContent = sizeMul.toFixed(1);
    picked.forEach(function (s) { s.vis.group.scale.setScalar(sizeMul); });
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
    $('df-from').value = fieldText(new Date(now.getTime() - 3600e3));
    $('df-to').value = fieldText(new Date(now.getTime() + 6 * 3600e3));
    readWindow();
    closePicker();
  });
  ['df-from', 'df-to'].forEach(function (id) {
    $(id).addEventListener('click', function () { openPicker(id); });
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.df-cal');
    if (b) openPicker(b.dataset.pick);
  });

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
    rates: function () { return RATES.slice(); },
    altScale: function () { return altScale; },
    sizeMul: function () { return sizeMul; },
    radius: function (i) { return picked[i] && picked[i].pos ? picked[i].pos.length() : 0; },
    meshScale: function (i) { return picked[i] ? picked[i].vis.group.scale.x : 0; },
    trailRadius: function (i) {
      var vis = picked[i] && picked[i].vis;
      if (!vis || !vis.n) return 0;
      var a = vis.geom.attributes.position.array, o = (vis.n - 1) * 3;
      return +Math.hypot(a[o], a[o + 1], a[o + 2]).toFixed(2);
    },
    window: function () { return [$('df-from').value, $('df-to').value]; },
    limits: function () { return [fieldText(winMin), fieldText(winMax)]; },
    windowDates: function () {
      return [fromT ? fromT.toISOString() : null, toT ? toT.toISOString() : null];
    },
    setWindow: function (from, to) {
      if (from != null) $('df-from').value = from;
      if (to != null) $('df-to').value = to;
      readWindow();
    },
    openPicker: openPicker,
    pickOpen: function () { return !!pickEl; },
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
