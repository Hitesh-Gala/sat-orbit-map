// Argos — 2-D ground-track view (amCharts 5).
//
// The page is a clean equirectangular world map (NASA Blue Marble raster, no
// political borders).  The user searches for one satellite; we then draw its
// sub-satellite ground track for the 24 h before and after "now" as dotted
// lines, mark every 30 min with a direction arrow, label the current position,
// and reverse-geocode each 30-min mark to a place name for hover tooltips.
//
// Data layer: shared Argos namespace (tle-loader.js).  Reverse-geocoding uses
// the amCharts worldLow GeoJSON that is already loaded for the map.

const { propagate, makeSatrecs, fetchTLEs } = window.Argos;

const TRACK_MIN        = 24 * 60;  // minutes of track each side of "now"
const LINE_STEP_MIN    = 1;        // sampling for the dotted line (smoothness)
const MARK_STEP_MIN    = 30;       // interval markers + arrows
const CURRENT_REFRESH  = 5_000;    // live "now" marker cadence
const TRACK_REFRESH    = 5 * 60_000; // recompute the ±24 h window periodically

const DEG = Math.PI / 180, RAD = 180 / Math.PI;

const COL_PAST   = 0x63d5ff;  // cyan  — where it has been
const COL_FUTURE = 0xffb43d;  // amber — where it is going
const COL_NOW    = 0x8bff9e;  // green — current position

// ---------------------------------------------------------------------------
// Reverse geocoding — point-in-polygon against the worldLow country outlines,
// with a coarse ocean-basin fallback for points that fall on open water.
// ---------------------------------------------------------------------------

let COUNTRIES = [];  // [{ name, polys:[[ring,…],…], bbox:[minLon,minLat,maxLon,maxLat] }]

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

// Even-odd across all rings of a polygon: outer ring includes, holes exclude.
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

// Coarse basin/sea lookup for open-water points.
function oceanAt(lat, lon) {
  if (lat <= -55) return 'the Southern Ocean';
  if (lat >= 66)  return 'the Arctic Ocean';
  // Mediterranean / Black Sea pocket.
  if (lat >= 30 && lat <= 47 && lon >= -6 && lon <= 42) return 'the Mediterranean Sea';
  // Indian Ocean.
  if (lat < 30 && lon >= 20 && lon <= 100) return 'the Indian Ocean';
  if (lat < 0  && lon > 100 && lon <= 147) return 'the Indian Ocean';
  // Atlantic.
  if (lon >= -70 && lon <= 20) return 'the Atlantic Ocean';
  if (lat >= 5 && lon >= -100 && lon < -70) return 'the Caribbean / W. Atlantic';
  // Everything else is Pacific.
  return 'the Pacific Ocean';
}

function placeName(lat, lon) {
  return countryAt(lat, lon) || oceanAt(lat, lon);
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

let root, chart, graticule, pastLine, futureLine, markSeries, nowSeries;

function setStatus(msg) {
  const el = document.getElementById('map-status');
  if (el) el.textContent = msg;
}

function buildMap() {
  root = am5.Root.new('map-equal');
  root.setThemes([am5themes_Animated.new(root)]);

  chart = root.container.children.push(am5map.MapChart.new(root, {
    projection: am5map.geoEquirectangular(),
    // The basemap raster is CSS-positioned and can't re-project, so the map
    // stays locked to it.
    panX: 'none', panY: 'none', wheelY: 'none', pinchZoom: false,
    paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0,
  }));

  // Faint lat/lon grid every 30° — orientation only, no country borders.
  graticule = chart.series.push(am5map.GraticuleSeries.new(root, { step: 30 }));
  graticule.mapLines.template.setAll({
    stroke: am5.color(0xffffff), strokeOpacity: 0.10, strokeWidth: 0.4,
  });

  // Past-track dotted line.
  pastLine = chart.series.push(am5map.MapLineSeries.new(root, {}));
  pastLine.mapLines.template.setAll({
    stroke: am5.color(COL_PAST), strokeOpacity: 0.85, strokeWidth: 1.7,
    strokeDasharray: [0.2, 4.2], strokeLinecap: 'round',
  });

  // Future-track dotted line.
  futureLine = chart.series.push(am5map.MapLineSeries.new(root, {}));
  futureLine.mapLines.template.setAll({
    stroke: am5.color(COL_FUTURE), strokeOpacity: 0.9, strokeWidth: 1.7,
    strokeDasharray: [0.2, 4.2], strokeLinecap: 'round',
  });

  // 30-minute interval marks — triangles rotated to the direction of travel,
  // tooltip reveals the place the satellite is over at that moment.
  markSeries = chart.series.push(am5map.MapPointSeries.new(root, {}));
  markSeries.bullets.push((rt, _s, di) => {
    const d = di.dataContext;
    const col = d.future ? COL_FUTURE : COL_PAST;
    return am5.Bullet.new(rt, {
      sprite: am5.Triangle.new(rt, {
        width: 7.5, height: 8.5,
        centerX: am5.p50, centerY: am5.p50,
        rotation: d.heading,
        fill: am5.color(col), fillOpacity: 0.95,
        stroke: am5.color(0x0a1622), strokeWidth: 0.6, strokeOpacity: 0.9,
        tooltipText: '{tip}',
      }),
    });
  });

  // Current position — pulsing ring + solid dot + name label.
  nowSeries = chart.series.push(am5map.MapPointSeries.new(root, {}));
  nowSeries.bullets.push((rt) => {
    const ring = am5.Circle.new(rt, {
      radius: 5, fillOpacity: 0,
      stroke: am5.color(COL_NOW), strokeWidth: 2, strokeOpacity: 0.9,
    });
    ring.animate({ key: 'radius', from: 5, to: 17, duration: 1600, loops: Infinity });
    ring.animate({ key: 'strokeOpacity', from: 0.9, to: 0, duration: 1600, loops: Infinity });
    return am5.Bullet.new(rt, { sprite: ring });
  });
  nowSeries.bullets.push((rt) => am5.Bullet.new(rt, {
    sprite: am5.Circle.new(rt, {
      radius: 4.2, fill: am5.color(COL_NOW),
      stroke: am5.color(0x08140b), strokeWidth: 1.3,
      tooltipText: '{tip}',
    }),
  }));
  nowSeries.bullets.push((rt) => am5.Bullet.new(rt, {
    sprite: am5.Label.new(rt, {
      text: '{label}', fontSize: 11, fontWeight: '700',
      fill: am5.color(0xffffff), centerX: am5.p50, centerY: am5.p100, dy: -11,
      paddingTop: 2, paddingBottom: 2, paddingLeft: 6, paddingRight: 6,
      background: am5.RoundedRectangle.new(rt, {
        fill: am5.color(0x0b1a2b), fillOpacity: 0.78, cornerRadiusTL: 4,
        cornerRadiusTR: 4, cornerRadiusBL: 4, cornerRadiusBR: 4,
      }),
    }),
  }));
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

// Sample sub-satellite points; returns [{ m, lat, lon }] (m = minutes off anchor).
function sample(rec, anchor, fromMin, toMin) {
  const pts = [];
  for (let m = fromMin; m <= toMin; m += LINE_STEP_MIN) {
    const r = propagate(rec, new Date(anchor.getTime() + m * 60000));
    if (r && Number.isFinite(r.lat) && Number.isFinite(r.lon)) pts.push({ m, lat: r.lat, lon: r.lon });
  }
  return pts;
}

// Split a point list at antimeridian wraps so lines don't streak across the map.
function toSegments(pts) {
  const segs = [];
  let cur = [], prevLon = null;
  for (const p of pts) {
    if (prevLon !== null && Math.abs(p.lon - prevLon) > 180) {
      if (cur.length > 1) segs.push(cur);
      cur = [];
    }
    cur.push([p.lon, p.lat]);
    prevLon = p.lon;
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}

function fmtRel(m) {
  const s = m < 0 ? '−' : '+';
  const a = Math.abs(m);
  return `${s}${Math.floor(a / 60)}h ${String(a % 60).padStart(2, '0')}m`;
}

function buildMarkers(rec, anchor) {
  const out = [];
  for (let m = -TRACK_MIN; m <= TRACK_MIN; m += MARK_STEP_MIN) {
    if (m === 0) continue;  // "now" is drawn separately
    const d = new Date(anchor.getTime() + m * 60000);
    const r = propagate(rec, d);
    if (!r || !Number.isFinite(r.lat)) continue;
    const r2 = propagate(rec, new Date(d.getTime() + 60000));
    const hd = r2 ? bearing(r.lat, r.lon, r2.lat, r2.lon) : 0;
    const utc = d.toISOString().slice(11, 16);
    out.push({
      lat: r.lat, lon: r.lon, heading: hd, future: m > 0,
      tip: `${utc} UTC · ${fmtRel(m)}\nover ${placeName(r.lat, r.lon)}\n${r.lat.toFixed(1)}°, ${r.lon.toFixed(1)}°`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Selection + live update
// ---------------------------------------------------------------------------

let satrecs = [];      // [{ name, noradId, rec }]
let selected = null;   // current entry
let anchor = null;     // Date the current track window is centred on

function orbitFacts(rec) {
  const periodMin = rec.no ? (2 * Math.PI) / rec.no : NaN;  // no = rad/min
  const incDeg = rec.inclo * RAD;
  return { periodMin, incDeg };
}

function drawTrack() {
  if (!selected) return;
  anchor = new Date();
  const rec = selected.rec;

  pastLine.data.setAll([{ geometry: { type: 'MultiLineString',
    coordinates: toSegments(sample(rec, anchor, -TRACK_MIN, 0)) } }]);
  futureLine.data.setAll([{ geometry: { type: 'MultiLineString',
    coordinates: toSegments(sample(rec, anchor, 0, TRACK_MIN)) } }]);
  markSeries.data.setAll(buildMarkers(rec, anchor));
}

function shortName(n) {
  return n.length > 20 ? n.slice(0, 19) + '…' : n;
}

function refreshCurrent() {
  if (!selected) return;
  const now = new Date();
  const r = propagate(selected.rec, now);
  if (!r || !Number.isFinite(r.lat)) return;

  nowSeries.data.setAll([{
    lat: r.lat, lon: r.lon, label: shortName(selected.name),
    tip: `[bold]${selected.name}[/]\nnow over ${placeName(r.lat, r.lon)}\n${r.lat.toFixed(2)}°, ${r.lon.toFixed(2)}°  ·  ${r.alt.toFixed(0)} km`,
  }]);

  const { periodMin, incDeg } = orbitFacts(selected.rec);
  const info = document.getElementById('sat-info');
  if (info) {
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
// Search combobox
// ---------------------------------------------------------------------------

let searchIndex = [];   // [{ entry, hay }]
let matches = [];       // current visible matches
let activeIdx = -1;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildIndex() {
  searchIndex = satrecs.map(e => ({ entry: e, hay: (e.name + ' ' + e.noradId).toLowerCase() }));
}

function hideResults() {
  const box = document.getElementById('sat-results');
  box.hidden = true;
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
  [...box.querySelectorAll('.sat-opt')].forEach((el, i) =>
    el.classList.toggle('active', i === activeIdx));
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

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.track-panel')) hideResults();
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function main() {
  try {
    buildMap();
    buildCountries();
    wireSearch();

    setStatus('Loading TLE catalog…');
    const tleResult = await fetchTLEs();
    satrecs = makeSatrecs(tleResult.tles).sort((a, b) => a.name.localeCompare(b.name));
    buildIndex();

    const tag = tleResult.source === 'celestrak' ? 'live'
              : tleResult.source === 'cache' ? 'cached' : 'bundled';
    setStatus(`${satrecs.length.toLocaleString()} satellites (${tag}) · search one`);

    // Seed with the ISS so the page opens with a live track to explore.
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
