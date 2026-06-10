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
    [/^TJSW|^TJS[- ]/i,         'GEO comms / signals (TJS series)'],
    [/^LUDI TANCE|LT[- ]/i,     'Synthetic-aperture radar (SAR)'],
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

  function parseTLE(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const out = [];
    for (let i = 0; i < lines.length - 2; i++) {
      if (lines[i + 1] && lines[i + 1][0] === '1' && lines[i + 2] && lines[i + 2][0] === '2') {
        const name = lines[i].trim();
        const l1 = lines[i + 1];
        const l2 = lines[i + 2];
        const noradId = parseInt(l1.slice(2, 7), 10);
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

  async function fetchTLEs() {
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
          cacheSet('argos.tle.v2', parsed);
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
    const cached = cacheGet('argos.satcat.prc.v2', CACHE_TTL.satcat);
    if (cached && cached.length) return cached;

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
          if (fromBundle.length) {
            cacheSet('argos.satcat.prc.v2', fromBundle);
            return fromBundle;
          }
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
    if (out.length) {
      cacheSet('argos.satcat.prc.v2', out);
      return out;
    }

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
  function makeSatrecs(tles) {
    const out = [];
    const seen = new Set();
    for (const t of tles) {
      if (seen.has(t.noradId)) continue;
      seen.add(t.noradId);
      try {
        out.push({ name: t.name, noradId: t.noradId, rec: satellite.twoline2satrec(t.l1, t.l2) });
      } catch { /* skip malformed */ }
    }
    return out;
  }

  return {
    OBSERVER, EARTH_R_KM,
    inferPurpose, parseTLE, propagate, makeSatrecs,
    fetchTLEs, fetchChinaSatcat,
  };
})();
