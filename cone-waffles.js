// Cone-Waffles — Game of Cones with a steerable land cone.
//
//   Land Cone: apex on the ground, axis free to swivel.  The axis is drawn as a
//     dotted white line running a little past the cone, with a grab handle at
//     its end; drag either to tilt the cone anywhere above the horizon.  The
//     left panel shows the lean on a clock face (12 = North) plus the tilt in
//     degrees from vertical, and lists every satellite inside the cone that is
//     also above the local horizon, with range, elevation and off-axis angle.
//   Sat Cone: as on Game of Cones — a satellite's sensor cone and its footprint.
//
// Tilt convention: tilt = angle between the axis and local vertical (0° =
// straight up, 90° = along the horizon); direction = compass bearing of the
// lean, clockwise from North (0° = 12 o'clock, 90° = 3 o'clock).
//
// Shares TLE loading and SGP4 propagation with the rest of the site via
// window.Argos (tle-loader.js).

// --- Constants -----------------------------------------------------------

const EARTH_R_KM       = 6371;
const GLOBE_RADIUS     = 100;                      // globe.gl's scene-unit sphere radius
const KM_PER_UNIT      = EARTH_R_KM / GLOBE_RADIUS;
const DEG              = Math.PI / 180;
const PROP_INTERVAL_MS = 5000;                     // re-propagate every 5 s
const MAX_TILT         = 90;                       // the axis can lean down to the horizon
const AXIS_OVERSHOOT   = 1.15;                     // the dotted axis runs 15 % past the cone…
const MIN_AXIS_UNITS   = 14;                       // …and never shorter, so small cones stay grabbable
const GRAB_PX          = 12;                       // pointer distance (px) that counts as "on the axis"
const CLOCK_PLOT_R     = 44;                       // clock-face radius that stands for a 90° tilt

const $ = id => document.getElementById(id);

// --- Status helpers ------------------------------------------------------

const statusEl = $('cw-status');
function setStatus(msg, isErr) {
  statusEl.textContent = msg;
  statusEl.style.color = isErr ? 'var(--accent2)' : '';
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Geometry (ECEF, km) -------------------------------------------------

function geodeticToECEF(latDeg, lngDeg, altKm) {
  const lat = latDeg * DEG, lng = lngDeg * DEG, r = EARTH_R_KM + altKm;
  return { x: r * Math.cos(lat) * Math.cos(lng), y: r * Math.cos(lat) * Math.sin(lng), z: r * Math.sin(lat) };
}

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function mag(v)    { return Math.hypot(v.x, v.y, v.z); }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

// Local East-North-Up unit vectors at a ground point (same axes as geodeticToECEF).
function enuFrame(latDeg, lngDeg) {
  const la = latDeg * DEG, lo = lngDeg * DEG;
  return {
    e: { x: -Math.sin(lo), y: Math.cos(lo), z: 0 },
    n: { x: -Math.sin(la) * Math.cos(lo), y: -Math.sin(la) * Math.sin(lo), z: Math.cos(la) },
    u: { x: Math.cos(la) * Math.cos(lo), y: Math.cos(la) * Math.sin(lo), z: Math.sin(la) },
  };
}

// Axis unit vector for a tilt from vertical and a compass direction of lean, in
// whichever frame {e, n, u} is passed (ECEF here, or globe.gl scene space).
function axisFrom(frame, tiltDeg, dirDeg) {
  const t = tiltDeg * DEG, d = dirDeg * DEG;
  const ku = Math.cos(t), kn = Math.sin(t) * Math.cos(d), ke = Math.sin(t) * Math.sin(d);
  return {
    x: ku * frame.u.x + kn * frame.n.x + ke * frame.e.x,
    y: ku * frame.u.y + kn * frame.n.y + ke * frame.e.y,
    z: ku * frame.u.z + kn * frame.n.z + ke * frame.e.z,
  };
}

// A satellite's place relative to a (possibly tilted) land cone.  Null unless it
// is inside the cone AND above the local horizon (the Earth hides anything
// below); otherwise its range, elevation and angle off the axis.
function coneHit(frame, apex, axis, sat, halfAngleDeg, maxHeightKm) {
  const v = sub(sat, apex), range = mag(v);
  if (!range) return null;
  const up = dot(v, frame.u);
  if (up <= 0) return null;                              // below the horizon
  const axial = dot(v, axis);
  if (axial <= 0 || axial > maxHeightKm) return null;    // behind the apex or past the cap
  const offAxis = Math.acos(Math.min(1, axial / range)) / DEG;
  if (offAxis > halfAngleDeg) return null;
  return { range, elevation: Math.asin(Math.min(1, up / range)) / DEG, offAxis };
}

// Half-angular radius of the footprint a sensor cone of half-angle θ draws on
// the surface from altitude h:  ρ = arcsin((R + h) / R · sin θ) − θ.  NaN if the
// cone overshoots the horizon.
function footprintAngularRadius(altitudeKm, halfAngleDeg) {
  const theta = halfAngleDeg * DEG;
  const ratio = (EARTH_R_KM + altitudeKm) / EARTH_R_KM * Math.sin(theta);
  if (ratio > 1) return NaN;
  return Math.asin(ratio) - theta;
}

// Great-circle destination: from (lat, lng) travel angular distance δ on bearing β.
function destinationPoint(latDeg, lngDeg, delta, bearingDeg) {
  const lat = latDeg * DEG, lng = lngDeg * DEG, brg = bearingDeg * DEG;
  const sinLat2 = Math.sin(lat) * Math.cos(delta) + Math.cos(lat) * Math.sin(delta) * Math.cos(brg);
  const lat2 = Math.asin(sinLat2);
  const y = Math.sin(brg) * Math.sin(delta) * Math.cos(lat);
  const x = Math.cos(delta) - Math.sin(lat) * sinLat2;
  const lng2Deg = (((lng + Math.atan2(y, x)) / DEG + 540) % 360) - 180;
  return [lat2 / DEG, lng2Deg];
}

function coneFootprintPolygon(subSatLat, subSatLng, angularRadius, numPoints = 72) {
  const ring = [];
  for (let i = 0; i <= numPoints; i++) {
    const [lat, lng] = destinationPoint(subSatLat, subSatLng, angularRadius, (i / numPoints) * 360);
    ring.push([lng, lat]);   // GeoJSON order
  }
  return ring;
}

// --- Direction labels ----------------------------------------------------

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compassPoint = dir => COMPASS[Math.round(dir / 22.5) % 16];

// Bearing → clock reading: 360° is 12 hours, so 1° is two clock-minutes.
function clockTime(dir) {
  const mins = Math.round(dir * 2) % 720;
  return `${Math.floor(mins / 60) || 12}:${String(mins % 60).padStart(2, '0')}`;
}

// --- Globe ---------------------------------------------------------------

const globe = Globe()($('globe'))
  .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
  .bumpImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png')
  .backgroundImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/night-sky.png')
  .showAtmosphere(true)
  .atmosphereColor('#4ea8ff')
  .atmosphereAltitude(0.18)
  .pointOfView({ lat: 28.61, lng: 77.21, altitude: 2.4 }, 0)
  .polygonsData([])
  .polygonAltitude(0.001)
  .polygonCapColor(() => 'rgba(255, 100, 50, 0.18)')
  .polygonSideColor(() => 'rgba(255, 100, 50, 0.08)')
  .polygonStrokeColor(() => 'rgba(255, 160, 110, 0.85)')
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

// --- Cone objects --------------------------------------------------------

const Y_AXIS = new THREE.Vector3(0, 1, 0);
let coneGroup = null;   // land: cone + axis line + handle; sat: the cone mesh
let axisGrab = null;    // land cone only: { frame, apex, len, axis } in scene space

function clearCone() {
  if (!coneGroup) return;
  globe.scene().remove(coneGroup);
  coneGroup.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  coneGroup = null;
  axisGrab = null;
}

// East-North-Up at a ground point in globe.gl's scene space, taken from the
// globe itself (finite differences) so it always agrees with where points land.
function sceneFrame(latDeg, lngDeg) {
  const lat = Math.max(-89.9, Math.min(89.9, latDeg));
  const at = (la, lo) => { const c = globe.getCoords(la, lo, 0); return new THREE.Vector3(c.x, c.y, c.z); };
  const apex = at(lat, lngDeg);
  const u = apex.clone().normalize();
  const n = at(lat + 0.01, lngDeg).sub(apex);
  n.addScaledVector(u, -n.dot(u)).normalize();
  const e = at(lat, lngDeg + 0.01).sub(apex);
  e.addScaledVector(u, -e.dot(u)).addScaledVector(n, -e.dot(n)).normalize();
  return { apex, e, n, u };
}

// Land cone: tip on the surface, opening along the (tilted) axis.  Built along
// local +Y inside a group so re-aiming is just a quaternion change.
function drawLandCone(latDeg, lngDeg, halfAngleDeg, maxHeightKm) {
  clearCone();
  const frame = sceneFrame(latDeg, lngDeg);
  const height3D = maxHeightKm / KM_PER_UNIT;
  const baseRadius = height3D * Math.tan(halfAngleDeg * DEG);

  const geo = new THREE.ConeGeometry(baseRadius, height3D, 96, 1, true);
  geo.translate(0, -height3D / 2, 0);   // tip to the origin…
  geo.rotateX(Math.PI);                 // …base out along +Y
  const cone = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0x00ff88, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false,
  }));

  // The axis: a dotted white line from the tip to a little past the base, and a
  // handle at its end.  Drawn over everything so it stays visible inside the cone.
  const len = Math.max(height3D * AXIS_OVERSHOOT, MIN_AXIS_UNITS);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, len, 0)]),
    new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: len / 40, gapSize: len / 60, depthTest: false, transparent: true }));
  line.computeLineDistances();
  line.renderOrder = 5;

  const handle = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
  handle.position.set(0, len, 0);
  handle.renderOrder = 6;
  const worldPos = new THREE.Vector3();
  handle.onBeforeRender = (renderer, scene, cam) => {       // constant size on screen; grows while grabbable
    handle.getWorldPosition(worldPos);
    handle.scale.setScalar(cam.position.distanceTo(worldPos) * (dragging || hovering ? 0.011 : 0.007));
    handle.updateMatrixWorld();
  };

  const group = new THREE.Group();
  group.add(cone, line, handle);
  group.position.copy(frame.apex);
  globe.scene().add(group);
  coneGroup = group;
  axisGrab = { frame, apex: frame.apex, len, axis: null };
  orientLandCone();
}

function orientLandCone() {
  if (!axisGrab) return;
  axisGrab.axis = new THREE.Vector3().copy(axisFrom(axisGrab.frame, tilt.angle, tilt.dir)).normalize();
  coneGroup.quaternion.setFromUnitVectors(Y_AXIS, axisGrab.axis);
}

// Sat cone: apex at the satellite, axis toward Earth's centre, tip bright and
// base faint (shader fade), as on Game of Cones.
function drawSatCone(satLat, satLng, satAltKm, halfAngleDeg) {
  clearCone();
  const s = globe.getCoords(satLat, satLng, satAltKm / EARTH_R_KM);
  const sat = new THREE.Vector3(s.x, s.y, s.z);
  const height3D = sat.length();
  const baseRadius = height3D * Math.tan(halfAngleDeg * DEG);
  const geo = new THREE.ConeGeometry(baseRadius, height3D, 96, 1, true);
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
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(sat).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, sat.clone().normalize());
  globe.scene().add(mesh);
  coneGroup = mesh;
}

// --- Dragging the axis ---------------------------------------------------

const camera = globe.camera();
const canvas = globe.renderer().domElement;
const raycaster = new THREE.Raycaster();
let dragging = false, hovering = false;
const drag = { radius: 0, last: null };

function pointerAt(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    rect,
    mx: e.clientX - rect.left,
    my: e.clientY - rect.top,
    ndc: new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1),
  };
}

function toScreen(v, rect) {
  const p = v.clone().project(camera);
  return { x: (p.x + 1) / 2 * rect.width, y: (1 - p.y) / 2 * rect.height, behind: p.z > 1 };
}

// Is the pointer on the axis line or its handle?  Measured in screen pixels so
// the thin line is equally easy to grab at any zoom.
function onAxis(e) {
  if (currentMode !== 'land' || !axisGrab || !axisGrab.axis) return false;
  if (camera.position.clone().sub(axisGrab.apex).dot(axisGrab.apex) <= 0) return false;   // site is round the back
  const { rect, mx, my } = pointerAt(e);
  const a = toScreen(axisGrab.apex, rect);
  const b = toScreen(axisGrab.apex.clone().addScaledVector(axisGrab.axis, axisGrab.len), rect);
  if (a.behind || b.behind) return false;
  const abx = b.x - a.x, aby = b.y - a.y, len2 = abx * abx + aby * aby || 1;
  const t = Math.max(0, Math.min(1, ((mx - a.x) * abx + (my - a.y) * aby) / len2));
  const reach = e.pointerType === 'touch' ? GRAB_PX * 2 : GRAB_PX;
  return Math.hypot(mx - (a.x + t * abx), my - (a.y + t * aby)) <= reach;
}

// How far along the axis (0 = tip on the ground, 1 = handle) the pointer ray
// passes closest — the drag then pivots on that point, so nothing jumps.
function rayAxisParam(ray) {
  const u = axisGrab.axis.clone().multiplyScalar(axisGrab.len);
  const d = ray.direction, w = ray.origin.clone().sub(axisGrab.apex);
  const A = u.dot(u), B = u.dot(d), C = d.dot(d), D = u.dot(w), E = d.dot(w);
  const den = A * C - B * B;
  return den > 1e-9 ? Math.max(0, Math.min(1, (C * D - B * E) / den)) : 1;
}

// Re-aim the axis at where the pointer ray meets a sphere around the apex (of
// the two crossings, the one nearer the previous point, so the axis follows the
// hand even when it leans away from the camera).
function dragAxis(e) {
  raycaster.setFromCamera(pointerAt(e).ndc, camera);
  const { origin: o, direction: d } = raycaster.ray;
  const c = axisGrab.apex, oc = o.clone().sub(c), b = oc.dot(d);
  const disc = b * b - (oc.lengthSq() - drag.radius * drag.radius);
  let target;
  if (disc >= 0) {
    const q = Math.sqrt(disc);
    const p1 = o.clone().addScaledVector(d, -b - q), p2 = o.clone().addScaledVector(d, -b + q);
    target = p1.distanceToSquared(drag.last) <= p2.distanceToSquared(drag.last) ? p1 : p2;
  } else {
    target = o.clone().addScaledVector(d, -b);   // pointer outside the sphere: the ray's nearest point
  }
  drag.last = target.clone();
  const a = target.sub(c).normalize(), f = axisGrab.frame;
  const up = a.dot(f.u), north = a.dot(f.n), east = a.dot(f.e);
  const angle = Math.acos(Math.max(-1, Math.min(1, up))) / DEG;
  setTilt(angle, Math.hypot(north, east) < 1e-6 ? tilt.dir : Math.atan2(east, north) / DEG);
}

// Capture phase on the globe container, so a grab on the axis never reaches the
// globe's own rotate controls.
$('globe').addEventListener('pointerdown', e => {
  if (e.button !== 0 || !onAxis(e)) return;
  e.preventDefault();
  e.stopPropagation();
  raycaster.setFromCamera(pointerAt(e).ndc, camera);
  drag.radius = Math.max(0.3, rayAxisParam(raycaster.ray)) * axisGrab.len;
  drag.last = axisGrab.apex.clone().addScaledVector(axisGrab.axis, drag.radius);
  dragging = true;
  controls.enabled = false;
  canvas.style.cursor = 'grabbing';
}, true);

window.addEventListener('pointermove', e => {
  if (dragging) { dragAxis(e); return; }
  const over = onAxis(e);
  if (over !== hovering) {
    hovering = over;
    canvas.style.cursor = over ? 'grab' : '';
  }
});

function endDrag() {
  if (!dragging) return;
  dragging = false;
  controls.enabled = true;
  canvas.style.cursor = hovering ? 'grab' : '';
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

// --- Tilt state + clock face ---------------------------------------------

const tilt = { angle: 0, dir: 0 };   // degrees from vertical; compass bearing of the lean

const tiltRange = $('tilt-range');
const dirRange  = $('dir-range');
const clock     = $('clock');
const clockHand = $('clock-hand');
const clockTip  = $('clock-tip');

function setTilt(angle, dir) {
  tilt.angle = Math.round(Math.min(MAX_TILT, Math.max(0, angle)) * 10) / 10;
  tilt.dir = Math.round((((dir % 360) + 360) % 360) * 10) / 10 % 360;
  orientLandCone();
  renderTiltPanel();
  scheduleLandHits();
}

function renderTiltPanel() {
  const { angle, dir } = tilt, vertical = angle < 0.05;
  $('tilt-deg').textContent = angle.toFixed(1);
  $('tilt-dir').textContent = vertical
    ? 'Vertical — perpendicular to the ground'
    : `Leaning ${compassPoint(dir)} · ${clockTime(dir)} o’clock · bearing ${Math.round(dir) % 360}°`;
  const r = angle / MAX_TILT * CLOCK_PLOT_R, x = r * Math.sin(dir * DEG), y = -r * Math.cos(dir * DEG);
  clockHand.setAttribute('x2', x.toFixed(2));
  clockHand.setAttribute('y2', y.toFixed(2));
  clockHand.style.display = vertical ? 'none' : '';
  clockTip.setAttribute('cx', x.toFixed(2));
  clockTip.setAttribute('cy', y.toFixed(2));
  tiltRange.value = angle;
  dirRange.value = dir;
  $('tilt-range-val').textContent = angle.toFixed(1);
  $('dir-range-val').textContent = Math.round(dir) % 360;
}

(function buildClockTicks() {
  const NS = 'http://www.w3.org/2000/svg', g = $('clock-ticks');
  for (let h = 1; h <= 12; h++) {
    const sx = Math.sin(h * 30 * DEG), sy = -Math.cos(h * 30 * DEG), major = h % 3 === 0;
    const tick = document.createElementNS(NS, 'line');
    tick.setAttribute('x1', (sx * (major ? 56 : 59)).toFixed(2));
    tick.setAttribute('y1', (sy * (major ? 56 : 59)).toFixed(2));
    tick.setAttribute('x2', (sx * 64).toFixed(2));
    tick.setAttribute('y2', (sy * 64).toFixed(2));
    tick.setAttribute('class', major ? 'tick major' : 'tick');
    g.appendChild(tick);
    if (!major) continue;
    const num = document.createElementNS(NS, 'text');
    num.setAttribute('x', (sx * 51).toFixed(2));
    num.setAttribute('y', (sy * 51).toFixed(2));
    num.setAttribute('class', 'num');
    num.textContent = h;
    g.appendChild(num);
  }
})();

// Click or drag on the clock face: direction from the angle, tilt from the radius.
let clockDown = false;
function clockPick(e) {
  const pt = clock.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const p = pt.matrixTransform(clock.getScreenCTM().inverse());
  const angle = Math.min(MAX_TILT, Math.hypot(p.x, p.y) / CLOCK_PLOT_R * MAX_TILT);
  setTilt(angle, angle < 0.5 ? tilt.dir : Math.atan2(p.x, -p.y) / DEG);
}
clock.addEventListener('pointerdown', e => { clockDown = true; clock.setPointerCapture(e.pointerId); clockPick(e); });
clock.addEventListener('pointermove', e => { if (clockDown) clockPick(e); });
clock.addEventListener('pointerup', () => { clockDown = false; });
clock.addEventListener('pointercancel', () => { clockDown = false; });

tiltRange.addEventListener('input', () => setTilt(+tiltRange.value, tilt.dir));
dirRange.addEventListener('input', () => setTilt(tilt.angle, +dirRange.value));
$('tilt-reset').addEventListener('click', () => setTilt(0, tilt.dir));

// --- TLE catalogue -------------------------------------------------------

let allSats = [];              // [{ name, noradId, rec }]
const latestProp = new Map();  // noradId → { lat, lon, alt }
let propTimer = null;
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
  if (currentMode === 'land') updateLandHits();
  else                        solveSatCone();
}

// --- Mode tabs -----------------------------------------------------------

const tabLand   = $('tab-land');
const tabSat    = $('tab-sat');
const panelLand = $('mode-land');
const panelSat  = $('mode-sat');

function activateMode(mode) {
  currentMode = mode;
  const isLand = mode === 'land';
  tabLand.classList.toggle('active', isLand);
  tabSat.classList.toggle('active', !isLand);
  tabLand.setAttribute('aria-selected', isLand);
  tabSat.setAttribute('aria-selected', !isLand);
  panelLand.hidden = !isLand;
  panelSat.hidden = isLand;
  clearCone();
  globe.polygonsData([]);
  globe.objectsData([]);
  if (isLand) solveLandCone();
  else        solveSatCone();
}
tabLand.addEventListener('click', () => activateMode('land'));
tabSat.addEventListener('click', () => activateMode('sat'));

function bindSlider(rangeId, valueId, onChange) {
  const r = $(rangeId), v = $(valueId);
  const sync = () => { v.textContent = r.value; onChange(); };
  r.addEventListener('input', sync);
  sync();
}

// --- Land Cone mode ------------------------------------------------------

const landLatEl    = $('land-lat');
const landLngEl    = $('land-lng');
const landAngleEl  = $('land-angle');
const landHeightEl = $('land-height');
const landCountEl  = $('land-count');
const landListEl   = $('land-list');

const ORBIT_COLOR = { LEO: '#67e8a4', MEO: '#f9d24c', GEO: '#ff9966', HEO: '#d77eff' };
function orbitClass(altKm) {
  if (altKm < 2000)  return 'LEO';
  if (altKm < 30000) return 'MEO';
  if (altKm < 42000) return 'GEO';
  return 'HEO';
}

function landInputs() {
  const lat = parseFloat(landLatEl.value), lng = parseFloat(landLngEl.value);
  const valid = Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  landLatEl.style.borderColor = valid ? '' : 'var(--accent2)';
  landLngEl.style.borderColor = valid ? '' : 'var(--accent2)';
  return valid ? { lat, lng, angle: parseFloat(landAngleEl.value), height: parseFloat(landHeightEl.value) } : null;
}

function solveLandCone() {
  if (currentMode !== 'land') return;
  const inp = landInputs();
  if (!inp) return;
  drawLandCone(inp.lat, inp.lng, inp.angle, inp.height);
  updateLandHits();
}

function updateLandHits() {
  if (currentMode !== 'land' || !allSats.length) return;
  const inp = landInputs();
  if (!inp) return;
  const frame = enuFrame(inp.lat, inp.lng);
  const apex = geodeticToECEF(inp.lat, inp.lng, 0);
  const axis = axisFrom(frame, tilt.angle, tilt.dir);
  const hits = [];
  for (const t of allSats) {
    const p = latestProp.get(t.noradId);
    if (!p) continue;
    const h = coneHit(frame, apex, axis, geodeticToECEF(p.lat, p.lon, p.alt), inp.angle, inp.height);
    if (!h) continue;
    const cls = orbitClass(p.alt);
    hits.push({ name: t.name, lat: p.lat, lon: p.lon, alt: p.alt, cls, color: ORBIT_COLOR[cls], big: true, ...h });
  }
  hits.sort((a, b) => a.offAxis - b.offAxis);   // nearest the axis first
  landCountEl.textContent = hits.length;
  globe.objectsData(hits);
  landListEl.innerHTML = hits.map(s => `
    <div class="item">
      <div class="name" style="color:${s.color}">${escHtml(s.name)}</div>
      <div class="meta"><span style="color:${s.color}">${s.cls}</span> · Alt <strong>${s.alt.toFixed(0)} km</strong> · Range <strong>${s.range.toFixed(0)} km</strong></div>
      <div class="meta muted">Elevation ${s.elevation.toFixed(1)}° · ${s.offAxis.toFixed(1)}° off axis</div>
    </div>`).join('') || '<div class="hint">No satellites inside the cone.</div>';
}

// While the axis is being dragged the list refreshes at most ~10× a second.
let hitsQueued = false, lastHitsAt = 0;
function scheduleLandHits() {
  if (hitsQueued) return;
  hitsQueued = true;
  requestAnimationFrame(function run(ts) {
    if (ts - lastHitsAt < 90) { requestAnimationFrame(run); return; }
    hitsQueued = false;
    lastHitsAt = ts;
    updateLandHits();
  });
}

landLatEl.addEventListener('input', solveLandCone);
landLngEl.addEventListener('input', solveLandCone);
bindSlider('land-angle',  'land-angle-val',  solveLandCone);
bindSlider('land-height', 'land-height-val', solveLandCone);

// --- Sat Cone mode -------------------------------------------------------

const satSearchEl = $('sat-search');
const satHitsEl   = $('sat-hits');
const satAngleEl  = $('sat-angle');
const satStatusEl = $('sat-status');
let selectedSat = null;

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
  satHitsEl.hidden = false;
  satHitsEl.innerHTML = hits.length
    ? hits.map(h => `<div class="item" data-norad="${h.noradId}">${escHtml(h.name)}</div>`).join('')
    : '<div class="item" style="color:var(--dim)">No matches.</div>';
}

satSearchEl.addEventListener('input', e => renderSatHits(e.target.value));
satHitsEl.addEventListener('click', e => {
  const row = e.target.closest('.item[data-norad]');
  if (!row) return;
  const t = allSats.find(s => s.noradId === parseInt(row.dataset.norad, 10));
  if (!t) return;
  selectedSat = t;
  satSearchEl.value = t.name;
  satHitsEl.hidden = true;
  solveSatCone();
});

function solveSatCone() {
  if (currentMode !== 'sat') return;
  if (!selectedSat) { satStatusEl.textContent = 'No satellite selected.'; return; }
  const p = latestProp.get(selectedSat.noradId);
  if (!p) { satStatusEl.textContent = `${selectedSat.name} — propagation unavailable.`; return; }
  const halfAngle = parseFloat(satAngleEl.value);

  drawSatCone(p.lat, p.lon, p.alt, halfAngle);

  const rho = footprintAngularRadius(p.alt, halfAngle);
  if (!Number.isFinite(rho)) {
    globe.polygonsData([]);
    satStatusEl.innerHTML = `<strong>${escHtml(selectedSat.name)}</strong><br>
      Alt ${p.alt.toFixed(0)} km · ${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}°<br>
      Cone overshoots the horizon — no surface footprint.`;
  } else {
    globe.polygonsData([{ geometry: { type: 'Polygon', coordinates: [coneFootprintPolygon(p.lat, p.lon, rho, 96)] } }]);
    satStatusEl.innerHTML = `<strong>${escHtml(selectedSat.name)}</strong><br>
      Alt ${p.alt.toFixed(0)} km · ${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}°<br>
      Footprint radius ${(rho * EARTH_R_KM).toFixed(0)} km on the surface.`;
  }
  globe.objectsData([{ name: selectedSat.name, lat: p.lat, lon: p.lon, alt: p.alt, color: '#ffb070', big: true }]);
}

bindSlider('sat-angle', 'sat-angle-val', solveSatCone);

// --- Boot ----------------------------------------------------------------

renderTiltPanel();
activateMode('land');
loadCatalogue();
