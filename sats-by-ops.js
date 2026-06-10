// Sats by Operator — same InstancedMesh engine as viz3d, but every sat
// is coloured by which named operator / constellation / mission family
// its TLE name matches.  Users toggle individual categories on / off
// from the left-panel checklist.

const { fetchTLEs, makeSatrecs, propagate, EARTH_R_KM } = window.Argos;

const $ = id => document.getElementById(id);
const REFRESH_MS    = 4000;
const CHUNK_SIZE    = 1500;
const MAX_INSTANCES = 22_000;
const SAT_RADIUS    = 1.6;        // matches viz3d's hover-friendly default

// =========================================================================
// Categories
//
// Order matters: the first .test() that matches wins, so put the more
// specific patterns (constellation names) before the broad ones (catch-
// alls).  Colours chosen to be distinct against the night-sky background
// and to roughly cluster by tier (greens for major LEO comms, blues for
// GNSS, reds for ISR, yellows for met).
// =========================================================================

const CATEGORIES = [
  // ----- GNSS constellations ---------------------------------------------
  { id: 'gnss-gps',     tier: 'GNSS',           label: 'GPS / NAVSTAR',           color: '#4a90e2', test: n => /^(NAVSTAR|GPS\s|GPS-)/i.test(n) },
  { id: 'gnss-glonass', tier: 'GNSS',           label: 'GLONASS',                 color: '#9b59b6', test: n => /^GLONASS\b/i.test(n) },
  { id: 'gnss-galileo', tier: 'GNSS',           label: 'Galileo',                 color: '#5fc7e6', test: n => /^GALILEO\b/i.test(n) },
  { id: 'gnss-beidou',  tier: 'GNSS',           label: 'BeiDou',                  color: '#e74c3c', test: n => /^BEIDOU\b/i.test(n) },
  { id: 'gnss-qzss',    tier: 'GNSS',           label: 'QZSS (Japan)',            color: '#e67e22', test: n => /^QZS-/i.test(n) || /^QZSS\b/i.test(n) },
  { id: 'gnss-navic',   tier: 'GNSS',           label: 'NAVIC / IRNSS (India)',   color: '#27ae60', test: n => /^(IRNSS|NVS-)/i.test(n) },

  // ----- Mega-constellations / LEO comms ---------------------------------
  { id: 'op-starlink',  tier: 'Constellations', label: 'Starlink (SpaceX)',       color: '#67e8a4', test: n => /^STARLINK/i.test(n) },
  { id: 'op-oneweb',    tier: 'Constellations', label: 'OneWeb',                  color: '#67c8ff', test: n => /^ONEWEB/i.test(n) },
  { id: 'op-kuiper',    tier: 'Constellations', label: 'Kuiper (Amazon)',         color: '#f39c12', test: n => /^KUIPER/i.test(n) },
  { id: 'op-iridium',   tier: 'Constellations', label: 'Iridium',                 color: '#bdc3c7', test: n => /^IRIDIUM/i.test(n) },
  { id: 'op-globalstar',tier: 'Constellations', label: 'Globalstar',              color: '#7f8c8d', test: n => /^GLOBALSTAR/i.test(n) },
  { id: 'op-orbcomm',   tier: 'Constellations', label: 'Orbcomm',                 color: '#aab2bd', test: n => /^ORBCOMM/i.test(n) },
  { id: 'op-guowang',   tier: 'Constellations', label: 'Guowang (China)',         color: '#ff7f50', test: n => /^GUOWANG/i.test(n) },
  { id: 'op-qianfan',   tier: 'Constellations', label: 'Qianfan / G60 (China)',   color: '#ffa07a', test: n => /^(QIANFAN|G60)/i.test(n) },

  // ----- Earth observation companies -------------------------------------
  { id: 'eo-planet',    tier: 'Earth Obs',      label: 'Planet (Flock / SkySat)', color: '#16a085', test: n => /^(FLOCK|SKYSAT)/i.test(n) },
  { id: 'eo-spire',     tier: 'Earth Obs',      label: 'Spire (LEMUR)',           color: '#1abc9c', test: n => /^LEMUR/i.test(n) },
  { id: 'eo-maxar',     tier: 'Earth Obs',      label: 'Maxar (WorldView/GeoEye)',color: '#3498db', test: n => /^(WORLDVIEW|GEOEYE|MAXAR|QUICKBIRD)/i.test(n) },
  { id: 'eo-blacksky',  tier: 'Earth Obs',      label: 'BlackSky',                color: '#5b6dcd', test: n => /^BLACKSKY/i.test(n) },
  { id: 'eo-capella',   tier: 'Earth Obs',      label: 'Capella (SAR)',           color: '#8e44ad', test: n => /^CAPELLA/i.test(n) },
  { id: 'eo-iceye',     tier: 'Earth Obs',      label: 'ICEYE (SAR)',             color: '#2980b9', test: n => /^ICEYE/i.test(n) },

  // ----- Communications (mostly GEO) -------------------------------------
  { id: 'com-inmarsat', tier: 'Communications', label: 'Inmarsat',                color: '#d35400', test: n => /^INMARSAT/i.test(n) },
  { id: 'com-intelsat', tier: 'Communications', label: 'Intelsat',                color: '#c0392b', test: n => /^INTELSAT/i.test(n) },
  { id: 'com-eutelsat', tier: 'Communications', label: 'Eutelsat',                color: '#e74c3c', test: n => /^EUTELSAT/i.test(n) },
  { id: 'com-ses',      tier: 'Communications', label: 'SES / Astra',             color: '#f1c40f', test: n => /^(SES[- ]|ASTRA)/i.test(n) },
  { id: 'com-chinasat', tier: 'Communications', label: 'ChinaSat / Zhongxing',    color: '#c39bd3', test: n => /^(CHINASAT|ZHONGXING|ZX[- ])/i.test(n) },
  { id: 'com-apstar',   tier: 'Communications', label: 'APSTAR / AsiaSat',        color: '#d2b4de', test: n => /^(APSTAR|ASIASAT)/i.test(n) },

  // ----- Meteorology -----------------------------------------------------
  { id: 'met-noaa',     tier: 'Meteorology',    label: 'NOAA / GOES (USA)',       color: '#5dade2', test: n => /^(NOAA\s|GOES)/i.test(n) },
  { id: 'met-meteosat', tier: 'Meteorology',    label: 'METEOSAT / METOP (EU)',   color: '#48c9b0', test: n => /^(METEOSAT|METOP)/i.test(n) },
  { id: 'met-fengyun',  tier: 'Meteorology',    label: 'FengYun (China)',         color: '#ec7063', test: n => /^(FENGYUN|FY[- ])/i.test(n) },
  { id: 'met-himawari', tier: 'Meteorology',    label: 'Himawari (Japan)',        color: '#f5b041', test: n => /^HIMAWARI/i.test(n) },
  { id: 'met-insat',    tier: 'Meteorology',    label: 'INSAT / KALPANA (India)', color: '#52be80', test: n => /^(INSAT|KALPANA)/i.test(n) },

  // ----- Publicly attributed ISR -----------------------------------------
  { id: 'isr-yaogan',   tier: 'ISR',            label: 'Yaogan (China)',          color: '#ff6b6b', test: n => /^YAOGAN/i.test(n) },
  { id: 'isr-gaofen',   tier: 'ISR',            label: 'Gaofen (China)',          color: '#ff8c52', test: n => /^GAOFEN/i.test(n) },
  { id: 'isr-jilin',    tier: 'ISR',            label: 'Jilin (China)',           color: '#ffaa6b', test: n => /^JILIN/i.test(n) },
  { id: 'isr-usa',      tier: 'ISR',            label: 'USA-series (US classified)', color: '#bd1a1a', test: n => /^USA\s*\d/i.test(n) },
  { id: 'isr-cosmos',   tier: 'ISR',            label: 'Cosmos (Russia)',         color: '#76448a', test: n => /^COSMOS\s*\d/i.test(n) },

  // ----- Catch-all -------------------------------------------------------
  // Default OFF so the ~10 k uncategorised dots don't drown out the
  // labelled categories on first paint.
  { id: 'other',        tier: 'Other',          label: 'Other / uncategorised',   color: '#7d8a99', defaultOff: true, test: () => true },
];

function categorize(name) {
  for (let i = 0; i < CATEGORIES.length; i++) {
    if (CATEGORIES[i].test(name)) return i;
  }
  return CATEGORIES.length - 1;
}

// Pre-build THREE.Color objects so we don't re-allocate per instance per tick.
const CAT_COLOR = CATEGORIES.map(c => new THREE.Color(c.color));

// =========================================================================
// Status helpers
// =========================================================================

function setStatus(msg, isErr) {
  $('sbo-status').textContent = msg;
  $('sbo-status').style.color = isErr ? 'var(--accent2)' : '';
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// =========================================================================
// Globe (same chrome as viz3d)
// =========================================================================

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
controls.maxDistance   = 2200;
controls.autoRotate       = true;
controls.autoRotateSpeed  = 0.18;
const stopAutoRotate = () => { controls.autoRotate = false; };
document.getElementById('globe').addEventListener('pointerdown', stopAutoRotate, { once: true });
document.getElementById('globe').addEventListener('wheel',       stopAutoRotate, { once: true });

window.addEventListener('resize', () => {
  globe.width(window.innerWidth).height(window.innerHeight);
});

// =========================================================================
// Instanced mesh (one draw call for ~22 k sphere instances)
// =========================================================================

const SAT_GEOM = new THREE.SphereGeometry(SAT_RADIUS, 8, 8);
const SAT_MAT  = new THREE.MeshBasicMaterial({ color: 0xffffff });
const instMesh = new THREE.InstancedMesh(SAT_GEOM, SAT_MAT, MAX_INSTANCES);
instMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
instMesh.frustumCulled = false;
const HIDE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
for (let i = 0; i < MAX_INSTANCES; i++) instMesh.setMatrixAt(i, HIDE_MATRIX);
instMesh.instanceMatrix.needsUpdate = true;
globe.scene().add(instMesh);

// =========================================================================
// App state
// =========================================================================

let allSats   = [];
let satCat    = [];            // category index per sat (computed once at boot)
let satState  = [];            // latest { lat, lon, alt } per sat
let satPeriod = [];            // orbital period in minutes per sat
let propagationActive = false;

// Per-category on/off toggles, default ON unless `defaultOff` in the def.
const categoryEnabled = CATEGORIES.map(c => !c.defaultOff);
// Per-category live count, refreshed each propagation tick.
const categoryCount = CATEGORIES.map(() => 0);

const _pos   = new THREE.Vector3();
const _quat  = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _mat   = new THREE.Matrix4();

// =========================================================================
// Category panel — built once after categorisation is known
// =========================================================================

function buildCategoryPanel() {
  const container = $('sbo-categories');
  const html = [];
  let lastTier = null;
  for (let i = 0; i < CATEGORIES.length; i++) {
    const c = CATEGORIES[i];
    if (c.tier !== lastTier) {
      html.push(`<div class="sbo-tier">${escHtml(c.tier)}</div>`);
      lastTier = c.tier;
    }
    html.push(`
      <label class="sbo-row" data-idx="${i}">
        <input type="checkbox" ${categoryEnabled[i] ? 'checked' : ''}>
        <span class="swatch" style="background:${c.color};color:${c.color}"></span>
        <span class="lbl">${escHtml(c.label)}</span>
        <span class="cnt" id="sbo-cnt-${i}">…</span>
      </label>
    `);
  }
  container.innerHTML = html.join('');
  container.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const row = cb.closest('.sbo-row');
      const idx = parseInt(row.dataset.idx, 10);
      categoryEnabled[idx] = cb.checked;
      rerenderFiltered();
    });
  });
  $('sbo-all').addEventListener('click', () => {
    container.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = true; });
    for (let i = 0; i < categoryEnabled.length; i++) categoryEnabled[i] = true;
    rerenderFiltered();
  });
  $('sbo-none').addEventListener('click', () => {
    container.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = false; });
    for (let i = 0; i < categoryEnabled.length; i++) categoryEnabled[i] = false;
    rerenderFiltered();
  });
}

function updateCategoryCounts() {
  for (let i = 0; i < CATEGORIES.length; i++) {
    const el = $('sbo-cnt-' + i);
    if (!el) continue;
    el.textContent = categoryCount[i].toLocaleString();
    el.closest('.sbo-row').classList.toggle('zero', categoryCount[i] === 0);
  }
}

// =========================================================================
// Chunked SGP4 propagation (same pattern as viz3d)
// =========================================================================

let chunkIdx = 0;
let propNow  = new Date();

function startPropagationTick() {
  if (propagationActive) return;
  propagationActive = true;
  propNow  = new Date();
  chunkIdx = 0;
  for (let i = 0; i < categoryCount.length; i++) categoryCount[i] = 0;
  processChunk();
}

function processChunk() {
  const end = Math.min(chunkIdx + CHUNK_SIZE, allSats.length);
  for (let i = chunkIdx; i < end; i++) {
    const t = allSats[i];
    const r = propagate(t.rec, propNow);
    if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon) || !Number.isFinite(r.alt) || r.alt < 0) {
      instMesh.setMatrixAt(i, HIDE_MATRIX);
      satState[i] = null;
      continue;
    }
    satState[i] = { lat: r.lat, lon: r.lon, alt: r.alt };
    const cat = satCat[i];
    categoryCount[cat]++;
    if (!categoryEnabled[cat]) {
      instMesh.setMatrixAt(i, HIDE_MATRIX);
      continue;
    }
    const altFrac = r.alt / EARTH_R_KM;
    const p = globe.getCoords(r.lat, r.lon, altFrac);
    _pos.set(p.x, p.y, p.z);
    _scale.setScalar(1);
    _mat.compose(_pos, _quat, _scale);
    instMesh.setMatrixAt(i, _mat);
    instMesh.setColorAt(i, CAT_COLOR[cat]);
  }
  chunkIdx = end;
  if (chunkIdx < allSats.length) {
    // rAF stalls in hidden tabs; fall back to setTimeout(0) there.
    if (document.hidden) setTimeout(processChunk, 0);
    else                 requestAnimationFrame(processChunk);
    return;
  }
  instMesh.instanceMatrix.needsUpdate = true;
  if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
  updateCategoryCounts();
  const total = categoryCount.reduce((a, b) => a + b, 0);
  setStatus(`${total.toLocaleString()} sats categorised · refreshed ${propNow.toISOString().slice(11, 19)} UTC`);
  propagationActive = false;
  if (hoverId !== -1 && satState[hoverId]) renderTooltip(hoverId);
}

// Cheap second-pass: visibility toggle without re-running SGP4.  Uses
// each instance's last-known position from the matrix buffer, just
// rewrites the scale-to-zero / restore decision per the new filter.
function rerenderFiltered() {
  for (let i = 0; i < allSats.length; i++) {
    const st = satState[i];
    const cat = satCat[i];
    if (!st || !categoryEnabled[cat]) {
      instMesh.setMatrixAt(i, HIDE_MATRIX);
      continue;
    }
    const altFrac = st.alt / EARTH_R_KM;
    const p = globe.getCoords(st.lat, st.lon, altFrac);
    _pos.set(p.x, p.y, p.z);
    _scale.setScalar(1);
    _mat.compose(_pos, _quat, _scale);
    instMesh.setMatrixAt(i, _mat);
    instMesh.setColorAt(i, CAT_COLOR[cat]);
  }
  instMesh.instanceMatrix.needsUpdate = true;
  if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
}

// =========================================================================
// Boot
// =========================================================================

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
  // One-time pass: categorise every sat by its TLE name and cache its
  // period.  Neither value changes between propagation ticks.
  satCat    = new Array(allSats.length);
  satState  = new Array(allSats.length).fill(null);
  satPeriod = new Array(allSats.length);
  for (let i = 0; i < allSats.length; i++) {
    satCat[i] = categorize(allSats[i].name);
    const rec = allSats[i].rec;
    const no = (rec && (rec.no_kozai ?? rec.no));
    satPeriod[i] = (Number.isFinite(no) && no > 0) ? (2 * Math.PI) / no : null;
  }
  buildCategoryPanel();

  const tag = tleResult.source === 'celestrak' ? 'live'
            : tleResult.source === 'cache'    ? 'cached'
            : 'bundled snapshot';
  setStatus(`Catalogue: ${allSats.length.toLocaleString()} sats (${tag}). Propagating…`);
  startPropagationTick();
  setInterval(startPropagationTick, REFRESH_MS);
}

boot();

// =========================================================================
// Hover tooltip — name, altitude, period, category badge
// =========================================================================

const tip = $('sat-tip');
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hoverId = -1;
let pendingMouse = null;
let rafQueued = false;

function renderTooltip(id) {
  const t  = allSats[id];
  const st = satState[id];
  if (!t || !st) return;
  const cat = CATEGORIES[satCat[id]];
  const period = satPeriod[id];
  const periodStr = period
    ? `${period.toFixed(1)} min <span class="muted">(${(period / 60).toFixed(2)} h)</span>`
    : '<span class="muted">unknown</span>';
  // Inline category badge in the cat's own colour — matches the sphere.
  const badge = `<span class="cls" style="background:rgba(255,255,255,0.06);color:${cat.color}">${escHtml(cat.label)}</span>`;
  tip.innerHTML = `
    <b>${escHtml(t.name)}</b> ${badge}
    <div>Altitude <strong>${st.alt.toFixed(0)} km</strong></div>
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
  const hits = raycaster.intersectObject(instMesh, false);
  let id = -1;
  for (const h of hits) {
    if (h.instanceId === undefined) continue;
    const i = h.instanceId;
    if (!satState[i]) continue;
    if (!categoryEnabled[satCat[i]]) continue;
    id = i;
    break;
  }
  if (id !== -1) {
    if (id !== hoverId) {
      hoverId = id;
      renderTooltip(id);
    }
    tip.hidden = false;
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

(function attachHover() {
  const cv = document.querySelector('#globe canvas');
  if (!cv) { requestAnimationFrame(attachHover); return; }
  cv.addEventListener('mousemove',  onMouseMove);
  cv.addEventListener('mouseleave', onMouseLeave);
})();
