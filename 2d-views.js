// Argos — 2-D map views (amCharts 5).
// Plots live satellite positions on four projections in parallel, refreshed
// every 10 seconds. Data layer is the shared Argos namespace from tle-loader.js.

const { propagate, makeSatrecs, fetchTLEs, fetchChinaSatcat } = window.Argos;

const REFRESH_MS = 10_000;

// Render up to this many sats per map. amCharts handles thousands of points
// fine on desktop, but four maps × N points × 10s refresh adds up — cap to
// keep mobile devices responsive. We prioritise unique types: ISS-class,
// Chinese payloads, then a random sample of the rest.
const MAX_POINTS = 1500;

const projections = [
  { id: 'mercator', containerId: 'map-mercator', proj: () => am5map.geoMercator() },
  { id: 'equal',    containerId: 'map-equal',    proj: () => am5map.geoEqualEarth() },
  { id: 'natural',  containerId: 'map-natural',  proj: () => am5map.geoNaturalEarth1() },
  // Polar: orthographic rotated to look down on the north pole gives a
  // hemispheric polar projection that is a flat circular map.
  { id: 'polar',    containerId: 'map-polar',    proj: () => am5map.geoOrthographic().rotate([0, -90, 0]) },
];

function setStatus(msg) {
  const el = document.getElementById('map-status');
  if (el) el.textContent = msg;
}

// Build one chart, return { chart, pointSeries }.
function buildMap({ containerId, proj }) {
  const root = am5.Root.new(containerId);
  root.setThemes([am5themes_Animated.new(root)]);

  const chart = root.container.children.push(am5map.MapChart.new(root, {
    projection: proj(),
    panX: 'rotateX',
    panY: 'translateY',
    wheelY: 'zoom',
    paddingTop: 30, paddingBottom: 6, paddingLeft: 6, paddingRight: 6,
  }));

  // Graticule (lat/lon grid) — soft gray-blue lines on cream background.
  const grat = chart.series.push(am5map.GraticuleSeries.new(root, { step: 30 }));
  grat.mapLines.template.setAll({
    stroke: am5.color(0xb6c4d3),
    strokeOpacity: 0.6,
    strokeWidth: 0.5,
  });

  // Country polygons — light cartographic style.
  const polygons = chart.series.push(am5map.MapPolygonSeries.new(root, {
    geoJSON: am5geodata_worldLow,
    exclude: ['AQ'], // Antarctica clutters polar view; drop it.
  }));
  polygons.mapPolygons.template.setAll({
    fill: am5.color(0xfdfaf0),
    stroke: am5.color(0x90a4b8),
    strokeWidth: 0.5,
    interactive: false,
  });

  // Satellite points — darker fills give contrast on light land.
  const pointSeries = chart.series.push(am5map.MapPointSeries.new(root, {
    latitudeField: 'lat',
    longitudeField: 'lon',
  }));
  pointSeries.bullets.push((rt, _series, dataItem) => {
    const cn = dataItem.dataContext.cn;
    const radius = cn ? 2.4 : 1.7;
    const color = cn ? 0xc62828 : 0x2e7d4f;
    return am5.Bullet.new(rt, {
      sprite: am5.Circle.new(rt, {
        radius,
        fill: am5.color(color),
        fillOpacity: 0.9,
        stroke: am5.color(color),
        strokeOpacity: 0.25,
        strokeWidth: 3,
        tooltipText: '{name}\n[bold]{altKm} km[/]  ·  {latStr}, {lonStr}',
      }),
    });
  });

  return { root, chart, pointSeries };
}

const maps = projections.map(buildMap);

// --- Data flow ------------------------------------------------------------

let activeTLEs = [];
let prcSet = new Set();

async function loadAll() {
  setStatus('Loading TLE catalog…');
  const [tleResult, satcat] = await Promise.all([fetchTLEs(), fetchChinaSatcat()]);
  activeTLEs = makeSatrecs(tleResult.tles);
  prcSet = new Set(satcat.map(r => parseInt(r.NORAD_CAT_ID, 10)).filter(Number.isFinite));
  const tag = tleResult.source === 'celestrak' ? 'live'
            : tleResult.source === 'cache'    ? 'cached'
            : 'bundled';
  setStatus(`Tracking ${activeTLEs.length.toLocaleString()} sats (${tag}) · ${prcSet.size.toLocaleString()} CN`);
}

function project() {
  if (!activeTLEs.length) return [];
  const now = new Date();
  const all = [];
  for (const t of activeTLEs) {
    const r = propagate(t.rec, now);
    if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    all.push({
      name: t.name,
      lat: r.lat,
      lon: r.lon,
      altKm: r.alt.toFixed(0),
      latStr: r.lat.toFixed(2) + '°',
      lonStr: r.lon.toFixed(2) + '°',
      cn: prcSet.has(t.noradId),
    });
  }
  if (all.length <= MAX_POINTS) return all;

  // Keep all Chinese payloads + a uniformly-spaced sample of the rest.
  const cn = all.filter(s => s.cn);
  const others = all.filter(s => !s.cn);
  const stride = Math.ceil(others.length / Math.max(1, MAX_POINTS - cn.length));
  const sampled = others.filter((_, i) => i % stride === 0);
  return cn.concat(sampled);
}

function update() {
  const data = project();
  for (const { pointSeries } of maps) {
    pointSeries.data.setAll(data);
  }
}

// --- Boot -----------------------------------------------------------------

(async function main() {
  try {
    await loadAll();
    update();
    setInterval(update, REFRESH_MS);
  } catch (e) {
    console.error(e);
    setStatus(`Load failed: ${e.message}`);
  }
})();
