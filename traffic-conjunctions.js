// =============================================================================
// Traffic-Conjunctions — a globe of predicted satellite close approaches.
//
// Data: data/conjunctions.json (bundled snapshot of CelesTrak SOCRATES
// predictions + the two-line elements for each object).  Every object is
// propagated locally with SGP4 (satellite.js).  Pick a pair, hit Animate, and
// the two orbits play forward from now to the flagged time of closest approach
// (TCA); all other objects fade back.  A speed slider compresses time up to
// 10,000x.  No back-end, no login — everything runs in the browser.
// =============================================================================
(function () {
  'use strict';
  const R_EARTH = 6371;                 // km
  const OTHER = '#63b3ff', PRI = '#ff5d5d', SEC = '#ffd166', TCA_COL = '#ff3b3b';
  const $ = id => document.getElementById(id);

  let world, conjs = [], sats = new Map();   // norad -> {name,kind,satrec,mesh,periodS,role}
  const SPEEDS = [100, 250, 500, 1000, 2000, 4000, 6000, 8000, 10000];
  let selIdx = -1, animating = false, reachedTCA = false, tcaShown = false;
  let simMs = 0, startMs = 0, tcaMs = 0, lastTs = 0, speed = 1000;
  let pairA = null, pairB = null;            // selected sat objects
  let lineA, lineB, tcaMarker;
  const trailA = [], trailB = [];
  const MAXTRAIL = 240;

  // ---- SGP4 helpers -------------------------------------------------------
  function propAt(sat, ms) {
    const d = new Date(ms);
    const pv = satellite.propagate(sat.satrec, d);
    if (!pv || !pv.position) return null;
    const gd = satellite.eciToGeodetic(pv.position, satellite.gstime(d));
    const v = pv.velocity;
    const altKm = Math.max(gd.height, 0);
    return {
      lat: satellite.degreesLat(gd.latitude),
      lng: satellite.degreesLong(gd.longitude),
      alt: altKm / R_EARTH,
      altKm, eci: pv.position,
      speed: v ? Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) : 0,
    };
  }
  const fmtUTC = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  const fmtDur = s => {
    s = Math.max(0, Math.round(s));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60);
    return (d ? d + 'd ' : '') + (h || d ? h + 'h ' : '') + m + 'm';
  };

  // ---- boot ---------------------------------------------------------------
  async function boot() {
    let data;
    try {
      // Revalidate against the server so the ~2-day auto-refresh reaches
      // returning visitors instead of a stale cached copy.
      data = await (await fetch('data/conjunctions.json', { cache: 'no-cache' })).json();
    } catch (e) {
      $('globe-loading').textContent = 'Could not load conjunction data.';
      return;
    }
    conjs = data.conjunctions || [];

    // Build the unique-object table with a satrec + orbital period each.
    for (const c of conjs) {
      for (const o of [c.a, c.b]) {
        if (sats.has(o.norad)) continue;
        const satrec = satellite.twoline2satrec(o.tle[0], o.tle[1]);
        const periodS = (2 * Math.PI / satrec.no) * 60;   // no = rad/min
        sats.set(o.norad, { norad: o.norad, name: o.name, kind: o.kind, owner: o.owner || '—',
          satrec, periodS, mesh: null, role: 'other', curAlt: null, curSpeed: null });
      }
    }

    initGlobe();
    buildDots();
    setupHover();
    renderList();
    renderWindow();
    wireControls();
    $('globe-loading').hidden = true;
    lastTs = performance.now();
    requestAnimationFrame(tick);
  }

  // ---- globe --------------------------------------------------------------
  function sizeOf() {
    const p = $('globe').parentElement.getBoundingClientRect();
    return { w: Math.max(320, p.width), h: Math.max(360, p.height) };
  }
  function initGlobe() {
    const { w, h } = sizeOf();
    world = Globe()(document.getElementById('globe'))
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
      .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
      .backgroundColor('rgba(0,0,0,0)')
      .showAtmosphere(true).atmosphereColor('#6cc0ff').atmosphereAltitude(0.17)
      .width(w).height(h);
    const c = world.controls();
    c.autoRotate = true; c.autoRotateSpeed = 0.4; c.enableDamping = true;
    world.pointOfView({ altitude: 2.5 });
    const onResize = () => { const s = sizeOf(); world.width(s.w).height(s.h); };
    window.addEventListener('resize', onResize);
    // Keep the globe filling (and centred in) its panel even when the panel
    // resizes for reasons other than a window resize (font reflow, layout).
    try { new ResizeObserver(onResize).observe($('globe').parentElement); } catch (e) { /* older browsers */ }
  }

  function buildDots() {
    const scene = world.scene();
    for (const s of sats.values()) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1.7, 14, 14),
        new THREE.MeshBasicMaterial({ color: OTHER, transparent: true, opacity: 0.95 })
      );
      mesh.userData.sat = s;
      s.mesh = mesh; scene.add(mesh);
    }
    // orbit path lines + TCA marker (created empty, populated during animation)
    lineA = mkLine(PRI); lineB = mkLine(SEC);
    scene.add(lineA); scene.add(lineB);
    tcaMarker = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 16, 16),
      new THREE.MeshBasicMaterial({ color: TCA_COL, transparent: true, opacity: 0.9 })
    );
    tcaMarker.visible = false; scene.add(tcaMarker);
  }
  function mkLine(color) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXTRAIL * 3), 3));
    geo.setDrawRange(0, 0);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    line.visible = false; line.frustumCulled = false;
    return line;
  }

  // ---- hover tooltip: raycast the pointer onto the dot meshes --------------
  function setupHover() {
    const ray = new THREE.Raycaster();
    const m = new THREE.Vector2();
    const canvas = world.renderer().domElement;
    const tip = $('sat-tip');
    const panel = $('globe').parentElement;
    const meshes = [...sats.values()].map(s => s.mesh);
    canvas.addEventListener('pointermove', e => {
      const rect = canvas.getBoundingClientRect();
      m.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      m.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(m, world.camera());
      const hit = ray.intersectObjects(meshes, false)[0];
      if (!hit) { tip.hidden = true; canvas.style.cursor = ''; return; }
      const s = hit.object.userData.sat;
      tip.innerHTML = `<div class="nm">${esc(s.name)}</div>
        <div class="row">Operator · <b>${esc(s.owner)}</b></div>
        <div class="row">Altitude · <b>${s.curAlt != null ? Math.round(s.curAlt).toLocaleString() + ' km' : '—'}</b></div>
        <div class="row">Speed · <b>${s.curSpeed != null ? s.curSpeed.toFixed(2) + ' km/s' : '—'}</b></div>`;
      tip.hidden = false;
      const pr = panel.getBoundingClientRect();
      let x = e.clientX - pr.left + 14, y = e.clientY - pr.top + 12;
      if (x + tip.offsetWidth > pr.width - 6) x = e.clientX - pr.left - tip.offsetWidth - 14;
      if (y + tip.offsetHeight > pr.height - 6) y = pr.height - tip.offsetHeight - 6;
      tip.style.left = Math.max(4, x) + 'px';
      tip.style.top = Math.max(4, y) + 'px';
      canvas.style.cursor = 'pointer';
    });
    canvas.addEventListener('pointerleave', () => { tip.hidden = true; });
  }

  // ---- validity window shown above the list -------------------------------
  function renderWindow() {
    const t = conjs.map(c => new Date(c.tca).getTime());
    const f = ms => new Date(ms).toUTCString().slice(5, 16);   // "25 Aug 2026"
    $('valid-window').innerHTML =
      `Predicted close approaches valid <b>${f(Math.min(...t))} → ${f(Math.max(...t))}</b> (UTC)`;
  }

  // ---- closest-approach details card --------------------------------------
  const fmtGMT = ms => new Date(ms).toUTCString().slice(5);    // "25 Aug 2026 19:05:45 GMT"
  function showTCACard() {
    const c = conjs[selIdx];
    const A = propAt(pairA, tcaMs), B = propAt(pairB, tcaMs);
    let altSep = null, latSep = null, encAlt = null;
    if (A && B) {
      // Direction of the miss from SGP4, scaled to the authoritative SOCRATES
      // miss distance so the altitude/lateral split is self-consistent with it.
      const sx = B.eci.x - A.eci.x, sy = B.eci.y - A.eci.y, sz = B.eci.z - A.eci.z;
      const mx = (A.eci.x + B.eci.x) / 2, my = (A.eci.y + B.eci.y) / 2, mz = (A.eci.z + B.eci.z) / 2;
      const rmag = Math.hypot(mx, my, mz) || 1;
      const smag = Math.hypot(sx, sy, sz) || 1;
      const radial = Math.abs((sx * mx + sy * my + sz * mz) / rmag);
      const lateral = Math.sqrt(Math.max(0, smag * smag - radial * radial));
      altSep = c.missM * (radial / smag);
      latSep = c.missM * (lateral / smag);
      encAlt = (A.altKm + B.altKm) / 2;
    }
    const mtr = x => x == null ? '—' : (x < 1 ? '<1' : Math.round(x).toLocaleString()) + ' m';
    $('tca-when').textContent = '· ' + pairA.name + ' / ' + pairB.name;
    $('tca-alt').innerHTML = mtr(altSep) + ' <small>≈</small>';
    $('tca-lat').innerHTML = mtr(latSep) + ' <small>≈</small>';
    $('tca-miss').textContent = c.missM.toLocaleString() + ' m';
    $('tca-encalt').innerHTML = encAlt != null ? Math.round(encAlt).toLocaleString() + ' <small>km</small>' : '—';
    $('tca-vel').innerHTML = c.relVel.toFixed(1) + ' <small>km/s</small>';
    $('tca-date').textContent = fmtGMT(tcaMs);
    $('tca-card').hidden = false;
    $('anim-status').hidden = true;
    const lg = document.querySelector('.globe-legend'); if (lg) lg.style.display = 'none';
  }
  function hideTCACard() {
    $('tca-card').hidden = true;
    const lg = document.querySelector('.globe-legend'); if (lg) lg.style.display = '';
  }

  // ---- conjunction list ---------------------------------------------------
  const kbadge = k => `<span class="kd kd-${k}">${k}</span>`;
  const riskCol = p => p >= 0.01 ? '#d9534f' : p >= 0.001 ? '#e0a83a' : '#7aa2c8';
  function renderList() {
    $('conj-count').textContent = conjs.length + ' pairs';
    $('conj-list').innerHTML = conjs.map((c, i) => {
      const tca = new Date(c.tca).getTime();
      const dtxt = fmtUTC(tca).slice(0, 16);
      return `
      <button class="conj" data-i="${i}" style="border-left-color:${riskCol(c.maxProb)}">
        <div class="pair">${esc(c.a.name)} ${kbadge(c.a.kind)} <span class="vs">vs</span> ${esc(c.b.name)} ${kbadge(c.b.kind)}</div>
        <div class="meta">
          <span class="miss">${c.missM} m miss</span>
          <span>P<sub>c</sub> <b>${c.maxProb.toFixed(3)}</b></span>
          <span><b>${c.relVel.toFixed(1)}</b> km/s</span>
          <span>TCA <b>${dtxt}</b>Z</span>
        </div>
      </button>`;
    }).join('');
    $('conj-list').querySelectorAll('.conj').forEach(b =>
      b.addEventListener('click', () => selectConj(+b.dataset.i)));
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }

  // ---- selection ----------------------------------------------------------
  function selectConj(i) {
    if (animating) stopAnim(false);
    selIdx = i;
    const c = conjs[i];
    pairA = sats.get(c.a.norad); pairB = sats.get(c.b.norad);
    tcaMs = new Date(c.tca).getTime();
    $('conj-list').querySelectorAll('.conj').forEach(b => b.classList.toggle('sel', +b.dataset.i === i));
    const btn = $('animate-btn');
    btn.disabled = false; btn.classList.remove('stop'); btn.textContent = '▶ Animate approach';
    // recolour dots: the pair stands out, others normal
    for (const s of sats.values()) s.role = 'other';
    pairA.role = 'pri'; pairB.role = 'sec';
    resetTrails(); tcaMarker.visible = false; reachedTCA = false; tcaShown = false;
    hideTCACard();
    applyRoles(1);
  }
  function applyRoles(otherOpacity) {
    for (const s of sats.values()) {
      const col = s.role === 'pri' ? PRI : s.role === 'sec' ? SEC : OTHER;
      s.mesh.material.color.set(col);
      s.mesh.material.opacity = s.role === 'other' ? otherOpacity : 1;
      s.mesh.scale.setScalar(s.role === 'other' ? 1 : 1.7);
    }
  }
  function resetTrails() {
    trailA.length = 0; trailB.length = 0;
    lineA.visible = lineB.visible = false;
    lineA.geometry.setDrawRange(0, 0); lineB.geometry.setDrawRange(0, 0);
  }

  // ---- animation ----------------------------------------------------------
  function startAnim() {
    if (selIdx < 0) return;
    const now = Date.now();
    // Play from the present up to TCA.  If the TCA is already past (aged data),
    // fall back to the final approach window so it still shows the encounter.
    startMs = now < tcaMs ? now : tcaMs - 3 * 3600 * 1000;
    simMs = startMs; reachedTCA = false; tcaShown = false;
    resetTrails(); hideTCACard();
    lineA.visible = lineB.visible = true;
    tcaMarker.visible = false;
    animating = true;
    $('anim-status').hidden = false;
    const btn = $('animate-btn'); btn.classList.add('stop'); btn.textContent = '■ Stop';
    applyRoles(0.09);           // fade the rest right down
  }
  function stopAnim(keepMarker) {
    animating = false; tcaShown = false;
    $('anim-status').hidden = true;
    hideTCACard();
    const btn = $('animate-btn');
    btn.classList.remove('stop');
    btn.textContent = selIdx >= 0 ? '▶ Animate approach' : '▶ Select a pair to animate';
    if (!keepMarker) { tcaMarker.visible = false; resetTrails(); }
    applyRoles(selIdx >= 0 ? 1 : 1);
  }

  function advanceTrail(sat, trail, fromMs, toMs) {
    const stepMs = Math.max((sat.periodS * 1000) / 90, 25000);   // ~90 pts / orbit
    let f = fromMs;
    if ((toMs - f) / stepMs > MAXTRAIL) f = toMs - MAXTRAIL * stepMs;  // bound work
    for (let t = f + stepMs; t < toMs; t += stepMs) {
      const p = propAt(sat, t); if (p) trail.push(p);
    }
    const pe = propAt(sat, toMs); if (pe) trail.push(pe);
    while (trail.length > MAXTRAIL) trail.shift();
  }
  function drawTrail(trail, line) {
    const pos = line.geometry.attributes.position.array;
    let n = 0;
    for (const p of trail) {
      const v = world.getCoords(p.lat, p.lng, p.alt);
      pos[n * 3] = v.x; pos[n * 3 + 1] = v.y; pos[n * 3 + 2] = v.z; n++;
    }
    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.setDrawRange(0, n);
  }
  function placeDotAt(sat, ms) {
    const p = propAt(sat, ms); if (!p) return null;
    const v = world.getCoords(p.lat, p.lng, p.alt);
    sat.mesh.position.set(v.x, v.y, v.z);
    sat.curAlt = p.altKm; sat.curSpeed = p.speed;
    return p;
  }

  // ---- main loop ----------------------------------------------------------
  function tick(ts) {
    const dt = Math.min(0.1, (ts - lastTs) / 1000); lastTs = ts;

    if (!animating) {
      // Live mode: every object at its real current position.
      const now = Date.now();
      for (const s of sats.values()) placeDotAt(s, now);
    } else {
      const prev = simMs;
      if (!reachedTCA) {
        simMs += dt * speed * 1000;
        if (simMs >= tcaMs) { simMs = tcaMs; reachedTCA = true; }
      }
      advanceTrail(pairA, trailA, prev, simMs);
      advanceTrail(pairB, trailB, prev, simMs);
      drawTrail(trailA, lineA); drawTrail(trailB, lineB);
      placeDotAt(pairA, simMs); placeDotAt(pairB, simMs);

      if (reachedTCA) {
        // park the closest-approach marker at the primary's TCA position
        const p = propAt(pairA, tcaMs);
        if (p) { const v = world.getCoords(p.lat, p.lng, p.alt); tcaMarker.position.set(v.x, v.y, v.z); }
        tcaMarker.visible = true;
        const flash = 0.55 + 0.45 * Math.sin(ts / 140);
        tcaMarker.material.opacity = flash;
        tcaMarker.scale.setScalar(1 + 0.25 * Math.sin(ts / 140));
        $('animate-btn').textContent = '↺ Replay';
        $('animate-btn').classList.remove('stop');
        if (!tcaShown) { showTCACard(); tcaShown = true; }
      }
      if (!reachedTCA) updateStatus();
    }
    requestAnimationFrame(tick);
  }

  function updateStatus() {
    const c = conjs[selIdx];
    if (reachedTCA) {
      $('anim-clock').innerHTML = `<b>Closest approach</b> · ${fmtUTC(tcaMs).slice(0, 16)}Z`;
      $('anim-tca').innerHTML = `<span class="tca-flash"><b>${c.missM} m</b> apart · ${c.relVel.toFixed(1)} km/s</span>`;
    } else {
      const remain = (tcaMs - simMs) / 1000;
      $('anim-clock').innerHTML = `${fmtUTC(simMs).slice(0, 19)}`;
      $('anim-tca').innerHTML = `T‑minus <b>${fmtDur(remain)}</b> to closest approach`;
    }
  }

  // ---- controls -----------------------------------------------------------
  function wireControls() {
    $('animate-btn').addEventListener('click', () => {
      if (selIdx < 0) return;
      if (animating && !reachedTCA) stopAnim(false);
      else startAnim();                       // also handles Replay after TCA
    });
    $('speed').addEventListener('input', e => {
      speed = SPEEDS[+e.target.value] || 1000;
      $('speed-val').textContent = speed.toLocaleString() + '×';
    });
    $('reset-btn').addEventListener('click', () => {
      stopAnim(false);
      selIdx = -1; pairA = pairB = null;
      $('conj-list').querySelectorAll('.conj').forEach(b => b.classList.remove('sel'));
      for (const s of sats.values()) s.role = 'other';
      applyRoles(1);
      const btn = $('animate-btn'); btn.disabled = true; btn.textContent = '▶ Select a pair to animate';
    });
  }

  // globe.gl + satellite.js load synchronously before this file; guard anyway.
  if (window.Globe && window.satellite && window.THREE) boot();
  else window.addEventListener('load', () => { if (window.Globe && window.satellite) boot(); });
})();
