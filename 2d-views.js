// Argos — 2-D ground-track view.
//
// A clean, bright equirectangular world map (NASA Blue Marble raster, no
// political borders).  The user searches for one satellite; then chooses one
// of two modes with the panel toggle:
//
//   TIME-BASED  — the sub-satellite ground track for the 24 h before and after
//                 "now" as bold dotted lines (past = cyan, future = amber) with
//                 a direction arrow every 30 min and hover place-names.
//
//   REV-BASED   — the dotted tracks disappear; instead the satellite dot flies
//                 forward from its present position at a chosen speed (1×–100×),
//                 tracing a thin golden trail, capped at 3 revolutions before it
//                 snaps back to the present.  A slider sets the speed and shows
//                 the projected UTC / IST time the satellite is over each point.
//
// The overlay is a plain SVG.  Because the projection is equirectangular,
// lon/lat map linearly to the viewBox (x = lon+180, y = 90-lat), so points sit
// exactly on the raster's coastlines and we control exactly how bold they are.
//
// Data layer: shared Argos namespace (tle-loader.js).  Reverse-geocoding uses
// the amCharts worldLow GeoJSON (loaded as data only).

const { propagate, makeSatrecs, fetchTLEs, EARTH_R_KM } = window.Argos;

const TRACK_MIN       = 24 * 60;   // minutes of track each side of "now"
const LINE_STEP_MIN   = 1;         // sampling for the dotted line
const MARK_STEP_MIN   = 30;        // interval markers + arrows
const CURRENT_REFRESH = 5_000;     // live "now" marker cadence (time mode)
const TRACK_REFRESH   = 5 * 60_000;// recompute the ±24 h window periodically

const SPEEDS   = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];  // rev-mode relative speeds
const MAX_REVS = 3;                            // rev-mode trail cap
const GOLD_STEP_MIN = 0.5;                     // golden-trail sampling (sim min)

const DEG = Math.PI / 180, RAD = 180 / Math.PI;
const SVGNS = 'http://www.w3.org/2000/svg';

const vx = lon => lon + 180;   // degrees → viewBox units
const vy = lat => 90 - lat;

const $ = id => document.getElementById(id);

function setStatus(msg) { const el = $('map-status'); if (el) el.textContent = msg; }

// ---------------------------------------------------------------------------
// Reverse geocoding — point-in-polygon against worldLow, ocean-basin fallback.
// ---------------------------------------------------------------------------

let COUNTRIES = [];

function buildCountries() {
  const feats = (window.am5geodata_worldLow && am5geodata_worldLow.features) || [];
  for (const f of feats) {
    const g = f.geometry;
    if (!g) continue;
    const name = (f.properties && (f.properties.name || f.properties.NAME)) || '—';
    let polys;
    if (g.type === 'Polygon') polys = [g.coordinates];
    else if (g.type === 'MultiPolygon') polys = g.coordinates;
    else continue;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const poly of polys) for (const ring of poly) for (const p of ring) {
      if (p[0] < minLon) minLon = p[0]; if (p[0] > maxLon) maxLon = p[0];
      if (p[1] < minLat) minLat = p[1]; if (p[1] > maxLat) maxLat = p[1];
    }
    COUNTRIES.push({ name, polys, bbox: [minLon, minLat, maxLon, maxLat] });
  }
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon, lat, poly) {
  let inside = false;
  for (const ring of poly) if (pointInRing(lon, lat, ring)) inside = !inside;
  return inside;
}

function countryAt(lat, lon) {
  for (const c of COUNTRIES) {
    const b = c.bbox;
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    for (const poly of c.polys) if (pointInPolygon(lon, lat, poly)) return c.name;
  }
  return null;
}

function oceanAt(lat, lon) {
  if (lat <= -55) return 'the Southern Ocean';
  if (lat >= 66)  return 'the Arctic Ocean';
  if (lat >= 30 && lat <= 47 && lon >= -6 && lon <= 42) return 'the Mediterranean Sea';
  if (lat < 30 && lon >= 20 && lon <= 100) return 'the Indian Ocean';
  if (lat < 0  && lon > 100 && lon <= 147) return 'the Indian Ocean';
  if (lon >= -70 && lon <= 20) return 'the Atlantic Ocean';
  if (lat >= 5 && lon >= -100 && lon < -70) return 'the Caribbean / W. Atlantic';
  return 'the Pacific Ocean';
}

function placeName(lat, lon) { return countryAt(lat, lon) || oceanAt(lat, lon); }

// ---------------------------------------------------------------------------
// Track math
// ---------------------------------------------------------------------------

function bearing(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * DEG, φ2 = lat2 * DEG, Δλ = (lon2 - lon1) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * RAD + 360) % 360;
}

function sample(rec, anchor, fromMin, toMin) {
  const pts = [];
  for (let m = fromMin; m <= toMin; m += LINE_STEP_MIN) {
    const r = propagate(rec, new Date(anchor.getTime() + m * 60000));
    if (r && Number.isFinite(r.lat) && Number.isFinite(r.lon)) pts.push({ lat: r.lat, lon: r.lon });
  }
  return pts;
}

// Points ({lat,lon}) → SVG path, split at antimeridian wraps.
function segmentPath(pts) {
  let d = '', prevLon = null, started = false;
  for (const p of pts) {
    if (prevLon !== null && Math.abs(p.lon - prevLon) > 180) started = false;
    d += (started ? ' L ' : ' M ') + vx(p.lon).toFixed(2) + ',' + vy(p.lat).toFixed(2);
    started = true;
    prevLon = p.lon;
  }
  return d.trim();
}

function fmtRel(m) {
  const s = m < 0 ? '−' : '+';
  const a = Math.abs(m);
  return `${s}${Math.floor(a / 60)}h ${String(a % 60).padStart(2, '0')}m`;
}

// ---------------------------------------------------------------------------
// SVG overlay — static bits
// ---------------------------------------------------------------------------

const ARROW_D = 'M 0,-1.7 L 1.35,1.25 L 0,0.55 L -1.35,1.25 Z';  // points "north" (−y)

function drawGraticule() {
  let d = '';
  for (let lon = -150; lon <= 150; lon += 30) d += `M ${vx(lon)},0 L ${vx(lon)},180 `;
  for (let lat = -60; lat <= 60; lat += 30) d += `M 0,${vy(lat)} L 360,${vy(lat)} `;
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('d', d);
  $('graticule').appendChild(path);
}

// ---------------------------------------------------------------------------
// Time-based track (dotted past/future lines + 30-min arrows)
// ---------------------------------------------------------------------------

function drawTrackLines(rec, anchor) {
  const pd = segmentPath(sample(rec, anchor, -TRACK_MIN, 0));
  const fd = segmentPath(sample(rec, anchor, 0, TRACK_MIN));
  $('past-line').setAttribute('d', pd);   $('past-halo').setAttribute('d', pd);
  $('future-line').setAttribute('d', fd); $('future-halo').setAttribute('d', fd);
}

function drawMarks(rec, anchor) {
  const g = $('marks');
  g.textContent = '';
  for (let m = -TRACK_MIN; m <= TRACK_MIN; m += MARK_STEP_MIN) {
    if (m === 0) continue;
    const d = new Date(anchor.getTime() + m * 60000);
    const r = propagate(rec, d);
    if (!r || !Number.isFinite(r.lat)) continue;
    const r2 = propagate(rec, new Date(d.getTime() + 60000));
    const hd = r2 ? bearing(r.lat, r.lon, r2.lat, r2.lon) : 0;

    const grp = document.createElementNS(SVGNS, 'g');
    grp.setAttribute('class', 'mark ' + (m > 0 ? 'future' : 'past'));
    grp.setAttribute('transform', `translate(${vx(r.lon).toFixed(2)},${vy(r.lat).toFixed(2)}) rotate(${hd.toFixed(1)})`);
    grp.dataset.tip =
      `${d.toISOString().slice(11, 16)} UTC · ${fmtRel(m)}\nover ${placeName(r.lat, r.lon)}\n${r.lat.toFixed(1)}°, ${r.lon.toFixed(1)}°`;

    const hit = document.createElementNS(SVGNS, 'circle');
    hit.setAttribute('r', '2.6'); hit.setAttribute('class', 'mark-hit');
    const arrow = document.createElementNS(SVGNS, 'path');
    arrow.setAttribute('d', ARROW_D); arrow.setAttribute('class', 'mark-arrow');
    grp.appendChild(hit); grp.appendChild(arrow);
    g.appendChild(grp);
  }
}

// ---------------------------------------------------------------------------
// Shared marker + info
// ---------------------------------------------------------------------------

let satrecs = [];
let selected = null;
let anchor = null;
let nowLatLon = null;

function orbitFacts(rec) {
  return { periodMin: rec.no ? (2 * Math.PI) / rec.no : NaN, incDeg: rec.inclo * RAD };
}

function shortName(n) { return n.length > 22 ? n.slice(0, 21) + '…' : n; }

function positionNowLabel(lat, lon) {
  const cell = $('map-cell'), label = $('now-label');
  if (label.hidden) return;
  label.style.left = (vx(lon) / 360 * cell.clientWidth) + 'px';
  label.style.top  = (vy(lat) / 180 * cell.clientHeight) + 'px';
}

function setNowMarker(lat, lon, alt, t) {
  const now = $('now');
  now.style.display = '';
  now.setAttribute('transform', `translate(${vx(lon).toFixed(2)},${vy(lat).toFixed(2)})`);
  nowLatLon = [lat, lon];
  const label = $('now-label');
  label.hidden = false;
  label.textContent = shortName(selected.name);
  positionNowLabel(lat, lon);
  updateGlobe(lat, lon, alt, t);
  updateGlobe2(lat, lon, alt, t);
}

// ---------------------------------------------------------------------------
// Companion 3-D globe (globe.gl) — kept centred on the selected satellite: the
// globe spins in longitude so the sub-point faces the viewer, while the sat
// marker rides up/down with latitude.  Fed from the same setNowMarker() path,
// so it stays in lock-step with the 2-D map in both modes and at any speed.
// ---------------------------------------------------------------------------

const GLOBE_CAM_ALT = 2.5;
let globe = null, satMesh = null;

// Second globe: fixed camera that orbits at Earth's rotation rate, so the
// Earth appears to spin while the satellite traces a fixed inertial ellipse
// (front of / behind the globe).  Not centred on the satellite.
const GLOBE2_TILT = 22;        // camera latitude — a gentle 3/4 view
// Globe 2's Earth ALWAYS stays the same size in its little column slot — its
// size is the cue for "the satellite is behind the planet" (the dashed orbit
// arc + the blinking hollow dot).  The orbit is drawn in two regimes:
//   • NORMAL (near-circular: LEO…GEO, incl. inclined-geo like QZS) — the ring
//     is compressed to hug just above the Earth and drawn right in globe.gl, so
//     a large arc clearly passes behind the planet.
//   • HEO   (very elliptical: Molniya/GTO/CXO/Cluster) — the true ellipse dwarfs
//     the little globe, so the RING alone is decoupled from it: an SVG overlay
//     draws the ellipse (Earth at its focus) extending out over the 2-D map,
//     scaled so the perigee clears the Earth.  A huge apogee simply runs off the
//     screen — only the ring extends, the Earth never moves or shrinks.
const GLOBE2_ECC_HEO       = 0.20;  // eccentricity above which the ring goes to the overlay
const GLOBE2_TARGET_NORMAL = 1.4;   // near-circular apogee sits ~1.4 R above the Earth
const GLOBE2_CAM_NORMAL    = 2.6;   // ≈ globe 1's camera — Earth kept the same big size
const GLOBE2_PERIGEE_GAP   = 1.3;   // overlay perigee sits ~1.3× the Earth's on-screen radius out
let orbit2Scale = 1, globe2CamAlt = GLOBE2_CAM_NORMAL, globe2Overlay = false, overlayPeriR = 1;
let globe2 = null, satMesh2 = null, satHalo2 = null, satRing2 = null;
let overlayPts = null, overlayGmst = 0;   // HEO ring points (ECI) + current sidereal angle
let behind2 = false;           // is the sat currently behind the globe-2 Earth?

// Golden orbit-path rings (one per globe).  Same gold as the 2-D map's trail.
const RING_GOLD = 0xffd23f;
let ring1 = null, ring2Group = null, lastRing1Build = 0;
const gmstOf = (t) => (window.satellite && satellite.gstime) ? satellite.gstime(t || new Date()) : 0;

// Compress real altitude (km) into a tight band just above the small globe.
// A GEO/HEO sat is tens of thousands of km up — placed to scale it would fly
// off the little viewport (a 100 000 km sat at high latitude projects past the
// top edge).  A log curve keeps LEO hugging the surface and every higher class
// within ~0.28 R, so they all stay visible and centred like the LEO/MEO dots.
function globeAltFrac(alt) {
  const km = Number.isFinite(alt) && alt > 0 ? alt : 400;
  return Math.min(0.28, 0.03 + 0.10 * Math.log10(1 + km / 400));
}

// Places each ring point at radius 100·(1+af).  Near-circular orbits use a
// uniform orbit2Scale < 1 to hug the Earth (drawn in globe.gl); very elliptical
// orbits use orbit2Scale = 1 (TRUE distance) and the resulting points are handed
// to the SVG overlay, which re-scales the whole ellipse to fit around the Earth.
// getCoords(lat,lon,af) sits at radius 100·(1+af); to land at scale·trueRadius
// we solve af = scale·(1 + alt/R) − 1.
function globe2AltFrac(alt) {
  const km = Number.isFinite(alt) && alt > 0 ? alt : 400;
  return orbit2Scale * (1 + km / EARTH_R_KM) - 1;
}

// On each selection: sample the orbit for its apogee, perigee and eccentricity,
// then pick the regime.  The Earth's camera never moves (it stays its normal
// size); only the ring's treatment changes — compressed-in-globe for near-
// circular orbits, or true-scale in the SVG overlay for very elliptical ones.
function computeOrbit2Scale(rec) {
  const f = orbitFacts(rec);
  const period = Number.isFinite(f.periodMin) && f.periodMin > 0 ? f.periodMin : 92;
  const t0 = Date.now();
  let apoR = 1.02, periR = Infinity;                 // apogee / perigee, in Earth radii
  for (let i = 0; i < 64; i++) {
    const r = propagate(rec, new Date(t0 + period * 60000 * i / 64));
    if (r && Number.isFinite(r.alt)) {
      const rr = 1 + r.alt / EARTH_R_KM;
      apoR = Math.max(apoR, rr); periR = Math.min(periR, rr);
    }
  }
  if (!Number.isFinite(periR)) periR = apoR;
  const ecc = (apoR - periR) / (apoR + periR);       // orbit eccentricity from the radii
  globe2Overlay = ecc > GLOBE2_ECC_HEO;
  globe2CamAlt = GLOBE2_CAM_NORMAL;                   // Earth always the same normal size
  if (globe2Overlay) {
    orbit2Scale = 1;                                  // true-scale points; the overlay re-scales to fit
    overlayPeriR = periR;
  } else {
    // Near-circular: compress the ring to hug just above the Earth so a large
    // arc is clearly occluded as the satellite goes behind (drawn in globe.gl).
    orbit2Scale = Math.min(1, GLOBE2_TARGET_NORMAL / apoR);
  }
}

function globeSize() {
  const el = $('mini-globe');
  const w = el.clientWidth || 200;
  return { w, h: el.clientHeight || w };
}

// Add a strong ambient light so the whole globe reads bright and evenly lit,
// closer to the flat 2-D Blue-Marble map (rather than a dim, half-shadowed
// sphere).  Added on top of globe.gl's own lights so it can only brighten.
function brightenGlobe(g) {
  if (!g || !window.THREE) return;
  try {
    const cur = g.lights() || [];
    g.lights([...cur, new window.THREE.AmbientLight(0xffffff, 2.0)]);
  } catch { /* older globe.gl without .lights() */ }
}

function initGlobe() {
  if (typeof Globe !== 'function' || !window.THREE) return;
  const el = $('mini-globe');
  const { w, h } = globeSize();
  globe = Globe()(el)
    .width(w).height(h)
    .backgroundColor('rgba(0,0,0,0)')
    .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
    .showAtmosphere(true).atmosphereColor('#68b0ff').atmosphereAltitude(0.2);
  brightenGlobe(globe);

  // Display only — it tracks the sat automatically.  Keep controls "enabled"
  // (globe.gl applies pointOfView through controls.update() each frame) but
  // switch off every user input so the auto-centring can't be fought.
  const ctr = globe.controls();
  ctr.enabled = true;
  ctr.autoRotate = false;
  if ('noRotate' in ctr) { ctr.noRotate = ctr.noZoom = ctr.noPan = true; }         // TrackballControls
  if ('enableRotate' in ctr) { ctr.enableRotate = ctr.enableZoom = ctr.enablePan = false; } // OrbitControls

  const THREE = window.THREE;
  satMesh = new THREE.Mesh(
    new THREE.SphereGeometry(3, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0x8bff9e }));
  satMesh.add(new THREE.Mesh(
    new THREE.SphereGeometry(5.5, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0x8bff9e, transparent: true, opacity: 0.25 })));
  satMesh.visible = false;
  globe.scene().add(satMesh);

  globe.pointOfView({ lat: 0, lng: 0, altitude: GLOBE_CAM_ALT }, 0);
}

function updateGlobe(lat, lon, alt, t) {
  if (!globe || !satMesh) return;
  const c = globe.getCoords(lat, lon, globeAltFrac(alt));
  satMesh.position.set(c.x, c.y, c.z);
  satMesh.visible = true;
  // lng follows the sub-point (globe rotates); lat fixed at 0 so the marker
  // rides up/down with its own latitude.
  globe.pointOfView({ lat: 0, lng: lon, altitude: GLOBE_CAM_ALT }, 0);
  // Keep the ground-track ring roughly centred on the current position
  // (throttled by wall time — a full rebuild each frame would be wasteful).
  const nowMs = performance.now();
  if (selected && nowMs - lastRing1Build > 900) { lastRing1Build = nowMs; buildRing1(selected.rec, t || new Date()); }
}

// --- Second globe: Earth-rotation / orbital-path view ----------------------
//
// The camera is inertially fixed but orbits the Earth-fixed globe at the GMST
// rate, so the globe appears to spin at Earth's true rotation rate while the
// satellite (placed at its sub-point, exactly like the 2-D map) traces a
// fixed ellipse.  The marker fades + lightens when it passes behind the globe
// so the front/back of the orbit read at a glance.

function initGlobe2() {
  if (typeof Globe !== 'function' || !window.THREE) return;
  const el = $('mini-globe2');
  const s = elSize('mini-globe2');
  globe2 = Globe()(el)
    .width(s.w).height(s.h)
    .backgroundColor('rgba(0,0,0,0)')
    .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
    .showAtmosphere(true).atmosphereColor('#68b0ff').atmosphereAltitude(0.2);
  brightenGlobe(globe2);

  const ctr = globe2.controls();
  ctr.enabled = true;
  ctr.autoRotate = false;
  if ('noRotate' in ctr) { ctr.noRotate = ctr.noZoom = ctr.noPan = true; }
  if ('enableRotate' in ctr) { ctr.enableRotate = ctr.enableZoom = ctr.enablePan = false; }

  // Slightly translucent Earth so the satellite + the far side of its orbit
  // ring stay readable when they pass behind the globe.
  try { const gm = globe2.globeMaterial(); gm.transparent = true; gm.opacity = 0.72; } catch { /* older globe.gl */ }

  const THREE = window.THREE;
  // depthTest:false so the marker still shows (dimmed) when it is behind the
  // globe — that faint pass is exactly how we reveal the far side of the orbit.
  satMesh2 = new THREE.Mesh(
    new THREE.SphereGeometry(4, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0x8bff9e, transparent: true, opacity: 1, depthTest: false, depthWrite: false }));
  satHalo2 = new THREE.Mesh(
    new THREE.SphereGeometry(7.3, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0x8bff9e, transparent: true, opacity: 0.25, depthTest: false, depthWrite: false }));
  satMesh2.add(satHalo2);
  satMesh2.renderOrder = 3;
  satHalo2.renderOrder = 3;
  satMesh2.visible = false;
  globe2.scene().add(satMesh2);

  // A flat outline ring, billboarded to face the camera, that replaces the solid
  // dot while the satellite is behind the Earth — so the far pass reads as a
  // blinking HOLLOW marker rather than a filled one.  Kept as a scene sibling
  // (not a child of satMesh2) so satMesh2's blink-scale never distorts it.
  satRing2 = new THREE.Mesh(
    new THREE.RingGeometry(4.4, 6.6, 28),
    new THREE.MeshBasicMaterial({ color: 0x8bff9e, transparent: true, opacity: 0.9,
                                  side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
  satRing2.renderOrder = 3;
  satRing2.visible = false;
  globe2.scene().add(satRing2);

  globe2.pointOfView({ lat: GLOBE2_TILT, lng: 0, altitude: globe2CamAlt }, 0);
  requestAnimationFrame(globe2BlinkTick);
}

// True when the globe (radius 100) occludes point p from the camera.
function occludedByGlobe(cam, p) {
  const cx = cam.x, cy = cam.y, cz = cam.z;
  const vx = p.x - cx, vy = p.y - cy, vz = p.z - cz;
  const L2 = vx * vx + vy * vy + vz * vz;
  const t = -(cx * vx + cy * vy + cz * vz) / L2;
  if (t > 0 && t < 1) {
    const px = cx + vx * t, py = cy + vy * t, pz = cz + vz * t;
    if (px * px + py * py + pz * pz < 99 * 99) return true;
  }
  return false;
}

function updateGlobe2(lat, lon, alt, t) {
  if (!globe2 || !satMesh2) return;
  const c = globe2.getCoords(lat, lon, globe2AltFrac(alt));
  satMesh2.position.set(c.x, c.y, c.z);   // true-scale (HEO) or hug (normal) ECEF position

  // Orbit the camera at -GMST so the Earth spins at its real rate and the
  // satellite's path stays fixed in inertial space.  The ring is built in the
  // inertial frame, so rotate its group by the same -GMST to keep it in view.
  const gmst = gmstOf(t);
  overlayGmst = gmst;
  globe2.pointOfView({ lat: GLOBE2_TILT, lng: -(gmst * RAD), altitude: globe2CamAlt }, 0);
  if (ring2Group) ring2Group.rotation.y = -gmst;

  if (globe2Overlay) {
    satMesh2.visible = false;              // ring + marker are drawn in the SVG overlay
  } else {
    satMesh2.visible = true;
    // Decide front vs behind here; globe2BlinkTick() animates the appearance so
    // the blink runs smoothly every frame even in time mode (updated only ~5 s).
    behind2 = occludedByGlobe(globe2.camera().position, satMesh2.position);
  }
}

// Steady solid bright-green dot in front of the Earth; when it slips behind, the
// solid fill gives way to a blinking HOLLOW outline ring, so the viewer clearly
// sees the satellite is on the far side.  For HEO orbits the ring + marker live
// in the SVG overlay (updateOverlayRing) instead of in the globe.gl scene.
function globe2BlinkTick(ts) {
  if (globe2Overlay) {
    if (satMesh2) satMesh2.visible = false;
    if (satRing2) satRing2.visible = false;
    updateOverlayRing(ts);
  } else if (satMesh2 && satMesh2.visible) {
    if (behind2) {
      const b = (Math.sin(ts / 1000 * Math.PI * 3) + 1) / 2;   // ~1.5 Hz pulse, 0..1
      satMesh2.material.opacity = 0;                           // hide the fill → hollow
      satHalo2.material.opacity = 0;
      satRing2.visible = true;
      satRing2.position.copy(satMesh2.position);
      satRing2.quaternion.copy(globe2.camera().quaternion);    // billboard: face the camera
      satRing2.scale.setScalar(1.25 + 0.35 * b);               // swell as it pulses
      satRing2.material.opacity = 0.25 + 0.7 * b;              // blink
    } else {
      satMesh2.scale.setScalar(1);
      satMesh2.material.opacity = 1;                           // solid fill in front
      satHalo2.material.opacity = 0.25;
      satRing2.visible = false;
    }
  }
  requestAnimationFrame(globe2BlinkTick);
}

// --- HEO orbit overlay -----------------------------------------------------
//
// A very elliptical orbit is far bigger than the little globe, so instead of
// shrinking the Earth we keep it put and draw the RING in an SVG that floats
// over the whole page.  The 3-D ring points are side-projected orthographically
// (no perspective near-plane, so a far apogee can't blow up or wrap behind the
// camera) onto globe 2's current camera basis, scaled so the perigee clears the
// Earth, and positioned at the Earth's on-screen centre.  Arcs that fall behind
// the planet are dashed and the marker goes hollow — the same cues as globe.gl.
let orbitSvg = null, oFront = null, oBehind = null, oMarker = null, oMarkerRing = null;
function ensureOrbitSvg() {
  if (orbitSvg) { orbitSvg.style.display = 'block'; return; }
  const NS = 'http://www.w3.org/2000/svg';
  orbitSvg = document.createElementNS(NS, 'svg');
  orbitSvg.setAttribute('class', 'globe2-orbit-svg');
  orbitSvg.setAttribute('aria-hidden', 'true');
  oBehind = document.createElementNS(NS, 'path'); oBehind.setAttribute('class', 'g2o-behind');
  oFront  = document.createElementNS(NS, 'path'); oFront.setAttribute('class', 'g2o-front');
  oMarkerRing = document.createElementNS(NS, 'circle'); oMarkerRing.setAttribute('class', 'g2o-mk-ring');
  oMarker = document.createElementNS(NS, 'circle'); oMarker.setAttribute('class', 'g2o-mk');
  orbitSvg.append(oBehind, oFront, oMarkerRing, oMarker);
  document.body.appendChild(orbitSvg);
}
function hideOrbitSvg() { if (orbitSvg) orbitSvg.style.display = 'none'; }

function updateOverlayRing(ts) {
  if (!overlayPts || overlayPts.length < 8 || !globe2 || !window.THREE) { hideOrbitSvg(); return; }
  const THREE = window.THREE;
  ensureOrbitSvg();
  const el = $('mini-globe2'); if (!el) return;
  const rect = el.getBoundingClientRect();
  const C = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const cam = globe2.camera(); cam.updateMatrixWorld();

  // Orthographic side-projection basis = the camera's world right / up axes.
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
  const up    = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
  const camDir = cam.position.clone().normalize();          // origin → camera (front is +)

  // Earth's on-screen radius: project a silhouette point at scene-radius 100.
  const edge = right.clone().multiplyScalar(100).project(cam);
  const Rpx = Math.max(18, Math.hypot(edge.x * rect.width / 2, edge.y * rect.height / 2));
  // Uniform screen scale (shape-preserving) so the perigee sits ~GAP·Rpx out.
  const S = (GLOBE2_PERIGEE_GAP * Rpx) / (100 * Math.max(1.02, overlayPeriR));

  const Y = new THREE.Vector3(0, 1, 0), w = new THREE.Vector3();
  function proj(eci) {
    w.copy(eci).applyAxisAngle(Y, -overlayGmst);            // fixed in the camera view
    const sx = C.x + w.dot(right) * S, sy = C.y - w.dot(up) * S;
    const behind = (Math.hypot(sx - C.x, sy - C.y) < Rpx * 0.98) && (w.dot(camDir) < 0);
    return { sx, sy, behind };
  }

  let front = '', behind = '', prev = null;
  const n = overlayPts.length;
  for (let i = 0; i <= n; i++) {
    const p = proj(overlayPts[i % n]);
    const xy = p.sx.toFixed(1) + ',' + p.sy.toFixed(1) + ' ';
    if (prev === null) {
      (p.behind ? (behind += 'M' + xy) : (front += 'M' + xy));
    } else if (p.behind !== prev.behind) {
      (prev.behind ? (behind += 'L' + xy) : (front += 'L' + xy));   // finish the old run at the seam
      (p.behind   ? (behind += 'M' + xy) : (front += 'M' + xy));    // start the new run at the seam
    } else {
      (p.behind ? (behind += 'L' + xy) : (front += 'L' + xy));
    }
    prev = p;
  }
  oFront.setAttribute('d', front || 'M0,0');
  oBehind.setAttribute('d', behind || 'M0,0');

  // Marker at the sat's current position (ECEF → ECI so proj's −gmst cancels).
  const mk = proj(satMesh2.position.clone().applyAxisAngle(Y, overlayGmst));
  const mr = Math.max(4, Rpx * 0.085);
  if (mk.behind) {
    const b = (Math.sin(ts / 1000 * Math.PI * 3) + 1) / 2;
    oMarker.setAttribute('opacity', '0');                                 // hollow
    oMarkerRing.setAttribute('cx', mk.sx.toFixed(1)); oMarkerRing.setAttribute('cy', mk.sy.toFixed(1));
    oMarkerRing.setAttribute('r', (mr * (1.15 + 0.3 * b)).toFixed(1));
    oMarkerRing.setAttribute('opacity', (0.3 + 0.6 * b).toFixed(2));      // blink
  } else {
    oMarkerRing.setAttribute('opacity', '0');
    oMarker.setAttribute('cx', mk.sx.toFixed(1)); oMarker.setAttribute('cy', mk.sy.toFixed(1));
    oMarker.setAttribute('r', mr.toFixed(1)); oMarker.setAttribute('opacity', '1');
  }
}

// --- Orbit-path rings ------------------------------------------------------

function disposeRing(m) { if (m) { m.geometry.dispose(); m.material.dispose(); } }

// Globe 1: golden ground-track arc (Earth-fixed), one period centred on t.
function buildRing1(rec, t0) {
  if (!globe || !window.THREE) return;
  const THREE = window.THREE;
  if (ring1) { globe.scene().remove(ring1); disposeRing(ring1); ring1 = null; }
  const f = orbitFacts(rec);
  const period = Number.isFinite(f.periodMin) && f.periodMin > 0 ? f.periodMin : 92;
  const N = 120, pts = [];
  for (let i = 0; i <= N; i++) {
    const r = propagate(rec, new Date(t0.getTime() + period * 60000 * (i / N - 0.5)));
    if (!r || !Number.isFinite(r.lat)) continue;
    const p = globe.getCoords(r.lat, r.lon, globeAltFrac(r.alt));
    pts.push(new THREE.Vector3(p.x, p.y, p.z));
  }
  if (pts.length < 4) return;
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false), 180, 0.7, 8, false);
  ring1 = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: RING_GOLD, transparent: true, opacity: 0.6, depthWrite: false }));
  ring1.renderOrder = 1;   // depthTest on: the Earth hides the far side, like a real ground track
  globe.scene().add(ring1);
}

// Globe 2: golden orbital ellipse in the inertial frame (fixed loop), spun by
// -GMST each frame so it stays put in the camera view.  Because the ring is
// fixed in that view and the occluding Earth sphere is rotation-invariant, the
// arcs that fall behind the globe never change — so we split the loop once and
// draw the front arcs as a solid tube, the behind arcs as a dashed tube.
function buildRing2(rec, t0) {
  if (!globe2 || !window.THREE) return;
  const THREE = window.THREE;
  if (ring2Group) {
    globe2.scene().remove(ring2Group);
    ring2Group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    ring2Group = null;
  }
  const f = orbitFacts(rec);
  const period = Number.isFinite(f.periodMin) && f.periodMin > 0 ? f.periodMin : 92;
  const N = globe2Overlay ? 360 : 160, pts = [], Y = new THREE.Vector3(0, 1, 0);   // dense for the fast, sharp HEO perigee
  for (let i = 0; i < N; i++) {
    const t = new Date(t0.getTime() + period * 60000 * i / N);
    const r = propagate(rec, t);
    if (!r || !Number.isFinite(r.lat)) continue;
    const p = globe2.getCoords(r.lat, r.lon, globe2AltFrac(r.alt));
    pts.push(new THREE.Vector3(p.x, p.y, p.z).applyAxisAngle(Y, gmstOf(t)));   // ECEF → ECI
  }
  if (pts.length < 8) { overlayPts = null; hideOrbitSvg(); return; }

  // HEO: hand the true-scale ring to the SVG overlay (drawn per frame over the
  // map); globe.gl shows just the Earth, no ring.
  if (globe2Overlay) { overlayPts = pts; ensureOrbitSvg(); return; }
  overlayPts = null;
  hideOrbitSvg();

  ring2Group = new THREE.Group();

  // Static front/behind split against a reference camera at lng 0 (the camera's
  // position in the ring group's own co-rotating frame).
  const camRef = globe2.getCoords(GLOBE2_TILT, 0, globe2CamAlt);
  const behindArr = pts.map(p => occludedByGlobe(camRef, p));

  // Cut the closed loop into contiguous same-state runs (merge the wrap seam).
  const runs = [];
  let cur = { behind: behindArr[0], pts: [pts[0]] };
  for (let i = 1; i < pts.length; i++) {
    if (behindArr[i] === cur.behind) cur.pts.push(pts[i]);
    else { runs.push(cur); cur = { behind: behindArr[i], pts: [pts[i]] }; }
  }
  runs.push(cur);
  if (runs.length > 1 && runs[0].behind === runs[runs.length - 1].behind) {
    const last = runs.pop();
    runs[0].pts = last.pts.concat(runs[0].pts);
  }
  // Let each run reach the neighbour's first point so arcs meet at the seams.
  for (let i = 0; i < runs.length; i++) {
    const next = runs[(i + 1) % runs.length];
    if (next && next.pts.length) runs[i].pts.push(next.pts[0]);
  }

  function tube(segPts, opacity) {
    if (segPts.length < 2) return;
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(segPts, false, 'centripetal'), Math.max(segPts.length * 2, 8), 0.95, 6, false);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: RING_GOLD, transparent: true, opacity, depthTest: false, depthWrite: false }));
    m.renderOrder = 2;
    ring2Group.add(m);
  }
  for (const run of runs) {
    if (!run.behind) {
      tube(run.pts, 0.55);                         // front: solid tube
    } else {
      const ON = 5, GAP = 3;                        // behind: dashed tube (5 on, 3 off)
      for (let i = 0; i < run.pts.length; i += ON + GAP) tube(run.pts.slice(i, i + ON + 1), 0.72);
    }
  }
  globe2.scene().add(ring2Group);
}

// --- Sizing: fit both globes as squares stacked in the globe column --------

function elSize(id) {
  const el = $(id);
  const w = el.clientWidth || 190;
  return { w, h: el.clientHeight || w };
}

function sizeMiniGlobes() {
  const map = $('map-cell');
  if (!map) return;
  // Compute the column width from the viewport (mirrors the CSS clamp) and the
  // available height from the MAP (stable — driven by its 2:1 width).  Reading
  // the globe column's own width/height feeds back and runs away.
  const colW = Math.min(240, Math.max(150, window.innerWidth * 0.16));
  const availH = map.clientHeight || (window.innerWidth * 0.16);
  const sq = Math.max(120, Math.floor(Math.min(colW, availH / 2 - 22)));
  for (const [id, g] of [['mini-globe', globe], ['mini-globe2', globe2]]) {
    const el = $(id);
    if (el) { el.style.width = sq + 'px'; el.style.height = sq + 'px'; }
    if (g) g.width(sq).height(sq);
  }
}

function renderInfo(r, footer) {
  const { periodMin, incDeg } = orbitFacts(selected.rec);
  const info = $('sat-info');
  info.hidden = false;
  info.innerHTML = `
    <div class="si-name">${escapeHtml(selected.name)}</div>
    <div class="si-grid">
      <span>NORAD</span><b>${selected.noradId}</b>
      <span>Over</span><b>${escapeHtml(placeName(r.lat, r.lon))}</b>
      <span>Lat / Lon</span><b>${r.lat.toFixed(2)}°, ${r.lon.toFixed(2)}°</b>
      <span>Altitude</span><b>${r.alt.toFixed(0)} km</b>
      <span>Period</span><b>${Number.isFinite(periodMin) ? periodMin.toFixed(1) + ' min' : '—'}</b>
      <span>Inclination</span><b>${incDeg.toFixed(1)}°</b>
    </div>
    <div class="si-anchor">${footer}</div>`;
}

// ---------------------------------------------------------------------------
// Mode handling
// ---------------------------------------------------------------------------

let mode = 'time';   // 'time' | 'rev'

const TIME_EL_IDS = ['past-halo', 'future-halo', 'past-line', 'future-line', 'marks'];

function setTimeVisibility(on) {
  const disp = on ? '' : 'none';
  for (const id of TIME_EL_IDS) $(id).style.display = disp;
  $('rev-line').style.display = on ? 'none' : '';
  $('legend-time').style.display = on ? '' : 'none';
  $('legend-rev').style.display = on ? 'none' : '';
}

function drawTrack() {
  if (mode !== 'time' || !selected) return;
  anchor = new Date();
  drawTrackLines(selected.rec, anchor);
  drawMarks(selected.rec, anchor);
}

function refreshCurrent() {
  if (mode !== 'time' || !selected) return;
  const now = new Date();
  const r = propagate(selected.rec, now);
  if (!r || !Number.isFinite(r.lat)) return;
  setNowMarker(r.lat, r.lon, r.alt, now);
  renderInfo(r, `Track: 24 h before/after ${(anchor || new Date()).toISOString().slice(11, 16)} UTC`);
}

// ---- revolution-based animation --------------------------------------------

let speedIdx = 0;
let revBase = null;     // Date the animation counts forward from (present)
let simMin = 0;         // simulated minutes elapsed since revBase
let periodMin = 92;
let goldenPts = [];
let nextGoldMin = 0;
let rafId = null;
let lastTs = null;
let lastInfoTs = 0;

function resetRevAnim() {
  revBase = new Date();
  simMin = 0;
  goldenPts = [];
  nextGoldMin = GOLD_STEP_MIN;
  const f = orbitFacts(selected.rec);
  periodMin = Number.isFinite(f.periodMin) && f.periodMin > 0 ? f.periodMin : 92;
  $('rev-line').setAttribute('d', '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtClock(date, offsetMs = 0) {
  return new Date(date.getTime() + offsetMs).toISOString().slice(11, 19);
}

// Reads UTC parts; pass an already-shifted Date (e.g. +5:30) to get IST wall date.
function fmtDate(d) {
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function updateRevTimes(t) {
  const ist = new Date(t.getTime() + 5.5 * 3600000);  // IST = UTC + 5:30
  $('rev-utc').textContent = fmtClock(t);
  $('rev-utc-date').textContent = fmtDate(t);
  $('rev-ist').textContent = fmtClock(t, 5.5 * 3600000);
  $('rev-ist-date').textContent = fmtDate(ist);
}

function animRev(ts) {
  if (mode !== 'rev' || !selected) { rafId = null; return; }
  if (lastTs == null) lastTs = ts;
  const dt = (ts - lastTs) / 1000;   // real seconds
  lastTs = ts;

  simMin += SPEEDS[speedIdx] * dt / 60;   // speed = sim-seconds per real-second
  if (simMin >= MAX_REVS * periodMin) resetRevAnim();   // cap at 3 revs → present

  const t = new Date(revBase.getTime() + simMin * 60000);
  const r = propagate(selected.rec, t);
  if (r && Number.isFinite(r.lat)) {
    setNowMarker(r.lat, r.lon, r.alt, t);

    // extend the golden trail up to the current sim time
    while (nextGoldMin <= simMin) {
      const g = propagate(selected.rec, new Date(revBase.getTime() + nextGoldMin * 60000));
      if (g && Number.isFinite(g.lat)) goldenPts.push({ lat: g.lat, lon: g.lon });
      nextGoldMin += GOLD_STEP_MIN;
    }
    $('rev-line').setAttribute('d', segmentPath(goldenPts.concat([{ lat: r.lat, lon: r.lon }])));

    updateRevTimes(t);
    $('rev-count').textContent = Math.min(MAX_REVS, Math.floor(simMin / periodMin) + 1);
    if (ts - lastInfoTs > 200) {
      lastInfoTs = ts;
      renderInfo(r, `Rev-based · projected time shown on the speed panel`);
    }
  }
  rafId = requestAnimationFrame(animRev);
}

function startRev() {
  if (!selected) return;
  resetRevAnim();
  lastTs = null;
  lastInfoTs = 0;
  if (!rafId) rafId = requestAnimationFrame(animRev);
}

function applyMode(m) {
  mode = m;
  const rev = (m === 'rev');
  const btn = $('mode-btn');
  btn.setAttribute('aria-checked', rev ? 'true' : 'false');
  btn.classList.toggle('on', rev);
  $('mode-state').textContent = rev ? 'Revolution-based' : 'Time-based';
  setTimeVisibility(!rev);
  $('rev-section').hidden = !rev;

  if (rev) {
    startRev();
  } else {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    $('rev-line').setAttribute('d', '');
    drawTrack();
    refreshCurrent();
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function selectSat(entry) {
  selected = entry;
  $('sat-search').value = entry.name;
  hideResults();
  setStatus(`${entry.name} · #${entry.noradId}`);
  lastRing1Build = 0;                    // force the globe-1 ground-track rebuild
  computeOrbit2Scale(entry.rec);         // pick regime (compressed-in-globe vs overlay ring)
  buildRing2(entry.rec, new Date());     // globe-2 ellipse: globe.gl ring, or hand off to the overlay
  if (mode === 'rev') startRev();
  else { drawTrack(); refreshCurrent(); }
}

// ---------------------------------------------------------------------------
// Mark tooltip
// ---------------------------------------------------------------------------

function wireTooltip() {
  const marks = $('marks'), tip = $('track-tooltip'), cell = $('map-cell');
  function place(e) {
    const r = cell.getBoundingClientRect();
    let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
    x = Math.min(x, cell.clientWidth - tip.offsetWidth - 6);
    y = Math.min(y, cell.clientHeight - tip.offsetHeight - 6);
    tip.style.left = Math.max(6, x) + 'px';
    tip.style.top = Math.max(6, y) + 'px';
  }
  marks.addEventListener('mouseover', (e) => {
    const m = e.target.closest('.mark');
    if (!m) return;
    tip.textContent = m.dataset.tip;
    tip.hidden = false;
    place(e);
  });
  marks.addEventListener('mousemove', (e) => { if (!tip.hidden) place(e); });
  marks.addEventListener('mouseout', (e) => { if (e.target.closest('.mark')) tip.hidden = true; });
}

// ---------------------------------------------------------------------------
// Draggable panels
// ---------------------------------------------------------------------------

function makeDraggable(panel, handle) {
  let ox = 0, oy = 0, dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;   // let header buttons (collapse) click, not drag
    dragging = true;
    panel.classList.add('dragging');
    panel.style.transform = 'none';   // drop any centering transform
    const pr = panel.getBoundingClientRect();
    ox = e.clientX - pr.left;
    oy = e.clientY - pr.top;
    try { handle.setPointerCapture(e.pointerId); } catch { /* synthetic/edge pointers */ }
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const parent = panel.offsetParent || document.body;
    const par = parent.getBoundingClientRect();
    let left = e.clientX - par.left - ox;
    let top = e.clientY - par.top - oy;
    left = Math.max(0, Math.min(left, parent.clientWidth - panel.offsetWidth));
    top = Math.max(0, Math.min(top, parent.clientHeight - panel.offsetHeight));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  });
  const end = () => { dragging = false; panel.classList.remove('dragging'); };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------------------
// Search combobox
// ---------------------------------------------------------------------------

let searchIndex = [], matches = [], activeIdx = -1;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildIndex() {
  searchIndex = satrecs.map(e => ({ entry: e, hay: (e.name + ' ' + e.noradId).toLowerCase() }));
}

function hideResults() { $('sat-results').hidden = true; activeIdx = -1; }

function renderResults(q) {
  const box = $('sat-results');
  q = q.trim().toLowerCase();
  if (!q) { hideResults(); return; }
  matches = [];
  for (const it of searchIndex) {
    if (it.hay.includes(q)) { matches.push(it.entry); if (matches.length >= 60) break; }
  }
  if (!matches.length) { box.innerHTML = '<div class="sat-none">no match</div>'; box.hidden = false; return; }
  box.innerHTML = matches.map((e, i) =>
    `<div class="sat-opt" data-i="${i}" role="option">${escapeHtml(e.name)}<span class="nid">#${e.noradId}</span></div>`
  ).join('');
  box.hidden = false;
  activeIdx = -1;
}

function highlight() {
  const box = $('sat-results');
  [...box.querySelectorAll('.sat-opt')].forEach((el, i) => el.classList.toggle('active', i === activeIdx));
  const act = box.querySelector('.sat-opt.active');
  if (act) act.scrollIntoView({ block: 'nearest' });
}

function wireSearch() {
  const input = $('sat-search'), box = $('sat-results');
  input.addEventListener('input', () => renderResults(input.value));
  input.addEventListener('focus', () => { if (input.value.trim()) renderResults(input.value); });
  input.addEventListener('keydown', (e) => {
    if (box.hidden || !matches.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, matches.length - 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); selectSat(matches[activeIdx >= 0 ? activeIdx : 0]); }
    else if (e.key === 'Escape') { hideResults(); }
  });
  box.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('.sat-opt');
    if (!opt) return;
    e.preventDefault();
    selectSat(matches[+opt.dataset.i]);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.track-panel')) hideResults(); });
}

function wireControls() {
  $('mode-btn').addEventListener('click', () => applyMode(mode === 'time' ? 'rev' : 'time'));
  const slider = $('rev-speed');
  slider.addEventListener('input', () => {
    speedIdx = +slider.value;
    $('rev-speed-val').textContent = SPEEDS[speedIdx] + '×';
  });
  const collapseBtn = $('tp-collapse');
  collapseBtn.addEventListener('click', () => {
    const collapsed = $('track-panel').classList.toggle('collapsed');
    collapseBtn.textContent = collapsed ? '▸' : '▾';
    collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    collapseBtn.title = collapsed ? 'Expand panel' : 'Collapse panel';
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function main() {
  try {
    $('map-basemap').style.backgroundImage =
      "url('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')";

    drawGraticule();
    buildCountries();
    initGlobe();
    initGlobe2();
    wireSearch();
    wireTooltip();
    wireControls();
    makeDraggable($('track-panel'), $('tp-drag'));
    // Size the globes off the settled map layout (fires on first layout + any
    // resize) — reading it synchronously in main() catches it pre-layout.
    if (window.ResizeObserver) new ResizeObserver(() => sizeMiniGlobes()).observe($('map-cell'));
    else sizeMiniGlobes();
    window.addEventListener('resize', () => {
      sizeMiniGlobes();
      if (nowLatLon) positionNowLabel(nowLatLon[0], nowLatLon[1]);
    });

    setStatus('Loading TLE catalog…');
    const tleResult = await fetchTLEs();
    satrecs = makeSatrecs(tleResult.tles).sort((a, b) => a.name.localeCompare(b.name));
    buildIndex();

    const tag = tleResult.source === 'celestrak' ? 'live'
              : tleResult.source === 'cache' ? 'cached' : 'bundled';
    setStatus(`${satrecs.length.toLocaleString()} satellites (${tag}) · search one`);

    const seed = satrecs.find(s => /ISS \(ZARYA\)/i.test(s.name))
              || satrecs.find(s => /ZARYA|ISS/i.test(s.name));
    if (seed) selectSat(seed);

    sizeMiniGlobes();   // layout is fully settled after the async TLE load
    setInterval(refreshCurrent, CURRENT_REFRESH);
    setInterval(drawTrack, TRACK_REFRESH);
  } catch (e) {
    console.error(e);
    setStatus(`Load failed: ${e.message}`);
  }
})();
