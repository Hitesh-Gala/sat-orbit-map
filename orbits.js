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
  .pointLabel(satLabelHtml);

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

  let audioCtx = null, analyser = null, srcNode = null, freq = null;
  let beatLoopId = null;
  let lastBeatAt = 0;
  let lastMoveAt = 0;
  const energyHistory = [];

  function ensureGraph() {
    if (audioCtx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    srcNode  = audioCtx.createMediaElementSource(audio);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.55;
    freq = new Uint8Array(analyser.frequencyBinCount);
    srcNode.connect(analyser);
    analyser.connect(audioCtx.destination);
  }

  function isBeat() {
    if (!analyser) return false;
    analyser.getByteFrequencyData(freq);
    // Bass / kick band: roughly bins 1-13 (≈ 40–550 Hz at 44.1 kHz / 1024 fft).
    let sum = 0;
    for (let i = 1; i < 14; i++) sum += freq[i];
    const bass = sum / 13;

    energyHistory.push(bass);
    if (energyHistory.length > 48) energyHistory.shift();
    let mean = 0;
    for (const v of energyHistory) mean += v;
    mean /= energyHistory.length;
    let variance = 0;
    for (const v of energyHistory) variance += (v - mean) * (v - mean);
    const std = Math.sqrt(variance / energyHistory.length);

    const now = performance.now();
    const refractoryOk = now - lastBeatAt > 250;
    if (refractoryOk && bass > mean + std * 1.6 && bass > 85) {
      lastBeatAt = now;
      return true;
    }
    return false;
  }

  function jolt() {
    // Rate-limit pointOfView calls so very dense beat passages don't
    // queue up rapid-fire camera moves that look chaotic.  The minimum
    // gap is short enough to let the next move start before the previous
    // one finishes, which keeps the motion feeling continuous.
    const now = performance.now();
    if (now - lastMoveAt < 700) return;
    lastMoveAt = now;

    const pov = globe.pointOfView();
    const choice = Math.floor(Math.random() * 5);
    // Each move covers roughly 2× the angular range / zoom step of the
    // earlier version, and the pointOfView() animation runs for 1300 ms
    // — both bigger and longer, so the rotation reads as a sweep rather
    // than a snap, and feels smoother end-to-end.
    switch (choice) {
      case 0:  // left swing
        pov.lng = ((pov.lng - 70 - Math.random() * 50) + 540) % 360 - 180;
        break;
      case 1:  // right swing
        pov.lng = ((pov.lng + 70 + Math.random() * 50) + 540) % 360 - 180;
        break;
      case 2:  // tilt up
        pov.lat = Math.max(-82, Math.min(82, pov.lat - 28 - Math.random() * 30));
        break;
      case 3:  // tilt down
        pov.lat = Math.max(-82, Math.min(82, pov.lat + 28 + Math.random() * 30));
        break;
      case 4:  // zoom — either in or out
        pov.altitude = Math.max(0.6, Math.min(5.0,
          pov.altitude * (Math.random() < 0.5 ? 0.55 : 1.65)));
        break;
    }
    globe.pointOfView(pov, 1300);
  }

  function tick() {
    if (audio.paused) { beatLoopId = null; return; }
    if (isBeat()) jolt();
    beatLoopId = requestAnimationFrame(tick);
  }

  function setUiPlaying(playing) {
    icoEl.textContent = playing ? '⏸' : '♪';
    lblEl.textContent = playing ? 'Pause NAZAR' : 'Play NAZAR';
    btn.style.color = playing ? 'var(--accent2)' : '';
  }

  btn.addEventListener('click', async () => {
    try {
      ensureGraph();
      if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
      if (audio.paused) {
        await audio.play();
        setUiPlaying(true);
        if (!beatLoopId) tick();
      } else {
        audio.pause();
        setUiPlaying(false);
      }
    } catch (e) {
      console.warn('Soundtrack play failed:', e);
      lblEl.textContent = 'Audio blocked';
    }
  });

  audio.addEventListener('pause', () => setUiPlaying(false));
  audio.addEventListener('play',  () => setUiPlaying(true));
})();
