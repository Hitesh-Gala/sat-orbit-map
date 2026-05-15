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
    const cached = cacheGet('argos.tle', CACHE_TTL.tle);
    if (cached) return { tles: cached, source: 'cache' };

    try {
      const r = await fetch(TLE_URL);
      if (r.ok) {
        const parsed = parseTLE(await r.text());
        if (parsed.length > 100) {
          cacheSet('argos.tle', parsed);
          return { tles: parsed, source: 'celestrak' };
        }
      } else {
        console.warn(`Live TLE fetch failed (HTTP ${r.status}); using bundled snapshot.`);
      }
    } catch (e) {
      console.warn(`Live TLE fetch threw: ${e.message}; using bundled snapshot.`);
    }

    const r2 = await fetch(TLE_FALLBACK_URL);
    if (!r2.ok) throw new Error(`Bundled TLE missing (HTTP ${r2.status})`);
    return { tles: parseTLE(await r2.text()), source: 'bundled' };
  }

  async function fetchChinaSatcat() {
    const cached = cacheGet('argos.satcat.prc', CACHE_TTL.satcat);
    if (cached) return cached;

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
    cacheSet('argos.satcat.prc', out);
    return out;
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
