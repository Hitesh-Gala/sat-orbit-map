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
  { name: 'New Delhi', lat: 28.6139, lon: 77.2090, alt: 0.216 },
  { name: 'Mumbai',    lat: 19.0760, lon: 72.8777, alt: 0.014 },
  { name: 'Bangalore', lat: 12.9716, lon: 77.5946, alt: 0.920 },
  { name: 'Chennai',   lat: 13.0827, lon: 80.2707, alt: 0.006 },
  { name: 'Srinagar',  lat: 34.0837, lon: 74.7973, alt: 1.585 },
  { name: 'Guwahati',  lat: 26.1445, lon: 91.7362, alt: 0.055 },
];
let observerCity = CITIES[0];

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
    const radius = 0.6 + Math.min(1.4, d.alt / 30000);
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
// Theme toggle (light / dark)
// =========================================================================
//
// The WebGL globe doesn't read CSS variables.  We instead swap the
// background skybox between the night-sky texture and a pixel-inverted
// "day-sky" version (memoised after first generation).

let invertedSkyDataUrl = null;
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('image load failed: ' + url));
    i.src = url;
  });
}
async function getInvertedSkyUrl() {
  if (invertedSkyDataUrl) return invertedSkyDataUrl;
  const img = await loadImage(NIGHT_SKY_URL);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < id.data.length; i += 4) {
    id.data[i]     = 255 - id.data[i];
    id.data[i + 1] = 255 - id.data[i + 1];
    id.data[i + 2] = 255 - id.data[i + 2];
  }
  ctx.putImageData(id, 0, 0);
  invertedSkyDataUrl = c.toDataURL('image/png');
  return invertedSkyDataUrl;
}

(function setupTheme() {
  const KEY = 'argos.main.theme';
  const btn = $('theme-toggle');
  if (!btn) return;
  async function apply(mode) {
    document.body.classList.toggle('light', mode === 'light');
    btn.textContent = mode === 'light' ? '☾ Dark' : '☀ Light';
    try {
      if (mode === 'light') {
        globe.backgroundImageUrl(await getInvertedSkyUrl());
        globe.atmosphereColor('#7a8aa0');
      } else {
        globe.backgroundImageUrl(NIGHT_SKY_URL);
        globe.atmosphereColor('#4ea8ff');
      }
    } catch (e) { console.warn('Theme skybox swap failed:', e.message); }
  }
  apply(localStorage.getItem(KEY) || 'dark');
  btn.addEventListener('click', () => {
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    localStorage.setItem(KEY, next);
    apply(next);
  });
})();

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

function startUpdate() {
  if (!activeTLEs.length || updateActive) return;
  updateActive = true;
  updateNow    = new Date();
  updateIdx    = 0;
  updateNonCN  = [];
  updateCN     = [];
  processChunk();
}

function processChunk() {
  const end = Math.min(updateIdx + CHUNK_SIZE, activeTLEs.length);
  for (; updateIdx < end; updateIdx++) {
    const t = activeTLEs[updateIdx];
    const r = propagate(t.rec, updateNow, observerCity);
    if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon) || r.el <= 0) continue;
    const isCn = prcMeta.has(t.noradId);
    const item = {
      name: t.name, az: r.az, el: r.el, range: r.range,
      alt: r.alt, lat: r.lat, lon: r.lon, cn: isCn,
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

function finishUpdate() {
  // Globe markers: top-N by elevation.  One shared sort serves both
  // the marker selection and the per-list ordering.
  const all = updateNonCN.concat(updateCN).sort((a, b) => b.el - a.el);
  currentMarkers = all.slice(0, MAX_MARKERS);
  rerenderMarkers();
  // Slide the past-30-min window forward + reposition the arrow if a
  // sat is currently selected.  No-op otherwise.
  refreshSelectionVisuals();

  $('vis-count').textContent = updateNonCN.length;
  $('cn-count').textContent  = updateCN.length;

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
  if ($('lookup-panel')?.open) runLookup();

  updateActive = false;
}

// Shared row template — used by the non-CN horizon panel and the
// custom-location lookup.
function renderHorizonList(items, limit) {
  if (!items.length) return '<div class="hint">No satellites above this horizon right now.</div>';
  return items.slice(0, limit).map(s => `
    <div class="item">
      <div class="name">${esc(s.name)}${s.cn ? ' <span class="tag cn">CN</span>' : ''}</div>
      <div class="meta">
        Az <strong>${s.az.toFixed(1)}°</strong> ${compass(s.az)}
        · El <strong>${s.el.toFixed(1)}°</strong>
        · ${s.range.toFixed(0)} km
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
        · ${s.range.toFixed(0)} km
      </div>
      <div class="meta muted">${esc(s.purpose)} · Alt ${s.alt.toFixed(0)} km · sub-pt ${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°</div>
    </div>`).join('');
}

// =========================================================================
// Custom-location observer lookup
// =========================================================================

function runLookup() {
  if (!activeTLEs.length) return;
  const latEl = $('lookup-lat');
  const lonEl = $('lookup-lon');
  const lat = parseFloat(latEl.value);
  const lon = parseFloat(lonEl.value);
  const countEl = $('lookup-count');
  const listEl  = $('lookup-list');
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    countEl.textContent = '!';
    listEl.innerHTML = '<div class="hint">Enter latitude in −90…90 and longitude in −180…180.</div>';
    return;
  }
  const observer = { lat, lon, alt: 0 };
  const now = new Date();
  const above = [];
  for (const t of activeTLEs) {
    const r = propagate(t.rec, now, observer);
    if (!r || !Number.isFinite(r.el) || r.el <= 0) continue;
    above.push({
      name: t.name, az: r.az, el: r.el, range: r.range, alt: r.alt,
      lat: r.lat, lon: r.lon, cn: prcMeta.has(t.noradId),
    });
  }
  above.sort((a, b) => b.el - a.el);
  countEl.textContent = above.length;
  listEl.innerHTML = renderHorizonList(above, HUD_LIST_MAX);
}

(function setupLookup() {
  const btn = $('lookup-btn');
  const lat = $('lookup-lat');
  const lon = $('lookup-lon');
  const panel = $('lookup-panel');
  if (!btn || !lat || !lon || !panel) return;
  let timer = null;
  const debounced = () => { clearTimeout(timer); timer = setTimeout(runLookup, 250); };
  btn.addEventListener('click', runLookup);
  lat.addEventListener('input', debounced);
  lon.addEventListener('input', debounced);
  panel.addEventListener('toggle', () => { if (panel.open) runLookup(); });
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
  sel.innerHTML = CITIES.map((c, i) => `<option value="${i}">${esc(c.name)}</option>`).join('');
  sel.addEventListener('change', () => {
    observerCity = CITIES[parseInt(sel.value, 10)] || CITIES[0];
    document.querySelectorAll('.obs-city-name').forEach(el => {
      el.textContent = observerCity.name;
    });
    globe.pointOfView({ lat: observerCity.lat, lng: observerCity.lon, altitude: 2.4 }, 1200);
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
