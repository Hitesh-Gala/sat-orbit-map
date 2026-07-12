// Argos — 2-D ground-track view.
//
// A clean, bright equirectangular world map (NASA Blue Marble raster, no
// political borders).  The user searches for one satellite; we draw its
// sub-satellite ground track for the 24 h before and after "now" as bold
// dotted lines, mark every 30 min with a direction arrow, blink the current
// position, and reverse-geocode each 30-min mark to a place name on hover.
//
// The track is drawn as a plain SVG overlay.  Because the projection is
// equirectangular, lon/lat map linearly to the SVG viewBox (x = lon+180,
// y = 90-lat), so points sit exactly on the raster's coastlines — and we get
// full, dependable control over how bold and visible everything is.
//
// Data layer: shared Argos namespace (tle-loader.js).  Reverse-geocoding uses
// the amCharts worldLow GeoJSON (loaded as data only).

const { propagate, makeSatrecs, fetchTLEs } = window.Argos;

const TRACK_MIN       = 24 * 60;   // minutes of track each side of "now"
const LINE_STEP_MIN   = 1;         // sampling for the dotted line
const MARK_STEP_MIN   = 30;        // interval markers + arrows
const CURRENT_REFRESH = 5_000;     // live "now" marker cadence
const TRACK_REFRESH   = 5 * 60_000;// recompute the ±24 h window periodically

const DEG = Math.PI / 180, RAD = 180 / Math.PI;
const SVGNS = 'http://www.w3.org/2000/svg';

// Degrees → viewBox units.
const vx = lon => lon + 180;
const vy = lat => 90 - lat;

function setStatus(msg) {
  const el = document.getElementById('map-status');
  if (el) el.textContent = msg;
}

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

function placeName(lat, lon) {
  return countryAt(lat, lon) || oceanAt(lat, lon);
}

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

// Split at antimeridian wraps so lines don't streak across the map.  Returns an
// SVG path string with one subpath per continuous segment.
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
// SVG overlay
// ---------------------------------------------------------------------------

const ARROW_D = 'M 0,-1.7 L 1.35,1.25 L 0,0.55 L -1.35,1.25 Z';  // points "north" (−y)

function drawGraticule() {
  const g = document.getElementById('graticule');
  let d = '';
  for (let lon = -150; lon <= 150; lon += 30) d += `M ${vx(lon)},0 L ${vx(lon)},180 `;
  for (let lat = -60; lat <= 60; lat += 30) d += `M 0,${vy(lat)} L 360,${vy(lat)} `;
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('d', d);
  g.appendChild(path);
}

function drawTrackLines(rec, anchor) {
  const past = sample(rec, anchor, -TRACK_MIN, 0);
  const future = sample(rec, anchor, 0, TRACK_MIN);
  const pd = segmentPath(past), fd = segmentPath(future);
  document.getElementById('past-line').setAttribute('d', pd);
  document.getElementById('past-halo').setAttribute('d', pd);
  document.getElementById('future-line').setAttribute('d', fd);
  document.getElementById('future-halo').setAttribute('d', fd);
}

function drawMarks(rec, anchor) {
  const g = document.getElementById('marks');
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

    const hit = document.createElementNS(SVGNS, 'circle');   // easy hover target
    hit.setAttribute('r', '2.6');
    hit.setAttribute('class', 'mark-hit');
    const arrow = document.createElementNS(SVGNS, 'path');
    arrow.setAttribute('d', ARROW_D);
    arrow.setAttribute('class', 'mark-arrow');
    grp.appendChild(hit);
    grp.appendChild(arrow);
    g.appendChild(grp);
  }
}

// ---------------------------------------------------------------------------
// Selection + live update
// ---------------------------------------------------------------------------

let satrecs = [];
let selected = null;
let anchor = null;

function orbitFacts(rec) {
  return { periodMin: rec.no ? (2 * Math.PI) / rec.no : NaN, incDeg: rec.inclo * RAD };
}

function drawTrack() {
  if (!selected) return;
  anchor = new Date();
  drawTrackLines(selected.rec, anchor);
  drawMarks(selected.rec, anchor);
}

function shortName(n) { return n.length > 22 ? n.slice(0, 21) + '…' : n; }

function positionNowLabel(lat, lon) {
  const cell = document.getElementById('map-cell');
  const label = document.getElementById('now-label');
  if (label.hidden) return;
  label.style.left = (vx(lon) / 360 * cell.clientWidth) + 'px';
  label.style.top  = (vy(lat) / 180 * cell.clientHeight) + 'px';
}

let nowLatLon = null;

function refreshCurrent() {
  if (!selected) return;
  const r = propagate(selected.rec, new Date());
  if (!r || !Number.isFinite(r.lat)) return;
  nowLatLon = [r.lat, r.lon];

  const now = document.getElementById('now');
  now.style.display = '';
  now.setAttribute('transform', `translate(${vx(r.lon).toFixed(2)},${vy(r.lat).toFixed(2)})`);

  const label = document.getElementById('now-label');
  label.hidden = false;
  label.textContent = shortName(selected.name);
  positionNowLabel(r.lat, r.lon);

  const { periodMin, incDeg } = orbitFacts(selected.rec);
  const info = document.getElementById('sat-info');
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
    <div class="si-anchor">Track: 24 h before/after ${anchor.toISOString().slice(11, 16)} UTC</div>`;
}

function selectSat(entry) {
  selected = entry;
  document.getElementById('sat-search').value = entry.name;
  hideResults();
  drawTrack();
  refreshCurrent();
  setStatus(`${entry.name} · #${entry.noradId}`);
}

// ---------------------------------------------------------------------------
// Mark tooltip
// ---------------------------------------------------------------------------

function wireTooltip() {
  const marks = document.getElementById('marks');
  const tip = document.getElementById('track-tooltip');
  const cell = document.getElementById('map-cell');

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
  marks.addEventListener('mouseout', (e) => {
    if (e.target.closest('.mark')) tip.hidden = true;
  });
}

// ---------------------------------------------------------------------------
// Draggable panel
// ---------------------------------------------------------------------------

function makeDraggable(panel, handle) {
  let ox = 0, oy = 0, dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    panel.classList.add('dragging');
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
  });
  const end = (e) => { dragging = false; panel.classList.remove('dragging'); };
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

function hideResults() {
  document.getElementById('sat-results').hidden = true;
  activeIdx = -1;
}

function renderResults(q) {
  const box = document.getElementById('sat-results');
  q = q.trim().toLowerCase();
  if (!q) { hideResults(); return; }
  matches = [];
  for (const it of searchIndex) {
    if (it.hay.includes(q)) { matches.push(it.entry); if (matches.length >= 60) break; }
  }
  if (!matches.length) {
    box.innerHTML = '<div class="sat-none">no match</div>';
    box.hidden = false;
    return;
  }
  box.innerHTML = matches.map((e, i) =>
    `<div class="sat-opt" data-i="${i}" role="option">${escapeHtml(e.name)}<span class="nid">#${e.noradId}</span></div>`
  ).join('');
  box.hidden = false;
  activeIdx = -1;
}

function highlight() {
  const box = document.getElementById('sat-results');
  [...box.querySelectorAll('.sat-opt')].forEach((el, i) => el.classList.toggle('active', i === activeIdx));
  const act = box.querySelector('.sat-opt.active');
  if (act) act.scrollIntoView({ block: 'nearest' });
}

function wireSearch() {
  const input = document.getElementById('sat-search');
  const box = document.getElementById('sat-results');

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

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function main() {
  try {
    // Paint the basemap here (rather than pure CSS) so this stays the single
    // source of truth for the equirectangular texture the SVG aligns to.
    document.getElementById('map-basemap').style.backgroundImage =
      "url('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')";

    drawGraticule();
    buildCountries();
    wireSearch();
    wireTooltip();
    makeDraggable(document.getElementById('track-panel'), document.getElementById('tp-drag'));
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
