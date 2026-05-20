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
  // HTML marker layer for the pink medusa.  Single element only, so the
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
  });

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
