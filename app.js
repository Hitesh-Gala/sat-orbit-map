// 3-D globe view — the NAZAR main page.
// Data layer lives in tle-loader.js (window.Argos).
//
// Visual style mirrors game-of-cones.js: Blue Marble + topology bump
// against the night-sky starfield, an atmosphere rim glow, and small
// sphere meshes for the satellite markers.  Country polygons (the old
// 3 MB Natural Earth GeoJSON) have been removed — they were the single
// largest per-frame render cost on this page and game-of-cones doesn't
// draw them either, so the two globes now match visually.
//
// Performance: SGP4 propagation across ~16 k active TLEs is ~150 ms of
// synchronous work, which used to lock the main thread on every 10 s
// refresh.  The new update loop slices that work across rAF callbacks
// at 2 000 sats per slice, keeping each frame inside its budget.

const { EARTH_R_KM, inferPurpose, propagate, makeSatrecs,
        fetchTLEs, fetchChinaSatcat } = window.Argos;

// =========================================================================
// Constants
// =========================================================================

const REFRESH_MS    = 10_000;
const RELOAD_TLE_MS = 6 * 3600 * 1000;
const MAX_MARKERS   = 120;          // top-N highest-elevation sats shown
const CHUNK_SIZE    = 2000;         // sats per propagation slice
const HUD_LIST_MAX  = 200;          // capped to keep DOM cheap when open

// Selectable observer cities.  The over-horizon panels, the globe
// markers, and the custom lookup hint all recompute against whichever
// of these is active in the #observer-city dropdown.
const CITIES = [
  { name: 'New Delhi',   lat: 28.6139, lon: 77.2090, alt: 0.216 },
  { name: 'Mumbai',      lat: 19.0760, lon: 72.8777, alt: 0.014 },
  { name: 'Bangalore',   lat: 12.9716, lon: 77.5946, alt: 0.920 },
  { name: 'Chennai',     lat: 13.0827, lon: 80.2707, alt: 0.006 },
  { name: 'Srinagar',    lat: 34.0837, lon: 74.7973, alt: 1.585 },
  { name: 'Guwahati',    lat: 26.1445, lon: 91.7362, alt: 0.055 },
  { name: 'Jaisalmer',   lat: 26.9157, lon: 70.9083, alt: 0.225 },
  { name: 'Bhopal',      lat: 23.2599, lon: 77.4126, alt: 0.527 },
  { name: 'Kohima',      lat: 25.6751, lon: 94.1086, alt: 1.444 },
  { name: 'Bhubaneswar', lat: 20.2961, lon: 85.8245, alt: 0.045 },
];
let observerCity = CITIES[0];
let observerMode = 'single';   // 'single' = one city · 'all' = union of every city
let maskNonCN    = false;      // globe markers show only Chinese sats when true
let flatMode     = false;      // true = 2-D (markers pinned to surface) · false = 3-D (real altitude)

// Selection / ground-track parameters (click a sat to isolate it).
const TRACK_PAST_MIN     = 30;       // minutes of past trajectory shown
const TRACK_SAMPLES      = 60;       // 60 samples × 30 min = one point every 30 s
const TRACK_ALT          = 0.008;    // path altitude as fraction of Earth-radius
const DIMMED_OPACITY     = 0.25;     // opacity of non-selected sats while one is selected
const ARROW_LENGTH       = 3.5;      // scene-space length of the direction arrow
const ARROW_RADIUS       = 1.2;

const NIGHT_SKY_URL = 'https://unpkg.com/three-globe@2.31.1/example/img/night-sky.png';
const COLOR_NONCN   = '#67e8a4';    // green
const COLOR_CN      = '#ff6b6b';    // red

// =========================================================================
// Small helpers
// =========================================================================

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const COMPASS_DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const compass = az => COMPASS_DIRS[Math.round((az % 360) / 22.5) % 16];

function setStatus(msg, cls = '') {
  const el = $('status');
  if (!el) return;
  el.textContent = msg;
  el.className = cls;
}

// =========================================================================
// Globe — mirrors game-of-cones.js
// =========================================================================

const globe = Globe()($('globe'))
  .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
  .bumpImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png')
  .backgroundImageUrl(NIGHT_SKY_URL)
  .showAtmosphere(true)
  .atmosphereColor('#4ea8ff')
  .atmosphereAltitude(0.18)
  .pointOfView({ lat: 22, lng: 80, altitude: 2.4 }, 0)
  // Satellite markers — small sphere meshes at TRUE altitude (alt is
  // in km; globe.gl wants a fraction of Earth-radius).  A GEO sat now
  // floats 5.6 Earth-radii out exactly as it does on the 3-D
  // Visualiser / Sats-by-OPs pages, so the same sat reads at the same
  // 3-D position across all three globes.  Marker radius scales up
  // gently with altitude so a GEO dot 6 R⊕ from the camera doesn't
  // vanish into a sub-pixel.
  .objectsData([])
  .objectLat(d => d.lat)
  .objectLng(d => d.lon)
  .objectAltitude(d => d.alt / EARTH_R_KM)
  .objectThreeObject(d => {
    const dim = selectedSat !== null;
    // Flat 2-D mode uses a uniform dot; 3-D scales gently with
    // altitude so distant GEO markers stay visible.
    const radius = flatMode ? 0.6 : 0.6 + Math.min(1.4, d.alt / 30000);
    return new THREE.Mesh(
      new THREE.SphereGeometry(radius, 12, 12),
      new THREE.MeshBasicMaterial({
        color: d.cn ? COLOR_CN : COLOR_NONCN,
        transparent: dim,
        opacity: dim ? DIMMED_OPACITY : 1.0,
        depthWrite: !dim,
      }),
    );
  })
  .objectLabel(satTipHtml)
  .onObjectClick(onObjectClick)
  // Past 30-min ground track of the selected sat — at most one line.
  // Sampled at 30-sec resolution.
  .pathsData([])
  .pathPoints(d => d.points)
  .pathPointLat(p => p[0])
  .pathPointLng(p => p[1])
  .pathPointAlt(p => p[2])
  .pathColor(d => [d.color, d.color])
  .pathStroke(0.8)
  .pathTransitionDuration(0)
  .pathLabel(d => `<b>${esc(d.name)}</b><br>past ${TRACK_PAST_MIN} min ground track`)
  // Click empty globe → drop the current selection.
  .onGlobeClick(onGlobeClick);

const controls = globe.controls();
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.rotateSpeed   = 0.5;
controls.zoomSpeed     = 0.8;
controls.minDistance   = 110;
controls.maxDistance   = 2200;   // room to frame the GEO shell now that
                                 // markers sit at true altitude

window.addEventListener('resize', () => {
  globe.width(window.innerWidth).height(window.innerHeight);
});

function satTipHtml(d) {
  let h = `<div class="sat-tip"><b>${esc(d.name)}</b>`;
  h += `<div>${d.alt.toFixed(0)} km · ${d.lat.toFixed(2)}°, ${d.lon.toFixed(2)}°</div>`;
  if (Number.isFinite(d.az) && Number.isFinite(d.el)) {
    h += `<div>Az ${d.az.toFixed(1)}° · El ${d.el.toFixed(1)}°</div>`;
  }
  if (d.cn) h += `<div class="cn">Chinese payload</div>`;
  return h + `</div>`;
}

// =========================================================================
// Click-to-isolate selection: past 30-min ground track + direction arrow
// =========================================================================
//
// At most one sat can be selected at a time.  When a sat is selected:
//   * every other sat marker fades to DIMMED_OPACITY
//   * a polyline traces its sub-point over the last TRACK_PAST_MIN
//     minutes, lifted ~50 km above the surface to avoid z-fighting
//   * a THREE.ConeGeometry arrow sits at the current sub-point with
//     its tip pointing along the immediate sub-point velocity vector
// Clicking the selected sat again, or anywhere on the empty globe,
// drops the selection.

let selectedSat   = null;    // { rec, noradId, name, cn } or null
let currentMarkers = [];     // last full marker set sent to objectsData
let arrowMesh    = null;     // THREE.Mesh of the direction arrow, or null

function onObjectClick(d) {
  if (!d || !d.rec || d.noradId == null) return;
  if (selectedSat && selectedSat.noradId === d.noradId) deselect();
  else                                                  select(d);
}

function onGlobeClick() {
  if (selectedSat) deselect();
}

function select(d) {
  selectedSat = { rec: d.rec, noradId: d.noradId, name: d.name, cn: !!d.cn };
  rerenderMarkers();
  refreshSelectionVisuals();
}

function deselect() {
  selectedSat = null;
  removeArrow();
  globe.pathsData([]);
  rerenderMarkers();
}

// Re-emit the objectsData with the selected sat filtered out — the
// arrow stands in for it — and rebuild every mesh so the dim/full
// opacity material change takes effect.
function rerenderMarkers() {
  const data = selectedSat
    ? currentMarkers.filter(m => m.noradId !== selectedSat.noradId)
    : currentMarkers;
  globe.objectsData(data);
}

// Rebuild the past-30-min path + reposition the arrow.  Called once
// on selection and again on every REFRESH_MS tick, so the trailing
// window slides forward in real time.
function refreshSelectionVisuals() {
  if (!selectedSat) return;
  const now = new Date();
  const points = buildPastTrack(selectedSat.rec, now, TRACK_PAST_MIN);
  if (points.length < 2) {
    globe.pathsData([]);
    removeArrow();
    return;
  }
  globe.pathsData([{
    points,
    name:  selectedSat.name,
    color: selectedSat.cn ? COLOR_CN : COLOR_NONCN,
  }]);
  placeArrow(selectedSat, now);
}

function buildPastTrack(rec, now, pastMinutes) {
  const pastMs = pastMinutes * 60 * 1000;
  const pts = [];
  let prevLon = null;
  for (let i = 0; i <= TRACK_SAMPLES; i++) {
    const t = new Date(now.getTime() - pastMs + (i / TRACK_SAMPLES) * pastMs);
    const r = propagate(rec, t);
    if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    // Wrap longitudes so the polyline doesn't draw a chord across the dateline.
    let lon = r.lon;
    if (prevLon !== null && Math.abs(lon - prevLon) > 180) {
      lon += lon < prevLon ? 360 : -360;
    }
    prevLon = lon;
    pts.push([r.lat, lon, TRACK_ALT]);
  }
  return pts;
}

// Drop a cone at the sat's current sub-point, oriented so its tip
// points in the direction the sub-point is moving (sampled with a
// 60-second look-ahead).  Cone base is translated to local origin so
// the mesh anchors at the sub-point rather than at the cone's centre.
function placeArrow(sat, now) {
  removeArrow();
  const r1 = propagate(sat.rec, now);
  const r2 = propagate(sat.rec, new Date(now.getTime() + 60_000));
  if (!r1 || !r2 || !Number.isFinite(r1.lat) || !Number.isFinite(r2.lat)) return;
  const p1 = globe.getCoords(r1.lat, r1.lon, TRACK_ALT);
  const p2 = globe.getCoords(r2.lat, r2.lon, TRACK_ALT);

  const geo = new THREE.ConeGeometry(ARROW_RADIUS, ARROW_LENGTH, 10);
  // Default: tip at +Y·(h/2), base at -Y·(h/2).  Translate so base sits
  // at the local origin → mesh.position is the back of the arrow.
  geo.translate(0, ARROW_LENGTH / 2, 0);

  const mat = new THREE.MeshBasicMaterial({
    color: sat.cn ? COLOR_CN : COLOR_NONCN,
    depthWrite: false,
  });
  arrowMesh = new THREE.Mesh(geo, mat);
  arrowMesh.position.set(p1.x, p1.y, p1.z);

  // Orient local +Y to the velocity direction (p2 − p1) so the tip
  // points where the sat is going.
  const dir = new THREE.Vector3(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
  if (dir.lengthSq() > 0) {
    dir.normalize();
    arrowMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }
  arrowMesh.renderOrder = 5;   // sit on top of the dim sat dots
  globe.scene().add(arrowMesh);
}

function removeArrow() {
  if (!arrowMesh) return;
  globe.scene().remove(arrowMesh);
  arrowMesh.geometry.dispose();
  arrowMesh.material.dispose();
  arrowMesh = null;
}

// =========================================================================
// Clocks
// =========================================================================

function tickClocks() {
  const now = new Date();
  const fmtT = tz => now.toLocaleTimeString('en-GB', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: tz,
  });
  $('utc-time').textContent = fmtT('UTC');
  $('ist-time').textContent = fmtT('Asia/Kolkata');
  $('utc-date').textContent = now.toLocaleDateString('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC',
  }) + ' UTC';
}
tickClocks();
setInterval(tickClocks, 1000);

// =========================================================================
// Catalogue load
// =========================================================================

let activeTLEs = [];
const prcMeta = new Map();

async function loadAll() {
  setStatus('Fetching TLE catalog…');
  const [tleResult, satcat] = await Promise.all([fetchTLEs(), fetchChinaSatcat()]);
  activeTLEs = makeSatrecs(tleResult.tles);

  prcMeta.clear();
  for (const r of satcat) {
    const id = parseInt(r.NORAD_CAT_ID, 10);
    if (Number.isFinite(id)) prcMeta.set(id, { launch: r.LAUNCH_DATE || '—' });
  }

  const tag = tleResult.source === 'celestrak' ? 'live'
            : tleResult.source === 'cache'    ? 'cached'
            : 'bundled snapshot';
  setStatus(`Loaded ${activeTLEs.length.toLocaleString()} TLEs (${tag}) · ${prcMeta.size.toLocaleString()} CN payloads`);

  $('tracked-count').textContent = activeTLEs.length.toLocaleString();
  const asof = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });
  $('tracked-asof').textContent = `as of ${asof}`;
}

// =========================================================================
// Chunked update loop
// =========================================================================
//
// Propagate every active TLE for the current instant, but slice the
// work across requestAnimationFrame callbacks so no single frame eats
// the full ~150 ms budget.  This is the single biggest perf win on
// this page — pre-chunking the page used to stutter visibly on every
// 10 s tick.

let updateActive = false;
let updateIdx    = 0;
let updateNow    = null;
let updateNonCN  = [];
let updateCN     = [];
// Stable snapshot of the COMPLETE above-horizon set (non-CN + CN), taken
// at the end of each finished tick.  The "View all" pop-up reads this so
// it never catches updateNonCN/updateCN mid-rebuild.
let lastAboveHorizon = [];

function startUpdate() {
  if (!activeTLEs.length || updateActive) return;
  updateActive = true;
  updateNow    = new Date();
  updateIdx    = 0;
  updateNonCN  = [];
  updateCN     = [];
  processChunk();
}

// Spherical-Earth look angles from a city to a sub-point + altitude.
// Used only by the "All cities" observer mode, where re-running the
// full SGP4 + WGS84 pipeline once per city per sat (10 × 16 k) would
// blow the frame budget.  ENU construction: up = normalised ECEF of
// the city, east = ẑ × up, north = up × east.  Differences from the
// geodetic answer are < 0.2° — invisible at HUD precision.
function lookFromCity(satLat, satLon, satAltKm, city) {
  const D = Math.PI / 180;
  const sLat = satLat * D, sLon = satLon * D;
  const cLat = city.lat * D, cLon = city.lon * D;
  const rs = EARTH_R_KM + satAltKm;
  const rc = EARTH_R_KM + (city.alt || 0);
  const sx = rs * Math.cos(sLat) * Math.cos(sLon);
  const sy = rs * Math.cos(sLat) * Math.sin(sLon);
  const sz = rs * Math.sin(sLat);
  const cx = rc * Math.cos(cLat) * Math.cos(cLon);
  const cy = rc * Math.cos(cLat) * Math.sin(cLon);
  const cz = rc * Math.sin(cLat);
  const vx = sx - cx, vy = sy - cy, vz = sz - cz;
  const range = Math.hypot(vx, vy, vz);
  // Up / east / north unit vectors at the city.
  const um = Math.hypot(cx, cy, cz);
  const ux = cx / um, uy = cy / um, uz = cz / um;
  const em = Math.hypot(-uy, ux);              // east = ẑ × up
  const ex = -uy / em, ey = ux / em;           // ez = 0
  const nx = uy * 0 - uz * ey;                 // north = up × east
  const ny = uz * ex - ux * 0;
  const nz = ux * ey - uy * ex;
  const dU = vx * ux + vy * uy + vz * uz;
  const dE = vx * ex + vy * ey;
  const dN = vx * nx + vy * ny + vz * nz;
  return {
    el:    Math.asin(dU / range) / D,
    az:    ((Math.atan2(dE, dN) / D) + 360) % 360,
    range,
  };
}

function processChunk() {
  const end = Math.min(updateIdx + CHUNK_SIZE, activeTLEs.length);
  for (; updateIdx < end; updateIdx++) {
    const t = activeTLEs[updateIdx];
    const r = propagate(t.rec, updateNow, observerCity);
    if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;

    let az = r.az, el = r.el, range = r.range, via = null;
    if (observerMode === 'all') {
      // Union across every city: keep the sat if it clears the horizon
      // from ANY of the ten, and report the look angles from whichever
      // city sees it highest.
      let best = null;
      for (const c of CITIES) {
        const la = lookFromCity(r.lat, r.lon, r.alt, c);
        if (la.el > 0 && (!best || la.el > best.el)) { best = la; via = c.name; }
      }
      if (!best) continue;
      az = best.az; el = best.el; range = best.range;
    } else if (r.el <= 0) {
      continue;
    }

    const isCn = prcMeta.has(t.noradId);
    const item = {
      name: t.name, az, el, range,
      alt: r.alt, lat: r.lat, lon: r.lon, cn: isCn, via,
      rec: t.rec, noradId: t.noradId,
    };
    if (isCn) {
      item.purpose = inferPurpose(t.name);
      item.launch  = prcMeta.get(t.noradId)?.launch || '—';
      updateCN.push(item);
    } else {
      updateNonCN.push(item);
    }
  }
  if (updateIdx < activeTLEs.length) {
    // Visible tab → rAF for frame-paced chunking (smooth, no jank).
    // Hidden / minimised tab → rAF stalls indefinitely, so fall back
    // to a microtask-ish setTimeout so the pipeline still completes
    // (otherwise updateActive stays true forever and every subsequent
    // REFRESH_MS tick is dropped).
    if (document.hidden) setTimeout(processChunk, 0);
    else                 requestAnimationFrame(processChunk);
  } else {
    finishUpdate();
  }
}

// Rebuild the globe-marker set from the last propagation arrays,
// honouring the mask-non-Chinese toggle.  Called from finishUpdate
// and directly when the user flips the mask (instant feedback, no
// SGP4 re-run).
function rebuildMarkers() {
  const all = updateNonCN.concat(updateCN).sort((a, b) => b.el - a.el);
  const src = maskNonCN ? all.filter(s => s.cn) : all;
  currentMarkers = src.slice(0, MAX_MARKERS);
  rerenderMarkers();
}

function finishUpdate() {
  rebuildMarkers();
  // Slide the past-30-min window forward + reposition the arrow if a
  // sat is currently selected.  No-op otherwise.
  refreshSelectionVisuals();

  $('vis-count').textContent = updateNonCN.length;
  $('cn-count').textContent  = updateCN.length;

  // Snapshot the full above-horizon set and refresh the pop-up globe if
  // it's open (keeps it live on the 10 s tick).
  lastAboveHorizon = updateNonCN.concat(updateCN);
  refreshAllsats();

  // Only re-render the HUD lists if their <details> panel is open —
  // saves the innerHTML build cost when the user has collapsed them.
  if ($('vis-panel')?.open) {
    updateNonCN.sort((a, b) => b.el - a.el);
    $('vis-list').innerHTML = renderHorizonList(updateNonCN, HUD_LIST_MAX);
  }
  if ($('cn-panel')?.open) {
    updateCN.sort((a, b) => b.el - a.el);
    $('cn-list').innerHTML = renderCNHorizonList(updateCN);
  }

  updateActive = false;
}

// Row template for the non-CN horizon panel.
function renderHorizonList(items, limit) {
  if (!items.length) return '<div class="hint">No satellites above this horizon right now.</div>';
  return items.slice(0, limit).map(s => `
    <div class="item">
      <div class="name">${esc(s.name)}${s.cn ? ' <span class="tag cn">CN</span>' : ''}</div>
      <div class="meta">
        Az <strong>${s.az.toFixed(1)}°</strong> ${compass(s.az)}
        · El <strong>${s.el.toFixed(1)}°</strong>
        · ${s.range.toFixed(0)} km${s.via ? ` · via ${esc(s.via)}` : ''}
      </div>
      <div class="meta muted">Alt ${s.alt.toFixed(0)} km · sub-pt ${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°</div>
    </div>`).join('');
}

// CN-specific row template — adds purpose to the meta line.
function renderCNHorizonList(items) {
  if (!items.length) return '<div class="hint">No Chinese payloads currently above the horizon.</div>';
  return items.map(s => `
    <div class="item">
      <div class="name">${esc(s.name)} <span class="tag cn">CN</span></div>
      <div class="meta">
        Az <strong>${s.az.toFixed(1)}°</strong> ${compass(s.az)}
        · El <strong>${s.el.toFixed(1)}°</strong>
        · ${s.range.toFixed(0)} km${s.via ? ` · via ${esc(s.via)}` : ''}
      </div>
      <div class="meta muted">${esc(s.purpose)} · Alt ${s.alt.toFixed(0)} km · sub-pt ${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°</div>
    </div>`).join('');
}

// =========================================================================
// 2-D / 3-D view-mode toggle
// =========================================================================
// Replaces the old custom-location lookup panel.  2-D pins every
// marker just above the surface (the classic flat-tracker look);
// 3-D places markers at their real altitude (default).  The altitude
// accessor swap repositions existing markers immediately; marker
// radii (which scale with altitude in 3-D) refresh on the next
// propagation tick because each tick emits brand-new item objects.

(function setupViewMode() {
  const btn = $('viewmode-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    flatMode = !flatMode;
    $('viewmode-state').textContent = flatMode ? '2D' : '3D';
    globe.objectAltitude(flatMode ? 0.01 : (d => d.alt / EARTH_R_KM));
    rerenderMarkers();
  });
})();

// =========================================================================
// Observer-city selector
// =========================================================================
// Dropdown in the HUD that swaps which Indian city the over-horizon
// panels + globe markers are computed from.  Every ".obs-city-name"
// span in the HUD hints updates to match, and the camera swings over
// the new city so the view follows the data.

(function setupObserverCity() {
  const sel = $('observer-city');
  if (!sel) return;
  let lastCityValue = '0';   // where to snap back after a mask toggle

  function rebuildOptions() {
    const cityOpts = CITIES.map((c, i) => `<option value="${i}">${esc(c.name)}</option>`);
    cityOpts.push(`<option value="all">All cities</option>`);
    // The mask entry behaves as a toggle, not a destination — selecting
    // it flips the flag and the dropdown snaps back to the current
    // city.  Its label always shows the *current* state.
    cityOpts.push(`<option value="mask">Mask non-Chinese: ${maskNonCN ? 'ON' : 'OFF'}</option>`);
    sel.innerHTML = cityOpts.join('');
  }
  rebuildOptions();

  sel.addEventListener('change', () => {
    const v = sel.value;

    if (v === 'mask') {
      maskNonCN = !maskNonCN;
      rebuildOptions();
      sel.value = lastCityValue;   // dropdown keeps showing the observer
      rebuildMarkers();            // instant — reuses last propagation
      return;
    }

    lastCityValue = v;
    if (v === 'all') {
      observerMode = 'all';
      document.querySelectorAll('.obs-city-name').forEach(el => {
        el.textContent = `all ${CITIES.length} cities`;
      });
      // Frame the whole subcontinent — the union footprint spans
      // Jaisalmer to Kohima.
      globe.pointOfView({ lat: 23, lng: 82, altitude: 2.6 }, 1200);
    } else {
      observerMode = 'single';
      observerCity = CITIES[parseInt(v, 10)] || CITIES[0];
      document.querySelectorAll('.obs-city-name').forEach(el => {
        el.textContent = observerCity.name;
      });
      globe.pointOfView({ lat: observerCity.lat, lng: observerCity.lon, altitude: 2.4 }, 1200);
    }
    // Recompute the over-horizon sets right away rather than waiting
    // out the 10-s tick.  If a tick is already mid-flight this is a
    // no-op and the next scheduled tick picks up the new observer.
    startUpdate();
  });
})();

// =========================================================================
// Boot
// =========================================================================

(async function main() {
  $('vis-count').textContent = '…';
  $('cn-count').textContent  = '…';
  try {
    await loadAll();
    startUpdate();
    setInterval(startUpdate, REFRESH_MS);
    setInterval(() => {
      loadAll().then(startUpdate).catch(e => {
        console.warn('TLE refresh failed:', e);
        setStatus(`Refresh failed: ${e.message} · using cached catalog`, 'warn');
      });
    }, RELOAD_TLE_MS);
  } catch (e) {
    console.error(e);
    setStatus(`Load failed: ${e.message}`, 'err');
    $('vis-count').textContent = '!';
    $('cn-count').textContent  = '!';
  }
})();

// =========================================================================
// "View all satellites" pop-up globe
// =========================================================================
//
// The main globe deliberately plots only the top-MAX_MARKERS sats for
// clarity, so it never matches the over-horizon counts.  This pop-up is
// an INDEPENDENT globe.gl instance that plots EVERY satellite above the
// horizon (the full `lastAboveHorizon` snapshot) as a single
// THREE.InstancedMesh — thousands of dots for one draw call.  Built
// lazily on first open, refreshed each tick while open, and the main
// globe is never touched.

const ALLSATS_MAX = 12000;          // headroom over the above-horizon set
let allsatsGlobe  = null;           // lazy Globe() instance
let allsatsInst   = null;           // THREE.InstancedMesh
let allsatsOpen   = false;
let allsatsAltScale = 1.0;          // altitude-scale slider (× true altitude)
let allsatsDotScale = 1.0;          // dot-size slider (× base sphere scale)
let allsatsRendered = [];           // parallel to active instances: {name, alt, cn, x, y, z}
let allsatsHoverIdx = -1;
const ALLSATS_PICK_PX = 12;         // cursor hover tolerance in screen pixels

const _asPos      = new THREE.Vector3();
const _asQuat     = new THREE.Quaternion();
const _asScale    = new THREE.Vector3();
const _asMat      = new THREE.Matrix4();
const _asHide     = new THREE.Matrix4().makeScale(0, 0, 0);
const _asPick     = new THREE.Vector3();
const _asColorCN  = new THREE.Color(COLOR_CN);
const _asColorNCN = new THREE.Color(COLOR_NONCN);

function ensureAllsatsGlobe() {
  if (allsatsGlobe) return;
  const el = $('allsats-globe');
  allsatsGlobe = Globe()(el)
    .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
    .bumpImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png')
    .backgroundImageUrl(NIGHT_SKY_URL)
    .showAtmosphere(true)
    .atmosphereColor('#4ea8ff')
    .atmosphereAltitude(0.18)
    .pointOfView({ lat: observerCity.lat, lng: observerCity.lon, altitude: 2.6 }, 0);

  const c = allsatsGlobe.controls();
  c.enableDamping = true; c.dampingFactor = 0.1;
  c.rotateSpeed = 0.5;   c.zoomSpeed = 0.8;
  c.minDistance = 110;   c.maxDistance = 2200;

  const geom = new THREE.SphereGeometry(1.3, 8, 8);
  const mat  = new THREE.MeshBasicMaterial({ color: 0xffffff });
  allsatsInst = new THREE.InstancedMesh(geom, mat, ALLSATS_MAX);
  allsatsInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  allsatsInst.frustumCulled = false;
  allsatsInst.count = 0;
  allsatsGlobe.scene().add(allsatsInst);
}

function sizeAllsatsGlobe() {
  if (!allsatsGlobe) return;
  const el = $('allsats-globe');
  const w = el.clientWidth, h = el.clientHeight;
  if (w > 0 && h > 0) allsatsGlobe.width(w).height(h);
}

// Repaint the InstancedMesh from the current above-horizon snapshot and
// update the header meta line.
function renderAllsatsInstances() {
  if (!allsatsInst) return;
  const sats = lastAboveHorizon;
  const n = Math.min(sats.length, ALLSATS_MAX);
  allsatsRendered.length = 0;
  for (let i = 0; i < n; i++) {
    const s = sats[i];
    // Altitude-scale slider stretches/compresses the radial spread without
    // touching the angular sub-point position.
    const p = allsatsGlobe.getCoords(s.lat, s.lon, (s.alt / EARTH_R_KM) * allsatsAltScale);
    _asPos.set(p.x, p.y, p.z);
    // Base scale bumps gently with altitude so distant GEO dots stay
    // visible; the dot-size slider then scales the whole set.
    _asScale.setScalar((1 + Math.min(1.4, s.alt / 30000)) * allsatsDotScale);
    _asMat.compose(_asPos, _asQuat, _asScale);
    allsatsInst.setMatrixAt(i, _asMat);
    allsatsInst.setColorAt(i, s.cn ? _asColorCN : _asColorNCN);
    // Cache scene position for the screen-space hover picker.
    allsatsRendered.push({ name: s.name, alt: s.alt, cn: s.cn, x: p.x, y: p.y, z: p.z });
  }
  allsatsInst.count = n;
  allsatsInst.instanceMatrix.needsUpdate = true;
  if (allsatsInst.instanceColor) allsatsInst.instanceColor.needsUpdate = true;

  const meta = $('allsats-meta');
  if (meta) {
    const cn  = sats.reduce((a, s) => a + (s.cn ? 1 : 0), 0);
    const ncn = sats.length - cn;
    const where = observerMode === 'all' ? `all ${CITIES.length} cities` : observerCity.name;
    const t = (updateNow || new Date()).toISOString().slice(11, 19);
    meta.innerHTML =
      `<strong>${sats.length.toLocaleString()}</strong> satellites above the horizon from ${esc(where)} · `
      + `${ncn.toLocaleString()} non-Chinese · ${cn.toLocaleString()} Chinese · updated ${t} UTC`;
  }
}

function openAllsats() {
  const modal = $('allsats-modal');
  if (!modal) return;
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  allsatsOpen = true;
  ensureAllsatsGlobe();
  // Reading clientWidth (inside sizeAllsatsGlobe) forces a synchronous
  // reflow, so the now-visible modal reports a real size immediately —
  // no dependence on requestAnimationFrame, which is paused when the tab
  // is hidden.
  sizeAllsatsGlobe();
  renderAllsatsInstances();
}

function closeAllsats() {
  const modal = $('allsats-modal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  allsatsOpen = false;
  hideAllsatsTip();
}

// Called from finishUpdate() — keep the pop-up live on each 10 s tick.
function refreshAllsats() {
  if (allsatsOpen && allsatsInst) renderAllsatsInstances();
}

// --- Hover tooltip on the pop-up globe -----------------------------------
// Screen-space pick: project every rendered sat's cached scene position to
// pixels and take the nearest within ALLSATS_PICK_PX of the cursor, skipping
// any dot occluded behind the globe.  Mirrors viz3d.js's picker.
function pickAllsat(ev) {
  const el = $('allsats-globe');
  if (!el || !allsatsGlobe || !allsatsRendered.length) return -1;
  const rect = el.getBoundingClientRect();
  const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
  const cam = allsatsGlobe.camera();
  // Make sure the camera's world / inverse matrices are current before we
  // project — don't rely on a render having just run (it's paused when the
  // tab is hidden, and can lag a hover between frames).
  cam.updateMatrixWorld();
  const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
  let best = -1, bestD2 = ALLSATS_PICK_PX * ALLSATS_PICK_PX;
  for (let i = 0; i < allsatsRendered.length; i++) {
    const s = allsatsRendered[i];
    _asPick.set(s.x, s.y, s.z).project(cam);
    if (_asPick.z > 1 || _asPick.z < -1) continue;   // behind camera / clipped
    const sx = (_asPick.x *  0.5 + 0.5) * rect.width;
    const sy = (_asPick.y * -0.5 + 0.5) * rect.height;
    const dx = sx - mx, dy = sy - my, d2 = dx * dx + dy * dy;
    if (d2 >= bestD2) continue;
    // Occlusion: closest approach of the camera→sat segment to the origin
    // must clear the globe radius (100, with a unit of grace).
    const vx = s.x - cx, vy = s.y - cy, vz = s.z - cz;
    const L2 = vx * vx + vy * vy + vz * vz;
    const t = -(cx * vx + cy * vy + cz * vz) / L2;
    if (t > 0 && t < 1) {
      const px = cx + vx * t, py = cy + vy * t, pz = cz + vz * t;
      if (px * px + py * py + pz * pz < 99 * 99) continue;
    }
    bestD2 = d2; best = i;
  }
  return best;
}

function showAllsatsTip(i, ev) {
  const s = allsatsRendered[i];
  const tip = $('allsats-tip');
  if (!s || !tip) return;
  tip.innerHTML = `<b>${esc(s.name)}</b><div>Altitude <strong>${s.alt.toFixed(0)} km</strong>`
    + `${s.cn ? ' · <span style="color:#ff6b6b">Chinese payload</span>' : ''}</div>`;
  tip.hidden = false;
  const w = tip.offsetWidth || 190, h = tip.offsetHeight || 48;
  let x = ev.clientX + 16, y = ev.clientY + 16;
  if (x + w > window.innerWidth)  x = ev.clientX - w - 12;
  if (y + h > window.innerHeight) y = ev.clientY - h - 12;
  tip.style.left = x + 'px';
  tip.style.top  = y + 'px';
}

function hideAllsatsTip() {
  allsatsHoverIdx = -1;
  const tip = $('allsats-tip');
  if (tip) tip.hidden = true;
}

function onAllsatsMove(ev) {
  if (!allsatsOpen) return;
  const i = pickAllsat(ev);
  if (i !== -1) { allsatsHoverIdx = i; showAllsatsTip(i, ev); }
  else if (allsatsHoverIdx !== -1) hideAllsatsTip();
}

(function setupAllsats() {
  const btn = $('allsats-btn');
  if (!btn) return;
  btn.addEventListener('click', openAllsats);
  $('allsats-close')?.addEventListener('click', closeAllsats);
  // Click the dimmed backdrop (anywhere outside the card) → close.
  $('allsats-modal')?.addEventListener('click', e => {
    if (e.target.id === 'allsats-modal') closeAllsats();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && allsatsOpen) closeAllsats();
  });
  window.addEventListener('resize', () => { if (allsatsOpen) sizeAllsatsGlobe(); });

  // Dot-size + altitude-scale sliders — repaint the instances live.
  $('allsats-dot-size')?.addEventListener('input', e => {
    allsatsDotScale = parseFloat(e.target.value) || 1;
    $('allsats-dot-val').textContent = allsatsDotScale.toFixed(1);
    if (allsatsOpen) renderAllsatsInstances();
  });
  $('allsats-alt-scale')?.addEventListener('input', e => {
    allsatsAltScale = parseFloat(e.target.value) || 1;
    $('allsats-alt-val').textContent = allsatsAltScale.toFixed(1);
    if (allsatsOpen) renderAllsatsInstances();
  });

  // Hover tooltip (name + altitude).  Listeners on the globe container —
  // the canvas fills it, so mousemove bubbles up and the container's rect
  // matches the canvas.
  const gEl = $('allsats-globe');
  gEl?.addEventListener('mousemove', onAllsatsMove);
  gEl?.addEventListener('mouseleave', hideAllsatsTip);
})();
