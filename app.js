// Argos satellite tracker
// Data: CelesTrak GP catalog (TLE) + SATCAT records.
// Math: satellite.js (SGP4) for ECI -> geodetic + observer look angles.

const OBSERVER = { lat: 28.6139, lon: 77.2090, alt: 0.216 }; // New Delhi (km)
const REFRESH_MS = 10_000;
const RELOAD_TLE_MS = 6 * 3600 * 1000;
const EARTH_R_KM = 6371;
const MAX_VISIBLE_MARKERS = 250;

// CelesTrak endpoints — CORS-enabled, no API key required.
const TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle';
const SATCAT_BASE = 'https://celestrak.org/satcat/records.php';

// SATCAT records.php requires a NAME prefix per request (an empty/SOURCE-only
// query is rejected). To enumerate Chinese payloads we fan-out across the
// program designations that account for >95% of active PRC payloads, then
// filter the responses by OWNER==='PRC'.
const CN_NAME_PREFIXES = [
  'BEIDOU', 'YAOGAN', 'GAOFEN', 'FENGYUN', 'FY-', 'HAIYANG', 'HY-',
  'TIANGONG', 'TIANHE', 'WENTIAN', 'MENGTIAN', 'TIANZHOU', 'SHENZHOU',
  'TIANLIAN', 'SHIYAN', 'SHIJIAN', 'SJ-', 'ZIYUAN', 'ZY-',
  'CHINASAT', 'ZHONGXING', 'ZX-', 'APSTAR', 'CBERS', 'XINGYUN',
  'HONGYAN', 'GUOWANG', 'QIANFAN', 'TJS', 'TJSW', 'TIANHUI',
  'JILIN', 'KUAIZHOU', 'KZ-', 'LUDI TANCE', 'LT-', 'MOZI', 'QUESS',
  'XUNTIAN', 'CSS', 'DAMPE', 'HXMT', 'CENTISPACE', 'PIESAT',
  'CHANG', 'TIANXING', 'HEAD', 'XINGSHIDAI', 'YINHE',
];

// Inferred mission category from Chinese satellite name prefix.
// SATCAT itself does not carry a "purpose" field; these are the publicly
// stated mission families for each program designation.
const CN_PURPOSE = [
  [/^BEIDOU/i,                'Navigation (BeiDou PNT)'],
  [/^FENGYUN|^FY[- ]/i,       'Meteorology (weather)'],
  [/^YAOGAN/i,                'Earth observation (recon, military)'],
  [/^GAOFEN/i,                'High-resolution Earth observation (CHEOS)'],
  [/^HAIYANG|^HY[- ]/i,       'Ocean observation'],
  [/^TIANGONG|TIANHE|WENTIAN|MENGTIAN|^CSS/i, 'Crewed space station module'],
  [/^TIANZHOU/i,              'Cargo resupply (CSS)'],
  [/^SHENZHOU/i,              'Crewed spacecraft'],
  [/^TIANLIAN/i,              'Data relay (TDRSS-class)'],
  [/^SHIYAN/i,                'Experimental / technology demo'],
  [/^SHIJIAN|^SJ[- ]/i,       'Experimental / technology demo'],
  [/^ZIYUAN|^ZY[- ]/i,        'Land resources / mapping'],
  [/^CHINASAT|^ZHONGXING|^ZX[- ]/i, 'Communications (state telecom)'],
  [/^APSTAR/i,                'Communications (commercial)'],
  [/^CBERS/i,                 'Earth resources (China-Brazil)'],
  [/^XINGYUN/i,               'IoT / narrowband comms'],
  [/^HONGYAN/i,               'LEO communications'],
  [/^GUOWANG/i,               'LEO broadband constellation (Guowang)'],
  [/^QIANFAN|^G60/i,          'LEO broadband constellation (Qianfan/G60)'],
  [/^XUNTIAN/i,               'Astrophysics'],
  [/^MOZI|QUESS/i,            'Quantum communications experiment'],
  [/^DAMPE|HXMT|EINSTEIN PROBE|EP[- ]/i, 'Astrophysics / cosmic rays'],
  [/^DFH|^DONGFANGHONG/i,     'Communications (legacy)'],
  [/^LING|^XW[- ]|^TIANXING/i,'Amateur / experimental smallsat'],
  [/^TJSW|^TJS[- ]/i,         'GEO comms / signals (TJS series)'],
  [/^LUDI TANCE|LT[- ]/i,     'Synthetic-aperture radar (SAR)'],
  [/^MACAU/i,                 'Geomagnetic / scientific'],
  [/^ROCKET|R\/B/i,           'Rocket body (debris)'],
];
function inferPurpose(name) {
  for (const [re, p] of CN_PURPOSE) if (re.test(name)) return p;
  return 'Not publicly stated';
}

// --- Globe -----------------------------------------------------------------

const globe = Globe()(document.getElementById('globe'))
  .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
  .bumpImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png')
  .backgroundImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/night-sky.png')
  .showAtmosphere(true)
  .atmosphereColor('#4ea8ff')
  .atmosphereAltitude(0.18)
  .pointOfView({ lat: 22, lng: 80, altitude: 2.4 }, 0);

// OrbitControls give pinch-zoom on touch and drag-rotate on mouse out of the box.
const controls = globe.controls();
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.rotateSpeed = 0.5;
controls.zoomSpeed = 0.8;
controls.minDistance = 110;
controls.maxDistance = 800;

// HTML element overlay for satellite markers — avoids needing direct
// Three.js access from this script and merges nicely with our CSS.
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
  // globe.gl auto-sizes from container, but force a redraw on orientation flip
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

// --- Data fetch -----------------------------------------------------------

function parseTLE(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length - 2; i++) {
    if (lines[i + 1] && lines[i + 1][0] === '1' && lines[i + 2] && lines[i + 2][0] === '2') {
      const name = lines[i].trim();
      const l1 = lines[i + 1];
      const l2 = lines[i + 2];
      const noradId = parseInt(l1.slice(2, 7), 10);
      out.push({ name, l1, l2, noradId });
      i += 2;
    }
  }
  return out;
}

// localStorage cache — CelesTrak rate-limits aggressively; refetch sparingly.
const CACHE_TTL = {
  tle: 6 * 3600 * 1000,     // 6h: TLE accuracy degrades after ~1 day, 6h is plenty
  satcat: 24 * 3600 * 1000, // 24h: SATCAT metadata changes rarely
};
function cacheGet(key, ttlMs) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - t > ttlMs) return null;
    return v;
  } catch { return null; }
}
function cacheSet(key, v) {
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch {}
}

async function fetchTLEs() {
  const cached = cacheGet('argos.tle', CACHE_TTL.tle);
  if (cached) return cached;
  const r = await fetch(TLE_URL);
  if (!r.ok) throw new Error(`TLE HTTP ${r.status}`);
  const parsed = parseTLE(await r.text());
  cacheSet('argos.tle', parsed);
  return parsed;
}

// Run async tasks with bounded concurrency.
async function pmap(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

async function fetchChinaSatcat() {
  const cached = cacheGet('argos.satcat.prc', CACHE_TTL.satcat);
  if (cached) return cached;

  // 4-way concurrent fan-out keeps us well under CelesTrak's polite-use threshold.
  const arrays = await pmap(CN_NAME_PREFIXES, 4, async name => {
    try {
      const r = await fetch(`${SATCAT_BASE}?NAME=${encodeURIComponent(name)}&FORMAT=json`);
      if (!r.ok) return [];
      const txt = await r.text();
      try { return JSON.parse(txt); } catch { return []; }
    } catch { return []; }
  });

  const seen = new Set();
  const out = [];
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const r of arr) {
      if (r.OWNER !== 'PRC') continue;
      if (r.OBJECT_TYPE !== 'PAY') continue;
      if (r.DECAY_DATE) continue;
      if (seen.has(r.NORAD_CAT_ID)) continue;
      seen.add(r.NORAD_CAT_ID);
      out.push(r);
    }
  }
  cacheSet('argos.satcat.prc', out);
  return out;
}

// Propagate one TLE to `now` and compute look-angles from `observer`.
function propagate(rec, now, observer) {
  const pv = satellite.propagate(rec, now);
  if (!pv || !pv.position) return null;
  const gmst = satellite.gstime(now);
  const gd = satellite.eciToGeodetic(pv.position, gmst);
  const ecf = satellite.eciToEcf(pv.position, gmst);
  const obs = {
    longitude: satellite.degreesToRadians(observer.lon),
    latitude:  satellite.degreesToRadians(observer.lat),
    height:    observer.alt,
  };
  const look = satellite.ecfToLookAngles(obs, ecf);
  return {
    lat:   satellite.degreesLat(gd.latitude),
    lon:   satellite.degreesLong(gd.longitude),
    alt:   gd.height,
    az:    satellite.radiansToDegrees(look.azimuth),
    el:    satellite.radiansToDegrees(look.elevation),
    range: look.rangeSat,
  };
}

// --- App state ------------------------------------------------------------

let activeTLEs = [];           // [{ name, noradId, rec }]
const prcMeta = new Map();     // noradId -> { launch, name, opsStatus }

function setStatus(msg, cls = '') {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = cls;
}

async function loadAll() {
  setStatus('Fetching TLE catalog…');
  const [tles, satcat] = await Promise.all([fetchTLEs(), fetchChinaSatcat()]);

  activeTLEs = [];
  for (const t of tles) {
    try {
      const rec = satellite.twoline2satrec(t.l1, t.l2);
      activeTLEs.push({ name: t.name, noradId: t.noradId, rec });
    } catch { /* skip malformed */ }
  }

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

  setStatus(`Loaded ${activeTLEs.length.toLocaleString()} active TLEs · ${prcMeta.size.toLocaleString()} CN payloads`);
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

  // Markers: top-N visible-from-Delhi sats, plus all active Chinese sats.
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
