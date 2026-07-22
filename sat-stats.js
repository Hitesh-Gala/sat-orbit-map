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
    // Unknown site code — show the raw code as the site name and a
    // globe glyph for the unknown country.
    return `<span class="flag-glyph" title="unknown">🌐</span><span class="ctry-name muted">
      <span class="ctry-main">—</span>
      <span class="site-name">${esc(siteCode)}</span>
    </span>`;
  }
  const c = COUNTRY[site.owner];
  // Two-line layout: bold country name, then the dim physical-site
  // name underneath (e.g. "Baikonur, Kazakhstan").
  return `${flagImg(c)}<span class="ctry-name">
    <span class="ctry-main">${esc(c ? c.name : site.owner)}</span>
    <span class="site-name">${esc(site.name)}</span>
  </span>`;
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
// Three-stage cascade:
//   1. localStorage cache (24 h TTL) — fastest, no network.
//   2. CelesTrak records.php?GROUP=active — fresh JSON from the source.
//   3. Bundled data/satcat-active.json snapshot — pre-trimmed to active
//      payloads only.  ~2.6 MB raw / ~700 KB gzipped.  Always available,
//      survives the CelesTrak 403 rate-limit that hits records.php
//      surprisingly often.
//
// Without stage 3 the page used to show empty country/launch columns
// and blank charts whenever CelesTrak was rate-limiting (the user's
// "graphs and statistics aren't loading" report).

const SATCAT_BUNDLED_URL = 'data/satcat-active.json';

async function fetchActiveSatcat() {
  // Stage 1: localStorage cache.
  try {
    const raw = localStorage.getItem(SATCAT_KEY);
    if (raw) {
      const { t, v } = JSON.parse(raw);
      if (Date.now() - t < SATCAT_TTL_MS) return { records: v, source: 'cache' };
    }
  } catch {}

  // Stage 2: live CelesTrak.
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
        cacheSatcat(trimmed);
        return { records: trimmed, source: 'celestrak' };
      }
    } else {
      console.warn(`SATCAT live fetch HTTP ${r.status}; falling back to bundled snapshot.`);
    }
  } catch (e) {
    console.warn(`SATCAT live fetch threw: ${e.message}; falling back to bundled snapshot.`);
  }

  // Stage 3: bundled snapshot.  Already in the trimmed { n, c, i, ... }
  // shape we serialise into localStorage — no per-record rewrite needed.
  try {
    // cache:'no-cache' so the 6-hourly refresh-data workflow's updates
    // to data/satcat-active.json actually reach the user — without it
    // the browser keeps serving its first-cached snapshot forever.
    const r2 = await fetch(SATCAT_BUNDLED_URL, { cache: 'no-cache' });
    if (r2.ok) {
      const arr = await r2.json();
      if (Array.isArray(arr) && arr.length) {
        cacheSatcat(arr);
        return { records: arr, source: 'bundled' };
      }
    }
    console.warn(`Bundled SATCAT fetch HTTP ${r2.status}; page will run with no SATCAT data.`);
  } catch (e) {
    console.warn(`Bundled SATCAT fetch threw: ${e.message}; page will run with no SATCAT data.`);
  }
  return { records: [], source: 'failed' };
}

function cacheSatcat(records) {
  try { localStorage.setItem(SATCAT_KEY, JSON.stringify({ t: Date.now(), v: records })); }
  catch (e) { console.warn('SATCAT cache write failed (over quota?):', e.message); }
}

// Always load the FULL bundled reference snapshot (~19.4 k active payloads),
// independent of the live-feed cascade above.  This is the permanent
// repository we merge as a baseline so no object — e.g. deep-space craft like
// Aditya-L1 that carry no Earth-orbit TLE — is ever lost from the catalogue.
async function fetchBundledSatcat() {
  try {
    const r = await fetch(SATCAT_BUNDLED_URL, { cache: 'no-cache' });
    if (r.ok) {
      const arr = await r.json();
      if (Array.isArray(arr) && arr.length) return arr;
    }
    console.warn(`Bundled SATCAT repository fetch HTTP ${r.status}.`);
  } catch (e) {
    console.warn(`Bundled SATCAT repository fetch threw: ${e.message}.`);
  }
  return [];
}

// =========================================================================
// Cumulative DB — persisted in IndexedDB
// =========================================================================
//
// The cumulative catalogue is stored as ONE structured-cloned blob in
// IndexedDB (key IDB_KEY in store IDB_STORE).  IndexedDB grants hundreds of
// MB per origin — orders of magnitude more than localStorage's ~5 MB — so
// the full ~19 k-record history persists intact and the cumulative total no
// longer erodes under quota pressure.  localStorage stays as (a) a one-time
// migration source for users who already have a DB there, and (b) a fallback
// when IndexedDB is unavailable (very old browsers, some private modes).

const IDB_NAME  = 'nazar-satstats';
const IDB_STORE = 'kv';
const IDB_KEY   = 'db';            // single-blob key inside the object store
// DB_KEY (legacy localStorage key) is defined near the top of the file.

let _idbPromise = null;
function openIDB() {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise(resolve => {
    if (!('indexedDB' in window)) { resolve(null); return; }
    let req;
    try { req = indexedDB.open(IDB_NAME, 1); }
    catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(IDB_STORE)) idb.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return _idbPromise;
}

function idbGet(idb, key) {
  return new Promise(resolve => {
    try {
      const req = idb.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}
function idbPut(idb, key, val) {
  return new Promise(resolve => {
    try {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror    = () => resolve(false);
      tx.onabort    = () => resolve(false);
    } catch { resolve(false); }
  });
}

// Read the legacy localStorage blob (migration source + IndexedDB-less fallback).
function loadLegacyLS() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch { return {}; }
}

async function loadDB() {
  const idb = await openIDB();
  if (idb) {
    const val = await idbGet(idb, IDB_KEY);
    if (val && typeof val === 'object') return val;
    // IndexedDB empty — migrate any pre-existing localStorage DB into it,
    // then drop the localStorage copy so it stops competing for the ~5 MB
    // quota with the TLE / SATCAT caches.
    const legacy = loadLegacyLS();
    if (Object.keys(legacy).length) {
      await idbPut(idb, IDB_KEY, legacy);
      try { localStorage.removeItem(DB_KEY); } catch {}
      console.info(`SatStats: migrated ${Object.keys(legacy).length} records from localStorage into IndexedDB.`);
    }
    return legacy;
  }
  // No IndexedDB at all — run on localStorage.
  return loadLegacyLS();
}

async function saveDB(db) {
  const idb = await openIDB();
  if (idb) {
    // One put of the whole catalogue — no ceiling, so no trimming needed.
    if (await idbPut(idb, IDB_KEY, db)) return;
    console.warn('SatStats: IndexedDB write failed; falling back to localStorage.');
  }
  saveLegacyLS(db);
}

// ---- localStorage fallback (only used when IndexedDB is unavailable) -------
function trySetDB(obj) {
  try { localStorage.setItem(DB_KEY, JSON.stringify(obj)); return true; }
  catch { return false; }
}
function saveLegacyLS(db) {
  if (trySetDB(db)) return;
  // Over localStorage quota.  Persist a trimmed COPY so the in-memory `db`
  // stays complete for this session.  Drop records that are IN THE LATEST
  // FEED first (re-fetched every load, so harmless to lose) and keep the
  // irreplaceable "previously tracked" history to the last.
  console.warn('SatStats DB exceeds localStorage quota — persisting a trimmed copy (re-fetchable records dropped first); full catalogue kept in memory for this session.');
  const trimmed = { ...db };
  const isRefetchable = k => bootStamp !== null && trimmed[k].lastSeen === bootStamp;

  const refetchable = Object.keys(trimmed)
    .filter(isRefetchable)
    .sort((a, b) => (Number(!!trimmed[a].owner) - Number(!!trimmed[b].owner)));
  for (let i = 0; i < refetchable.length; i += 1000) {
    for (let j = i; j < i + 1000 && j < refetchable.length; j++) delete trimmed[refetchable[j]];
    if (trySetDB(trimmed)) return;
  }
  const byAge = Object.keys(trimmed)
    .sort((a, b) => (trimmed[a].lastSeen || 0) - (trimmed[b].lastSeen || 0));
  for (let i = 0; i < byAge.length; i += 1000) {
    for (let j = i; j < i + 1000 && j < byAge.length; j++) delete trimmed[byAge[j]];
    if (trySetDB(trimmed)) return;
  }
}

// Merge TLE + SATCAT into the cumulative DB.  Returns the count of NEW NORAD
// IDs added.
//
// `markLive` distinguishes the two data sources:
//   • The bundled reference snapshot (data/satcat-active.json, ~19.4 k
//     objects) is merged with markLive=false — it fills in metadata for the
//     whole repository so nothing is ever lost, but does NOT mark records as
//     "in the latest feed".
//   • The live feed (CelesTrak records.php + the active TLE set, ~16 k) is
//     merged with markLive=true, stamping each with `lastSeen = stamp`.
// Afterwards a record is "in the latest feed" iff lastSeen === stamp; every
// other record (e.g. Aditya-L1, which has no Earth-orbit TLE) is in the
// repository but "previously tracked".
function mergeIntoDB(db, tles, satrec, stamp, markLive) {
  let added = 0;
  for (const r of satrec) {
    const id = r.c;
    if (!Number.isFinite(id)) continue;
    if (!db[id]) { db[id] = { norad: id }; added++; }
    const rec = db[id];
    rec.name        = r.n  || rec.name;
    rec.intlId      = r.i  || rec.intlId;
    rec.owner       = r.o  || rec.owner;
    rec.launchSite  = r.ls || rec.launchSite;
    rec.launchDate  = r.ld || rec.launchDate;
    rec.decayDate   = r.dd || rec.decayDate;
    rec.period      = parseFloat(r.p)   || rec.period;
    rec.inclination = parseFloat(r.inc) || rec.inclination;
    rec.apogee      = parseFloat(r.a)   || rec.apogee;
    rec.perigee     = parseFloat(r.pe)  || rec.perigee;
    if (markLive) rec.lastSeen = stamp;
  }
  // TLE records are always part of the live feed — fill in names + the int'l
  // designator, and stamp them as present.
  for (const t of tles) {
    const id = t.noradId;
    if (!Number.isFinite(id)) continue;
    if (!db[id]) { db[id] = { norad: id }; added++; }
    if (!db[id].name)   db[id].name   = t.name;
    if (!db[id].intlId) db[id].intlId = parseIntlIdFromTLE(t.l1);
    db[id].lastSeen = stamp;
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

let filteredRows = [];   // "current directory" — records in the latest feed
let absentRows   = [];   // "previously tracked" — in the DB but not the feed
let currentPage = 0;

// A record is "in the latest feed" iff it was stamped by this session's
// fetch.  Before that fetch completes (bootStamp === null) we can't tell, so
// everything counts as present and the absent section stays empty.
function inLatestFeed(r) {
  return bootStamp === null || r.lastSeen === bootStamp;
}

function rebuildFiltered(db) {
  const q = $('filter').value.trim().toLowerCase();
  const ownerFilter = $('filter-owner').value;
  const out = [];
  const gone = [];
  for (const id of Object.keys(db)) {
    const r = db[id];
    if (!r.name) continue;
    const row = {
      name:       r.name,
      noradId:    r.norad,
      intlId:     r.intlId || '',
      owner:      r.owner || '',
      launchSite: r.launchSite || '',
      decayed:    !!r.decayDate,
      lastSeen:   r.lastSeen || 0,
      // Extra fields used to build the "Remarks" column in the pop-up.
      launchDate: r.launchDate || '',
      apogee:     r.apogee,
      perigee:    r.perigee,
      inclination:r.inclination,
      period:     r.period,
    };
    if (!inLatestFeed(r)) {
      // "Previously tracked" — collect ALL of them regardless of the main
      // page filter; the pop-up has its own search + country dropdown.
      gone.push(row);
      continue;
    }
    // Present rows ("in latest feed") honour the main page search + country.
    if (ownerFilter && r.owner !== ownerFilter) continue;
    if (q) {
      const hay = `${r.name} ${r.norad} ${r.intlId || ''} ${r.owner || ''} ${COUNTRY[r.owner]?.name || ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(row);
  }
  // Previously-tracked list: most-recently-absent first.
  gone.sort((a, b) => (b.lastSeen - a.lastSeen) || a.name.localeCompare(b.name));
  absentRows = gone;
  out.sort((a, b) => a.name.localeCompare(b.name));
  filteredRows = out;
  if (currentPage * PAGE_SIZE >= filteredRows.length) currentPage = 0;
}

// Build the Country-of-Origin filter dropdown from whatever owner
// codes are present in the cumulative DB right now.  Sorted by
// displayed country name, not by raw code, so users scan it as
// "Argentina, Austria, Australia…" rather than "ARGN, ASRA, AUS…".
// Preserves the current selection across re-populates.
function populateOwnerDropdown(db) {
  const select = $('filter-owner');
  if (!select) return;
  const currentValue = select.value;
  const owners = new Set();
  for (const id of Object.keys(db)) {
    const o = db[id].owner;
    if (o) owners.add(o);
  }
  const sorted = [...owners].sort((a, b) => {
    const na = COUNTRY[a]?.name || a;
    const nb = COUNTRY[b]?.name || b;
    return na.localeCompare(nb);
  });
  const opts = ['<option value="">Country of Origin · All</option>'];
  for (const o of sorted) {
    const name = COUNTRY[o]?.name || o;
    opts.push(`<option value="${esc(o)}">${esc(name)}</option>`);
  }
  select.innerHTML = opts.join('');
  // Restore prior selection if the country is still represented in
  // the DB; otherwise fall back to "All".
  select.value = sorted.includes(currentValue) ? currentValue : '';
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
  $('stats-absent').textContent     = absentRows.length.toLocaleString();
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
// "Previously tracked" pop-up — objects catalogued on an earlier visit
// whose TLE/SATCAT entry is absent from the current snapshot (decayed,
// deep-space like Aditya-L1, or dropped from CelesTrak's "active" list).
// Opened from the #prev-tracked-btn pill.  Has its OWN search box + country
// dropdown (independent of the main page), and a "Remarks" column with
// curated / derived context per object.
// =========================================================================

const ABSENT_MAX = 1500;   // cap the rendered rows so a huge history can't jam the DOM

function fmtLastSeen(ms) {
  // No live-feed stamp → the object is in the bundled reference repository
  // but has never appeared in the live TLE/SATCAT feed (e.g. Aditya-L1).
  if (!ms) return 'reference catalogue';
  try {
    return new Date(ms).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });
  } catch { return 'reference catalogue'; }
}

// -------------------------------------------------------------------------
// "Remarks" — interesting context per object for the previously-tracked
// pop-up.  Curated rich notes for notable craft (matched by name), else a
// note derived from the catalogue fields (purpose · launch date · orbit ·
// inclination).  All local — no per-object network fetch for ~3 k rows.
// -------------------------------------------------------------------------

const NOTABLE_REMARKS = [
  [/ADITYA/i, 'ISRO’s first solar observatory. Launched 2 Sep 2023; parked in a halo orbit around Sun–Earth Lagrange point L1, ~1.5 million km from Earth — so it carries no Earth-orbit TLE. Continuously studies the Sun’s corona, photosphere and solar wind. Design life ≈ 5 years.'],
  [/JAMES ?WEBB|JWST/i, 'NASA/ESA/CSA flagship infrared observatory, launched 25 Dec 2021. Operates around Sun–Earth L2, ~1.5 million km from Earth. Hubble’s successor; images the first galaxies and exoplanet atmospheres. Propellant-limited life ~20 years.'],
  [/\bSOHO\b/i, 'ESA/NASA Solar & Heliospheric Observatory, launched 2 Dec 1995. Stationed at Sun–Earth L1 (~1.5M km). The most prolific comet-discoverer in history; still operating decades past its 2-year design life.'],
  [/DSCOVR/i, 'NOAA deep-space climate + solar-wind sentinel, launched 11 Feb 2015. Sits at Sun–Earth L1 (~1.5M km); gives ~15–60 min warning of geomagnetic storms and full-disc Earth imagery (EPIC camera).'],
  [/ADVANCED COMPOSITION|\bACE\b/i, 'NASA Advanced Composition Explorer, launched 25 Aug 1997. At Sun–Earth L1 (~1.5M km) sampling the solar wind — a key space-weather early-warning asset.'],
  [/^WIND\b/i, 'NASA solar-wind & magnetosphere probe, launched 1 Nov 1994; long-lived mission near Sun–Earth L1.'],
  [/GAIA/i, 'ESA astrometry mission, launched 19 Dec 2013. Operated at Sun–Earth L2 (~1.5M km); mapped ~2 billion stars in 3-D. Science operations concluded early 2025.'],
  [/SPEKTR-?RG/i, 'Russian–German X-ray observatory (Spektr-RG), launched 13 Jul 2019. Operates at Sun–Earth L2 surveying the hot universe — galaxy clusters and active black holes.'],
  [/EUCLID/i, 'ESA dark-universe telescope, launched 1 Jul 2023. Operates at Sun–Earth L2, mapping cosmic geometry across billions of galaxies.'],
  [/QUEQIAO|CHANG.?E/i, 'China lunar-exploration / relay spacecraft operating in cislunar space or an Earth–Moon L2 halo orbit — beyond conventional Earth orbit.'],
  [/TIANWEN/i, 'China deep-space / interplanetary probe (Mars, asteroid or beyond) — in a Sun-centred orbit, not around Earth.'],
  [/CHANDRAYAAN/i, 'ISRO lunar mission component operating in or around the Moon — no Earth-orbit elements.'],
  [/HAYABUSA|OSIRIS|LUCY|PSYCHE|BEPICOLOMBO|JUICE/i, 'Interplanetary / asteroid mission in a heliocentric (Sun-centred) orbit — carries no Earth-orbit TLE.'],
];

// Broad purpose hints for common global operators/series that inferPurpose()
// (China-focused) doesn't cover.  First match wins.
const PURPOSE_HINTS = [
  [/^STARLINK/i,                      'LEO broadband internet (SpaceX)'],
  [/^ONEWEB/i,                        'LEO broadband (Eutelsat OneWeb)'],
  [/^KUIPER/i,                        'LEO broadband (Amazon Leo)'],
  [/^(NAVSTAR|GPS)/i,                 'GPS navigation (US)'],
  [/^GLONASS/i,                       'GLONASS navigation (Russia)'],
  [/^GALILEO/i,                       'Galileo navigation (EU)'],
  [/^(IRNSS|NVS-)/i,                  'NavIC navigation (India)'],
  [/^QZS/i,                           'QZSS navigation (Japan)'],
  [/^IRIDIUM/i,                       'Satellite phone / data (Iridium)'],
  [/^GLOBALSTAR/i,                    'Mobile satellite comms (Globalstar)'],
  [/^ORBCOMM/i,                       'IoT / M2M messaging (ORBCOMM)'],
  [/^(INTELSAT|GALAXY)/i,             'Geostationary comms (Intelsat)'],
  [/^(SES-|ASTRA|O3B)/i,             'Communications (SES)'],
  [/^(EUTELSAT|HOTBIRD|HOT BIRD)/i,  'Communications (Eutelsat)'],
  [/^(INMARSAT|VIASAT)/i,            'Mobile broadband (Viasat / Inmarsat)'],
  [/^(FLOCK|SKYSAT|PELICAN|TANAGER)/i,'Earth imaging (Planet)'],
  [/^LEMUR/i,                        'Ship / weather data (Spire)'],
  [/^(WORLDVIEW|GEOEYE|LEGION)/i,    'High-res Earth imaging (Vantor)'],
  [/^ICEYE/i,                        'Radar (SAR) Earth imaging (ICEYE)'],
  [/^CAPELLA/i,                      'Radar (SAR) imaging (Capella)'],
  [/^BLACKSKY/i,                     'Rapid-revisit imaging (BlackSky)'],
  [/^(NOAA|GOES|JPSS|SUOMI)/i,       'Weather satellite (NOAA)'],
  [/^(METEOSAT|METOP|MSG)/i,         'Weather satellite (EUMETSAT)'],
  [/^HIMAWARI/i,                     'Weather satellite (Japan)'],
  [/^USA\s*\d/i,                     'Classified US government payload'],
  [/^COSMOS\s*\d/i,                  'Russian military / government satellite'],
];

function purposeFor(name) {
  for (const [re, p] of PURPOSE_HINTS) if (re.test(name)) return p;
  if (window.Argos && typeof window.Argos.inferPurpose === 'function') {
    const p = window.Argos.inferPurpose(name);
    if (p && p !== 'Not publicly stated') return p;
  }
  return '';
}

function fmtLaunchDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return s || '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(m[3], 10)} ${months[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

function orbitDescription(r) {
  const cls = orbitClass(r);   // reads r.apogee / r.perigee
  if (!cls) return '';
  const label = cls === 'LEO' ? 'low-Earth orbit'
              : cls === 'MEO' ? 'medium-Earth orbit'
              : cls === 'GEO' ? 'geostationary belt'
              : 'high / elliptical orbit';
  const a = r.apogee, p = r.perigee;
  if (Number.isFinite(a) && Number.isFinite(p)) {
    return `${label} (~${Math.round((a + p) / 2).toLocaleString()} km up)`;
  }
  return label;
}

function remarksFor(r) {
  for (const [re, txt] of NOTABLE_REMARKS) if (re.test(r.name)) return txt;
  const bits = [];
  const purpose = purposeFor(r.name);
  if (purpose) bits.push(purpose);
  const ld = fmtLaunchDate(r.launchDate);
  if (ld) bits.push('launched ' + ld);
  const orbit = orbitDescription(r);
  if (orbit) bits.push(orbit);
  if (Number.isFinite(r.inclination)) bits.push(`${r.inclination.toFixed(1)}° inclination`);
  return bits.length ? bits.join(' · ') : '—';
}

// -------------------------------------------------------------------------
// The pop-up has its OWN search + country dropdown (independent of the main
// page filter), operating on the full absentRows set.
// -------------------------------------------------------------------------

function populatePrevTrackedOwner() {
  const select = $('prev-tracked-owner');
  if (!select) return;
  const prev = select.value;
  const owners = new Set();
  for (const r of absentRows) if (r.owner) owners.add(r.owner);
  const sorted = [...owners].sort((a, b) =>
    (COUNTRY[a]?.name || a).localeCompare(COUNTRY[b]?.name || b));
  const opts = ['<option value="">Country of Origin · All</option>'];
  for (const o of sorted) opts.push(`<option value="${esc(o)}">${esc(COUNTRY[o]?.name || o)}</option>`);
  select.innerHTML = opts.join('');
  select.value = sorted.includes(prev) ? prev : '';
}

function currentPrevTrackedRows() {
  const q = ($('prev-tracked-search')?.value || '').trim().toLowerCase();
  const owner = $('prev-tracked-owner')?.value || '';
  let rows = absentRows;
  if (owner) rows = rows.filter(r => r.owner === owner);
  if (q) rows = rows.filter(r =>
    `${r.name} ${r.noradId} ${r.intlId} ${r.owner} ${COUNTRY[r.owner]?.name || ''}`.toLowerCase().includes(q));
  return rows;
}

function applyPrevTrackedFilter() {
  const rowsEl = $('prev-tracked-rows');
  if (!rowsEl) return;
  const rows = currentPrevTrackedRows();
  const slice = rows.slice(0, ABSENT_MAX);
  rowsEl.innerHTML = slice.map(r => `
    <tr>
      <td class="col-photo" data-norad="${r.noradId}">${photoCellHtml(r)}</td>
      <td class="col-name">${esc(r.name)}</td>
      <td class="muted">${r.noradId}</td>
      <td class="muted">${esc(r.intlId) || '—'}</td>
      <td class="col-country">${countryCell(r.owner)}</td>
      <td class="col-country">${launchCountryCell(r.launchSite)}</td>
      <td class="muted">${fmtLastSeen(r.lastSeen)}</td>
      <td class="col-remarks">${esc(remarksFor(r))}</td>
    </tr>`).join('') || `<tr><td colspan="8" class="muted" style="padding:24px;text-align:center">${
      bootStamp === null ? 'Loading…' : 'No matching objects.'
    }</td></tr>`;

  const noteEl = $('prev-tracked-note');
  if (noteEl) {
    const parts = [];
    if (rows.length !== absentRows.length) parts.push(`${rows.length.toLocaleString()} of ${absentRows.length.toLocaleString()} shown`);
    if (rows.length > ABSENT_MAX) parts.push(`first ${ABSENT_MAX.toLocaleString()} rendered`);
    noteEl.textContent = parts.join(' · ');
  }
  hydrateThumbs(slice);   // async, no need to await
}

function renderPrevTrackedModal() {
  const countEl = $('prev-tracked-count');
  if (countEl) countEl.textContent = absentRows.length.toLocaleString();
  populatePrevTrackedOwner();
  applyPrevTrackedFilter();
}

function openPrevTracked() {
  renderPrevTrackedModal();
  const m = $('prev-tracked-modal');
  if (!m) return;
  m.hidden = false;
  m.setAttribute('aria-hidden', 'false');
  // .tle-modal is opacity:0 by default; add .shown after a paint so it
  // fades in.  Without this the modal is invisible but still a full-screen
  // fixed overlay, which silently blocks clicks on the page beneath it.
  setTimeout(() => m.classList.add('shown'), 16);
}
function closePrevTracked() {
  const m = $('prev-tracked-modal');
  if (!m) return;
  m.classList.remove('shown');
  m.setAttribute('aria-hidden', 'true');
  setTimeout(() => { m.hidden = true; }, 220);   // hide after the fade-out
}

$('prev-tracked-btn')?.addEventListener('click', openPrevTracked);
$('prev-tracked-close')?.addEventListener('click', closePrevTracked);
$('prev-tracked-search')?.addEventListener('input', applyPrevTrackedFilter);
$('prev-tracked-owner')?.addEventListener('change', applyPrevTrackedFilter);
$('prev-tracked-modal')?.addEventListener('click', e => {
  if (e.target.id === 'prev-tracked-modal') closePrevTracked();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('prev-tracked-modal') && !$('prev-tracked-modal').hidden) closePrevTracked();
});

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
// Boot
// =========================================================================

let db = {};
let lastTLEs = [];      // live/bundled TLE set from the last boot — feeds the PDF
let lastSourceTag = ''; // human label of where those TLEs came from
let bootStamp = null;   // timestamp of the current fetch; records stamped with
                        // it are "in the latest feed", others are "previously
                        // tracked".  Null until the first fetch completes.

async function boot() {
  setStatus('Loading TLE catalogue + SATCAT…');
  db = await loadDB();
  // Render whatever's in the cumulative DB immediately — instant first paint
  // even before the network round-trips complete.
  if (Object.keys(db).length) {
    populateOwnerDropdown(db);
    renderTable(db);
    renderCharts(db);
  }

  const [{ tles, source: tleSource }, { records: satrec, source: scSource }, bundled] = await Promise.all([
    fetchTLEs(),
    fetchActiveSatcat(),
    fetchBundledSatcat(),   // the full ~19.4 k repository — always merged
  ]);
  bootStamp = Date.now();
  // 1) Baseline: merge the full bundled repository so the catalogue always
  //    holds ~19.4 k objects and nothing is ever lost (metadata only — these
  //    are NOT marked "in the latest feed").
  mergeIntoDB(db, [], bundled, bootStamp, false);
  // 2) Live feed: TLE + live SATCAT.  These ARE marked present, so the main
  //    table shows them and the ~3 k difference lands in "Previously tracked".
  const added = mergeIntoDB(db, tles, satrec, bootStamp, true);
  saveDB(db);

  const tleTag = tleSource === 'celestrak' ? 'live'
              : tleSource === 'cache'    ? 'cached'
              : 'bundled snapshot';
  lastTLEs = tles;
  lastSourceTag = tleTag;
  setStatus(`${tles.length.toLocaleString()} TLEs (${tleTag}) · ${satrec.length.toLocaleString()} SATCAT (${scSource}) · repository ${Object.keys(db).length.toLocaleString()} sats (+${added} new)`);

  populateOwnerDropdown(db);
  renderTable(db);
  renderCharts(db);

  enablePdfButton();   // page is fully loaded — the PDF export can now run
}

$('filter').addEventListener('input', () => { currentPage = 0; renderTable(db); });
$('filter-owner').addEventListener('change', () => { currentPage = 0; renderTable(db); });
$('prev-page').addEventListener('click', () => { if (currentPage > 0) { currentPage--; renderTable(db); } });
$('next-page').addEventListener('click', () => {
  const pages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  if (currentPage < pages - 1) { currentPage++; renderTable(db); }
});

boot().catch(e => {
  console.error(e);
  setStatus('Boot failed: ' + e.message, true);
});

// =========================================================================
// TLE Repository modal — popup that exposes every raw TLE the rest of the
// site is propagating from.  Sourced from window.Argos.fetchTLEs() so it
// honours the same cache → live → bundled fallback cascade.
// =========================================================================

const TLE_MODAL_PAGE_SIZE = 100;

// Parse the TLE line-1 epoch (cols 19–32: 2-digit year + decimal day-of-year)
// into a JS Date.  Per TLE convention, year < 57 maps to 20xx, else 19xx.
function parseTLEEpoch(l1) {
  if (!l1 || l1.length < 32) return null;
  const yr2 = parseInt(l1.slice(18, 20), 10);
  const dayFrac = parseFloat(l1.slice(20, 32));
  if (!Number.isFinite(yr2) || !Number.isFinite(dayFrac)) return null;
  const yr = yr2 < 57 ? 2000 + yr2 : 1900 + yr2;
  const dayInt = Math.floor(dayFrac);
  const ms = (dayFrac - dayInt) * 86400000;
  const d = new Date(Date.UTC(yr, 0, dayInt));
  d.setUTCMilliseconds(d.getUTCMilliseconds() + ms);
  return d;
}

// TLEs lose accuracy past ~2 weeks; CelesTrak generally refreshes daily.
// Bucket each row's age for a one-glance freshness badge.
function tleValidityBand(ageDays) {
  if (ageDays < 0)  return 'future';   // clock drift on the client
  if (ageDays < 3)  return 'fresh';
  if (ageDays < 14) return 'stale';
  return 'expired';
}

let tleModalCache = null;   // { tles, source } from the last fetchTLEs() call
let tleModalSource = '';
let tleModalPage   = 0;     // current pagination page (zero-indexed)

async function openTleRepo() {
  const modal = $('tle-repo-modal');
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  // Force a paint so the .shown transition runs from opacity:0 → 1.
  setTimeout(() => modal.classList.add('shown'), 16);
  tleModalPage = 0;   // always re-open on page 1

  if (!tleModalCache) {
    $('tle-modal-rows').innerHTML =
      '<tr><td colspan="7" class="hint">Loading TLE catalogue…</td></tr>';
    $('tle-modal-shown').textContent = '…';
    $('tle-modal-total').textContent = '…';
    $('tle-modal-source').textContent = '…';
    try {
      const result = await window.Argos.fetchTLEs();
      tleModalCache = result.tles;
      tleModalSource = result.source;
    } catch (e) {
      $('tle-modal-rows').innerHTML =
        `<tr><td colspan="7" class="hint">TLE fetch failed: ${esc(e.message)}</td></tr>`;
      return;
    }
  }
  $('tle-modal-total').textContent  = tleModalCache.length.toLocaleString();
  $('tle-modal-source').textContent = tleModalSource;
  renderTleModalRows();
}

function closeTleRepo() {
  const modal = $('tle-repo-modal');
  modal.classList.remove('shown');
  modal.setAttribute('aria-hidden', 'true');
  setTimeout(() => { modal.hidden = true; }, 220);
}

function renderTleModalRows() {
  if (!tleModalCache) return;
  const tbody = $('tle-modal-rows');
  const q = $('tle-modal-filter').value.trim().toLowerCase();
  const now = Date.now();
  // Tag matches whether the user typed celestrak/cached/bundled to filter
  // by source — uncommon but useful and zero extra cost to support.
  const sourceMatch = q && (
    tleModalSource.toLowerCase().includes(q) ||
    'bundled snapshot'.includes(q) ||
    'cached'.includes(q));

  // First pass: collect every match.  Cheap — string ops only, no SGP4.
  const matches = [];
  for (const t of tleModalCache) {
    const dbEntry = db[t.noradId];
    const ownerCode = dbEntry?.owner || '';
    const ownerName = COUNTRY[ownerCode]?.name || ownerCode || '—';
    if (q && !sourceMatch) {
      const hay = `${t.name} ${t.noradId} ${ownerCode} ${ownerName}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    matches.push({ t, ownerCode, ownerName });
  }

  // Clamp the page index to the new total — important after the user
  // filters their way down to fewer matches than the page they were on.
  const totalPages = Math.max(1, Math.ceil(matches.length / TLE_MODAL_PAGE_SIZE));
  if (tleModalPage >= totalPages) tleModalPage = totalPages - 1;
  if (tleModalPage < 0)           tleModalPage = 0;
  const start = tleModalPage * TLE_MODAL_PAGE_SIZE;
  const end   = Math.min(start + TLE_MODAL_PAGE_SIZE, matches.length);

  // Second pass: build rows only for the visible page (≤ 100 entries).
  const out = [];
  for (let i = start; i < end; i++) {
    const { t, ownerCode, ownerName } = matches[i];
    const epoch = parseTLEEpoch(t.l1);
    const epochStr = epoch
      ? epoch.toISOString().slice(0, 16).replace('T', ' ')
      : '—';
    const ageDays = epoch ? (now - epoch.getTime()) / 86400000 : NaN;
    const band = Number.isFinite(ageDays) ? tleValidityBand(ageDays) : 'unknown';
    const ageLabel = Number.isFinite(ageDays)
      ? (ageDays < 1 ? `${(ageDays * 24).toFixed(1)} h` : `${ageDays.toFixed(1)} d`)
      : '—';

    const countryCell = ownerCode
      ? `${flagImg(COUNTRY[ownerCode])}<span class="ctry-name">${esc(ownerName)}</span>`
      : `<span class="flag-glyph" title="unknown">🌐</span><span class="ctry-name muted">—</span>`;

    out.push(`<tr>
      <td class="tle-cell"><div>${esc(t.l1)}</div><div>${esc(t.l2)}</div></td>
      <td>${esc(t.name)}</td>
      <td class="mono">${t.noradId}</td>
      <td class="col-country">${countryCell}</td>
      <td class="mono">${esc(epochStr)} UTC</td>
      <td><span class="tle-validity tle-validity-${band}">${band}</span> <span class="muted mono">${esc(ageLabel)}</span></td>
      <td class="mono">${esc(tleModalSource)}</td>
    </tr>`);
  }

  tbody.innerHTML = out.join('') ||
    '<tr><td colspan="7" class="hint">No matches — try a different filter.</td></tr>';

  // Header stats: visible rows in this page, total matched, page X / Y.
  $('tle-modal-shown').textContent = (end - start).toLocaleString();
  $('tle-modal-total').textContent = matches.length.toLocaleString();
  $('tle-modal-page-current').textContent = (tleModalPage + 1).toLocaleString();
  $('tle-modal-page-total').textContent   = totalPages.toLocaleString();
  // Disable arrow buttons at the boundaries so the user can't step past.
  $('tle-modal-prev').disabled = tleModalPage <= 0;
  $('tle-modal-next').disabled = tleModalPage >= totalPages - 1;
}

// Wire up the open/close + filter input + dismissal handlers.  Defer to
// DOMContentLoaded so the modal markup is guaranteed to exist when these
// listeners attach.
(function setupTleRepo() {
  function bind() {
    $('tle-repo-btn')?.addEventListener('click', openTleRepo);
    $('tle-modal-close')?.addEventListener('click', closeTleRepo);
    // Filter changes always send the user back to page 1 — otherwise
    // they'd be staring at page 7 of a 2-page filtered result.
    $('tle-modal-filter')?.addEventListener('input', () => {
      tleModalPage = 0;
      renderTleModalRows();
      // Scroll the table back to the top so the new first match is in view.
      const body = document.querySelector('.tle-modal-body');
      if (body) body.scrollTop = 0;
    });
    // Pagination arrows.  Clamped inside renderTleModalRows() too as a
    // belt-and-braces against stale state.
    $('tle-modal-prev')?.addEventListener('click', () => {
      if (tleModalPage <= 0) return;
      tleModalPage--;
      renderTleModalRows();
      const body = document.querySelector('.tle-modal-body');
      if (body) body.scrollTop = 0;
    });
    $('tle-modal-next')?.addEventListener('click', () => {
      tleModalPage++;
      renderTleModalRows();
      const body = document.querySelector('.tle-modal-body');
      if (body) body.scrollTop = 0;
    });
    // Tap on the modal backdrop (anywhere outside the card) → close.
    $('tle-repo-modal')?.addEventListener('click', e => {
      if (e.target.id === 'tle-repo-modal') closeTleRepo();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('tle-repo-modal').hidden) closeTleRepo();
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();

// =========================================================================
// Alpha-5 catalogue modal — the objects whose catalog number has outgrown
// the classic 5-digit TLE field.
//
// The classic TLE stores the NORAD catalog number in five columns → a hard
// ceiling of 99 999.  The real catalogue passed that, so the "Alpha-5"
// scheme turns the FIRST of those five columns into a letter: A–Z, skipping
// I and O (to avoid 1/0 confusion), where A=10 … Z=33.  The field therefore
// now spans 100000 ("A0000") through 339999 ("Z9999").  satellite.js decodes
// these natively, so NAZAR already propagates them; this view isolates,
// decodes and explains them.
// =========================================================================

// Letters used, in value order.  Index 0 (⇒ "A") represents the 100000-block.
const A5_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // deliberately no I, no O

// Five-char line-1 catalog field (cols 3–7) → integer NORAD id, or NaN.
function alpha5ToNorad(field) {
  const s = String(field || '').trim();
  if (/^\d{1,5}$/.test(s)) return parseInt(s, 10);          // classic numeric
  const idx = A5_LETTERS.indexOf(s[0]);
  if (idx === -1) return NaN;                               // leading I/O or junk
  if (!/^\d{4}$/.test(s.slice(1))) return NaN;
  return (idx + 10) * 10000 + parseInt(s.slice(1), 10);
}

// True when a catalog field uses the Alpha-5 extension (a leading letter).
function isAlpha5Field(field) {
  return /^[A-HJ-NP-Z]/.test(String(field || '').trim());
}
function catalogField(l1) { return l1 ? l1.slice(2, 7) : ''; }

const ALPHA5_PAGE_SIZE = 100;
let alpha5Matches   = null;   // [{ t, field, norad, intlId }]
let alpha5MaxNumeric = 0;     // highest classic (numeric) catalog seen, for the empty state
let alpha5Page      = 0;

async function openAlpha5() {
  const modal = $('alpha5-modal');
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => modal.classList.add('shown'), 16);
  alpha5Page = 0;

  // Share the TLE-repo fetch cache; load it here if Alpha-5 is opened first.
  if (!tleModalCache) {
    $('alpha5-rows').innerHTML = '<tr><td colspan="7" class="hint">Loading TLE catalogue…</td></tr>';
    $('alpha5-count').textContent = '…';
    $('alpha5-scanned').textContent = '…';
    $('alpha5-source').textContent = '…';
    try {
      const result = await window.Argos.fetchTLEs();
      tleModalCache = result.tles;
      tleModalSource = result.source;
    } catch (e) {
      $('alpha5-rows').innerHTML = `<tr><td colspan="7" class="hint">TLE fetch failed: ${esc(e.message)}</td></tr>`;
      return;
    }
  }
  buildAlpha5Matches();
  $('alpha5-source').textContent = tleModalSource;
  renderAlpha5Rows();
}

function buildAlpha5Matches() {
  alpha5Matches = [];
  alpha5MaxNumeric = 0;
  for (const t of tleModalCache) {
    const field = catalogField(t.l1);
    if (isAlpha5Field(field)) {
      alpha5Matches.push({ t, field, norad: alpha5ToNorad(field), intlId: parseIntlIdFromTLE(t.l1) });
    } else {
      const n = parseInt(field, 10);
      if (Number.isFinite(n)) alpha5MaxNumeric = Math.max(alpha5MaxNumeric, n);
    }
  }
  // Show the newest (highest catalog number) first.
  alpha5Matches.sort((a, b) => b.norad - a.norad);
}

function closeAlpha5() {
  const modal = $('alpha5-modal');
  modal.classList.remove('shown');
  modal.setAttribute('aria-hidden', 'true');
  setTimeout(() => { modal.hidden = true; }, 220);
}

// Curated "interesting facts" for the object families that dominate the
// post-99,999 catalogue — the mega-constellations whose launch volume is
// exactly why Alpha-5 numbering became necessary.  Matched by TLE name;
// anything unmatched falls back to remarksFor() (purpose · launch · orbit).
const A5_NOTABLE = [
  [/^STARLINK/i,                          'SpaceX’s Starlink — the largest satellite constellation ever flown (well over 6,000 active). Its relentless launch cadence is the single biggest reason the catalogue blew past the 5-digit ceiling and needed Alpha-5.'],
  [/^(GUOWANG|GW[- ]|SATNET)/i,           'Part of China’s state-backed “Guowang” (国网) LEO mega-constellation — licensed for roughly 13,000 satellites; a flagship driver of the recent surge in newly-catalogued objects.'],
  [/^(QIANFAN|G60|THOUSAND ?SAILS|SPACESAIL)/i, 'Part of China’s commercial “Qianfan / Thousand Sails” (G60) broadband mega-constellation — thousands planned, contributing heavily to Alpha-5-era catalogue growth.'],
  [/^ONEWEB/i,                            'Eutelsat OneWeb LEO broadband constellation (~630 satellites) — one of the mega-constellations that helped exhaust the classic 5-digit catalogue.'],
  [/^KUIPER/i,                            'Amazon “Leo” (formerly Project Kuiper) LEO broadband constellation, deploying toward ~3,200 satellites — another contributor to the post-100,000 numbering.'],
];

// Interesting fact for one Alpha-5 object: a curated constellation note if the
// name matches, else the same purpose/launch/orbit note the Previously-Tracked
// pop-up derives, computed from whatever SATCAT metadata is joined on the
// decoded id.
function alpha5RemarksFor(m, rec) {
  for (const [re, txt] of A5_NOTABLE) if (re.test(m.t.name)) return txt;
  return remarksFor({
    name:        m.t.name,
    launchDate:  rec.launchDate,
    apogee:      rec.apogee,
    perigee:     rec.perigee,
    inclination: rec.inclination,
  });
}

// "Last seen": the live-feed stamp if the object is in the cumulative DB, else
// the element-set epoch (these objects are by definition in the current feed —
// that is how they reached this list).
function alpha5LastSeen(m, rec) {
  if (rec && rec.lastSeen) return fmtLastSeen(rec.lastSeen);
  const ep = parseTLEEpoch(m.t.l1);
  return ep ? ep.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' }) : 'live feed';
}

// Renders both Alpha-5 tables from one shared, filtered, paginated slice:
//   #alpha5-facts-rows — Previously-Tracked-style catalogue + facts view
//   #alpha5-rows       — raw two-line elements
function renderAlpha5Rows() {
  if (!alpha5Matches) return;
  const q = $('alpha5-filter').value.trim().toLowerCase();
  const now = Date.now();

  $('alpha5-count').textContent   = alpha5Matches.length.toLocaleString();
  $('alpha5-scanned').textContent = tleModalCache.length.toLocaleString();

  const matches = q
    ? alpha5Matches.filter(m =>
        `${m.t.name} ${m.field} ${m.norad} ${m.intlId}`.toLowerCase().includes(q))
    : alpha5Matches;

  const factsBody = $('alpha5-facts-rows');
  const tleBody   = $('alpha5-rows');

  if (!matches.length) {
    const msg = alpha5Matches.length === 0
      ? `No Alpha-5 objects in the current <strong>${esc(tleModalSource)}</strong> feed yet — the highest catalog number is <strong>${alpha5MaxNumeric.toLocaleString()}</strong>, still inside the classic 5-digit range. Both tables fill in automatically once objects numbered <strong>100,000+</strong> reach the active catalogue. The format reference below explains what to expect.`
      : 'No matches — try a different filter.';
    factsBody.innerHTML = `<tr><td colspan="5" class="hint">${msg}</td></tr>`;
    tleBody.innerHTML   = `<tr><td colspan="7" class="hint">${msg}</td></tr>`;
    $('alpha5-page-current').textContent = '1';
    $('alpha5-page-total').textContent   = '1';
    $('alpha5-prev').disabled = true;
    $('alpha5-next').disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(matches.length / ALPHA5_PAGE_SIZE));
  if (alpha5Page >= totalPages) alpha5Page = totalPages - 1;
  if (alpha5Page < 0)           alpha5Page = 0;
  const start = alpha5Page * ALPHA5_PAGE_SIZE;
  const end   = Math.min(start + ALPHA5_PAGE_SIZE, matches.length);

  const facts = [];
  const tles  = [];
  for (let i = start; i < end; i++) {
    const m = matches[i];
    const { t, field, norad, intlId } = m;
    const rec = db[norad] || {};

    // Catalogue & facts row (Previously-Tracked style).
    facts.push(`<tr>
      <td class="col-name">${esc(t.name)}</td>
      <td class="muted"><span class="mono">${Number.isFinite(norad) ? norad.toLocaleString() : '—'}</span> <span class="a5-desig">${esc(field)}</span><div class="mono" style="margin-top:3px">${esc(intlId || '—')}</div></td>
      <td class="col-country">${launchCountryCell(rec.launchSite)}</td>
      <td class="muted">${esc(alpha5LastSeen(m, rec))}</td>
      <td class="col-remarks">${esc(alpha5RemarksFor(m, rec))}</td>
    </tr>`);

    // Raw two-line-element row.
    const epoch = parseTLEEpoch(t.l1);
    const epochStr = epoch ? epoch.toISOString().slice(0, 16).replace('T', ' ') : '—';
    const ageDays = epoch ? (now - epoch.getTime()) / 86400000 : NaN;
    const band = Number.isFinite(ageDays) ? tleValidityBand(ageDays) : 'unknown';
    const ageLabel = Number.isFinite(ageDays)
      ? (ageDays < 1 ? `${(ageDays * 24).toFixed(1)} h` : `${ageDays.toFixed(1)} d`)
      : '—';
    tles.push(`<tr>
      <td class="tle-cell"><div>${esc(t.l1)}</div><div>${esc(t.l2)}</div></td>
      <td>${esc(t.name)}</td>
      <td class="mono"><span class="a5-desig">${esc(field)}</span></td>
      <td class="mono">${Number.isFinite(norad) ? norad.toLocaleString() : '—'}</td>
      <td class="mono">${esc(intlId || '—')}</td>
      <td class="mono">${esc(epochStr)} UTC</td>
      <td><span class="tle-validity tle-validity-${band}">${band}</span> <span class="muted mono">${esc(ageLabel)}</span></td>
    </tr>`);
  }
  factsBody.innerHTML = facts.join('');
  tleBody.innerHTML   = tles.join('');
  $('alpha5-page-current').textContent = (alpha5Page + 1).toLocaleString();
  $('alpha5-page-total').textContent   = totalPages.toLocaleString();
  $('alpha5-prev').disabled = alpha5Page <= 0;
  $('alpha5-next').disabled = alpha5Page >= totalPages - 1;
}

(function setupAlpha5() {
  function bind() {
    // Populate the decoder cheat-sheet grid (A=10 … Z=33) once.
    const map = $('alpha5-map');
    if (map && !map.childElementCount) {
      map.innerHTML = A5_LETTERS.split('')
        .map((c, i) => `<span><b>${c}</b>=${i + 10}</span>`).join('');
    }
    $('alpha5-btn')?.addEventListener('click', openAlpha5);
    $('alpha5-close')?.addEventListener('click', closeAlpha5);
    $('alpha5-filter')?.addEventListener('input', () => {
      alpha5Page = 0;
      renderAlpha5Rows();
      const body = $('alpha5-modal')?.querySelector('.tle-modal-body');
      if (body) body.scrollTop = 0;
    });
    $('alpha5-prev')?.addEventListener('click', () => {
      if (alpha5Page <= 0) return;
      alpha5Page--;
      renderAlpha5Rows();
      const body = $('alpha5-modal')?.querySelector('.tle-modal-body');
      if (body) body.scrollTop = 0;
    });
    $('alpha5-next')?.addEventListener('click', () => {
      alpha5Page++;
      renderAlpha5Rows();
      const body = $('alpha5-modal')?.querySelector('.tle-modal-body');
      if (body) body.scrollTop = 0;
    });
    $('alpha5-modal')?.addEventListener('click', e => {
      if (e.target.id === 'alpha5-modal') closeAlpha5();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('alpha5-modal').hidden) closeAlpha5();
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();

// =========================================================================
// PDF export — "download-ready" snapshot of the catalogue + every TLE the
// page is propagating from, date/time-stamped.  Wired to #pdf-btn, which
// boot() un-disables once the page has fully loaded.
//
// Uses jsPDF + jspdf-autotable (loaded from CDN in sat-stats.html).  The
// body is built from `filteredRows` — i.e. exactly what the table is
// showing (honouring any active country/search filter) — joined to the
// raw TLE lines by NORAD ID.
// =========================================================================

function enablePdfButton() {
  const btn = $('pdf-btn');
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = '⬇ PDF';
  btn.title = 'Download a date-stamped PDF of the whole catalogue, including every TLE';
}

// Two clock-aligned strings for the cover stamp: UTC and IST (the site's
// reference zones), plus a compact filename token from local time.
function pdfStamps() {
  const now = new Date();
  const utc = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const ist = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium',
  }).format(now) + ' IST';
  const p = n => String(n).padStart(2, '0');
  const file = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
             + `-${p(now.getHours())}${p(now.getMinutes())}`;
  return { utc, ist, file };
}

function generateSatStatsPDF() {
  const JsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!JsPDF) { alert('PDF library is still loading — please try again in a moment.'); return; }
  if (!filteredRows.length) { alert('No satellites to export yet — let the page finish loading.'); return; }

  // NORAD → raw TLE lines, from the live/bundled set captured at boot.
  const tleByNorad = new Map();
  for (const t of lastTLEs) tleByNorad.set(t.noradId, t);

  const stamp = pdfStamps();
  const ownerFilter = $('filter-owner')?.value || '';
  const searchTerm  = $('filter')?.value.trim() || '';
  const filterNote  = [
    ownerFilter ? `Country = ${COUNTRY[ownerFilter]?.name || ownerFilter}` : '',
    searchTerm  ? `Search = "${searchTerm}"` : '',
  ].filter(Boolean).join('   ·   ') || 'No filter — full cumulative catalogue';

  let withTle = 0;
  const body = filteredRows.map(r => {
    const t = tleByNorad.get(r.noradId);
    let tleCell = '—';
    if (t && t.l1 && t.l2) {
      withTle++;
      const epoch = parseTLEEpoch(t.l1);
      const epochTag = epoch ? `epoch ${epoch.toISOString().slice(0, 10)}` : '';
      tleCell = `${t.l1}\n${t.l2}${epochTag ? '\n' + epochTag : ''}`;
    }
    return [
      r.name,
      String(r.noradId),
      r.intlId || '—',
      COUNTRY[r.owner]?.name || r.owner || '—',
      (typeof LAUNCH_SITE !== 'undefined' && LAUNCH_SITE[r.launchSite]?.name) || r.launchSite || '—',
      r.decayed ? 'DECAYED' : 'ACTIVE',
      tleCell,
    ];
  });

  const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // ---- Cover block (drawn on page 1 above the table) -----------------
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(20, 28, 42);
  doc.text('NAZAR · SatStats Cumulative Catalogue', 12, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(70, 80, 95);
  doc.text(`Generated  ${stamp.utc}   ·   ${stamp.ist}`, 12, 23);
  doc.text(
    `Satellites: ${filteredRows.length.toLocaleString()}   ·   `
    + `With current TLE: ${withTle.toLocaleString()}   ·   `
    + `TLE source: ${lastSourceTag || 'snapshot'}`,
    12, 28.5,
  );
  doc.text(filterNote, 12, 34);

  // ---- The table -----------------------------------------------------
  doc.autoTable({
    startY: 39,
    head: [['Name', 'NORAD', "Int'l ID", 'Country', 'Launch Site', 'Status', 'TLE  (line 1 / line 2 / epoch)']],
    body,
    theme: 'striped',
    margin: { left: 8, right: 8 },
    styles: { fontSize: 6, cellPadding: 1, overflow: 'linebreak', valign: 'top', textColor: [25, 33, 46] },
    headStyles: { fillColor: [13, 27, 42], textColor: [220, 232, 245], fontSize: 6.5 },
    alternateRowStyles: { fillColor: [244, 247, 251] },
    columnStyles: {
      0: { cellWidth: 48 },
      1: { cellWidth: 15 },
      2: { cellWidth: 20 },
      3: { cellWidth: 34 },
      4: { cellWidth: 32 },
      5: { cellWidth: 16 },
      6: { cellWidth: 'auto', font: 'courier', fontSize: 5, textColor: [40, 60, 90] },
    },
    didDrawPage: data => {
      // Footer: page number + the same generation stamp on every page.
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(120, 130, 145);
      const page = doc.internal.getNumberOfPages();
      doc.text(`NAZAR · generated ${stamp.utc}`, 8, pageH - 4);
      doc.text(`Page ${data.pageNumber} of ${page}`, pageW - 8, pageH - 4, { align: 'right' });
    },
  });

  doc.save(`NAZAR-SatStats-${stamp.file}.pdf`);
}

// Bind the export button.  The heavy autotable build blocks the main
// thread, so flip the label to "Generating…" and yield one frame before
// starting so the browser actually paints that state first.
(function bindPdf() {
  function bind() {
    const btn = $('pdf-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      // A full-catalogue export is ~1 page per 10 satellites and can run to
      // tens of MB / a minute of work — warn before committing to a big one
      // so it's never a surprise.  A filtered view exports straight away.
      const n = (typeof filteredRows !== 'undefined') ? filteredRows.length : 0;
      if (n > 4000 && !confirm(
            `Export all ${n.toLocaleString()} satellites and their TLEs to one PDF?\n\n`
          + `That is roughly ${Math.ceil(n * 0.1).toLocaleString()} pages and may take up to a minute `
          + `to build a large file.\n\n`
          + `Tip: choose a country or type in the filter box first to export a smaller subset.`)) {
        return;
      }
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = '⏳ Generating…';
      setTimeout(() => {
        try { generateSatStatsPDF(); }
        catch (e) { console.error('PDF export failed:', e); alert('PDF export failed: ' + e.message); }
        finally { btn.disabled = false; btn.textContent = original; }
      }, 60);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
