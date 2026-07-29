// Debris Statistics dashboard — renders data/debris-history.json (precomputed
// from CelesTrak's full SATCAT) into a scrollable set of charts: the cumulative
// year-on-year build-up, the per-country breakdown of what's still up, the
// object-population split, altitude / inclination distributions, and the big
// named breakup events.  Pure data-in → charts-out; no live propagation.

const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CFONT = "'JetBrains Mono', monospace";
const COUNTRY_COLOR = {
  'China': '#ff5b5b', 'Russia/USSR': '#4a90e2', 'United States': '#67e8a4',
  'France': '#f39c12', 'India': '#c39bd3', 'Other': '#9aa7b3',
};
const EVENT_COLOR = {
  'Fengyun-1C': '#ff5b5b', 'Cosmos 2251': '#4a90e2', 'Iridium 33': '#67e8a4', 'Cosmos 1408': '#f39c12',
};
const EVENT_FACT = {
  'Fengyun-1C': 'China destroyed its own defunct Fengyun-1C weather satellite with a direct-ascent missile at ~865 km — the single worst debris-generating event in history. Most fragments sit in long-lived orbits that will persist for decades to centuries.',
  'Cosmos 2251': 'The defunct Russian Cosmos 2251 collided with the active US Iridium 33 at ~789 km over Siberia — the first major accidental hypervelocity collision between two intact satellites.',
  'Iridium 33': 'The active US Iridium 33 was the other half of the 2009 collision; its fragments circle the ~780 km Iridium shell.',
  'Cosmos 1408': 'Russia destroyed its defunct Cosmos 1408 ELINT satellite with a direct-ascent ASAT, creating a large fragment cloud and forcing the ISS crew to shelter. Its lower altitude means the cloud is decaying comparatively quickly.',
};

const charts = [];
function gridColor() { return 'rgba(255,255,255,0.05)'; }
function tickCfg(extra) {
  return Object.assign({ color: '#8aa0b8', font: { family: CFONT, size: 10 } }, extra || {});
}
function legendCfg(pos) {
  return { position: pos || 'top', labels: { color: '#aebfd0', font: { family: CFONT, size: 11 }, boxWidth: 12, boxHeight: 12 } };
}

async function boot() {
  let data;
  try {
    const r = await fetch('data/debris-history.json?t=' + Date.now(), { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    data = await r.json();
  } catch (e) {
    $('ds-body').innerHTML = `<div class="ds-loading">Could not load debris-history.json (${esc(e.message)}).</div>`;
    return;
  }

  const t = data.totals;
  const gen = new Date(data.generated + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  $('ds-meta').innerHTML =
    `<strong>${fmt(t.debEver)}</strong> debris objects catalogued since ${data.yearStart} · ` +
    `source <strong>${esc(data.source)}</strong> · compiled ${esc(gen)}`;

  const chinaShare = Math.round(100 * data.countries.totalInOrbit[0] / t.debInOrbit);
  $('ds-body').innerHTML = `
    <div class="ds-tiles">
      <div class="ds-tile"><span class="k">Catalogued ever</span><span class="v">${fmt(t.debEver)}</span><span class="x">pieces of tracked debris since ${data.yearStart}</span></div>
      <div class="ds-tile hero-red"><span class="k">Still in orbit</span><span class="v">${fmt(t.debInOrbit)}</span><span class="x">${chinaShare}% traced to China's launches</span></div>
      <div class="ds-tile hero-green"><span class="k">Re-entered</span><span class="v">${fmt(t.debDecayed)}</span><span class="x">${Math.round(100 * t.debDecayed / t.debEver)}% has since decayed</span></div>
      <div class="ds-tile"><span class="k">In orbit with payloads</span><span class="v">${fmt(t.payInOrbit)}</span><span class="x">active + dead satellites tracked</span></div>
    </div>

    <div class="ds-card">
      <h2>Cumulative debris build-up, ${data.yearStart}–${data.yearEnd}</h2>
      <div class="csub">Every catalogued fragment, cumulative by its parent object's launch year. The filled band is the <em>net</em> still in orbit — what has been created minus what has since re-entered.</div>
      <div class="ds-hero-box"><canvas id="hero-chart"></canvas></div>
      <div class="ds-note">${esc(data.note || '')}</div>
    </div>

    <div class="ds-grid">
      <div class="ds-card">
        <h3>Who is still up there</h3>
        <div class="csub">In-orbit debris accumulated by launch year, stacked by the country that launched the parent object.</div>
        <div class="ds-box"><canvas id="country-chart"></canvas></div>
      </div>
      <div class="ds-card">
        <h3>In orbit now, by owner</h3>
        <div class="csub">Share of the ${fmt(t.debInOrbit)} fragments still circling.</div>
        <div class="ds-box"><canvas id="owner-chart"></canvas></div>
      </div>
      <div class="ds-card">
        <h3>What's up there</h3>
        <div class="csub">Tracked objects in orbit by type — debris outnumbers working hardware.</div>
        <div class="ds-box"><canvas id="type-chart"></canvas></div>
      </div>
      <div class="ds-card">
        <h3>Altitude of in-orbit debris</h3>
        <div class="csub">Mean altitude (km). The 700–1000 km shell is where debris lingers longest.</div>
        <div class="ds-box"><canvas id="alt-chart"></canvas></div>
      </div>
      <div class="ds-card">
        <h3>Orbital inclination</h3>
        <div class="csub">18° bins, 0° equatorial → 180° retrograde. Peaks at the popular sun-synchronous / polar bands.</div>
        <div class="ds-box"><canvas id="inc-chart"></canvas></div>
      </div>
      <div class="ds-card">
        <h3>Debris created vs. re-entered</h3>
        <div class="csub">New fragments catalogued each year (by parent launch year) — the spikes are the big breakups.</div>
        <div class="ds-box"><canvas id="annual-chart"></canvas></div>
      </div>
    </div>

    <div class="ds-card">
      <h2>The events that made most of it</h2>
      <div class="csub" style="margin-bottom:12px">Four on-orbit breakups account for a large share of everything above. "In orbit" is what's still tracked; "ever" is the total catalogued.</div>
      <div class="ds-events" id="ds-events"></div>
    </div>

    <p class="ds-note">Derived in your browser from CelesTrak's public SATCAT. Counts are catalogued (tracked) objects ~10 cm and larger; the true debris population of smaller, untracked fragments is estimated in the hundreds of thousands to millions. Figures for the named events are compiled from open sources.</p>
  `;

  renderCharts(data);
  renderEvents(data);
}

function renderCharts(d) {
  // Draw instantly with no entry animation — snappier for a data dashboard,
  // and it renders even when the tab isn't compositing frames.
  Chart.defaults.animation = false;
  const years = d.years;

  // 1) Hero — cumulative build-up
  charts.push(new Chart($('hero-chart'), {
    type: 'line',
    data: {
      labels: years,
      datasets: [
        { label: 'Net in orbit', data: d.series.netInOrbit, borderColor: '#4ea8ff',
          backgroundColor: 'rgba(78,168,255,0.18)', fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2, order: 3 },
        { label: 'Cumulative created', data: d.series.cumLaunched, borderColor: '#ff9c9c',
          borderDash: [5, 4], fill: false, tension: 0.25, pointRadius: 0, borderWidth: 1.5, order: 1 },
        { label: 'Cumulative re-entered', data: d.series.cumDecayed, borderColor: '#8aa0b8',
          borderDash: [5, 4], fill: false, tension: 0.25, pointRadius: 0, borderWidth: 1.5, order: 2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: legendCfg('top'), tooltip: { callbacks: { title: it => 'Through ' + it[0].label } } },
      scales: {
        x: { ticks: tickCfg({ maxTicksLimit: 12 }), grid: { color: gridColor() } },
        y: { ticks: tickCfg(), grid: { color: gridColor() }, beginAtZero: true, title: { display: true, text: 'debris objects', color: '#8aa0b8', font: { family: CFONT, size: 10 } } },
      },
    },
  }));

  // 2) By country — stacked area
  charts.push(new Chart($('country-chart'), {
    type: 'line',
    data: {
      labels: years,
      datasets: d.countries.labels.map(name => ({
        label: name, data: d.countries.cumInOrbit[d.countries.labels.indexOf(name)],
        borderColor: COUNTRY_COLOR[name] || '#9aa7b3',
        backgroundColor: (COUNTRY_COLOR[name] || '#9aa7b3') + '55',
        fill: true, tension: 0.2, pointRadius: 0, borderWidth: 1,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: legendCfg('bottom') },
      scales: {
        x: { ticks: tickCfg({ maxTicksLimit: 8 }), grid: { color: gridColor() } },
        y: { stacked: true, ticks: tickCfg(), grid: { color: gridColor() }, beginAtZero: true },
      },
    },
  }));

  // 3) Owner doughnut (in orbit now)
  charts.push(new Chart($('owner-chart'), {
    type: 'doughnut',
    data: {
      labels: d.countries.labels,
      datasets: [{ data: d.countries.totalInOrbit,
        backgroundColor: d.countries.labels.map(n => COUNTRY_COLOR[n] || '#9aa7b3'),
        borderColor: '#0a0e14', borderWidth: 2 }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: legendCfg('right') } },
  }));

  // 4) Object population in orbit
  charts.push(new Chart($('type-chart'), {
    type: 'bar',
    data: {
      labels: ['Debris', 'Rocket bodies', 'Payloads'],
      datasets: [{ data: [d.totals.debInOrbit, d.totals.rbInOrbit, d.totals.payInOrbit],
        backgroundColor: ['#ff6b6b', '#ffd27f', '#67c8ff'], borderWidth: 0 }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { ticks: tickCfg(), grid: { color: gridColor() } }, y: { ticks: tickCfg(), grid: { color: gridColor() }, beginAtZero: true } } },
  }));

  // 5) Altitude
  charts.push(new Chart($('alt-chart'), {
    type: 'bar',
    data: { labels: d.altitude.labels, datasets: [{ data: d.altitude.inOrbit, backgroundColor: '#4ea8ff', borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { ticks: tickCfg(), grid: { color: gridColor() } }, y: { ticks: tickCfg(), grid: { color: gridColor() }, beginAtZero: true } } },
  }));

  // 6) Inclination
  charts.push(new Chart($('inc-chart'), {
    type: 'bar',
    data: { labels: d.inclination.labels, datasets: [{ data: d.inclination.inOrbit, backgroundColor: '#c39bd3', borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { ticks: tickCfg(), grid: { color: gridColor() } }, y: { ticks: tickCfg(), grid: { color: gridColor() }, beginAtZero: true } } },
  }));

  // 7) Annual created
  charts.push(new Chart($('annual-chart'), {
    type: 'bar',
    data: { labels: years, datasets: [{ data: d.series.annualLaunched, backgroundColor: '#67e8a4', borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { ticks: tickCfg({ maxTicksLimit: 10 }), grid: { color: gridColor() } }, y: { ticks: tickCfg(), grid: { color: gridColor() }, beginAtZero: true } } },
  }));
}

function renderEvents(d) {
  $('ds-events').innerHTML = (d.events || []).map(e => {
    const color = EVENT_COLOR[e.name] || '#9aa7b3';
    const fact = EVENT_FACT[e.name] || '';
    return `<div class="ds-event" style="border-left-color:${color}">
      <div class="ds-event-head">
        <span class="swatch" style="background:${color};color:${color}"></span>
        <strong>${esc(e.name)} — ${esc(e.kind)}</strong>
        <span class="ds-event-when">${esc(e.when)}</span>
        <span class="ds-event-n">${fmt(e.inOrbit)} in orbit · ${fmt(e.ever)} ever</span>
      </div>
      <p>${esc(fact)}</p>
    </div>`;
  }).join('');
}

boot();
