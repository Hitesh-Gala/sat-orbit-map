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

// --- Click-to-toggle orbital ground tracks --------------------------------
// Map<noradId, { points, name, color }> — one entry per orbit currently
// drawn.  Clicking a sat dot adds/removes its entry; the path layer is
// rebuilt from Map.values() each time.
const shownOrbits = new Map();

function orbitalPeriodMinutes(rec) {
  // satellite.js's no is mean motion in radians/min; T = 2π / no.
  return (2 * Math.PI) / rec.no;
}

function buildPathPoints(rec, now, periodMinutes) {
  const periodMs = periodMinutes * 60 * 1000;
  const N = 96;  // 96 samples around one full orbit
  const pts = [];
  let prevLon = null;
  for (let i = 0; i <= N; i++) {
    const t = new Date(now.getTime() + (i / N) * periodMs);
    const r = propagate(rec, t);
    if (!r || !Number.isFinite(r.lat)) continue;
    // Avoid the path drawing a straight line across the dateline.
    let lon = r.lon;
    if (prevLon !== null && Math.abs(lon - prevLon) > 180) {
      lon += lon < prevLon ? 360 : -360;
    }
    prevLon = lon;
    pts.push([r.lat, lon, r.alt / EARTH_R_KM]);
  }
  return pts;
}

function toggleOrbit(d) {
  if (!d || !d.rec || d.noradId == null) return;
  if (shownOrbits.has(d.noradId)) {
    shownOrbits.delete(d.noradId);
  } else {
    const period = orbitalPeriodMinutes(d.rec);
    if (!Number.isFinite(period) || period <= 0) return;
    shownOrbits.set(d.noradId, {
      points: buildPathPoints(d.rec, new Date(), period),
      name:   d.name,
      color:  d.cn ? '#ff6b6b' : '#67e8a4',
    });
  }
  globe.pathsData([...shownOrbits.values()]);
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
  .pointLabel(satLabelHtml)
  // Click a sat dot to toggle its full-orbit ground track on / off.
  .onPointClick(d => toggleOrbit(d))
  // Path layer for the click-to-show ground tracks.
  .pathsData([])
  .pathPoints(d => d.points)
  .pathPointLat(p => p[0])
  .pathPointLng(p => p[1])
  .pathPointAlt(p => p[2])
  .pathColor(d => [d.color, d.color])
  .pathStroke(0.6)
  .pathTransitionDuration(0)
  .pathLabel(d => `<b>${d.name}</b><br>orbital ground track`);

// World boundaries come from Natural Earth 50 m; the India boundary is
// substituted with the Survey of India outline so the political map of
// India shown on the globe matches the official Indian government
// depiction (Aksai Chin, PoK, Arunachal Pradesh all shown as Indian
// territory).  Antarctica is dropped (it dominates the south pole and
// the user-facing globe doesn't gain from it).
Promise.all([
  fetch(COUNTRIES_URL).then(r => r.json()),
  fetch('data/india-soi.geojson').then(r => r.json()),
])
  .then(([ne, soi]) => {
    const world = ne.features.filter(f =>
      f.properties.ISO_A2 !== 'AQ' && f.properties.ISO_A2 !== 'IN'
    );
    const india = soi.features.map(f => ({
      ...f,
      properties: { ...(f.properties || {}), ADMIN: 'India', source: 'Survey of India' },
    }));
    globe.polygonsData([...world, ...india]);
  })
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

// --- Mobile pill toggles (MENU / DATA) -----------------------------------
// On viewports ≤ 720 px both side-panels are hidden by default; the two
// top-corner pills surface them on tap.  Opening one closes the other so
// the globe behind is never sandwiched between two overlays.
(function setupPills() {
  const nav = document.getElementById('nav-toggle');
  const dat = document.getElementById('hud-toggle');
  if (!nav || !dat) return;
  nav.addEventListener('click', e => {
    e.stopPropagation();
    document.body.classList.toggle('nav-open');
    document.body.classList.remove('hud-open');
  });
  dat.addEventListener('click', e => {
    e.stopPropagation();
    document.body.classList.toggle('hud-open');
    document.body.classList.remove('nav-open');
  });
  // Tapping outside any open panel closes it — common mobile pattern.
  document.addEventListener('click', e => {
    const tr = document.querySelector('.hud-tr');
    const ln = document.querySelector('.left-nav');
    if (document.body.classList.contains('hud-open') && tr && !tr.contains(e.target) && e.target !== dat && !dat.contains(e.target)) {
      document.body.classList.remove('hud-open');
    }
    if (document.body.classList.contains('nav-open') && ln && !ln.contains(e.target) && e.target !== nav && !nav.contains(e.target)) {
      document.body.classList.remove('nav-open');
    }
  });
})();

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
  document.getElementById('tracked-asof').textContent = `as of ${asof}`;
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

  // Split visible-from-New-Delhi sats into PRC and non-PRC up-front; both
  // lists feed their own HUD panel and the globe-marker layer pulls from
  // their union.
  const visibleNonCN = [];
  const visibleCN    = [];
  const markers      = [];

  for (const t of activeTLEs) {
    const r = propagate(t.rec, now, OBSERVER);
    if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    if (r.el <= 0) continue;  // ignore below-horizon objects
    const isCn = prcMeta.has(t.noradId);
    const item = {
      name: t.name, az: r.az, el: r.el, range: r.range,
      alt: r.alt, lat: r.lat, lon: r.lon, cn: isCn,
      // Carry the satrec + NORAD ID through to the globe-marker layer
      // so onPointClick can propagate one orbital period on demand.
      rec: t.rec, noradId: t.noradId,
    };
    if (isCn) {
      const meta = prcMeta.get(t.noradId);
      item.purpose = inferPurpose(t.name);
      item.launch  = meta?.launch || '—';
      visibleCN.push(item);
    } else {
      visibleNonCN.push(item);
    }
  }

  // Globe markers — top-N highest elevations from the combined set.
  const all = visibleNonCN.concat(visibleCN).sort((a, b) => b.el - a.el);
  for (const s of all.slice(0, MAX_VISIBLE_MARKERS)) {
    markers.push({
      lat: s.lat, lon: s.lon, alt: s.alt,
      name: s.name, cn: s.cn,
      az: s.az, el: s.el,
      rec: s.rec, noradId: s.noradId,
    });
  }

  document.getElementById('vis-count').textContent = visibleNonCN.length;
  document.getElementById('cn-count').textContent  = visibleCN.length;

  visibleNonCN.sort((a, b) => b.el - a.el);
  document.getElementById('vis-list').innerHTML = visibleNonCN.slice(0, 200).map(s => `
    <div class="item">
      <div class="name">${esc(s.name)}</div>
      <div class="meta">
        Az <strong>${s.az.toFixed(1)}°</strong> ${compass(s.az)}
        · El <strong>${s.el.toFixed(1)}°</strong>
        · ${s.range.toFixed(0)} km
      </div>
      <div class="meta muted">Alt ${s.alt.toFixed(0)} km · sub-pt ${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°</div>
    </div>`).join('') || '<div class="hint">No non-Chinese satellites above the horizon.</div>';

  visibleCN.sort((a, b) => b.el - a.el);
  document.getElementById('cn-list').innerHTML = visibleCN.map(s => `
    <div class="item">
      <div class="name">${esc(s.name)} <span class="tag cn">CN</span></div>
      <div class="meta">
        Az <strong>${s.az.toFixed(1)}°</strong> ${compass(s.az)}
        · El <strong>${s.el.toFixed(1)}°</strong>
        · ${s.range.toFixed(0)} km
      </div>
      <div class="meta muted">${esc(s.purpose)} · Alt ${s.alt.toFixed(0)} km · sub-pt ${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°</div>
    </div>`).join('') || '<div class="hint">No Chinese payloads currently above the horizon.</div>';

  globe.pointsData(markers);
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
