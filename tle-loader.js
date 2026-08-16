// Argos shared data layer.
// Used by both the 3-D globe (app.js) and the 2-D map views (2d-views.js).
// Exposes the global `Argos` namespace.
//
// Source: CelesTrak GP catalog (TLE) + SATCAT records. Math via satellite.js.

window.Argos = (function () {
  const OBSERVER  = { lat: 28.6139, lon: 77.2090, alt: 0.216 }; // New Delhi (km)
  const EARTH_R_KM = 6371;

  // CelesTrak endpoints (CORS-enabled). gp.php applies an IP-based rate
  // limit, so we fall back to a bundled snapshot at data/active.tle when
  // the live feed returns 403 or is unreachable.
  const TLE_URL          = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle';
  const TLE_FALLBACK_URL = 'data/active.tle';
  const EXTRA_TLE_URL    = 'data/extra.tle';   // hand-added objects missing from the feed
  const SATCAT_BASE      = 'https://celestrak.org/satcat/records.php';

  // SATCAT records.php requires a NAME prefix per request. We fan-out across
  // the program designations covering >95% of active PRC payloads, then
  // filter responses by OWNER==='PRC'.
  const CN_NAME_PREFIXES = [
    'BEIDOU', 'YAOGAN', 'GAOFEN', 'FENGYUN', 'FY-', 'HAIYANG', 'HY-',
    'TIANGONG', 'TIANHE', 'WENTIAN', 'MENGTIAN', 'TIANZHOU', 'SHENZHOU',
    'TIANLIAN', 'SHIYAN', 'SHIJIAN', 'SJ-', 'ZIYUAN', 'ZY-',
    'CHINASAT', 'ZHONGXING', 'ZX-', 'APSTAR', 'CBERS', 'XINGYUN',
    'HONGYAN', 'GUOWANG', 'QIANFAN', 'TJS', 'TJSW', 'TIANHUI',
    'JILIN', 'KUAIZHOU', 'KZ-', 'LUDI TANCE', 'LT-', 'MOZI', 'QUESS',
    'XUNTIAN', 'CSS', 'DAMPE', 'HXMT', 'CENTISPACE', 'PIESAT',
    'CHANG', 'TIANXING', 'HEAD', 'XINGSHIDAI', 'YINHE',
    'YUNHAI', 'HONGTU', 'TIANQI', 'GEESAT', 'ZHANGHENG', 'SVOM',
    'TIANWEN', 'TIANMU', 'HONGHU', 'KUAFU', 'GECAM', 'EINSTEIN',
  ];

  // Inferred mission category from Chinese satellite name prefix.
  // SATCAT itself does not carry a "purpose" field; these are the publicly
  // stated mission families for each program designation.
  const CN_PURPOSE = [
    [/^BEIDOU/i,                'Navigation (BeiDou PNT)'],
    [/^FENGYUN|^FY[- ]/i,       'Meteorology (weather)'],
    [/^YAOGAN/i,                'Earth observation (recon, military)'],
    [/^GAOFEN/i,                'High-resolution Earth observation (CHEOS)'],
    [/^HAIYANG|^HY[- ]/i,       'Ocean observation'],
    [/^TIANGONG|TIANHE|WENTIAN|MENGTIAN|^CSS/i, 'Crewed space station module'],
    [/^TIANZHOU/i,              'Cargo resupply (CSS)'],
    [/^SHENZHOU/i,              'Crewed spacecraft'],
    [/^TIANLIAN/i,              'Data relay (TDRSS-class)'],
    [/^SHIYAN/i,                'Experimental / technology demo'],
    [/^SHIJIAN|^SJ[- ]/i,       'Experimental / technology demo'],
    [/^ZIYUAN|^ZY[- ]/i,        'Land resources / mapping'],
    [/^CHINASAT|^ZHONGXING|^ZX[- ]/i, 'Communications (state telecom)'],
    [/^APSTAR/i,                'Communications (commercial)'],
    [/^CBERS/i,                 'Earth resources (China-Brazil)'],
    [/^XINGYUN/i,               'IoT / narrowband comms'],
    [/^HONGYAN/i,               'LEO communications'],
    [/^GUOWANG/i,               'LEO broadband constellation (Guowang)'],
    [/^QIANFAN|^G60/i,          'LEO broadband constellation (Qianfan/G60)'],
    [/^XUNTIAN/i,               'Astrophysics'],
    [/^MOZI|QUESS/i,            'Quantum communications experiment'],
    [/^DAMPE|HXMT|EINSTEIN PROBE|EP[- ]/i, 'Astrophysics / cosmic rays'],
    [/^DFH|^DONGFANGHONG/i,     'Communications (legacy)'],
    [/^LING|^XW[- ]|^TIANXING/i,'Amateur / experimental smallsat'],
    [/^TJSW|^TJS[- ]/i,         'GEO early-warning / SIGINT (TJS series)'],
    [/^LUDI TANCE|LT[- ]/i,     'Synthetic-aperture radar (SAR)'],
    [/^TIANHUI/i,               'Surveying & mapping (geodesy)'],
    [/^YUNHAI/i,                'Atmospheric / marine environment'],
    [/^HONGTU|^PIESAT/i,        'Commercial InSAR radar mapping'],
    [/^TIANQI/i,                'Narrowband IoT data relay'],
    [/^GEESAT/i,                'IoT for connected vehicles'],
    [/^HONGHU/i,                'LEO broadband constellation'],
    [/^TIANWEN/i,               'Planetary / deep-space exploration'],
    [/^TIANMU/i,                'Commercial meteorology (GNSS-RO)'],
    [/^ZHANGHENG/i,             'Seismo-electromagnetic research'],
    [/^SVOM/i,                  'Gamma-ray burst astronomy (China–France)'],
    [/^KUAFU|^ASO[- ]?S/i,      'Solar observatory'],
    [/^GECAM/i,                 'Gamma-ray / GW monitor'],
    [/^EINSTEIN|^TIANGUAN/i,    'Time-domain X-ray astronomy'],
    [/^TAIJI/i,                 'Gravitational-wave tech demo'],
    [/^XIHE/i,                  'Solar Hα observatory'],
    [/^MACAU/i,                 'Geomagnetic / scientific'],
    [/^ROCKET|R\/B/i,           'Rocket body (debris)'],
  ];
  function inferPurpose(name) {
    for (const [re, p] of CN_PURPOSE) if (re.test(name)) return p;
    return 'Not publicly stated';
  }

  // localStorage cache — CelesTrak rate-limits aggressively; refetch sparingly.
  const CACHE_TTL = {
    tle:    6 * 3600 * 1000,
    satcat: 24 * 3600 * 1000,
  };
  function cacheGet(key, ttlMs) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { t, v } = JSON.parse(raw);
      if (Date.now() - t > ttlMs) return null;
      return v;
    } catch { return null; }
  }
  function cacheSet(key, v) {
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch {}
  }

  // =======================================================================
  // TLE refresh log — a client-side record of which element sets changed
  // between successive live pulls of the active catalogue.
  //
  // There is no server to diff refreshes for us, so we capture them at the
  // exact moment a fresh CelesTrak pull is about to replace the cached set:
  // the cache we're overwriting holds each object's PREVIOUS two lines, the
  // incoming set holds the NEW ones.  Only objects whose lines actually
  // changed are logged.  No separate full-catalogue snapshot is stored (the
  // cache itself is the baseline), so this costs no extra localStorage beyond
  // the capped log.  Consumed by Sat-Stats' "TLE Analytics" pop-up.
  // =======================================================================
  const TLE_CACHE_KEY    = 'argos.tle.v2';
  const REFRESH_LOG_KEY  = 'nazar.tle.refreshlog.v1';
  const REFRESH_LOG_MAX  = 1000;                    // newest N kept / shown
  const REFRESH_LOG_MS   = 15 * 24 * 3600 * 1000;   // 15-day window

  function loadRefreshLog() {
    try {
      const arr = JSON.parse(localStorage.getItem(REFRESH_LOG_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function saveRefreshLog(arr) {
    try { localStorage.setItem(REFRESH_LOG_KEY, JSON.stringify(arr)); }
    catch {
      // Over quota — persist the newest half so recent refreshes still stick.
      try { localStorage.setItem(REFRESH_LOG_KEY, JSON.stringify(arr.slice(0, Math.floor(arr.length / 2)))); } catch {}
    }
  }

  // Raw (TTL-ignoring) read of the cached parsed catalogue.  cacheGet() returns
  // null once the 6 h TTL lapses, but the bytes are still there — and a lapsed
  // cache is exactly the "previous refresh" we want to diff the new pull against.
  function readRawTLECache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TLE_CACHE_KEY) || 'null');
      return parsed && Array.isArray(parsed.v) ? parsed.v : null;
    } catch { return null; }
  }

  // Epoch substring (line-1 cols 19–32) — the per-object dedupe discriminator.
  function epochField(l1) { return (l1 || '').slice(18, 32); }

  // Compare two parsed TLE sets; append an entry for every object whose two
  // lines changed.  `when` is the observation instant we stamp the refresh
  // with.  Deduped by (noradId + new-epoch) so re-runs over the same data never
  // double-log.  Returns the number of new entries added.
  function diffAndLog(prev, next, when) {
    if (!Array.isArray(prev) || !prev.length || !Array.isArray(next) || !next.length) return 0;
    const prevById = new Map();
    for (const t of prev) if (Number.isFinite(t.noradId)) prevById.set(t.noradId, t);

    const log = loadRefreshLog();
    const seen = new Set(log.map(e => e.id + '|' + epochField(e.n1)));
    const fresh = [];
    for (const t of next) {
      if (!Number.isFinite(t.noradId)) continue;
      const old = prevById.get(t.noradId);
      if (!old) continue;                                   // brand-new object, not a "refresh"
      if (old.l1 === t.l1 && old.l2 === t.l2) continue;     // unchanged
      const key = t.noradId + '|' + epochField(t.l1);
      if (seen.has(key)) continue;                          // this exact new element set already logged
      seen.add(key);
      fresh.push({ id: t.noradId, nm: t.name, o1: old.l1, o2: old.l2, n1: t.l1, n2: t.l2, ts: when });
      if (fresh.length >= REFRESH_LOG_MAX) break;           // one cycle can't exceed the cap
    }
    if (!fresh.length) return 0;
    const cutoff = when - REFRESH_LOG_MS;
    const pruned = fresh.concat(log).filter(e => e.ts >= cutoff).slice(0, REFRESH_LOG_MAX);
    saveRefreshLog(pruned);
    return fresh.length;
  }

  // The bundled snapshot re-parsed, used as the baseline for the very first
  // live pull on a fresh browser (no prior cache to diff against).  Up to ~6 h
  // stale, so the diff reads as "what CelesTrak has refreshed since the bundle".
  async function fetchBaselineFromBundle() {
    try {
      const r = await fetch(TLE_FALLBACK_URL, { cache: 'no-cache' });
      if (!r.ok) return null;
      return parseTLE(await r.text());
    } catch { return null; }
  }

  // Diff off the main thread so it never delays the caller's first paint.
  function scheduleRefreshDiff(prevCache, next) {
    setTimeout(async () => {
      try {
        let prev = prevCache;
        if (!prev || !prev.length) prev = await fetchBaselineFromBundle();
        diffAndLog(prev, next, Date.now());
      } catch {}
    }, 0);
  }

  // Public: the refresh log, newest-first, pruned to the 15-day window and the
  // row cap.  Prunes on read too, so a stale tail never surfaces even if
  // nothing has refreshed in a while.
  function getTLERefreshLog() {
    const cutoff = Date.now() - REFRESH_LOG_MS;
    return loadRefreshLog().filter(e => e.ts >= cutoff).slice(0, REFRESH_LOG_MAX);
  }

  // One-time seed so the analytics table isn't empty on a fresh visit.  If the
  // log has no entries yet but a catalogue is already cached, diff the bundled
  // snapshot (older baseline) against that cached set — i.e. "what CelesTrak
  // has refreshed since the shipped snapshot".  A no-op once any refresh has
  // been captured, and deduped against later live pulls by (noradId + epoch).
  async function ensureRefreshBootstrap() {
    if (getTLERefreshLog().length) return 0;
    const cache = readRawTLECache();
    if (!cache || !cache.length) return 0;
    const base = await fetchBaselineFromBundle();
    return diffAndLog(base, cache, Date.now());
  }

  // The classic TLE catalog field is 5 columns, so it tops out at 99999.  Past
  // that, Space-Track/CelesTrak switched to "Alpha-5": the first column becomes
  // a letter (A–Z, skipping I and O), A=10 … Z=33, covering 100000–339999.
  //
  // A plain parseInt() returns NaN for those, and a NaN id is actively harmful:
  // makeSatrecs dedupes through a Set, and Set treats NaN as equal to NaN, so
  // the first Alpha-5 object claims the slot and EVERY other Alpha-5 object is
  // silently dropped from every globe.  Decode them to real numbers instead.
  const A5_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // deliberately no I, no O
  function catalogNumber(field) {
    const s = String(field || '').trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const idx = A5_LETTERS.indexOf(s[0]);
    if (idx === -1 || !/^\d{4}$/.test(s.slice(1))) return NaN;
    return (idx + 10) * 10000 + parseInt(s.slice(1), 10);
  }

  function parseTLE(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const out = [];
    for (let i = 0; i < lines.length - 2; i++) {
      if (lines[i + 1] && lines[i + 1][0] === '1' && lines[i + 2] && lines[i + 2][0] === '2') {
        const name = lines[i].trim();
        const l1 = lines[i + 1];
        const l2 = lines[i + 2];
        const noradId = catalogNumber(l1.slice(2, 7));
        out.push({ name, l1, l2, noradId });
        i += 2;
      }
    }
    return out;
  }

  async function pmap(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx], idx);
      }
    });
    await Promise.all(workers);
    return out;
  }

  // Supplemental TLEs — data/extra.tle.  CelesTrak's GROUP=active list lags
  // (or omits) freshly-launched objects, so a satellite can exist and be
  // trackable while simply not being in the feed yet; nothing downstream can
  // draw what it never received.  Anything in this hand-maintained file is
  // merged on top of the live/bundled catalogue on every load (never cached,
  // so editing the file takes effect immediately).  Missing file = no-op.
  let extraTLEs = null;
  async function fetchExtraTLEs() {
    if (extraTLEs) return extraTLEs;
    try {
      const r = await fetch(EXTRA_TLE_URL, { cache: 'no-cache' });
      if (!r.ok) return (extraTLEs = []);
      extraTLEs = parseTLE(await r.text());
    } catch { extraTLEs = []; }
    return extraTLEs;
  }

  async function fetchTLEs() {
    const base = await fetchBaseTLEs();
    const extra = await fetchExtraTLEs();
    if (!extra.length) return base;
    // Only add objects the catalogue doesn't already carry, so once CelesTrak
    // starts publishing one it wins and we don't double-plot it.
    const seen = new Set(base.tles.map(t => t.noradId));
    const add = extra.filter(t => !seen.has(t.noradId));
    if (!add.length) return base;
    // Keep `source` untouched — callers map it to the live/cached/bundled tag.
    return { tles: base.tles.concat(add), source: base.source };
  }

  async function fetchBaseTLEs() {
    const cached = cacheGet('argos.tle.v2', CACHE_TTL.tle);
    if (cached) return { tles: cached, source: 'cache' };

    try {
      // 4-second abort guard.  On a fresh machine / new IP CelesTrak
      // often hangs (rather than fast-403ing) and the whole first
      // paint used to wait on it.  The bundled snapshot is at most
      // ~6 h stale (refresh-data workflow), so cutting over fast is
      // the right trade.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(TLE_URL, { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) {
        const parsed = parseTLE(await r.text());
        if (parsed.length > 100) {
          const prevCache = readRawTLECache();   // the set we're about to replace
          cacheSet(TLE_CACHE_KEY, parsed);
          scheduleRefreshDiff(prevCache, parsed);
          return { tles: parsed, source: 'celestrak' };
        }
      } else {
        console.warn(`Live TLE fetch failed (HTTP ${r.status}); using bundled snapshot.`);
      }
    } catch (e) {
      console.warn(`Live TLE fetch threw: ${e.message}; using bundled snapshot.`);
    }

    // cache:'no-cache' = revalidate with the server (If-Modified-Since
    // + ETag).  When the bundled file is unchanged the server returns
    // 304 and the browser serves its own cached body — fast.  When the
    // 6-hourly refresh-data workflow updates the file, the server
    // returns 200 with fresh bytes.  Without this, browsers that
    // cached an old (smaller) snapshot keep serving it indefinitely.
    const r2 = await fetch(TLE_FALLBACK_URL, { cache: 'no-cache' });
    if (!r2.ok) throw new Error(`Bundled TLE missing (HTTP ${r2.status})`);
    return { tles: parseTLE(await r2.text()), source: 'bundled' };
  }

  async function fetchChinaSatcat() {
    // Only trust the cache when it actually has data.  An empty array
    // here used to mean "every records.php fetch in the last call
    // 403'd" — caching that for 24 h is exactly how every BeiDou /
    // Yaogan / Fengyun ended up mis-classified as non-Chinese on the
    // main page after a single CelesTrak rate-limit hit.
    // A healthy PRC payload list is ~1,500 entries.  Anything far below that
    // is the residue of a rate-limited / partial fetch (or a cache written by
    // an older build) — trusting it for 24 h is exactly what mis-flags most
    // Chinese satellites as non-Chinese and collapses the main page's "over
    // India" count from ~150 to a handful.  Require a sane floor before we
    // trust the cache, so a stale tiny list can never shadow the bundled
    // snapshot; the next load simply rebuilds from data/satcat-active.json.
    const MIN_PRC = 300;
    const cached = cacheGet('argos.satcat.prc.v2', CACHE_TTL.satcat);
    if (cached && cached.length >= MIN_PRC) return cached;

    // Stage 1: bundled SATCAT snapshot.  data/satcat-active.json ships
    // every active payload with its OWNER field (refreshed every 6 h by
    // the refresh-data workflow); filter to OWNER==='PRC' and map the
    // compact { n, c, i, o, ls, ld } shape back to the records.php
    // shape so chinrepo.js + app.js's prcMeta loop don't care which
    // path the data came from.
    //
    // This used to be the *fallback* after a ~50-request live fan-out
    // to records.php — on a fresh machine / new IP that fan-out could
    // hang for 30–60 s and block the main page's first paint.  One
    // same-origin fetch of an at-most-6-h-stale file wins that trade
    // easily; the live fan-out is demoted to last resort below.
    try {
      const r2 = await fetch('data/satcat-active.json', { cache: 'no-cache' });
      if (r2.ok) {
        const arr = await r2.json();
        if (Array.isArray(arr)) {
          const fromBundle = [];
          for (const r of arr) {
            if (r.o !== 'PRC') continue;
            fromBundle.push({
              OBJECT_NAME:  r.n,
              NORAD_CAT_ID: r.c,
              OBJECT_ID:    r.i,
              OWNER:        r.o,
              LAUNCH_SITE:  r.ls,
              LAUNCH_DATE:  r.ld,
              DECAY_DATE:   r.dd || '',
              PERIOD:       r.p,
              INCLINATION:  r.inc,
              APOGEE:       r.a,
              PERIGEE:      r.pe,
              OBJECT_TYPE:  'PAY',
              OPS_STATUS_CODE: '',
            });
          }
          // Only cache a plausibly-complete list.  A short bundle (shouldn't
          // happen — the refresh workflow has its own floor) is returned
          // uncached so the next load retries rather than sticking for 24 h.
          if (fromBundle.length >= MIN_PRC) {
            cacheSet('argos.satcat.prc.v2', fromBundle);
            return fromBundle;
          }
          if (fromBundle.length) return fromBundle;
        }
      }
    } catch (e) {
      console.warn(`Bundled PRC SATCAT fetch threw: ${e.message}; trying live records.php.`);
    }

    // Stage 2 (last resort): live records.php fan-out by name prefix.
    // Only reached when the bundled snapshot is missing or corrupt.
    const arrays = await pmap(CN_NAME_PREFIXES, 4, async name => {
      try {
        const r = await fetch(`${SATCAT_BASE}?NAME=${encodeURIComponent(name)}&FORMAT=json`);
        if (!r.ok) return [];
        const txt = await r.text();
        try { return JSON.parse(txt); } catch { return []; }
      } catch { return []; }
    });

    const seen = new Set();
    const out = [];
    for (const arr of arrays) {
      if (!Array.isArray(arr)) continue;
      for (const r of arr) {
        if (r.OWNER !== 'PRC') continue;
        if (r.OBJECT_TYPE !== 'PAY') continue;
        if (r.DECAY_DATE) continue;
        if (seen.has(r.NORAD_CAT_ID)) continue;
        seen.add(r.NORAD_CAT_ID);
        out.push(r);
      }
    }
    // Same floor for the live fan-out: a rate-limited partial haul must not
    // be cached (it would shadow the good bundle for 24 h), though we still
    // return it in-memory as better-than-nothing for this one load.
    if (out.length >= MIN_PRC) {
      cacheSet('argos.satcat.prc.v2', out);
      return out;
    }
    if (out.length) return out;

    // Last-ditch: return whatever (possibly stale) cache we have, even
    // if empty, rather than throwing.  Better an empty CN tab than a
    // crashed page.
    return cached || [];
  }

  // Propagate one satrec to `now` and compute look-angles from `observer`.
  function propagate(rec, now, observer = OBSERVER) {
    const pv = satellite.propagate(rec, now);
    if (!pv || !pv.position) return null;
    const gmst = satellite.gstime(now);
    const gd  = satellite.eciToGeodetic(pv.position, gmst);
    const ecf = satellite.eciToEcf(pv.position, gmst);
    const obs = {
      longitude: satellite.degreesToRadians(observer.lon),
      latitude:  satellite.degreesToRadians(observer.lat),
      height:    observer.alt,
    };
    const look = satellite.ecfToLookAngles(obs, ecf);
    return {
      lat:   satellite.degreesLat(gd.latitude),
      lon:   satellite.degreesLong(gd.longitude),
      alt:   gd.height,
      az:    satellite.radiansToDegrees(look.azimuth),
      el:    satellite.radiansToDegrees(look.elevation),
      range: look.rangeSat,
    };
  }

  // Convert raw TLE entries into satrec-bearing tracking objects.
  // Dedupes by NORAD_CAT_ID — the CelesTrak GP feed and the bundled
  // snapshot occasionally carry the same satellite twice (e.g., when a
  // catalog crossover or stale fragment lingers), which used to surface
  // as repeated rows in ChinRepo and double dots on the globe.
  // International designator (COSPAR ID) from TLE line 1, cols 10-17 — e.g. the
  // raw "98067A" becomes "1998-067A" (2-digit year: 57-99 → 19xx, 00-56 → 20xx).
  function intlDesignator(l1) {
    const raw = (l1 || '').slice(9, 17).trim();
    const m = raw.match(/^(\d{2})(\d{3})([A-Z]{1,3})$/);
    if (!m) return raw;
    const yy = parseInt(m[1], 10);
    const year = yy < 57 ? 2000 + yy : 1900 + yy;
    return `${year}-${m[2]}${m[3]}`;
  }

  function makeSatrecs(tles) {
    const out = [];
    const seen = new Set();
    for (const t of tles) {
      // Only dedupe on a real id.  Set uses SameValueZero, where NaN equals
      // NaN — so deduping on an unparseable catalog field would collapse every
      // such object into a single entry (the bug that hid Alpha-5 satellites).
      if (Number.isFinite(t.noradId)) {
        if (seen.has(t.noradId)) continue;
        seen.add(t.noradId);
      }
      try {
        out.push({ name: t.name, noradId: t.noradId, intlId: intlDesignator(t.l1), rec: satellite.twoline2satrec(t.l1, t.l2) });
      } catch { /* skip malformed */ }
    }
    return out;
  }

  return {
    OBSERVER, EARTH_R_KM,
    inferPurpose, parseTLE, propagate, makeSatrecs, catalogNumber,
    fetchTLEs, fetchChinaSatcat, getTLERefreshLog, ensureRefreshBootstrap,
  };
})();
