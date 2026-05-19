// Cone view — minimal realistic globe with a lat/lon input that recentres
// the camera via globe.gl's animated pointOfView().

const COUNTRIES_URL = 'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/cultural/ne_50m_admin_0_countries.json';

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
  .polygonStrokeColor(() => 'rgba(220, 240, 255, 0.65)');

const controls = globe.controls();
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.rotateSpeed = 0.5;
controls.zoomSpeed = 0.8;
controls.minDistance = 110;
controls.maxDistance = 800;

fetch(COUNTRIES_URL)
  .then(r => r.json())
  .then(geo => globe.polygonsData(geo.features.filter(f => f.properties.ISO_A2 !== 'AQ')))
  .catch(e => console.warn('Country polygons failed to load:', e.message));

window.addEventListener('resize', () => {
  globe.width(window.innerWidth).height(window.innerHeight);
});

// Animate the camera to the user-supplied lat/lon over ~1.5 s.  The
// pointOfView altitude is kept lower than the default so the chosen
// point fills more of the frame after the rotation completes.
function recentre() {
  const latEl = document.getElementById('cone-lat');
  const lonEl = document.getElementById('cone-lon');
  const lat = parseFloat(latEl.value);
  const lon = parseFloat(lonEl.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    latEl.style.borderColor = 'var(--accent2)';
    lonEl.style.borderColor = 'var(--accent2)';
    return;
  }
  latEl.style.borderColor = '';
  lonEl.style.borderColor = '';
  globe.pointOfView({ lat, lng: lon, altitude: 1.8 }, 1500);
}

document.getElementById('cone-btn').addEventListener('click', recentre);
['cone-lat', 'cone-lon'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); recentre(); }
  });
});
