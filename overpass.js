// Overpass — pick a ground point + an upward cone + a time window, list every
// satellite that flies through the cone during that window (from its TLE), then
// animate the chosen ones over the globe at 1 real second = 1 hour.
//
// Reuses the shared SGP4 layer (window.Argos) and mirrors game-of-cones.js for
// the cone geometry + globe/ConeGeometry construction.

// --- Constants -----------------------------------------------------------

const EARTH_R_KM = 6371;
const DEG        = Math.PI / 180;
const MONTH_MS   = 31 * 24 * 3600 * 1000;   // ±1 month clamp
const IST_OFFSET_MS = 5.5 * 3600 * 1000;    // IST = UTC + 5:30
const FIND_BUDGET = 2e6;                    // max sat-samples before we coarsen the step
const TRAIL_MAX   = 150;                     // animation trail length (frames)

const $ = (id) => document.getElementById(id);

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function setStatus(msg, isErr) {
  const el = $('op-status');
  el.textContent = msg;
  el.style.color = isErr ? 'var(--accent2)' : '';
}

// --- Cone geometry (ported from game-of-cones.js) ------------------------

function geodeticToECEF(latDeg, lngDeg, altKm) {
  const lat = latDeg * DEG, lng = lngDeg * DEG, r = EARTH_R_KM + altKm;
  return { x: r * Math.cos(lat) * Math.cos(lng), y: r * Math.cos(lat) * Math.sin(lng), z: r * Math.sin(lat) };
}
function subv(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function magv(v)    { return Math.hypot(v.x, v.y, v.z); }
function dotv(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function normv(v)   { const m = magv(v) || 1; return { x: v.x / m, y: v.y / m, z: v.z / m }; }

// True when the satellite sub-point sits inside the upward cone whose apex is
// the ground point, axis is the local up-normal, half-angle is θ, and axial
// length ≤ maxHeightKm along the axis.
function isInCone(groundLat, groundLng, satLat, satLng, satAltKm, halfAngleDeg, maxHeightKm) {
  const apex = geodeticToECEF(groundLat, groundLng, 0);
  const sat  = geodeticToECEF(satLat, satLng, satAltKm);
  const v = subv(sat, apex);
  const axis = normv(apex);
  const axial = dotv(v, axis);
  if (axial <= 0 || axial > maxHeightKm) return false;
  const vMag = magv(v);
  if (vMag === 0) return false;
  const angDeg = Math.acos(Math.min(1, Math.max(-1, axial / vMag))) / DEG;
  return angDeg <= halfAngleDeg;
}

// Lightweight sub-point (lat/lon/alt) — skips the observer look-angle work that
// window.Argos.propagate does, so the big pass-scan is ~2× cheaper.
function subPoint(rec, date) {
  const pv = satellite.propagate(rec, date);
  if (!pv || !pv.position) return null;
  const gd = satellite.eciToGeodetic(pv.position, satellite.gstime(date));
  const lat = satellite.degreesLat(gd.latitude), lon = satellite.degreesLong(gd.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(gd.height)) return null;
  return { lat, lon, alt: gd.height };
}

const ORBIT_COLOR = { LEO: '#67e8a4', MEO: '#f9d24c', GEO: '#ff9966', HEO: '#d77eff' };
const MAX_LIST = 500;   // cap the rendered list
function orbitClass(altKm) {
  if (altKm < 2000)  return 'LEO';
  if (altKm < 30000) return 'MEO';
  if (altKm < 42000) return 'GEO';
  return 'HEO';
}

// --- Globe ---------------------------------------------------------------

const globe = Globe()(document.getElementById('globe'))
  .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
  .bumpImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png')
  .backgroundImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/night-sky.png')
  .showAtmosphere(true).atmosphereColor('#4ea8ff').atmosphereAltitude(0.18)
  .pointOfView({ lat: 28.61, lng: 77.21, altitude: 2.4 }, 0)
  // Moving-satellite dots (objectsData dodges globe.gl 2.32's htmlElements quirk).
  .objectLat(d => d.lat).objectLng(d => d.lon).objectAltitude(d => d.alt / EARTH_R_KM)
  .objectThreeObject(d => new THREE.Mesh(
    new THREE.SphereGeometry(d.big ? 2.0 : 1.3, 14, 14),
    new THREE.MeshBasicMaterial({ color: d.color || '#67e8a4' })))
  .objectLabel(d => `<div class="sat-tip"><b>${escHtml(d.name)}</b>
    <div>Alt ${d.alt.toFixed(0)} km · ${d.lat.toFixed(2)}°, ${d.lon.toFixed(2)}°</div></div>`)
  // Orbit trails during the animation.
  .pathPoints(d => d.points)
  .pathPointLat(p => p[0]).pathPointLng(p => p[1]).pathPointAlt(p => p[2] / EARTH_R_KM)
  .pathColor(d => d.color).pathStroke(1.6).pathTransitionDuration(0)
  .objectsData([]).pathsData([]);

const controls = globe.controls();
controls.enableDamping = true; controls.dampingFactor = 0.1;
controls.rotateSpeed = 0.5; controls.zoomSpeed = 0.8;
controls.minDistance = 110; controls.maxDistance = 1500;
window.addEventListener('resize', () => globe.width(window.innerWidth).height(window.innerHeight));

// Cone mesh (green upward cone, apex on the surface).
let coneMesh = null;
function drawCone(latDeg, lngDeg, halfAngleDeg, maxHeightKm) {
  if (coneMesh) {
    globe.scene().remove(coneMesh);
    coneMesh.geometry.dispose(); coneMesh.material.dispose(); coneMesh = null;
  }
  const altFrac = maxHeightKm / EARTH_R_KM;
  const a = globe.getCoords(latDeg, lngDeg, 0);
  const t = globe.getCoords(latDeg, lngDeg, altFrac);
  const apex = new THREE.Vector3(a.x, a.y, a.z);
  const height3D = apex.distanceTo(new THREE.Vector3(t.x, t.y, t.z));
  const baseRadius = height3D * Math.tan(halfAngleDeg * DEG);
  const geo = new THREE.ConeGeometry(baseRadius, height3D, 96, 1, true);
  geo.translate(0, -height3D / 2, 0);
  geo.rotateX(Math.PI);
  const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false });
  coneMesh = new THREE.Mesh(geo, mat);
  coneMesh.position.copy(apex);
  coneMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), apex.clone().normalize());
  globe.scene().add(coneMesh);
}

// --- Inputs --------------------------------------------------------------

const latEl = $('op-lat'), lngEl = $('op-lng'), angleEl = $('op-angle'), altEl = $('op-alt');
let tz = 'UTC';                 // 'UTC' | 'IST'
let fromInstant = null, toInstant = null;

function bindSlider(rangeId, valueId, onChange) {
  const r = $(rangeId), v = $(valueId);
  r.addEventListener('input', () => { v.textContent = r.value; onChange(); });
  v.textContent = r.value;
}

// Format a Date as { date:'YYYY-MM-DD', time:'HH:MM' } in the active tz.
function fmtInstant(inst) {
  const shifted = new Date(inst.getTime() + (tz === 'IST' ? IST_OFFSET_MS : 0));
  const iso = shifted.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
// Parse the input fields for one side ('from'|'to') into a Date instant.
function parseSide(side) {
  const d = $(`op-${side}-date`).value, t = $(`op-${side}-time`).value || '00:00';
  if (!d) return null;
  const suffix = tz === 'IST' ? '+05:30' : 'Z';
  const inst = new Date(`${d}T${t}:00${suffix}`);
  return isNaN(inst.getTime()) ? null : inst;
}
function clampInstant(inst) {
  const now = Date.now();
  return new Date(Math.min(now + MONTH_MS, Math.max(now - MONTH_MS, inst.getTime())));
}
function writeSide(side, inst) {
  const f = fmtInstant(inst);
  $(`op-${side}-date`).value = f.date;
  $(`op-${side}-time`).value = f.time;
}
// Bound the calendar to ±1 month.
function setDateBounds() {
  const lo = fmtInstant(new Date(Date.now() - MONTH_MS)).date;
  const hi = fmtInstant(new Date(Date.now() + MONTH_MS)).date;
  for (const side of ['from', 'to']) {
    const el = $(`op-${side}-date`);
    el.min = lo; el.max = hi;
  }
}

function readDuration() {
  const f = parseSide('from'), t = parseSide('to');
  if (!f || !t) return false;
  fromInstant = clampInstant(f);
  toInstant   = clampInstant(t);
  if (toInstant <= fromInstant) toInstant = new Date(fromInstant.getTime() + 3600 * 1000);
  // Reflect any clamping back into the fields.
  writeSide('from', fromInstant);
  writeSide('to', toInstant);
  const hrs = (toInstant - fromInstant) / 3600000;
  $('op-dur-hint').textContent = `Window: ${hrs.toFixed(1)} h · ${tz}. (±1 month of now.)`;
  return true;
}

// --- Observer / cone (live) ---------------------------------------------

function currentInputs() {
  const lat = parseFloat(latEl.value), lng = parseFloat(lngEl.value);
  const angle = parseFloat(angleEl.value), alt = parseFloat(altEl.value);
  const valid = Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  latEl.style.borderColor = valid ? '' : 'var(--accent2)';
  lngEl.style.borderColor = valid ? '' : 'var(--accent2)';
  return valid ? { lat, lng, angle, alt } : null;
}

function refreshCone() {
  const inp = currentInputs();
  if (!inp) return;
  if (!animActive) drawCone(inp.lat, inp.lng, inp.angle, inp.alt);
}

// --- Pass-finding --------------------------------------------------------

let allSats = [];
let findToken = 0;
let lastHits = [];   // [{ name, noradId, rec, cls, color, firstMs, peakAlt }]

// Central-angle reach of the cone rim on the ground (rough, for the filter).
function coneReachDeg(altKm, halfAngleDeg) {
  const elev = (90 - halfAngleDeg) * DEG;
  const inner = (EARTH_R_KM / (EARTH_R_KM + altKm)) * Math.cos(elev);
  const lam = Math.acos(Math.min(1, Math.max(-1, inner))) - elev;   // central angle, rad
  return Math.max(0, lam) / DEG;
}

function findPasses() {
  const inp = currentInputs();
  if (!inp || !readDuration() || !allSats.length) return;
  const token = ++findToken;
  const { lat, lng, angle, alt } = inp;
  const fromMs = fromInstant.getTime(), toMs = toInstant.getTime();
  const durSec = (toMs - fromMs) / 1000;

  // Pre-filter: perigee must reach the cone, and the ground track must be able
  // to reach the observer's latitude band.
  const reach = coneReachDeg(alt, angle);
  const candidates = [];
  for (const s of allSats) {
    const rec = s.rec;
    const periAlt = EARTH_R_KM * (rec.a * (1 - rec.ecco) - 1);
    if (!(periAlt <= alt + 60)) continue;
    const incDeg = rec.inclo / DEG;
    const maxSubLat = incDeg <= 90 ? incDeg : 180 - incDeg;
    if (Math.abs(lat) > maxSubLat + reach + 6) continue;
    candidates.push(s);
  }

  // Sampling step: fine enough to catch a ~1-2 min in-cone pass, coarsened only
  // if the total work blows past the budget (very long window × many candidates).
  let step = Math.min(90, Math.max(30, durSec / 1600));
  if (candidates.length * (durSec / step) > FIND_BUDGET) {
    step = (durSec * candidates.length) / FIND_BUDGET;
  }
  const coarse = step > 105;   // only warn when the step is coarse enough to skip short passes

  const progress = $('op-progress'), bar = progress.querySelector('i');
  progress.hidden = false;
  $('op-find').disabled = true;
  $('op-find-status').textContent = `Scanning ${candidates.length.toLocaleString()} candidate orbits…`;

  const hits = [];
  let i = 0;
  const CHUNK = 24;
  function chunk() {
    if (token !== findToken) return;   // superseded by a newer search
    const end = Math.min(i + CHUNK, candidates.length);
    for (; i < end; i++) {
      const s = candidates[i];
      let firstMs = null, peakAlt = 0;
      for (let ms = fromMs; ms <= toMs; ms += step * 1000) {
        const r = subPoint(s.rec, new Date(ms));
        if (!r) continue;
        if (isInCone(lat, lng, r.lat, r.lon, r.alt, angle, alt)) {
          if (firstMs === null) firstMs = ms;
          peakAlt = Math.max(peakAlt, r.alt);
          break;   // one hit is enough to list it
        }
      }
      if (firstMs !== null) {
        const cls = orbitClass(peakAlt);
        hits.push({ name: s.name, noradId: s.noradId, rec: s.rec, cls, color: ORBIT_COLOR[cls], firstMs, peakAlt });
      }
    }
    bar.style.width = (100 * i / Math.max(1, candidates.length)).toFixed(0) + '%';
    if (i < candidates.length) { setTimeout(chunk, 0); return; }
    // done
    progress.hidden = true;
    $('op-find').disabled = false;
    hits.sort((a, b) => a.firstMs - b.firstMs);
    const truncated = hits.length > MAX_LIST;
    lastHits = truncated ? hits.slice(0, MAX_LIST) : hits;
    renderHits(coarse, truncated ? hits.length : 0);
  }
  chunk();
}

function fmtClock(ms) {
  const f = fmtInstant(new Date(ms));
  return `${f.date} ${f.time} ${tz}`;
}

function renderHits(coarse, totalIfTruncated) {
  const listEl = $('op-sat-list');
  const notes = [];
  if (coarse) notes.push('coarse — some short LEO passes may be missed');
  if (totalIfTruncated) notes.push(`showing first ${MAX_LIST} of ${totalIfTruncated}`);
  const noteStr = notes.length ? ` <span style="color:var(--accent2)">(${notes.join('; ')})</span>` : '';
  $('op-find-status').innerHTML = `<strong>${lastHits.length}</strong> satellite${lastHits.length === 1 ? '' : 's'} pass over the cone.${noteStr}`;
  if (!lastHits.length) {
    listEl.innerHTML = '<div class="op-empty">No satellites fly through this cone in the window. Widen the angle / altitude or the time window.</div>';
    $('op-animate').disabled = true;
    return;
  }
  listEl.innerHTML = lastHits.map(h => `
    <label class="op-satrow">
      <input type="checkbox" data-norad="${h.noradId}" checked>
      <span class="swatch" style="background:${h.color};color:${h.color}"></span>
      <span class="op-sat-body">
        <span class="op-sat-name">${escHtml(h.name)}</span>
        <span class="op-sat-meta">${h.cls} · first ${fmtClock(h.firstMs)}</span>
      </span>
    </label>`).join('');
  syncAnimBtn();
}

function checkedNorads() {
  return new Set([...$('op-sat-list').querySelectorAll('input[type="checkbox"]:checked')].map(c => +c.dataset.norad));
}
function syncAnimBtn() { $('op-animate').disabled = animActive ? false : checkedNorads().size === 0; }

// --- Animation -----------------------------------------------------------

let animActive = false, animRaf = null, anim = null;

function startAnimation() {
  const inp = currentInputs();
  if (!inp || !readDuration()) return;
  const picked = lastHits.filter(h => checkedNorads().has(h.noradId));
  if (!picked.length) return;
  animActive = true;
  drawCone(inp.lat, inp.lng, inp.angle, inp.alt);
  anim = {
    from: fromInstant.getTime(), to: toInstant.getTime(), cur: fromInstant.getTime(),
    lastTs: null, sats: picked, cone: inp, trails: new Map(),
  };
  for (const s of picked) anim.trails.set(s.noradId, []);
  $('op-clock').hidden = false;
  const btn = $('op-animate');
  btn.textContent = '■ Stop'; btn.classList.add('stop'); btn.disabled = false;
  animRaf = requestAnimationFrame(animTick);
}

function stopAnimation() {
  animActive = false;
  if (animRaf) cancelAnimationFrame(animRaf);
  animRaf = null; anim = null;
  globe.objectsData([]); globe.pathsData([]);
  $('op-clock').hidden = true;
  const btn = $('op-animate');
  btn.textContent = '▶ Animate'; btn.classList.remove('stop');
  syncAnimBtn();
  refreshCone();
}

function animTick(ts) {
  if (!anim) return;
  if (anim.lastTs == null) anim.lastTs = ts;
  const dtReal = Math.min(0.12, (ts - anim.lastTs) / 1000);   // cap for tab throttling
  anim.lastTs = ts;
  anim.cur += dtReal * 3600 * 1000;                            // 1 real second = 1 hour
  const done = anim.cur >= anim.to;
  if (done) anim.cur = anim.to;
  const date = new Date(anim.cur);
  const { lat, lng, angle, alt } = anim.cone;

  const dots = [];
  for (const s of anim.sats) {
    const r = subPoint(s.rec, date);
    if (!r) continue;
    const inCone = isInCone(lat, lng, r.lat, r.lon, r.alt, angle, alt);
    dots.push({ name: s.name, lat: r.lat, lon: r.lon, alt: r.alt, color: inCone ? '#ffffff' : s.color, big: inCone });
    const tr = anim.trails.get(s.noradId);
    tr.push([r.lat, r.lon, r.alt]);
    if (tr.length > TRAIL_MAX) tr.shift();
  }
  globe.objectsData(dots);
  globe.pathsData(anim.sats
    .map(s => ({ color: s.color, points: anim.trails.get(s.noradId) }))
    .filter(p => p.points.length > 1));

  const frac = (anim.cur - anim.from) / Math.max(1, anim.to - anim.from);
  $('op-clock-time').textContent = fmtClock(anim.cur);
  $('op-clock-fill').style.width = (100 * frac).toFixed(1) + '%';

  if (done) { finishAnimation(); return; }   // hold the final frame, allow replay
  animRaf = requestAnimationFrame(animTick);
}

// Window reached its end: freeze the last frame + clock on screen, but let the
// button start a fresh run.
function finishAnimation() {
  animActive = false;
  if (animRaf) cancelAnimationFrame(animRaf);
  animRaf = null;
  const btn = $('op-animate');
  btn.textContent = '▶ Replay'; btn.classList.remove('stop');
  syncAnimBtn();
}

// --- Wiring --------------------------------------------------------------

// The cone updates live (cheap); the pass-scan is heavy so it runs only on the
// explicit "Find" button.
latEl.addEventListener('input', refreshCone);
lngEl.addEventListener('input', refreshCone);
bindSlider('op-angle', 'op-angle-val', refreshCone);
bindSlider('op-alt',   'op-alt-val',   refreshCone);

for (const side of ['from', 'to']) {
  $(`op-${side}-date`).addEventListener('change', readDuration);
  $(`op-${side}-time`).addEventListener('change', readDuration);
}
$('op-find').addEventListener('click', findPasses);

function setTz(next) {
  if (next === tz) return;
  // keep the same instants, re-display them in the new zone.
  const f = parseSide('from'), t = parseSide('to');
  tz = next;
  $('op-tz-utc').classList.toggle('active', tz === 'UTC');
  $('op-tz-ist').classList.toggle('active', tz === 'IST');
  setDateBounds();
  if (f) writeSide('from', clampInstant(f));
  if (t) writeSide('to', clampInstant(t));
  readDuration();
}
$('op-tz-utc').addEventListener('click', () => setTz('UTC'));
$('op-tz-ist').addEventListener('click', () => setTz('IST'));

$('op-sat-list').addEventListener('change', syncAnimBtn);
$('op-selall').addEventListener('click', () => {
  $('op-sat-list').querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = true); syncAnimBtn();
});
$('op-selnone').addEventListener('click', () => {
  $('op-sat-list').querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = false); syncAnimBtn();
});
$('op-animate').addEventListener('click', () => { animActive ? stopAnimation() : startAnimation(); });

// --- Boot ----------------------------------------------------------------

function initDefaults() {
  setDateBounds();
  const now = new Date();
  writeSide('from', now);
  writeSide('to', new Date(now.getTime() + 3 * 3600 * 1000));
  readDuration();
}

async function boot() {
  initDefaults();
  refreshCone();
  setStatus('Loading TLE catalogue…');
  try {
    const { tles, source } = await window.Argos.fetchTLEs();
    allSats = window.Argos.makeSatrecs(tles);
    setStatus(`Catalogue: ${allSats.length.toLocaleString()} satellites (${source}). Set your cone + window, then Find.`);
  } catch (e) {
    setStatus('TLE fetch failed: ' + e.message, true);
  }
}
boot();
