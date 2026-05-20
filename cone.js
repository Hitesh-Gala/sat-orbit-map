// Cone view — realistic globe + a Google Maps satellite zoom-in.
//
// Flow on Compute:
//   1. globe.gl pointOfView() animates the globe to the user's lat/lon.
//   2. After the globe rotation, if a Google Maps JS API key is stored in
//      localStorage, the page lazy-loads maps.googleapis.com and shows
//      an interactive satellite map (pinch-zoom enabled) at the point.
//   3. If no key is stored, we stop after the globe rotation and surface
//      a friendly note in the HUD.

const COUNTRIES_URL = 'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/cultural/ne_50m_admin_0_countries.json';
const KEY_STORE     = 'argos.gmap.key';

// Pink down-arrow marker — inline SVG so it renders identically across
// platforms.  The arrowhead tip sits at the centre-bottom of the viewBox
// (16, 47 in 32×48 coords); CSS / GMaps anchors hook on that exact pixel
// so the arrow points precisely at the target coordinate.
const ARROW_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 48'>
  <defs>
    <linearGradient id='a' x1='0' y1='0' x2='0' y2='1'>
      <stop offset='0%'  stop-color='#ffb1d8'/>
      <stop offset='100%' stop-color='#ff1f86'/>
    </linearGradient>
  </defs>
  <path d='M 16 47 L 4 29 L 11 29 L 11 4 L 21 4 L 21 29 L 28 29 Z'
        fill='url(#a)' stroke='#9c0b58' stroke-width='1.4' stroke-linejoin='round' stroke-linecap='round'/>
</svg>`;
const ARROW_DATA_URL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(ARROW_SVG);

// --- Globe ---------------------------------------------------------------

const globe = Globe()(document.getElementById('globe'))
  .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
  .bumpImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png')
  .backgroundImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/night-sky.png')
  .showAtmosphere(true)
  .atmosphereColor('#4ea8ff')
  .atmosphereAltitude(0.18)
  .pointOfView({ lat: 28.61, lng: 77.21, altitude: 2.4 }, 0)
  .polygonsData([])
  .polygonAltitude(0.001)
  .polygonCapColor(() => 'rgba(255, 255, 255, 0)')
  .polygonSideColor(() => 'rgba(255, 255, 255, 0)')
  .polygonStrokeColor(() => 'rgba(220, 240, 255, 0.65)')
  // HTML marker layer for the pink arrow.  Single element only, so the
  // older globe.gl 2.32 htmlElements quirk that bit the satellite dots
  // doesn't apply.
  .htmlElementsData([])
  .htmlLat(d => d.lat)
  .htmlLng(d => d.lng)
  .htmlAltitude(d => d.alt || 0.01)
  .htmlElement(() => {
    const el = document.createElement('div');
    el.className = 'arrow-marker';
    el.innerHTML = ARROW_SVG;
    return el;
  })
  // Satellite-dot layer (Show button).  Each in-cone satellite gets a
  // small coloured sphere at its real altitude with a hover tooltip.
  .objectsData([])
  .objectLat(d => d.lat)
  .objectLng(d => d.lon)
  .objectAltitude(d => d.alt / EARTH_R_KM_GLOBE)
  .objectThreeObject(d => new THREE.Mesh(
    // Larger sphere for prominence; opaque so the colour reads cleanly
    // against the faint cone fill.
    new THREE.SphereGeometry(1.4, 14, 14),
    new THREE.MeshBasicMaterial({ color: d.color })
  ))
  .objectLabel(d => `<div class="sat-tip">
    <b>${escHtml(d.name)}</b>
    <div>Alt ${d.alt.toFixed(0)} km · ${d.lat.toFixed(2)}°, ${d.lon.toFixed(2)}°</div>
    <div class="cls" style="color:${d.color}">${d.cls} orbit</div>
  </div>`);

const controls = globe.controls();
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.rotateSpeed = 0.5;
controls.zoomSpeed = 0.8;
controls.minDistance = 110;
controls.maxDistance = 1500;  // ≈ 15 Earth radii — enough headroom for the
                              // 40 000-km Show cone to fit in view at alt 8

fetch(COUNTRIES_URL)
  .then(r => r.json())
  .then(geo => globe.polygonsData(geo.features.filter(f => f.properties.ISO_A2 !== 'AQ')))
  .catch(e => console.warn('Country polygons failed:', e.message));

window.addEventListener('resize', () => {
  globe.width(window.innerWidth).height(window.innerHeight);
});

// --- Google Maps key handling --------------------------------------------

const keyInput = document.getElementById('gmap-key');
const keyStatus = document.getElementById('key-status');
const saveBtn = document.getElementById('gmap-save');

function refreshKeyStatus() {
  const k = localStorage.getItem(KEY_STORE);
  if (k) {
    keyStatus.textContent = `saved · ${k.length} chars`;
    keyStatus.style.color = 'var(--green)';
  } else {
    keyStatus.textContent = 'not set';
    keyStatus.style.color = '';
  }
}
refreshKeyStatus();

saveBtn.addEventListener('click', () => {
  const v = keyInput.value.trim();
  if (v) {
    localStorage.setItem(KEY_STORE, v);
    keyInput.value = '';
  } else {
    localStorage.removeItem(KEY_STORE);
  }
  refreshKeyStatus();
});

// Lazy-load the Google Maps JS API the first time we need it.  Subsequent
// calls resolve immediately because google.maps is already on window.
let mapsLoadPromise = null;
function loadGoogleMaps(apiKey) {
  if (window.google && window.google.maps) return Promise.resolve();
  if (mapsLoadPromise) return mapsLoadPromise;
  mapsLoadPromise = new Promise((resolve, reject) => {
    const cb = '__gmapsReady__' + Date.now();
    window[cb] = () => { delete window[cb]; resolve(); };
    const script = document.createElement('script');
    script.src = 'https://maps.googleapis.com/maps/api/js?key='
               + encodeURIComponent(apiKey)
               + '&v=weekly&callback=' + cb
               + '&loading=async';
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('Google Maps script failed to load (check API key / domain restriction)'));
    document.head.appendChild(script);
  });
  return mapsLoadPromise;
}

// --- Globe ↔ Map view swap ------------------------------------------------

const gmapDiv = document.getElementById('gmap');
const backBtn = document.getElementById('back-to-globe');
let gmap = null;
let arrowMarker = null;  // Google Maps marker for the pink down-arrow

function showMap(lat, lon) {
  document.getElementById('globe').classList.add('hidden-view');
  gmapDiv.classList.add('shown');
  gmapDiv.setAttribute('aria-hidden', 'false');
  backBtn.style.display = 'inline-block';

  if (!gmap) {
    gmap = new google.maps.Map(gmapDiv, {
      center: { lat, lng: lon },
      zoom: 14,
      mapTypeId: 'satellite',
      gestureHandling: 'greedy',  // single-finger pan + native pinch-zoom
      tilt: 0,
      streetViewControl: false,
      fullscreenControl: false,
      mapTypeControl: true,
    });
  } else {
    gmap.setCenter({ lat, lng: lon });
    gmap.setZoom(14);
  }

  // Pink-arrow marker — the SVG viewBox is 32×48 and the arrowhead tip
  // is at (16, 47), so we scale the icon to 32×48 and anchor exactly
  // there.  Result: the pixel of the tip lands on the chosen lat/lon.
  if (arrowMarker) arrowMarker.setMap(null);
  arrowMarker = new google.maps.Marker({
    position: { lat, lng: lon },
    map: gmap,
    icon: {
      url: ARROW_DATA_URL,
      scaledSize: new google.maps.Size(32, 48),
      anchor: new google.maps.Point(16, 47),
    },
    title: `Lat ${lat.toFixed(3)}°, Lon ${lon.toFixed(3)}°`,
  });
}

function showGlobe() {
  document.getElementById('globe').classList.remove('hidden-view');
  gmapDiv.classList.remove('shown');
  gmapDiv.setAttribute('aria-hidden', 'true');
  backBtn.style.display = 'none';
}
backBtn.addEventListener('click', showGlobe);

// --- Compute --------------------------------------------------------------

async function recentre() {
  const latEl = document.getElementById('cone-lat');
  const lonEl = document.getElementById('cone-lon');
  const lat = parseFloat(latEl.value);
  const lon = parseFloat(lonEl.value);
  const valid = Number.isFinite(lat) && Number.isFinite(lon)
             && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  latEl.style.borderColor = valid ? '' : 'var(--accent2)';
  lonEl.style.borderColor = valid ? '' : 'var(--accent2)';
  if (!valid) return;

  // Always: rotate the globe to the chosen point first, and drop the
  // pink down-arrow at the same coordinates so its tip is already on
  // the location when the rotation lands.
  globe.pointOfView({ lat, lng: lon, altitude: 1.4 }, 1500);
  globe.htmlElementsData([{ lat, lng: lon, alt: 0.01 }]);

  // Then: if a Maps key is configured, swap in the satellite view.
  const apiKey = localStorage.getItem(KEY_STORE);
  if (!apiKey) {
    keyStatus.textContent = 'set a key for satellite zoom';
    keyStatus.style.color = 'var(--accent2)';
    return;
  }
  try {
    await loadGoogleMaps(apiKey);
    // Wait for the globe rotation to finish before swapping the view, so
    // it feels like a smooth zoom-in rather than an abrupt cut.
    setTimeout(() => showMap(lat, lon), 1500);
  } catch (e) {
    console.warn('Google Maps load failed:', e);
    keyStatus.textContent = 'load failed · check key';
    keyStatus.style.color = 'var(--accent2)';
  }
}

document.getElementById('cone-btn').addEventListener('click', recentre);
['cone-lat', 'cone-lon'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); recentre(); }
  });
});

// --- Pinch: target-on-top view + 3-D cone overlay -------------------------

const CONE_HEIGHT_KM         = 1000;
const CONE_TANGENT_ANGLE_DEG = 40;     // sides 40° off the local tangent
const EARTH_R_KM             = 6371;

// Place camera 90° "south" of the target along its meridian, so the
// target's surface normal aligns with the screen-up direction — i.e. the
// target sits at the top of the visible globe disk.  Wrap once if the
// naive lat = lat-90 would slip past the south pole.
function cameraForTopView(lat, lon) {
  let camLat = lat - 90;
  let camLng = lon;
  if (camLat < -90) {
    camLat = -180 - camLat;
    camLng = ((camLng + 180 + 540) % 360) - 180;
  }
  return { lat: camLat, lng: camLng };
}

let coneMesh = null;
let coneWire = null;

// Faint baseline so the cone is barely there; the raycaster-driven hover
// bumps the alpha up so it's clearly visible when the cursor is over /
// inside the cone's volume on screen.
const CONE_BASE_OPACITY  = 0.06;
const CONE_HOVER_OPACITY = 0.30;
const WIRE_BASE_OPACITY  = 0.18;
const WIRE_HOVER_OPACITY = 0.55;

function clearCone() {
  if (!coneMesh) return;
  globe.scene().remove(coneMesh);
  coneMesh.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  coneMesh = null;
  coneWire = null;
}

function drawCone(lat, lon, heightKm = CONE_HEIGHT_KM) {
  if (typeof THREE === 'undefined') {
    console.warn('Pinch: THREE not loaded; skipping cone.');
    return;
  }
  clearCone();

  // Geometry: cone with apex at origin, base centred at +Y * height.
  // Height in globe.gl units = (altitude in Earth radii) × Earth-radius
  // (=100 internally).  We use globe.getCoords() for the two endpoints
  // and measure the distance so the maths is units-agnostic.
  const altFraction = heightKm / EARTH_R_KM;
  // globe.getCoords() returns a plain {x, y, z} POJO — wrap in
  // THREE.Vector3 so we get distanceTo / normalize / etc.
  const a = globe.getCoords(lat, lon, 0);
  const t = globe.getCoords(lat, lon, altFraction);
  const apex = new THREE.Vector3(a.x, a.y, a.z);
  const top  = new THREE.Vector3(t.x, t.y, t.z);
  const height3D = apex.distanceTo(top);
  // Half-angle from cone axis = 90° − the 40° angle from the tangent
  const halfAxisRad = (90 - CONE_TANGENT_ANGLE_DEG) * Math.PI / 180;
  const baseRadius = height3D * Math.tan(halfAxisRad);

  const geo = new THREE.ConeGeometry(baseRadius, height3D, 96, 1, false);
  // ConeGeometry default: tip at +Y·(h/2), base at -Y·(h/2).  We want
  // tip at origin and base at +Y·h.  Translate the tip to origin, then
  // flip 180° around X so the base lands at +Y.
  geo.translate(0, -height3D / 2, 0);
  geo.rotateX(Math.PI);

  const mat = new THREE.MeshBasicMaterial({
    color: 0xffc4dc,                // lighter pink
    transparent: true,
    opacity: CONE_BASE_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  coneMesh = new THREE.Mesh(geo, mat);

  // Outline: edge ring + generatrices, kept very faint by default.
  coneWire = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 1),
    new THREE.LineBasicMaterial({
      color: 0xffd1e6,
      transparent: true,
      opacity: WIRE_BASE_OPACITY,
    })
  );
  coneMesh.add(coneWire);

  // Place the apex on the surface and align local +Y with the outward
  // surface normal so the cone opens straight up into space.
  coneMesh.position.copy(apex);
  const up = apex.clone().normalize();
  coneMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);

  globe.scene().add(coneMesh);
}

async function pinch() {
  const latEl = document.getElementById('cone-lat');
  const lonEl = document.getElementById('cone-lon');
  const lat = parseFloat(latEl.value);
  const lon = parseFloat(lonEl.value);
  const valid = Number.isFinite(lat) && Number.isFinite(lon)
             && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  latEl.style.borderColor = valid ? '' : 'var(--accent2)';
  lonEl.style.borderColor = valid ? '' : 'var(--accent2)';
  if (!valid) return;

  // If we were on the Google Maps view, drop back to the globe first so
  // the user can see the cone.
  showGlobe();

  // Rotate so the target sits at the top of the visible disk, then draw
  // the semi-transparent cone.  The pink arrow (if any was placed by a
  // previous Compute press) is cleared — the cone tip already marks the
  // exact surface point, so the arrow would just clutter.
  const cam = cameraForTopView(lat, lon);
  globe.pointOfView({ lat: cam.lat, lng: cam.lng, altitude: 1.9 }, 1500);
  globe.htmlElementsData([]);
  // Draw the cone right after the rotation begins; it's added directly to
  // the scene and rotates along with the camera animation.
  setTimeout(() => drawCone(lat, lon), 60);
}

document.getElementById('pinch-btn').addEventListener('click', pinch);

// --- Show: live satellite dots inside the extended cone -------------------
//
// Cone for filtering:
//   apex      = surface point at (lat, lon)
//   axis      = local outward normal at apex
//   half-angle = 50° from axis (i.e. sides 40° off the tangent plane)
//   height    = SHOW_CONE_HEIGHT_KM (40 000 km, deep into GEO)
//
// A satellite is "inside" the cone iff its ECEF position projects on to
// the axis within [0, height], and its distance from the axis at that
// projection is at most  axial × tan(half-angle).

const SHOW_CONE_HEIGHT_KM = 40000;
const EARTH_R_KM_GLOBE    = 6371;   // shadowed locally so the layer accessor reads cleanly
const HALF_ANGLE_RAD      = (90 - CONE_TANGENT_ANGLE_DEG) * Math.PI / 180;
const TAN_HALF            = Math.tan(HALF_ANGLE_RAD);

const ORBIT_COLOR = {
  LEO: '#ffffff',  // white
  MEO: '#4a90e2',  // blue
  GEO: '#67e8a4',  // green
  HEO: '#c08bff',  // purple (out-of-spec orbits)
};
function orbitClass(altKm) {
  if (altKm < 2000)  return 'LEO';
  if (altKm < 30000) return 'MEO';
  if (altKm < 42000) return 'GEO';
  return 'HEO';
}

function llaToEcef(latDeg, lonDeg, altKm) {
  const phi = latDeg * Math.PI / 180;
  const lam = lonDeg * Math.PI / 180;
  const r = EARTH_R_KM_GLOBE + altKm;
  return {
    x: r * Math.cos(phi) * Math.cos(lam),
    y: r * Math.cos(phi) * Math.sin(lam),
    z: r * Math.sin(phi),
  };
}

function isInsideCone(satLat, satLon, satAltKm, apexLat, apexLon) {
  const apex = llaToEcef(apexLat, apexLon, 0);
  const sat  = llaToEcef(satLat,  satLon,  satAltKm);
  // local outward unit normal at apex
  const am = Math.hypot(apex.x, apex.y, apex.z);
  const nx = apex.x / am, ny = apex.y / am, nz = apex.z / am;
  // vector apex -> sat
  const vx = sat.x - apex.x, vy = sat.y - apex.y, vz = sat.z - apex.z;
  // projection on axis
  const axial = vx * nx + vy * ny + vz * nz;
  if (axial <= 0 || axial > SHOW_CONE_HEIGHT_KM) return false;
  // perpendicular distance to axis
  const vMagSq   = vx*vx + vy*vy + vz*vz;
  const radialSq = vMagSq - axial * axial;
  if (radialSq < 0) return false;
  const maxR = axial * TAN_HALF;
  return radialSq <= maxR * maxR;
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let showActiveTLEs = [];

function showStatus(msg, isErr) {
  const el = document.getElementById('show-status');
  if (!msg) { el.style.display = 'none'; return; }
  el.textContent = msg;
  el.style.color = isErr ? 'var(--accent2)' : 'var(--accent)';
  el.style.display = 'block';
}

async function show() {
  const latEl = document.getElementById('cone-lat');
  const lonEl = document.getElementById('cone-lon');
  const lat = parseFloat(latEl.value);
  const lon = parseFloat(lonEl.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    showStatus('Invalid lat / lon', true);
    return;
  }

  // If we were on the Maps satellite view, drop back to the globe.
  showGlobe();

  // Rotate to put the apex at the top of the disk and pull the camera
  // far enough out (≈ 8 Earth radii) to fit a 40 000-km cone in frame
  // along with the GEO sats inside it.  Re-draws the cone to that
  // extended height with a slightly more transparent fill.
  const cam = cameraForTopView(lat, lon);
  globe.pointOfView({ lat: cam.lat, lng: cam.lng, altitude: 8 }, 1500);
  globe.htmlElementsData([]);
  setTimeout(() => drawCone(lat, lon, SHOW_CONE_HEIGHT_KM), 60);

  // Load TLE catalogue once (cached for the session by tle-loader).
  if (!showActiveTLEs.length) {
    showStatus('Loading TLE catalogue…');
    try {
      const { tles, source } = await window.Argos.fetchTLEs();
      showActiveTLEs = window.Argos.makeSatrecs(tles);
      showStatus(`Catalogue: ${showActiveTLEs.length.toLocaleString()} sats (${source})`);
    } catch (e) {
      showStatus('TLE fetch failed: ' + e.message, true);
      return;
    }
  }

  // Propagate every satellite once and keep the in-cone ones.
  const now = new Date();
  const inCone = [];
  const counts = { LEO: 0, MEO: 0, GEO: 0, HEO: 0 };
  for (const t of showActiveTLEs) {
    const r = window.Argos.propagate(t.rec, now);
    if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    if (!isInsideCone(r.lat, r.lon, r.alt, lat, lon)) continue;
    const cls = orbitClass(r.alt);
    counts[cls]++;
    inCone.push({
      name: t.name,
      lat:  r.lat,
      lon:  r.lon,
      alt:  r.alt,
      cls,
      color: ORBIT_COLOR[cls] || '#88f7ff',
    });
  }

  globe.objectsData(inCone);
  const tally = ['LEO', 'MEO', 'GEO', 'HEO']
    .filter(k => counts[k]).map(k => `${k} ${counts[k]}`).join(' · ');
  showStatus(`In cone: ${inCone.length}  ·  ${tally || 'none'}`);
}

document.getElementById('show-btn').addEventListener('click', show);

// --- Cursor-inside-cone raycaster -----------------------------------------
//
// Whenever the cursor's screen pixel lies over (or "inside" — in the sense
// that the camera ray passes through the cone volume), bump the cone's
// fill and outline opacities up so it's clearly visible.  Otherwise the
// cone stays at its very-faint baseline.

const raycaster = (typeof THREE !== 'undefined') ? new THREE.Raycaster() : null;
const ndc = (typeof THREE !== 'undefined') ? new THREE.Vector2() : null;
let coneHovered = false;
let coneRafPending = false;
let lastMouseEvt = null;

function setConeHoverState(hovered) {
  if (hovered === coneHovered || !coneMesh) return;
  coneHovered = hovered;
  coneMesh.material.opacity = hovered ? CONE_HOVER_OPACITY : CONE_BASE_OPACITY;
  if (coneWire) coneWire.material.opacity = hovered ? WIRE_HOVER_OPACITY : WIRE_BASE_OPACITY;
}

function probeConeHover() {
  coneRafPending = false;
  if (!coneMesh || !lastMouseEvt || !raycaster) return;
  const canvas = document.querySelector('#globe canvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((lastMouseEvt.clientX - rect.left) / rect.width)  *  2 - 1;
  ndc.y = ((lastMouseEvt.clientY - rect.top)  / rect.height) * -2 + 1;
  raycaster.setFromCamera(ndc, globe.camera());
  // intersectObject(coneMesh, false) skips the child wire so a hit on the
  // outline alone (which is technically infinitesimally thin anyway) doesn't
  // flicker the state at the edges.
  const hits = raycaster.intersectObject(coneMesh, false);
  setConeHoverState(hits.length > 0);
}

document.addEventListener('mousemove', e => {
  lastMouseEvt = e;
  if (coneRafPending) return;
  coneRafPending = true;
  requestAnimationFrame(probeConeHover);
}, { passive: true });
