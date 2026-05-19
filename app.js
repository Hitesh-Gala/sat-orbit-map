// 3-D globe view. Data layer lives in tle-loader.js (window.Argos).

const { OBSERVER, EARTH_R_KM, inferPurpose, propagate, makeSatrecs,
        fetchTLEs, fetchChinaSatcat } = window.Argos;

const REFRESH_MS = 10_000;
const RELOAD_TLE_MS = 6 * 3600 * 1000;
const MAX_VISIBLE_MARKERS = 120;

// --- Globe -----------------------------------------------------------------

// Natural Earth 50 m countries — ~3 MB but coastlines and country borders
// trace the Blue Marble texture far more accurately than the bundled 110 m
// (the latter visibly drifts inland from the coast on small islands and
// peninsulas).
const COUNTRIES_URL = 'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/cultural/ne_50m_admin_0_countries.json';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Tooltip content for a satellite marker — globe.gl injects this into its
// built-in .scene-tooltip overlay on hover, matching the 2-D map UX.
function satLabelHtml(d) {
  let h = `<div class="sat-tip">`;
  h += `<b>${escapeHtml(d.name)}</b>`;
  h += `<div>${d.alt.toFixed(0)} km · ${d.lat.toFixed(2)}°, ${d.lon.toFixed(2)}°</div>`;
  if (Number.isFinite(d.az) && Number.isFinite(d.el)) {
    h += `<div>Az ${d.az.toFixed(1)}° · El ${d.el.toFixed(1)}°</div>`;
  }
  if (d.cn) h += `<div class="cn">Chinese payload</div>`;
  h += `</div>`;
  return h;
}

const NIGHT_SKY_URL = 'https://unpkg.com/three-globe@2.31.1/example/img/night-sky.png';

// Pixel-invert the night-sky texture on the fly to produce a "day-sky"
// equivalent (black stars on a white background) for the light theme.
// Generated lazily and memoised — unpkg sends Access-Control-Allow-Origin:
// *, so the canvas read isn't tainted.
let invertedSkyDataUrl = null;
async function getInvertedSkyUrl() {
  if (invertedSkyDataUrl) return invertedSkyDataUrl;
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('night-sky load failed'));
    i.src = NIGHT_SKY_URL;
  });
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

const globe = Globe()(document.getElementById('globe'))
  // Realistic Earth: NASA Blue Marble color texture + topology bump map for
  // shaded relief, against the night-sky starfield.
  .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
  .bumpImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png')
  .backgroundImageUrl(NIGHT_SKY_URL)
  .showAtmosphere(true)
  .atmosphereColor('#4ea8ff')
  .atmosphereAltitude(0.18)
  .pointOfView({ lat: 22, lng: 80, altitude: 2.4 }, 0)
  // Country polygons act as thin political borders overlaid on the texture.
  // polygonAltitude is held at a hair above the surface (≈6 km) — small
  // enough to avoid the parallax offset that 32 km caused, large enough to
  // avoid z-fighting with the textured globe.  Stroke is a soft pale cyan
  // for clean contrast against the Blue Marble's blues and greens.
  .polygonsData([])
  .polygonAltitude(0.001)
  .polygonCapColor(() => 'rgba(255, 255, 255, 0)')
  .polygonSideColor(() => 'rgba(255, 255, 255, 0)')
  .polygonStrokeColor(() => 'rgba(220, 240, 255, 0.65)')
  // Satellite markers — flat dots floating just above the surface (we
  // collapse the point altitude so globe.gl renders a low disc rather
  // than a long radial bar).  Refresh is driven by update() below, which
  // re-applies pointsData(markers) every REFRESH_MS.  Hover surfaces the
  // satellite name + altitude + lat/lon (+ Az/El when above the New
  // Delhi horizon) via globe.gl's built-in pointLabel tooltip.
  .pointsData([])
  .pointLat(d => d.lat)
  .pointLng(d => d.lon)
  .pointAltitude(0.003)
  .pointRadius(0.35)
  .pointResolution(8)
  .pointColor(d => d.cn ? '#ff6b6b' : '#67e8a4')
  .pointsMerge(false)
  .pointLabel(satLabelHtml);

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

// --- Theme toggle (light / dark) -----------------------------------------
// The 3-D globe itself is a WebGL scene that doesn't respect CSS, but the
// HUD chrome around it switches palettes via body.light class overrides.
(function setupTheme() {
  const KEY = 'argos.main.theme';
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  async function apply(mode) {
    document.body.classList.toggle('light', mode === 'light');
    btn.textContent = mode === 'light' ? '☾ Dark' : '☀ Light';
    // Swap the WebGL skybox: white sky + black stars in light mode, the
    // original night sky in dark mode.  Atmosphere tint shifts to a
    // muted gold so the rim glow still reads against the white sky.
    try {
      if (mode === 'light') {
        const url = await getInvertedSkyUrl();
        globe.backgroundImageUrl(url);
        globe.atmosphereColor('#7a8aa0');
      } else {
        globe.backgroundImageUrl(NIGHT_SKY_URL);
        globe.atmosphereColor('#4ea8ff');
      }
    } catch (e) {
      console.warn('Theme: skybox swap failed:', e.message);
    }
  }
  apply(localStorage.getItem(KEY) || 'dark');
  btn.addEventListener('click', () => {
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    localStorage.setItem(KEY, next);
    apply(next);
  });
})();

// --- App state ------------------------------------------------------------

let activeTLEs = [];
const prcMeta = new Map();

function setStatus(msg, cls = '') {
  const el = document.getElementById('status');
  if (!el) return;  // footer line was removed; keep call sites silent
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

  // Top-of-HUD tracking total + "as of" date.
  document.getElementById('tracked-count').textContent = activeTLEs.length.toLocaleString();
  const asof = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });
  document.getElementById('tracked-asof').textContent = `as of ${asof} · objects in active catalog`;
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
    markers.push({
      lat: s.lat, lon: s.lon, alt: s.alt,
      name: s.name, cn: s.cn,
      az: s.az, el: s.el,
    });
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

  globe.pointsData(markers);

  // Keep the Observer Lookup panel in sync with each tick while it's open.
  if (document.getElementById('lookup-panel')?.open) runLookup();
}

// --- Observer Lookup ------------------------------------------------------
// Propagates every satellite for the user-supplied lat/lon and lists those
// currently above the horizon, sorted by elevation.

function runLookup() {
  if (!activeTLEs.length) return;
  const latEl = document.getElementById('lookup-lat');
  const lonEl = document.getElementById('lookup-lon');
  const lat = parseFloat(latEl.value);
  const lon = parseFloat(lonEl.value);
  const countEl = document.getElementById('lookup-count');
  const listEl  = document.getElementById('lookup-list');
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
    if (!r || !Number.isFinite(r.el)) continue;
    if (r.el > 0) {
      above.push({
        name: t.name, az: r.az, el: r.el, range: r.range, alt: r.alt,
        cn: prcMeta.has(t.noradId),
      });
    }
  }
  above.sort((a, b) => b.el - a.el);
  countEl.textContent = above.length;
  listEl.innerHTML = above.slice(0, 200).map(s => `
    <div class="item">
      <div class="name">${esc(s.name)}${s.cn ? ' <span class="tag cn">CN</span>' : ''}</div>
      <div class="meta">
        Az <strong>${s.az.toFixed(1)}°</strong> ${compass(s.az)}
        · El <strong>${s.el.toFixed(1)}°</strong>
        · ${s.range.toFixed(0)} km
      </div>
      <div class="meta muted">Alt ${s.alt.toFixed(0)} km</div>
    </div>`).join('') || '<div class="hint">No satellites above this horizon right now.</div>';
}

// Wire up the lookup form: button, Enter-to-submit, and live re-compute on
// edit.  The number inputs fire 'input' on each keystroke, which would be
// chatty on the slower devices, so we debounce.
(function setupLookup() {
  const btn = document.getElementById('lookup-btn');
  const lat = document.getElementById('lookup-lat');
  const lon = document.getElementById('lookup-lon');
  const panel = document.getElementById('lookup-panel');
  if (!btn || !lat || !lon || !panel) return;
  let timer = null;
  const debounced = () => { clearTimeout(timer); timer = setTimeout(runLookup, 250); };
  btn.addEventListener('click', runLookup);
  lat.addEventListener('input', debounced);
  lon.addEventListener('input', debounced);
  panel.addEventListener('toggle', () => { if (panel.open) runLookup(); });
})();

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
