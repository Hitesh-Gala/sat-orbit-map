// Orbit Maker — build an orbit from its six classical (Keplerian) elements
// and see the resulting shape around a 3-D Earth.  Pure geometry: no TLEs, no
// SGP4 — just the closed-form two-body ellipse.
//
//   a  semi-major axis            e  eccentricity
//   i  inclination                Ω  longitude of ascending node (RAAN)
//   ω  argument of perigee        θ  true anomaly (position along the orbit)
//
// The orbit is computed in the perifocal (PQW) frame, rotated into an
// Earth-centred inertial (ECI) frame by Ω, i, ω, then remapped into globe.gl's
// coordinate system (which puts the north pole on +Y) for drawing.

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const DEG = Math.PI / 180;
  const MU  = 398600.4418;   // Earth gravitational parameter, km³/s²
  const RE  = 6371;          // Earth radius, km  (== globe.gl globe radius of 100 units)
  const GLOBE_R = 100;
  const SCALE = GLOBE_R / RE; // km → globe units
  const N = 360;             // orbit samples

  // Current element state (mirrors the sliders).
  const el = { a: 10000, e: 0.2, i: 45, O: 0, w: 0, nu: 0 };

  // =======================================================================
  // Globe (same chrome as the other 3-D pages)
  // =======================================================================
  const globe = Globe()(document.getElementById('globe'))
    .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
    .bumpImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png')
    .backgroundImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/night-sky.png')
    .showAtmosphere(true)
    .atmosphereColor('#4ea8ff')
    .atmosphereAltitude(0.16);

  const scene    = globe.scene();
  const camera   = globe.camera();
  const controls = globe.controls();
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.rotateSpeed   = 0.5;
  controls.zoomSpeed     = 1.0;
  controls.minDistance   = 130;
  controls.maxDistance   = 12000;
  camera.near = 0.5;
  camera.far  = 400000;
  camera.updateProjectionMatrix();

  function fitGlobeToContainer() {
    const elm = document.getElementById('globe');
    const r = elm.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) globe.width(r.width).height(r.height);
  }
  fitGlobeToContainer();
  window.addEventListener('resize', fitGlobeToContainer);

  // =======================================================================
  // Orbit maths
  // =======================================================================

  // Perifocal (in-plane) point → globe-space THREE.Vector3 (in globe units).
  // z_pf is always 0 for an orbit point, so only the first two columns of the
  // perifocal→ECI rotation are needed.
  function pqwToGlobe(xpf, ypf, O, i, w, out) {
    const cO = Math.cos(O), sO = Math.sin(O);
    const ci = Math.cos(i), si = Math.sin(i);
    const cw = Math.cos(w), sw = Math.sin(w);
    // perifocal → ECI (X = vernal equinox, Z = north pole)
    const xe = (cO * cw - sO * sw * ci) * xpf + (-cO * sw - sO * cw * ci) * ypf;
    const ye = (sO * cw + cO * sw * ci) * xpf + (-sO * sw + cO * cw * ci) * ypf;
    const ze = (sw * si) * xpf + (cw * si) * ypf;
    // ECI (Z-up) → globe (Y-up), right-handed: (x, z, -y), then to globe units
    return out.set(xe * SCALE, ze * SCALE, -ye * SCALE);
  }

  // Radius from focus (Earth centre) at true anomaly ν, in km.
  function radiusAt(a, e, nu) { return a * (1 - e * e) / (1 + e * Math.cos(nu)); }

  // True anomaly → globe-space point, in km inputs.
  const _v = new THREE.Vector3();
  function pointAt(nu, out) {
    const r = radiusAt(el.a, el.e, nu);
    return pqwToGlobe(r * Math.cos(nu), r * Math.sin(nu), el.O * DEG, el.i * DEG, el.w * DEG, out);
  }

  // Solve Kepler's equation M = E − e·sinE for E (Newton), then ν, for the
  // animation (so the satellite speeds up at perigee — Kepler's 2nd law).
  function meanToTrue(M, e) {
    M = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    let E = e < 0.8 ? M : Math.PI;
    for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  }

  // =======================================================================
  // Scene objects (built once, positions rewritten on every change)
  // =======================================================================
  const group = new THREE.Group();
  scene.add(group);

  // --- Orbit path (a tube so it reads clearly at every scale) ---
  const orbitMat = new THREE.MeshBasicMaterial({ color: 0x67c8ff });
  let orbitMesh = null;

  // --- Orbital-plane fill (translucent ellipse, fanned from its centre) ---
  const planeGeom = new THREE.BufferGeometry();
  const planePos  = new Float32Array((N + 2) * 3);        // centre + N rim + closing
  planeGeom.setAttribute('position', new THREE.BufferAttribute(planePos, 3));
  const planeIdx = [];
  for (let k = 1; k <= N; k++) planeIdx.push(0, k, k + 1);
  planeGeom.setIndex(planeIdx);
  const planeMesh = new THREE.Mesh(planeGeom, new THREE.MeshBasicMaterial({
    color: 0x67c8ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false,
  }));
  group.add(planeMesh);

  // --- Equatorial reference plane (unit disc scaled each update) + equator ring ---
  const equatorDisc = new THREE.Mesh(
    new THREE.CircleGeometry(1, 96),
    new THREE.MeshBasicMaterial({ color: 0x8aa0b8, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
  );
  equatorDisc.rotation.x = -Math.PI / 2;   // into the globe's X–Z (equatorial) plane
  group.add(equatorDisc);
  const equatorRing = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 128 }, (_, k) => {
        const t = k / 128 * 2 * Math.PI;
        return new THREE.Vector3(Math.cos(t), 0, Math.sin(t));
      })),
    new THREE.LineBasicMaterial({ color: 0x8aa0b8, transparent: true, opacity: 0.5 }),
  );
  group.add(equatorRing);

  // --- Line of nodes (asc↔desc through Earth centre) ---
  const nodeLine = new THREE.Line(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
    new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.8 }),
  );
  group.add(nodeLine);

  // --- Radius vector (Earth centre → satellite) ---
  const radiusLine = new THREE.Line(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
    new THREE.LineBasicMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.55 }),
  );
  group.add(radiusLine);

  // --- Reference frame: vernal-equinox direction (+X) and spin axis (±Y) ---
  const refLine = new THREE.Line(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
    new THREE.LineBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.85 }),
  );
  const axisLine = new THREE.Line(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
    new THREE.LineBasicMaterial({ color: 0xdfe9f5, transparent: true, opacity: 0.4 }),
  );
  const frameGroup = new THREE.Group();
  frameGroup.add(refLine, axisLine);
  group.add(frameGroup);

  // --- Point markers (sphere geometry reused, scaled per update) ---
  function marker(color) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 16), new THREE.MeshBasicMaterial({ color }));
    group.add(m); return m;
  }
  const satDot  = marker(0xffffff);
  const periDot = marker(0x67e8a4);
  const apoDot  = marker(0xffb86b);
  const ascDot  = marker(0xffd166);
  const descDot = marker(0xffcf7a);

  // --- Text sprite labels ---
  function makeLabel(text, color) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 74px "JetBrains Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
    ctx.fillStyle = color; ctx.fillText(text, 64, 68);
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    group.add(spr); return spr;
  }
  const satLbl  = makeLabel('SAT', '#ffffff');
  const periLbl = makeLabel('P',   '#67e8a4');
  const apoLbl  = makeLabel('A',   '#ffb86b');
  const ascLbl  = makeLabel('AN', '#ffd166');  // ascending node
  const descLbl = makeLabel('DN', '#ffcf7a');  // descending node
  const refLbl  = makeLabel('γ', '#ff8a8a');   // γ — first point of Aries (vernal equinox)
  const nLbl    = makeLabel('N', '#dfe9f5');

  // =======================================================================
  // Build / update
  // =======================================================================
  const _p = new THREE.Vector3();

  function apogeeUnits() { return el.a * (1 + el.e) * SCALE; }

  function rebuildOrbitTube() {
    const pts = [];
    for (let k = 0; k < N; k++) pointAt(k / N * 2 * Math.PI, _p) && pts.push(_p.clone());
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const tubeR = Math.min(Math.max(apogeeUnits() * 0.0055, 0.45), 6);
    const geom = new THREE.TubeGeometry(curve, 260, tubeR, 12, true);
    if (orbitMesh) { group.remove(orbitMesh); orbitMesh.geometry.dispose(); }
    orbitMesh = new THREE.Mesh(geom, orbitMat);
    group.add(orbitMesh);
  }

  function setLine(line, ax, ay, az, bx, by, bz) {
    const p = line.geometry.attributes.position.array;
    p[0] = ax; p[1] = ay; p[2] = az; p[3] = bx; p[4] = by; p[5] = bz;
    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  }

  function updateScene() {
    const apoU = apogeeUnits();
    const dotR = Math.min(Math.max(apoU * 0.014, 1.4), 12);
    const lblS = Math.min(Math.max(apoU * 0.05, 8), 42);

    rebuildOrbitTube();

    // Orbital-plane fill: centre of the ellipse is offset from the focus by
    // −a·e along the perigee direction (perifocal −x).
    pqwToGlobe(-el.a * el.e, 0, el.O * DEG, el.i * DEG, el.w * DEG, _p);
    planePos[0] = _p.x; planePos[1] = _p.y; planePos[2] = _p.z;
    for (let k = 0; k <= N; k++) {
      pointAt((k % N) / N * 2 * Math.PI, _p);
      const o = (k + 1) * 3;
      planePos[o] = _p.x; planePos[o + 1] = _p.y; planePos[o + 2] = _p.z;
    }
    planeGeom.attributes.position.needsUpdate = true;
    planeGeom.computeBoundingSphere();

    // Equatorial plane + ring, sized to the orbit.
    const eqR = Math.max(apoU * 1.12, 130);
    equatorDisc.scale.setScalar(eqR);
    equatorRing.scale.setScalar(eqR);

    // Satellite, perigee, apogee.
    pointAt(el.nu * DEG, _p); satDot.position.copy(_p); satDot.scale.setScalar(dotR);
    satLbl.position.copy(_p).multiplyScalar(1 + dotR * 1.6 / _p.length()); satLbl.scale.set(lblS, lblS, 1);
    setLine(radiusLine, 0, 0, 0, _p.x, _p.y, _p.z);

    pointAt(0, _p); periDot.position.copy(_p); periDot.scale.setScalar(dotR * 0.85);
    periLbl.position.copy(_p).multiplyScalar(1 + dotR * 1.6 / _p.length()); periLbl.scale.set(lblS * 0.8, lblS * 0.8, 1);
    pointAt(Math.PI, _p); apoDot.position.copy(_p); apoDot.scale.setScalar(dotR * 0.85);
    apoLbl.position.copy(_p).multiplyScalar(1 + dotR * 1.6 / _p.length()); apoLbl.scale.set(lblS * 0.8, lblS * 0.8, 1);

    // Ascending / descending nodes: true anomaly = −ω and π−ω.  Undefined for
    // an equatorial orbit (i≈0), so hide them there.
    const hasNodes = el.i > 0.2 && el.i < 179.8;
    ascDot.visible = descDot.visible = ascLbl.visible = descLbl.visible = nodeLine.visible = hasNodes && showNodes;
    if (hasNodes) {
      const va = (-el.w * DEG), vd = (Math.PI - el.w * DEG);
      pointAt(va, _p); ascDot.position.copy(_p); ascDot.scale.setScalar(dotR * 0.8);
      ascLbl.position.copy(_p).multiplyScalar(1 + dotR * 1.8 / _p.length()); ascLbl.scale.set(lblS * 0.85, lblS * 0.85, 1);
      const ax = _p.x, ay = _p.y, az = _p.z;
      pointAt(vd, _p); descDot.position.copy(_p); descDot.scale.setScalar(dotR * 0.8);
      descLbl.position.copy(_p).multiplyScalar(1 + dotR * 1.8 / _p.length()); descLbl.scale.set(lblS * 0.85, lblS * 0.85, 1);
      setLine(nodeLine, ax, ay, az, _p.x, _p.y, _p.z);
    }

    // Reference frame: ♈ direction along +X, spin axis along ±Y.
    const refR = Math.max(apoU * 0.75, 150);
    setLine(refLine, 0, 0, 0, refR, 0, 0);
    refLbl.position.set(refR * 1.06, 0, 0); refLbl.scale.set(lblS, lblS, 1);
    const axR = Math.max(apoU * 0.6, 135);
    setLine(axisLine, 0, -axR, 0, 0, axR, 0);
    nLbl.position.set(0, axR * 1.07, 0); nLbl.scale.set(lblS * 0.8, lblS * 0.8, 1);

    updateReadout();
  }

  // =======================================================================
  // Readout panel
  // =======================================================================
  function fmt(x, d) { return Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fmtPeriod(sec) {
    if (!Number.isFinite(sec)) return '—';
    if (sec < 5400) return fmt(sec / 60, 1) + ' min';
    return fmt(sec / 3600, 2) + ' h';
  }

  function updateReadout() {
    const a = el.a, e = el.e;
    const rp = a * (1 - e), ra = a * (1 + e);
    const r  = radiusAt(a, e, el.nu * DEG);
    const T  = 2 * Math.PI * Math.sqrt(a * a * a / MU);
    const v  = Math.sqrt(MU * (2 / r - 1 / a));

    $('om-peri').textContent   = fmt(rp - RE, 0);
    $('om-apo').textContent    = fmt(ra - RE, 0);
    $('om-period').textContent = fmtPeriod(T);
    $('om-alt').textContent    = fmt(r - RE, 0);
    $('om-speed').textContent  = fmt(v, 2);
    $('om-r').textContent      = fmt(r, 0);

    $('om-type').textContent = classify(a, e, el.i);

    const warn = $('om-warn');
    if (rp < RE) {
      warn.hidden = false;
      warn.textContent = `⚠ Perigee is ${fmt(RE - rp, 0)} km below the surface — this orbit would strike the Earth (sub-surface arc shown for illustration).`;
    } else if (rp - RE < 150) {
      warn.hidden = false;
      warn.textContent = `⚠ Perigee only ${fmt(rp - RE, 0)} km up — deep in the atmosphere; a real satellite here would decay quickly.`;
    } else {
      warn.hidden = true;
    }
  }

  function classify(a, e, i) {
    const rp = a * (1 - e) - RE, ra = a * (1 + e) - RE;
    const near = (x, y, tol) => Math.abs(x - y) <= tol;
    if (near(a, 42164, 120) && e < 0.02 && i < 1) return '🛰  Geostationary (GEO) — parks over one spot on the equator.';
    if (near(a, 42164, 400) && e < 0.05)          return 'Geosynchronous — 24 h period; the ground track traces a figure-8.';
    if (e >= 0.55 && ra > 25000 && rp < 20000)    return 'Highly elliptical (HEO) — loiters high over apogee' + (near(i, 63.4, 3) ? ', at the 63.4° "Molniya" critical inclination.' : '.');
    if (e < 0.02) {
      const alt = a - RE;
      if (near(i, 90, 4))  return 'Circular polar orbit — passes over both poles.';
      if (i > 96 && i < 102 && alt > 400 && alt < 1200) return 'Sun-synchronous (SSO) — same local solar time each pass.';
      if (alt < 2000)  return 'Low Earth orbit (LEO), near-circular.';
      if (alt < 35000) return 'Medium Earth orbit (MEO), near-circular.';
      return 'High near-circular orbit.';
    }
    if (ra < 2000) return 'Low Earth orbit (LEO), elliptical.';
    return 'Elliptical orbit.';
  }

  // =======================================================================
  // Visibility toggles
  // =======================================================================
  let showNodes = true;
  function applyToggles() {
    const on = id => $(id).checked;
    planeMesh.visible   = on('om-t-plane');
    equatorDisc.visible = equatorRing.visible = on('om-t-equator');
    showNodes = on('om-t-nodes');
    frameGroup.visible = refLbl.visible = nLbl.visible = on('om-t-frame');
    updateScene();
  }
  ['om-t-plane', 'om-t-equator', 'om-t-nodes', 'om-t-frame']
    .forEach(id => $(id).addEventListener('change', applyToggles));

  // =======================================================================
  // Sliders
  // =======================================================================
  function readSliders() {
    el.a  = parseFloat($('om-a').value);
    el.e  = parseFloat($('om-e').value);
    el.i  = parseFloat($('om-i').value);
    el.O  = parseFloat($('om-O').value);
    el.w  = parseFloat($('om-w').value);
    el.nu = parseFloat($('om-nu').value);
    $('om-a-val').textContent  = fmt(el.a, 0);
    $('om-e-val').textContent  = el.e.toFixed(3);
    $('om-i-val').textContent  = el.i.toFixed(el.i % 1 ? 1 : 0);
    $('om-O-val').textContent  = el.O.toFixed(0);
    $('om-w-val').textContent  = el.w.toFixed(0);
    $('om-nu-val').textContent = el.nu.toFixed(0);
  }
  ['om-a', 'om-e', 'om-i', 'om-O', 'om-w', 'om-nu'].forEach(id =>
    $(id).addEventListener('input', () => { readSliders(); updateScene(); }));

  // =======================================================================
  // Presets
  // =======================================================================
  const PRESETS = {
    leo:     { a: 6771,  e: 0.001, i: 51.6, O: 40,  w: 0,   nu: 0 },
    sso:     { a: 7078,  e: 0.001, i: 98.2, O: 0,   w: 0,   nu: 0 },
    geo:     { a: 42164, e: 0.000, i: 0,    O: 0,   w: 0,   nu: 0 },
    molniya: { a: 26560, e: 0.74,  i: 63.4, O: 0,   w: 270, nu: 200 },
    gto:     { a: 24396, e: 0.730, i: 6,    O: 0,   w: 178, nu: 30 },
  };
  function applyPreset(key) {
    const p = PRESETS[key]; if (!p) return;
    $('om-a').value = p.a; $('om-e').value = p.e; $('om-i').value = p.i;
    $('om-O').value = p.O; $('om-w').value = p.w; $('om-nu').value = p.nu;
    readSliders(); updateScene(); fitView();
  }
  $('om-presets').addEventListener('click', e => {
    const b = e.target.closest('button[data-preset]');
    if (b) applyPreset(b.dataset.preset);
  });

  // =======================================================================
  // Camera framing
  // =======================================================================
  function fitView() {
    const dist = Math.max(320, apogeeUnits() * 2.7);
    const dir = new THREE.Vector3(0.55, 0.5, 1).normalize();
    camera.position.copy(dir.multiplyScalar(dist));
    controls.target.set(0, 0, 0);
    controls.maxDistance = Math.max(12000, apogeeUnits() * 9);
    controls.update();
  }
  $('om-fit').addEventListener('click', fitView);

  // =======================================================================
  // Animation (advance mean anomaly so speed varies correctly along the orbit)
  // =======================================================================
  let playing = false, meanAnom = 0, lastT = 0;
  const VISUAL_PERIOD = 11;   // seconds on screen for one full revolution

  function animateStep(now) {
    if (!playing) return;
    if (!lastT) lastT = now;
    const dt = Math.min((now - lastT) / 1000, 0.1); lastT = now;
    meanAnom = (meanAnom + (2 * Math.PI / VISUAL_PERIOD) * dt) % (2 * Math.PI);
    const nu = meanToTrue(meanAnom, el.e);
    let deg = nu / DEG; if (deg < 0) deg += 360;
    el.nu = deg;
    $('om-nu').value = deg; $('om-nu-val').textContent = deg.toFixed(0);
    updateScene();
    requestAnimationFrame(animateStep);
  }
  $('om-play').addEventListener('click', () => {
    playing = !playing;
    const btn = $('om-play');
    btn.classList.toggle('on', playing);
    btn.textContent = playing ? '❚❚ Pause' : '▶ Animate';
    if (playing) {
      // Seed mean anomaly from the current true anomaly so it picks up smoothly.
      const nu = el.nu * DEG, e = el.e;
      const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
      meanAnom = E - e * Math.sin(E);
      lastT = 0;
      requestAnimationFrame(animateStep);
    }
  });

  // =======================================================================
  // Boot
  // =======================================================================
  readSliders();
  applyToggles();     // also calls updateScene()
  fitView();
})();
