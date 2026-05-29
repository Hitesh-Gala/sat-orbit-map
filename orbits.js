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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function satLabelHtml(d) {
  return `<div class="sat-tip">`
       + `<b>${escapeHtml(d.name)}</b>`
       + `<div>${d.alt.toFixed(0)} km · ${d.lat.toFixed(2)}°, ${d.lon.toFixed(2)}°</div>`
       + `<div class="cls" style="color:${d.color}">${d.cls} orbit</div>`
       + `</div>`;
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
  // Live satellite dots — small radial bars from surface to altitude with
  // globe.gl's built-in pointLabel tooltip on hover.
  .pointsData([])
  .pointLat(d => d.lat)
  .pointLng(d => d.lon)
  .pointAltitude(d => d.alt / EARTH_R_KM)
  .pointRadius(0.2)
  .pointResolution(6)
  .pointColor(d => d.color)
  .pointsMerge(false)
  .pointLabel(satLabelHtml)
  // Periodically-flashed satellite name labels (orbits.html only).
  // Driven by maybeFlashLabels() while the NAZAR track is playing.
  .labelsData([])
  .labelLat(d => d.lat)
  .labelLng(d => d.lng)
  .labelAltitude(d => d.alt)
  .labelText(d => d.name)
  .labelColor(d => d.color)
  .labelSize(1.0)
  .labelDotRadius(0.28)
  .labelResolution(2)
  .labelIncludeDot(true);

const controls = globe.controls();
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.rotateSpeed = 0.5;
controls.zoomSpeed = 0.8;
controls.minDistance = 150;
controls.maxDistance = 1400;

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
  globe.pointsData(dots);
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

// --- NAZAR soundtrack + beat-driven globe motion -------------------------
//
// User taps Play NAZAR → we boot a Web Audio graph (AudioContext +
// AnalyserNode tapping the <audio> element), then in every frame inspect
// the low-frequency band for energy spikes against a running average.  A
// spike that clears (mean + k·σ) within a 250-ms refractory window counts
// as a beat, which animates globe.gl's pointOfView() to a randomly-picked
// nearby camera — left/right swing, up/down tilt, or zoom in/out.
//
// All side-effects are no-ops if the audio element or AudioContext isn't
// available (e.g. browser blocks autoplay before first gesture).

(function setupNazarSoundtrack() {
  const audio = document.getElementById('nazar-audio');
  const btn   = document.getElementById('audio-toggle');
  if (!audio || !btn) return;

  const icoEl = btn.querySelector('.btn-nav-icon');
  const lblEl = btn.querySelector('.btn-nav-label');

  // The NAZAR track sits around 128-130 BPM, so we don't bother
  // analysing the audio — we just lock the globe transitions to a
  // fixed 129-BPM clock (≈ 465 ms per beat).  Set the BPM here if the
  // track is ever swapped.
  const TRACK_BPM = 129;
  const BEAT_MS   = Math.round(60000 / TRACK_BPM);

  let beatTimer = null;
  let lastMoveAt = 0;

  // Periodic "zoom pulse" — every 10-15 s a 3-4 s window where the
  // camera altitude oscillates in / out continuously, overriding the
  // beat-driven jolts for that window.
  let nextPulseAt  = 0;
  let pulseStartAt = 0;
  let pulseEndAt   = 0;
  let pulseTimer   = null;

  // Periodic "flash labels" — every 15 s, show the names of the
  // selected satellites floating at their current 3-D positions for
  // ~4.5 s, then clear them.
  let nextFlashAt = 0;
  let flashOffAt  = 0;
  let flashTimer  = null;

  // --- Did-you-know factoid popup (immersive only) ---------------------
  //
  // Sources for static facts: NASA SSDC, ESA Earth-online, CNSA English
  // press releases, China Manned Space Agency (CMSA) bulletins.  These
  // are facts that were public knowledge as of late 2024 — bundled
  // locally so the popup works offline (no live scraping).
  const STATIC_FACTS = [
    "CNSA, the China National Space Administration, was established in April 1993.",
    "China's first satellite, Dong Fang Hong 1, launched on 24 April 1970 — making China the fifth nation to orbit a satellite independently.",
    "The Tiangong space station's core module, Tianhe, was launched on 29 April 2021 from Wenchang on a Long March 5B.",
    "Wentian (24 July 2022) and Mengtian (31 October 2022) docked to Tianhe to complete the three-module, T-shaped Tiangong.",
    "BeiDou-3, completed in 2020, gives China a 30-satellite global PNT constellation independent of GPS / Galileo / GLONASS.",
    "Shenzhou 5 carried Yang Liwei — China's first astronaut — to orbit on 15 October 2003.",
    "Chang'e 4 became the first probe to soft-land on the lunar far side, in Von Kármán crater, on 3 January 2019.",
    "Long March 5 is China's heaviest operational launch vehicle, with a 25-tonne low-Earth-orbit payload capacity.",
    "The Yaogan family — first launched in 2006 — is China's largest dedicated optical / SAR reconnaissance satellite line.",
    "Tiangong orbits at roughly 340-450 km altitude and hosts a rotating three-person crew on six-month missions.",
    "Chang'e 5 returned 1.731 kg of lunar regolith to Earth on 16 December 2020, the first lunar sample return since 1976.",
    "The Tianwen-1 mission delivered the Zhurong rover to Mars in May 2021, making China the second nation to operate a rover on the planet.",
    "The Wenchang Space Launch Site on Hainan island, opened in 2014, is the only Chinese launch facility at low latitude (~19° N) and the only one able to host Long March 5.",
    "Mozi (QUESS), launched in 2016, was the world's first quantum-communications satellite.",
    "The Gaofen series of high-resolution Earth-observation satellites underpins the China High-Resolution Earth Observation System (CHEOS).",
  ];

  // Active PRC programmes the factoid will count live above the India
  // horizon.  inferred purpose mirrors the CN_PURPOSE table the rest of
  // the site uses for satellite-name → mission inference.
  const CN_PROGRAMS = [
    { prefix: 'BEIDOU',  label: 'BeiDou',  purpose: 'global navigation (PNT)' },
    { prefix: 'FENGYUN', label: 'Fengyun', purpose: 'meteorological observation' },
    { prefix: 'GAOFEN',  label: 'Gaofen',  purpose: 'high-resolution Earth observation (CHEOS)' },
    { prefix: 'HAIYANG', label: 'Haiyang', purpose: 'ocean observation' },
    { prefix: 'JILIN',   label: 'Jilin-1', purpose: 'commercial Earth observation' },
    { prefix: 'SHIJIAN', label: 'Shijian', purpose: 'in-orbit technology demonstration' },
    { prefix: 'YAOGAN',  label: 'Yaogan',  purpose: 'reconnaissance / SIGINT' },
    { prefix: 'ZIYUAN',  label: 'Ziyuan',  purpose: 'land-resources & mapping' },
  ];

  const OBSERVER = window.Argos?.OBSERVER || { lat: 28.6139, lon: 77.2090, alt: 0.216 };
  const prcMeta = new Map();   // noradId → { launch }
  let factoidTimer = null;

  async function loadPrcMeta() {
    if (prcMeta.size || !window.Argos) return;
    try {
      const records = await window.Argos.fetchChinaSatcat();
      for (const r of records) {
        const id = parseInt(r.NORAD_CAT_ID, 10);
        if (!Number.isFinite(id)) continue;
        prcMeta.set(id, { launch: r.LAUNCH_DATE || '' });
      }
    } catch (e) {
      console.warn('Factoid: CN SATCAT load failed', e?.message);
    }
  }

  function visibleCnAboveIndia() {
    if (!activeTLEs.length || !prcMeta.size) return [];
    const now = new Date();
    const out = [];
    for (const t of activeTLEs) {
      if (!prcMeta.has(t.noradId)) continue;
      const r = window.Argos.propagate(t.rec, now, OBSERVER);
      if (!r || r.el <= 0) continue;
      out.push({ name: t.name, noradId: t.noradId, meta: prcMeta.get(t.noradId) });
    }
    return out;
  }

  function buildFactoid() {
    const r = Math.random();
    const cnVis = visibleCnAboveIndia();
    if (r < 0.18) {
      const n = cnVis.filter(s => /^BEIDOU/i.test(s.name)).length;
      return `${n} BeiDou navigation satellites are above India right now, beaming PNT signals on B1 / B2 / B3.`;
    }
    if (r < 0.55) {
      const prog = CN_PROGRAMS[Math.floor(Math.random() * CN_PROGRAMS.length)];
      const matches = cnVis.filter(s => new RegExp('^' + prog.prefix, 'i').test(s.name));
      const launches = matches.map(s => s.meta.launch).filter(Boolean).sort();
      const since = launches.length
        ? ` Earliest above India right now has been in orbit since ${launches[0]}.`
        : '';
      return `${matches.length} ${prog.label} satellites — ${prog.purpose} — are above India right now.${since}`;
    }
    return STATIC_FACTS[Math.floor(Math.random() * STATIC_FACTS.length)];
  }

  function showNextFactoid() {
    // The HTML uses <aside id="factoid" class="factoid-popup">
    //   <div class="factoid-prefix">Did you know…</div>
    //   <div class="factoid-text">…</div>
    // Target the .factoid-text descendant for the rotating body copy.
    const body = document.querySelector('#factoid .factoid-text')
              || document.getElementById('factoid-body');
    if (!body) return;
    body.style.opacity = '0';
    setTimeout(() => {
      body.textContent = buildFactoid();
      body.style.opacity = '1';
    }, 200);
  }
  function startFactoidRotation() {
    if (factoidTimer) return;
    showNextFactoid();
    factoidTimer = setInterval(showNextFactoid, 8000);
  }
  function stopFactoidRotation() {
    if (factoidTimer) { clearInterval(factoidTimer); factoidTimer = null; }
  }

  // Factoid rotator (immersive mode only).
  let factoidData    = null;   // populated by fetch('data/cn-factoids.json')
  let factoidTimer   = null;
  let factoidIndex   = 0;
  // Approximate India bounding box for the "over India" headcount.
  const INDIA_BBOX   = { latMin: 6,  latMax: 37, lonMin: 68, lonMax: 97 };
  fetch('data/cn-factoids.json').then(r => r.json()).then(d => { factoidData = d; }).catch(() => {});

  // No-op now that the cadence is BPM-locked; kept for the
  // future-proofing path of restoring audio-reactive beat detection
  // without rewriting the player UI.
  function ensureGraph() {}

  // Country attractors used by the "zoom to country" jolt mode.  Centroids
  // are eyeballed so the camera framing shows the country fully without
  // cropping to a single city.
  const COUNTRIES = [
    { name: 'India',  lat: 22.0, lng:  78.0 },
    { name: 'China',  lat: 35.0, lng: 105.0 },
    { name: 'USA',    lat: 39.0, lng: -98.0 },
    { name: 'Russia', lat: 60.0, lng:  90.0 },
    { name: 'Israel', lat: 31.5, lng:  35.0 },
  ];

  function jolt() {
    // Rate-limit pointOfView calls.  Dropped 350 → 180 ms — at that
    // cadence new targets land mid-animation, so the camera is in near-
    // continuous motion with the 1300-ms sweeps overlapping heavily.
    const now = performance.now();
    if (now - lastMoveAt < 180) return;
    lastMoveAt = now;

    const pov = globe.pointOfView();
    const r = Math.random();

    if (r < 0.20) {
      // Country zoom — drop into India / China / USA / Russia / Israel.
      const c = COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
      pov.lat = c.lat + (Math.random() - 0.5) * 6;     // small jitter
      pov.lng = c.lng + (Math.random() - 0.5) * 8;
      pov.altitude = 0.35 + Math.random() * 0.20;       // country-scale view
    } else if (r < 0.35) {
      // Big zoom out — frame the full orbit family (LEO + MEO + GEO).
      pov.altitude = 3.6 + Math.random() * 1.4;         // 3.6 – 5.0 Earth radii
      pov.lat = (Math.random() - 0.5) * 50;             // gentle viewpoint shift
      pov.lng = (((pov.lng + (Math.random() - 0.5) * 90) + 540) % 360) - 180;
    } else if (r < 0.60) {
      // Diagonal sweep — combined lat + lng change so the rotation isn't
      // purely horizontal or vertical.
      pov.lng = (((pov.lng + (Math.random() - 0.5) * 240) + 540) % 360) - 180;
      pov.lat = Math.max(-82, Math.min(82, pov.lat + (Math.random() - 0.5) * 90));
    } else if (r < 0.75) {
      // Pure horizontal swing for variety.
      const dir = Math.random() < 0.5 ? -1 : 1;
      pov.lng = (((pov.lng + dir * (70 + Math.random() * 60)) + 540) % 360) - 180;
    } else if (r < 0.88) {
      // Pure vertical tilt.
      const dir = Math.random() < 0.5 ? -1 : 1;
      pov.lat = Math.max(-82, Math.min(82, pov.lat + dir * (28 + Math.random() * 32)));
    } else {
      // Closer zoom-in on whatever's currently centred.
      pov.altitude = Math.max(0.5, pov.altitude * (0.45 + Math.random() * 0.15));
    }
    globe.pointOfView(pov, 1300);
  }

  // Continuous in / out zoom step driven by a sinewave.  Runs on its
  // own ~80 ms interval during a pulse window; pauses the beat-driven
  // jolts so the camera doesn't fight itself.
  function stepPulse() {
    const now = performance.now();
    if (now > pulseEndAt) {
      clearInterval(pulseTimer);
      pulseTimer = null;
      return;
    }
    // Period ≈ 1.6 s → roughly 2 full in/out cycles in a 3.5-s pulse.
    const t = (now - pulseStartAt) / 1000;
    const altitude = 1.8 + Math.sin(t * Math.PI / 0.8) * 1.2;  // 0.6 ↔ 3.0 R
    globe.pointOfView({ altitude }, 90);
  }

  function maybeStartPulse() {
    const now = performance.now();
    if (!nextPulseAt) nextPulseAt = now + 8000;  // first pulse ≈ 8 s into playback
    if (now < nextPulseAt || pulseTimer) return;
    pulseStartAt = now;
    pulseEndAt   = now + 3000 + Math.random() * 1000;            // 3-4 s window
    nextPulseAt  = pulseEndAt + 10000 + Math.random() * 5000;    // next 10-15 s later
    pulseTimer   = setInterval(stepPulse, 80);
  }

  // Fires every BEAT_MS while the soundtrack plays.
  function beatTick() {
    if (audio.paused) return;
    maybeStartPulse();
    maybeFlashLabels();
    // During the pulse window, the in/out oscillation owns the camera;
    // jolts resume the moment the pulse ends.
    if (!pulseTimer) jolt();
  }

  // --- Periodic label flash --------------------------------------------
  // Surface the currently-tracked satellite names at their 3-D positions
  // for ~4.5 s, then clear.  Repeats every 15 s while the track plays.
  function flashOn() {
    const now = new Date();
    const labels = [];
    for (const s of selected) {
      const r = propagate(s.rec, now);
      if (!r || !Number.isFinite(r.lat)) continue;
      labels.push({
        lat: r.lat, lng: r.lon, alt: r.alt / EARTH_R_KM,
        name: s.name, color: s.color,
      });
    }
    globe.labelsData(labels);
  }
  function flashOff() {
    globe.labelsData([]);
    flashTimer = null;
  }
  function maybeFlashLabels() {
    const now = performance.now();
    if (!nextFlashAt) nextFlashAt = now + 6000;  // first flash ~6 s in
    if (now < nextFlashAt || flashTimer) return;
    flashOn();
    flashOffAt  = now + 4500;
    nextFlashAt = flashOffAt + 10500;            // ≈ 15 s cadence
    flashTimer  = setTimeout(flashOff, 4500);
  }

  function setUiPlaying(playing) {
    icoEl.textContent = playing ? '⏸' : '♪';
    lblEl.textContent = playing ? 'Pause NAZAR' : 'Play NAZAR';
    btn.style.color = playing ? 'var(--accent2)' : '';
  }

  // Immersive mode helpers: hide all chrome except the Pause toggle and
  // request browser fullscreen.  ESC (or any other gesture that exits
  // fullscreen) triggers the `fullscreenchange` listener below to lift
  // the immersive class so the normal UI returns.
  async function enterImmersive() {
    document.body.classList.add('immersive');
    // Lazy-load PRC SATCAT records (needed for the live-count factoids).
    // Even if it's still pending the first factoid will be a static one,
    // so the popup is never stuck empty.
    loadPrcMeta();
    startFactoidRotation();
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch (e) {
      console.warn('Fullscreen request denied:', e.message);
    }
  }
  function exitImmersive() {
    document.body.classList.remove('immersive');
    stopFactoidRotation();
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      document.body.classList.remove('immersive');
      stopFactoidRotation();
    }
  });

  btn.addEventListener('click', async () => {
    try {
      ensureGraph();
      if (audio.paused) {
        await audio.play();
        setUiPlaying(true);
        // Start (or re-start) the BPM-locked clock.  Reset gap timers so
        // the first jolt fires immediately rather than after a stale gap.
        lastMoveAt = 0;
        if (!beatTimer) beatTimer = setInterval(beatTick, BEAT_MS);
        await enterImmersive();
      } else {
        audio.pause();
        setUiPlaying(false);
      }
    } catch (e) {
      console.warn('Soundtrack play failed:', e);
      lblEl.textContent = 'Audio blocked';
    }
  });

  function stopTimers() {
    if (beatTimer)    { clearInterval(beatTimer);    beatTimer    = null; }
    if (pulseTimer)   { clearInterval(pulseTimer);   pulseTimer   = null; }
    if (flashTimer)   { clearTimeout(flashTimer);    flashTimer   = null; }
    if (factoidTimer) { clearInterval(factoidTimer); factoidTimer = null; }
    globe.labelsData([]);
  }

  // --- Factoid rotator -----------------------------------------------------

  function isOverIndia(lat, lon) {
    return lat >= INDIA_BBOX.latMin && lat <= INDIA_BBOX.latMax
        && lon >= INDIA_BBOX.lonMin && lon <= INDIA_BBOX.lonMax;
  }

  function countFamilyOverIndia(family) {
    if (!activeTLEs || !activeTLEs.length) return 0;
    const re = new RegExp(family.regex, 'i');
    let n = 0;
    const now = new Date();
    for (const t of activeTLEs) {
      if (!re.test(t.name)) continue;
      const r = propagate(t.rec, now);
      if (!r || !Number.isFinite(r.lat)) continue;
      if (isOverIndia(r.lat, r.lon)) n++;
    }
    return n;
  }

  function nextFactoid() {
    if (!factoidData) return 'Loading PRC space-programme factoids…';
    const fams  = factoidData.families || [];
    const facts = factoidData.facts    || [];
    const pool  = fams.length + facts.length;
    if (!pool) return '';
    factoidIndex = (factoidIndex + 1) % pool;
    if (factoidIndex < fams.length) {
      const f = fams[factoidIndex];
      const n = countFamilyOverIndia(f);
      const plural = n === 1 ? 'satellite is' : 'satellites are';
      const overhead = n > 0
        ? `<strong>${n}</strong> ${f.name} ${plural} currently passing over India.`
        : `No ${f.name} satellites are overhead India right now.`;
      return `${overhead} The ${f.name} programme: <em>${f.purpose}</em>. First launched ${f.firstLaunch}.`;
    }
    return facts[factoidIndex - fams.length];
  }

  function showFactoid() {
    const el = document.querySelector('#factoid .factoid-text');
    if (!el) return;
    el.innerHTML = nextFactoid();
  }

  function startFactoidRotation() {
    if (factoidTimer) return;
    factoidIndex = -1;  // so first ++ lands on 0
    showFactoid();
    factoidTimer = setInterval(showFactoid, 7000);
  }
  function stopFactoidRotation() {
    if (factoidTimer) { clearInterval(factoidTimer); factoidTimer = null; }
  }
  audio.addEventListener('pause', () => { setUiPlaying(false); stopTimers(); exitImmersive(); });
  audio.addEventListener('play',  () => setUiPlaying(true));
})();
