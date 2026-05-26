// Orbital Prediction — globe with the Survey-of-India outline overlaid on
// top of Natural Earth's world boundaries (the latter has India out of
// line with India's official depiction), plus every active satellite
// rendered as a small THREE.Mesh at its real orbital altitude.
//
// Positions are propagated with SGP4 once per second to the "current
// time" and to "current time + 1 s"; every animation frame interpolates
// between the two so the dots glide smoothly along their orbits at
// 60 fps without paying for 60 SGP4 calls per satellite per second.

const { fetchTLEs, makeSatrecs, propagate } = window.Argos;

const EARTH_R_KM = 6371;
const EARTH_R_GL = 100;  // three-globe's internal unit (1 R = 100)

// Tier palette — chosen to be distinct against the Blue Marble texture.
const TIER_COLOUR = {
  LEO: 0xf2f2f2,  // off-white (LEO swarm near the surface reads bright)
  MEO: 0x6ec1ff,  // mid-blue
  GEO: 0x67e8a4,  // green
  HEO: 0xc08bff,  // purple (high or elliptical orbits)
};
function tierOf(altKm) {
  if (altKm <  2000) return 'LEO';
  if (altKm < 30000) return 'MEO';
  if (altKm < 42000) return 'GEO';
  return 'HEO';
}

// --- Globe ---------------------------------------------------------------

const NE_50M_URL = 'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/cultural/ne_50m_admin_0_countries.json';
const IND_URL    = 'data/india-outline.geojson';

const globe = Globe()(document.getElementById('globe'))
  .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
  .bumpImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png')
  .backgroundImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/night-sky.png')
  .showAtmosphere(true)
  .atmosphereColor('#4ea8ff')
  .atmosphereAltitude(0.18)
  .pointOfView({ lat: 22, lng: 80, altitude: 3.0 }, 0)
  // Borders.  The polygon set is rebuilt below once both GeoJSONs land:
  // Natural Earth's countries minus India + India from the uploaded
  // Survey-of-India outline.
  .polygonsData([])
  .polygonAltitude(0.001)
  .polygonCapColor(() => 'rgba(255, 255, 255, 0)')
  .polygonSideColor(() => 'rgba(255, 255, 255, 0)')
  .polygonStrokeColor(d =>
    d.properties && d.properties._source === 'SoI'
      ? 'rgba(255, 200, 110, 0.95)'   // emphasise the India outline
      : 'rgba(220, 240, 255, 0.55)'   // the rest of the world
  );

const controls = globe.controls();
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.rotateSpeed = 0.5;
controls.zoomSpeed = 0.8;
controls.minDistance = 110;
controls.maxDistance = 1500;

window.addEventListener('resize', () => {
  globe.width(window.innerWidth).height(window.innerHeight);
});

// --- Clocks --------------------------------------------------------------

const fmtTime = (d, tz) => d.toLocaleTimeString('en-GB', {
  hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: tz,
});
const fmtDate = (d, tz) => d.toLocaleDateString('en-GB', {
  year: 'numeric', month: 'short', day: '2-digit', timeZone: tz,
});
function tickClocks() {
  const now = new Date();
  document.getElementById('utc-time').textContent = fmtTime(now, 'UTC');
  document.getElementById('ist-time').textContent = fmtTime(now, 'Asia/Kolkata');
  document.getElementById('utc-date').textContent = fmtDate(now, 'UTC') + ' UTC';
}
tickClocks();
setInterval(tickClocks, 1000);

// --- Country polygons ----------------------------------------------------

async function loadPolygons() {
  try {
    const [ne, ind] = await Promise.all([
      fetch(NE_50M_URL).then(r => r.json()),
      fetch(IND_URL).then(r => r.json()),
    ]);
    // Natural Earth, minus India and Antarctica.
    const world = ne.features.filter(f => {
      const p = f.properties || {};
      return (p.ADM0_A3 || p.adm0_a3) !== 'IND'
          && (p.ISO_A2  || p.iso_a2)  !== 'AQ';
    });
    // India from the uploaded Survey-of-India outline.  Tag the features
    // so the stroke accessor can paint them in a brighter colour.
    const indiaFeatures = (ind.features || []).map(f => ({
      ...f,
      properties: { ...(f.properties || {}), _source: 'SoI' },
    }));
    globe.polygonsData(world.concat(indiaFeatures));
  } catch (e) {
    console.warn('Polygon load failed:', e);
  }
}
loadPolygons();

// --- Satellites: build, propagate, animate --------------------------------

const STAT_TRACK_EL = document.getElementById('track-count');
const STATUS_EL     = document.getElementById('status');

// Capped headcount per tier.  4000 individual sphere meshes wedge the
// preview / lower-end GPUs; using THREE.InstancedMesh lets us push the
// budget back up while paying for one draw call per tier.
const MAX_PER_TIER = { LEO: 1500, MEO: 250, GEO: 800, HEO: 200 };
// SGP4 cadence — sample every PROP_MS at "now" and at "now + PROP_MS";
// each animation frame linearly interpolates between the two so dots
// glide instead of jumping while we only pay for SGP4 once per second.
const PROP_MS = 1000;

// Per-tier instanced container.  Each entry: { rec, prevPos, nextPos }.
const tiers = { LEO: [], MEO: [], GEO: [], HEO: [] };
const tierMeshes = {};
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
let lastPropAt = 0;
let nextPropTarget = 0;

function latLonAltToVec(lat, lon, altKm, out) {
  const c = globe.getCoords(lat, lon, altKm / EARTH_R_KM);
  out.set(c.x, c.y, c.z);
  return out;
}

async function loadSatellites() {
  STATUS_EL.textContent = 'Loading TLE catalogue…';
  const { tles, source } = await fetchTLEs();
  STATUS_EL.textContent = `Classifying ${tles.length.toLocaleString()} TLEs…`;
  const recs = makeSatrecs(tles);

  // Bucket every TLE by tier using a single propagation.
  const buckets = { LEO: [], MEO: [], GEO: [], HEO: [] };
  const now = new Date();
  for (const r of recs) {
    const p = propagate(r.rec, now);
    if (!p || !Number.isFinite(p.alt)) continue;
    buckets[tierOf(p.alt)].push({ rec: r.rec, lat: p.lat, lon: p.lon, alt: p.alt });
  }

  // Fisher-Yates and slice to cap per tier.
  function shuf(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i+1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

  for (const cls of ['LEO', 'MEO', 'GEO', 'HEO']) {
    const picked = shuf(buckets[cls]).slice(0, MAX_PER_TIER[cls]);
    if (!picked.length) continue;
    const geo = new THREE.SphereGeometry(0.5, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: TIER_COLOUR[cls] });
    const im = new THREE.InstancedMesh(geo, mat, picked.length);
    im.frustumCulled = false;  // sat positions span far beyond Earth's sphere
    globe.scene().add(im);
    tierMeshes[cls] = im;
    for (let i = 0; i < picked.length; i++) {
      const s = picked[i];
      const prev = latLonAltToVec(s.lat, s.lon, s.alt, new THREE.Vector3());
      const next = new THREE.Vector3().copy(prev);
      tiers[cls].push({ rec: s.rec, prevPos: prev, nextPos: next, idx: i });
      _m.makeTranslation(prev.x, prev.y, prev.z);
      im.setMatrixAt(i, _m);
    }
    im.instanceMatrix.needsUpdate = true;
  }

  resampleAll(performance.now());

  // Stats.
  let total = 0;
  for (const cls of ['LEO', 'MEO', 'GEO', 'HEO']) {
    const n = tiers[cls].length;
    total += n;
    const el = document.getElementById(`${cls.toLowerCase()}-count`);
    if (el) el.textContent = n.toLocaleString();
  }
  STAT_TRACK_EL.textContent = total.toLocaleString();
  STATUS_EL.textContent = `${total.toLocaleString()} satellites · live SGP4 · ${source}`;
}

function resampleAll(framePerfMs) {
  const now     = new Date();
  const nextNow = new Date(now.getTime() + PROP_MS);
  for (const cls of ['LEO', 'MEO', 'GEO', 'HEO']) {
    for (const s of tiers[cls]) {
      const a = propagate(s.rec, now);
      const b = propagate(s.rec, nextNow);
      if (!a || !b) continue;
      latLonAltToVec(a.lat, a.lon, a.alt, s.prevPos);
      latLonAltToVec(b.lat, b.lon, b.alt, s.nextPos);
    }
  }
  lastPropAt = framePerfMs;
  nextPropTarget = framePerfMs + PROP_MS;
}

function animate() {
  const tNow = performance.now();
  if (tNow >= nextPropTarget) resampleAll(tNow);
  const blend = Math.min(1, (tNow - lastPropAt) / PROP_MS);
  for (const cls of ['LEO', 'MEO', 'GEO', 'HEO']) {
    const im = tierMeshes[cls];
    if (!im) continue;
    for (const s of tiers[cls]) {
      _v.copy(s.prevPos).lerp(s.nextPos, blend);
      _m.makeTranslation(_v.x, _v.y, _v.z);
      im.setMatrixAt(s.idx, _m);
    }
    im.instanceMatrix.needsUpdate = true;
  }
  requestAnimationFrame(animate);
}

// --- Boot ----------------------------------------------------------------

(async function main() {
  try {
    await loadSatellites();
    animate();
  } catch (e) {
    console.error(e);
    STATUS_EL.textContent = `Load failed: ${e.message}`;
    STATUS_EL.style.color = 'var(--accent2)';
  }
})();
