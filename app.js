// 3-D globe view. Data layer lives in tle-loader.js (window.Argos).

const { OBSERVER, EARTH_R_KM, inferPurpose, propagate, makeSatrecs,
        fetchTLEs, fetchChinaSatcat } = window.Argos;

const REFRESH_MS = 10_000;
const RELOAD_TLE_MS = 6 * 3600 * 1000;
const MAX_VISIBLE_MARKERS = 250;

// --- Globe -----------------------------------------------------------------

const COUNTRIES_URL = 'https://unpkg.com/three-globe@2.31.1/example/country-polygons/ne_110m_admin_0_countries.geojson';

const globe = Globe()(document.getElementById('globe'))
  // Realistic Earth: NASA Blue Marble color texture + topology bump map for
  // shaded relief, against the night-sky starfield.
  .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
  .bumpImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png')
  .backgroundImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/night-sky.png')
  .showAtmosphere(true)
  .atmosphereColor('#4ea8ff')
  .atmosphereAltitude(0.18)
  .pointOfView({ lat: 22, lng: 80, altitude: 2.4 }, 0)
  // Country polygons act as thin political borders overlaid on the texture:
  // transparent caps/sides so the underlying terrain shows through, and a
  // warm-white stroke for the boundary line itself.
  .polygonsData([])
  .polygonAltitude(0.005)
  .polygonCapColor(() => 'rgba(255, 255, 255, 0)')
  .polygonSideColor(() => 'rgba(255, 255, 255, 0)')
  .polygonStrokeColor(() => 'rgba(255, 240, 200, 0.55)');

fetch(COUNTRIES_URL)
  .then(r => r.json())
  .then(geo => globe.polygonsData(geo.features.filter(f => f.properties.ISO_A2 !== 'AQ')))
  .catch(e => console.warn('Country polygons failed to load:', e.message));

// OrbitControls give pinch-zoom on touch and drag-rotate on mouse out of the box.
const controls = globe.controls();
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.rotateSpeed = 0.5;
controls.zoomSpeed = 0.8;
controls.minDistance = 110;
controls.maxDistance = 800;

globe
  .htmlElementsData([])
  .htmlLat(d => d.lat)
  .htmlLng(d => d.lon)
  .htmlAltitude(d => d.alt / EARTH_R_KM)
  .htmlElement(d => {
    const el = document.createElement('div');
    el.className = 'sat-dot' + (d.cn ? ' cn' : '');
    el.title = `${d.name}\n${d.alt.toFixed(0)} km`;
    return el;
  });

window.addEventListener('resize', () => {
  globe.width(window.innerWidth).height(window.innerHeight);
});

// --- Clocks ---------------------------------------------------------------

const fmtTime = (d, tz) => d.toLocaleTimeString('en-GB', {
  hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: tz,
});
const fmtDate = (d, tz) => d.toLocaleDateString('en-GB', {
  year: 'numeric', month: 'short', day: '2-digit', timeZone: tz,
});
const utcEl  = document.getElementById('utc-time');
const istEl  = document.getElementById('ist-time');
const dateEl = document.getElementById('utc-date');
function tickClocks() {
  const now = new Date();
  utcEl.textContent  = fmtTime(now, 'UTC');
  istEl.textContent  = fmtTime(now, 'Asia/Kolkata');
  dateEl.textContent = fmtDate(now, 'UTC') + ' UTC';
}
tickClocks();
setInterval(tickClocks, 1000);

// --- App state ------------------------------------------------------------

let activeTLEs = [];
const prcMeta = new Map();

function setStatus(msg, cls = '') {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = cls;
}

async function loadAll() {
  setStatus('Fetching TLE catalog…');
  const [tleResult, satcat] = await Promise.all([fetchTLEs(), fetchChinaSatcat()]);
  const { tles, source } = tleResult;

  activeTLEs = makeSatrecs(tles);

  prcMeta.clear();
  for (const r of satcat) {
    const id = parseInt(r.NORAD_CAT_ID, 10);
    if (!Number.isFinite(id)) continue;
    prcMeta.set(id, {
      launch: r.LAUNCH_DATE || '—',
      name: r.OBJECT_NAME,
      site: r.LAUNCH_SITE || '',
      opsStatus: r.OPS_STATUS_CODE || '',
    });
  }

  const tag = source === 'celestrak' ? 'live' : source === 'cache' ? 'cached' : 'bundled snapshot';
  setStatus(`Loaded ${activeTLEs.length.toLocaleString()} TLEs (${tag}) · ${prcMeta.size.toLocaleString()} CN payloads`);
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const compass = az => {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(((az % 360) / 22.5)) % 16];
};

function update() {
  if (!activeTLEs.length) return;
  const now = new Date();

  const visible = [];
  const cnList  = [];
  const markers = [];

  for (const t of activeTLEs) {
    const r = propagate(t.rec, now, OBSERVER);
    if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    const isCn = prcMeta.has(t.noradId);

    if (r.el > 0) {
      visible.push({
        name: t.name, az: r.az, el: r.el, range: r.range,
        alt: r.alt, lat: r.lat, lon: r.lon, cn: isCn,
      });
    }
    if (isCn) {
      const meta = prcMeta.get(t.noradId);
      cnList.push({
        name: t.name,
        purpose: inferPurpose(t.name),
        launch: meta.launch,
        alt: r.alt, lat: r.lat, lon: r.lon, el: r.el,
      });
    }
  }

  visible.sort((a, b) => b.el - a.el);
  for (const s of visible.slice(0, MAX_VISIBLE_MARKERS)) {
    markers.push({ lat: s.lat, lon: s.lon, alt: s.alt, name: s.name, cn: s.cn });
  }
  for (const s of cnList) {
    if (s.el <= 0) markers.push({ lat: s.lat, lon: s.lon, alt: s.alt, name: s.name, cn: true });
  }

  document.getElementById('vis-count').textContent = visible.length;
  document.getElementById('cn-count').textContent  = cnList.length;

  document.getElementById('vis-list').innerHTML = visible.slice(0, 200).map(s => `
    <div class="item">
      <div class="name">${esc(s.name)}${s.cn ? ' <span class="tag cn">CN</span>' : ''}</div>
      <div class="meta">
        Az <strong>${s.az.toFixed(1)}°</strong> ${compass(s.az)}
        · El <strong>${s.el.toFixed(1)}°</strong>
        · ${s.range.toFixed(0)} km
      </div>
      <div class="meta muted">Alt ${s.alt.toFixed(0)} km · sub-pt ${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°</div>
    </div>`).join('') || '<div class="hint">No satellites currently above the horizon.</div>';

  cnList.sort((a, b) => a.name.localeCompare(b.name));
  document.getElementById('cn-list').innerHTML = cnList.map(s => `
    <div class="item">
      <div class="name">${esc(s.name)} <span class="tag cn">CN</span></div>
      <div class="meta"><strong>${esc(s.purpose)}</strong></div>
      <div class="meta muted">
        Launched ${esc(s.launch)} · Alt ${s.alt.toFixed(0)} km
        · Pos ${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°
      </div>
    </div>`).join('') || '<div class="hint">No active Chinese payloads matched the active TLE catalog.</div>';

  globe.htmlElementsData(markers);
}

// --- Boot -----------------------------------------------------------------

(async function main() {
  document.getElementById('vis-count').textContent = '…';
  document.getElementById('cn-count').textContent  = '…';
  try {
    await loadAll();
    update();
    setInterval(update, REFRESH_MS);
    setInterval(() => {
      loadAll().then(update).catch(e => {
        console.warn('TLE refresh failed:', e);
        setStatus(`Refresh failed: ${e.message} · using cached catalog`, 'warn');
      });
    }, RELOAD_TLE_MS);
  } catch (e) {
    console.error(e);
    setStatus(`Load failed: ${e.message}`, 'err');
    document.getElementById('vis-count').textContent = '!';
    document.getElementById('cn-count').textContent  = '!';
  }
})();
