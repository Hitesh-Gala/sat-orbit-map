// ChinRepo — full-page repository of active Chinese-payload satellites.
// Joins the shared Argos TLE catalog with CelesTrak SATCAT records filtered
// to OWNER=PRC, classifies the orbit, and refreshes positions every 10 s.

const { propagate, makeSatrecs, fetchTLEs, fetchChinaSatcat, inferPurpose } = window.Argos;
const REFRESH_MS = 10_000;

const $ = id => document.getElementById(id);

// --- Theme toggle (light / dark) ------------------------------------------
// Persists the user's choice in localStorage so the page opens in the same
// mode next time.  The dark palette is the default; toggling adds the
// `.light` class on <body>, which re-defines the CSS custom properties.
(function setupTheme() {
  const STORE_KEY = 'argos.repo.theme';
  const btn = document.getElementById('theme-toggle');
  function apply(mode) {
    document.body.classList.toggle('light', mode === 'light');
    btn.textContent = mode === 'light' ? '☾ Dark' : '☀ Light';
  }
  apply(localStorage.getItem(STORE_KEY) || 'dark');
  btn.addEventListener('click', () => {
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    localStorage.setItem(STORE_KEY, next);
    apply(next);
  });
})();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function orbitClass(altKm) {
  if (altKm < 2000) return 'LEO';
  if (altKm < 30000) return 'MEO';
  if (altKm < 40000) return 'GEO';
  return 'HEO';
}

function fmtTime(d, tz) {
  return d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: tz });
}
function tickClocks() {
  const now = new Date();
  $('utc-time').textContent = fmtTime(now, 'UTC');
  $('ist-time').textContent = fmtTime(now, 'Asia/Kolkata');
}
tickClocks();
setInterval(tickClocks, 1000);

// --- App state ------------------------------------------------------------

let activeTLEs = [];
const prcMeta = new Map();

function setStatus(msg, cls = '') {
  $('repo-status').textContent = msg;
  $('repo-status').className = cls;
}

async function loadAll() {
  setStatus('Loading TLE catalog & SATCAT…');
  const [tleResult, satcat] = await Promise.all([fetchTLEs(), fetchChinaSatcat()]);
  activeTLEs = makeSatrecs(tleResult.tles);
  prcMeta.clear();
  for (const r of satcat) {
    const id = parseInt(r.NORAD_CAT_ID, 10);
    if (!Number.isFinite(id)) continue;
    prcMeta.set(id, {
      launch: r.LAUNCH_DATE || '',
      site:   r.LAUNCH_SITE || '',
      designator: r.OBJECT_ID || '',
      opsStatus: r.OPS_STATUS_CODE || '',
      objectName: r.OBJECT_NAME || '',
    });
  }
  const tag = tleResult.source === 'celestrak' ? 'live'
            : tleResult.source === 'cache'    ? 'cached'
            : 'bundled snapshot';
  setStatus(`${activeTLEs.length.toLocaleString()} TLEs (${tag}) · ${prcMeta.size.toLocaleString()} PRC payloads`);
}

// Compute the current row for every active Chinese payload.
function buildRows() {
  const now = new Date();
  const rows = [];
  for (const t of activeTLEs) {
    if (!prcMeta.has(t.noradId)) continue;
    const r = propagate(t.rec, now);
    if (!r || !Number.isFinite(r.lat)) continue;
    const meta = prcMeta.get(t.noradId);
    rows.push({
      name:       t.name,
      norad:      t.noradId,
      designator: meta.designator,
      purpose:    inferPurpose(t.name),
      launch:     meta.launch,
      site:       meta.site,
      alt:        r.alt,
      lat:        r.lat,
      lon:        r.lon,
      cls:        orbitClass(r.alt),
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

function applyFilter(rows) {
  const q = $('filter').value.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(r =>
    r.name.toLowerCase().includes(q) ||
    r.purpose.toLowerCase().includes(q) ||
    r.cls.toLowerCase().includes(q) ||
    String(r.norad).includes(q) ||
    r.designator.toLowerCase().includes(q)
  );
}

function render() {
  const all = buildRows();
  const filtered = applyFilter(all);
  $('repo-count').textContent = filtered.length;
  $('repo-total').textContent = all.length;
  $('repo-rows').innerHTML = filtered.map(r => `
    <tr>
      <td class="col-name">${esc(r.name)}</td>
      <td class="muted">${r.norad}</td>
      <td class="muted">${esc(r.designator)}</td>
      <td>${esc(r.purpose)}</td>
      <td>${esc(r.launch) || '<span class="muted">—</span>'}</td>
      <td>${r.site ? `<button type="button" class="site-cell" data-site="${esc(r.site)}" title="Show ${esc(r.site)} on the launch-site map">${esc(r.site)}</button>` : '<span class="muted">—</span>'}</td>
      <td class="col-num">${r.alt.toFixed(0)} km</td>
      <td class="muted">${r.lat.toFixed(2)}°, ${r.lon.toFixed(2)}°</td>
      <td>${r.cls}</td>
    </tr>`).join('') || '<tr><td colspan="9" class="muted" style="padding:20px;text-align:center">No matching satellites.</td></tr>';
}

// --- Boot -----------------------------------------------------------------

(async function main() {
  try {
    await loadAll();
    render();
    setInterval(render, REFRESH_MS);
    $('filter').addEventListener('input', render);
  } catch (e) {
    console.error(e);
    setStatus(`Load failed: ${e.message}`, 'err');
  }
})();
