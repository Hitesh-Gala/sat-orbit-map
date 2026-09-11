// Sat-Stats on Steroids — one table of every catalogued object on orbit.
//
// Sources, merged by NORAD number:
//   • CelesTrak   — the active-payload TLE set via tle-loader's fetchTLEs()
//                   (live gp.php → 6 h localStorage cache → bundled data/active.tle).
//   • Space-Track — every on-orbit object, from the daily server-side pull
//                   (scripts/fetch_spacetrack.py): data/spacetrack-gp.json
//                   (payloads) + data/spacetrack-other.json (rocket bodies,
//                   debris, unknown).
// When both carry an object the fresher element set wins (a tie goes to
// CelesTrak) and the other copy is dropped.  Descriptive fields (type,
// country, launch site/date, ops status) come from Space-Track whichever
// TLE wins.  Hovering (or tapping) a name shows that row's TLE.

const { fetchTLEs } = window.Argos;

const PAGE_SIZE = 50;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TYPES  = { P: 'Payload', R: 'Rocket body', D: 'Debris', U: 'Unknown' };
const SRC    = { CT: 'CelesTrak', ST: 'Space-Track' };

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function setStatus(msg, isErr) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
}

// =========================================================================
// Country + launch-site maps — Sat-Stats' tables (sat-stats.js), plus the
// codes Space-Track spells differently from CelesTrak's SATCAT.
// =========================================================================

const COUNTRY = {
  AB:   { name: 'Saudi Arabia (Arabsat)',  iso2: 'sa' },
  ABS:  { name: 'Asia Broadcast Sat',      iso2: null },
  ALG:  { name: 'Algeria',                 iso2: 'dz' },
  ANG:  { name: 'Angola',                  iso2: 'ao' },
  ARGN: { name: 'Argentina',               iso2: 'ar' },
  ASRA: { name: 'Austria',                 iso2: 'at' },
  AUS:  { name: 'Australia',               iso2: 'au' },
  AZER: { name: 'Azerbaijan',              iso2: 'az' },
  BEL:  { name: 'Belgium',                 iso2: 'be' },
  BELA: { name: 'Belarus',                 iso2: 'by' },
  BERM: { name: 'Bermuda',                 iso2: 'bm' },
  BGD:  { name: 'Bangladesh',              iso2: 'bd' },
  BOL:  { name: 'Bolivia',                 iso2: 'bo' },
  BRAZ: { name: 'Brazil',                  iso2: 'br' },
  BUL:  { name: 'Bulgaria',                iso2: 'bg' },
  CA:   { name: 'Canada',                  iso2: 'ca' },
  CHBZ: { name: 'China / Brazil',          iso2: null },
  CHTU: { name: 'China / Turkey',          iso2: null },
  CIS:  { name: 'Russia (CIS)',            iso2: 'ru' },
  COL:  { name: 'Colombia',                iso2: 'co' },
  CRI:  { name: 'Costa Rica',              iso2: 'cr' },
  CYPR: { name: 'Cyprus',                  iso2: 'cy' },
  CZCH: { name: 'Czech Republic',          iso2: 'cz' },
  DEN:  { name: 'Denmark',                 iso2: 'dk' },
  DJBT: { name: 'Djibouti',                iso2: 'dj' },
  ECU:  { name: 'Ecuador',                 iso2: 'ec' },
  EGYP: { name: 'Egypt',                   iso2: 'eg' },
  ESA:  { name: 'ESA',                     iso2: 'eu' },
  ESRO: { name: 'ESA (legacy)',            iso2: 'eu' },
  EST:  { name: 'Estonia',                 iso2: 'ee' },
  ETH:  { name: 'Ethiopia',                iso2: 'et' },
  EUME: { name: 'EUMETSAT',                iso2: 'eu' },
  EUTE: { name: 'Eutelsat',                iso2: 'fr' },
  FGER: { name: 'France / Germany',        iso2: null },
  FIN:  { name: 'Finland',                 iso2: 'fi' },
  FR:   { name: 'France',                  iso2: 'fr' },
  FRIT: { name: 'France / Italy',          iso2: null },
  GER:  { name: 'Germany',                 iso2: 'de' },
  GHA:  { name: 'Ghana',                   iso2: 'gh' },
  GLOB: { name: 'Globalstar',              iso2: 'us' },
  GREC: { name: 'Greece',                  iso2: 'gr' },
  GUAT: { name: 'Guatemala',               iso2: 'gt' },
  HUN:  { name: 'Hungary',                 iso2: 'hu' },
  IM:   { name: 'Inmarsat',                iso2: 'gb' },
  IND:  { name: 'India',                   iso2: 'in' },
  INDO: { name: 'Indonesia',               iso2: 'id' },
  IRAN: { name: 'Iran',                    iso2: 'ir' },
  IRAQ: { name: 'Iraq',                    iso2: 'iq' },
  IRID: { name: 'Iridium',                 iso2: 'us' },
  ISRA: { name: 'Israel',                  iso2: 'il' },
  ISS:  { name: 'ISS (multinational)',     iso2: null },
  ITAL: { name: 'Italy',                   iso2: 'it' },
  ITSO: { name: 'Intelsat',                iso2: 'us' },
  JPN:  { name: 'Japan',                   iso2: 'jp' },
  KAZ:  { name: 'Kazakhstan',              iso2: 'kz' },
  KEN:  { name: 'Kenya',                   iso2: 'ke' },
  LAOS: { name: 'Laos',                    iso2: 'la' },
  LKA:  { name: 'Sri Lanka',               iso2: 'lk' },
  LTU:  { name: 'Lithuania',               iso2: 'lt' },
  LUXE: { name: 'Luxembourg',              iso2: 'lu' },
  MA:   { name: 'Multinational',           iso2: null },
  MALA: { name: 'Malaysia',                iso2: 'my' },
  MEX:  { name: 'Mexico',                  iso2: 'mx' },
  MNG:  { name: 'Mongolia',                iso2: 'mn' },
  MUS:  { name: 'Mauritius',               iso2: 'mu' },
  NATO: { name: 'NATO',                    iso2: null },
  NETH: { name: 'Netherlands',             iso2: 'nl' },
  NICO: { name: 'Nicaragua',               iso2: 'ni' },
  NIG:  { name: 'Nigeria',                 iso2: 'ng' },
  NKOR: { name: 'North Korea',             iso2: 'kp' },
  NOR:  { name: 'Norway',                  iso2: 'no' },
  NPAL: { name: 'Nepal',                   iso2: 'np' },
  NZ:   { name: 'New Zealand',             iso2: 'nz' },
  O3B:  { name: 'O3b Networks',            iso2: 'lu' },
  ORB:  { name: 'Orbcomm',                 iso2: 'us' },
  PAKI: { name: 'Pakistan',                iso2: 'pk' },
  PERU: { name: 'Peru',                    iso2: 'pe' },
  POL:  { name: 'Poland',                  iso2: 'pl' },
  POR:  { name: 'Portugal',                iso2: 'pt' },
  PRC:  { name: 'China (PRC)',             iso2: 'cn' },
  PRES: { name: 'PRC / ESA',               iso2: null },
  PRY:  { name: 'Paraguay',                iso2: 'py' },
  QAT:  { name: 'Qatar',                   iso2: 'qa' },
  RASC: { name: 'Rascom',                  iso2: null },
  ROC:  { name: 'Taiwan',                  iso2: 'tw' },
  ROM:  { name: 'Romania',                 iso2: 'ro' },
  RP:   { name: 'Philippines',             iso2: 'ph' },
  RWA:  { name: 'Rwanda',                  iso2: 'rw' },
  SAFR: { name: 'South Africa',            iso2: 'za' },
  SAUD: { name: 'Saudi Arabia',            iso2: 'sa' },
  SDN:  { name: 'Sudan',                   iso2: 'sd' },
  SEAL: { name: 'Sea Launch',              iso2: null },
  SES:  { name: 'SES (Luxembourg)',        iso2: 'lu' },
  SING: { name: 'Singapore',               iso2: 'sg' },
  SKOR: { name: 'South Korea',             iso2: 'kr' },
  SPN:  { name: 'Spain',                   iso2: 'es' },
  STCT: { name: 'Singapore / Taiwan',      iso2: null },
  SUDA: { name: 'Sudan',                   iso2: 'sd' },
  SVN:  { name: 'Slovenia',                iso2: 'si' },
  SWED: { name: 'Sweden',                  iso2: 'se' },
  SWTZ: { name: 'Switzerland',             iso2: 'ch' },
  TBD:  { name: 'To be determined',        iso2: null },
  THAI: { name: 'Thailand',                iso2: 'th' },
  TMMC: { name: 'Tonga',                   iso2: 'to' },
  TUN:  { name: 'Tunisia',                 iso2: 'tn' },
  TURK: { name: 'Turkey',                  iso2: 'tr' },
  UAE:  { name: 'United Arab Emirates',    iso2: 'ae' },
  UK:   { name: 'United Kingdom',          iso2: 'gb' },
  UKR:  { name: 'Ukraine',                 iso2: 'ua' },
  URY:  { name: 'Uruguay',                 iso2: 'uy' },
  US:   { name: 'United States',           iso2: 'us' },
  USBZ: { name: 'US / Brazil',             iso2: null },
  VENZ: { name: 'Venezuela',               iso2: 've' },
  VTNM: { name: 'Vietnam',                 iso2: 'vn' },
  ZWE:  { name: 'Zimbabwe',                iso2: 'zw' },
  // Space-Track spellings
  AC:   { name: 'AsiaSat (Hong Kong)',     iso2: 'hk' },
  AGO:  { name: 'Angola',                  iso2: 'ao' },
  BGR:  { name: 'Bulgaria',                iso2: 'bg' },
  BHR:  { name: 'Bahrain',                 iso2: 'bh' },
  BWA:  { name: 'Botswana',                iso2: 'bw' },
  CHLE: { name: 'Chile',                   iso2: 'cl' },
  CZE:  { name: 'Czech Republic',          iso2: 'cz' },
  DJI:  { name: 'Djibouti',                iso2: 'dj' },
  HRV:  { name: 'Croatia',                 iso2: 'hr' },
  IT:   { name: 'Italy',                   iso2: 'it' },
  JOR:  { name: 'Jordan',                  iso2: 'jo' },
  KWT:  { name: 'Kuwait',                  iso2: 'kw' },
  PER:  { name: 'Peru',                    iso2: 'pe' },
  SLB:  { name: 'Solomon Islands',         iso2: 'sb' },
  SVK:  { name: 'Slovakia',                iso2: 'sk' },
  TWN:  { name: 'Taiwan',                  iso2: 'tw' },
};

const LAUNCH_SITE = {
  AFETR:  { name: 'Cape Canaveral, USA',          owner: 'US'   },
  AFWTR:  { name: 'Vandenberg, USA',              owner: 'US'   },
  CAS:    { name: 'Canary Islands, Spain',        owner: 'SPN'  },
  ERAS:   { name: 'Eastern Range (sea launch)',   owner: 'US'   },
  FRGUI:  { name: 'Kourou, French Guiana',        owner: 'FR'   },
  HGSTR:  { name: 'Hammaguir, Algeria',           owner: 'FR'   },
  JSC:    { name: 'Jiuquan, China',               owner: 'PRC'  },
  KSCUT:  { name: 'Uchinoura, Japan',             owner: 'JPN'  },
  KWAJ:   { name: 'Kwajalein Atoll',              owner: 'US'   },
  KYMTR:  { name: 'Kapustin Yar, Russia',         owner: 'CIS'  },
  NSC:    { name: 'Naro, South Korea',            owner: 'SKOR' },
  PKMTR:  { name: 'Plesetsk, Russia',             owner: 'CIS'  },
  PLMSC:  { name: 'Plesetsk MSC, Russia',         owner: 'CIS'  },
  RLLC:   { name: 'Rocket Lab Mahia, NZ',         owner: 'NZ'   },
  SADOL:  { name: 'Yasny / Dombarovsky, Russia',  owner: 'CIS'  },
  SEAL:   { name: 'Sea Launch (international)',   owner: 'SEAL' },
  SEMLS:  { name: 'Semnan, Iran',                 owner: 'IRAN' },
  SHIYANG:{ name: 'Sea launch (China)',           owner: 'PRC'  },
  SNMLP:  { name: 'Semnan, Iran',                 owner: 'IRAN' },
  SRILR:  { name: 'Sriharikota, India',           owner: 'IND'  },
  SUBL:   { name: 'Submarine, Barents Sea',       owner: 'CIS'  },
  SVOB:   { name: 'Svobodny, Russia',             owner: 'CIS'  },
  TAISC:  { name: 'Taiyuan, China',               owner: 'PRC'  },
  TANSC:  { name: 'Tanegashima, Japan',           owner: 'JPN'  },
  TSC:    { name: 'Taiyuan, China',               owner: 'PRC'  },
  TYMSC:  { name: 'Baikonur, Kazakhstan',         owner: 'KAZ'  },
  VOST:   { name: 'Vostochny, Russia',            owner: 'CIS'  },
  WLPIS:  { name: 'Wallops Island, USA',          owner: 'US'   },
  WOMRA:  { name: 'Woomera, Australia',           owner: 'AUS'  },
  WRAS:   { name: 'Western Range (sea launch)',   owner: 'US'   },
  WSC:    { name: 'Wenchang, China',              owner: 'PRC'  },
  XICLF:  { name: 'Xichang, China',               owner: 'PRC'  },
  XSC:    { name: 'Xichang, China',               owner: 'PRC'  },
  YAVNE:  { name: 'Palmachim, Israel',            owner: 'ISRA' },
  YUN:    { name: 'Yunsong-ri, North Korea',      owner: 'NKOR' },
  // Space-Track spellings
  ANSP:   { name: 'Andøya, Norway',               owner: 'NOR'  },
  JJSLA:  { name: 'Jeju sea launch area, S. Korea', owner: 'SKOR' },
  KODAK:  { name: 'Kodiak, USA',                  owner: 'US'   },
  KWAJL:  { name: 'Kwajalein Atoll',              owner: 'US'   },
  OREN:   { name: 'Yasny (Orenburg), Russia',     owner: 'CIS'  },
  SCSLA:  { name: 'South China Sea launch area',  owner: 'PRC'  },
  SEM:    { name: 'Semnan, Iran',                 owner: 'IRAN' },
  SMTS:   { name: 'Shahrud, Iran',                owner: 'IRAN' },
  SRI:    { name: 'Sriharikota, India',           owner: 'IND'  },
  TNSTA:  { name: 'Tanegashima, Japan',           owner: 'JPN'  },
  TTMTR:  { name: 'Baikonur, Kazakhstan',         owner: 'KAZ'  },
  VOSTO:  { name: 'Vostochny, Russia',            owner: 'CIS'  },
  YSLA:   { name: 'Yellow Sea launch area',       owner: 'PRC'  },
};

function flagImg(country) {
  if (!country || !country.iso2) return '<span class="flag-glyph" title="multinational / unknown">🌐</span>';
  return `<img class="flag" src="https://flagcdn.com/24x18/${country.iso2}.png" alt="" loading="lazy">`;
}

function countryCell(code) {
  const c = COUNTRY[code];
  if (!c) return `<span class="flag-glyph" title="unknown">🌐</span><span class="ctry-name muted">${esc(code) || '—'}</span>`;
  return `${flagImg(c)}<span class="ctry-name">${esc(c.name)}</span>`;
}

function launchCountryCell(siteCode) {
  const site = LAUNCH_SITE[siteCode];
  if (!site) {
    return `<span class="flag-glyph" title="unknown">🌐</span><span class="ctry-name muted">
      <span class="ctry-main">—</span>${siteCode ? `<span class="site-name">${esc(siteCode)}</span>` : ''}</span>`;
  }
  const c = COUNTRY[site.owner];
  return `${flagImg(c)}<span class="ctry-name">
    <span class="ctry-main">${esc(c ? c.name : site.owner)}</span>
    <span class="site-name">${esc(site.name)}</span></span>`;
}

// =========================================================================
// TLE fields
// =========================================================================

// Epoch (line 1, cols 19-32: YYDDD.DDDDDDDD) → ms since 1970 UTC.
function tleEpochMs(l1) {
  const yy = +l1.slice(18, 20), doy = parseFloat(l1.slice(20, 32));
  if (!Number.isFinite(yy) || !Number.isFinite(doy)) return NaN;
  return Date.UTC(yy < 57 ? 2000 + yy : 1900 + yy, 0, 1) + (doy - 1) * 86400000;
}

// Alpha-5: catalogue numbers ≥ 100,000 put a letter in line-1 col 3.
const isAlpha5 = l1 => /[A-Z]/.test(l1.charAt(2));

// International designator from line 1, cols 10-17: "98067A" → "1998-067A".
function intlId(l1) {
  const m = l1.slice(9, 17).trim().match(/^(\d{2})(\d{3})([A-Z]{1,3})$/);
  return m ? `${+m[1] < 57 ? 20 : 19}${m[1]}-${m[2]}${m[3]}` : '';
}

const pad2 = n => String(n).padStart(2, '0');
const fmtDay = d => `${pad2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

function fmtEpoch(ms) {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  return `${fmtDay(d)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function fmtLaunch(ld) {
  const d = ld ? new Date(`${ld}T00:00:00Z`) : null;
  return d && !isNaN(d) ? fmtDay(d) : '—';
}

function ageDays(ms) { return (Date.now() - ms) / 86400000; }

function ageClass(ms) {
  const d = ageDays(ms);
  if (!(d <= 30)) return 'stale';
  return d <= 3 ? 'fresh' : 'aging';
}

function ageText(ms) {
  const d = ageDays(ms);
  if (!Number.isFinite(d)) return '';
  if (d < 0) return `epoch ${d > -1 ? `${Math.round(-d * 24)} h` : `${Math.round(-d)} d`} ahead`;   // Space-Track publishes some predictive (future-epoch) TLEs
  return d < 1 ? `${Math.round(d * 24)} h old` : `${Math.round(d)} d old`;
}

// Ops status (payloads only): CelesTrak's OPS_STATUS_CODE, carried in the
// Space-Track payload bundle; CelesTrak-only rows come from its active set.
function statusCell(r) {
  if (r.type !== 'P') return '<span class="muted">—</span>';
  if (r.ops && '+PBSX'.includes(r.ops)) return '<span class="badge b-active">ACTIVE</span>';
  if (r.ops === '-') return '<span class="badge b-inactive">INACTIVE</span>';
  return '<span class="badge b-unknown">UNKNOWN</span>';
}

// =========================================================================
// Load + merge
// =========================================================================

let ALL = [], filtered = [];
const state = { q: '', type: '', owner: '', launch: '', src: '', fmt: '', sort: 'name', dir: 1, page: 0 };

async function fetchJSON(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

function stRow(s, type) {
  return { norad: s.c, name: s.n, l1: s.t[0], l2: s.t[1], epoch: tleEpochMs(s.t[0]), src: 'ST', type,
           owner: s.o || '', site: s.ls === 'NULL' ? '' : s.ls || '',   // Space-Track writes a literal NULL for unrecorded sites
           ld: s.ld || '', ops: s.s || '' };
}

async function load() {
  const [ct, pay, rest] = await Promise.all([
    fetchTLEs().catch(() => ({ tles: [], source: 'unavailable' })),
    fetchJSON('data/spacetrack-gp.json'),
    fetchJSON('data/spacetrack-other.json'),
  ]);

  const byId = new Map();
  for (const s of pay?.sats || []) if (s.t?.length === 2) byId.set(s.c, stRow(s, 'P'));
  for (const s of rest?.sats || []) if (s.t?.length === 2 && !byId.has(s.c)) byId.set(s.c, stRow(s, s.y || 'U'));
  const nST = byId.size;

  // One row per object: where Space-Track has it too, keep the fresher TLE.
  const seenCT = new Set();
  let dup = 0;
  for (const t of ct.tles || []) {
    if (!Number.isFinite(t.noradId) || seenCT.has(t.noradId)) continue;
    seenCT.add(t.noradId);
    const epoch = tleEpochMs(t.l1), cur = byId.get(t.noradId);
    if (!cur) {
      // CelesTrak's active group = operating payloads.
      byId.set(t.noradId, { norad: t.noradId, name: t.name, l1: t.l1, l2: t.l2, epoch, src: 'CT',
                            type: 'P', owner: '', site: '', ld: '', ops: '+' });
      continue;
    }
    dup++;
    if (epoch >= cur.epoch) Object.assign(cur, { name: t.name, l1: t.l1, l2: t.l2, epoch, src: 'CT' });
  }

  ALL = [...byId.values()];
  for (const r of ALL) {
    const site = LAUNCH_SITE[r.site];
    r.intl = intlId(r.l1);
    r.alpha = isAlpha5(r.l1);
    r.launchOwner = site?.owner || '';
    r.hay = (`${r.name} ${r.norad} ${r.intl} ${r.l1.slice(2, 7)} ${r.owner} ${COUNTRY[r.owner]?.name || ''} ` +
             `${COUNTRY[r.launchOwner]?.name || ''} ${site?.name || r.site} ${TYPES[r.type]}`).toLowerCase();
  }
  return { ct, pay, rest, nST, nCT: seenCT.size, dup };
}

// =========================================================================
// Filter, sort, render
// =========================================================================

const coll = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const SORTS = {
  name:  (a, b) => coll.compare(a.name, b.name),
  norad: (a, b) => a.norad - b.norad,
  intl:  (a, b) => coll.compare(a.intl || '~', b.intl || '~'),
  ld:    (a, b) => (a.ld || '9999').localeCompare(b.ld || '9999'),
  epoch: (a, b) => (a.epoch || 0) - (b.epoch || 0),
};

function sortAll() {
  const f = SORTS[state.sort];
  ALL.sort((a, b) => state.dir * f(a, b) || a.norad - b.norad);
}

function applyFilters() {
  const { q, type, owner, launch, src, fmt } = state;
  filtered = ALL.filter(r =>
    (!type || r.type === type) && (!owner || r.owner === owner) && (!launch || r.launchOwner === launch) &&
    (!src || r.src === src) && (!fmt || r.alpha === (fmt === 'A')) && (!q || r.hay.includes(q)));
  state.page = 0;
  render();
}

function render() {
  const total = filtered.length, pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  state.page = Math.max(0, Math.min(state.page, pages - 1));
  const start = state.page * PAGE_SIZE, slice = filtered.slice(start, start + PAGE_SIZE);

  $('rows').innerHTML = slice.map((r, i) => `
    <tr>
      <td class="col-name" data-i="${start + i}">${esc(r.name) || '<span class="muted">(unnamed)</span>'}</td>
      <td class="num muted">${r.norad}</td>
      <td class="muted nowrap">${esc(r.intl) || '—'}</td>
      <td><span class="chip t-${r.type}">${TYPES[r.type] || 'Unknown'}</span></td>
      <td class="col-country">${countryCell(r.owner)}</td>
      <td class="col-country">${launchCountryCell(r.site)}</td>
      <td class="muted nowrap">${fmtLaunch(r.ld)}</td>
      <td>${statusCell(r)}</td>
      <td><span class="chip ${r.src === 'CT' ? 'ct' : 'st'}">${SRC[r.src]}</span></td>
      <td class="nowrap ep ${ageClass(r.epoch)}" title="${ageText(r.epoch)}">${fmtEpoch(r.epoch)}</td>
      <td><span class="chip ${r.alpha ? 'alpha' : 'old'}">${r.alpha ? 'Alpha-5' : 'Old 5-digit'}</span></td>
    </tr>`).join('') || '<tr><td colspan="11" class="empty">No matching objects.</td></tr>';

  $('n-match').textContent = total.toLocaleString();
  $('n-range').textContent = total ? `${(start + 1).toLocaleString()}–${(start + slice.length).toLocaleString()}` : '0';
  $('page-cur').textContent = (state.page + 1).toLocaleString();
  $('page-tot').textContent = pages.toLocaleString();
  for (const th of document.querySelectorAll('th.sortable')) {
    th.dataset.dir = th.dataset.sort === state.sort ? (state.dir > 0 ? 'asc' : 'desc') : '';
  }
  $('tle-tip').hidden = true;
}

function fillSelect(id, label, codes) {
  const nameOf = c => COUNTRY[c]?.name || c;
  const sorted = [...codes].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  $(id).innerHTML = `<option value="">${label} · All</option>` +
    sorted.map(c => `<option value="${esc(c)}">${esc(nameOf(c))}</option>`).join('');
}

// =========================================================================
// Floating TLE window — follows the pointer over a name; tap on touch.
// =========================================================================

function wireTip() {
  const tip = $('tle-tip'), rows = $('rows');
  let cur = null;

  function place(x, y) {
    const pad = 16, w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x + pad, top = y + pad;
    if (left + w > innerWidth - 8) left = x - w - pad;
    if (top + h > innerHeight - 8) top = y - h - pad;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  function show(td, x, y) {
    const r = filtered[+td.dataset.i];
    if (!r) return;
    cur = td;
    const ep = Number.isFinite(r.epoch) ? new Date(r.epoch).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—';
    tip.innerHTML = `
      <div class="tt-head"><b>${esc(r.name)}</b><span class="chip ${r.src === 'CT' ? 'ct' : 'st'}">${SRC[r.src]}</span></div>
      <pre>${esc(r.name)}\n${esc(r.l1)}\n${esc(r.l2)}</pre>
      <div class="tt-meta">Epoch ${ep} · ${ageText(r.epoch)} · ${r.alpha
        ? `Alpha-5: “${esc(r.l1.slice(2, 7))}” = catalogue #${r.norad}` : 'Old 5-digit catalogue number'}</div>`;
    tip.hidden = false;
    place(x, y);
  }
  const hide = () => { cur = null; tip.hidden = true; };

  rows.addEventListener('mouseover', e => {
    const td = e.target.closest('td.col-name');
    if (td && td !== cur) show(td, e.clientX, e.clientY);
  });
  rows.addEventListener('mousemove', e => { if (cur) place(e.clientX, e.clientY); });
  rows.addEventListener('mouseout', e => { if (cur && !cur.contains(e.relatedTarget)) hide(); });
  rows.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    const td = e.target.closest('td.col-name');
    if (!td || td === cur) hide(); else show(td, e.clientX, e.clientY);
  });
  $('tbl-wrap').addEventListener('scroll', hide, { passive: true });
}

function wireControls() {
  let t = null;
  $('q').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = $('q').value.trim().toLowerCase(); applyFilters(); }, 150);
  });
  for (const [id, key] of [['f-type', 'type'], ['f-owner', 'owner'], ['f-launch', 'launch'], ['f-src', 'src'], ['f-fmt', 'fmt']]) {
    $(id).addEventListener('change', () => { state[key] = $(id).value; applyFilters(); });
  }
  for (const th of document.querySelectorAll('th.sortable')) {
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      state.dir = state.sort === k ? -state.dir : 1;
      state.sort = k;
      sortAll();
      applyFilters();
    });
  }
  const go = p => { state.page = p; render(); $('tbl-wrap').scrollTop = 0; };
  $('pg-first').addEventListener('click', () => go(0));
  $('pg-prev').addEventListener('click', () => go(state.page - 1));
  $('pg-next').addEventListener('click', () => go(state.page + 1));
  $('pg-last').addEventListener('click', () => go(Infinity));
}

function fmtStamp(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? `${fmtDay(d)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC` : '—';
}

(async function main() {
  wireControls();
  wireTip();
  setStatus('Loading ~35,000 TLEs from CelesTrak and Space-Track…');
  try {
    const info = await load();
    sortAll();
    fillSelect('f-owner', 'Country of Origin', new Set(ALL.map(r => r.owner).filter(Boolean)));
    fillSelect('f-launch', 'Launch Country', new Set(ALL.map(r => r.launchOwner).filter(Boolean)));
    applyFilters();

    $('n-all').textContent = ALL.length.toLocaleString();
    $('n-ct').textContent  = info.nCT.toLocaleString();
    $('n-st').textContent  = info.nST.toLocaleString();
    $('n-dup').textContent = info.dup.toLocaleString();
    const ctTag = { celestrak: 'live', cache: 'cached (≤ 6 h)', bundled: 'bundled snapshot' }[info.ct.source] || 'unavailable';
    $('stamps').innerHTML =
      `<span><i class="dot st"></i>Space-Track · data as of <b>${fmtStamp(info.pay?.retrieved)}</b>` +
      `${info.rest ? '' : ' <em>(payloads only — rocket bodies &amp; debris arrive with the next daily pull)</em>'}</span>` +
      `<span><i class="dot ct"></i>CelesTrak · <b>${ctTag}</b></span>`;
    setStatus('');
  } catch (e) {
    console.error(e);
    setStatus(`Could not load the catalogues: ${e.message}`, true);
  }
})();
