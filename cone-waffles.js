// Cone-Waffles — Game of Cones with a steerable land cone.
//
//   Land Cone: apex on the ground, axis free to swivel.  The axis is drawn as a
//     dotted white line running a little past the cone, with a grab handle at
//     its end; drag either to tilt the cone anywhere above the horizon.  The
//     left panel shows the lean on a clock face (12 = North) plus the tilt in
//     degrees from vertical, and lists every satellite inside the cone that is
//     also above the local horizon, with range, elevation and off-axis angle.
//   Sat Cone: a satellite's sensor cone and its ground footprint.  The sensor
//     can be pointed off nadir in two restricted ways, each up to ±45°: forward /
//     back along the orbital path, and left / right of it.  A dotted white line
//     marks the boresight (display only — not draggable).
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
const ORBIT_ARC_DEG    = 5;                        // red orbital path: this much arc either side of the sat…
const ORBIT_ARC_STEPS  = 20;                       // …sampled with this many points per side
const ARROW_SCREEN     = 0.03;                     // orbit arrowheads: length ∝ camera distance (≈ constant on screen)

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
let coneGroup = null;   // land: cone + axis line + handle; sat: cone + boresight line + orbit arc
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

// Where a ray (scene units) first meets the globe's sphere; null if it misses.
function raySphere(origin, dir, radius = GLOBE_RADIUS) {
  const b = origin.dot(dir), disc = b * b - (origin.lengthSq() - radius * radius);
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}

const geoOf = v => globe.toGeoCoords({ x: v.x, y: v.y, z: v.z });

// Pointing frame at a satellite, in scene space: `up` (radial), `fwd` along the
// orbital path and `right` of it.  `fwd` comes from the orbit itself — two
// instants 10 s apart with the Earth held still — so it is the orbital
// direction, well defined even for a geostationary satellite.  `right` is
// taken geographically (heading + 90°), so it can't come out mirrored.  `arc`
// is a short stretch of the orbit either side, in the same frame, so the red
// path and "forward" always agree.
function satPointingFrame(rec, date) {
  const gmst = satellite.gstime(date);
  const p0 = satellite.propagate(rec, date);
  const p1 = satellite.propagate(rec, new Date(date.getTime() + 10000));
  if (!p0 || !p0.position || !p1 || !p1.position) return null;
  const geo = eci => {
    const g = satellite.eciToGeodetic(eci, gmst);
    return { lat: satellite.degreesLat(g.latitude), lon: satellite.degreesLong(g.longitude), alt: g.height };
  };
  const scene = g => { const c = globe.getCoords(g.lat, g.lon, g.alt / EARTH_R_KM); return new THREE.Vector3(c.x, c.y, c.z); };
  const here = geo(p0.position);
  const S = scene(here), up = S.clone().normalize();
  const fwd = scene(geo(p1.position)).sub(S);
  fwd.addScaledVector(up, -fwd.dot(up)).normalize();
  const f = sceneFrame(here.lat, here.lon);
  const tn = fwd.dot(f.n), te = fwd.dot(f.e);
  const right = f.e.clone().multiplyScalar(tn).addScaledVector(f.n, -te).normalize();

  const span = (2 * Math.PI / rec.no) * 60000 * ORBIT_ARC_DEG / 360;   // ms of orbit per side
  const arc = [];
  for (let i = -ORBIT_ARC_STEPS; i <= ORBIT_ARC_STEPS; i++) {
    const pv = satellite.propagate(rec, new Date(date.getTime() + span * i / ORBIT_ARC_STEPS));
    if (pv && pv.position) arc.push(scene(geo(pv.position)));
  }
  return { S, up, fwd, right, arc, heading: (Math.atan2(te, tn) / DEG + 360) % 360 };
}

function satBoresight(pf, alongDeg, crossDeg) {
  return pf.up.clone().negate()
    .addScaledVector(pf.fwd, Math.tan(alongDeg * DEG))
    .addScaledVector(pf.right, Math.tan(crossDeg * DEG))
    .normalize();
}

// Ground footprint of a (possibly off-nadir) sensor cone: cast rays round the
// cone's edge onto the globe.  Edge rays that miss are walked back toward nadir
// until they just graze the Earth, i.e. clipped at the visible horizon.  Null
// when the cone doesn't touch the Earth at all.
function satFootprint(pf, axis, halfAngleDeg, numPoints = 96) {
  const nadir = pf.up.clone().negate();
  const ref = Math.abs(axis.dot(pf.fwd)) < 0.9 ? pf.fwd : pf.right;
  const b1 = ref.clone().addScaledVector(axis, -ref.dot(axis)).normalize();
  const b2 = new THREE.Vector3().crossVectors(axis, b1);
  const spread = Math.tan(halfAngleDeg * DEG);
  const blend = (d, t) => nadir.clone().multiplyScalar(1 - t).addScaledVector(d, t).normalize();
  let anyHit = axis.angleTo(nadir) <= halfAngleDeg * DEG;     // nadir inside the cone
  const ring = [];
  for (let i = 0; i <= numPoints; i++) {
    const phi = (i / numPoints) * 2 * Math.PI;
    let dir = axis.clone().addScaledVector(b1, spread * Math.cos(phi)).addScaledVector(b2, spread * Math.sin(phi)).normalize();
    let t = raySphere(pf.S, dir);
    if (t !== null) {
      anyHit = true;
    } else {
      let lo = 0, hi = 1;
      for (let k = 0; k < 16; k++) {
        const mid = (lo + hi) / 2;
        if (raySphere(pf.S, blend(dir, mid)) !== null) lo = mid; else hi = mid;
      }
      dir = blend(dir, lo);
      t = raySphere(pf.S, dir);
    }
    const g = geoOf(pf.S.clone().addScaledVector(dir, t));
    ring.push([g.lng, g.lat]);
  }
  if (!anyHit) return null;
  // Wind it like a clockwise compass sweep, as Game of Cones fed globe.gl.
  let acc = 0, prev = ring[0][0], area = 0;
  const flat = ring.map(([lng, lat]) => {
    let d = lng - prev;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    acc += d;
    prev = lng;
    return [ring[0][0] + acc, lat];
  });
  for (let i = 0; i < flat.length - 1; i++) area += flat[i][0] * flat[i + 1][1] - flat[i + 1][0] * flat[i][1];
  return area > 0 ? ring.reverse() : ring;
}

// A small red arrowhead on the orbit line, pointing along `dir`.  The front one
// has its tip on the line's end and the rear one its base, so both stay on the
// line.  A constant size on screen, but never longer than 30 % of the line.
function orbitArrow(at, dir, tipOnPoint, lineLen) {
  const geo = new THREE.ConeGeometry(0.35, 1, 16);
  geo.translate(0, tipOnPoint ? -0.5 : 0.5, 0);
  const arrow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff3b3b }));
  arrow.position.copy(at);
  arrow.quaternion.setFromUnitVectors(Y_AXIS, dir.clone().normalize());
  arrow.renderOrder = 4;
  const worldPos = new THREE.Vector3();
  arrow.onBeforeRender = (renderer, scene, cam) => {
    arrow.getWorldPosition(worldPos);
    arrow.scale.setScalar(Math.min(cam.position.distanceTo(worldPos) * ARROW_SCREEN, lineLen * 0.3));
    arrow.updateMatrixWorld();
  };
  return arrow;
}

// Sat cone: tip at the satellite, opening along the boresight; tip bright and
// base faint (shader fade).  It runs to the plane through Earth's centre, so
// the visible part ends at the surface as on Game of Cones.  The boresight is
// marked by a dotted white line down to the ground — depth-tested, so the globe
// hides anything past the surface — plus a thin red stretch of the orbit either
// side of the satellite, with arrowheads showing the direction of travel.  Returns the distance to the ground along the
// boresight (null if it misses the Earth).
function drawSatCone(pf, axis, halfAngleDeg) {
  clearCone();
  const height3D = pf.S.length() * Math.cos(axis.angleTo(pf.up.clone().negate()));
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
  const cone = new THREE.Mesh(geo, mat);
  cone.position.set(0, -height3D / 2, 0);   // tip (local +Y·h/2) on the group origin = the satellite

  const hit = raySphere(pf.S, axis);
  const len = hit !== null ? hit * 1.03 : height3D;
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -len, 0)]),
    new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: len / 40, gapSize: len / 60, transparent: true }));
  line.computeLineDistances();
  line.renderOrder = 5;

  const pointed = new THREE.Group();
  pointed.add(cone, line);
  pointed.position.copy(pf.S);
  pointed.quaternion.setFromUnitVectors(Y_AXIS, axis.clone().negate());   // local −Y = boresight

  const orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pf.arc),
    new THREE.LineBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.9 }));
  orbit.renderOrder = 4;

  const group = new THREE.Group();
  group.add(pointed, orbit);
  const arc = pf.arc, n = arc.length;
  if (n >= 2) {   // arrowheads at both ends, both pointing the way the satellite travels
    const lineLen = arc[n - 1].distanceTo(pf.S);
    group.add(orbitArrow(arc[0], arc[1].clone().sub(arc[0]), false, lineLen),
              orbitArrow(arc[n - 1], arc[n - 1].clone().sub(arc[n - 2]), true, lineLen));
  }
  globe.scene().add(group);
  coneGroup = group;
  return hit;
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

$('tilt-reset').addEventListener('click', () => setTilt(0, tilt.dir));

// --- TLE catalogue -------------------------------------------------------

let allSats = [];              // [{ name, noradId, rec }]
const latestProp = new Map();  // noradId → { lat, lon, alt }
let propTimer = null;
let propTime = new Date();     // instant of the latest propagation
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
  propTime = now;
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
const satAlongEl  = $('sat-along');
const satCrossEl  = $('sat-cross');
let selectedSat = null;

// "12.5° forward", "8.0° left" … or '' when (near) zero.
const lean = (v, pos, neg) => (Math.abs(v) < 0.05 ? '' : `${Math.abs(v).toFixed(1)}° ${v > 0 ? pos : neg}`);

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
  const pf = p && satPointingFrame(selectedSat.rec, propTime);
  if (!pf) { satStatusEl.textContent = `${selectedSat.name} — propagation unavailable.`; return; }
  const along = +satAlongEl.value, cross = +satCrossEl.value, halfAngle = +satAngleEl.value;

  const axis = satBoresight(pf, along, cross);
  const hit = drawSatCone(pf, axis, halfAngle);
  const ring = satFootprint(pf, axis, halfAngle);
  globe.polygonsData(ring ? [{ geometry: { type: 'Polygon', coordinates: [ring] } }] : []);

  const marks = [{ name: selectedSat.name, lat: p.lat, lon: p.lon, alt: p.alt, color: '#ffb070', big: true }];
  let boresight = 'The boresight misses the Earth.';
  if (hit !== null) {
    const ground = pf.S.clone().addScaledVector(axis, hit), g = geoOf(ground);
    marks.push({ name: 'Boresight on the ground', lat: g.lat, lon: g.lng, alt: 5, color: '#ffffff' });
    boresight = `Boresight on the ground at ${g.lat.toFixed(2)}°, ${g.lng.toFixed(2)}° — ` +
                `${(ground.angleTo(pf.S) * EARTH_R_KM).toFixed(0)} km from the point below the satellite.`;
  }
  globe.objectsData(marks);

  const offNadir = axis.angleTo(pf.up.clone().negate()) / DEG;
  const pointing = [lean(along, 'forward', 'back'), lean(cross, 'right', 'left')].filter(Boolean).join(' · ');
  satStatusEl.innerHTML = `<strong>${escHtml(selectedSat.name)}</strong><br>
    Alt ${p.alt.toFixed(0)} km · ${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}° · heading ${compassPoint(pf.heading)} (${Math.round(pf.heading) % 360}°)<br>
    Pointing ${pointing ? `${pointing} — ${offNadir.toFixed(1)}° off nadir` : 'straight down (nadir)'}<br>
    ${boresight}<br>
    ${ring ? 'Footprint shown in orange.' : 'The cone misses the Earth — no footprint.'}`;
}

function syncSatPointing() {
  $('sat-along-val').textContent = lean(+satAlongEl.value, 'forward', 'back') || '0° (nadir)';
  $('sat-cross-val').textContent = lean(+satCrossEl.value, 'right', 'left') || '0° (nadir)';
  solveSatCone();
}
satAlongEl.addEventListener('input', syncSatPointing);
satCrossEl.addEventListener('input', syncSatPointing);
$('sat-point-reset').addEventListener('click', () => {
  satAlongEl.value = 0;
  satCrossEl.value = 0;
  syncSatPointing();
});

bindSlider('sat-angle', 'sat-angle-val', solveSatCone);

// --- Boot ----------------------------------------------------------------

renderTiltPanel();
syncSatPointing();
activateMode('land');
loadCatalogue();
