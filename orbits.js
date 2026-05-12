// Argos — Orbits view.
// Draws orbital tracks (3-D arcs) around the realistic globe.  For each
// satellite we sample its position over one full period using SGP4, then
// hand the polyline to globe.gl's pathsData layer.
//
// Source data is the same NORAD/CelesTrak TLE catalog every public tracker
// (including satellitetracker3d.com) is built on — that site doesn't expose
// a JSON API, so we go direct to CelesTrak via the shared Argos loader.

const { EARTH_R_KM, propagate, makeSatrecs, fetchTLEs } = window.Argos;

const REFRESH_MS_DOTS = 5_000;   // refresh current positions (cheap)
const REFRESH_MS_PATHS = 5 * 60_000; // recompute orbit arcs (expensive)
const POINTS_PER_ORBIT = 80;
const COUNTRIES_URL = 'https://unpkg.com/three-globe@2.31.1/example/country-polygons/ne_110m_admin_0_countries.geojson';

// Per-class caps keep the visible swarm under ~250 paths — globe.gl renders
// that smoothly while still painting a rich orbital picture.
const CLASS_CAP = { LEO: 120, MEO: 70, GEO: 40, HEO: 30 };
const COLOR     = { LEO: '#67e8a4', MEO: '#f9d24c', GEO: '#ff9966', HEO: '#d77eff' };

function classify(altKm) {
  if (altKm < 2000)  return 'LEO';
  if (altKm < 30000) return 'MEO';
  if (altKm < 40000) return 'GEO';
  return 'HEO';
}

// satellite.js stores mean motion in radians/minute on satrec.no — orbital
// period in minutes is then 2π/no.
function orbitalPeriodMinutes(rec) {
  if (!rec || !rec.no || rec.no <= 0) return 90;
  return (2 * Math.PI) / rec.no;
}

// --- Globe ----------------------------------------------------------------

const globe = Globe()(document.getElementById('globe'))
  .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
  .bumpImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png')
  .backgroundImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/night-sky.png')
  .showAtmosphere(true)
  .atmosphereColor('#4ea8ff')
  .atmosphereAltitude(0.18)
  .pointOfView({ lat: 22, lng: 80, altitude: 3.2 }, 0)
  // Soft political borders.
  .polygonsData([])
  .polygonAltitude(0.005)
  .polygonCapColor(() => 'rgba(255, 255, 255, 0)')
  .polygonSideColor(() => 'rgba(255, 255, 255, 0)')
  .polygonStrokeColor(() => 'rgba(255, 240, 200, 0.4)')
  // Orbital tracks.
  .pathsData([])
  .pathPoints(d => d.points)
  .pathPointLat(p => p[0])
  .pathPointLng(p => p[1])
  .pathPointAlt(p => p[2])
  .pathColor(d => d.color)
  .pathStroke(0.55)
  .pathTransitionDuration(0)
  .pathLabel(d => `${d.name}<br>${d.cls} · period ${d.period.toFixed(1)} min`)
  // Live satellite dots.
  .htmlElementsData([])
  .htmlLat(d => d.lat)
  .htmlLng(d => d.lon)
  .htmlAltitude(d => d.alt / EARTH_R_KM)
  .htmlElement(d => {
    const el = document.createElement('div');
    el.className = 'sat-dot orbit';
    el.style.background = d.color;
    el.style.boxShadow = `0 0 6px ${d.color}, 0 0 10px ${d.color}66`;
    el.title = `${d.name}\n${d.alt.toFixed(0)} km · ${d.cls}`;
    return el;
  });

const controls = globe.controls();
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.rotateSpeed = 0.5;
controls.zoomSpeed = 0.8;
controls.minDistance = 150;
controls.maxDistance = 1400;

fetch(COUNTRIES_URL)
  .then(r => r.json())
  .then(geo => globe.polygonsData(geo.features.filter(f => f.properties.ISO_A2 !== 'AQ')))
  .catch(e => console.warn('Country polygons failed:', e.message));

window.addEventListener('resize', () => globe.width(window.innerWidth).height(window.innerHeight));

// --- Clocks ---------------------------------------------------------------

const fmtTime = (d, tz) => d.toLocaleTimeString('en-GB', {
  hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: tz,
});
const fmtDate = (d, tz) => d.toLocaleDateString('en-GB', {
  year: 'numeric', month: 'short', day: '2-digit', timeZone: tz,
});
function tickClocks() {
  const now = new Date();
  document.getElementById('utc-time').textContent  = fmtTime(now, 'UTC');
  document.getElementById('ist-time').textContent  = fmtTime(now, 'Asia/Kolkata');
  document.getElementById('utc-date').textContent  = fmtDate(now, 'UTC') + ' UTC';
}
tickClocks();
setInterval(tickClocks, 1000);

// --- App state ------------------------------------------------------------

let activeTLEs = [];      // [{ name, noradId, rec }]
let selected = [];        // sats we draw orbits for, with cached classification

function setStatus(msg, cls = '') {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = cls;
}

async function loadCatalog() {
  setStatus('Loading TLE catalog…');
  const { tles, source } = await fetchTLEs();
  activeTLEs = makeSatrecs(tles);
  document.getElementById('tle-count').textContent = activeTLEs.length.toLocaleString();
  const tag = source === 'celestrak' ? 'live' : source === 'cache' ? 'cached' : 'bundled';
  setStatus(`${activeTLEs.length.toLocaleString()} TLEs (${tag})`);
}

// Pick a representative subset that respects the per-class caps.
function selectSatellites(now) {
  const taken = { LEO: 0, MEO: 0, GEO: 0, HEO: 0 };
  const out = [];
  // Shuffle deterministically by noradId so each class gets a varied sample
  // rather than the first N entries of the catalog.
  const shuffled = activeTLEs.slice().sort((a, b) =>
    (a.noradId * 2654435761) % 1e9 - (b.noradId * 2654435761) % 1e9
  );
  for (const t of shuffled) {
    const r = propagate(t.rec, now);
    if (!r || !Number.isFinite(r.alt)) continue;
    const cls = classify(r.alt);
    if (taken[cls] >= CLASS_CAP[cls]) continue;
    taken[cls]++;
    out.push({
      name: t.name,
      noradId: t.noradId,
      rec: t.rec,
      cls,
      color: COLOR[cls],
      period: orbitalPeriodMinutes(t.rec),
    });
    const total = taken.LEO + taken.MEO + taken.GEO + taken.HEO;
    const max = CLASS_CAP.LEO + CLASS_CAP.MEO + CLASS_CAP.GEO + CLASS_CAP.HEO;
    if (total >= max) break;
  }
  return out;
}

// Sample one full orbital period in N steps and return [lat, lon, altR]
// triples where altR is altitude in Earth radii (globe.gl's altitude unit).
function buildPathPoints(rec, now, periodMinutes) {
  const periodMs = periodMinutes * 60 * 1000;
  const pts = [];
  let prevLon = null;
  for (let i = 0; i <= POINTS_PER_ORBIT; i++) {
    const t = new Date(now.getTime() + (i / POINTS_PER_ORBIT) * periodMs);
    const r = propagate(rec, t);
    if (!r || !Number.isFinite(r.lat)) continue;
    // Avoid a glitchy seam when the longitude wraps ±180° between samples —
    // globe.gl interpolates straight across the dateline otherwise.
    let lon = r.lon;
    if (prevLon !== null && Math.abs(lon - prevLon) > 180) {
      lon += lon < prevLon ? 360 : -360;
    }
    prevLon = lon;
    pts.push([r.lat, lon, r.alt / EARTH_R_KM]);
  }
  return pts;
}

function rebuildPaths() {
  const now = new Date();
  selected = selectSatellites(now);
  const paths = selected.map(s => ({
    name: s.name,
    cls: s.cls,
    color: s.color,
    period: s.period,
    points: buildPathPoints(s.rec, now, s.period),
  }));
  globe.pathsData(paths);
  document.getElementById('orb-count').textContent = paths.length;
}

function refreshDots() {
  if (!selected.length) return;
  const now = new Date();
  const dots = [];
  for (const s of selected) {
    const r = propagate(s.rec, now);
    if (!r) continue;
    dots.push({ lat: r.lat, lon: r.lon, alt: r.alt, name: s.name, cls: s.cls, color: s.color });
  }
  globe.htmlElementsData(dots);
}

// --- Boot -----------------------------------------------------------------

(async function main() {
  try {
    await loadCatalog();
    rebuildPaths();
    refreshDots();
    setInterval(refreshDots, REFRESH_MS_DOTS);
    setInterval(rebuildPaths, REFRESH_MS_PATHS);
  } catch (e) {
    console.error(e);
    setStatus(`Load failed: ${e.message}`, 'err');
    document.getElementById('orb-count').textContent = '!';
  }
})();
