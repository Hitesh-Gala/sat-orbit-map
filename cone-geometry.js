// Cone geometry, shared by Cone-Waffles and the One-Hour Lead page.
//
// WHY THIS IS ITS OWN FILE
//     The lead page lists the satellites that pass through the Land cone, and
//     Cone-Waffles draws that same cone and marks the satellites inside it
//     right now.  The two must agree: a satellite the page says entered at
//     12:04 has to be one the globe shows inside the cone at 12:04.  They
//     agree because they run the same test from the same file, not because
//     two copies of it were kept in step.
//
// Everything here is in Earth-centred, Earth-fixed coordinates in kilometres,
// on a spherical Earth of radius EARTH_R_KM — which is what the globe draws,
// so the drawing and the test describe the same sphere.  See COARSE_KM for
// what that costs against the real ellipsoid.
//
// window.ConeGeom is the whole surface; both pages lift the names they use
// out of it, so call sites read the same as they did when these lived in
// cone-waffles.js.
(function (global) {
  'use strict';

  const EARTH_R_KM = 6371;
  const DEG = Math.PI / 180;

  // Margin (km) for the quick Earth-fixed pre-check.  A satellite's true
  // (ellipsoid) position differs from the spherical placement these pages draw
  // — and test — by at most ~30 km, so nothing further outside the cone than
  // this can pass the exact test.
  const COARSE_KM = 60;

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // --- Vectors and frames ------------------------------------------------

  function geodeticToECEF(latDeg, lngDeg, altKm) {
    const lat = latDeg * DEG, lng = lngDeg * DEG, r = EARTH_R_KM + altKm;
    return { x: r * Math.cos(lat) * Math.cos(lng), y: r * Math.cos(lat) * Math.sin(lng), z: r * Math.sin(lat) };
  }

  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function mag(v)    { return Math.hypot(v.x, v.y, v.z); }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

  // Local East-North-Up unit vectors at a ground point (same axes as geodeticToECEF).
  function enuFrame(latDeg, lngDeg) {
    const la = latDeg * DEG, lo = lngDeg * DEG;
    return {
      e: { x: -Math.sin(lo), y: Math.cos(lo), z: 0 },
      n: { x: -Math.sin(la) * Math.cos(lo), y: -Math.sin(la) * Math.sin(lo), z: Math.cos(la) },
      u: { x: Math.cos(la) * Math.cos(lo), y: Math.cos(la) * Math.sin(lo), z: Math.sin(la) },
    };
  }

  // Axis unit vector for a tilt from vertical and a compass direction of lean, in
  // whichever frame {e, n, u} is passed (ECEF here, or globe.gl scene space).
  function axisFrom(frame, tiltDeg, dirDeg) {
    const t = tiltDeg * DEG, d = dirDeg * DEG;
    const ku = Math.cos(t), kn = Math.sin(t) * Math.cos(d), ke = Math.sin(t) * Math.sin(d);
    return {
      x: ku * frame.u.x + kn * frame.n.x + ke * frame.e.x,
      y: ku * frame.u.y + kn * frame.n.y + ke * frame.e.y,
      z: ku * frame.u.z + kn * frame.n.z + ke * frame.e.z,
    };
  }

  // --- The cone test -----------------------------------------------------

  // A satellite's place relative to a (possibly tilted) land cone.  Null unless it
  // is inside the cone AND above the local horizon (the Earth hides anything
  // below); otherwise its range, elevation and angle off the axis.
  function coneHit(frame, apex, axis, sat, halfAngleDeg, maxHeightKm) {
    const v = sub(sat, apex), range = mag(v);
    if (!range) return null;
    const up = dot(v, frame.u);
    if (up <= 0) return null;                              // below the horizon
    const axial = dot(v, axis);
    if (axial <= 0 || axial > maxHeightKm) return null;    // behind the apex or past the cap
    const offAxis = Math.acos(Math.min(1, axial / range)) / DEG;
    if (offAxis > halfAngleDeg) return null;
    return { range, elevation: Math.asin(Math.min(1, up / range)) / DEG, offAxis };
  }

  // One cone, precomputed: the apex, its local frame, the axis and the two
  // trigonometric terms nearCone needs.  `inp` is { lat, lng, angle, height }
  // and the lean is a tilt from vertical plus a compass bearing.
  function coneCtx(inp, tiltAngle, tiltDir) {
    const frame = enuFrame(inp.lat, inp.lng);
    return { inp, tilt: { angle: tiltAngle, dir: tiltDir }, frame,
             apex: geodeticToECEF(inp.lat, inp.lng, 0),
             axis: axisFrom(frame, tiltAngle, tiltDir),
             ca: Math.cos(inp.angle * DEG), sa: Math.sin(inp.angle * DEG) };
  }

  // Could an Earth-fixed point (km) lie within m km of the cone?  The distance to
  // the cone's side line never exceeds the true distance, so nothing that close
  // is ever rejected.
  function nearCone(c, p, m) {
    const v = sub(p, c.apex), a = dot(v, c.axis);
    if (dot(v, c.frame.u) < -m || a < -m || a > c.inp.height + m) return false;
    return Math.sqrt(Math.max(0, dot(v, v) - a * a)) * c.ca - a * c.sa <= m;
  }

  // The exact cone test at one instant, straight from an element set.
  function inConeAt(c, rec, ms) {
    const date = new Date(ms), pv = satellite.propagate(rec, date);
    if (!pv || !pv.position || !Number.isFinite(pv.position.x)) return false;
    const gmst = satellite.gstime(date);
    if (!nearCone(c, satellite.eciToEcf(pv.position, gmst), COARSE_KM)) return false;
    const g = satellite.eciToGeodetic(pv.position, gmst);
    return !!coneHit(c.frame, c.apex, c.axis,
      geodeticToECEF(satellite.degreesLat(g.latitude), satellite.degreesLong(g.longitude), g.height),
      c.inp.angle, c.inp.height);
  }

  // The cone's reach over the ground: the points below rings of the cone at
  // several heights up to the cap.
  function coneRim(c) {
    const { inp, axis, frame, apex } = c, pts = [];
    const ref = Math.abs(dot(frame.n, axis)) < 0.9 ? frame.n : frame.e, k = dot(ref, axis);
    let b1 = { x: ref.x - k * axis.x, y: ref.y - k * axis.y, z: ref.z - k * axis.z };
    const n1 = mag(b1);
    b1 = { x: b1.x / n1, y: b1.y / n1, z: b1.z / n1 };
    const b2 = { x: axis.y * b1.z - axis.z * b1.y, y: axis.z * b1.x - axis.x * b1.z, z: axis.x * b1.y - axis.y * b1.x };
    const spread = Math.tan(Math.min(inp.angle, 89) * DEG);
    for (let j = 1; j <= 12; j++) {
      const h = inp.height * j / 12;
      for (let q = 0; q < 48; q++) {
        const u = Math.cos(q / 48 * 2 * Math.PI) * spread * h, w = Math.sin(q / 48 * 2 * Math.PI) * spread * h;
        const P = { x: apex.x + axis.x * h + b1.x * u + b2.x * w, y: apex.y + axis.y * h + b1.y * u + b2.y * w, z: apex.z + axis.z * h + b1.z * u + b2.z * w };
        pts.push({ lat: Math.asin(P.z / mag(P)) / DEG, lon: Math.atan2(P.y, P.x) / DEG });
      }
    }
    return pts;
  }

  function convexHull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
      upper.push(pts[i]);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  // --- Satellites and directions -----------------------------------------

  // Lat/lon/alt of one satellite at `date` — SGP4 + geodetic, as tle-loader's
  // propagate() but without its observer look-angles.
  function satGeo(rec, date, gmst) {
    const pv = satellite.propagate(rec, date);
    if (!pv || !pv.position) return null;
    const g = satellite.eciToGeodetic(pv.position, gmst === undefined ? satellite.gstime(date) : gmst);
    const lat = satellite.degreesLat(g.latitude), lon = satellite.degreesLong(g.longitude), alt = g.height;
    return Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(alt) ? { lat, lon, alt } : null;
  }

  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compassPoint = dir => COMPASS[Math.round(dir / 22.5) % 16];

  global.ConeGeom = {
    EARTH_R_KM, DEG, COARSE_KM,
    escHtml,
    geodeticToECEF, sub, mag, dot, enuFrame, axisFrom,
    coneHit, coneCtx, nearCone, inConeAt, coneRim, convexHull,
    satGeo, compassPoint,
  };
})(window);
