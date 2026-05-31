// 3-D Visualiser — every active satellite placed at its real altitude,
// rendered as a single THREE.InstancedMesh so 16 k spheres cost one
// draw call.  Mirrors game-of-cones' Blue-Marble/atmosphere chrome, but
// swaps globe.gl's `objectsData` (one Object3D per item — too slow at
// 16 k) for a hand-rolled InstancedMesh that we drop straight into
// globe.scene().
//
// Performance plan:
//   • SGP4 propagation (~10 µs/sat × 16 k = ~160 ms) is chunked across
//     ~16 animation frames so the globe never stutters.
//   • Per-frame work between propagation ticks is zero: the camera
//     just orbits the static InstancedMesh; globe.gl handles its own
//     atmosphere shader.
//   • Filter checkboxes scale unwanted classes to zero rather than
//     re-allocating the instance buffer.

const { fetchTLEs, makeSatrecs, propagate, EARTH_R_KM } = window.Argos;

const $ = id => document.getElementById(id);
const REFRESH_MS = 3000;            // re-propagate every 3 s
const CHUNK_SIZE = 1000;            // sats per propagation slice
const MAX_INSTANCES = 20_000;       // headroom above today's ~16 k active

// Orbit-class palette — matches game-of-cones.js and sat-stats.js so
// the legend reads consistently across pages.
const ORBIT_COLOR = {
  LEO: new THREE.Color('#67e8a4'),
  MEO: new THREE.Color('#f9d24c'),
  GEO: new THREE.Color('#ff9966'),
  HEO: new THREE.Color('#d77eff'),
};
function orbitClass(altKm) {
  if (altKm < 2000)  return 'LEO';
  if (altKm < 30000) return 'MEO';
  if (altKm < 42000) return 'GEO';
  return 'HEO';
}

function setStatus(msg, isErr) {
  $('viz-status').textContent = msg;
  $('viz-status').style.color = isErr ? 'var(--accent2)' : '';
}

// --- Globe ----------------------------------------------------------------
// Same imagery / atmosphere as game-of-cones.js for visual continuity.

const globe = Globe()(document.getElementById('globe'))
  .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
  .bumpImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png')
  .backgroundImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/night-sky.png')
  .showAtmosphere(true)
  .atmosphereColor('#4ea8ff')
  .atmosphereAltitude(0.18)
  .pointOfView({ lat: 22, lng: 80, altitude: 3.2 }, 0);

const controls = globe.controls();
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.rotateSpeed   = 0.45;
controls.zoomSpeed     = 0.8;
controls.minDistance   = 110;
controls.maxDistance   = 2200;     // pull back further to fit GEO ring

// Slow auto-rotate gives the visualisation a "live" feel before any
// user input.  Damped, so a single drag pauses it naturally.
controls.autoRotate       = true;
controls.autoRotateSpeed  = 0.18;
const stopAutoRotate = () => { controls.autoRotate = false; };
document.getElementById('globe').addEventListener('pointerdown', stopAutoRotate, { once: true });
document.getElementById('globe').addEventListener('wheel',       stopAutoRotate, { once: true });

window.addEventListener('resize', () => {
  globe.width(window.innerWidth).height(window.innerHeight);
});

// --- Instanced-mesh setup -------------------------------------------------
//
// One low-poly sphere geometry × MAX_INSTANCES instances.  Per-instance
// colour goes through `setColorAt`, per-instance position+scale through
// `setMatrixAt`.  Geometry radius is 1 unit (globe radius is 100 in
// globe.gl's internal scale, so 1 unit ≈ 64 km on Earth — chunky enough
// to spot, small enough not to clump visually at LEO).

const SAT_GEOM = new THREE.SphereGeometry(1.0, 6, 6);
// Plain MeshBasicMaterial — three.js r157 auto-detects instanceColor on
// the InstancedMesh (setColorAt below allocates it) and routes it
// through the USE_INSTANCING_COLOR shader define.  No vertexColors flag
// needed; that flag wires per-vertex geometry colour, which is a
// different pathway.
// transparent + depthWrite:false lets the click-to-select code tween
// the whole catalogue's opacity down to ~12% without re-touching 16 k
// per-instance entries each frame — one uniform update covers it.
const SAT_MAT  = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 1.0,
  depthWrite: false,
});
const instMesh = new THREE.InstancedMesh(SAT_GEOM, SAT_MAT, MAX_INSTANCES);
instMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
instMesh.frustumCulled = false;   // bulk update; cheaper to render than to cull

// Initial state: every instance at scale 0 (invisible).  Propagation
// fills them in chunk-by-chunk on the first tick.
const HIDE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
for (let i = 0; i < MAX_INSTANCES; i++) instMesh.setMatrixAt(i, HIDE_MATRIX);
instMesh.instanceMatrix.needsUpdate = true;

globe.scene().add(instMesh);

// --- Selection: highlight sphere + orbital-path line ----------------------
//
// When a sat is clicked, the corresponding instance in instMesh gets
// hidden (HIDE_MATRIX) and `highlightSphere` is positioned at the sat's
// scene-space coordinates — a larger, full-brightness stand-in that
// remains crisp while the main instMesh fades to FADE_DIM_OPACITY.

const HIGHLIGHT_RADIUS = 2.0;
const highlightSphere = new THREE.Mesh(
  new THREE.SphereGeometry(HIGHLIGHT_RADIUS, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
);
highlightSphere.visible = false;
globe.scene().add(highlightSphere);

let pathLine = null;       // THREE.LineLoop or null when no selection
let selectedId = -1;       // index into allSats, or -1
const FADE_DURATION_MS = 350;
const FADE_DIM_OPACITY = 0.12;
const PATH_OPACITY     = 0.85;
const PATH_SAMPLES     = 128;

// --- App state ------------------------------------------------------------

let allSats   = [];        // [{ name, noradId, rec }]
let satClass  = [];        // parallel array of orbit-class strings (LEO/MEO/GEO/HEO/null)
let satState  = [];        // parallel array of latest { lat, lon, alt } (null if invalid)
let satPeriod = [];        // parallel array of orbital period in minutes (null if unknown)
let propagationActive = false;
let altScale = 1.0;        // user slider — exaggerate or compress altitudes
let dotScale = 1.0;        // user slider — sat sphere size multiplier

const filter = { LEO: true, MEO: true, GEO: true, HEO: true };
const tally  = { LEO: 0,    MEO: 0,    GEO: 0,    HEO: 0    };

// Re-usable scratch objects so we're not allocating a new Matrix4 /
// Color per satellite per tick (16 k × 60 ticks/min = a lot of garbage).
const _pos   = new THREE.Vector3();
const _quat  = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _mat   = new THREE.Matrix4();

// --- Propagation: chunked across frames ----------------------------------

let chunkIdx = 0;
let propNow  = new Date();

function startPropagationTick() {
  if (propagationActive) return;
  propagationActive = true;
  propNow  = new Date();
  chunkIdx = 0;
  // Reset tally; we'll rebuild it as we go through the chunks.
  tally.LEO = tally.MEO = tally.GEO = tally.HEO = 0;
  propagateChunk();
}

function propagateChunk() {
  const end = Math.min(chunkIdx + CHUNK_SIZE, allSats.length);
  const sizeUnit = dotScale;
  for (let i = chunkIdx; i < end; i++) {
    const t = allSats[i];
    const r = propagate(t.rec, propNow);
    if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon) || !Number.isFinite(r.alt) || r.alt < 0) {
      instMesh.setMatrixAt(i, HIDE_MATRIX);
      satClass[i] = null;
      satState[i] = null;
      continue;
    }
    const cls = orbitClass(r.alt);
    satClass[i] = cls;
    satState[i] = { lat: r.lat, lon: r.lon, alt: r.alt };
    tally[cls]++;

    // Map satellite alt (km) → globe.gl altitude fraction, then to a
    // scene-space position via the globe's own coord helper.  altScale
    // lets the user exaggerate the radial spread without distorting
    // the angular positions.
    const altFrac = (r.alt / EARTH_R_KM) * altScale;
    const p = globe.getCoords(r.lat, r.lon, altFrac);

    // Selected sat: the highlightSphere stands in at full brightness;
    // hide the instance in the main mesh so it doesn't double up.
    if (i === selectedId) {
      instMesh.setMatrixAt(i, HIDE_MATRIX);
      highlightSphere.position.set(p.x, p.y, p.z);
      continue;
    }
    if (!filter[cls]) {
      instMesh.setMatrixAt(i, HIDE_MATRIX);
      continue;
    }
    _pos.set(p.x, p.y, p.z);
    _scale.setScalar(sizeUnit);
    _mat.compose(_pos, _quat, _scale);
    instMesh.setMatrixAt(i, _mat);
    instMesh.setColorAt(i, ORBIT_COLOR[cls]);
  }
  chunkIdx = end;
  if (chunkIdx < allSats.length) {
    requestAnimationFrame(propagateChunk);
    return;
  }
  // Last chunk done — flush GPU buffers and update HUD.
  instMesh.instanceMatrix.needsUpdate = true;
  if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
  $('cnt-leo').textContent = tally.LEO.toLocaleString();
  $('cnt-meo').textContent = tally.MEO.toLocaleString();
  $('cnt-geo').textContent = tally.GEO.toLocaleString();
  $('cnt-heo').textContent = tally.HEO.toLocaleString();
  const total = tally.LEO + tally.MEO + tally.GEO + tally.HEO;
  setStatus(`${total.toLocaleString()} sats placed at altitude · refreshed ${propNow.toISOString().slice(11, 19)} UTC`);
  propagationActive = false;
  // If a tooltip is open, refresh its contents so the displayed
  // sub-point / altitude follow the satellite to its new position.
  if (hoverId !== -1 && satState[hoverId]) renderTooltip(hoverId);
}

// --- Filter + slider wiring -----------------------------------------------

function rerenderFiltered() {
  // Cheap second pass: hide / show instances based on current filter +
  // size slider without re-running SGP4.  Works because we still have
  // each instance's last position in the matrix buffer — we just need
  // to scale it to 0 or to the requested size.
  const sizeUnit = dotScale;
  for (let i = 0; i < allSats.length; i++) {
    const cls = satClass[i];
    if (!cls || !filter[cls]) {
      instMesh.setMatrixAt(i, HIDE_MATRIX);
      continue;
    }
    // Re-decompose the existing matrix to keep position, swap scale.
    instMesh.getMatrixAt(i, _mat);
    _mat.decompose(_pos, _quat, _scale);
    _scale.setScalar(sizeUnit);
    _mat.compose(_pos, _quat, _scale);
    instMesh.setMatrixAt(i, _mat);
  }
  instMesh.instanceMatrix.needsUpdate = true;
}

for (const cls of ['LEO', 'MEO', 'GEO', 'HEO']) {
  $('f-' + cls.toLowerCase()).addEventListener('change', e => {
    filter[cls] = e.target.checked;
    rerenderFiltered();
  });
}

$('alt-scale').addEventListener('input', e => {
  altScale = parseFloat(e.target.value) || 1;
  $('alt-scale-val').textContent = altScale.toFixed(1);
  // Altitude scale changes positions, not just visibility — need a full
  // SGP4 redo (cheap enough; already chunked).
  startPropagationTick();
  // If a sat is selected, rebuild its orbital path at the new scale so
  // the line matches the highlight sphere's new radius.
  if (selectedId !== -1) rebuildSelectionPath();
});
$('dot-size').addEventListener('input', e => {
  dotScale = parseFloat(e.target.value) || 1;
  $('dot-size-val').textContent = dotScale.toFixed(1);
  rerenderFiltered();
});

// --- Boot -----------------------------------------------------------------

async function boot() {
  setStatus('Loading TLE catalogue…');
  let tleResult;
  try {
    tleResult = await fetchTLEs();
  } catch (e) {
    setStatus('TLE fetch failed: ' + e.message, true);
    return;
  }
  allSats = makeSatrecs(tleResult.tles);
  if (allSats.length > MAX_INSTANCES) {
    console.warn(`More sats (${allSats.length}) than reserved instances (${MAX_INSTANCES}); trimming.`);
    allSats.length = MAX_INSTANCES;
  }
  satClass  = new Array(allSats.length).fill(null);
  satState  = new Array(allSats.length).fill(null);
  // Cache each sat's orbital period (minutes) once — it's TLE-derived,
  // doesn't change between propagation ticks.  satellite.js v5 stores
  // the Kozai mean motion in rad/min as `rec.no_kozai` (newer field) or
  // `rec.no` (the unkozaied value, very close numerically).
  satPeriod = new Array(allSats.length).fill(null);
  for (let i = 0; i < allSats.length; i++) {
    const rec = allSats[i].rec;
    const no = (rec && (rec.no_kozai ?? rec.no));
    satPeriod[i] = (Number.isFinite(no) && no > 0) ? (2 * Math.PI) / no : null;
  }
  const tag = tleResult.source === 'celestrak' ? 'live'
            : tleResult.source === 'cache'    ? 'cached'
            : 'bundled snapshot';
  setStatus(`Catalogue: ${allSats.length.toLocaleString()} sats (${tag}). Propagating…`);
  startPropagationTick();
  setInterval(startPropagationTick, REFRESH_MS);
}

boot();

// --- Hover tooltip --------------------------------------------------------
//
// Raycast against the InstancedMesh on every mousemove (rAF-throttled) to
// figure out which sat the cursor is over.  Three.js intersectObject() on
// an InstancedMesh returns `intersection.instanceId` — exactly the index
// into allSats / satState / satPeriod we need.

const tip = $('sat-tip');
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hoverId = -1;
let pendingMouse = null;
let rafQueued = false;

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function classBadgeStyle(cls) {
  const c = ORBIT_COLOR[cls];
  if (!c) return '';
  const r = Math.round(c.r * 255), g = Math.round(c.g * 255), b = Math.round(c.b * 255);
  return `background: rgba(${r}, ${g}, ${b}, 0.18); color: rgb(${r}, ${g}, ${b});`;
}

function renderTooltip(id) {
  const t  = allSats[id];
  const st = satState[id];
  if (!t || !st) return;
  const cls = satClass[id] || '—';
  const period = satPeriod[id];
  const periodStr = period
    ? `${period.toFixed(1)} min <span class="muted">(${(period / 60).toFixed(2)} h)</span>`
    : '<span class="muted">unknown</span>';
  tip.innerHTML = `
    <b>${escHtml(t.name)}</b>
    <div><span class="cls" style="${classBadgeStyle(cls)}">${cls}</span></div>
    <div>Altitude <strong>${st.alt.toFixed(0)} km</strong></div>
    <div>Sub-point <strong>${st.lat.toFixed(2)}°, ${st.lon.toFixed(2)}°</strong></div>
    <div>Period <strong>${periodStr}</strong></div>
  `;
}

function processHover() {
  rafQueued = false;
  const ev = pendingMouse;
  if (!ev) return;
  const cv = document.querySelector('#globe canvas');
  if (!cv) return;
  const rect = cv.getBoundingClientRect();
  ndc.x = ((ev.clientX - rect.left) / rect.width)  *  2 - 1;
  ndc.y = ((ev.clientY - rect.top)  / rect.height) * -2 + 1;
  raycaster.setFromCamera(ndc, globe.camera());
  // Also raycast against the highlight sphere so hovering over the
  // selected sat (which is hidden in the InstancedMesh) still tooltips.
  const targets = highlightSphere.visible
    ? [instMesh, highlightSphere]
    : [instMesh];
  const hits = raycaster.intersectObjects(targets, false);
  // Skip hits on hidden / invalid / filtered-out instances.  Zero-scaled
  // instances collapse to the scene origin (Earth's centre) — they're
  // visually invisible but a ray passing through the centre can still
  // pick one up, so the explicit filter + satState guards matter.
  let id = -1;
  for (const h of hits) {
    if (h.object === highlightSphere) {
      if (selectedId !== -1 && satState[selectedId]) { id = selectedId; break; }
      continue;
    }
    if (h.instanceId === undefined) continue;
    const i = h.instanceId;
    if (!satState[i]) continue;
    const cls = satClass[i];
    if (!cls || !filter[cls]) continue;
    id = i;
    break;
  }
  if (id !== -1) {
    if (id !== hoverId) {
      hoverId = id;
      renderTooltip(id);
    }
    tip.hidden = false;
    // Bias the tooltip below-and-right of the cursor; flip if it would
    // run off the viewport edge so it's never clipped.
    const ttW = tip.offsetWidth  || 220;
    const ttH = tip.offsetHeight || 110;
    let x = ev.clientX + 16;
    let y = ev.clientY + 16;
    if (x + ttW > window.innerWidth)  x = ev.clientX - ttW - 12;
    if (y + ttH > window.innerHeight) y = ev.clientY - ttH - 12;
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  } else if (hoverId !== -1) {
    hoverId = -1;
    tip.hidden = true;
  }
}

function onMouseMove(e) {
  pendingMouse = e;
  if (rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(processHover);
}
function onMouseLeave() {
  pendingMouse = null;
  hoverId = -1;
  tip.hidden = true;
}

// globe.gl appends its canvas asynchronously inside #globe, so poll until
// it exists before attaching listeners.
(function attachHover() {
  const cv = document.querySelector('#globe canvas');
  if (!cv) { requestAnimationFrame(attachHover); return; }
  cv.addEventListener('mousemove',  onMouseMove);
  cv.addEventListener('mouseleave', onMouseLeave);
  // Click → select / deselect.  The browser only fires 'click' when
  // pointerdown and pointerup are at near-the-same screen position, so
  // a drag-rotation of the globe won't trigger it.  No manual
  // drag-distance heuristic needed.
  cv.addEventListener('click', onCanvasClick);
})();

// --- Tween helper --------------------------------------------------------
//
// Ease-out-quad lerp of a property on an object over `dur` ms, driven by
// requestAnimationFrame.  Concurrent tweens stack — each one schedules
// its own rAF chain, so the main-mesh opacity and the path opacity can
// animate independently.

function tween(target, prop, to, dur, onDone) {
  const start = performance.now();
  const from = target[prop];
  function step() {
    const t = Math.min(1, (performance.now() - start) / dur);
    const eased = 1 - Math.pow(1 - t, 2);
    target[prop] = from + (to - from) * eased;
    if (t < 1) requestAnimationFrame(step);
    else if (onDone) onDone();
  }
  step();
}

// --- Click selection -----------------------------------------------------

function onCanvasClick(ev) {
  const cv = ev.currentTarget;
  const rect = cv.getBoundingClientRect();
  ndc.x = ((ev.clientX - rect.left) / rect.width)  *  2 - 1;
  ndc.y = ((ev.clientY - rect.top)  / rect.height) * -2 + 1;
  raycaster.setFromCamera(ndc, globe.camera());
  const targets = highlightSphere.visible
    ? [instMesh, highlightSphere]
    : [instMesh];
  const hits = raycaster.intersectObjects(targets, false);
  let id = -1;
  for (const h of hits) {
    if (h.object === highlightSphere) {
      // Clicking the highlight sphere itself is a no-op (it's already
      // the selected sat).
      if (selectedId !== -1) return;
      continue;
    }
    if (h.instanceId === undefined) continue;
    const i = h.instanceId;
    if (!satState[i]) continue;
    const cls = satClass[i];
    if (!cls || !filter[cls]) continue;
    id = i;
    break;
  }
  if (id !== -1) selectSat(id);
  else           deselectSat();
}

function selectSat(id) {
  // No-op if clicking the already-selected sat.
  if (id === selectedId) return;

  // If we already had a selection, hand its instance back to the main
  // mesh so the next propagation tick (or anything in between) doesn't
  // leave a hole where the old sat used to be.
  const prevId = selectedId;
  selectedId = id;
  if (prevId !== -1) restoreInstance(prevId);

  // Hide the new selection's instance — the highlight sphere will
  // stand in for it at full brightness.
  instMesh.setMatrixAt(id, HIDE_MATRIX);
  instMesh.instanceMatrix.needsUpdate = true;

  // Position + colour the highlight sphere right now (don't wait for
  // the next propagation tick, which can be up to REFRESH_MS away).
  const st = satState[id];
  if (st) {
    const altFrac = (st.alt / EARTH_R_KM) * altScale;
    const p = globe.getCoords(st.lat, st.lon, altFrac);
    highlightSphere.position.set(p.x, p.y, p.z);
  }
  const cls = satClass[id];
  if (cls && ORBIT_COLOR[cls]) highlightSphere.material.color.copy(ORBIT_COLOR[cls]);
  highlightSphere.visible = true;
  tween(highlightSphere.material, 'opacity', 1.0, FADE_DURATION_MS);

  // Fade the rest of the catalogue to background dim — single uniform
  // update per frame, no per-instance work.
  tween(instMesh.material, 'opacity', FADE_DIM_OPACITY, FADE_DURATION_MS);

  // (Re-)build the orbital path and fade it in.  We rebuild rather
  // than reusing the previous selection's geometry because each sat's
  // orbit is different.
  rebuildSelectionPath();
}

function deselectSat() {
  if (selectedId === -1) return;
  const id = selectedId;
  selectedId = -1;
  // Restore the instance back into the main mesh immediately — the
  // fade-up of instMesh.material.opacity will smooth the visual
  // transition for the entire catalogue including this sat.
  restoreInstance(id);
  tween(instMesh.material, 'opacity', 1.0, FADE_DURATION_MS);
  tween(highlightSphere.material, 'opacity', 0, FADE_DURATION_MS, () => {
    if (selectedId === -1) highlightSphere.visible = false;
  });
  if (pathLine) {
    const lineRef = pathLine;
    tween(pathLine.material, 'opacity', 0, FADE_DURATION_MS, () => {
      // Guard against a new selection taking over mid-fade.
      if (lineRef === pathLine) removePath();
    });
  }
}

// Push a previously-hidden instance's matrix back into the main mesh
// based on the latest satState + filter + dotScale.  Called when a
// sat is deselected, or when a different sat is being selected and we
// need to restore the previous one.
function restoreInstance(i) {
  const st = satState[i];
  const cls = satClass[i];
  if (!st || !cls || !filter[cls]) {
    instMesh.setMatrixAt(i, HIDE_MATRIX);
  } else {
    const altFrac = (st.alt / EARTH_R_KM) * altScale;
    const p = globe.getCoords(st.lat, st.lon, altFrac);
    _pos.set(p.x, p.y, p.z);
    _scale.setScalar(dotScale);
    _mat.compose(_pos, _quat, _scale);
    instMesh.setMatrixAt(i, _mat);
    instMesh.setColorAt(i, ORBIT_COLOR[cls]);
  }
  instMesh.instanceMatrix.needsUpdate = true;
  if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
}

function rebuildSelectionPath() {
  // Take down the existing path geometry without fading — when the user
  // moves the altScale slider mid-selection we just snap to the new
  // shape rather than animate.
  removePath();
  if (selectedId === -1) return;
  const newPath = buildOrbitalPath(selectedId);
  if (!newPath) return;
  pathLine = newPath;
  globe.scene().add(pathLine);
  tween(pathLine.material, 'opacity', PATH_OPACITY, FADE_DURATION_MS);
}

function removePath() {
  if (!pathLine) return;
  globe.scene().remove(pathLine);
  pathLine.geometry.dispose();
  pathLine.material.dispose();
  pathLine = null;
}

// Sample one full revolution by stepping the propagation time across
// the sat's period, then sweep a TubeGeometry along a Catmull-Rom curve
// through the samples.  A plain THREE.LineLoop renders as a 1-px
// hairline on most browsers (WebGL clamps `linewidth`), which is
// invisible against the night-sky texture — a real 3-D tube mesh has
// guaranteed visible thickness and looks like an orbit ring.
//
// Uniform-in-time sampling: HEO / Molniya orbits naturally get denser
// samples near apogee where the sat moves slowly — that's actually the
// right perceptual outcome (smoother curve where it matters).
function buildOrbitalPath(id) {
  const t = allSats[id];
  const period = satPeriod[id];
  if (!t || !period || !Number.isFinite(period)) return null;
  const N = PATH_SAMPLES;
  const points = [];
  const baseTime = (propNow || new Date()).getTime();
  const periodMs = period * 60 * 1000;
  for (let i = 0; i < N; i++) {
    const tt = new Date(baseTime + periodMs * (i / N));
    const r = propagate(t.rec, tt);
    if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon) || !Number.isFinite(r.alt)) continue;
    const altFrac = (r.alt / EARTH_R_KM) * altScale;
    const p = globe.getCoords(r.lat, r.lon, altFrac);
    points.push(new THREE.Vector3(p.x, p.y, p.z));
  }
  if (points.length < 4) return null;

  const curve = new THREE.CatmullRomCurve3(points, /* closed */ true);
  // Tube radius scales with the orbit's mean distance from origin so a
  // GEO ring (~660 units across) and a LEO swarm (~108 units across)
  // both get a tube that's visible without being bulky.  Floor of
  // 0.6 units keeps even the tightest LEO orbit picky-able.
  const meanRadius = points.reduce((a, v) => a + v.length(), 0) / points.length;
  const tubeRadius = Math.max(0.6, meanRadius * 0.008);
  const tubeGeo = new THREE.TubeGeometry(curve, Math.max(N, 192), tubeRadius, 8, true);

  const cls = satClass[id];
  const colour = (cls && ORBIT_COLOR[cls]) ? ORBIT_COLOR[cls].clone() : new THREE.Color(0xffffff);
  const mat = new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(tubeGeo, mat);
  // Force the tube to render after the dimmed-down catalogue dots so
  // it sits visibly on top.  Earth (opaque, depthWrite:true) still
  // occludes the back half of the orbit via the depth test.
  mesh.renderOrder = 2;
  return mesh;
}
