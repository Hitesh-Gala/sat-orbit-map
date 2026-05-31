// Sat-Stats — cumulative catalogue of every satellite NAZAR has ever seen,
// plus a graphs view that summarises the database in five charts.
//
// Data flow on boot:
//   1. fetchTLEs()       — live (or cached / bundled) TLE catalogue.
//   2. fetchActiveSatcat() — full SATCAT metadata for the active GROUP.
//   3. Merge into the localStorage-backed cumulative DB (key: argos.satstats.db).
//      Sats that drop out of the active feed (decayed, etc.) stay in the DB
//      forever — that's the whole point of "cumulative".
//   4. Render table (paginated, searchable) and the five Chart.js graphs.
//   5. Lazy-fetch Wikipedia summaries per satellite series for thumbnails.

const { fetchTLEs } = window.Argos;

const DB_KEY        = 'argos.satstats.db';      // cumulative store
const SATCAT_KEY    = 'argos.satcat.active';    // SATCAT cache
const SATCAT_TTL_MS = 24 * 3600 * 1000;
const WIKI_KEY_PREF = 'argos.wiki.';            // per-series Wikipedia cache

const PAGE_SIZE = 50;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function setStatus(msg, isErr) {
  $('stats-status').textContent = msg;
  $('stats-status').className = isErr ? 'err' : '';
}

// =========================================================================
// Country code → name + flag (ISO-2)
// =========================================================================
//
// CelesTrak SATCAT OWNER uses a mix of ISO 3-letter codes, 2-letter codes,
// and CelesTrak-private codes (e.g. PRC, CIS, ITSO, IRID).  This map covers
// the codes that appear in the active catalogue and falls back to "Unknown"
// otherwise.  iso2 → flagcdn.com PNG; null iso2 → globe glyph for
// multinational orgs.

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
};

// CelesTrak launch-site code → operating country (for the "Launch Country"
// column).  Codes lifted from the SATCAT site index.  Sites operated by
// commercial multinationals (Sea Launch, Wallops air-launches) point to
// the host country of the physical pad — Sea Launch is the exception
// (international waters) and falls back to the multinational placeholder.

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
};

function flagImg(country) {
  if (!country || !country.iso2) {
    // Multinational org / unknown — show a globe glyph rather than a
    // misleading national flag.
    return '<span class="flag-glyph" title="multinational / unknown">🌐</span>';
  }
  return `<img class="flag" src="https://flagcdn.com/24x18/${country.iso2}.png" alt="" loading="lazy">`;
}

function countryCell(code) {
  const c = COUNTRY[code];
  if (!c) {
    return `<span class="flag-glyph" title="unknown">🌐</span><span class="ctry-name muted">${esc(code) || '—'}</span>`;
  }
  return `${flagImg(c)}<span class="ctry-name">${esc(c.name)}</span>`;
}

function launchCountryCell(siteCode) {
  if (!siteCode) {
    return `<span class="flag-glyph" title="unknown">🌐</span><span class="ctry-name muted">—</span>`;
  }
  const site = LAUNCH_SITE[siteCode];
  if (!site) {
    return `<span class="flag-glyph" title="unknown">🌐</span><span class="ctry-name muted">${esc(siteCode)}</span>`;
  }
  const c = COUNTRY[site.owner];
  return `${flagImg(c)}<span class="ctry-name" title="${esc(site.name)}">${esc(c ? c.name : site.owner)}</span>`;
}

// =========================================================================
// Series → Wikipedia article mapping
// =========================================================================
//
// First-match-wins regex list.  When a SAT name matches one of these
// patterns, we look up that Wikipedia article via the REST API to grab a
// thumbnail.  Sats with no series match get the placeholder card.

const SERIES = [
  [/^STARLINK/i,                          'Starlink'],
  [/^ONEWEB/i,                            'OneWeb_satellite_constellation'],
  [/^IRIDIUM/i,                           'Iridium_satellite_constellation'],
  [/^GLOBALSTAR/i,                        'Globalstar'],
  [/^ORBCOMM/i,                           'Orbcomm'],
  [/^ISS|ZARYA|UNITY|DESTINY|COLUMBUS/i,  'International_Space_Station'],
  [/^TIANGONG|TIANHE|WENTIAN|MENGTIAN|CSS \(/i, 'Tiangong_space_station'],
  [/^SHENZHOU/i,                          'Shenzhou_(spacecraft)'],
  [/^TIANZHOU/i,                          'Tianzhou_(spacecraft)'],
  [/^CREW DRAGON|DRAGON/i,                'SpaceX_Dragon_2'],
  [/^CYGNUS NG/i,                         'Cygnus_(spacecraft)'],
  [/^HUBBLE|^HST/i,                       'Hubble_Space_Telescope'],
  [/^JWST|JAMES WEBB/i,                   'James_Webb_Space_Telescope'],
  [/^GPS|NAVSTAR/i,                       'Global_Positioning_System'],
  [/^BEIDOU/i,                            'BeiDou'],
  [/^GALILEO/i,                           'Galileo_(satellite_navigation)'],
  [/^GLONASS|COSMOS 25\d\d/i,             'GLONASS'],
  [/^IRNSS|NAVIC/i,                       'NavIC'],
  [/^QZS|MICHIBIKI/i,                     'Quasi-Zenith_Satellite_System'],
  [/^LANDSAT/i,                           'Landsat_program'],
  [/^TERRA \(EOS|^AQUA \(EOS|^AURA \(EOS/i, 'Earth_Observing_System'],
  [/^SENTINEL/i,                          'Copernicus_Programme'],
  [/^METOP/i,                             'MetOp'],
  [/^GOES/i,                              'Geostationary_Operational_Environmental_Satellite'],
  [/^NOAA \d/i,                           'NOAA_satellite'],
  [/^METEOR/i,                            'Meteor_(satellite)'],
  [/^FENGYUN|^FY-/i,                      'Fengyun'],
  [/^GAOFEN/i,                            'Gaofen'],
  [/^YAOGAN/i,                            'Yaogan'],
  [/^HAIYANG|^HY-/i,                      'Haiyang'],
  [/^TIANLIAN/i,                          'Tianlian'],
  [/^SHIJIAN|^SJ-/i,                      'Shijian_(satellite)'],
  [/^ZIYUAN|^ZY-/i,                       'Ziyuan'],
  [/^CHINASAT|^ZHONGXING|^ZX-/i,          'ChinaSat'],
  [/^APSTAR/i,                            'APSTAR'],
  [/^TJS|^TJSW/i,                         'Tongxin_Jishu_Shiyan'],
  [/^CARTOSAT/i,                          'Cartosat'],
  [/^RISAT/i,                             'RISAT'],
  [/^GSAT/i,                              'GSAT'],
  [/^INSAT/i,                             'INSAT'],
  [/^IRS-/i,                              'Indian_Remote_Sensing_satellites'],
  [/^EOS-/i,                              'EOS-04'],
  [/^OCEANSAT/i,                          'Oceansat'],
  [/^DIRECTV/i,                           'DirecTV'],
  [/^DISH/i,                              'Dish_Network'],
  [/^INTELSAT/i,                          'Intelsat'],
  [/^EUTELSAT/i,                          'Eutelsat'],
  [/^INMARSAT/i,                          'Inmarsat'],
  [/^SES /i,                              'SES_(company)'],
  [/^O3B/i,                               'O3b_Networks'],
  [/^TDRS/i,                              'Tracking_and_Data_Relay_Satellite'],
  [/^MOLNIYA/i,                           'Molniya_(satellite)'],
  [/^MERIDIAN/i,                          'Meridian_(satellite)'],
  [/^KOSMOS|^COSMOS/i,                    'Kosmos_(satellite)'],
  [/^PROGRESS/i,                          'Progress_(spacecraft)'],
  [/^FALCON 9 R\/B|^STARSHIP/i,           'SpaceX_Falcon_9'],
  [/^PSLV R\/B|^GSLV R\/B/i,              'Polar_Satellite_Launch_Vehicle'],
  [/^CZ-\d|^LONG MARCH/i,                 'Long_March_(rocket_family)'],
  [/^H-2A|^H-IIA|^H-IIB/i,                'H-IIA'],
  [/^ARIANE/i,                            'Ariane_(rocket_family)'],
  [/^SOYUZ/i,                             'Soyuz_(rocket_family)'],
  [/^PROTON/i,                            'Proton_(rocket_family)'],
  [/^LEMUR/i,                             'Lemur-2'],
  [/^FLOCK/i,                             'Planet_Labs'],
  [/^SUPERDOVE/i,                         'Planet_Labs'],
  [/^DOVE /i,                             'Planet_Labs'],
  [/^SKYSAT/i,                            'SkySat'],
  [/^BLACKSKY/i,                          'BlackSky_Global'],
  [/^CAPELLA/i,                           'Capella_Space'],
  [/^ICEYE/i,                             'ICEYE'],
  [/^SPIRE/i,                             'Spire_Global'],
  [/^HAWKEYE/i,                           'HawkEye_360'],
  [/^GAO LIN|^LING/i,                     'Linggao-1'],
  [/^CHANG/i,                             "Chang%27e_program"],
  [/^GEO-KOMPSAT|^KOMPSAT/i,              'Korea_Multi-Purpose_Satellite'],
  [/^AMOS/i,                              'Amos_(satellite)'],
  [/^MEASAT/i,                            'MEASAT'],
  [/^THAICOM/i,                           'Thaicom'],
  [/^TURKSAT/i,                           'Türksat_(satellite)'],
  [/^HISPASAT/i,                          'Hispasat'],
  [/^ASTRA/i,                             'Astra_(satellite)'],
  [/^HOTBIRD/i,                           'Hot_Bird'],
  [/^ECHOSTAR/i,                          'EchoStar'],
];

function seriesFor(name) {
  for (const [re, page] of SERIES) if (re.test(name)) return page;
  return null;
}

// =========================================================================
// Wikipedia thumbnail lookup
// =========================================================================
//
// First sight of a series → fetch the REST summary, stash the thumbnail
// URL and article URL in localStorage so we never refetch.  Empty-result
// negative cache prevents repeated 404s for series with no Wikipedia page.

const wikiCache = new Map();     // series page → { thumb, page } or null

function getCachedWiki(page) {
  if (wikiCache.has(page)) return wikiCache.get(page);
  try {
    const raw = localStorage.getItem(WIKI_KEY_PREF + page);
    if (raw) {
      const v = JSON.parse(raw);
      wikiCache.set(page, v);
      return v;
    }
  } catch {}
  return undefined;
}
function setCachedWiki(page, v) {
  wikiCache.set(page, v);
  try { localStorage.setItem(WIKI_KEY_PREF + page, JSON.stringify(v)); } catch {}
}

async function fetchWikiThumb(page) {
  const cached = getCachedWiki(page);
  if (cached !== undefined) return cached;
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page)}`);
    if (!r.ok) { setCachedWiki(page, null); return null; }
    const j = await r.json();
    const out = {
      thumb: j.thumbnail?.source || null,
      page:  j.content_urls?.desktop?.page
          || `https://en.wikipedia.org/wiki/${encodeURIComponent(page)}`,
      title: j.title || page.replace(/_/g, ' '),
    };
    setCachedWiki(page, out);
    return out;
  } catch {
    setCachedWiki(page, null);
    return null;
  }
}

// After the table renders, asynchronously fetch thumbs for every visible
// row that has a series mapped but no cached thumb yet, then swap the
// placeholders for <img>.  Single-flight per page to avoid stampedes.
async function hydrateThumbs(rows) {
  const needed = new Set();
  for (const r of rows) {
    const s = seriesFor(r.name);
    if (s && getCachedWiki(s) === undefined) needed.add(s);
  }
  // Throttle: 4 fetches in flight.
  const queue = [...needed];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const s = queue.shift();
      await fetchWikiThumb(s);
    }
  });
  await Promise.all(workers);
  // Re-render the photo cells for the current page now that thumbs are in.
  for (const r of rows) {
    const s = seriesFor(r.name);
    if (!s) continue;
    const cell = document.querySelector(`td.col-photo[data-norad="${r.noradId}"]`);
    if (!cell) continue;
    cell.innerHTML = photoCellHtml(r);
  }
}

function photoCellHtml(r) {
  const s = seriesFor(r.name);
  if (!s) {
    return `<div class="photo-ph" title="No Wikipedia article mapped for this series">🛰</div>`;
  }
  const w = getCachedWiki(s);
  if (w === undefined) {
    return `<div class="photo-ph" title="Loading…">…</div>`;
  }
  if (w === null || !w.thumb) {
    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(s)}`;
    return `<a class="photo-link" href="${url}" target="_blank" rel="noopener" title="Open Wikipedia article">
              <div class="photo-ph">🛰</div>
            </a>`;
  }
  return `<a class="photo-link" href="${esc(w.page)}" target="_blank" rel="noopener"
             title="${esc(w.title)} — source: Wikipedia">
            <img class="photo-thumb" src="${esc(w.thumb)}" alt="" loading="lazy">
          </a>`;
}

// =========================================================================
// SATCAT fetch
// =========================================================================
//
// CelesTrak's satcat/records.php supports the same GROUP filter as gp.php.
// One call returns ~16 k JSON records — heavy but sufficient.  Cached 24 h
// in localStorage so we don't spam CelesTrak on every page load.

async function fetchActiveSatcat() {
  try {
    const raw = localStorage.getItem(SATCAT_KEY);
    if (raw) {
      const { t, v } = JSON.parse(raw);
      if (Date.now() - t < SATCAT_TTL_MS) return { records: v, source: 'cache' };
    }
  } catch {}

  try {
    const r = await fetch('https://celestrak.org/satcat/records.php?GROUP=active&FORMAT=json');
    if (r.ok) {
      const arr = await r.json();
      if (Array.isArray(arr) && arr.length) {
        // Trim to the columns we render / chart — saves ~70% of payload size
        // so it fits comfortably in localStorage.
        const trimmed = arr.map(x => ({
          n:  x.OBJECT_NAME,
          c:  parseInt(x.NORAD_CAT_ID, 10),
          i:  x.OBJECT_ID,
          o:  x.OWNER,
          ls: x.LAUNCH_SITE,
          ld: x.LAUNCH_DATE,
          dd: x.DECAY_DATE,
          p:  x.PERIOD,
          inc:x.INCLINATION,
          a:  x.APOGEE,
          pe: x.PERIGEE,
        }));
        try { localStorage.setItem(SATCAT_KEY, JSON.stringify({ t: Date.now(), v: trimmed })); }
        catch (e) { console.warn('SATCAT cache write failed (over quota?):', e.message); }
        return { records: trimmed, source: 'celestrak' };
      }
    }
    console.warn(`SATCAT fetch HTTP ${r.status}; using whatever's in the cumulative DB.`);
  } catch (e) {
    console.warn(`SATCAT fetch threw: ${e.message}; using whatever's in the cumulative DB.`);
  }
  return { records: [], source: 'failed' };
}

// =========================================================================
// Cumulative DB (localStorage)
// =========================================================================

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch { return {}; }
}
function saveDB(db) {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
  catch (e) {
    // If we blow past localStorage quota, drop satellites with no
    // SATCAT enrichment first (they carry the least info) and retry.
    console.warn('DB write failed (quota?):', e.message);
    const keys = Object.keys(db);
    for (let i = 0; i < keys.length && i < 500; i++) {
      const k = keys[i];
      if (!db[k].owner) delete db[k];
    }
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch {}
  }
}

// Merge live TLE + SATCAT into the cumulative DB.  Returns the merged DB
// and the count of NEW NORAD IDs added this session.
function mergeIntoDB(db, tles, satrec) {
  let added = 0;
  // SATCAT records first — gives us metadata for sats whose TLE we may
  // not have parsed (rare but possible).
  for (const r of satrec) {
    const id = r.c;
    if (!Number.isFinite(id)) continue;
    if (!db[id]) { db[id] = { norad: id }; added++; }
    Object.assign(db[id], {
      name:       r.n || db[id].name,
      intlId:     r.i || db[id].intlId,
      owner:      r.o || db[id].owner,
      launchSite: r.ls || db[id].launchSite,
      launchDate: r.ld || db[id].launchDate,
      decayDate:  r.dd || db[id].decayDate,
      period:     parseFloat(r.p)    || db[id].period,
      inclination:parseFloat(r.inc)  || db[id].inclination,
      apogee:     parseFloat(r.a)    || db[id].apogee,
      perigee:    parseFloat(r.pe)   || db[id].perigee,
      lastSeen:   Date.now(),
    });
  }
  // TLE records — fills in names + the int'l designator from line 1 cols
  // 10–17 for sats SATCAT didn't enrich.
  for (const t of tles) {
    const id = t.noradId;
    if (!Number.isFinite(id)) continue;
    if (!db[id]) { db[id] = { norad: id }; added++; }
    if (!db[id].name)   db[id].name   = t.name;
    if (!db[id].intlId) db[id].intlId = parseIntlIdFromTLE(t.l1);
    db[id].lastSeen = Date.now();
  }
  return added;
}

// International designator from TLE line 1 columns 10-17 (1-indexed).
// Format: YYNNNAAA where YY is the launch year (2-digit), NNN is the
// launch number of that year, and AAA is the piece designator.
function parseIntlIdFromTLE(l1) {
  if (!l1 || l1.length < 17) return '';
  const raw = l1.slice(9, 17).trim();
  if (!raw) return '';
  const yy = parseInt(raw.slice(0, 2), 10);
  const yyyy = yy < 57 ? 2000 + yy : 1900 + yy;
  return `${yyyy}-${raw.slice(2).trim()}`;
}

// =========================================================================
// Orbit-class & inclination helpers
// =========================================================================
//
// Use the SATCAT-published apogee + perigee when available (sat is in the
// cumulative DB) — they're authoritative and don't depend on a live TLE.
// Fall back to "unknown" otherwise.

function orbitClass(record) {
  const a = record.apogee, p = record.perigee;
  if (!Number.isFinite(a) || !Number.isFinite(p)) return null;
  const meanAlt = (a + p) / 2;
  // HEO heuristic: large apogee:perigee ratio = elliptical.
  if (a / Math.max(p, 1) > 4 && a > 5000) return 'HEO';
  if (meanAlt < 2000)  return 'LEO';
  if (meanAlt < 30000) return 'MEO';
  if (meanAlt < 42000) return 'GEO';
  return 'HEO';
}

// =========================================================================
// Render: table
// =========================================================================

let filteredRows = [];   // current filtered + sorted view of the DB
let currentPage = 0;

function rebuildFiltered(db) {
  const q = $('filter').value.trim().toLowerCase();
  const out = [];
  for (const id of Object.keys(db)) {
    const r = db[id];
    if (!r.name) continue;
    if (q) {
      const hay = `${r.name} ${r.norad} ${r.intlId || ''} ${r.owner || ''} ${COUNTRY[r.owner]?.name || ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push({
      name:       r.name,
      noradId:    r.norad,
      intlId:     r.intlId || '',
      owner:      r.owner || '',
      launchSite: r.launchSite || '',
      decayed:    !!r.decayDate,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  filteredRows = out;
  if (currentPage * PAGE_SIZE >= filteredRows.length) currentPage = 0;
}

function renderTable(db) {
  rebuildFiltered(db);
  const total = filteredRows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage >= pages) currentPage = pages - 1;
  const start = currentPage * PAGE_SIZE;
  const slice = filteredRows.slice(start, start + PAGE_SIZE);

  $('stats-shown').textContent      = slice.length;
  $('stats-filtered').textContent   = total;
  $('stats-cumulative').textContent = Object.keys(db).length.toLocaleString();
  $('page-current').textContent     = currentPage + 1;
  $('page-total').textContent       = pages;

  $('stats-rows').innerHTML = slice.map(r => `
    <tr>
      <td class="col-photo" data-norad="${r.noradId}">${photoCellHtml(r)}</td>
      <td class="col-name">${esc(r.name)}</td>
      <td class="muted">${r.noradId}</td>
      <td class="muted">${esc(r.intlId) || '—'}</td>
      <td class="col-country">${countryCell(r.owner)}</td>
      <td class="col-country">${launchCountryCell(r.launchSite)}</td>
      <td class="col-status">${r.decayed
          ? '<span class="badge badge-decay">DECAYED</span>'
          : '<span class="badge badge-active">ACTIVE</span>'}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted" style="padding:20px;text-align:center">No matching satellites.</td></tr>';

  hydrateThumbs(slice);   // async, no need to await
}

// =========================================================================
// Render: graphs (Chart.js)
// =========================================================================

const CHART_PALETTE = [
  '#67c8ff', '#ff6b6b', '#67e8a4', '#ffd166', '#c08bff',
  '#ff9966', '#4ade80', '#60a5fa', '#f472b6', '#fbbf24',
  '#22d3ee', '#a78bfa',
];

const chartInstances = {};
function destroyCharts() {
  for (const k of Object.keys(chartInstances)) {
    chartInstances[k]?.destroy?.();
    delete chartInstances[k];
  }
}

function commonScaleOptions(label) {
  return {
    plugins: {
      legend: { labels: { color: '#cfd8e3', font: { family: 'JetBrains Mono, monospace', size: 11 } } },
      tooltip: {
        backgroundColor: 'rgba(2, 6, 13, 0.92)',
        borderColor: '#1f3247',
        borderWidth: 1,
        titleColor: '#67c8ff',
        bodyColor: '#cfd8e3',
        padding: 10,
      },
    },
    scales: {
      x: {
        ticks: { color: '#9fb1c8', font: { size: 10 } },
        grid: { color: 'rgba(110, 200, 255, 0.06)' },
      },
      y: {
        ticks: { color: '#9fb1c8', font: { size: 10 } },
        grid: { color: 'rgba(110, 200, 255, 0.08)' },
        title: { display: !!label, text: label, color: '#9fb1c8', font: { size: 10 } },
      },
    },
  };
}

function renderCharts(db) {
  destroyCharts();
  const records = Object.values(db);

  // ---- 1. Orbit class doughnut ----
  const orbitTally = { LEO: 0, MEO: 0, GEO: 0, HEO: 0, Unknown: 0 };
  for (const r of records) {
    const cls = orbitClass(r);
    orbitTally[cls || 'Unknown']++;
  }
  chartInstances.orbits = new Chart($('chart-orbits'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(orbitTally),
      datasets: [{
        data: Object.values(orbitTally),
        backgroundColor: ['#67e8a4', '#f9d24c', '#ff9966', '#d77eff', '#5a6a7d'],
        borderColor: '#0a1422',
        borderWidth: 2,
        hoverOffset: 12,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '55%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#cfd8e3',
            font: { family: 'JetBrains Mono, monospace', size: 11 },
            padding: 12,
          },
        },
        tooltip: {
          backgroundColor: 'rgba(2, 6, 13, 0.92)',
          titleColor: '#67c8ff', bodyColor: '#cfd8e3',
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((ctx.parsed / total) * 100).toFixed(1);
              return ` ${ctx.label}: ${ctx.parsed.toLocaleString()} (${pct}%)`;
            },
          },
        },
      },
    },
  });

  // ---- 2. Top 12 owners ----
  const ownerTally = {};
  for (const r of records) if (r.owner) ownerTally[r.owner] = (ownerTally[r.owner] || 0) + 1;
  const ownerEntries = Object.entries(ownerTally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  chartInstances.owners = new Chart($('chart-owners'), {
    type: 'bar',
    data: {
      labels: ownerEntries.map(([c]) => COUNTRY[c]?.name || c),
      datasets: [{
        label: 'Satellites',
        data: ownerEntries.map(([, n]) => n),
        backgroundColor: ownerEntries.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: commonScaleOptions().plugins.tooltip },
      scales: {
        x: {
          ticks: { color: '#9fb1c8', font: { size: 10 } },
          grid: { color: 'rgba(110, 200, 255, 0.06)' },
        },
        y: {
          ticks: { color: '#cfd8e3', font: { size: 11 } },
          grid: { display: false },
        },
      },
    },
  });

  // ---- 3. Launches per year ----
  const yearTally = {};
  for (const r of records) {
    if (!r.launchDate) continue;
    const y = parseInt(r.launchDate.slice(0, 4), 10);
    if (!Number.isFinite(y) || y < 1957) continue;
    yearTally[y] = (yearTally[y] || 0) + 1;
  }
  const yearsSorted = Object.keys(yearTally).map(Number).sort((a, b) => a - b);
  chartInstances.launches = new Chart($('chart-launches'), {
    type: 'line',
    data: {
      labels: yearsSorted,
      datasets: [{
        label: 'Active sats catalogued',
        data: yearsSorted.map(y => yearTally[y]),
        borderColor: '#67c8ff',
        backgroundColor: 'rgba(103, 200, 255, 0.18)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 5,
        pointBackgroundColor: '#67c8ff',
      }],
    },
    options: { responsive: true, maintainAspectRatio: false, ...commonScaleOptions('Count') },
  });

  // ---- 4. Top 10 launch sites ----
  const siteTally = {};
  for (const r of records) if (r.launchSite) siteTally[r.launchSite] = (siteTally[r.launchSite] || 0) + 1;
  const siteEntries = Object.entries(siteTally).sort((a, b) => b[1] - a[1]).slice(0, 10);
  chartInstances.sites = new Chart($('chart-sites'), {
    type: 'bar',
    data: {
      labels: siteEntries.map(([s]) => LAUNCH_SITE[s]?.name || s),
      datasets: [{
        label: 'Launches',
        data: siteEntries.map(([, n]) => n),
        backgroundColor: siteEntries.map((_, i) => CHART_PALETTE[(i + 3) % CHART_PALETTE.length]),
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: commonScaleOptions().plugins.tooltip },
      scales: {
        x: {
          ticks: { color: '#9fb1c8', font: { size: 10 } },
          grid: { color: 'rgba(110, 200, 255, 0.06)' },
        },
        y: {
          ticks: { color: '#cfd8e3', font: { size: 10 } },
          grid: { display: false },
        },
      },
    },
  });

  // ---- 5. Inclination distribution ----
  const incBuckets = new Array(19).fill(0); // 0-10, 10-20, ..., 180-190
  for (const r of records) {
    const i = r.inclination;
    if (!Number.isFinite(i)) continue;
    const b = Math.min(18, Math.max(0, Math.floor(i / 10)));
    incBuckets[b]++;
  }
  const incLabels = incBuckets.map((_, i) => `${i * 10}–${(i + 1) * 10}°`);
  chartInstances.inclination = new Chart($('chart-inclination'), {
    type: 'bar',
    data: {
      labels: incLabels,
      datasets: [{
        label: 'Satellites',
        data: incBuckets,
        backgroundColor: incBuckets.map((_, i) => {
          // Heatmap-ish gradient: equatorial → cyan, polar → magenta.
          const h = 200 - (i / 18) * 100;  // 200 → 100 (cyan → green)
          return `hsl(${h}, 80%, 60%)`;
        }),
        borderRadius: 3,
        borderSkipped: false,
      }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: commonScaleOptions().plugins.tooltip }, scales: commonScaleOptions('Count').scales },
  });
}

// =========================================================================
// Tab switching
// =========================================================================

function activateTab(which) {
  const isTable = which === 'table';
  $('tab-table' ).classList.toggle('active', isTable);
  $('tab-graphs').classList.toggle('active', !isTable);
  $('tab-table' ).setAttribute('aria-selected', isTable);
  $('tab-graphs').setAttribute('aria-selected', !isTable);
  $('view-table' ).hidden = !isTable;
  $('view-graphs').hidden = isTable;
}
$('tab-table' ).addEventListener('click', () => activateTab('table'));
$('tab-graphs').addEventListener('click', () => activateTab('graphs'));

// =========================================================================
// Boot
// =========================================================================

let db = {};

async function boot() {
  setStatus('Loading TLE catalogue + SATCAT…');
  db = loadDB();
  // Render whatever's in the cumulative DB immediately — instant first paint
  // even before the network round-trips complete.
  if (Object.keys(db).length) {
    renderTable(db);
    renderCharts(db);
  }

  const [{ tles, source: tleSource }, { records: satrec, source: scSource }] = await Promise.all([
    fetchTLEs(),
    fetchActiveSatcat(),
  ]);
  const added = mergeIntoDB(db, tles, satrec);
  saveDB(db);

  const tleTag = tleSource === 'celestrak' ? 'live'
              : tleSource === 'cache'    ? 'cached'
              : 'bundled snapshot';
  setStatus(`${tles.length.toLocaleString()} TLEs (${tleTag}) · ${satrec.length.toLocaleString()} SATCAT (${scSource}) · cumulative ${Object.keys(db).length.toLocaleString()} sats (+${added} new)`);

  renderTable(db);
  renderCharts(db);
}

$('filter').addEventListener('input', () => { currentPage = 0; renderTable(db); });
$('prev-page').addEventListener('click', () => { if (currentPage > 0) { currentPage--; renderTable(db); } });
$('next-page').addEventListener('click', () => {
  const pages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  if (currentPage < pages - 1) { currentPage++; renderTable(db); }
});

boot().catch(e => {
  console.error(e);
  setStatus('Boot failed: ' + e.message, true);
});
