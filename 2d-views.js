// Argos — 2-D ground-track view.
//
// A clean, bright equirectangular world map (NASA Blue Marble raster, no
// political borders).  The user searches for one satellite; then chooses one
// of two modes with the panel toggle:
//
//   TIME-BASED  — the sub-satellite ground track for the 24 h before and after
//                 "now" as bold dotted lines (past = cyan, future = amber) with
//                 a direction arrow every 30 min and hover place-names.
//
//   REV-BASED   — the dotted tracks disappear; instead the satellite dot flies
//                 forward from its present position at a chosen speed (1×–100×),
//                 tracing a thin golden trail, capped at 3 revolutions before it
//                 snaps back to the present.  A slider sets the speed and shows
//                 the projected UTC / IST time the satellite is over each point.
//
// The overlay is a plain SVG.  Because the projection is equirectangular,
// lon/lat map linearly to the viewBox (x = lon+180, y = 90-lat), so points sit
// exactly on the raster's coastlines and we control exactly how bold they are.
//
// Data layer: shared Argos namespace (tle-loader.js).  Reverse-geocoding uses
// the amCharts worldLow GeoJSON (loaded as data only).

const { propagate, makeSatrecs, fetchTLEs } = window.Argos;

const TRACK_MIN       = 24 * 60;   // minutes of track each side of "now"
const LINE_STEP_MIN   = 1;         // sampling for the dotted line
const MARK_STEP_MIN   = 30;        // interval markers + arrows
const CURRENT_REFRESH = 5_000;     // live "now" marker cadence (time mode)
const TRACK_REFRESH   = 5 * 60_000;// recompute the ±24 h window periodically

const SPEEDS   = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];  // rev-mode relative speeds
const MAX_REVS = 3;                            // rev-mode trail cap
const GOLD_STEP_MIN = 0.5;                     // golden-trail sampling (sim min)

const DEG = Math.PI / 180, RAD = 180 / Math.PI;
const SVGNS = 'http://www.w3.org/2000/svg';

const vx = lon => lon + 180;   // degrees → viewBox units
const vy = lat => 90 - lat;

const $ = id => document.getElementById(id);

function setStatus(msg) { const el = $('map-status'); if (el) el.textContent = msg; }

// ---------------------------------------------------------------------------
// Reverse geocoding — point-in-polygon against worldLow, ocean-basin fallback.
// ---------------------------------------------------------------------------

let COUNTRIES = [];

function buildCountries() {
  const feats = (window.am5geodata_worldLow && am5geodata_worldLow.features) || [];
  for (const f of feats) {
    const g = f.geometry;
    if (!g) continue;
    const name = (f.properties && (f.properties.name || f.properties.NAME)) || '—';
    let polys;
    if (g.type === 'Polygon') polys = [g.coordinates];
    else if (g.type === 'MultiPolygon') polys = g.coordinates;
    else continue;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const poly of polys) for (const ring of poly) for (const p of ring) {
      if (p[0] < minLon) minLon = p[0]; if (p[0] > maxLon) maxLon = p[0];
      if (p[1] < minLat) minLat = p[1]; if (p[1] > maxLat) maxLat = p[1];
    }
    COUNTRIES.push({ name, polys, bbox: [minLon, minLat, maxLon, maxLat] });
  }
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon, lat, poly) {
  let inside = false;
  for (const ring of poly) if (pointInRing(lon, lat, ring)) inside = !inside;
  return inside;
}

function countryAt(lat, lon) {
  for (const c of COUNTRIES) {
    const b = c.bbox;
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    for (const poly of c.polys) if (pointInPolygon(lon, lat, poly)) return c.name;
  }
  return null;
}

function oceanAt(lat, lon) {
  if (lat <= -55) return 'the Southern Ocean';
  if (lat >= 66)  return 'the Arctic Ocean';
  if (lat >= 30 && lat <= 47 && lon >= -6 && lon <= 42) return 'the Mediterranean Sea';
  if (lat < 30 && lon >= 20 && lon <= 100) return 'the Indian Ocean';
  if (lat < 0  && lon > 100 && lon <= 147) return 'the Indian Ocean';
  if (lon >= -70 && lon <= 20) return 'the Atlantic Ocean';
  if (lat >= 5 && lon >= -100 && lon < -70) return 'the Caribbean / W. Atlantic';
  return 'the Pacific Ocean';
}

function placeName(lat, lon) { return countryAt(lat, lon) || oceanAt(lat, lon); }

// ---------------------------------------------------------------------------
// Track math
// ---------------------------------------------------------------------------

function bearing(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * DEG, φ2 = lat2 * DEG, Δλ = (lon2 - lon1) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * RAD + 360) % 360;
}

function sample(rec, anchor, fromMin, toMin) {
  const pts = [];
  for (let m = fromMin; m <= toMin; m += LINE_STEP_MIN) {
    const r = propagate(rec, new Date(anchor.getTime() + m * 60000));
    if (r && Number.isFinite(r.lat) && Number.isFinite(r.lon)) pts.push({ lat: r.lat, lon: r.lon });
  }
  return pts;
}

// Points ({lat,lon}) → SVG path, split at antimeridian wraps.
function segmentPath(pts) {
  let d = '', prevLon = null, started = false;
  for (const p of pts) {
    if (prevLon !== null && Math.abs(p.lon - prevLon) > 180) started = false;
    d += (started ? ' L ' : ' M ') + vx(p.lon).toFixed(2) + ',' + vy(p.lat).toFixed(2);
    started = true;
    prevLon = p.lon;
  }
  return d.trim();
}

function fmtRel(m) {
  const s = m < 0 ? '−' : '+';
  const a = Math.abs(m);
  return `${s}${Math.floor(a / 60)}h ${String(a % 60).padStart(2, '0')}m`;
}

// ---------------------------------------------------------------------------
// SVG overlay — static bits
// ---------------------------------------------------------------------------

const ARROW_D = 'M 0,-1.7 L 1.35,1.25 L 0,0.55 L -1.35,1.25 Z';  // points "north" (−y)

function drawGraticule() {
  let d = '';
  for (let lon = -150; lon <= 150; lon += 30) d += `M ${vx(lon)},0 L ${vx(lon)},180 `;
  for (let lat = -60; lat <= 60; lat += 30) d += `M 0,${vy(lat)} L 360,${vy(lat)} `;
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('d', d);
  $('graticule').appendChild(path);
}

// ---------------------------------------------------------------------------
// Time-based track (dotted past/future lines + 30-min arrows)
// ---------------------------------------------------------------------------

function drawTrackLines(rec, anchor) {
  const pd = segmentPath(sample(rec, anchor, -TRACK_MIN, 0));
  const fd = segmentPath(sample(rec, anchor, 0, TRACK_MIN));
  $('past-line').setAttribute('d', pd);   $('past-halo').setAttribute('d', pd);
  $('future-line').setAttribute('d', fd); $('future-halo').setAttribute('d', fd);
}

function drawMarks(rec, anchor) {
  const g = $('marks');
  g.textContent = '';
  for (let m = -TRACK_MIN; m <= TRACK_MIN; m += MARK_STEP_MIN) {
    if (m === 0) continue;
    const d = new Date(anchor.getTime() + m * 60000);
    const r = propagate(rec, d);
    if (!r || !Number.isFinite(r.lat)) continue;
    const r2 = propagate(rec, new Date(d.getTime() + 60000));
    const hd = r2 ? bearing(r.lat, r.lon, r2.lat, r2.lon) : 0;

    const grp = document.createElementNS(SVGNS, 'g');
    grp.setAttribute('class', 'mark ' + (m > 0 ? 'future' : 'past'));
    grp.setAttribute('transform', `translate(${vx(r.lon).toFixed(2)},${vy(r.lat).toFixed(2)}) rotate(${hd.toFixed(1)})`);
    grp.dataset.tip =
      `${d.toISOString().slice(11, 16)} UTC · ${fmtRel(m)}\nover ${placeName(r.lat, r.lon)}\n${r.lat.toFixed(1)}°, ${r.lon.toFixed(1)}°`;

    const hit = document.createElementNS(SVGNS, 'circle');
    hit.setAttribute('r', '2.6'); hit.setAttribute('class', 'mark-hit');
    const arrow = document.createElementNS(SVGNS, 'path');
    arrow.setAttribute('d', ARROW_D); arrow.setAttribute('class', 'mark-arrow');
    grp.appendChild(hit); grp.appendChild(arrow);
    g.appendChild(grp);
  }
}

// ---------------------------------------------------------------------------
// Shared marker + info
// ---------------------------------------------------------------------------

let satrecs = [];
let selected = null;
let anchor = null;
let nowLatLon = null;

function orbitFacts(rec) {
  return { periodMin: rec.no ? (2 * Math.PI) / rec.no : NaN, incDeg: rec.inclo * RAD };
}

function shortName(n) { return n.length > 22 ? n.slice(0, 21) + '…' : n; }

function positionNowLabel(lat, lon) {
  const cell = $('map-cell'), label = $('now-label');
  if (label.hidden) return;
  label.style.left = (vx(lon) / 360 * cell.clientWidth) + 'px';
  label.style.top  = (vy(lat) / 180 * cell.clientHeight) + 'px';
}

function setNowMarker(lat, lon, alt) {
  const now = $('now');
  now.style.display = '';
  now.setAttribute('transform', `translate(${vx(lon).toFixed(2)},${vy(lat).toFixed(2)})`);
  nowLatLon = [lat, lon];
  const label = $('now-label');
  label.hidden = false;
  label.textContent = shortName(selected.name);
  positionNowLabel(lat, lon);
  updateGlobe(lat, lon, alt);
}

// ---------------------------------------------------------------------------
// Companion 3-D globe (globe.gl) — kept centred on the selected satellite: the
// globe spins in longitude so the sub-point faces the viewer, while the sat
// marker rides up/down with latitude.  Fed from the same setNowMarker() path,
// so it stays in lock-step with the 2-D map in both modes and at any speed.
// ---------------------------------------------------------------------------

const GLOBE_CAM_ALT = 2.2;
let globe = null, satMesh = null;

function globeSize() {
  const el = $('mini-globe');
  const w = el.clientWidth || 200;
  return { w, h: el.clientHeight || w };
}

function initGlobe() {
  if (typeof Globe !== 'function' || !window.THREE) return;
  const el = $('mini-globe');
  const { w, h } = globeSize();
  globe = Globe()(el)
    .width(w).height(h)
    .backgroundColor('rgba(0,0,0,0)')
    .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
    .showAtmosphere(true).atmosphereColor('#68b0ff').atmosphereAltitude(0.2);

  // Display only — it tracks the sat automatically.  Keep controls "enabled"
  // (globe.gl applies pointOfView through controls.update() each frame) but
  // switch off every user input so the auto-centring can't be fought.
  const ctr = globe.controls();
  ctr.enabled = true;
  ctr.autoRotate = false;
  if ('noRotate' in ctr) { ctr.noRotate = ctr.noZoom = ctr.noPan = true; }         // TrackballControls
  if ('enableRotate' in ctr) { ctr.enableRotate = ctr.enableZoom = ctr.enablePan = false; } // OrbitControls

  const THREE = window.THREE;
  satMesh = new THREE.Mesh(
    new THREE.SphereGeometry(3, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0x8bff9e }));
  satMesh.add(new THREE.Mesh(
    new THREE.SphereGeometry(5.5, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0x8bff9e, transparent: true, opacity: 0.25 })));
  satMesh.visible = false;
  globe.scene().add(satMesh);

  globe.pointOfView({ lat: 0, lng: 0, altitude: GLOBE_CAM_ALT }, 0);
  window.addEventListener('resize', () => { const s = globeSize(); globe.width(s.w).height(s.h); });
}

function updateGlobe(lat, lon, alt) {
  if (!globe || !satMesh) return;
  const altFrac = Math.min(0.6, Math.max(0.03, (alt || 400) / 6371));
  const c = globe.getCoords(lat, lon, altFrac);
  satMesh.position.set(c.x, c.y, c.z);
  satMesh.visible = true;
  // lng follows the sub-point (globe rotates); lat fixed at 0 so the marker
  // rides up/down with its own latitude.
  globe.pointOfView({ lat: 0, lng: lon, altitude: GLOBE_CAM_ALT }, 0);
}

function renderInfo(r, footer) {
  const { periodMin, incDeg } = orbitFacts(selected.rec);
  const info = $('sat-info');
  info.hidden = false;
  info.innerHTML = `
    <div class="si-name">${escapeHtml(selected.name)}</div>
    <div class="si-grid">
      <span>NORAD</span><b>${selected.noradId}</b>
      <span>Over</span><b>${escapeHtml(placeName(r.lat, r.lon))}</b>
      <span>Lat / Lon</span><b>${r.lat.toFixed(2)}°, ${r.lon.toFixed(2)}°</b>
      <span>Altitude</span><b>${r.alt.toFixed(0)} km</b>
      <span>Period</span><b>${Number.isFinite(periodMin) ? periodMin.toFixed(1) + ' min' : '—'}</b>
      <span>Inclination</span><b>${incDeg.toFixed(1)}°</b>
    </div>
    <div class="si-anchor">${footer}</div>`;
}

// ---------------------------------------------------------------------------
// Mode handling
// ---------------------------------------------------------------------------

let mode = 'time';   // 'time' | 'rev'

const TIME_EL_IDS = ['past-halo', 'future-halo', 'past-line', 'future-line', 'marks'];

function setTimeVisibility(on) {
  const disp = on ? '' : 'none';
  for (const id of TIME_EL_IDS) $(id).style.display = disp;
  $('rev-line').style.display = on ? 'none' : '';
  $('legend-time').style.display = on ? '' : 'none';
  $('legend-rev').style.display = on ? 'none' : '';
}

function drawTrack() {
  if (mode !== 'time' || !selected) return;
  anchor = new Date();
  drawTrackLines(selected.rec, anchor);
  drawMarks(selected.rec, anchor);
}

function refreshCurrent() {
  if (mode !== 'time' || !selected) return;
  const r = propagate(selected.rec, new Date());
  if (!r || !Number.isFinite(r.lat)) return;
  setNowMarker(r.lat, r.lon, r.alt);
  renderInfo(r, `Track: 24 h before/after ${(anchor || new Date()).toISOString().slice(11, 16)} UTC`);
}

// ---- revolution-based animation --------------------------------------------

let speedIdx = 0;
let revBase = null;     // Date the animation counts forward from (present)
let simMin = 0;         // simulated minutes elapsed since revBase
let periodMin = 92;
let goldenPts = [];
let nextGoldMin = 0;
let rafId = null;
let lastTs = null;
let lastInfoTs = 0;

function resetRevAnim() {
  revBase = new Date();
  simMin = 0;
  goldenPts = [];
  nextGoldMin = GOLD_STEP_MIN;
  const f = orbitFacts(selected.rec);
  periodMin = Number.isFinite(f.periodMin) && f.periodMin > 0 ? f.periodMin : 92;
  $('rev-line').setAttribute('d', '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtClock(date, offsetMs = 0) {
  return new Date(date.getTime() + offsetMs).toISOString().slice(11, 19);
}

// Reads UTC parts; pass an already-shifted Date (e.g. +5:30) to get IST wall date.
function fmtDate(d) {
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function updateRevTimes(t) {
  const ist = new Date(t.getTime() + 5.5 * 3600000);  // IST = UTC + 5:30
  $('rev-utc').textContent = fmtClock(t);
  $('rev-utc-date').textContent = fmtDate(t);
  $('rev-ist').textContent = fmtClock(t, 5.5 * 3600000);
  $('rev-ist-date').textContent = fmtDate(ist);
}

function animRev(ts) {
  if (mode !== 'rev' || !selected) { rafId = null; return; }
  if (lastTs == null) lastTs = ts;
  const dt = (ts - lastTs) / 1000;   // real seconds
  lastTs = ts;

  simMin += SPEEDS[speedIdx] * dt / 60;   // speed = sim-seconds per real-second
  if (simMin >= MAX_REVS * periodMin) resetRevAnim();   // cap at 3 revs → present

  const t = new Date(revBase.getTime() + simMin * 60000);
  const r = propagate(selected.rec, t);
  if (r && Number.isFinite(r.lat)) {
    setNowMarker(r.lat, r.lon, r.alt);

    // extend the golden trail up to the current sim time
    while (nextGoldMin <= simMin) {
      const g = propagate(selected.rec, new Date(revBase.getTime() + nextGoldMin * 60000));
      if (g && Number.isFinite(g.lat)) goldenPts.push({ lat: g.lat, lon: g.lon });
      nextGoldMin += GOLD_STEP_MIN;
    }
    $('rev-line').setAttribute('d', segmentPath(goldenPts.concat([{ lat: r.lat, lon: r.lon }])));

    updateRevTimes(t);
    $('rev-count').textContent = Math.min(MAX_REVS, Math.floor(simMin / periodMin) + 1);
    if (ts - lastInfoTs > 200) {
      lastInfoTs = ts;
      renderInfo(r, `Rev-based · projected time shown on the speed panel`);
    }
  }
  rafId = requestAnimationFrame(animRev);
}

function startRev() {
  if (!selected) return;
  resetRevAnim();
  lastTs = null;
  lastInfoTs = 0;
  if (!rafId) rafId = requestAnimationFrame(animRev);
}

function applyMode(m) {
  mode = m;
  const rev = (m === 'rev');
  const btn = $('mode-btn');
  btn.setAttribute('aria-checked', rev ? 'true' : 'false');
  btn.classList.toggle('on', rev);
  $('mode-state').textContent = rev ? 'Revolution-based' : 'Time-based';
  setTimeVisibility(!rev);
  $('rev-section').hidden = !rev;

  if (rev) {
    startRev();
  } else {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    $('rev-line').setAttribute('d', '');
    drawTrack();
    refreshCurrent();
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function selectSat(entry) {
  selected = entry;
  $('sat-search').value = entry.name;
  hideResults();
  setStatus(`${entry.name} · #${entry.noradId}`);
  if (mode === 'rev') startRev();
  else { drawTrack(); refreshCurrent(); }
}

// ---------------------------------------------------------------------------
// Mark tooltip
// ---------------------------------------------------------------------------

function wireTooltip() {
  const marks = $('marks'), tip = $('track-tooltip'), cell = $('map-cell');
  function place(e) {
    const r = cell.getBoundingClientRect();
    let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
    x = Math.min(x, cell.clientWidth - tip.offsetWidth - 6);
    y = Math.min(y, cell.clientHeight - tip.offsetHeight - 6);
    tip.style.left = Math.max(6, x) + 'px';
    tip.style.top = Math.max(6, y) + 'px';
  }
  marks.addEventListener('mouseover', (e) => {
    const m = e.target.closest('.mark');
    if (!m) return;
    tip.textContent = m.dataset.tip;
    tip.hidden = false;
    place(e);
  });
  marks.addEventListener('mousemove', (e) => { if (!tip.hidden) place(e); });
  marks.addEventListener('mouseout', (e) => { if (e.target.closest('.mark')) tip.hidden = true; });
}

// ---------------------------------------------------------------------------
// Draggable panels
// ---------------------------------------------------------------------------

function makeDraggable(panel, handle) {
  let ox = 0, oy = 0, dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;   // let header buttons (collapse) click, not drag
    dragging = true;
    panel.classList.add('dragging');
    panel.style.transform = 'none';   // drop any centering transform
    const pr = panel.getBoundingClientRect();
    ox = e.clientX - pr.left;
    oy = e.clientY - pr.top;
    try { handle.setPointerCapture(e.pointerId); } catch { /* synthetic/edge pointers */ }
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const parent = panel.offsetParent || document.body;
    const par = parent.getBoundingClientRect();
    let left = e.clientX - par.left - ox;
    let top = e.clientY - par.top - oy;
    left = Math.max(0, Math.min(left, parent.clientWidth - panel.offsetWidth));
    top = Math.max(0, Math.min(top, parent.clientHeight - panel.offsetHeight));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  });
  const end = () => { dragging = false; panel.classList.remove('dragging'); };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------------------
// Search combobox
// ---------------------------------------------------------------------------

let searchIndex = [], matches = [], activeIdx = -1;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildIndex() {
  searchIndex = satrecs.map(e => ({ entry: e, hay: (e.name + ' ' + e.noradId).toLowerCase() }));
}

function hideResults() { $('sat-results').hidden = true; activeIdx = -1; }

function renderResults(q) {
  const box = $('sat-results');
  q = q.trim().toLowerCase();
  if (!q) { hideResults(); return; }
  matches = [];
  for (const it of searchIndex) {
    if (it.hay.includes(q)) { matches.push(it.entry); if (matches.length >= 60) break; }
  }
  if (!matches.length) { box.innerHTML = '<div class="sat-none">no match</div>'; box.hidden = false; return; }
  box.innerHTML = matches.map((e, i) =>
    `<div class="sat-opt" data-i="${i}" role="option">${escapeHtml(e.name)}<span class="nid">#${e.noradId}</span></div>`
  ).join('');
  box.hidden = false;
  activeIdx = -1;
}

function highlight() {
  const box = $('sat-results');
  [...box.querySelectorAll('.sat-opt')].forEach((el, i) => el.classList.toggle('active', i === activeIdx));
  const act = box.querySelector('.sat-opt.active');
  if (act) act.scrollIntoView({ block: 'nearest' });
}

function wireSearch() {
  const input = $('sat-search'), box = $('sat-results');
  input.addEventListener('input', () => renderResults(input.value));
  input.addEventListener('focus', () => { if (input.value.trim()) renderResults(input.value); });
  input.addEventListener('keydown', (e) => {
    if (box.hidden || !matches.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, matches.length - 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); selectSat(matches[activeIdx >= 0 ? activeIdx : 0]); }
    else if (e.key === 'Escape') { hideResults(); }
  });
  box.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('.sat-opt');
    if (!opt) return;
    e.preventDefault();
    selectSat(matches[+opt.dataset.i]);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.track-panel')) hideResults(); });
}

function wireControls() {
  $('mode-btn').addEventListener('click', () => applyMode(mode === 'time' ? 'rev' : 'time'));
  const slider = $('rev-speed');
  slider.addEventListener('input', () => {
    speedIdx = +slider.value;
    $('rev-speed-val').textContent = SPEEDS[speedIdx] + '×';
  });
  const collapseBtn = $('tp-collapse');
  collapseBtn.addEventListener('click', () => {
    const collapsed = $('track-panel').classList.toggle('collapsed');
    collapseBtn.textContent = collapsed ? '▸' : '▾';
    collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    collapseBtn.title = collapsed ? 'Expand panel' : 'Collapse panel';
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function main() {
  try {
    $('map-basemap').style.backgroundImage =
      "url('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')";

    drawGraticule();
    buildCountries();
    initGlobe();
    wireSearch();
    wireTooltip();
    wireControls();
    makeDraggable($('track-panel'), $('tp-drag'));
    window.addEventListener('resize', () => { if (nowLatLon) positionNowLabel(nowLatLon[0], nowLatLon[1]); });

    setStatus('Loading TLE catalog…');
    const tleResult = await fetchTLEs();
    satrecs = makeSatrecs(tleResult.tles).sort((a, b) => a.name.localeCompare(b.name));
    buildIndex();

    const tag = tleResult.source === 'celestrak' ? 'live'
              : tleResult.source === 'cache' ? 'cached' : 'bundled';
    setStatus(`${satrecs.length.toLocaleString()} satellites (${tag}) · search one`);

    const seed = satrecs.find(s => /ISS \(ZARYA\)/i.test(s.name))
              || satrecs.find(s => /ZARYA|ISS/i.test(s.name));
    if (seed) selectSat(seed);

    setInterval(refreshCurrent, CURRENT_REFRESH);
    setInterval(drawTrack, TRACK_REFRESH);
  } catch (e) {
    console.error(e);
    setStatus(`Load failed: ${e.message}`);
  }
})();
