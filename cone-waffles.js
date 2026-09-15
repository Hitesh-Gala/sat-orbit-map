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
// Date & time (right-hand panel): live by default; any moment from now up to
// MAX_AHEAD_DAYS ahead can be picked instead, and everything is recomputed for it.
// Its "1 hour lead" button opens a pop-up: a polar map, centred on the Land
// cone's site, of every satellite that enters the cone in the hour after that
// moment, plotted where each one is at the start, with a table of them.
//
// Tilt convention: tilt = angle between the axis and local vertical (0° =
// straight up, 90° = along the horizon); direction = compass bearing of the
// lean, clockwise from North (0° = 12 o'clock, 90° = 3 o'clock).
//
// Shares TLE loading with the rest of the site via window.Argos (tle-loader.js);
// positions are propagated here with satellite.js directly (see satGeo).

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
const MAX_AHEAD_DAYS   = 15;                       // time panel: the furthest moment that can be picked
const IST_OFFSET_MS    = 5.5 * 3600000;            // IST = UTC + 5:30

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

// --- Date & time (right-hand panel) --------------------------------------
//
// Live by default: positions follow the real clock.  Picking a moment (the
// slider, or a date + time in UTC or IST) freezes the scene at that instant.
// It must lie between now and MAX_AHEAD_DAYS ahead; if a frozen moment slips
// into the past while the page is open, the panel snaps back to live.

const timeState = { live: true, fixed: 0 };     // fixed: epoch ms while not live
const simNow = () => (timeState.live ? new Date() : new Date(timeState.fixed));
const AHEAD_LIMIT_MS = MAX_AHEAD_DAYS * 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const tMode = $('t-mode'), tModeText = $('t-mode-text');
const tAhead = $('t-ahead'), tDate = $('t-date'), tTime = $('t-time'), tZone = $('t-zone');
const tNote = $('t-note'), tNow = $('t-now');

const zoneOffset = () => (tZone.value === 'IST' ? IST_OFFSET_MS : 0);

function fmtStamp(ms, offsetMs) {
  const d = new Date(ms + offsetMs);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${d.toISOString().slice(11, 19)}`;
}

function fmtAhead(ms) {
  const mins = Math.round(ms / 60000);
  if (mins <= 0) return 'now';
  const d = Math.floor(mins / 1440), h = Math.floor(mins / 60) % 24, m = mins % 60;
  return `+${d ? `${d} d ` : ''}${String(h).padStart(2, '0')} h ${String(m).padStart(2, '0')} m`;
}

function renderTimePanel() {
  const ms = simNow().getTime(), now = Date.now(), ahead = timeState.live ? 0 : ms - now;
  $('t-utc').textContent = `${fmtStamp(ms, 0)} UTC`;
  $('t-ist').textContent = `${fmtStamp(ms, IST_OFFSET_MS)} IST`;
  tMode.classList.toggle('live', timeState.live);
  tModeText.textContent = timeState.live ? 'Live · current date & time' : 'Chosen date & time';
  tAhead.value = Math.round(ahead / 60000);
  $('t-ahead-val').textContent = fmtAhead(ahead);
  if (document.activeElement !== tDate && document.activeElement !== tTime) {   // don't fight typing
    const z = new Date(ms + zoneOffset()).toISOString();
    tDate.value = z.slice(0, 10);
    tTime.value = z.slice(11, 16);
  }
  tDate.min = new Date(now + zoneOffset()).toISOString().slice(0, 10);
  tDate.max = new Date(now + AHEAD_LIMIT_MS + zoneOffset()).toISOString().slice(0, 10);
  tNow.disabled = timeState.live;
}

// Recompute everything for the new moment — throttled, since each pass
// propagates the whole catalogue and a slider drag fires many inputs.
let propQueued = false, lastPropAt = 0;
function schedulePropagate() {
  if (!allSats.length || propQueued) return;
  propQueued = true;
  requestAnimationFrame(function run(ts) {
    if (ts - lastPropAt < 150) { requestAnimationFrame(run); return; }
    propQueued = false;
    lastPropAt = ts;
    propagateAll();
  });
}

function goLive(note = '') {
  timeState.live = true;
  tNote.textContent = note;
  renderTimePanel();
  schedulePropagate();
}

function setSimTime(ms) {
  const now = Date.now();
  const clamped = Math.min(Math.max(ms, now), now + AHEAD_LIMIT_MS);
  let note = '';
  if (ms < now - 60000) note = 'The past isn’t available — showing the current moment.';
  else if (ms > now + AHEAD_LIMIT_MS) note = `That is more than ${MAX_AHEAD_DAYS} days ahead — showing the furthest moment allowed.`;
  if (clamped - now < 30000) { goLive(note); return; }   // within half a minute of now: just go live
  timeState.live = false;
  timeState.fixed = clamped;
  tNote.textContent = note;
  renderTimePanel();
  schedulePropagate();
}

function timeFromInputs() {
  if (!tDate.value || !tTime.value) return;
  const [y, mo, d] = tDate.value.split('-').map(Number);
  const [h, mi] = tTime.value.split(':').map(Number);
  setSimTime(Date.UTC(y, mo - 1, d, h, mi) - zoneOffset());
}

tAhead.addEventListener('input', () => {
  const mins = +tAhead.value;
  if (mins === 0) goLive(); else setSimTime(Date.now() + mins * 60000);
});
tDate.addEventListener('change', timeFromInputs);
tTime.addEventListener('change', timeFromInputs);
tZone.addEventListener('change', renderTimePanel);   // same moment, shown in the other zone
tNow.addEventListener('click', () => goLive());

setInterval(() => {   // every second: tick the clocks; a chosen moment that has passed snaps back to live
  if (!timeState.live && timeState.fixed < Date.now()) goLive('The chosen moment has passed — back to the current time.');
  else renderTimePanel();
}, 1000);

// --- TLE catalogue -------------------------------------------------------

let allSats = [];              // [{ name, noradId, rec }]
const latestProp = new Map();  // Land Cone: noradId → { eci, ecf } positions (km) at propTime
let propTimer = null;
let propTime = new Date();     // instant of the latest propagation
let propGmst = 0;              // Greenwich sidereal angle at propTime
let currentMode = 'land';

async function loadCatalogue() {
  setStatus('Loading TLE catalogue…');
  try {
    const { tles, source } = await window.Argos.fetchTLEs();
    allSats = window.Argos.makeSatrecs(tles);
    setStatus(`Catalogue: ${allSats.length.toLocaleString()} sats (${source})`);
    propagateAll();
    if (propTimer) clearInterval(propTimer);
    propTimer = setInterval(() => { if (timeState.live) propagateAll(); }, PROP_INTERVAL_MS);
  } catch (e) {
    setStatus('TLE fetch failed: ' + e.message, true);
  }
}

// Lat/lon/alt of one satellite at `date` — SGP4 + geodetic, as tle-loader's
// propagate() but without its observer look-angles.
function satGeo(rec, date, gmst = satellite.gstime(date)) {
  const pv = satellite.propagate(rec, date);
  if (!pv || !pv.position) return null;
  const g = satellite.eciToGeodetic(pv.position, gmst);
  const lat = satellite.degreesLat(g.latitude), lon = satellite.degreesLong(g.longitude), alt = g.height;
  return Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(alt) ? { lat, lon, alt } : null;
}

// Recompute for the current (or chosen) moment.  Sat Cone needs only its own
// satellite.  Land Cone runs SGP4 for the whole catalogue but keeps the raw
// positions (inertial + Earth-fixed): the geodetic conversion is several times
// dearer than SGP4 itself, so updateLandHits does it only near the cone.
function propagateAll() {
  const now = simNow();
  propTime = now;
  if (currentMode === 'sat') { solveSatCone(); return; }
  propGmst = satellite.gstime(now);
  latestProp.clear();
  for (const t of allSats) {
    const pv = satellite.propagate(t.rec, now);
    if (!pv || !pv.position || !Number.isFinite(pv.position.x)) continue;
    latestProp.set(t.noradId, { eci: pv.position, ecf: satellite.eciToEcf(pv.position, propGmst) });
  }
  updateLandHits();
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
  if (isLand) { solveLandCone(); propagateAll(); }   // catalogue may be stale after Sat Cone
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

// Margin (km) for the quick Earth-fixed pre-check.  A satellite's true
// (ellipsoid) position differs from the spherical placement this page draws —
// and tests — by at most ~30 km, so nothing further outside the cone than
// this can pass the exact test below.
const COARSE_KM = 60;

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
    const v = sub(p.ecf, apex), range = mag(v), axial = dot(v, axis);
    if (dot(v, frame.u) < -COARSE_KM || axial < -COARSE_KM || axial > inp.height + COARSE_KM) continue;
    if (range > COARSE_KM &&
        Math.acos(Math.max(-1, Math.min(1, axial / range))) / DEG > inp.angle + 1 + Math.atan2(COARSE_KM, range) / DEG) continue;
    const g = satellite.eciToGeodetic(p.eci, propGmst);
    const lat = satellite.degreesLat(g.latitude), lon = satellite.degreesLong(g.longitude), alt = g.height;
    const h = coneHit(frame, apex, axis, geodeticToECEF(lat, lon, alt), inp.angle, inp.height);
    if (!h) continue;
    const cls = orbitClass(alt);
    hits.push({ name: t.name, lat, lon, alt, cls, color: ORBIT_COLOR[cls], big: true, ...h });
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
  const p = satGeo(selectedSat.rec, propTime);
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

// --- 1 hour lead (pop-up) -------------------------------------------------
//
// From the chosen moment T, find every satellite that is inside the Land cone
// at some instant in [T, T + 1 h] and plot where it is at T.  The plot is an
// azimuthal-equidistant map centred on the site: true bearings, North up, and
// distance along the ground — square-root scaled, so the cone stays readable
// next to satellites half a world away.
//
// Each orbit is sampled once a minute in Earth-fixed coordinates.  Between two
// samples a satellite stays within half their separation of the midpoint, so
// a minute whose midpoint isn't that close to the cone can't hold a pass; the
// few minutes that are get checked second by second with the exact cone test.

const LEAD_MIN       = 60;
const LEAD_STEP_MS   = 60000;
const LEAD_TRACK_MIN = 75;                 // hover track: at most this far past T
const LEAD_R         = 260;                // plot radius in SVG units (viewBox ±300)
const WORLD_MAP_URL  = 'data/countries-110m.geojson';

// Purpose from the name: tle-loader's (China-focused) table first, then these.
const PURPOSE_TYPES = [
  [/STARLINK|ONEWEB|IRIDIUM|GLOBALSTAR|INTELSAT|EUTELSAT|ASTRA|INMARSAT|THURAYA|VIASAT|ECHOSTAR|GUOWANG|QIANFAN|CHINASAT|ZHONGXING|YAMAL|EXPRESS-|TIANTONG|KUIPER|ORBCOMM|GONETS|MOLNIYA|RADUGA|GORIZONT|TDRS|SICRAL|SKYNET|MILSTAR/, 'Communications'],
  [/NAVSTAR|GLONASS|GALILEO|GSAT0|BEIDOU|QZS-|IRNSS|NAVIC/, 'Navigation'],
  [/METEOR-|NOAA |GOES |METOP|HIMAWARI|FENGYUN|INSAT|ELEKTRO|DMSP|SUOMI|JPSS|METEOSAT|MTG-/, 'Meteorology'],
  [/YAOGAN|LACROSSE|ONYX|OFEQ|HELIOS|SAR-LUPE|CSO-|EROS|NROL|MENTOR|TRUMPET|COSMOS/, 'ISR / military'],
  [/LANDSAT|SENTINEL|SPOT-|PLEIADES|WORLDVIEW|GEOEYE|QUICKBIRD|IKONOS|SKYSAT|FLOCK|DOVE|RESOURCESAT|CARTOSAT|KOMPSAT|ICEYE|CAPELLA|TERRASAR|RADARSAT|ALOS|JILIN|SUPERVIEW|BLACKSKY|GAOFEN|TERRA|AQUA|PRISMA/, 'Earth observation'],
  [/HUBBLE|CHANDRA|SPITZER|KEPLER|TESS|JWST|SWIFT|FERMI|XMM|INTEGRAL|GAIA|CHEOPS|EUCLID|IXPE|NUSTAR|SOHO|SDO |IRIS |THEMIS|MMS |ICON /, 'Science / astronomy'],
  [/ISS |ZARYA|TIANHE|TIANGONG|PROGRESS|SOYUZ|DRAGON|CYGNUS|SHENZHOU|TIANZHOU|CREW/, 'Crewed / logistics'],
  [/CUBESAT|TECHSAT|PATHFINDER|TECHNOSAT|PROBA|DEMO|TEST/, 'Technology demo'],
  [/AMSAT|OSCAR/, 'Amateur radio'],
];
function purposeOf(name) {
  const p = window.Argos.inferPurpose(name);
  if (p !== 'Not publicly stated') return p;
  const n = name.toUpperCase();
  for (const [re, t] of PURPOSE_TYPES) if (re.test(n)) return t;
  return 'Not publicly stated';
}

const leadEl = $('lead'), leadSvg = $('lead-svg'), leadRows = $('lead-rows'), leadInfo = $('lead-info');
const leadProg = $('lead-progress');
const LEAD_INFO_HINT = '<div class="hint">Hover a satellite on the plot (or a row of the table) to see its ground track over the hour and its details.</div>';
let leadToken = 0;       // bumped on every open / close, so a stale scan stops
let leadCtx = null;      // { c, T, sats, dmax, cone }
let leadHover = -1;

const fmtKm   = km => Math.round(km).toLocaleString('en-US');
const fmtLead = ms => { const sec = Math.round(ms / 1000); return `${Math.floor(sec / 60)} m ${String(sec % 60).padStart(2, '0')} s`; };
const clockAt = ms => `${new Date(ms + zoneOffset()).toISOString().slice(11, 19)} ${tZone.value}`;

function coneCtx(inp) {
  const frame = enuFrame(inp.lat, inp.lng);
  return { inp, frame, apex: geodeticToECEF(inp.lat, inp.lng, 0), axis: axisFrom(frame, tilt.angle, tilt.dir),
           ca: Math.cos(inp.angle * DEG), sa: Math.sin(inp.angle * DEG) };
}

// Could an Earth-fixed point (km) lie within m km of the cone?  The distance to
// the cone's side line never exceeds the true distance, so nothing that close
// is ever rejected.
function nearCone(c, p, m) {
  const v = sub(p, c.apex), a = dot(v, c.axis);
  if (dot(v, c.frame.u) < -m || a < -m || a > c.inp.height + m) return false;
  return Math.sqrt(Math.max(0, dot(v, v) - a * a)) * c.ca - a * c.sa <= m;
}

// The exact Land-cone test (as updateLandHits) at one instant.
function inConeAt(c, rec, ms) {
  const date = new Date(ms), pv = satellite.propagate(rec, date);
  if (!pv || !pv.position || !Number.isFinite(pv.position.x)) return false;
  const gmst = satellite.gstime(date);
  if (!nearCone(c, satellite.eciToEcf(pv.position, gmst), COARSE_KM)) return false;
  const g = satellite.eciToGeodetic(pv.position, gmst);
  return !!coneHit(c.frame, c.apex, c.axis,
    geodeticToECEF(satellite.degreesLat(g.latitude), satellite.degreesLong(g.longitude), g.height), c.inp.angle, c.inp.height);
}

// Milliseconds after T at which the satellite first enters the cone (0 = inside
// already), or -1 if it doesn't within the hour.
function leadEntry(c, rec, t0, gmsts, maxRange) {
  if (rec.a * (1 - rec.ecco) * 6378.135 - EARTH_R_KM - COARSE_KM > maxRange) return -1;   // perigee out of reach
  let prev = null;
  for (let i = 0; i < gmsts.length; i++) {
    const ms = t0 + i * LEAD_STEP_MS;
    const pv = satellite.propagate(rec, new Date(ms));
    if (!pv || !pv.position || !Number.isFinite(pv.position.x)) { prev = null; continue; }
    const cur = satellite.eciToEcf(pv.position, gmsts[i]);
    if (nearCone(c, cur, COARSE_KM) && inConeAt(c, rec, ms)) {
      if (i === 0) return 0;
      let lo = ms - LEAD_STEP_MS, hi = ms;               // outside at lo, inside at hi
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2;
        if (inConeAt(c, rec, mid)) hi = mid; else lo = mid;
      }
      return hi - t0;
    }
    if (prev) {
      const mid = { x: (prev.x + cur.x) / 2, y: (prev.y + cur.y) / 2, z: (prev.z + cur.z) / 2 };
      if (nearCone(c, mid, mag(sub(cur, prev)) / 2 + COARSE_KM)) {   // a pass could hide inside this minute
        for (let t = ms - LEAD_STEP_MS + 1000; t < ms; t += 1000) if (inConeAt(c, rec, t)) return t - t0;
      }
    }
    prev = cur;
  }
  return -1;
}

// Ground distance (km) and bearing from the site, and the plot position.
function leadProject(lat, lon) {
  const L = leadCtx, p1 = L.c.inp.lat * DEG, p2 = lat * DEG, dl = (lon - L.c.inp.lng) * DEG;
  const cosC = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  const d = Math.acos(Math.max(-1, Math.min(1, cosC))) * EARTH_R_KM;
  const az = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
  const r = d > L.dmax ? LEAD_R * 1.02 : LEAD_R * Math.sqrt(d / L.dmax);
  return { x: r * Math.sin(az), y: -r * Math.cos(az), d, az };
}

// The cone's reach over the ground: the points below rings of the cone at
// several heights up to the cap (their outline is drawn as the inner shape).
function coneRim(c) {
  const { inp, axis, frame, apex } = c, pts = [];
  const ref = Math.abs(dot(frame.n, axis)) < 0.9 ? frame.n : frame.e, k = dot(ref, axis);
  let b1 = { x: ref.x - k * axis.x, y: ref.y - k * axis.y, z: ref.z - k * axis.z };
  const n1 = mag(b1);
  b1 = { x: b1.x / n1, y: b1.y / n1, z: b1.z / n1 };
  const b2 = { x: axis.y * b1.z - axis.z * b1.y, y: axis.z * b1.x - axis.x * b1.z, z: axis.x * b1.y - axis.y * b1.x };
  const spread = Math.tan(Math.min(inp.angle, 89) * DEG);
  for (let j = 1; j <= 12; j++) {
    const h = inp.height * j / 12;
    for (let q = 0; q < 48; q++) {
      const u = Math.cos(q / 48 * 2 * Math.PI) * spread * h, w = Math.sin(q / 48 * 2 * Math.PI) * spread * h;
      const P = { x: apex.x + axis.x * h + b1.x * u + b2.x * w, y: apex.y + axis.y * h + b1.y * u + b2.y * w, z: apex.z + axis.z * h + b1.z * u + b2.z * w };
      pts.push({ lat: Math.asin(P.z / mag(P)) / DEG, lon: Math.atan2(P.y, P.x) / DEG });
    }
  }
  return pts;
}

function convexHull(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
    upper.push(pts[i]);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// The "1-hour" boundary: round the plot in 5° sectors, just outside the
// farthest satellite still to enter.  Not a circle — faster orbits reach
// the cone from farther away.
function hourBoundary(sats) {
  const N = 72, bins = new Array(N).fill(-1);
  let filled = 0;
  for (const s of sats) {
    if (!s.entry) continue;
    const k = Math.floor(((s.az / DEG + 360) % 360) / 5) % N, r = Math.hypot(s.x, s.y);
    if (bins[k] < 0) filled++;
    bins[k] = Math.max(bins[k], r);
  }
  if (filled < 8) return '';
  const out = bins.map((r, k) => {                  // empty sectors: interpolate round the circle
    if (r >= 0) return r;
    let a = 1, b = 1;
    while (bins[(k - a + N) % N] < 0) a++;
    while (bins[(k + b) % N] < 0) b++;
    const ra = bins[(k - a + N) % N], rb = bins[(k + b) % N];
    return ra + (rb - ra) * a / (a + b);
  });
  let d = '';
  for (let k = 0; k < N; k++) {   // vertex on each sector edge, clear of both neighbours
    const r = Math.min(LEAD_R + 2, Math.max(out[k], out[(k + N - 1) % N]) + 7), a = k * 5 * DEG;
    d += `${k ? 'L' : 'M'}${(r * Math.sin(a)).toFixed(1)} ${(-r * Math.cos(a)).toFixed(1)}`;
  }
  return d + 'Z';
}

function leadColor(ms) {   // green (entering now) → amber → red (in an hour)
  const stops = [[103, 232, 164], [249, 210, 76], [255, 107, 107]];
  const t = Math.min(1, ms / (LEAD_MIN * 60000)) * 2, i = Math.min(1, Math.floor(t)), f = t - i;
  const [a, b] = [stops[i], stops[i + 1]];
  return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * f)).join(',')})`;
}

let worldMap = null, worldMapPromise = null;
function loadWorldMap() {
  return worldMapPromise || (worldMapPromise = fetch(WORLD_MAP_URL)
    .then(r => (r.ok ? r.json() : null)).then(j => (worldMap = j)).catch(() => null));
}
const polysOf = g => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

function countryAt(lat, lng) {
  if (!worldMap) return '';
  const inRing = ring => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  for (const f of worldMap.features) {
    if (polysOf(f.geometry).some(poly => inRing(poly[0]) && !poly.slice(1).some(inRing))) return f.properties.NAME || '';
  }
  return '';
}

// Country outlines on the polar map.  Rings that jump across the plot (round
// the antipode) are only stroked; the rest are filled.
function leadMapPaths() {
  let fill = '', line = '';
  for (const f of worldMap.features) {
    for (const poly of polysOf(f.geometry)) {
      for (const ring of poly) {
        let d = '', broken = false, px = null, py = null;
        for (const [lon, lat] of ring) {
          const q = leadProject(lat, lon);
          const jump = px !== null && Math.hypot(q.x - px, q.y - py) > LEAD_R * 0.5;
          if (jump) broken = true;
          d += `${px === null || jump ? 'M' : 'L'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
          px = q.x; py = q.y;
        }
        if (broken) line += d; else fill += d + 'Z';
      }
    }
  }
  return `<path class="lm-land" d="${fill}"/><path class="lm-coast" d="${line}"/>`;
}

function leadSubtitle(c, T, country) {
  const { inp } = c, off = zoneOffset();
  const ns = `${Math.abs(inp.lat).toFixed(2)}° ${inp.lat >= 0 ? 'N' : 'S'}`, ew = `${Math.abs(inp.lng).toFixed(2)}° ${inp.lng >= 0 ? 'E' : 'W'}`;
  const axis = tilt.angle < 0.05 ? 'axis vertical' : `axis tilted ${tilt.angle.toFixed(1)}° toward ${compassPoint(tilt.dir)}`;
  return `<b>${ns}, ${ew}${country ? ` · ${escHtml(country)}` : ''}</b> · half-angle ${inp.angle}° · up to ${fmtKm(inp.height)} km along the axis · ${axis}<br>
    Satellites entering the cone between <b>${fmtStamp(T, off)} ${tZone.value}</b> and <b>${clockAt(T + LEAD_MIN * 60000)}</b> — plotted where they are at the start`;
}

function renderLead(country) {
  const L = leadCtx, R = LEAD_R, out = [];
  out.push(`<defs><clipPath id="lead-clip"><circle r="${R}"/></clipPath></defs><circle class="lm-disc" r="${R}"/>`);
  if (worldMap) out.push(`<g clip-path="url(#lead-clip)">${leadMapPaths()}</g>`);
  for (let a = 0; a < 360; a += 45) {
    out.push(`<line class="lm-spoke" x1="0" y1="0" x2="${(R * Math.sin(a * DEG)).toFixed(1)}" y2="${(-R * Math.cos(a * DEG)).toFixed(1)}"/>`);
  }
  let lastR = 0;
  for (const km of [100, 250, 500, 1000, 2000, 5000, 10000, 15000]) {
    const r = R * Math.sqrt(km / L.dmax);
    if (km > L.dmax * 0.92 || r - lastR < 30 || R - r < 22) continue;
    lastR = r;
    out.push(`<circle class="lm-ring" r="${r.toFixed(1)}"/><text class="lm-rtext" x="${(r * 0.5 + 3).toFixed(1)}" y="${(r * 0.866).toFixed(1)}">${fmtKm(km)} km</text>`);
  }
  out.push(`<text class="lm-rtext" x="${(R * 0.5 + 6).toFixed(1)}" y="${(R * 0.866 + 12).toFixed(1)}">${fmtKm(L.dmax)} km</text>`);
  if (L.cone.length > 2) out.push(`<path class="lm-cone" d="M${L.cone.map(q => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('L')}Z"/>`);
  const hour = hourBoundary(L.sats);
  if (hour) out.push(`<path class="lm-hour" d="${hour}"/>`);
  for (const [t, a] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
    out.push(`<text class="lm-compass" x="${((R + 16) * Math.sin(a * DEG)).toFixed(1)}" y="${(-(R + 16) * Math.cos(a * DEG)).toFixed(1)}">${t}</text>`);
  }
  out.push('<g id="lead-track" clip-path="url(#lead-clip)"></g>');
  for (let i = L.sats.length - 1; i >= 0; i--) {   // soonest on top
    const s = L.sats[i];
    out.push(`<circle class="lm-dot" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="3.4" fill="${s.color}"/>`);
  }
  out.push(`<path class="lm-site" d="M-7 0H7M0 -7V7"/><text class="lm-sitetext" x="0" y="-13">${escHtml(country || 'Site')}</text>`);
  out.push('<g id="lead-hl"></g>');
  leadSvg.innerHTML = out.join('');

  const inside = L.sats.filter(s => !s.entry).length;
  $('lead-count').innerHTML = `<b>${L.sats.length.toLocaleString('en-US')}</b> satellites in the cone within the hour` +
    (inside ? ` · ${inside} already inside at the start` : '');
  leadRows.innerHTML = L.sats.map((s, i) => `<tr data-i="${i}">
    <td class="num">${i + 1}</td><td><i class="sw" style="background:${s.color}"></i>${escHtml(s.name)}</td>
    <td class="num">${s.noradId}</td><td class="num">${fmtKm(s.alt)}</td><td class="num">${s.speed.toFixed(2)}</td>
    <td class="num">${s.period.toFixed(1)}</td><td class="num">${s.entry ? fmtLead(s.entry) : 'inside now'}</td>
    <td>${escHtml(s.purpose)}</td></tr>`).join('') ||
    '<tr><td colspan="8" class="empty">No satellite enters the cone in this hour.</td></tr>';
}

// The satellite's ground track from T (to a little past its entry), faint,
// with the stretch inside the cone picked out.
function leadTrack(s) {
  const { c, T } = leadCtx, endMs = Math.min(LEAD_TRACK_MIN, Math.max(LEAD_MIN, s.entry / 60000 + 10)) * 60000;
  let all = '', inside = '', prev = null, prevIn = false;
  for (let t = 0; t <= endMs; t += 20000) {
    const date = new Date(T + t), pv = satellite.propagate(s.rec, date);
    if (!pv || !pv.position) { prev = null; continue; }
    const g = satellite.eciToGeodetic(pv.position, satellite.gstime(date));
    const lat = satellite.degreesLat(g.latitude), lon = satellite.degreesLong(g.longitude);
    const q = leadProject(lat, lon), pt = `${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    const isIn = !!coneHit(c.frame, c.apex, c.axis, geodeticToECEF(lat, lon, g.height), c.inp.angle, c.inp.height);
    const joined = prev && Math.hypot(q.x - prev.x, q.y - prev.y) < LEAD_R * 0.5;
    all += `${joined ? 'L' : 'M'}${pt}`;
    if (isIn) inside += joined && prevIn ? `L${pt}` : `M${pt}L${pt}`;
    prev = q;
    prevIn = isIn;
  }
  const e = s.entry ? satGeo(s.rec, new Date(T + s.entry)) : null;
  return { all, inside, entry: e && leadProject(e.lat, e.lon) };
}

function setLeadHover(i, fromPlot) {
  if (!leadCtx || i === leadHover) return;
  leadHover = i;
  const trackG = $('lead-track'), hlG = $('lead-hl');
  leadRows.querySelectorAll('tr.on').forEach(r => r.classList.remove('on'));
  if (i < 0) { trackG.innerHTML = ''; hlG.innerHTML = ''; leadInfo.innerHTML = LEAD_INFO_HINT; return; }
  const s = leadCtx.sats[i], tr = leadTrack(s);
  trackG.innerHTML = `<path class="lm-track" d="${tr.all}"/><path class="lm-track-in" d="${tr.inside}"/>`;
  hlG.innerHTML = (tr.entry ? `<circle class="lm-entry" cx="${tr.entry.x.toFixed(1)}" cy="${tr.entry.y.toFixed(1)}" r="4.5"/>` : '') +
    `<circle class="lm-hl" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="7.5"/>`;
  leadInfo.innerHTML = `<div class="nm" style="color:${s.color}">${escHtml(s.name)}</div>
    <dl>
      <dt>NORAD ID</dt><dd>${s.noradId}</dd>
      <dt>Altitude</dt><dd>${fmtKm(s.alt)} km</dd>
      <dt>Speed</dt><dd>${s.speed.toFixed(2)} km/s</dd>
      <dt>Period</dt><dd>${s.period.toFixed(1)} min</dd>
      <dt>Purpose</dt><dd>${escHtml(s.purpose)}</dd>
      <dt>Enters cone</dt><dd>${s.entry ? `in ${fmtLead(s.entry)} · at ${clockAt(leadCtx.T + s.entry)}` : 'already inside at the start'}</dd>
      <dt>At the start</dt><dd>${fmtKm(s.d)} km ${compassPoint((s.az / DEG + 360) % 360)} of the site · ${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°</dd>
    </dl>`;
  const row = leadRows.querySelector(`tr[data-i="${i}"]`);
  if (row) {
    row.classList.add('on');
    if (fromPlot) row.scrollIntoView({ block: 'nearest' });
  }
}

function leadProgress(msg, frac) {
  leadProg.hidden = false;
  $('lead-progress-text').textContent = msg;
  const bar = $('lead-progress-bar');
  bar.parentElement.hidden = frac == null;
  bar.style.width = `${Math.round((frac || 0) * 100)}%`;
}

async function openLead() {
  const token = ++leadToken;
  leadEl.hidden = false;
  leadCtx = null;
  leadHover = -1;
  leadSvg.innerHTML = '';
  leadRows.innerHTML = '';
  leadInfo.innerHTML = LEAD_INFO_HINT;
  $('lead-count').textContent = '';
  $('lead-sub').textContent = '';
  const inp = landInputs();
  if (!inp) { leadProgress('Enter a valid latitude and longitude for the Land cone first.'); return; }
  const T = simNow().getTime(), c = coneCtx(inp);
  $('lead-sub').innerHTML = leadSubtitle(c, T, '');
  if (!allSats.length) { leadProgress('The satellite catalogue is still loading — close this and try again in a moment.'); return; }
  const mapReady = loadWorldMap();

  const gmsts = Array.from({ length: LEAD_MIN + 1 }, (_, i) => satellite.gstime(new Date(T + i * LEAD_STEP_MS)));
  const maxRange = c.ca > 1e-3 ? inp.height / c.ca : Infinity;
  const found = [], total = allSats.length;
  let tick = performance.now();
  leadProgress(`Scanning ${total.toLocaleString('en-US')} satellites over the hour ahead…`, 0);
  for (let k = 0; k < total; k++) {
    const e = leadEntry(c, allSats[k].rec, T, gmsts, maxRange);
    if (e >= 0) found.push({ t: allSats[k], entry: e });
    if (performance.now() - tick > 30) {
      leadProgress(`Scanning ${total.toLocaleString('en-US')} satellites over the hour ahead… ${Math.round(k / total * 100)} %`, k / total);
      await new Promise(r => setTimeout(r, 0));
      if (token !== leadToken) return;
      tick = performance.now();
    }
  }
  await mapReady;
  if (token !== leadToken) return;

  const sats = [];
  for (const f of found) {
    const pv = satellite.propagate(f.t.rec, new Date(T));
    if (!pv || !pv.position) continue;
    const g = satellite.eciToGeodetic(pv.position, gmsts[0]), v = pv.velocity;
    sats.push({ name: f.t.name, noradId: f.t.noradId, rec: f.t.rec, entry: f.entry,
      lat: satellite.degreesLat(g.latitude), lon: satellite.degreesLong(g.longitude), alt: g.height,
      speed: Math.hypot(v.x, v.y, v.z), period: 2 * Math.PI / f.t.rec.no, purpose: purposeOf(f.t.name), color: leadColor(f.entry) });
  }
  sats.sort((a, b) => a.entry - b.entry || a.name.localeCompare(b.name));
  leadCtx = { c, T, sats, dmax: 1, cone: [] };
  const rim = coneRim(c);
  let far = 0;
  for (const s of sats) far = Math.max(far, (s.d = leadProject(s.lat, s.lon).d));
  for (const q of rim) far = Math.max(far, leadProject(q.lat, q.lon).d);
  leadCtx.dmax = Math.min(Math.PI * EARTH_R_KM, Math.max(500, far * 1.06));
  for (const s of sats) Object.assign(s, (({ x, y, az }) => ({ x, y, az }))(leadProject(s.lat, s.lon)));
  leadCtx.cone = convexHull([[0, 0], ...rim.map(q => { const r = leadProject(q.lat, q.lon); return [r.x, r.y]; })]);

  const country = countryAt(inp.lat, inp.lng);
  $('lead-sub').innerHTML = leadSubtitle(c, T, country);
  renderLead(country);
  leadProg.hidden = true;
}

function closeLead() {
  leadToken++;
  leadEl.hidden = true;
}

function leadPointer(e) {
  if (!leadCtx || !leadCtx.sats.length) return;
  const ctm = leadSvg.getScreenCTM();
  if (!ctm) return;
  const pt = leadSvg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const q = pt.matrixTransform(ctm.inverse());
  let best = -1, bd = (14 / ctm.a) ** 2;   // within ~14 px
  leadCtx.sats.forEach((s, i) => {
    const d = (s.x - q.x) ** 2 + (s.y - q.y) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  if (best >= 0 || e.pointerType === 'mouse') setLeadHover(best, true);
}

$('t-lead').addEventListener('click', openLead);
$('lead-close').addEventListener('click', closeLead);
leadEl.addEventListener('click', e => { if (e.target === leadEl) closeLead(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !leadEl.hidden) closeLead(); });
leadSvg.addEventListener('pointermove', leadPointer);
leadSvg.addEventListener('pointerdown', leadPointer);
leadRows.addEventListener('mouseover', e => { const tr = e.target.closest('tr[data-i]'); if (tr) setLeadHover(+tr.dataset.i, false); });
leadRows.addEventListener('click', e => { const tr = e.target.closest('tr[data-i]'); if (tr) setLeadHover(+tr.dataset.i, false); });

// --- Boot ----------------------------------------------------------------

renderTiltPanel();
renderTimePanel();
syncSatPointing();
activateMode('land');
loadCatalogue();
