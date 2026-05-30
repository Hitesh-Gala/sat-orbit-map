// Game of Cones — two satellite-geometry puzzles ported from the satmap
// prototype into NAZAR's no-build / vanilla-JS world.
//
//   Mode A · Land Cone:  from a ground point, draw an upward cone of
//     half-angle θ up to maxHeight km and list every satellite inside it.
//
//   Mode B · Sat  Cone:  pick a satellite, set sensor half-angle, draw the
//     cone from the sat down to Earth and project its footprint polygon
//     on the surface.
//
// Shares TLE loading and SGP4 propagation with the rest of the site via
// window.Argos (tle-loader.js).  Mesh construction mirrors cone.js — both
// pages explicitly load three@0.157.0 so they can build ConeGeometry
// directly and globe.scene().add(mesh).

// --- Constants -----------------------------------------------------------

const EARTH_R_KM   = 6371;
const GLOBE_RADIUS = 100;          // globe.gl's internal unit sphere radius
const DEG          = Math.PI / 180;
const PROP_INTERVAL_MS = 5000;     // re-propagate every 5 s

// --- Status helpers ------------------------------------------------------

const statusEl = document.getElementById('goc-status');
function setStatus(msg, isErr) {
  statusEl.textContent = msg;
  statusEl.style.color = isErr ? 'var(--accent2)' : '';
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Geometry helpers (ported from satmap/src/core/geo.ts) ---------------

function geodeticToECEF(latDeg, lngDeg, altKm) {
  const lat = latDeg * DEG;
  const lng = lngDeg * DEG;
  const r = EARTH_R_KM + altKm;
  return {
    x: r * Math.cos(lat) * Math.cos(lng),
    y: r * Math.cos(lat) * Math.sin(lng),
    z: r * Math.sin(lat),
  };
}

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function mag(v)    { return Math.hypot(v.x, v.y, v.z); }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function normalize(v) {
  const m = mag(v) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

// True if a satellite ECEF point sits inside the upward cone whose apex
// is the ground point (lat, lng), axis is the local up-normal, half-angle
// is θ, and slant length ≤ maxHeightKm along the axis.
function isInOutcone(groundLat, groundLng, satLat, satLng, satAltKm, halfAngleDeg, maxHeightKm) {
  const apex = geodeticToECEF(groundLat, groundLng, 0);
  const sat  = geodeticToECEF(satLat,   satLng,   satAltKm);
  const v    = sub(sat, apex);
  const axis = normalize(apex);   // local outward normal == apex direction
  const axial = dot(v, axis);
  if (axial <= 0) return false;            // below the horizon
  if (axial > maxHeightKm) return false;   // past the cone's tip cap
  const vMag = mag(v);
  if (vMag === 0) return false;
  // angle between v and axis
  const cosAng = axial / vMag;
  const angDeg = Math.acos(Math.min(1, Math.max(-1, cosAng))) / DEG;
  return angDeg <= halfAngleDeg;
}

// Half-angular-radius of the footprint circle on Earth's surface for a
// cone with the given sensor half-angle, opening from altitude h.
//
//   ρ = arcsin((R + h) / R · sin θ) − θ
//
// where R = Earth radius, h = sat altitude, θ = sensor half-angle.
// Returns NaN if the cone overshoots the horizon (no intersection).
function footprintAngularRadius(altitudeKm, halfAngleDeg) {
  const theta = halfAngleDeg * DEG;
  const ratio = (EARTH_R_KM + altitudeKm) / EARTH_R_KM * Math.sin(theta);
  if (ratio > 1) return NaN;  // cone overshoots — no surface intersection
  return Math.asin(ratio) - theta;
}

// Great-circle "destinationPoint": start at (lat, lng), travel an angular
// distance δ along bearing β, return the destination [lat, lng] in degrees.
function destinationPoint(latDeg, lngDeg, delta, bearingDeg) {
  const lat = latDeg * DEG;
  const lng = lngDeg * DEG;
  const brg = bearingDeg * DEG;
  const sinLat2 = Math.sin(lat) * Math.cos(delta) + Math.cos(lat) * Math.sin(delta) * Math.cos(brg);
  const lat2 = Math.asin(sinLat2);
  const y = Math.sin(brg) * Math.sin(delta) * Math.cos(lat);
  const x = Math.cos(delta) - Math.sin(lat) * sinLat2;
  const lng2 = lng + Math.atan2(y, x);
  // wrap longitude into [-180, 180]
  const lng2Deg = ((lng2 / DEG + 540) % 360) - 180;
  return [lat2 / DEG, lng2Deg];
}

// Build a closed ring of `numPoints` (lng, lat) pairs sampling the
// footprint circle at angular radius δ centred on (subSatLat, subSatLng).
function coneFootprintPolygon(subSatLat, subSatLng, angularRadius, numPoints = 72) {
  const ring = [];
  for (let i = 0; i <= numPoints; i++) {
    const brg = (i / numPoints) * 360;
    const [lat, lng] = destinationPoint(subSatLat, subSatLng, angularRadius, brg);
    ring.push([lng, lat]);  // GeoJSON ordering: [lng, lat]
  }
  return ring;
}

// --- Globe ---------------------------------------------------------------

const globe = Globe()(document.getElementById('globe'))
  .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
  .bumpImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png')
  .backgroundImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/night-sky.png')
  .showAtmosphere(true)
  .atmosphereColor('#4ea8ff')
  .atmosphereAltitude(0.18)
  .pointOfView({ lat: 28.61, lng: 77.21, altitude: 2.4 }, 0)
  // Footprint polygon layer for Sat Cone mode.  Colours match satmap's
  // orange palette so the projected circle is unambiguously the cone, not
  // a country boundary.
  .polygonsData([])
  .polygonAltitude(0.001)
  .polygonCapColor(() => 'rgba(255, 100, 50, 0.18)')
  .polygonSideColor(() => 'rgba(255, 100, 50, 0.08)')
  .polygonStrokeColor(() => 'rgba(255, 160, 110, 0.85)')
  // Satellite dot layer.  Used by Land Cone to highlight in-cone sats,
  // and by Sat Cone to mark the chosen sat.  Uses objectsData (a real
  // THREE.Mesh per item) to dodge globe.gl 2.32's htmlElements quirk.
  .objectsData([])
  .objectLat(d => d.lat)
  .objectLng(d => d.lon)
  .objectAltitude(d => d.alt / EARTH_R_KM)
  .objectThreeObject(d => new THREE.Mesh(
    new THREE.SphereGeometry(d.big ? 1.8 : 1.2, 14, 14),
    new THREE.MeshBasicMaterial({ color: d.color || '#67e8a4' })
  ))
  .objectLabel(d => `<div class="sat-tip">
    <b>${escHtml(d.name)}</b>
    <div>Alt ${d.alt.toFixed(0)} km · ${d.lat.toFixed(2)}°, ${d.lon.toFixed(2)}°</div>
  </div>`);

const controls = globe.controls();
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.rotateSpeed   = 0.5;
controls.zoomSpeed     = 0.8;
controls.minDistance   = 110;
controls.maxDistance   = 1500;

window.addEventListener('resize', () => {
  globe.width(window.innerWidth).height(window.innerHeight);
});

// --- Cone mesh management ------------------------------------------------

let coneMesh = null;
function clearCone() {
  if (!coneMesh) return;
  globe.scene().remove(coneMesh);
  coneMesh.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  coneMesh = null;
}

// Land Cone: apex on the surface, axis along the local outward normal,
// opens upward into space.  Plain green semi-transparent fill (matches
// satmap's #00ff88 styling).
function drawLandCone(latDeg, lngDeg, halfAngleDeg, maxHeightKm) {
  clearCone();
  const altFrac = maxHeightKm / EARTH_R_KM;
  const a = globe.getCoords(latDeg, lngDeg, 0);
  const t = globe.getCoords(latDeg, lngDeg, altFrac);
  const apex = new THREE.Vector3(a.x, a.y, a.z);
  const top  = new THREE.Vector3(t.x, t.y, t.z);
  const height3D = apex.distanceTo(top);
  const baseRadius = height3D * Math.tan(halfAngleDeg * DEG);

  const geo = new THREE.ConeGeometry(baseRadius, height3D, 96, 1, true);
  // ConeGeometry: tip at +Y·(h/2), base at -Y·(h/2).  We want tip at the
  // origin (so we can place it at the apex on the surface) and base out
  // along +Y, so translate then flip 180° around X.
  geo.translate(0, -height3D / 2, 0);
  geo.rotateX(Math.PI);

  const mat = new THREE.MeshBasicMaterial({
    color: 0x00ff88,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  coneMesh = new THREE.Mesh(geo, mat);
  coneMesh.position.copy(apex);
  // Align local +Y with the outward surface normal.
  const up = apex.clone().normalize();
  coneMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  globe.scene().add(coneMesh);
}

// Sat Cone: apex at the satellite position, axis pointing down toward
// Earth's centre.  Orange-tinted shader fade so the tip near the sat is
// brightest and the wide base over Earth is faintest — matches satmap.
function drawSatCone(satLat, satLng, satAltKm, halfAngleDeg) {
  clearCone();
  const altFrac = satAltKm / EARTH_R_KM;
  const s = globe.getCoords(satLat, satLng, altFrac);
  const sat = new THREE.Vector3(s.x, s.y, s.z);
  // Cone height = distance from the sat to Earth's centre (origin).
  const height3D = sat.length();
  const baseRadius = height3D * Math.tan(halfAngleDeg * DEG);

  // Raw geometry: tip at +Y·(h/2), base at -Y·(h/2), centred at origin.
  // Leaving it untranslated lets the shader fade formula below work as
  // written (position.y in [-h/2, +h/2] maps cleanly to vFade in [0, 1]).
  const geo = new THREE.ConeGeometry(baseRadius, height3D, 96, 1, true);

  // Shader material so the tip glows and the base fades — same recipe as
  // satmap's Globe.tsx: vFade = (position.y + h*0.5) / h, opacity scales
  // by vFade × 0.3.
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    uniforms: { uHeight: { value: height3D } },
    vertexShader: `
      varying float vFade;
      uniform float uHeight;
      void main() {
        vFade = (position.y + uHeight * 0.5) / uHeight;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vFade;
      void main() {
        gl_FragColor = vec4(1.0, 0.67, 0.0, vFade * 0.3);
      }
    `,
  });
  coneMesh = new THREE.Mesh(geo, mat);
  // Place the mesh centre at the midpoint between the sat and Earth's
  // centre.  After the quaternion aligns local +Y with the sat-direction:
  //   tip   (local +Y·h/2) → midpoint + satDir·(h/2) = sat
  //   base  (local -Y·h/2) → midpoint − satDir·(h/2) = origin
  coneMesh.position.copy(sat).multiplyScalar(0.5);
  const satDir = sat.clone().normalize();
  coneMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), satDir);
  globe.scene().add(coneMesh);
}

// --- TLE catalogue -------------------------------------------------------

let allSats = [];     // [{ name, noradId, rec }]
let latestProp = new Map();  // noradId → { lat, lon, alt }
let propTimer  = null;
let currentMode = 'land';

async function loadCatalogue() {
  setStatus('Loading TLE catalogue…');
  try {
    const { tles, source } = await window.Argos.fetchTLEs();
    allSats = window.Argos.makeSatrecs(tles);
    setStatus(`Catalogue: ${allSats.length.toLocaleString()} sats (${source})`);
    propagateAll();
    if (propTimer) clearInterval(propTimer);
    propTimer = setInterval(propagateAll, PROP_INTERVAL_MS);
  } catch (e) {
    setStatus('TLE fetch failed: ' + e.message, true);
  }
}

function propagateAll() {
  const now = new Date();
  latestProp.clear();
  for (const t of allSats) {
    const r = window.Argos.propagate(t.rec, now);
    if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon) || !Number.isFinite(r.alt)) continue;
    latestProp.set(t.noradId, { lat: r.lat, lon: r.lon, alt: r.alt });
  }
  // Re-solve the active mode so the on-screen results stay live.
  if (currentMode === 'land') solveLandCone();
  else                        solveSatCone();
}

// --- Mode-tab switching --------------------------------------------------

const tabLand = document.getElementById('tab-land');
const tabSat  = document.getElementById('tab-sat');
const panelLand = document.getElementById('mode-land');
const panelSat  = document.getElementById('mode-sat');

function activateMode(mode) {
  currentMode = mode;
  const isLand = mode === 'land';
  tabLand.classList.toggle('active', isLand);
  tabSat .classList.toggle('active', !isLand);
  tabLand.setAttribute('aria-selected', isLand);
  tabSat .setAttribute('aria-selected', !isLand);
  panelLand.hidden = !isLand;
  panelSat .hidden = isLand;
  // Drop the cone + overlays from the previous mode.
  clearCone();
  globe.polygonsData([]);
  globe.objectsData([]);
  if (isLand) solveLandCone();
  else        solveSatCone();
}
tabLand.addEventListener('click', () => activateMode('land'));
tabSat .addEventListener('click', () => activateMode('sat'));

// --- Slider live-value binding ------------------------------------------

function bindSlider(rangeId, valueId, onChange) {
  const r = document.getElementById(rangeId);
  const v = document.getElementById(valueId);
  const sync = () => { v.textContent = r.value; onChange(); };
  r.addEventListener('input', sync);
  sync();
}

// --- Land Cone mode ------------------------------------------------------

const landLatEl    = document.getElementById('land-lat');
const landLngEl    = document.getElementById('land-lng');
const landAngleEl  = document.getElementById('land-angle');
const landHeightEl = document.getElementById('land-height');
const landCountEl  = document.getElementById('land-count');
const landListEl   = document.getElementById('land-list');

const ORBIT_COLOR = {
  LEO: '#67e8a4',
  MEO: '#f9d24c',
  GEO: '#ff9966',
  HEO: '#d77eff',
};
function orbitClass(altKm) {
  if (altKm < 2000)  return 'LEO';
  if (altKm < 30000) return 'MEO';
  if (altKm < 42000) return 'GEO';
  return 'HEO';
}

function solveLandCone() {
  if (currentMode !== 'land') return;
  if (!allSats.length) return;
  const lat    = parseFloat(landLatEl.value);
  const lng    = parseFloat(landLngEl.value);
  const angle  = parseFloat(landAngleEl.value);
  const height = parseFloat(landHeightEl.value);
  const valid  = Number.isFinite(lat) && Number.isFinite(lng)
              && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  landLatEl.style.borderColor = valid ? '' : 'var(--accent2)';
  landLngEl.style.borderColor = valid ? '' : 'var(--accent2)';
  if (!valid) return;

  drawLandCone(lat, lng, angle, height);

  const hits = [];
  for (const t of allSats) {
    const p = latestProp.get(t.noradId);
    if (!p) continue;
    if (!isInOutcone(lat, lng, p.lat, p.lon, p.alt, angle, height)) continue;
    const cls = orbitClass(p.alt);
    hits.push({
      name:  t.name,
      lat:   p.lat,
      lon:   p.lon,
      alt:   p.alt,
      cls,
      color: ORBIT_COLOR[cls],
      big:   true,
    });
  }
  hits.sort((a, b) => a.alt - b.alt);
  landCountEl.textContent = hits.length;
  globe.objectsData(hits);
  landListEl.innerHTML = hits.map(s => `
    <div class="item">
      <div class="name" style="color:${s.color}">${escHtml(s.name)}</div>
      <div class="meta"><span style="color:${s.color}">${s.cls}</span> · Alt <strong>${s.alt.toFixed(0)} km</strong></div>
      <div class="meta muted">${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°</div>
    </div>`).join('') || '<div class="hint">No satellites inside the cone.</div>';
}

landLatEl.addEventListener('input', solveLandCone);
landLngEl.addEventListener('input', solveLandCone);
bindSlider('land-angle',  'land-angle-val',  solveLandCone);
bindSlider('land-height', 'land-height-val', solveLandCone);

// --- Sat Cone mode -------------------------------------------------------

const satSearchEl = document.getElementById('sat-search');
const satHitsEl   = document.getElementById('sat-hits');
const satAngleEl  = document.getElementById('sat-angle');
const satStatusEl = document.getElementById('sat-status');
let selectedSat = null;   // { name, noradId, rec }

function renderSatHits(query) {
  const q = query.trim().toLowerCase();
  if (!q) { satHitsEl.hidden = true; satHitsEl.innerHTML = ''; return; }
  const hits = [];
  for (const t of allSats) {
    if (t.name.toLowerCase().includes(q)) {
      hits.push(t);
      if (hits.length >= 20) break;
    }
  }
  if (!hits.length) {
    satHitsEl.hidden = false;
    satHitsEl.innerHTML = '<div class="item" style="color:var(--dim)">No matches.</div>';
    return;
  }
  satHitsEl.hidden = false;
  satHitsEl.innerHTML = hits.map(h =>
    `<div class="item" data-norad="${h.noradId}">${escHtml(h.name)}</div>`).join('');
}

satSearchEl.addEventListener('input', e => renderSatHits(e.target.value));
satHitsEl.addEventListener('click', e => {
  const row = e.target.closest('.item[data-norad]');
  if (!row) return;
  const norad = parseInt(row.dataset.norad, 10);
  const t = allSats.find(s => s.noradId === norad);
  if (!t) return;
  selectedSat = t;
  satSearchEl.value = t.name;
  satHitsEl.hidden = true;
  solveSatCone();
});

function solveSatCone() {
  if (currentMode !== 'sat') return;
  if (!selectedSat) {
    satStatusEl.textContent = 'No satellite selected.';
    return;
  }
  const p = latestProp.get(selectedSat.noradId);
  if (!p) {
    satStatusEl.textContent = `${selectedSat.name} — propagation unavailable.`;
    return;
  }
  const halfAngle = parseFloat(satAngleEl.value);

  drawSatCone(p.lat, p.lon, p.alt, halfAngle);

  // Footprint polygon — undefined if the cone overshoots the horizon.
  const rho = footprintAngularRadius(p.alt, halfAngle);
  if (!Number.isFinite(rho)) {
    globe.polygonsData([]);
    satStatusEl.innerHTML = `<strong>${escHtml(selectedSat.name)}</strong><br>
      Alt ${p.alt.toFixed(0)} km · ${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}°<br>
      Cone overshoots the horizon — no surface footprint.`;
  } else {
    const ring = coneFootprintPolygon(p.lat, p.lon, rho, 96);
    globe.polygonsData([{
      geometry: { type: 'Polygon', coordinates: [ring] },
    }]);
    const surfRadiusKm = rho * EARTH_R_KM;
    satStatusEl.innerHTML = `<strong>${escHtml(selectedSat.name)}</strong><br>
      Alt ${p.alt.toFixed(0)} km · ${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}°<br>
      Footprint radius ${surfRadiusKm.toFixed(0)} km on the surface.`;
  }

  // Drop a marker dot on the satellite itself so the user can find it on
  // the globe even when the cone is faint.
  globe.objectsData([{
    name:  selectedSat.name,
    lat:   p.lat,
    lon:   p.lon,
    alt:   p.alt,
    color: '#ffb070',
    big:   true,
  }]);
}

bindSlider('sat-angle', 'sat-angle-val', solveSatCone);

// --- Boot ----------------------------------------------------------------

activateMode('land');
loadCatalogue();
