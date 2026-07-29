// Debris Tracker — a 3-D-Visualiser-style globe that plots tracked orbital
// debris at true altitude via one THREE.InstancedMesh, colour-coded by the
// breakup event that produced it, plus a Chart.js statistics pop-up.
//
// Data: CelesTrak's per-event debris GROUPs (live → 6 h localStorage cache →
// bundled data/debris.tle snapshot), the same resilience cascade the rest of
// the site uses.  Each fragment is tagged to its source by the parent launch
// designator in the TLE (line 1, cols 10–14) — e.g. 99025 = Fengyun-1C.

const { parseTLE, propagate, EARTH_R_KM } = window.Argos;

const $ = id => document.getElementById(id);
const REFRESH_MS    = 12000;
const CHUNK_SIZE    = 1500;
const MAX_INSTANCES = 8000;      // ~2.6 k tracked fragments today + headroom
const SAT_RADIUS    = 1.3;

// =========================================================================
// Breakup events.  Keyed by the parent launch designator prefix (the 5 chars
// at line-1 cols 10–14): 2-digit launch year + 3-digit launch number.
// =========================================================================
const SOURCES = [
  { key: '99025', short: 'Fengyun-1C',  label: 'Fengyun-1C',  country: 'China',  color: '#ff5b5b' },
  { key: '93036', short: 'Cosmos 2251', label: 'Cosmos 2251', country: 'Russia', color: '#4a90e2' },
  { key: '97051', short: 'Iridium 33',  label: 'Iridium 33',  country: 'USA',    color: '#67e8a4' },
  { key: '82092', short: 'Cosmos 1408', label: 'Cosmos 1408', country: 'Russia', color: '#f39c12' },
  { key: 'other', short: 'Other',       label: 'Other debris', country: '—',     color: '#9aa7b3' },
];
const OTHER = SOURCES.length - 1;
const SRC_INDEX = {};
SOURCES.forEach((s, i) => { if (s.key !== 'other') SRC_INDEX[s.key] = i; });
const SRC_COLOR = SOURCES.map(s => new THREE.Color(s.color));

// The rich per-event context + all charts live on the dedicated statistics
// dashboard (debris-stats.html), computed from the full SATCAT — this globe
// page just plots and filters the fragments.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function setStatus(msg, isErr) {
  const el = $('debris-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isErr ? 'var(--accent2)' : '';
}

// International designator from TLE line 1 (cols 10–17) → e.g. "1999-025DKV".
function intlIdOf(l1) {
  const raw = (l1 || '').slice(9, 17).trim();
  const m = raw.match(/^(\d{2})(\d{3})([A-Z]{1,3})$/);
  if (!m) return raw;
  const yy = parseInt(m[1], 10);
  return `${yy < 57 ? 2000 + yy : 1900 + yy}-${m[2]}${m[3]}`;
}

// =========================================================================
// Data fetch — CelesTrak per-event GROUPs, cache, bundled fallback.
// =========================================================================
const DEBRIS_GROUPS = ['fengyun-1c-debris', 'cosmos-2251-debris', 'iridium-33-debris', 'cosmos-1408-debris'];
const GP = g => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`;
const CACHE_KEY = 'argos.debris.tle.v1';
const CACHE_TTL = 6 * 3600 * 1000;

function cacheGet() {
  try {
    const { t, v } = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (Date.now() - t > CACHE_TTL) return null;
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}
function cacheSet(v) { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), v })); } catch {} }

async function fetchGroup(g) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(GP(g), { signal: ctrl.signal });
    clearTimeout(to);
    return r.ok ? await r.text() : '';
  } catch { clearTimeout(to); return ''; }
}

async function fetchDebris() {
  const cached = cacheGet();
  if (cached && cached.length) return { tles: cached, source: 'cache' };

  const texts = await Promise.all(DEBRIS_GROUPS.map(fetchGroup));
  const parsed = parseTLE(texts.filter(Boolean).join('\n'));
  if (parsed.length > 200) {
    cacheSet(parsed);
    return { tles: parsed, source: 'celestrak' };
  }

  // Bundled snapshot — always ships, ~2.6 k fragments.
  const r = await fetch('data/debris.tle', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`bundled debris missing (HTTP ${r.status})`);
  return { tles: parseTLE(await r.text()), source: 'bundled' };
}

// =========================================================================
// Globe (same chrome as viz3d / sats-by-ops)
// =========================================================================
const globe = Globe()(document.getElementById('globe'))
  .globeImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg')
  .bumpImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png')
  .backgroundImageUrl('https://unpkg.com/three-globe@2.31.1/example/img/night-sky.png')
  .showAtmosphere(true)
  .atmosphereColor('#4ea8ff')
  .atmosphereAltitude(0.18)
  .pointOfView({ lat: 20, lng: 78, altitude: 3.4 }, 0);

const controls = globe.controls();
controls.enableDamping   = true;
controls.dampingFactor   = 0.1;
controls.rotateSpeed     = 0.45;
controls.zoomSpeed       = 0.8;
controls.minDistance     = 110;
controls.maxDistance     = 2400;
controls.autoRotate      = true;
controls.autoRotateSpeed = 0.16;
const stopAutoRotate = () => { controls.autoRotate = false; };
document.getElementById('globe').addEventListener('pointerdown', stopAutoRotate, { once: true });
document.getElementById('globe').addEventListener('wheel',       stopAutoRotate, { once: true });

function fitGlobeToContainer() {
  const el = document.getElementById('globe');
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) globe.width(rect.width).height(rect.height);
}
fitGlobeToContainer();
window.addEventListener('resize', fitGlobeToContainer);

// =========================================================================
// Instanced mesh
// =========================================================================
const SAT_GEOM = new THREE.SphereGeometry(SAT_RADIUS, 6, 6);
const SAT_MAT  = new THREE.MeshBasicMaterial({ color: 0xffffff });
const instMesh = new THREE.InstancedMesh(SAT_GEOM, SAT_MAT, MAX_INSTANCES);
instMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
instMesh.frustumCulled = false;
const HIDE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
for (let i = 0; i < MAX_INSTANCES; i++) instMesh.setMatrixAt(i, HIDE_MATRIX);
instMesh.instanceMatrix.needsUpdate = true;
globe.scene().add(instMesh);

// =========================================================================
// State
// =========================================================================
let allDebris = [];            // { name, noradId, intlId, src, rec }
let satState  = [];            // { lat, lon, alt, x, y, z } | null
let satPeriod = [];            // minutes
let dataSource = '';
let propagationActive = false;

const sourceEnabled = SOURCES.map(() => true);
const sourceCount   = SOURCES.map(() => 0);

let altScale = 1.0;
let dotScale = 1.0;

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _mat = new THREE.Matrix4();

// =========================================================================
// Source filter panel
// =========================================================================
function buildSourcePanel() {
  const c = $('debris-sources');
  c.innerHTML = SOURCES.map((s, i) => `
    <div class="deb-row" data-idx="${i}">
      <input type="checkbox" ${sourceEnabled[i] ? 'checked' : ''} aria-label="Toggle ${esc(s.label)}">
      <span class="swatch" style="background:${s.color};color:${s.color}"></span>
      <span class="deb-lbl">${esc(s.short)} <span class="deb-country">${esc(s.country)}</span></span>
      <span class="deb-cnt" id="deb-cnt-${i}">…</span>
      <button type="button" class="deb-info" data-key="${s.key}" title="The story behind this debris" aria-label="About ${esc(s.label)}">ⓘ</button>
    </div>`).join('');
  c.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      sourceEnabled[parseInt(cb.closest('.deb-row').dataset.idx, 10)] = cb.checked;
      rerenderFiltered();
    });
  });
  c.querySelectorAll('.deb-info').forEach(btn => {
    btn.addEventListener('click', () => openInfo(btn.dataset.key));
  });
  $('deb-all').addEventListener('click', () => {
    c.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true);
    sourceEnabled.fill(true);
    rerenderFiltered();
  });
  $('deb-none').addEventListener('click', () => {
    c.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
    sourceEnabled.fill(false);
    rerenderFiltered();
  });
}

function updateSourceCounts() {
  for (let i = 0; i < SOURCES.length; i++) {
    const el = $('deb-cnt-' + i);
    if (el) el.textContent = sourceCount[i].toLocaleString();
  }
}

function bindSliders() {
  $('deb-alt').addEventListener('input', e => {
    altScale = parseFloat(e.target.value) || 1;
    $('deb-alt-val').textContent = altScale.toFixed(1);
    rerenderFiltered();
  });
  $('deb-size').addEventListener('input', e => {
    dotScale = parseFloat(e.target.value) || 1;
    $('deb-size-val').textContent = dotScale.toFixed(1);
    rerenderFiltered();
  });
}

// =========================================================================
// Chunked SGP4 propagation
// =========================================================================
let chunkIdx = 0;
let propNow  = new Date();

function startPropagationTick() {
  if (propagationActive || !allDebris.length) return;
  propagationActive = true;
  propNow  = new Date();
  chunkIdx = 0;
  sourceCount.fill(0);
  processChunk();
}

function processChunk() {
  const end = Math.min(chunkIdx + CHUNK_SIZE, allDebris.length);
  for (let i = chunkIdx; i < end; i++) {
    const d = allDebris[i];
    const r = propagate(d.rec, propNow);
    if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon) || !Number.isFinite(r.alt) || r.alt < 0) {
      instMesh.setMatrixAt(i, HIDE_MATRIX);
      satState[i] = null;
      continue;
    }
    satState[i] = { lat: r.lat, lon: r.lon, alt: r.alt };
    const src = d.src;
    sourceCount[src]++;
    if (!sourceEnabled[src]) { instMesh.setMatrixAt(i, HIDE_MATRIX); continue; }
    const altFrac = (r.alt / EARTH_R_KM) * altScale;
    const p = globe.getCoords(r.lat, r.lon, altFrac);
    satState[i].x = p.x; satState[i].y = p.y; satState[i].z = p.z;
    _pos.set(p.x, p.y, p.z);
    _scale.setScalar(dotScale);
    _mat.compose(_pos, _quat, _scale);
    instMesh.setMatrixAt(i, _mat);
    instMesh.setColorAt(i, SRC_COLOR[src]);
  }
  chunkIdx = end;
  if (chunkIdx < allDebris.length) {
    if (document.hidden) setTimeout(processChunk, 0);
    else                 requestAnimationFrame(processChunk);
    return;
  }
  instMesh.instanceMatrix.needsUpdate = true;
  if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
  updateSourceCounts();
  const total = sourceCount.reduce((a, b) => a + b, 0);
  setStatus(`${total.toLocaleString()} fragments tracked · ${dataSource} · ${propNow.toISOString().slice(11, 19)} UTC`);
  propagationActive = false;
  if (hoverId !== -1 && satState[hoverId]) renderTooltip(hoverId);
}

// Visibility / scale refresh without re-running SGP4.
function rerenderFiltered() {
  for (let i = 0; i < allDebris.length; i++) {
    const st = satState[i];
    const src = allDebris[i].src;
    if (!st || !sourceEnabled[src]) { instMesh.setMatrixAt(i, HIDE_MATRIX); continue; }
    const altFrac = (st.alt / EARTH_R_KM) * altScale;
    const p = globe.getCoords(st.lat, st.lon, altFrac);
    st.x = p.x; st.y = p.y; st.z = p.z;
    _pos.set(p.x, p.y, p.z);
    _scale.setScalar(dotScale);
    _mat.compose(_pos, _quat, _scale);
    instMesh.setMatrixAt(i, _mat);
    instMesh.setColorAt(i, SRC_COLOR[src]);
  }
  instMesh.instanceMatrix.needsUpdate = true;
  if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
}

// =========================================================================
// Hover tooltip — screen-space pick (forgiving vs raycasting tiny spheres)
// =========================================================================
const tip = $('sat-tip');
let hoverId = -1;
let pendingMouse = null;
let rafQueued = false;
const PICK_RADIUS_PX = 12;
const _pickV = new THREE.Vector3();

function pickSat(ev) {
  const cv = document.querySelector('#globe canvas');
  if (!cv) return -1;
  const rect = cv.getBoundingClientRect();
  const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
  const cam = globe.camera();
  const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
  let best = -1, bestD2 = PICK_RADIUS_PX * PICK_RADIUS_PX;
  for (let i = 0; i < allDebris.length; i++) {
    const st = satState[i];
    if (!st || st.x === undefined) continue;
    if (!sourceEnabled[allDebris[i].src]) continue;
    _pickV.set(st.x, st.y, st.z).project(cam);
    if (_pickV.z > 1 || _pickV.z < -1) continue;
    const sx = (_pickV.x * 0.5 + 0.5) * rect.width;
    const sy = (_pickV.y * -0.5 + 0.5) * rect.height;
    const dx = sx - mx, dy = sy - my, d2 = dx * dx + dy * dy;
    if (d2 >= bestD2) continue;
    const vx = st.x - cx, vy = st.y - cy, vz = st.z - cz;
    const L2 = vx * vx + vy * vy + vz * vz;
    const tt = -(cx * vx + cy * vy + cz * vz) / L2;
    if (tt > 0 && tt < 1) {
      const px = cx + vx * tt, py = cy + vy * tt, pz = cz + vz * tt;
      if (px * px + py * py + pz * pz < 99 * 99) continue;
    }
    bestD2 = d2; best = i;
  }
  return best;
}

function renderTooltip(id) {
  const d = allDebris[id];
  const st = satState[id];
  if (!d || !st) return;
  const s = SOURCES[d.src];
  const period = satPeriod[id];
  const periodStr = period
    ? `${period.toFixed(1)} min <span class="muted">(${(period / 60).toFixed(2)} h)</span>`
    : '<span class="muted">unknown</span>';
  const speedStr = period
    ? `${(2 * Math.PI * (EARTH_R_KM + st.alt) / (period * 60)).toFixed(2)} km/s`
    : '<span class="muted">unknown</span>';
  const badge = `<span class="cls" style="background:rgba(255,255,255,0.06);color:${s.color}">${esc(s.short)}</span>`;
  tip.innerHTML = `
    <b>${esc(d.name)}</b> ${badge}
    <div>Source <strong>${esc(s.label)}</strong></div>
    <div>NORAD ID <strong>${Number.isFinite(d.noradId) ? d.noradId : '—'}</strong></div>
    <div>Int'l ID <strong>${esc(d.intlId || '—')}</strong></div>
    <div>Altitude <strong>${st.alt.toFixed(0)} km</strong></div>
    <div>Speed <strong>${speedStr}</strong></div>
    <div>Period <strong>${periodStr}</strong></div>`;
}

function processHover() {
  rafQueued = false;
  const ev = pendingMouse;
  if (!ev) return;
  const id = pickSat(ev);
  if (id !== -1) {
    if (id !== hoverId) { hoverId = id; renderTooltip(id); }
    tip.hidden = false;
    const ttW = tip.offsetWidth || 220, ttH = tip.offsetHeight || 120;
    let x = ev.clientX + 16, y = ev.clientY + 16;
    if (x + ttW > window.innerWidth)  x = ev.clientX - ttW - 12;
    if (y + ttH > window.innerHeight) y = ev.clientY - ttH - 12;
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  } else if (hoverId !== -1) {
    hoverId = -1;
    tip.hidden = true;
  }
}
function onMouseMove(e) { pendingMouse = e; if (rafQueued) return; rafQueued = true; requestAnimationFrame(processHover); }
function onMouseLeave() { pendingMouse = null; hoverId = -1; tip.hidden = true; }
(function attachHover() {
  const cv = document.querySelector('#globe canvas');
  if (!cv) { requestAnimationFrame(attachHover); return; }
  cv.addEventListener('mousemove', onMouseMove);
  cv.addEventListener('mouseleave', onMouseLeave);
})();

// =========================================================================
// Info pop-ups — the story behind each debris class, plus the tracking gaps
// (why the US / India / early-Russia ASAT tests leave nothing to plot).
// "ever / in orbit" figures are from CelesTrak's SATCAT.
// =========================================================================
const INFO = {
  '99025': {
    color: '#ff5b5b', title: 'Fengyun-1C — China’s 2007 ASAT test',
    sub: '11 January 2007 · ~865 km altitude',
    stats: [['Fragments catalogued', '3,534'], ['Still in orbit', '~2,321'], ['Break-up altitude', '~865 km']],
    paras: [
      'China destroyed its own defunct Fengyun-1C weather satellite with a ground-launched SC-19 kinetic interceptor — the first major anti-satellite test in over two decades. It produced the largest debris cloud in history and drew broad international condemnation.',
      'Roughly two-thirds of its fragments are <em>still up there</em> nearly two decades later, because ~865 km is high enough that atmospheric drag barely bites. Many pieces will persist for centuries.',
    ],
    trivia: [
      'It is the single biggest man-made contributor to the tracked low-Earth-orbit debris population.',
      'The ISS and working satellites have had to manoeuvre to dodge Fengyun-1C fragments more than once.',
    ],
  },
  '93036': {
    color: '#4a90e2', title: 'Cosmos 2251 — the first big satellite crash',
    sub: '10 February 2009 · ~789 km over Siberia',
    stats: [['Fragments catalogued', '1,716'], ['Still in orbit', '~624'], ['Collision speed', '~11.7 km/s']],
    paras: [
      'The defunct Russian Cosmos 2251 military comms satellite (dead since the mid-1990s and unable to manoeuvre) slammed into the <em>active</em> US Iridium 33 — the first-ever accidental hypervelocity collision between two intact satellites.',
      'It shattered into more than 1,700 catalogued pieces, of which several hundred are still in orbit.',
    ],
    trivia: [
      'Neither operator had a precise warning — conjunction screening in 2009 was far cruder than today.',
      'This crash, together with Fengyun-1C, is why the US now runs a rigorous conjunction-assessment service for operators worldwide.',
    ],
  },
  '97051': {
    color: '#67e8a4', title: 'Iridium 33 — the working satellite that got hit',
    sub: '10 February 2009 · ~789 km',
    stats: [['Fragments catalogued', '656'], ['Still in orbit', '~117'], ['Status at impact', 'fully operational']],
    paras: [
      'Iridium 33 was the other half of the 2009 collision — a live voice/data satellite in the 66-strong Iridium constellation, the only network with true pole-to-pole coverage.',
      'It fragmented into fewer pieces than Cosmos 2251, and Iridium restored service within days using on-orbit spares.',
    ],
    trivia: [
      'Iridium later replaced its entire first-generation fleet with Iridium NEXT (2017–2019).',
      'Losing a satellite to space debris was a pointed irony for a company flying 66 of them.',
    ],
  },
  '82092': {
    color: '#f39c12', title: 'Cosmos 1408 — Russia’s 2021 ASAT test',
    sub: '15 November 2021 · ~485 km',
    stats: [['Fragments catalogued', '1,806'], ['Still in orbit', '~4'], ['Break-up altitude', '~485 km']],
    paras: [
      'Russia destroyed its defunct Cosmos 1408 electronic-intelligence satellite (launched 1982) with a Nudol direct-ascent missile. The ISS crew — including two cosmonauts — had to shelter in their return capsules as the station repeatedly passed through the fresh cloud.',
      'But because the test was at only ~485 km, the debris is decaying fast: from ~1,800 fragments it is already down to a handful still tracked.',
    ],
    trivia: [
      'A vivid lesson in altitude: the same kind of test as Fengyun-1C, but ~380 km lower — so it cleans itself up in a few years instead of centuries.',
    ],
  },
  'other': {
    color: '#9aa7b3', title: 'Other tracked debris',
    sub: 'everything not from the four named clouds',
    stats: [['On this globe', 'usually ~0'], ['In the full catalogue', '~12,500 in orbit']],
    paras: [
      'Across the whole catalogue, most debris is <em>not</em> from these four famous events: it is spent rocket upper stages that later exploded (leftover propellant or battery blasts), fragments from hundreds of smaller break-ups, and mission-related bits.',
      'This globe only carries CelesTrak’s four dedicated debris groups, so “Other” is near zero here. For the complete ~12,500-object in-orbit debris population from every source, open the <strong>Statistics &amp; history</strong> dashboard.',
    ],
    trivia: [],
  },
  'gaps': {
    color: '#ffd27f', title: 'Missing ASAT tests & tracking gaps',
    sub: 'why US / Indian / early-Russian ASAT debris isn’t shown',
    stats: [['US 1985 (Solwind)', '286 → 0 up'], ['US 2008 (USA-193)', '174 → 0 up'], ['India 2019 (Microsat-R)', '129 → 0 up']],
    paras: [
      'Four nations have destroyed satellites in orbit, but only two still show up here — and the reason is <strong>altitude</strong>:',
      '• <strong>USA, 1985</strong> — an F-15-launched ASM-135 missile destroyed the P78-1 “Solwind” satellite at ~525 km. 286 fragments were tracked; the last re-entered in 2004.',
      '• <strong>USA, 2008 (“Burnt Frost”)</strong> — a Navy SM-3 destroyed the failing USA-193 spy satellite at just ~247 km, deliberately low so the debris would decay within weeks. 174 tracked; none remain.',
      '• <strong>India, 2019 (“Mission Shakti”)</strong> — India destroyed Microsat-R at ~283 km, again deliberately low. 129 tracked; none remain.',
      '• <strong>Russia</strong> — the Soviet “IS” co-orbital ASAT programme (1968–1982) scattered Cosmos-numbered debris, most long since decayed.',
      'So these aren’t hidden — there is simply nothing left in orbit to plot, which is exactly why CelesTrak keeps no live debris group for them. A low-altitude test is comparatively responsible: the mess clears in months. A high one like Fengyun-1C is a multi-century liability.',
      'This globe intentionally shows only the four big persistent clouds. The <strong>Statistics &amp; history</strong> dashboard, built from the full SATCAT, counts <em>every</em> tracked debris object (~35,800 catalogued, ~12,500 still up) from all nations — that is where US, Indian and everyone else’s debris is fully accounted for.',
    ],
    trivia: [],
  },
};

function renderInfo(key) {
  const info = INFO[key];
  if (!info) return;
  const stat = (k, v) => `<div class="deb-info-stat"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
  $('debris-info-body').innerHTML = `
    <div class="deb-info-head">
      <span class="swatch" style="background:${info.color};color:${info.color}"></span>
      <div><h2 id="debris-info-title">${esc(info.title)}</h2><div class="deb-info-sub">${esc(info.sub)}</div></div>
    </div>
    ${info.stats && info.stats.length ? `<div class="deb-info-stats">${info.stats.map(s => stat(s[0], s[1])).join('')}</div>` : ''}
    ${info.paras.map(p => `<p class="deb-info-p">${p}</p>`).join('')}
    ${info.trivia && info.trivia.length ? `<div class="deb-info-trivia"><span class="k">Trivia</span><ul>${info.trivia.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
  `;
}

let infoOpen = false;
function openInfo(key) {
  if (!INFO[key]) return;
  renderInfo(key);
  const m = $('debris-info-modal');
  m.hidden = false;
  m.setAttribute('aria-hidden', 'false');
  m.querySelector('.deb-modal-card').scrollTop = 0;
  infoOpen = true;
}
function closeInfo() {
  const m = $('debris-info-modal');
  m.hidden = true;
  m.setAttribute('aria-hidden', 'true');
  infoOpen = false;
}
(function setupInfo() {
  $('debris-info-close')?.addEventListener('click', closeInfo);
  $('debris-gaps-btn')?.addEventListener('click', () => openInfo('gaps'));
  $('debris-info-modal')?.addEventListener('click', e => { if (e.target.id === 'debris-info-modal') closeInfo(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && infoOpen) closeInfo(); });
})();

// =========================================================================
// Boot
// =========================================================================
async function boot() {
  setStatus('Loading debris catalogue…');
  let result;
  try {
    result = await fetchDebris();
  } catch (e) {
    setStatus('Debris fetch failed: ' + e.message, true);
    return;
  }
  dataSource = result.source === 'celestrak' ? 'live'
             : result.source === 'cache' ? 'cached' : 'bundled snapshot';

  const seen = new Set();
  allDebris = [];
  for (const t of result.tles) {
    if (Number.isFinite(t.noradId)) { if (seen.has(t.noradId)) continue; seen.add(t.noradId); }
    let rec;
    try { rec = satellite.twoline2satrec(t.l1, t.l2); } catch { continue; }
    const src = SRC_INDEX[t.l1.slice(9, 14)] ?? OTHER;
    allDebris.push({ name: t.name, noradId: t.noradId, intlId: intlIdOf(t.l1), src, rec });
  }
  if (allDebris.length > MAX_INSTANCES) allDebris.length = MAX_INSTANCES;

  satState  = new Array(allDebris.length).fill(null);
  satPeriod = new Array(allDebris.length);
  for (let i = 0; i < allDebris.length; i++) {
    const no = allDebris[i].rec && (allDebris[i].rec.no_kozai ?? allDebris[i].rec.no);
    satPeriod[i] = (Number.isFinite(no) && no > 0) ? (2 * Math.PI) / no : null;
  }

  buildSourcePanel();
  bindSliders();
  setStatus(`Catalogue: ${allDebris.length.toLocaleString()} fragments (${dataSource}). Propagating…`);
  startPropagationTick();
  setInterval(startPropagationTick, REFRESH_MS);
}

boot();
