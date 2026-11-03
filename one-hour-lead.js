// One Hour Lead — which satellites pass through the Land cone in the next hour.
//
// This was a pop-up inside Cone-Waffles.  It is a page now, so it can be
// opened, linked, reloaded and left open beside the globe; the cone and the
// moment arrive in the URL from Cone-Waffles and are editable here, so the
// page also stands on its own.
//
// From the chosen moment T, find every satellite that is inside the cone at
// some instant in [T, T + 1 h] and plot where it is at T.  The plot is an
// azimuthal-equidistant map centred on the site: true bearings, North up, and
// distance along the ground — square-root scaled, so the cone stays readable
// next to satellites half a world away.
//
// Each orbit is sampled once a minute in Earth-fixed coordinates.  Between two
// samples a satellite stays within half their separation of the midpoint, so
// a minute whose midpoint isn't that close to the cone can't hold a pass; the
// few minutes that are get checked second by second with the exact cone test.
//
// The cone itself — the frame, the axis, the hit test — comes from
// cone-geometry.js, the same file Cone-Waffles draws from, so the roster here
// and the hits on the globe there cannot drift apart.

const {
  EARTH_R_KM, DEG, COARSE_KM, escHtml, geodeticToECEF, sub, mag, dot,
  coneHit, coneCtx, nearCone, inConeAt, coneRim, convexHull, satGeo, compassPoint,
} = window.ConeGeom;

const LEAD_MIN       = 60;
const LEAD_STEP_MS   = 60000;
const LEAD_TRACK_MIN = 75;                 // hover track: at most this far past T
const LEAD_EXIT_STEP_MS = 20000;           // walk out of the cone in 20-second steps…
const LEAD_EXIT_MAX_MS  = 3 * 3600000;     // …and stop looking after three hours
const LEAD_R         = 260;                // plot radius in SVG units (viewBox ±300)
const LEAD_WINDOW_MS = LEAD_MIN * 60000;   // the hour the whole page is about
const ZONE_MAX       = 6;                  // clear zone: the last column is "6 or more"
// Pass boundaries are bisected to a tenth of a second rather than the whole
// second the two columns are rounded to.  The blocks come from two different
// satellites' edges landing next to each other, so a second of slack there
// mis-counts any block shorter than that - and the table's arithmetic is only
// worth printing if the short blocks are right too.
const ZONE_RES_MS    = 100;
const ZONE_HEADS = ['Clear — none in the cone', '1 satellite', '2 satellites', '3 satellites',
                    '4 satellites', '5 satellites', '6 or more'];
const IST_OFFSET_MS  = 5.5 * 3600000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WORLD_MAP_URL  = 'data/countries-110m.geojson?v=2';

const $ = id => document.getElementById(id);

// ==========================================================================
// What a satellite is for, and whether a dust-off clears it
// ==========================================================================
//
// THE RULE
//     dust-off clears the satellites whose only job is to carry traffic or
//     watch the weather — commercial and civil communications, the broadband
//     constellations, civil meteorology — and keeps everything that can look
//     at the ground or listen to it: military and intelligence payloads,
//     imaging and radar satellites, SIGINT/ELINT and RF geolocation, data
//     relays, and every object whose purpose is not publicly stated.
//
//     Military beats everything else.  A military payload is kept whatever
//     else it does, which is why DMSP survives a dust-off that clears NOAA:
//     both watch the weather, but only one of them is a defence asset.  For
//     the same reason the military communications satellites are a class of
//     their own and are kept — MILSTAR and SKYNET are not Intelsat.
//
// WHAT IT IS NOT
//     This classifies on the CATALOGUE NAME alone.  It is a heuristic, not an
//     assessment: a name that matches nothing is treated as unknown and kept,
//     and a payload flying under a cover designation (COSMOS, USA, TJS,
//     SHIYAN) is kept because the series is kept, not because its mission is
//     known.  The page says so on screen rather than implying more.
//
//     Keeping is the safe error, so every borderline case keeps.  Rocket
//     bodies and debris are the one class cleared for not sensing rather than
//     for carrying: a spent stage can neither see nor listen.
//
// Order matters — first match wins, and the military and sensing rules come
// before the carriers so that nothing military is swept up as "comms".
const CLASSES = [
  // --- Spent hardware ---------------------------------------------------
  [/\bR\/B\b|\bDEB\b|DEBRIS|\bAKM\b|\bPKM\b|ROCKET BODY|FAIRING|SHROUD/, 'Rocket body / debris', false],

  // --- Listens: RF collection and geolocation ---------------------------
  [/MENTOR|ADVANCED ORION|TRUMPET|MAGNUM|JUMPSEAT|INTRUDER|\bNOSS\b|PARCAE|TSELINA|LOTOS|PION-NKS|LIANA|ELISA|CERES[ -]\d|EMISAT|HAWKEYE 360|\bKLEOS\b|UNSEENLABS|\bBRO-\d|SIGINT|ELINT/, 'SIGINT / ELINT', true],
  [/LEMUR|EXACTVIEW|AISSAT|NORSAT|\bAIS\b|ADS-B|VESSELSAT|SPIRE/, 'Signals collection (AIS / ADS-B)', true],

  // --- Watches for launches, and watches other satellites ---------------
  [/SBIRS|\bDSP \d|\bSTSS\b|\bEKS\b|TUNDRA|KOSMOS-25\d\d|MIDAS/, 'Missile early warning', true],
  [/GSSAP|SAPPHIRE|\bSBSS\b|NEOSSAT|MYCROFT|\bANGELS\b|SHIJIAN-21|\bSJ-21\b|SHIJIAN-25|\bSJ-25\b|OLYMP|LUCH \(|LUCH-/, 'Space surveillance / inspection', true],

  // --- Military imaging and radar reconnaissance ------------------------
  [/^USA[ -]\d|^NROL|LACROSSE|\bONYX\b|\bMISTY\b|\bKH-\d|^OFEQ|^OFEK|TECSAR|^EROS[ -]|HELIOS [12]|^CSO-|SAR-LUPE|^SARAH[ -]|KONDOR|PERSONA|BARS-M|RESURS-P|\bARKON\b|YANTAR|NEITRON/, 'ISR / military imaging', true],
  [/^COSMOS|^KOSMOS/, 'Russian military (undeclared)', true],
  [/^YAOGAN/, 'Earth observation (recon, military)', true],
  [/^TJS-|^TJS |^SHIYAN|^SY-\d|^SHIJIAN|^SJ-\d/, 'Chinese experimental / undeclared payload', true],
  [/^GAOFEN|^GF-\d/, 'High-resolution Earth observation (CHEOS)', true],
  [/^RISAT|^EOS-\d|^CARTOSAT|^MICROSAT-/, 'Earth observation (ISRO, dual-use)', true],

  // --- Military and government communications ---------------------------
  [/MILSTAR|\bAEHF\b|^WGS[ -]|\bDSCS\b|FLTSATCOM|\bUFO \d|\bMUOS\b|SKYNET|SICRAL|SYRACUSE|\bXTAR\b|COMSATBW|SATCOMBW|ATHENA-FIDUS|SPAINSAT|^NATO |\bSDS\b|QUASAR|MARISAT|LEASAT|^GSAT-7|^CMS-\d|RADUGA|MERIDIAN|BLAGOVEST|GARPUN|STRELA|RODNIK|GONETS|MOLNIYA|^FENGHUO|^SHENTONG|^ZHONGXING-2\b/, 'Military communications', true],
  [/^TDRS|\bEDRS\b|ARTEMIS|^TIANLIAN|^DRS\b/, 'Data relay (picks up spacecraft traffic)', true],

  // --- Civil and commercial sensing -------------------------------------
  [/LANDSAT|SENTINEL|^SPOT[ -]|PLEIADES|WORLDVIEW|GEOEYE|QUICKBIRD|IKONOS|SKYSAT|^FLOCK|^DOVE|SUPERDOVE|RESOURCESAT|^IRS-|OCEANSAT|SCATSAT|HYSIS|SARAL|KOMPSAT|^ICEYE|CAPELLA|^UMBRA|TERRASAR|TANDEM-X|^PAZ\b|RADARSAT|^ALOS|^JILIN|SUPERVIEW|BLACKSKY|^TERRA\b|^AQUA\b|PRISMA|^ZIYUAN|^ZY-\d|^HAIYANG|^HY-\d|CBERS|^NEWSAT|SATELLOGIC|GOKTURK|^RASAT|DEIMOS|KANOPUS|^AIST|^VENUS\b|NIGERIASAT|^ALSAT|^THEOS|FORMOSAT|ARIRANG|EGYPTSAT|ETRSS|SAOCOM|PERUSAT|DIWATA|^BILSAT|^SPACEEYE|^CHUANGXIN|^CSES|ICESAT|KAZSTSAT|^GLOBAL-\d/, 'Earth observation', true],
  [/HUBBLE|^HST\b|CHANDRA|SPITZER|KEPLER|^TESS\b|JWST|^SWIFT|^FERMI|^XMM|INTEGRAL|^GAIA|CHEOPS|EUCLID|^IXPE|NUSTAR|^SOHO|^SDO\b|^IRIS\b|THEMIS|^MMS |^ICON\b|XUNTIAN|^DAMPE|^HXMT|EINSTEIN PROBE|^EP-\d|^MOZI|QUESS|GRACE|^SWARM|^CLUSTER|^GOCE|^CALIPSO|^CLOUDSAT|^AEOLUS|HISAKI|SPRINT-A/, 'Science / astronomy', true],
  [/NAVSTAR|^GPS |GLONASS|GALILEO|^GSAT0|^BEIDOU|^QZS-|^IRNSS|^NVS-|NAVIC|CENTISPACE|^BDS-/, 'Navigation / PNT', true],
  [/^ISS |ZARYA|TIANHE|WENTIAN|MENGTIAN|TIANGONG|^CSS |PROGRESS|^SOYUZ|DRAGON|CYGNUS|SHENZHOU|TIANZHOU|^CREW|^HTV|^ATV|STARLINER|^CARGO/, 'Crewed / logistics', true],
  [/CUBESAT|PATHFINDER|TECHNOSAT|TECHSAT|^PROBA|DEMO|^TEST|^TDO-|^OTB|^STPSAT|^FALCONSAT|^BLACKJACK/, 'Technology demo', true],
  [/AMSAT|OSCAR|^FUNCUBE|^LING|^XW-\d|TIANXING/, 'Amateur radio', true],

  // --- Watches the weather ----------------------------------------------
  [/\bDMSP\b/, 'Meteorology (military)', true],   // military, so it stays
  [/^NOAA|^GOES|^METOP|HIMAWARI|^FENGYUN|^FY-\d|ELEKTRO|METEOSAT|^MTG-|METEOR-M|^JPSS|SUOMI|^GMS-|^MTSAT|^INSAT-3D|ARKTIKA|GEO-KOMPSAT|^GK2A|^COSMIC|^YUNYAO|^TIANMU|^FENGYUN/, 'Meteorology', false],

  // --- Carries traffic ---------------------------------------------------
  [/STARLINK|ONEWEB|^QIANFAN|^G60 |^GUOWANG|HULIANWANG|^XINGWANG|KUIPER|^O3B|LIGHTSPEED|BLUEWALKER|BLUEBIRD|SPACEMOBILE|^TELESAT/, 'Broadband internet', false],
  [/INTELSAT|EUTELSAT|^ASTRA |^SES-|INMARSAT|THURAYA|VIASAT|ECHOSTAR|^IRIDIUM|GLOBALSTAR|ORBCOMM|^CHINASAT|^ZHONGXING|^ZX-\d|APSTAR|ASIASAT|MEASAT|^OPTUS|^NSS-|TELSTAR|^GALAXY|HISPASAT|ARABSAT|NILESAT|^BADR|TURKSAT|^AMOS-|ES.HAIL|AZERSPACE|BELINTERSAT|LAOSAT|THAICOM|VINASAT|PALAPA|^TELKOM|KOREASAT|^JCSAT|SUPERBIRD|HORIZONS|PAKSAT|BANGABANDHU|NIGCOMSAT|RASCOM|^YAMAL|^EXPRESS-|TIANTONG|^GSAT-|^INSAT-|SATMEX|^ANIK|DIRECTV|^SIRIUS|^XM-\d|SPACEWAY|AMAZONAS|STAR ONE|HELLAS-SAT|^DFH|DONGFANGHONG|^XINGYUN|^HONGYAN|^ASTRANIS|^SWARM-|^KEPLER|^NEXTSTAR|GORIZONT|^EKRAN|^RADUGA/, 'Communications', false],
];

// A label from tle-loader that means the object neither sees the ground nor
// listens to it, used when CLASSES falls through to its China table.  It has to
// agree with CLASSES on the same object, hence the rocket bodies.
const FALLBACK_CLEARED = /COMMUNICATION|BROADBAND|IOT |NARROWBAND|METEOROLOG|WEATHER|ROCKET BODY|DEBRIS/i;

function classify(name) {
  const n = String(name || '').toUpperCase();
  for (const [re, label, keep] of CLASSES) if (re.test(n)) return { label, keep };
  // Nothing matched.  tle-loader's China table gives a better label than
  // "unknown" for the Chinese series; the verdict stays "keep" unless that
  // label itself says the object only carries traffic or watches the weather,
  // so the table and the button never disagree in front of the reader.
  const p = window.Argos.inferPurpose(name);
  if (p === 'Not publicly stated') return { label: 'Purpose not publicly stated', keep: true };
  return { label: p, keep: !FALLBACK_CLEARED.test(p) };
}

// The classes dust-off clears, named first in its note.  Anything else the
// verdict clears came from tle-loader's table and follows, biggest first - the
// breakdown has to account for every satellite the count says was cleared.
const DUST_FIRST = ['Communications', 'Broadband internet', 'Meteorology', 'Rocket body / debris'];

// ==========================================================================
// Page state
// ==========================================================================

const leadSvg = $('lead-svg'), leadRows = $('lead-rows'), leadInfo = $('lead-info');
const leadProg = $('lead-progress'), dustBtn = $('dust-off');
const fLat = $('f-lat'), fLng = $('f-lng'), fAngle = $('f-angle'), fHeight = $('f-height');
const fTilt = $('f-tilt'), fDir = $('f-dir'), fWhen = $('f-when'), fZone = $('f-zone');

const LEAD_INFO_HINT = '<div class="hint">Hover a satellite on the plot (or a row of the table) to see its ground track over the hour and its details.</div>';

let allSats = [];        // [{ name, noradId, rec }]
let leadToken = 0;       // bumped on every scan, so a stale one stops
let leadCtx = null;      // { c, T, all, sats, dmax, cone, country }
let leadHover = -1;
let dusted = false;      // is the roster currently dusted off?

const zoneOffset = () => (fZone.value === 'IST' ? IST_OFFSET_MS : 0);
const fmtKm   = km => Math.round(km).toLocaleString('en-US');
const fmtLead = ms => { const sec = Math.round(ms / 1000); return `${Math.floor(sec / 60)} m ${String(sec % 60).padStart(2, '0')} s`; };
// -1 means leadExit gave up: the satellite was still in the cone three hours
// on, which says more than a made-up figure would.
const fmtExit = ms => (ms < 0 ? '> 3 h' : fmtLead(ms));
const clockAt = ms => `${new Date(ms + zoneOffset()).toISOString().slice(11, 19)} ${fZone.value}`;

function fmtStamp(ms, offsetMs) {
  const d = new Date(ms + offsetMs);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${d.toISOString().slice(11, 19)}`;
}

// ==========================================================================
// The scan
// ==========================================================================

// Milliseconds after T at which the satellite first enters the cone (0 = inside
// already), or -1 if it doesn't within the hour.
function leadEntry(c, rec, t0, gmsts, maxRange) {
  if (rec.a * (1 - rec.ecco) * 6378.135 - EARTH_R_KM - COARSE_KM > maxRange) return -1;   // perigee out of reach
  let prev = null;
  for (let i = 0; i < gmsts.length; i++) {
    const ms = t0 + i * LEAD_STEP_MS;
    const pv = satellite.propagate(rec, new Date(ms));
    if (!pv || !pv.position || !Number.isFinite(pv.position.x)) { prev = null; continue; }
    const cur = satellite.eciToEcf(pv.position, gmsts[i]);
    if (nearCone(c, cur, COARSE_KM) && inConeAt(c, rec, ms)) {
      if (i === 0) return 0;
      let lo = ms - LEAD_STEP_MS, hi = ms;               // outside at lo, inside at hi
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2;
        if (inConeAt(c, rec, mid)) hi = mid; else lo = mid;
      }
      return hi - t0;
    }
    if (prev) {
      const mid = { x: (prev.x + cur.x) / 2, y: (prev.y + cur.y) / 2, z: (prev.z + cur.z) / 2 };
      if (nearCone(c, mid, mag(sub(cur, prev)) / 2 + COARSE_KM)) {   // a pass could hide inside this minute
        for (let t = ms - LEAD_STEP_MS + 1000; t < ms; t += 1000) if (inConeAt(c, rec, t)) return t - t0;
      }
    }
    prev = cur;
  }
  return -1;
}

// Milliseconds after T at which the satellite leaves the cone again, or -1 if
// it is still inside LEAD_EXIT_MAX_MS later.
//
// This is the end of the pass leadEntry found, not of any later one: the
// satellite is inside at `entry`, so walk forward until a sample is outside
// and bisect that step to the second.  The walk is finer than the 60-second
// grid the entry scan uses, so it is not the weaker of the two; a dip out and
// straight back inside one 20-second step would still be missed, which is a
// grazing geometry the page cannot resolve either way.
//
// The cap is what stops a satellite that simply sits in the cone - a
// geostationary one, when the cap on the cone is high enough to reach it -
// from being propagated forever.  The column says so rather than inventing a
// time.
function leadExit(c, rec, t0, entry) {
  const start = t0 + entry;
  for (let dt = LEAD_EXIT_STEP_MS; dt <= LEAD_EXIT_MAX_MS; dt += LEAD_EXIT_STEP_MS) {
    if (inConeAt(c, rec, start + dt)) continue;
    let lo = start + dt - LEAD_EXIT_STEP_MS, hi = start + dt;   // inside at lo, outside at hi
    while (hi - lo > 1000) {
      const mid = (lo + hi) / 2;
      if (inConeAt(c, rec, mid)) lo = mid; else hi = mid;
    }
    return hi - t0;
  }
  return -1;
}

// Every stretch of the hour the satellite spends inside the cone, as
// [in, out] pairs in milliseconds after t0, the last one closing at -1 if it
// is still inside when the hour runs out.
//
// leadEntry stops at the first entry and leadExit at the end of that one pass,
// which is all the two columns need.  The clear zone needs the rest: a pass it
// never saw would show up there as quiet sky, and a clear window that is not
// clear is the one error this page must not make.
//
// It walks the same 60-second grid the scan does, and resolves each minute the
// cheaper of two ways.  When the minute's two ends disagree the
// boundary is bisected, as leadEntry and leadExit bisect theirs - one crossing
// per minute, which is the assumption those two already make.  When both ends
// are outside but a whole pass could have fitted between them, the minute is
// walked second by second instead, because there is no crossing to bisect
// towards; that is the conservative distance bound the scan uses, and it is
// how a two-second graze is still found.  A minute whose two ends are both
// inside is left alone: a dip out and straight back in within one minute is a
// grazing geometry neither this nor the entry scan can resolve, and the error
// it leaves counts the satellite as present, which is the safe way round for a
// clear zone.
function leadPasses(c, rec, t0, gmsts) {
  const passes = [];
  let open = null, prevIn = false, prevEcf = null;
  const mark = (ms, isIn) => {
    if (isIn && open === null) open = ms - t0;
    else if (!isIn && open !== null) { passes.push([open, ms - t0]); open = null; }
  };
  // Narrow a known crossing, keeping an instant on each side of it.
  const cross = (inMs, outMs) => {
    let a = inMs, b = outMs;
    while (Math.abs(b - a) > ZONE_RES_MS) {
      const mid = (a + b) / 2;
      if (inConeAt(c, rec, mid)) a = mid; else b = mid;
    }
    return { in: a, out: b };
  };
  for (let i = 0; i < gmsts.length; i++) {
    const ms = t0 + i * LEAD_STEP_MS;
    const pv = satellite.propagate(rec, new Date(ms));
    if (!pv || !pv.position || !Number.isFinite(pv.position.x)) { prevEcf = null; continue; }
    // The same test inConeAt makes, off the propagation already in hand.
    const cur = satellite.eciToEcf(pv.position, gmsts[i]);
    let curIn = false;
    if (nearCone(c, cur, COARSE_KM)) {
      const g = satellite.eciToGeodetic(pv.position, gmsts[i]);
      curIn = !!coneHit(c.frame, c.apex, c.axis,
        geodeticToECEF(satellite.degreesLat(g.latitude), satellite.degreesLong(g.longitude), g.height),
        c.inp.angle, c.inp.height);
    }
    const back = ms - LEAD_STEP_MS;
    if (prevEcf && prevIn !== curIn) {
      if (curIn) mark(cross(ms, back).in, true); else mark(cross(back, ms).out, false);
    } else if (prevEcf && !prevIn && !curIn && nearCone(c,
        { x: (prevEcf.x + cur.x) / 2, y: (prevEcf.y + cur.y) / 2, z: (prevEcf.z + cur.z) / 2 },
        mag(sub(cur, prevEcf)) / 2 + COARSE_KM)) {
      for (let t = back + 1000; t < ms; t += 1000) mark(t, inConeAt(c, rec, t));
    }
    mark(ms, curIn);
    prevIn = curIn;
    prevEcf = cur;
  }
  if (open !== null) passes.push([open, -1]);
  return passes;
}

// How many of the given satellites are inside the cone at each instant of the
// window, as blocks that tile [0, windowMs] end to end with no gap.  Built
// from the passes rather than by sampling the sky again - the intervals are
// already known to the second - by sorting the entries and exits into one
// stream and walking it.  Runs with the same count are merged, so a satellite
// leaving at the instant another arrives does not split a block in two.
function occupancy(sats, windowMs) {
  const ev = [];
  for (const s of sats) for (const [a, b] of s.passes) {
    const lo = Math.max(0, a), hi = Math.min(windowMs, b < 0 ? windowMs : b);
    if (hi > lo) ev.push([lo, 1], [hi, -1]);
  }
  ev.sort((p, q) => p[0] - q[0]);
  const blocks = [];
  let n = 0, at = 0, i = 0;
  const upTo = to => {
    if (to <= at) return;
    const last = blocks[blocks.length - 1];
    if (last && last.n === n) last.to = to; else blocks.push({ from: at, to, n });
    at = to;
  };
  while (i < ev.length) {
    const t = ev[i][0];
    upTo(t);
    while (i < ev.length && ev[i][0] === t) n += ev[i++][1];
  }
  upTo(windowMs);
  return blocks;
}

// ==========================================================================
// The polar map
// ==========================================================================

// Ground distance (km) and bearing from the site, and the plot position.
function leadProject(lat, lon) {
  const L = leadCtx, p1 = L.c.inp.lat * DEG, p2 = lat * DEG, dl = (lon - L.c.inp.lng) * DEG;
  const cosC = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  const d = Math.acos(Math.max(-1, Math.min(1, cosC))) * EARTH_R_KM;
  const az = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
  const r = d > L.dmax ? LEAD_R * 1.02 : LEAD_R * Math.sqrt(d / L.dmax);
  return { x: r * Math.sin(az), y: -r * Math.cos(az), d, az };
}

// The "1-hour" boundary: round the plot in 5° sectors, just outside the
// farthest satellite still to enter.  Not a circle — faster orbits reach
// the cone from farther away.
function hourBoundary(sats) {
  const N = 72, bins = new Array(N).fill(-1);
  let filled = 0;
  for (const s of sats) {
    if (!s.entry) continue;
    const k = Math.floor(((s.az / DEG + 360) % 360) / 5) % N, r = Math.hypot(s.x, s.y);
    if (bins[k] < 0) filled++;
    bins[k] = Math.max(bins[k], r);
  }
  if (filled < 8) return '';
  const out = bins.map((r, k) => {                  // empty sectors: interpolate round the circle
    if (r >= 0) return r;
    let a = 1, b = 1;
    while (bins[(k - a + N) % N] < 0) a++;
    while (bins[(k + b) % N] < 0) b++;
    const ra = bins[(k - a + N) % N], rb = bins[(k + b) % N];
    return ra + (rb - ra) * a / (a + b);
  });
  let d = '';
  for (let k = 0; k < N; k++) {   // vertex on each sector edge, clear of both neighbours
    const r = Math.min(LEAD_R + 2, Math.max(out[k], out[(k + N - 1) % N]) + 7), a = k * 5 * DEG;
    d += `${k ? 'L' : 'M'}${(r * Math.sin(a)).toFixed(1)} ${(-r * Math.cos(a)).toFixed(1)}`;
  }
  return d + 'Z';
}

function leadColor(ms) {   // green (entering now) → amber → red (in an hour)
  const stops = [[103, 232, 164], [249, 210, 76], [255, 107, 107]];
  const t = Math.min(1, ms / (LEAD_MIN * 60000)) * 2, i = Math.min(1, Math.floor(t)), f = t - i;
  const [a, b] = [stops[i], stops[i + 1]];
  return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * f)).join(',')})`;
}

let worldMap = null, worldMapPromise = null;
function loadWorldMap() {
  return worldMapPromise || (worldMapPromise = fetch(WORLD_MAP_URL)
    .then(r => (r.ok ? r.json() : null)).then(j => (worldMap = j)).catch(() => null));
}
const polysOf = g => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

function countryAt(lat, lng) {
  if (!worldMap) return '';
  const inRing = ring => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  for (const f of worldMap.features) {
    if (polysOf(f.geometry).some(poly => inRing(poly[0]) && !poly.slice(1).some(inRing))) return f.properties.NAME || '';
  }
  return '';
}

// Country outlines on the polar map.  Rings that jump across the plot (round
// the antipode) are only stroked; the rest are filled.
function leadMapPaths() {
  let fill = '', line = '';
  for (const f of worldMap.features) {
    for (const poly of polysOf(f.geometry)) {
      for (const ring of poly) {
        let d = '', broken = false, px = null, py = null;
        for (const [lon, lat] of ring) {
          const q = leadProject(lat, lon);
          const jump = px !== null && Math.hypot(q.x - px, q.y - py) > LEAD_R * 0.5;
          if (jump) broken = true;
          d += `${px === null || jump ? 'M' : 'L'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
          px = q.x; py = q.y;
        }
        if (broken) line += d; else fill += d + 'Z';
      }
    }
  }
  return `<path class="lm-land" d="${fill}"/><path class="lm-coast" d="${line}"/>`;
}

// ==========================================================================
// Rendering
// ==========================================================================

function leadSubtitle(c, T, country) {
  const { inp } = c, off = zoneOffset();
  const ns = `${Math.abs(inp.lat).toFixed(2)}° ${inp.lat >= 0 ? 'N' : 'S'}`, ew = `${Math.abs(inp.lng).toFixed(2)}° ${inp.lng >= 0 ? 'E' : 'W'}`;
  const axis = c.tilt.angle < 0.05 ? 'axis vertical' : `axis tilted ${c.tilt.angle.toFixed(1)}° toward ${compassPoint(c.tilt.dir)}`;
  return `<b>${ns}, ${ew}${country ? ` · ${escHtml(country)}` : ''}</b> · half-angle ${inp.angle}° · up to ${fmtKm(inp.height)} km along the axis · ${axis}<br>
    Satellites entering the cone between <b>${fmtStamp(T, off)} ${fZone.value}</b> and <b>${clockAt(T + LEAD_MIN * 60000)}</b> — plotted where they are at the start`;
}

function renderLead() {
  const L = leadCtx, R = LEAD_R, out = [];
  out.push(`<defs><clipPath id="lead-clip"><circle r="${R}"/></clipPath></defs><circle class="lm-disc" r="${R}"/>`);
  if (worldMap) out.push(`<g clip-path="url(#lead-clip)">${leadMapPaths()}</g>`);
  for (let a = 0; a < 360; a += 45) {
    out.push(`<line class="lm-spoke" x1="0" y1="0" x2="${(R * Math.sin(a * DEG)).toFixed(1)}" y2="${(-R * Math.cos(a * DEG)).toFixed(1)}"/>`);
  }
  let lastR = 0;
  for (const km of [100, 250, 500, 1000, 2000, 5000, 10000, 15000]) {
    const r = R * Math.sqrt(km / L.dmax);
    if (km > L.dmax * 0.92 || r - lastR < 30 || R - r < 22) continue;
    lastR = r;
    out.push(`<circle class="lm-ring" r="${r.toFixed(1)}"/><text class="lm-rtext" x="${(r * 0.5 + 3).toFixed(1)}" y="${(r * 0.866).toFixed(1)}">${fmtKm(km)} km</text>`);
  }
  out.push(`<text class="lm-rtext" x="${(R * 0.5 + 6).toFixed(1)}" y="${(R * 0.866 + 12).toFixed(1)}">${fmtKm(L.dmax)} km</text>`);
  if (L.cone.length > 2) out.push(`<path class="lm-cone" d="M${L.cone.map(q => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('L')}Z"/>`);
  const hour = hourBoundary(L.sats);
  if (hour) out.push(`<path class="lm-hour" d="${hour}"/>`);
  for (const [t, a] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
    out.push(`<text class="lm-compass" x="${((R + 16) * Math.sin(a * DEG)).toFixed(1)}" y="${(-(R + 16) * Math.cos(a * DEG)).toFixed(1)}">${t}</text>`);
  }
  out.push('<g id="lead-track" clip-path="url(#lead-clip)"></g>');
  for (let i = L.sats.length - 1; i >= 0; i--) {   // soonest on top
    const s = L.sats[i];
    out.push(`<circle class="lm-dot" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="3.4" fill="${s.color}"/>`);
  }
  out.push(`<path class="lm-site" d="M-7 0H7M0 -7V7"/><text class="lm-sitetext" x="0" y="-13">${escHtml(L.country || 'Site')}</text>`);
  out.push('<g id="lead-hl"></g>');
  leadSvg.innerHTML = out.join('');

  renderRoster();
}

// The count, the dust-off note and the table — everything that changes when
// the button is pressed, without re-running the scan.
function renderRoster() {
  const L = leadCtx, inside = L.sats.filter(s => !s.entry).length;
  const cleared = L.all.length - L.sats.length;
  $('lead-count').innerHTML = `<b>${L.sats.length.toLocaleString('en-US')}</b> satellites in the cone within the hour` +
    (inside ? ` · ${inside} already inside at the start` : '') +
    (dusted ? ` · <b>${cleared.toLocaleString('en-US')}</b> dusted off` : '');

  // Nothing is said about dust-off until it is pressed; then the note accounts
  // for every satellite the count says went.
  $('dust-note').innerHTML = '';
  if (dusted) {
    const byClass = new Map();
    for (const s of L.all) if (!s.keep) byClass.set(s.purpose, (byClass.get(s.purpose) || 0) + 1);
    const rank = k => { const i = DUST_FIRST.indexOf(k); return i < 0 ? DUST_FIRST.length : i; };
    const gone = [...byClass.keys()]
      .sort((a, b) => rank(a) - rank(b) || byClass.get(b) - byClass.get(a))
      .map(k => `${escHtml(k)} ${byClass.get(k)}`).join(' · ');
    $('dust-note').innerHTML = `<span class="gone">Cleared:</span> ${gone || 'nothing matched'}. ` +
      `<span class="kept">Kept:</span> military, ISR, SIGINT and RF geolocation, imaging and radar, ` +
      `spacecraft data relay, navigation, science, and every purpose not publicly stated. ` +
      `<b>Classified by catalogue name</b>, so treat it as a filter, not an assessment.`;
  }

  leadRows.innerHTML = L.sats.map((s, i) => `<tr data-i="${i}">
    <td class="num">${i + 1}</td><td><i class="sw" style="background:${s.color}"></i>${escHtml(s.name)}</td>
    <td class="num">${s.noradId}</td><td class="num">${fmtKm(s.alt)}</td><td class="num">${s.speed.toFixed(2)}</td>
    <td class="num">${s.period.toFixed(1)}</td><td class="num">${s.entry ? fmtLead(s.entry) : 'inside now'}</td>
    <td class="num">${fmtExit(s.exit)}</td>
    <td>${escHtml(s.purpose)}</td></tr>`).join('') ||
    `<tr><td colspan="9" class="empty">${dusted
      ? 'Every satellite in this hour was a pure carrier — nothing left after the dust-off.'
      : 'No satellite enters the cone in this hour.'}</td></tr>`;

  renderZones();
}

// ==========================================================================
// The clear zone
// ==========================================================================

// The hour broken into blocks by how many satellites are inside the cone at
// once, a column per count.  Dust-Off is what fills it in: the question is
// about the satellites that can see the ground or listen to it, so asked over
// a list that still carries the communications and weather satellites it has
// no meaning, and the table stays empty rather than answering the wrong one.
function renderZones() {
  const lede = $('lz-lede'), host = $('lz-table');
  if (!leadCtx || !dusted) {
    lede.innerHTML = 'Press <b>Dust-Off</b> to fill this in.';
    host.innerHTML = '';
    return;
  }

  const { T, sats } = leadCtx;
  const blocks = occupancy(sats, LEAD_WINDOW_MS);
  const cols = Array.from({ length: ZONE_MAX + 1 }, () => []);
  for (const b of blocks) cols[Math.min(b.n, ZONE_MAX)].push(b);

  const clock = ms => clockAt(T + ms).slice(0, 8);
  // Two satellites' edges can land a fraction of a second apart, and the hour
  // is tiled with no gaps, so some blocks really are that short.
  const fmtSpan = ms => (ms < 1000 ? '< 1 s' : fmtLead(ms));
  const span = b => `<span class="lz-span">${clock(b.from)}–${clock(b.to)}</span>` +
                    `<span class="lz-dur">${fmtSpan(b.to - b.from)}</span>`;
  const sum = list => list.reduce((a, b) => a + (b.to - b.from), 0);

  const clear = cols[0], longest = clear.reduce((a, b) => (!a || b.to - b.from > a.to - a.from ? b : a), null);
  lede.innerHTML =
    `The hour from <b>${clock(0)}</b> to <b>${clock(LEAD_WINDOW_MS)} ${fZone.value}</b>, over the ` +
    `<b>${sats.length.toLocaleString('en-US')}</b> satellites left in the list — the ones that can see the ` +
    `ground or listen to it. ` + (longest
      ? `<span class="clear">Clear for ${fmtLead(sum(clear))}</span> of it, in ` +
        `${clear.length} ${clear.length === 1 ? 'block' : 'blocks'}; the longest is ` +
        `<span class="clear">${fmtLead(longest.to - longest.from)}</span> from ${clock(longest.from)}.`
      : `<span class="busy">No part of it is clear</span> — at least one of them is inside the cone at ` +
        `every instant.`);

  const rows = Math.max(...cols.map(c => c.length));
  const body = Array.from({ length: rows }, (_, r) => '<tr>' + cols.map((list, k) =>
    `<td class="${k ? '' : 'zero'}">${list[r] ? span(list[r]) : ''}</td>`).join('') + '</tr>').join('');
  host.innerHTML = `<table>
    <thead><tr>${ZONE_HEADS.map((h, k) => `<th class="${k ? '' : 'zero'}">${h}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr>${cols.map((list, k) => `<td class="${k ? '' : 'zero'}">` +
      `<span class="lz-span">${list.length} ${list.length === 1 ? 'block' : 'blocks'}</span>` +
      `<span class="lz-dur">${fmtSpan(sum(list))} in all</span></td>`).join('')}</tr></tfoot>
  </table>`;
}

// The satellite's ground track from T (to a little past its entry), faint,
// with the stretch inside the cone picked out.
function leadTrack(s) {
  const { c, T } = leadCtx, endMs = Math.min(LEAD_TRACK_MIN, Math.max(LEAD_MIN, s.entry / 60000 + 10)) * 60000;
  let all = '', inside = '', prev = null, prevIn = false;
  for (let t = 0; t <= endMs; t += 20000) {
    const date = new Date(T + t), pv = satellite.propagate(s.rec, date);
    if (!pv || !pv.position) { prev = null; continue; }
    const g = satellite.eciToGeodetic(pv.position, satellite.gstime(date));
    const lat = satellite.degreesLat(g.latitude), lon = satellite.degreesLong(g.longitude);
    const q = leadProject(lat, lon), pt = `${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    const isIn = !!coneHit(c.frame, c.apex, c.axis, geodeticToECEF(lat, lon, g.height), c.inp.angle, c.inp.height);
    const joined = prev && Math.hypot(q.x - prev.x, q.y - prev.y) < LEAD_R * 0.5;
    all += `${joined ? 'L' : 'M'}${pt}`;
    if (isIn) inside += joined && prevIn ? `L${pt}` : `M${pt}L${pt}`;
    prev = q;
    prevIn = isIn;
  }
  const e = s.entry ? satGeo(s.rec, new Date(T + s.entry)) : null;
  return { all, inside, entry: e && leadProject(e.lat, e.lon) };
}

function setLeadHover(i, fromPlot) {
  if (!leadCtx || i === leadHover) return;
  leadHover = i;
  const trackG = $('lead-track'), hlG = $('lead-hl');
  if (!trackG || !hlG) return;
  leadRows.querySelectorAll('tr.on').forEach(r => r.classList.remove('on'));
  if (i < 0) { trackG.innerHTML = ''; hlG.innerHTML = ''; leadInfo.innerHTML = LEAD_INFO_HINT; return; }
  const s = leadCtx.sats[i], tr = leadTrack(s);
  trackG.innerHTML = `<path class="lm-track" d="${tr.all}"/><path class="lm-track-in" d="${tr.inside}"/>`;
  hlG.innerHTML = (tr.entry ? `<circle class="lm-entry" cx="${tr.entry.x.toFixed(1)}" cy="${tr.entry.y.toFixed(1)}" r="4.5"/>` : '') +
    `<circle class="lm-hl" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="7.5"/>`;
  leadInfo.innerHTML = `<div class="nm" style="color:${s.color}">${escHtml(s.name)}</div>
    <dl>
      <dt>NORAD ID</dt><dd>${s.noradId}</dd>
      <dt>Altitude</dt><dd>${fmtKm(s.alt)} km</dd>
      <dt>Speed</dt><dd>${s.speed.toFixed(2)} km/s</dd>
      <dt>Period</dt><dd>${s.period.toFixed(1)} min</dd>
      <dt>Purpose</dt><dd>${escHtml(s.purpose)}${s.keep ? '' : ' · cleared by dust-off'}</dd>
      <dt>Enters cone</dt><dd>${s.entry ? `in ${fmtLead(s.entry)} · at ${clockAt(leadCtx.T + s.entry)}` : 'already inside at the start'}</dd>
      <dt>Leaves cone</dt><dd>${s.exit < 0
        ? 'still inside three hours on'
        : `in ${fmtLead(s.exit)} · at ${clockAt(leadCtx.T + s.exit)} · ${fmtLead(s.exit - s.entry)} inside`}</dd>
      <dt>At the start</dt><dd>${fmtKm(s.d)} km ${compassPoint((s.az / DEG + 360) % 360)} of the site · ${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°</dd>
    </dl>`;
  const row = leadRows.querySelector(`tr[data-i="${i}"]`);
  if (row) {
    row.classList.add('on');
    if (fromPlot) row.scrollIntoView({ block: 'nearest' });
  }
}

function leadProgress(msg, frac) {
  leadProg.hidden = false;
  $('lead-progress-text').textContent = msg;
  const bar = $('lead-progress-bar');
  bar.parentElement.hidden = frac == null;
  bar.style.width = `${Math.round((frac || 0) * 100)}%`;
}

// ==========================================================================
// dust-off
// ==========================================================================

function applyDust() {
  const L = leadCtx;
  if (!L) return;
  leadHover = -1;
  L.sats = dusted ? L.all.filter(s => s.keep) : L.all.slice();
  leadInfo.innerHTML = LEAD_INFO_HINT;
  renderLead();
}

dustBtn.addEventListener('click', () => {
  dusted = !dusted;
  dustBtn.classList.toggle('on', dusted);
  dustBtn.textContent = dusted ? '↺ Bring Them Back' : '🧹 Dust-Off';
  dustBtn.title = dusted
    ? 'Put the communications, broadband and weather satellites back in the list'
    : 'Clear the satellites that only carry traffic or watch the weather';
  applyDust();
});

// ==========================================================================
// The run
// ==========================================================================

function formInputs() {
  const lat = parseFloat(fLat.value), lng = parseFloat(fLng.value);
  const angle = parseFloat(fAngle.value), height = parseFloat(fHeight.value);
  const ok = Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    && Number.isFinite(angle) && angle > 0 && angle < 90 && Number.isFinite(height) && height > 0;
  for (const el of [fLat, fLng, fAngle, fHeight]) el.style.borderColor = ok ? '' : 'var(--accent2)';
  return ok ? { lat, lng, angle, height } : null;
}

// The datetime-local field is read and written as UTC wall-clock, so the
// moment never shifts with the viewer's own time zone.
const toField = ms => new Date(ms).toISOString().slice(0, 16);
const fromField = v => (v ? Date.parse(v + ':00Z') : NaN);

async function run() {
  const token = ++leadToken;
  leadCtx = null;
  leadHover = -1;
  leadSvg.innerHTML = '';
  leadRows.innerHTML = '';
  leadInfo.innerHTML = LEAD_INFO_HINT;
  $('lead-count').textContent = '';
  $('dust-note').textContent = '';
  renderZones();

  const inp = formInputs();
  if (!inp) { leadProgress('Enter a valid latitude, longitude, half-angle and height for the cone.'); return; }
  const tilt = Math.min(90, Math.max(0, parseFloat(fTilt.value) || 0));
  const dir = ((parseFloat(fDir.value) || 0) % 360 + 360) % 360;
  const T = Number.isFinite(fromField(fWhen.value)) ? fromField(fWhen.value) : Date.now();
  const c = coneCtx(inp, tilt, dir);
  $('lead-sub').innerHTML = leadSubtitle(c, T, '');

  const mapReady = loadWorldMap();
  if (!allSats.length) {
    leadProgress('Loading the TLE catalogue…');
    try {
      const { tles } = await window.Argos.fetchTLEs();
      allSats = window.Argos.makeSatrecs(tles);
    } catch (e) {
      leadProgress('TLE fetch failed: ' + e.message);
      return;
    }
    if (token !== leadToken) return;
  }

  const gmsts = Array.from({ length: LEAD_MIN + 1 }, (_, i) => satellite.gstime(new Date(T + i * LEAD_STEP_MS)));
  const maxRange = c.ca > 1e-3 ? inp.height / c.ca : Infinity;
  const found = [], total = allSats.length;
  let tick = performance.now();
  leadProgress(`Scanning ${total.toLocaleString('en-US')} satellites over the hour ahead…`, 0);
  for (let k = 0; k < total; k++) {
    const e = leadEntry(c, allSats[k].rec, T, gmsts, maxRange);
    if (e >= 0) found.push({ t: allSats[k], entry: e });
    if (performance.now() - tick > 30) {
      leadProgress(`Scanning ${total.toLocaleString('en-US')} satellites over the hour ahead… ${Math.round(k / total * 100)} %`, k / total);
      await new Promise(r => setTimeout(r, 0));
      if (token !== leadToken) return;
      tick = performance.now();
    }
  }
  await mapReady;
  if (token !== leadToken) return;

  // A second pass over the few hundred that were found, for where each one is
  // at T and when it leaves again.  It is kept out of the scan loop above
  // because that one runs over the whole catalogue and this runs over the
  // handful that matter.
  const all = [];
  leadProgress(`Working out when ${found.length.toLocaleString('en-US')} of them leave again…`, 0);
  for (let k = 0; k < found.length; k++) {
    const f = found[k];
    const pv = satellite.propagate(f.t.rec, new Date(T));
    if (!pv || !pv.position) continue;
    const g = satellite.eciToGeodetic(pv.position, gmsts[0]), v = pv.velocity, cls = classify(f.t.name);
    // The pass the two columns describe is the first of these; its end is the
    // exit, unless the hour runs out first and leadExit has to reach past it.
    const passes = leadPasses(c, f.t.rec, T, gmsts);
    const firstOut = passes.length ? passes[0][1] : -1;
    all.push({ name: f.t.name, noradId: f.t.noradId, rec: f.t.rec, entry: f.entry, passes,
      exit: firstOut >= 0 ? firstOut : leadExit(c, f.t.rec, T, f.entry),
      lat: satellite.degreesLat(g.latitude), lon: satellite.degreesLong(g.longitude), alt: g.height,
      speed: Math.hypot(v.x, v.y, v.z), period: 2 * Math.PI / f.t.rec.no,
      purpose: cls.label, keep: cls.keep, color: leadColor(f.entry) });
    if (performance.now() - tick > 30) {
      leadProgress(`Working out when ${found.length.toLocaleString('en-US')} of them leave again… ` +
        `${Math.round(k / found.length * 100)} %`, k / found.length);
      await new Promise(r => setTimeout(r, 0));
      if (token !== leadToken) return;
      tick = performance.now();
    }
  }
  all.sort((a, b) => a.entry - b.entry || a.name.localeCompare(b.name));

  // The plot scale is set from every satellite found, not from the dusted
  // subset, so pressing the button rescales nothing and the two views of the
  // same hour stay comparable.
  leadCtx = { c, T, all, sats: all.slice(), dmax: 1, cone: [], country: '' };
  const rim = coneRim(c);
  let far = 0;
  for (const s of all) far = Math.max(far, (s.d = leadProject(s.lat, s.lon).d));
  for (const q of rim) far = Math.max(far, leadProject(q.lat, q.lon).d);
  leadCtx.dmax = Math.min(Math.PI * EARTH_R_KM, Math.max(500, far * 1.06));
  for (const s of all) Object.assign(s, (({ x, y, az }) => ({ x, y, az }))(leadProject(s.lat, s.lon)));
  leadCtx.cone = convexHull([[0, 0], ...rim.map(q => { const r = leadProject(q.lat, q.lon); return [r.x, r.y]; })]);
  leadCtx.country = countryAt(inp.lat, inp.lng);
  leadCtx.sats = dusted ? all.filter(s => s.keep) : all.slice();

  $('lead-sub').innerHTML = leadSubtitle(c, T, leadCtx.country);
  renderLead();
  leadProg.hidden = true;
}

// ==========================================================================
// Pointer, URL and boot
// ==========================================================================

function leadPointer(e) {
  if (!leadCtx || !leadCtx.sats.length) return;
  const ctm = leadSvg.getScreenCTM();
  if (!ctm) return;
  const pt = leadSvg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const q = pt.matrixTransform(ctm.inverse());
  let best = -1, bd = (14 / ctm.a) ** 2;   // within ~14 px
  leadCtx.sats.forEach((s, i) => {
    const d = (s.x - q.x) ** 2 + (s.y - q.y) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  if (best >= 0 || e.pointerType === 'mouse') setLeadHover(best, true);
}

leadSvg.addEventListener('pointermove', leadPointer);
leadSvg.addEventListener('pointerdown', leadPointer);
leadRows.addEventListener('mouseover', e => { const tr = e.target.closest('tr[data-i]'); if (tr) setLeadHover(+tr.dataset.i, false); });
leadRows.addEventListener('click', e => { const tr = e.target.closest('tr[data-i]'); if (tr) setLeadHover(+tr.dataset.i, false); });

$('lead-form').addEventListener('submit', e => { e.preventDefault(); run(); });
$('f-now').addEventListener('click', () => { fWhen.value = toField(Date.now()); run(); });
fZone.addEventListener('change', () => {
  if (!leadCtx) return;
  $('lead-sub').innerHTML = leadSubtitle(leadCtx.c, leadCtx.T, leadCtx.country);
  renderZones();
});

// Cone-Waffles hands the cone and the moment over in the query string; a
// direct visit gets the defaults already in the fields.
(function fromUrl() {
  const q = new URLSearchParams(location.search);
  const put = (el, key) => { const v = q.get(key); if (v !== null && v !== '' && Number.isFinite(parseFloat(v))) el.value = parseFloat(v); };
  put(fLat, 'lat');
  put(fLng, 'lng');
  put(fAngle, 'angle');
  put(fHeight, 'height');
  put(fTilt, 'tilt');
  put(fDir, 'dir');
  if (q.get('zone') === 'IST') fZone.value = 'IST';
  const t = parseFloat(q.get('t'));
  fWhen.value = toField(Number.isFinite(t) && t > 0 ? t : Date.now());
})();

run();

// A read-only handle for the checks in scripts/tests/one-hour-lead-check.html.
// let/const are script-scoped and never reach window, so a harness cannot see
// any of this without being handed it.
window.__ohl = {
  scanning: () => !leadProg.hidden,
  ready: () => !!leadCtx,
  found: () => (leadCtx ? leadCtx.all.length : 0),
  listed: () => (leadCtx ? leadCtx.sats.length : 0),
  rows: () => leadRows.querySelectorAll('tr[data-i]').length,
  dusted: () => dusted,
  toggleDust: () => dustBtn.click(),
  classify,
  purposes: () => (leadCtx ? leadCtx.all.map(s => [s.name, s.purpose, s.keep]) : []),
  listedNames: () => (leadCtx ? leadCtx.sats.map(s => s.name) : []),
  // the element set and the reported entry, so a harness can re-derive the
  // position for itself instead of trusting this page's own cone test
  entries: () => (leadCtx ? leadCtx.sats.map(s => ({ name: s.name, norad: s.noradId, rec: s.rec, entry: s.entry, exit: s.exit })) : []),
  cone: () => (leadCtx ? { ...leadCtx.c.inp, tilt: leadCtx.c.tilt, T: leadCtx.T, dmax: leadCtx.dmax } : null),
  // the clear zone, three ways: the blocks it is computed from, every listed
  // satellite's passes so a harness can re-derive them, and the table as the
  // reader actually sees it
  window: () => LEAD_WINDOW_MS,
  blocks: () => (leadCtx ? occupancy(leadCtx.sats, LEAD_WINDOW_MS) : []),
  passes: () => (leadCtx ? leadCtx.sats.map(s => ({ name: s.name, rec: s.rec, passes: s.passes })) : []),
  zoneHeads: () => [...document.querySelectorAll('#lz-table thead th')].map(t => t.textContent),
  zoneRows: () => [...document.querySelectorAll('#lz-table tbody tr')]
    .map(tr => [...tr.children].map(td => td.textContent)),
  zoneFoot: () => [...document.querySelectorAll('#lz-table tfoot td')].map(td => td.textContent),
  zoneLede: () => $('lz-lede').textContent,
  dustLabel: () => dustBtn.textContent,
  subtitle: () => $('lead-sub').textContent,
  note: () => $('dust-note').textContent,
  count: () => $('lead-count').textContent,
  hover: i => setLeadHover(i, false),
  info: () => leadInfo.textContent,
  setCone: (o) => {
    if (o.lat != null) fLat.value = o.lat;
    if (o.lng != null) fLng.value = o.lng;
    if (o.angle != null) fAngle.value = o.angle;
    if (o.height != null) fHeight.value = o.height;
    if (o.tilt != null) fTilt.value = o.tilt;
    if (o.dir != null) fDir.value = o.dir;
    if (o.t != null) fWhen.value = toField(o.t);
    return run();
  },
};
