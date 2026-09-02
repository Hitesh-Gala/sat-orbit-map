// =============================================================================
// Mirror Globe — the NAZAR home globe, rebuilt on Space-Track data.
//
// Reads data/spacetrack-gp.json (every on-orbit payload with its element set +
// metadata, refreshed daily by .github/workflows/refresh-spacetrack.yml) and
// plots the lot at true altitude in one THREE.InstancedMesh — the pattern this
// repo uses for the full catalogue (globe.gl's htmlElementsData layer does not
// scale, see CLAUDE.md).  Filters by orbit class, operator country and
// operational status; hover for details; search to spotlight and centre.
// =============================================================================
(function () {
  'use strict';
  const R_EARTH = 6371;
  const $ = id => document.getElementById(id);

  // Orbit classes, in the same colour language the rest of NAZAR uses.
  const ORBITS = [
    { k: 'LEO', label: 'LEO', hint: '< 2 000 km', col: '#67e8a4' },
    { k: 'MEO', label: 'MEO', hint: '2 000–30 000 km', col: '#f9d24c' },
    { k: 'GEO', label: 'GEO', hint: '~35 786 km', col: '#ff9966' },
    { k: 'HEO', label: 'HEO', hint: 'elliptical', col: '#d77eff' },
  ];
  const STATUSES = [
    { k: 'active', label: 'Active', col: '#67e8a4' },
    { k: 'dead', label: 'Dead / defunct', col: '#8899aa' },
    { k: 'unknown', label: 'Status unknown', col: '#5f7d99' },
  ];
  // Operational status uses the SATCAT OPS_STATUS_CODE scheme:
  //   + operational, P partially operational, B backup/standby, S spare,
  //   X extended mission  -> active
  //   - nonoperational, D decayed                                -> dead
  // Anything blank/unrecognised is reported honestly as "unknown".
  const OPS_ACTIVE = new Set(['+', 'P', 'B', 'S', 'X']);
  const OPS_DEAD = new Set(['-', 'D']);

  const COUNTRY = {
    US: 'United States', PRC: 'China', CIS: 'Russia', UK: 'United Kingdom',
    JPN: 'Japan', IND: 'India', ESA: 'ESA', FR: 'France', GER: 'Germany',
    IT: 'Italy', CA: 'Canada', SKOR: 'South Korea', SES: 'SES', ITSO: 'Intelsat',
    GLOB: 'Globalstar', ORB: 'Orbcomm', SPN: 'Spain', TBD: 'Unknown', NKOR: 'North Korea',
    IRAN: 'Iran', ISRA: 'Israel', AUS: 'Australia', BRAZ: 'Brazil', TURK: 'Türkiye',
    ARGN: 'Argentina', LUXE: 'Luxembourg', NETH: 'Netherlands', NOR: 'Norway',
    POL: 'Poland', SWED: 'Sweden', SAFR: 'South Africa', THAI: 'Thailand', UAE: 'UAE',
  };
  const cname = c => COUNTRY[c] || c || 'Unknown';

  let world, sats = [], mesh = null, dummy, colorAttr;
  let selected = null, hovered = null;
  const orbitOn = new Set(ORBITS.map(o => o.k));
  const statusOn = new Set(STATUSES.map(s => s.k));
  let countryOn = new Set();            // empty === show all
  let visible = [];                     // indices currently plotted

  const CT_COL = new THREE.Color('#67c8ff');
  const SEL_COL = new THREE.Color('#ffd27f');

  // ---- classification ----------------------------------------------------
  function orbitClass(s) {
    const ap = +s.ap || 0, pe = +s.pe || 0;
    if (ap - pe > 20000) return 'HEO';
    const mean = (ap + pe) / 2;
    if (mean < 2000) return 'LEO';
    if (mean < 30000) return 'MEO';
    return 'GEO';
  }
  function statusOf(s) {
    const c = (s.s || '').trim().toUpperCase();
    if (OPS_ACTIVE.has(c)) return 'active';
    if (OPS_DEAD.has(c)) return 'dead';
    return 'unknown';
  }

  // ---- boot --------------------------------------------------------------
  async function boot() {
    let doc;
    try {
      doc = await (await fetch('data/spacetrack-gp.json', { cache: 'no-cache' })).json();
    } catch (e) {
      $('mg-loading').textContent = 'Space-Track catalogue not available yet.';
      return;
    }
    const raw = doc.sats || [];
    for (const s of raw) {
      let satrec;
      try { satrec = satellite.twoline2satrec(s.t[0], s.t[1]); } catch (e) { continue; }
      if (!satrec || satrec.error) continue;
      sats.push({
        norad: s.c, name: s.n || ('NORAD ' + s.c), country: s.o, launch: s.ld,
        orbit: orbitClass(s), status: statusOf(s), satrec,
        lat: 0, lng: 0, altKm: 0, speed: 0, ok: false,
      });
    }
    $('mg-loading').hidden = true;

    initGlobe();
    buildInstances();
    buildFilters();
    wireSearch();
    wireHover();
    loadComparison(doc);
    startTick();
    setInterval(startTick, REFRESH_MS);
  }

  // ---- globe -------------------------------------------------------------
  function initGlobe() {
    world = Globe()(document.getElementById('globe'))
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
      .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
      .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
      .showAtmosphere(true).atmosphereColor('#6cc0ff').atmosphereAltitude(0.16)
      .width(window.innerWidth).height(window.innerHeight);
    const c = world.controls();
    c.autoRotate = true; c.autoRotateSpeed = 0.32; c.enableDamping = true;
    world.pointOfView({ altitude: 3.2 });
    window.addEventListener('resize', () =>
      world.width(window.innerWidth).height(window.innerHeight));
    // Clicking empty space clears the current selection.
    world.renderer().domElement.addEventListener('pointerdown', e => {
      if (e.target.closest('.mg-panel, .mg-search-wrap, .mg-sel')) return;
      if (!hovered) clearSelection();
    });
  }

  // Plain MeshBasicMaterial: three.js r157 auto-detects instanceColor (allocated
  // by the first setColorAt) and routes it through USE_INSTANCING_COLOR.  Setting
  // vertexColors here instead makes it look for a geometry colour attribute that
  // does not exist — which renders every instance black.
  function buildInstances() {
    dummy = new THREE.Object3D();
    const geo = new THREE.SphereGeometry(0.9, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95 });
    mesh = new THREE.InstancedMesh(geo, mat, sats.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    // Seed every instance's colour once so the buffer exists up-front.
    sats.forEach((s, i) => mesh.setColorAt(i, colFor(s)));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    world.scene().add(mesh);
  }

  const ORBIT_COLOR = {};
  ORBITS.forEach(o => { ORBIT_COLOR[o.k] = new THREE.Color(o.col); });
  const colFor = s => ORBIT_COLOR[s.orbit] || ORBIT_COLOR.LEO;

  // ---- propagation ---------------------------------------------------------
  // 18 k SGP4 solves per frame is far too much work; mirror the God-Mode
  // engine instead — re-propagate the catalogue every REFRESH_MS, sliced into
  // CHUNK_SIZE-sized pieces across successive frames so the globe keeps
  // spinning smoothly while the maths happens.
  const REFRESH_MS = 3000, CHUNK_SIZE = 1200;
  const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
  let chunkIdx = 0, propNow = new Date(), propagating = false;

  let dirty = false;
  function startTick() {
    // A filter toggled mid-pass would otherwise be dropped; remember it and
    // re-run as soon as the current sweep finishes.
    if (propagating) { dirty = true; return; }
    propagating = true; propNow = new Date(); chunkIdx = 0;
    propagateChunk();
  }
  function propagateChunk() {
    const end = Math.min(chunkIdx + CHUNK_SIZE, sats.length);
    const gmst = satellite.gstime(propNow);
    for (let i = chunkIdx; i < end; i++) {
      const s = sats[i];
      const shown = orbitOn.has(s.orbit) && statusOn.has(s.status)
        && (!countryOn.size || countryOn.has(s.country));
      if (!shown) { mesh.setMatrixAt(i, HIDE); s.ok = false; continue; }
      const pv = satellite.propagate(s.satrec, propNow);
      if (!pv || !pv.position) { mesh.setMatrixAt(i, HIDE); s.ok = false; continue; }
      const gd = satellite.eciToGeodetic(pv.position, gmst);
      const altKm = gd.height;
      if (!Number.isFinite(altKm) || altKm < 0) { mesh.setMatrixAt(i, HIDE); s.ok = false; continue; }
      s.lat = satellite.degreesLat(gd.latitude);
      s.lng = satellite.degreesLong(gd.longitude);
      s.altKm = altKm;
      const v = pv.velocity;
      s.speed = v ? Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) : 0;
      const p = world.getCoords(s.lat, s.lng, altKm / R_EARTH);
      s.x = p.x; s.y = p.y; s.z = p.z; s.ok = true;
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(selected === s ? 3.6 : 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, selected === s ? SEL_COL : colFor(s));
    }
    chunkIdx = end;
    if (chunkIdx < sats.length) {
      if (document.hidden) setTimeout(propagateChunk, 0);
      else requestAnimationFrame(propagateChunk);
      return;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    propagating = false;
    if (selected) updateSelReadout();
    if (dirty) { dirty = false; startTick(); }
  }

  // ---- filters -----------------------------------------------------------
  function countBy(fn) {
    const m = new Map();
    for (const s of sats) m.set(fn(s), (m.get(fn(s)) || 0) + 1);
    return m;
  }
  function buildFilters() {
    const oc = countBy(s => s.orbit), sc = countBy(s => s.status), cc = countBy(s => s.country);

    $('orbit-list').innerHTML = ORBITS.map(o =>
      `<label class="mg-row"><input type="checkbox" data-orbit="${o.k}" checked>
        <span class="sw" style="background:${o.col};color:${o.col}"></span>
        <span class="lbl">${o.label} <span class="n">${o.hint}</span></span>
        <span class="n">${(oc.get(o.k) || 0).toLocaleString()}</span></label>`).join('');
    $('status-list').innerHTML = STATUSES.map(s =>
      `<label class="mg-row"><input type="checkbox" data-status="${s.k}" checked>
        <span class="sw" style="background:${s.col};color:${s.col}"></span>
        <span class="lbl">${s.label}</span>
        <span class="n">${(sc.get(s.k) || 0).toLocaleString()}</span></label>`).join('');

    const top = [...cc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
    $('ctry-list').innerHTML = top.map(([c, n]) =>
      `<label class="mg-row"><input type="checkbox" data-ctry="${c}">
        <span class="lbl">${cname(c)}</span><span class="n">${n.toLocaleString()}</span></label>`).join('');

    document.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.orbit) toggle(orbitOn, t.dataset.orbit, t.checked);
      else if (t.dataset.status) toggle(statusOn, t.dataset.status, t.checked);
      else if (t.dataset.ctry) toggle(countryOn, t.dataset.ctry, t.checked);
    });
    const setAll = (sel, on) => document.querySelectorAll(sel).forEach(cb => {
      cb.checked = on; cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    $('orb-all').onclick = () => setAll('[data-orbit]', true);
    $('orb-none').onclick = () => setAll('[data-orbit]', false);
    // No country ticked === no country filter === every operator shown.
    $('ctry-all').onclick = () => setAll('[data-ctry]', false);
    $('ctry-top').onclick = () => {
      setAll('[data-ctry]', false);
      top.slice(0, 5).forEach(([c]) => {
        const cb = document.querySelector(`[data-ctry="${c}"]`);
        if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
      });
    };
  }
  function toggle(set, key, on) { on ? set.add(key) : set.delete(key); startTick(); }

  // ---- hover -------------------------------------------------------------
  function wireHover() {
    const ray = new THREE.Raycaster();
    ray.params.Points = { threshold: 2 };
    const m = new THREE.Vector2();
    const canvas = world.renderer().domElement;
    const tip = $('mg-tip');
    canvas.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect();
      m.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      m.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(m, world.camera());
      const hit = ray.intersectObject(mesh, false)[0];
      if (!hit || hit.instanceId == null) { hovered = null; tip.hidden = true; canvas.style.cursor = ''; return; }
      const s = sats[hit.instanceId];
      if (!s || !s.ok) { hovered = null; tip.hidden = true; return; }
      hovered = s;
      tip.innerHTML = `<div class="nm">${esc(s.name)}</div>
        <div class="r">Operator · <b>${esc(cname(s.country))}</b></div>
        <div class="r">Altitude · <b>${Math.round(s.altKm).toLocaleString()} km</b></div>
        <div class="r">Speed · <b>${s.speed.toFixed(2)} km/s</b></div>
        <div class="r">Launched · <b>${esc(s.launch || '—')}</b></div>
        <div class="r">Orbit · <b>${s.orbit}</b> · ${s.status}</div>`;
      tip.hidden = false;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tw - 8) + 'px';
      tip.style.top = Math.min(e.clientY + 14, window.innerHeight - th - 8) + 'px';
      canvas.style.cursor = 'pointer';
    });
    canvas.addEventListener('pointerleave', () => { tip.hidden = true; hovered = null; });
    canvas.addEventListener('click', () => { if (hovered) select(hovered); });
  }

  // ---- selection + search ------------------------------------------------
  function select(s) {
    selected = s;
    world.controls().autoRotate = false;
    if (s.ok) world.pointOfView({ lat: s.lat, lng: s.lng, altitude: 1.6 }, 900);
    updateSelReadout();
    $('mg-sel').hidden = false;
    startTick();
  }
  function updateSelReadout() {
    const s = selected; if (!s) return;
    $('sel-name').textContent = s.name;
    $('sel-meta').textContent =
      `${cname(s.country)} · ${Math.round(s.altKm).toLocaleString()} km · ${s.speed.toFixed(2)} km/s`
      + (s.launch ? ` · launched ${s.launch}` : '');
  }
  function clearSelection() {
    if (!selected) return;
    selected = null;
    $('mg-sel').hidden = true;
    world.controls().autoRotate = true;
    startTick();
  }

  function wireSearch() {
    const box = $('mg-search'), list = $('mg-results');
    const close = () => { list.hidden = true; box.setAttribute('aria-expanded', 'false'); };
    box.addEventListener('input', () => {
      const q = box.value.trim().toLowerCase();
      if (q.length < 2) return close();
      const hits = sats.filter(s =>
        s.name.toLowerCase().includes(q) || String(s.norad).includes(q)).slice(0, 40);
      if (!hits.length) { list.innerHTML = '<div class="mg-opt">No match</div>'; list.hidden = false; return; }
      list.innerHTML = hits.map((s, i) =>
        `<div class="mg-opt" data-norad="${s.norad}">
           <span>${esc(s.name)}</span><span class="nid">${s.norad} · ${esc(cname(s.country))}</span></div>`).join('');
      list.hidden = false; box.setAttribute('aria-expanded', 'true');
    });
    list.addEventListener('click', e => {
      const opt = e.target.closest('.mg-opt[data-norad]'); if (!opt) return;
      const s = sats.find(x => String(x.norad) === opt.dataset.norad);
      if (s) {
        // Make sure a filtered-out satellite still shows when searched for.
        orbitOn.add(s.orbit); statusOn.add(s.status);
        if (countryOn.size) countryOn.add(s.country);
        document.querySelectorAll(`[data-orbit="${s.orbit}"], [data-status="${s.status}"]`)
          .forEach(cb => { cb.checked = true; });
        select(s);
      }
      close(); box.value = '';
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.mg-search-wrap')) close();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); clearSelection(); } });
    $('sel-clear').addEventListener('click', clearSelection);
  }

  // ---- source comparison -------------------------------------------------
  async function loadComparison(doc) {
    $('cmp-st').textContent = sats.length.toLocaleString();
    let ct = null, ctStamp = null;
    try {
      const c = await (await fetch('data/celestrak-summary.json', { cache: 'no-cache' })).json();
      ct = c.satcat && c.satcat.count; ctStamp = c.retrieved;
    } catch (e) { /* summary not built yet */ }
    $('cmp-ct').textContent = ct ? ct.toLocaleString() : 'n/a';
    if (ct) {
      const d = sats.length - ct, pct = Math.abs(d / Math.max(sats.length, ct) * 100);
      $('cmp-delta').innerHTML = `Difference · <b>${Math.abs(d).toLocaleString()}</b> objects (${pct.toFixed(1)}%). ` +
        `Both count on-orbit payloads; the catalogues update on different schedules and ` +
        `apply slightly different criteria, so exact agreement is not expected.`;
    } else {
      $('cmp-delta').textContent = 'CelesTrak summary not available.';
    }
    const f = t => t ? new Date(t).toUTCString().slice(5, 22) + ' GMT' : '—';
    $('cmp-stamp').innerHTML =
      `Space-Track as of ${f(doc.retrieved)}<br>CelesTrak as of ${f(ctStamp)}`;
  }

  const esc = s => String(s).replace(/[&<>"]/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

  if (window.Globe && window.satellite && window.THREE) boot();
  else window.addEventListener('load', boot);
})();
