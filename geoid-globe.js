/* =====================================================================
   geoid-globe.js -- a drop-in 3-D geoid globe with a satellite layer.

   Renders dist/geoid-globe.json (GRACE GGM02C geoid undulation) as a
   displaced, vertex-coloured sphere, and plots satellites on it from your
   own TLEs. Rotate by dragging, zoom by wheel or two-finger pinch.

   Requires three.js (r150+). satellite.js is only needed if you feed it
   TLEs; the lat/lon plotting API works without it.

       <script src="https://unpkg.com/three@0.157.0/build/three.min.js"></script>
       <script src="https://unpkg.com/satellite.js@5.0.0/dist/satellite.min.js"></script>
       <script src="geoid-globe.js"></script>

   Exposes window.GeoidGlobe (and a CommonJS export if you bundle it).

   Frame convention, matching globe.gl so it lines up with the rest of NAZAR:
       x =  r * cos(lat) * cos(lon)
       y =  r * sin(lat)
       z = -r * cos(lat) * sin(lon)
   The globe's surface radius is `opts.radius` units (default 100) for
   6371 km, so 1 unit = 63.71 km.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GeoidGlobe = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EARTH_R_KM = 6371.0087714;
  var DEG = Math.PI / 180;

  // ---------------------------------------------------------------- helpers

  function latLonToVec3(lat, lon, r, out) {
    var cl = Math.cos(lat * DEG);
    out = out || { x: 0, y: 0, z: 0 };
    out.x = r * cl * Math.cos(lon * DEG);
    out.y = r * Math.sin(lat * DEG);
    out.z = -r * cl * Math.sin(lon * DEG);
    return out;
  }

  /**
   * Earth-fixed kilometres -> scene units. ECEF is Z-up with X through
   * (0° N, 0° E); the scene is Y-up, so the axes rotate and Y flips sign.
   * `k` is scene units per kilometre.
   */
  function ecfToScene(f, k) {
    return { x: f.x * k, y: f.z * k, z: -f.y * k };
  }

  /**
   * Sample a colormap definition ({domain, stops, center?}) -> [r,g,b] 0..1.
   * With `center`, the ramp is split piecewise so that value lands exactly on
   * the middle stop -- what a diverging scale over lopsided data needs.
   */
  function makeColorSampler(cmap) {
    var lo = cmap.domain[0], hi = cmap.domain[1], stops = cmap.stops;
    var mid = cmap.center;
    return function (v) {
      var t;
      if (mid == null) {
        t = (v - lo) / (hi - lo);
      } else if (v < mid) {
        t = 0.5 * (1 - (v - mid) / (lo - mid || 1));
      } else {
        t = 0.5 + 0.5 * ((v - mid) / (hi - mid || 1));
      }
      if (!(t > 0)) t = 0; else if (t > 1) t = 1;
      var i = 1;
      while (i < stops.length - 1 && stops[i][0] < t) i++;
      var a = stops[i - 1], b = stops[i];
      var f = (t - a[0]) / (b[0] - a[0] || 1);
      // sRGB stops are eased in linear space so the ramp reads evenly.
      return [
        (a[1][0] + (b[1][0] - a[1][0]) * f) / 255,
        (a[1][1] + (b[1][1] - a[1][1]) * f) / 255,
        (a[1][2] + (b[1][2] - a[1][2]) * f) / 255
      ];
    };
  }

  /**
   * A polyline with real, controllable thickness.
   *
   * THREE.LineBasicMaterial.linewidth is silently ignored on every WebGL
   * platform that matters (ANGLE on Windows clamps it to 1px), so a Line
   * cannot be made thicker. A swept tube can, at the cost of a little
   * geometry -- a few thousand vertices per orbit, which is nothing.
   *
   * `centripetal` parameterisation is deliberate: with points spaced unevenly
   * along an eccentric orbit, the plain catmullrom variant overshoots into
   * cusps near perigee.
   */
  function tubeFromPoints(THREE, points, opts) {
    var pts = points;
    if (opts.closed && pts.length > 1) {
      var a = pts[0], b = pts[pts.length - 1];
      if (a.distanceToSquared(b) < 1e-12) pts = pts.slice(0, -1);  // drop the seam
    }
    var curve = new THREE.CatmullRomCurve3(pts, !!opts.closed, 'centripetal', 0.5);
    var geom = new THREE.TubeGeometry(curve, pts.length, opts.radius, 8, !!opts.closed);
    var mat = new THREE.MeshBasicMaterial({
      color: opts.color,
      transparent: opts.opacity != null && opts.opacity < 1,
      opacity: opts.opacity != null ? opts.opacity : 1,
      depthWrite: opts.opacity == null || opts.opacity >= 1
    });
    var mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = opts.renderOrder || 0;
    return mesh;
  }

  /** A soft round sprite, so satellite dots aren't squares. */
  function dotTexture(THREE) {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0.0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1.0, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    var t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  }

  // ------------------------------------------------------- pointer controls
  //
  // Deliberately hand-rolled rather than pulling in OrbitControls: this keeps
  // the module dependency-free apart from three itself, and gives us pinch
  // zoom on touch devices without fighting anyone else's gesture handling.

  function Controls(camera, dom, opts) {
    var self = this;
    this.enabled = true;
    this.minDistance = opts.minDistance;
    this.maxDistance = opts.maxDistance;
    this.rotateSpeed = 0.45;
    this.zoomSpeed = 1.0;
    this.easing = 0.18;        // fraction of the outstanding move paid out per frame
    // Matched to the rotation easing. A slower settle sounds smoother but
    // reads as sticky -- the camera keeps drifting after you have stopped.
    this.zoomEasing = opts.zoomEasing != null ? opts.zoomEasing : 0.18;
    // How much of a pinch translates into zoom. Still under 1 so a single
    // gesture cannot swallow the whole range, but high enough that reaching
    // HEO apogee does not take a dozen pinches.
    this.pinchGain = opts.pinchGain != null ? opts.pinchGain : 0.8;
    this.wheelStep = opts.wheelStep != null ? opts.wheelStep : 0.16;
    this.autoRotate = !!opts.autoRotate;
    this.autoRotateSpeed = opts.autoRotateSpeed || 0.06; // deg per frame

    // Distance is tracked logarithmically. Zoom is inherently multiplicative --
    // "twice as close" means the same thing from anywhere -- so working in log
    // space makes a given gesture change distance by a constant *percentage*
    // instead of a constant number of units. Linear tracking is what made this
    // lurch: the same input moved you 12 units near the surface and 120 far out.
    var theta = opts.theta, phi = opts.phi;
    var logDist = Math.log(opts.distance);
    var dTheta = 0, dPhi = 0, dLog = 0;
    var pointers = {}, ids = [];
    var lastMid = null, lastSpread = 0;
    var EPS = 0.0001;

    function mid() {
      var a = pointers[ids[0]], b = pointers[ids[1]];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    function spread() {
      var a = pointers[ids[0]], b = pointers[ids[1]];
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function down(e) {
      if (!self.enabled) return;
      // Reset the drag flag first: capture can throw (no live pointer, or the
      // node was re-parented), and a stale `true` would swallow the next click.
      self._dragged = false;
      try { dom.setPointerCapture(e.pointerId); } catch (_) {}
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      ids = Object.keys(pointers);
      if (ids.length === 2) { lastMid = mid(); lastSpread = spread(); }
    }

    function move(e) {
      if (!pointers[e.pointerId]) return;
      var p = pointers[e.pointerId];
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;

      if (ids.length === 1) {
        if (Math.abs(dx) + Math.abs(dy) > 2) self._dragged = true;
        dTheta -= dx * self.rotateSpeed * 0.01;
        dPhi -= dy * self.rotateSpeed * 0.01;
      } else if (ids.length >= 2) {
        self._dragged = true;
        var m = mid(), s = spread();
        // Pinch: the log of the spread ratio, so spreading your fingers by the
        // same proportion always zooms by the same proportion.
        if (lastSpread > 0 && s > 0) {
          dLog -= Math.log(s / lastSpread) * self.pinchGain * self.zoomSpeed;
        }
        // Two-finger drag still rotates, so the gesture never feels stuck.
        dTheta -= (m.x - lastMid.x) * self.rotateSpeed * 0.01;
        dPhi -= (m.y - lastMid.y) * self.rotateSpeed * 0.01;
        lastMid = m; lastSpread = s;
      }
    }

    function up(e) {
      delete pointers[e.pointerId];
      ids = Object.keys(pointers);
      if (ids.length === 2) { lastMid = mid(); lastSpread = spread(); }
      try { dom.releasePointerCapture(e.pointerId); } catch (_) {}
    }

    function wheel(e) {
      if (!self.enabled) return;
      e.preventDefault();
      // Normalise across input devices: a mouse notch arrives as ~120 pixels,
      // a trackpad as a stream of small deltas, and some browsers report lines
      // or pages instead. Without this a trackpad either crawls or bolts.
      var d = e.deltaY;
      if (e.deltaMode === 1) d *= 16;           // lines
      else if (e.deltaMode === 2) d *= 100;     // pages
      if (d > 160) d = 160; else if (d < -160) d = -160;
      dLog += (d / 120) * self.wheelStep * self.zoomSpeed;
    }

    dom.style.touchAction = 'none';
    dom.addEventListener('pointerdown', down);
    dom.addEventListener('pointermove', move);
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', wheel, { passive: false });

    this.dispose = function () {
      dom.removeEventListener('pointerdown', down);
      dom.removeEventListener('pointermove', move);
      dom.removeEventListener('pointerup', up);
      dom.removeEventListener('pointercancel', up);
      dom.removeEventListener('wheel', wheel);
    };

    this.dragging = function () { return ids.length > 0; };
    this.distance = function () { return Math.exp(logDist); };
    this.setPointOfView = function (lat, lon, d) {
      if (lat != null) phi = (90 - lat) * DEG;
      if (lon != null) theta = lon * DEG;
      if (d != null) { logDist = Math.log(d); dLog = 0; }
    };

    this.update = function () {
      // Subtract, not add. Earth turns eastward, which means the longitude
      // facing any fixed direction *decreases* with time -- the sub-solar point
      // moves from 0 deg to 15 deg W over an hour, not the other way. Adding
      // here span the globe backwards.
      if (self.autoRotate && !ids.length) theta -= self.autoRotateSpeed * DEG;

      // dTheta/dPhi/dLog hold the move still *owed* to the user. Each frame we
      // pay out a slice and subtract it, so the total travel equals exactly what
      // the gesture asked for -- accumulating it instead would multiply every
      // input by 1/easing and send one wheel notch straight to the zoom stop.
      var e = self.easing, ez = self.zoomEasing;
      var st = dTheta * e, sp2 = dPhi * e, sl = dLog * ez;
      theta += st; phi += sp2; logDist += sl;
      dTheta -= st; dPhi -= sp2; dLog -= sl;
      if (Math.abs(dTheta) < 1e-6) dTheta = 0;
      if (Math.abs(dPhi) < 1e-6) dPhi = 0;
      if (Math.abs(dLog) < 1e-6) dLog = 0;

      phi = Math.max(EPS, Math.min(Math.PI - EPS, phi));

      // Drop the outstanding zoom on contact with a limit. Keeping it would let
      // an over-enthusiastic pinch sit pinned against the stop, refusing to
      // reverse until the leftover had decayed away.
      var loMin = Math.log(self.minDistance), loMax = Math.log(self.maxDistance);
      if (logDist < loMin) { logDist = loMin; dLog = 0; }
      else if (logDist > loMax) { logDist = loMax; dLog = 0; }

      var dist = Math.exp(logDist);
      var sp = Math.sin(phi);
      camera.position.set(
        dist * sp * Math.cos(theta),
        dist * Math.cos(phi),
        -dist * sp * Math.sin(theta)
      );
      camera.lookAt(0, 0, 0);
    };

    this.spherical = function () {
      return { theta: theta, phi: phi, distance: Math.exp(logDist) };
    };
  }

  // ------------------------------------------------------------------ globe

  function Globe(opts) {
    var THREE = opts.three || window.THREE;
    if (!THREE) throw new Error('GeoidGlobe: three.js not found (pass opts.three)');

    var self = this;
    this.THREE = THREE;
    this.opts = opts;
    this.radius = opts.radius || 100;
    this.kmPerUnit = EARTH_R_KM / this.radius;
    this.relief = opts.relief != null ? opts.relief : 0.035;
    // Visual scaling of orbital altitude. 1 is true; below 1 pulls GEO and HEO
    // down where they can be seen alongside LEO, above 1 lifts LEO clear of
    // the surface. Applied to the radial excess above mean radius, so the
    // surface itself never moves.
    this.altScale = opts.altitudeScale != null ? opts.altitudeScale : 1;
    // Max deviation of the red curve from the green, as a fraction of the
    // orbit's own radius. 0 draws the real path exactly where it is.
    this.deviationTarget = opts.deviationTarget != null ? opts.deviationTarget : 0.055;
    this._sats = [];
    this._byId = {};
    this._orbits = {};
    this._listeners = { select: [], hover: [], tick: [] };

    var container = typeof opts.container === 'string'
      ? document.querySelector(opts.container) : opts.container;
    if (!container) throw new Error('GeoidGlobe: container not found');
    this.container = container;

    // --- scene -------------------------------------------------------------
    var scene = new THREE.Scene();
    this.scene = scene;
    if (opts.background !== null) {
      scene.background = new THREE.Color(opts.background != null ? opts.background : 0x05070d);
    }

    var camera = new THREE.PerspectiveCamera(
      45, 1, this.radius * 0.005, this.radius * Math.max(200, (opts.maxZoom || 65) * 4));
    this.camera = camera;

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: opts.background === null });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    var key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(1, 0.7, 0.9).multiplyScalar(this.radius * 5);
    scene.add(key);
    var rim = new THREE.DirectionalLight(0x88aaff, 0.28);
    rim.position.set(-1, -0.4, -0.8).multiplyScalar(this.radius * 5);
    scene.add(rim);
    this._lights = { key: key, rim: rim };

    this.controls = new Controls(camera, renderer.domElement, {
      theta: (opts.initialLon != null ? opts.initialLon : 20) * DEG,
      phi: (90 - (opts.initialLat != null ? opts.initialLat : 15)) * DEG,
      distance: this.radius * (opts.initialZoom || 3.0),
      minDistance: this.radius * (1 + this.relief) * 1.06,
      // TESS reaches 364,000 km -- about 5,700 globe units -- so the old 12x
      // ceiling put most of the HEO population permanently out of frame.
      maxDistance: this.radius * (opts.maxZoom || 65),
      autoRotate: !!opts.autoRotate,
      autoRotateSpeed: opts.autoRotateSpeed,
      pinchGain: opts.pinchGain,
      wheelStep: opts.wheelStep,
      zoomEasing: opts.zoomEasing
    });

    this._raycaster = new THREE.Raycaster();
    this._raycaster.params.Points = { threshold: this.radius * 0.02 };
    this._mouse = new THREE.Vector2();

    // --- clock -------------------------------------------------------------
    this.time = opts.time ? new Date(opts.time) : new Date();
    this.timeScale = opts.timeScale != null ? opts.timeScale : 1;
    this.playing = opts.playing !== false;
    this._lastFrame = performance.now();

    this._resize();
    this._ro = (typeof ResizeObserver !== 'undefined')
      ? new ResizeObserver(function () { self._resize(); })
      : null;
    if (this._ro) this._ro.observe(container);
    else window.addEventListener('resize', function () { self._resize(); });

    renderer.domElement.addEventListener('pointerdown', function (e) { self._pickAt(e, 'down'); });
    renderer.domElement.addEventListener('pointerup', function (e) {
      if (!self.controls._dragged) self._pickAt(e, 'select');
    });
    renderer.domElement.addEventListener('pointermove', function (e) {
      if (!self.controls.dragging()) self._pickAt(e, 'hover');
    });

    this.ready = this._loadModel(opts.modelUrl || 'geoid-globe.json')
      .then(function () {
        if (opts.coastlinesUrl) return self.addCoastlines(opts.coastlinesUrl).catch(function () {});
      })
      .then(function () { self._animate(); return self; });
  }

  // ---------------------------------------------------------------- loading

  Globe.prototype._loadModel = function (url) {
    var self = this;
    var p = (typeof url === 'string')
      ? fetch(url).then(function (r) {
          if (!r.ok) throw new Error('GeoidGlobe: cannot load ' + url + ' (' + r.status + ')');
          return r.json();
        })
      : Promise.resolve(url); // an already-parsed model object is fine too
    return p.then(function (model) {
      self.model = model;
      self._buildSurface(model);
      if (self.opts.graticule !== false) self.addGraticule();
    });
  };

  Globe.prototype._buildSurface = function (model) {
    var THREE = this.THREE;
    var g = model.grid, rows = model.undulation;
    var step = this.opts.subdivision || 1;
    var nLat = g.nLat, nLon = g.nLon;
    var js = [], is = [];
    for (var j = 0; j < nLat; j += step) js.push(j);
    if (js[js.length - 1] !== nLat - 1) js.push(nLat - 1);
    for (var i = 0; i < nLon; i += step) is.push(i);
    if (is[is.length - 1] !== nLon - 1) is.push(nLon - 1);

    var H = js.length, W = is.length;
    var pos = new Float32Array(H * W * 3);
    var col = new Float32Array(H * W * 3);
    var uv = new Float32Array(H * W * 2);
    var sample = makeColorSampler(model.colormap);
    this._sampleColor = sample;

    // Displacement is measured from the ellipsoid (0 m), not from the middle of
    // the data range, so the undisplaced sphere stays the physical reference.
    var span = Math.max(Math.abs(model.stats.min), Math.abs(model.stats.max)) || 1;
    var mid = 0, half = span;
    var R = this.radius, relief = this.relief;
    var v = { x: 0, y: 0, z: 0 };
    var k = 0;

    for (var a = 0; a < H; a++) {
      var lat = g.latStart + js[a] * g.latStep;
      var row = rows[js[a]];
      for (var b = 0; b < W; b++) {
        var lon = g.lonStart + is[b] * g.lonStep;
        var N = row[is[b]];
        var r = R * (1 + relief * (N - mid) / half);
        latLonToVec3(lat, lon, r, v);
        pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
        var c = sample(N);
        col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
        uv[k * 2] = b / (W - 1); uv[k * 2 + 1] = 1 - a / (H - 1);
        k++;
      }
    }

    var idx = [];
    for (var y = 0; y < H - 1; y++) {
      for (var x = 0; x < W - 1; x++) {
        var p0 = y * W + x, p1 = p0 + 1, p2 = p0 + W, p3 = p2 + 1;
        idx.push(p0, p2, p1, p1, p2, p3);
      }
    }

    var geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geom.setIndex(idx.length > 65535 ? new THREE.Uint32BufferAttribute(idx, 1)
                                     : new THREE.Uint16BufferAttribute(idx, 1));
    geom.computeVertexNormals();

    var mat = new THREE.MeshPhongMaterial({
      vertexColors: true, shininess: 12, specular: 0x222222, flatShading: false
    });
    var mesh = new THREE.Mesh(geom, mat);
    mesh.name = 'geoid-surface';
    this.scene.add(mesh);
    this.surface = mesh;
    this._grid = { H: H, W: W, js: js, is: is };

    // Baseline sphere at the undisplaced radius, so altitudes stay honest when
    // relief is exaggerated -- satellites are placed against THIS, not the bumps.
    this._baseRadius = R;
    this._span = half;
  };

  // ----------------------------------------------------------- field lookup

  /** Geoid undulation in metres at a geographic point (bilinear). */
  Globe.prototype.geoidAt = function (lat, lon) {
    var g = this.model.grid, rows = this.model.undulation;
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    lat = Math.max(-90, Math.min(90, lat));
    var fy = (lat - g.latStart) / g.latStep;
    var fx = (lon - g.lonStart) / g.lonStep;
    var y0 = Math.floor(fy), x0 = Math.floor(fx);
    var y1 = Math.min(y0 + 1, g.nLat - 1), x1 = Math.min(x0 + 1, g.nLon - 1);
    y0 = Math.max(0, Math.min(y0, g.nLat - 1));
    x0 = Math.max(0, Math.min(x0, g.nLon - 1));
    var ty = fy - y0, tx = fx - x0;
    var a = rows[y0][x0], b = rows[y0][x1], c = rows[y1][x0], d = rows[y1][x1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };

  /** Colour of the geoid at a point, as a hex int -- handy for legends. */
  Globe.prototype.colorAt = function (lat, lon) {
    var c = this._sampleColor(this.geoidAt(lat, lon));
    return (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
  };

  /**
   * Radius of the *displaced* surface under a point, in scene units. Overlays
   * that should hug the terrain (coastlines, graticule) use this; anything
   * physical (satellites, orbits) must use the undisplaced radius instead.
   */
  Globe.prototype.surfaceRadius = function (lat, lon) {
    return this._baseRadius * (1 + this.relief * this.geoidAt(lat, lon) / this._span);
  };

  /** Scene-space position of a geographic point at altitude altKm. */
  Globe.prototype.toVector = function (lat, lon, altKm) {
    var r = this._baseRadius * (1 + (altKm || 0) / EARTH_R_KM);
    var v = latLonToVec3(lat, lon, r);
    return new this.THREE.Vector3(v.x, v.y, v.z);
  };

  // ------------------------------------------------------------- decoration

  Globe.prototype.addGraticule = function (spacingDeg) {
    var THREE = this.THREE, s = spacingDeg || 30;
    var pts = [], self = this;
    function push(lat, lon) {
      var v = latLonToVec3(lat, lon, self.surfaceRadius(lat, lon) * 1.002);
      pts.push(v.x, v.y, v.z);
    }
    for (var lon = -180; lon < 180; lon += s) {
      for (var lat = -90; lat < 90; lat += 2) { push(lat, lon); push(lat + 2, lon); }
    }
    for (var la = -60; la <= 60; la += s) {
      for (var lo = -180; lo < 180; lo += 2) { push(la, lo); push(la, lo + 2); }
    }
    var geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    var line = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.13, depthWrite: false
    }));
    line.name = 'graticule';
    this.scene.add(line);
    this.graticule = line;
    this._graticuleSpacing = s;
    return line;
  };

  /**
   * Drape coastlines / country borders over the geoid from a GeoJSON source --
   * this is the "with outlines of land masses" variant on the SVS page.
   */
  Globe.prototype.addCoastlines = function (urlOrGeoJson, options) {
    var self = this, THREE = this.THREE;
    options = options || {};
    var p = (typeof urlOrGeoJson === 'string')
      ? fetch(urlOrGeoJson).then(function (r) { return r.json(); })
      : Promise.resolve(urlOrGeoJson);

    return p.then(function (gj) {
      self._coastSource = { data: gj, options: options };
      var pts = [];
      var lift = options.lift != null ? options.lift : 1.004;
      function ring(coords) {
        for (var i = 0; i < coords.length - 1; i++) {
          var A = coords[i], B = coords[i + 1];
          if (Math.abs(A[0] - B[0]) > 180) continue; // antimeridian seam
          // Subdivide so long segments hug the sphere instead of cutting through.
          var n = Math.max(1, Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1]) / 2));
          for (var k = 0; k < n; k++) {
            var la0 = A[1] + (B[1] - A[1]) * (k / n), lo0 = A[0] + (B[0] - A[0]) * (k / n);
            var la1 = A[1] + (B[1] - A[1]) * ((k + 1) / n), lo1 = A[0] + (B[0] - A[0]) * ((k + 1) / n);
            var v0 = latLonToVec3(la0, lo0, self.surfaceRadius(la0, lo0) * lift);
            var v1 = latLonToVec3(la1, lo1, self.surfaceRadius(la1, lo1) * lift);
            pts.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z);
          }
        }
      }
      function walk(geom) {
        if (!geom) return;
        if (geom.type === 'Polygon') geom.coordinates.forEach(ring);
        else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(function (p) { p.forEach(ring); });
        else if (geom.type === 'LineString') ring(geom.coordinates);
        else if (geom.type === 'MultiLineString') geom.coordinates.forEach(ring);
        else if (geom.type === 'GeometryCollection') geom.geometries.forEach(walk);
      }
      if (gj.type === 'FeatureCollection') gj.features.forEach(function (f) { walk(f.geometry); });
      else walk(gj.geometry || gj);

      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      var line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
        color: options.color != null ? options.color : 0x0b0d12,
        transparent: true, opacity: options.opacity != null ? options.opacity : 0.75,
        depthWrite: false
      }));
      line.name = 'coastlines';
      self.scene.add(line);
      self.coastlines = line;
      return line;
    });
  };

  // -------------------------------------------------------- satellite layer

  Globe.prototype._ensureSatLayer = function () {
    if (this._satPoints) return;
    var THREE = this.THREE;
    var geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
    var mat = new THREE.PointsMaterial({
      size: (this.opts.satSize || 0.02) * this.radius,
      vertexColors: true, map: dotTexture(THREE), transparent: true,
      alphaTest: 0.02, depthWrite: false, sizeAttenuation: true
    });
    var pts = new THREE.Points(geom, mat);
    pts.name = 'satellites';
    pts.frustumCulled = false;
    this.scene.add(pts);
    this._satPoints = pts;
  };

  /**
   * Plot a satellite at a fixed sub-point, or (with `tle`) one that propagates.
   *
   *   globe.addSatellite({ id:'25544', name:'ISS', lat:.., lon:.., altKm:.. })
   *   globe.addSatellite({ id:'25544', name:'ISS', tle:[line1, line2] })
   */
  Globe.prototype.addSatellite = function (sat) {
    this._ensureSatLayer();
    var s = {
      id: sat.id != null ? String(sat.id) : String(this._sats.length),
      name: sat.name || sat.id || '',
      lat: sat.lat || 0, lon: sat.lon || 0, altKm: sat.altKm || 0,
      color: sat.color != null ? sat.color : 0x67c8ff,
      data: sat.data || null,
      satrec: null,
      visible: sat.visible !== false
    };
    if (sat.tle) {
      var satlib = this.opts.satelliteJs || window.satellite;
      if (!satlib) throw new Error('GeoidGlobe: satellite.js is required to plot TLEs');
      s.satrec = satlib.twoline2satrec(sat.tle[0], sat.tle[1]);
      if (!s.satrec || s.satrec.error) return null; // unparseable TLE, skip it
    }
    this._sats.push(s);
    this._byId[s.id] = s;
    this._satDirty = true;
    return s;
  };

  /**
   * Bulk-load a TLE catalogue. Accepts the usual 3-line format (name, then the
   * two element lines) as well as bare 2-line sets.
   */
  Globe.prototype.loadTLEText = function (text, options) {
    options = options || {};
    var lines = text.split(/\r?\n/).map(function (l) { return l.replace(/\s+$/, ''); })
                    .filter(function (l) { return l.length; });
    var added = 0, i = 0;
    while (i < lines.length) {
      var name = null, l1, l2;
      if (lines[i][0] === '1' && lines[i][1] === ' ') { l1 = lines[i]; l2 = lines[i + 1]; i += 2; }
      else { name = lines[i].trim(); l1 = lines[i + 1]; l2 = lines[i + 2]; i += 3; }
      if (!l1 || !l2 || l1[0] !== '1' || l2[0] !== '2') continue;
      var id = l1.substring(2, 7).trim();
      if (options.filter && !options.filter(name, id)) continue;
      var color = typeof options.color === 'function'
        ? options.color(name, id) : (options.color != null ? options.color : 0x67c8ff);
      if (this.addSatellite({ id: id, name: name || id, tle: [l1, l2], color: color })) added++;
      if (options.limit && added >= options.limit) break;
    }
    this._satDirty = true;
    return added;
  };

  Globe.prototype.removeSatellite = function (id) {
    var s = this._byId[String(id)];
    if (!s) return false;
    this._sats.splice(this._sats.indexOf(s), 1);
    delete this._byId[String(id)];
    this.hideOrbit(id);
    this._satDirty = true;
    return true;
  };

  Globe.prototype.clearSatellites = function () {
    var self = this;
    Object.keys(this._orbits).forEach(function (k) { self.hideOrbit(k); });
    this._sats = []; this._byId = {}; this._satDirty = true;
  };

  Globe.prototype.getSatellite = function (id) { return this._byId[String(id)] || null; };
  Globe.prototype.satellites = function () { return this._sats.slice(); };

  /** Propagate every TLE-backed satellite to `date` and refresh the dot buffer. */
  Globe.prototype._updateSats = function (date) {
    if (!this._satPoints) return;
    var satlib = this.opts.satelliteJs || window.satellite;
    var gmst = satlib ? satlib.gstime(date) : 0;
    var list = this._sats, n = 0;
    var pos = this._satPosBuf, col = this._satColBuf;
    if (!pos || pos.length < list.length * 3) {
      pos = this._satPosBuf = new Float32Array(Math.max(16, list.length) * 3);
      col = this._satColBuf = new Float32Array(Math.max(16, list.length) * 3);
      this._satDirty = true;
    }
    this._visibleIndex = [];

    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s.visible) continue;
      if (s.satrec && satlib) {
        var pv = satlib.propagate(s.satrec, date);
        if (!pv || !pv.position) continue;
        var gd = satlib.eciToGeodetic(pv.position, gmst);
        s.lat = gd.latitude / DEG;
        s.lon = gd.longitude / DEG;
        while (s.lon > 180) s.lon -= 360;
        while (s.lon < -180) s.lon += 360;
        s.altKm = gd.height;
        if (!isFinite(s.altKm) || s.altKm < -100) continue;
        // Keep the true Earth-fixed vector for placement. Geodetic height is
        // measured from the ellipsoid, so re-adding it to a sphere of mean
        // radius would misplace the dot by up to ~20 km -- enough to visibly
        // lift it off the orbit curves drawn by showOrbitEllipse().
        s._ecf = satlib.eciToEcf(pv.position, gmst);
      }
      var v = s._ecf
        ? ecfToScene(s._ecf, this._baseRadius / EARTH_R_KM)
        : latLonToVec3(s.lat, s.lon, this._baseRadius * (1 + s.altKm / EARTH_R_KM));
      this._applyAlt(v);
      pos[n * 3] = v.x; pos[n * 3 + 1] = v.y; pos[n * 3 + 2] = v.z;
      col[n * 3] = ((s.color >> 16) & 255) / 255;
      col[n * 3 + 1] = ((s.color >> 8) & 255) / 255;
      col[n * 3 + 2] = (s.color & 255) / 255;
      this._visibleIndex.push(i);
      n++;
    }

    var geom = this._satPoints.geometry;
    if (this._satDirty || geom.getAttribute('position').count !== pos.length / 3) {
      geom.setAttribute('position', new this.THREE.BufferAttribute(pos, 3));
      geom.setAttribute('color', new this.THREE.BufferAttribute(col, 3));
      this._satDirty = false;
    }
    geom.getAttribute('position').needsUpdate = true;
    geom.getAttribute('color').needsUpdate = true;
    geom.setDrawRange(0, n);
  };

  /** Draw one satellite's ground-relative orbit track as a polyline. */
  Globe.prototype.showOrbit = function (id, options) {
    options = options || {};
    var s = this._byId[String(id)];
    if (!s || !s.satrec) return null;
    var satlib = this.opts.satelliteJs || window.satellite;
    var THREE = this.THREE;
    this.hideOrbit(id);

    // One full revolution by default: satrec.no is radians per minute.
    var periodMin = options.minutes || (2 * Math.PI / s.satrec.no);
    var steps = options.steps || 256;
    var t0 = this.time.getTime();
    var pts = [];
    for (var i = 0; i <= steps; i++) {
      var d = new Date(t0 + (i / steps) * periodMin * 60000);
      var pv = satlib.propagate(s.satrec, d);
      if (!pv || !pv.position) continue;
      var gd = satlib.eciToGeodetic(pv.position, satlib.gstime(d));
      var v = this._applyAlt(latLonToVec3(gd.latitude / DEG, gd.longitude / DEG,
                           this._baseRadius * (1 + gd.height / EARTH_R_KM)));
      pts.push(v.x, v.y, v.z);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    var line = new THREE.Line(g, new THREE.LineBasicMaterial({
      color: options.color != null ? options.color : s.color,
      transparent: true, opacity: options.opacity != null ? options.opacity : 0.85,
      depthWrite: false
    }));
    line.name = 'orbit:' + s.id;
    this.scene.add(line);
    this._orbits[String(id)] = line;
    return line;
  };

  /**
   * Draw the orbit as it actually is in space -- a closed loop around the globe
   * rather than the wavy ground track showOrbit() gives. Two curves come out:
   *
   *   solid   the path SGP4 really flies over one revolution. SGP4 carries
   *           Earth's zonal gravity terms -- J2 above all, the oblateness that
   *           is also the single largest feature of the geoid -- so this path
   *           precesses and does not quite close on itself.
   *   dashed  the two-body Kepler ellipse through the same instantaneous
   *           position and velocity: the orbit a perfectly spherical Earth
   *           would produce.
   *
   * The gap between them *is* the gravity field bending the orbit. One honest
   * caveat, worth repeating in any UI built on this: that gap reflects the
   * low-order zonal field SGP4 models, not the full GGM02C field the globe is
   * coloured with. A TLE simply does not carry enough information to reproduce
   * the fine geoid structure, so this shows the dominant distortion, not all
   * of it.
   *
   * Both curves are built at one frozen Earth orientation, so they keep their
   * true inertial shape instead of smearing into a ground track.
   */
  Globe.prototype.showOrbitEllipse = function (id, options) {
    options = options || {};
    var s = this._byId[String(id)];
    if (!s || !s.satrec) return null;
    var satlib = this.opts.satelliteJs || window.satellite;
    if (!satlib) return null;
    var THREE = this.THREE;
    this.hideOrbit(id);

    var MU = 398600.4418;                      // km^3/s^2, Earth's GM
    var K = this._baseRadius / EARTH_R_KM;     // scene units per km
    var date0 = new Date(this.time.getTime());
    var gmst0 = satlib.gstime(date0);
    function toScene(p) {
      var v = ecfToScene(satlib.eciToEcf(p, gmst0), K);
      return new THREE.Vector3(v.x, v.y, v.z);
    }

    var periodMin = options.minutes || (2 * Math.PI / s.satrec.no);
    var steps = options.steps || 360;

    // --- the real, perturbed path
    var actual = [], state0 = null;
    for (var i = 0; i <= steps; i++) {
      var pv = satlib.propagate(
        s.satrec, new Date(date0.getTime() + (i / steps) * periodMin * 60000));
      if (!pv || !pv.position || !pv.velocity) continue;
      if (!state0) state0 = pv;
      actual.push(toScene(pv.position));
    }
    if (!state0 || actual.length < 8) return null;

    // --- osculating Kepler ellipse from the state vector at this instant
    var rv = new THREE.Vector3(state0.position.x, state0.position.y, state0.position.z);
    var vv = new THREE.Vector3(state0.velocity.x, state0.velocity.y, state0.velocity.z);
    var rm = rv.length();
    var hv = new THREE.Vector3().crossVectors(rv, vv);
    var ev = new THREE.Vector3().crossVectors(vv, hv).divideScalar(MU)
                                .sub(rv.clone().divideScalar(rm));
    var ecc = ev.length();
    var a = 1 / (2 / rm - vv.lengthSq() / MU);

    var ideal = null, apogeeKm = null, perigeeKm = null;
    if (isFinite(a) && a > 0 && ecc < 1) {
      var wHat = hv.clone().normalize();
      // At e ~ 0 the periapsis direction is undefined, so any in-plane axis
      // serves -- the ellipse is a circle and has no distinguished point.
      var pHat = ecc > 1e-7
        ? ev.clone().normalize()
        : rv.clone().sub(wHat.clone().multiplyScalar(rv.dot(wHat))).normalize();
      var qHat = new THREE.Vector3().crossVectors(wHat, pHat);
      var semiLatus = a * (1 - ecc * ecc);
      var nIdeal = options.idealSteps || 480;
      ideal = [];
      for (var j = 0; j <= nIdeal; j++) {
        var nu = (j / nIdeal) * Math.PI * 2;
        var rr = semiLatus / (1 + ecc * Math.cos(nu));
        var e3 = pHat.clone().multiplyScalar(rr * Math.cos(nu))
                     .add(qHat.clone().multiplyScalar(rr * Math.sin(nu)));
        ideal.push(toScene({ x: e3.x, y: e3.y, z: e3.z }));
      }
      apogeeKm = a * (1 + ecc) - EARTH_R_KM;
      perigeeKm = a * (1 - ecc) - EARTH_R_KM;
    }

    // --- how far the real path strays from the ideal ellipse, in km
    //
    // Distance to the nearest *segment*, not the nearest vertex. Measuring to
    // vertices would report half the sample spacing as "deviation" even for a
    // perfect ellipse -- on a GEO orbit that alone is ~276 km of pure
    // discretisation noise, which would swamp the real effect.
    var maxDevKm = 0, foot = null, maxDevScene = 0;
    if (ideal) {
      foot = [];
      for (var m = 0; m < actual.length; m++) {
        var p = actual[m], best = Infinity, bx = 0, by = 0, bz = 0;
        for (var q = 0; q < ideal.length - 1; q++) {
          var A = ideal[q], B = ideal[q + 1];
          var abx = B.x - A.x, aby = B.y - A.y, abz = B.z - A.z;
          var apx = p.x - A.x, apy = p.y - A.y, apz = p.z - A.z;
          var ab2 = abx * abx + aby * aby + abz * abz;
          var t = ab2 > 0 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
          if (t < 0) t = 0; else if (t > 1) t = 1;
          var fx = A.x + abx * t, fy = A.y + aby * t, fz = A.z + abz * t;
          var dx = p.x - fx, dy = p.y - fy, dz = p.z - fz;
          var d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < best) { best = d2; bx = fx; by = fy; bz = fz; }
        }
        foot.push(new THREE.Vector3(bx, by, bz));
        if (best > maxDevScene) maxDevScene = best;
      }
      maxDevKm = Math.sqrt(maxDevScene) / K;   // reported in true kilometres
    }

    // Everything from here is display geometry. Altitude scaling is applied to
    // the curves and to the feet together, so the deviation the eye sees stays
    // proportional to the orbit as drawn -- while maxDevKm above keeps the
    // honest, unscaled figure for the readout.
    var self2 = this;
    function scaleAll(arr) { if (arr) for (var i = 0; i < arr.length; i++) self2._applyAlt(arr[i]); }
    scaleAll(actual); scaleAll(ideal); scaleAll(foot);
    maxDevScene = 0;
    if (foot) {
      for (var fm = 0; fm < actual.length; fm++) {
        var dd = actual[fm].distanceTo(foot[fm]);
        if (dd > maxDevScene) maxDevScene = dd;
      }
    }

    // Everything below is sized against the orbit itself, not the globe. Tube
    // thickness is in world units, so it shrinks with perspective: framing a
    // Molniya apogee puts the camera ~950 units back, where a globe-sized tube
    // is well under a pixel across and disappears entirely. Scaling with the
    // orbit keeps both curves legible whether it's a 400 km LEO or TESS.
    var scaleRef = 0;
    for (var sr = 0; sr < actual.length; sr++) {
      var L = actual[sr].length();
      if (L > scaleRef) scaleRef = L;
    }
    if (!(scaleRef > 0)) scaleRef = this.radius;

    // The real distortion is a fraction of a percent of the orbit radius, so at
    // true scale the two curves land on top of each other and you see nothing.
    // Magnify the departure from the ideal ellipse until it's actually legible,
    // the same bargain the globe's relief already makes -- and report the factor
    // so nobody mistakes the amplified curve for the real one.
    var devScale = 1, exaggerated = null;
    if (ideal && maxDevScene > 1e-9) {
      var dt = options.deviationTarget != null ? options.deviationTarget : this.deviationTarget;
      var target = scaleRef * dt;
      devScale = Math.max(1, Math.min(options.maxDeviationScale || 20000, target / maxDevScene));
      // At a target of 0 the user has asked for the truth, so leave the red
      // curve exactly where the satellite actually flies.
      if (dt > 0 && devScale > 1.5) {
        exaggerated = [];
        for (var z = 0; z < actual.length; z++) {
          exaggerated.push(foot[z].clone().add(
            actual[z].clone().sub(foot[z]).multiplyScalar(devScale)));
        }
      }
    }

    var group = new THREE.Group();
    group.name = 'orbit:' + s.id;

    // Green for the ideal, red for the real path, and the ideal drawn thicker
    // so the thin red curve reads clearly on top of it where the two coincide.
    // Floored against the globe so a very low orbit still gets a visible tube.
    var idealR = Math.max(this.radius * 0.008,
      (options.idealWidth != null ? options.idealWidth : 0.011) * scaleRef);
    var realR = Math.max(this.radius * 0.0045,
      (options.realWidth != null ? options.realWidth : 0.0062) * scaleRef);

    if (ideal) {
      var li = tubeFromPoints(THREE, ideal, {
        closed: true, radius: idealR, renderOrder: 1,
        color: options.idealColor != null ? options.idealColor : 0x35e06a
      });
      li.name = 'orbit-ideal';
      group.add(li);
    }

    var la = tubeFromPoints(THREE, actual, {
      closed: false, radius: realR, renderOrder: 2,
      color: options.color != null ? options.color : 0xff3b30
    });
    la.name = 'orbit-actual';
    group.add(la);

    if (exaggerated) {
      // Same physical curve as `actual`, just amplified, so it keeps the red --
      // held translucent to signal that this one is the magnified view.
      var le = tubeFromPoints(THREE, exaggerated, {
        closed: false, radius: realR, renderOrder: 3, opacity: 0.55,
        color: options.deviationColor != null ? options.deviationColor : 0xff3b30
      });
      le.name = 'orbit-deviation';
      group.add(le);
    }

    group.userData = {
      periodMin: periodMin,
      semiMajorKm: a,
      eccentricity: ecc,
      apogeeKm: apogeeKm,
      perigeeKm: perigeeKm,
      maxDeviationKm: maxDevKm,
      deviationScale: exaggerated ? devScale : 1,
      hasIdeal: !!ideal
    };
    this.scene.add(group);
    this._orbits[String(id)] = group;
    return group;
  };

  Globe.prototype.hideOrbit = function (id) {
    var obj = this._orbits[String(id)];
    if (!obj) return false;
    this.scene.remove(obj);
    obj.traverse(function (o) {          // handles both a bare Line and a Group
      if (o.geometry) o.geometry.dispose();
      if (o.material) [].concat(o.material).forEach(function (m) { m.dispose(); });
    });
    delete this._orbits[String(id)];
    return true;
  };

  Globe.prototype.hideAllOrbits = function () {
    var self = this;
    Object.keys(this._orbits).forEach(function (k) { self.hideOrbit(k); });
    return this;
  };

  // --------------------------------------------------------- time & picking

  Globe.prototype.setTime = function (d) { this.time = new Date(d); return this; };
  Globe.prototype.setTimeScale = function (x) { this.timeScale = x; return this; };
  Globe.prototype.play = function () { this.playing = true; return this; };
  Globe.prototype.pause = function () { this.playing = false; return this; };
  Globe.prototype.setExaggeration = function (relief) {
    this.relief = relief;
    // Keep the zoom floor above the tallest bump, or the camera ends up inside
    // the terrain once relief is cranked up.
    this.controls.minDistance = this.radius * (1 + relief) * 1.06;
    this.scene.remove(this.surface);
    this.surface.geometry.dispose(); this.surface.material.dispose();
    this._buildSurface(this.model);

    // Both overlays are draped onto the displaced surface, so they have to be
    // rebuilt with it -- otherwise they stay at the old radius and sink in.
    var self = this;
    ['graticule', 'coastlines'].forEach(function (k) {
      if (!self[k]) return;
      self.scene.remove(self[k]);
      self[k].geometry.dispose(); self[k].material.dispose();
    });
    if (this.graticule) {
      var wasVisible = this.graticule.visible, sp = this._graticuleSpacing;
      this.graticule = null;
      this.addGraticule(sp).visible = wasVisible;
    }
    if (this.coastlines && this._coastSource) {
      var cv = this.coastlines.visible, src = this._coastSource;
      this.coastlines = null;
      this.addCoastlines(src.data, src.options).then(function (l) { l.visible = cv; });
    }
    return this;
  };
  /**
   * Satellite dot size, as a fraction of the globe radius. The ray-pick radius
   * grows with it, so turning the dots up genuinely makes them easier to hit
   * rather than just easier to see.
   */
  Globe.prototype.setSatelliteSize = function (frac) {
    this.opts.satSize = frac;
    if (this._satPoints) this._satPoints.material.size = frac * this.radius;
    this._raycaster.params.Points.threshold =
      Math.max(this.radius * 0.01, frac * this.radius * 0.8);
    return this;
  };

  Globe.prototype.isPaused = function () { return !this.playing; };

  Globe.prototype.setAltitudeScale = function (k) { this.altScale = k; return this; };
  Globe.prototype.setDeviationTarget = function (f) { this.deviationTarget = f; return this; };

  /**
   * Scale a scene-space point's altitude above mean radius, in place.
   * Only the excess is scaled, so the globe's surface stays put and a point
   * on it stays on it.
   */
  Globe.prototype._applyAlt = function (v) {
    var k = this.altScale;
    if (k === 1) return v;
    var R = this._baseRadius;
    var r = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (!(r > 0)) return v;
    var f = (R * (1 + k * (r / R - 1))) / r;
    v.x *= f; v.y *= f; v.z *= f;
    return v;
  };

  Globe.prototype.setAutoRotate = function (on, speed) {
    this.controls.autoRotate = !!on;
    if (speed != null) this.controls.autoRotateSpeed = speed;
    return this;
  };
  Globe.prototype.pointOfView = function (lat, lon, zoom) {
    this.controls.setPointOfView(lat, lon, zoom != null ? this.radius * zoom : null);
    return this;
  };
  Globe.prototype.on = function (evt, fn) {
    (this._listeners[evt] = this._listeners[evt] || []).push(fn); return this;
  };
  Globe.prototype._emit = function (evt, arg) {
    (this._listeners[evt] || []).forEach(function (f) { f(arg); });
  };

  Globe.prototype._pickAt = function (e, kind) {
    if (kind === 'down' || !this._satPoints) return;
    var rect = this.renderer.domElement.getBoundingClientRect();
    this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._mouse, this.camera);
    var hits = this._raycaster.intersectObject(this._satPoints, false);
    var sat = null;
    if (hits.length && this._visibleIndex) {
      var idx = this._visibleIndex[hits[0].index];
      if (idx != null) sat = this._sats[idx];
    }
    if (kind === 'hover') {
      if (sat !== this._hovered) { this._hovered = sat; this._emit('hover', sat); }
    } else {
      this._emit('select', sat);
    }
  };

  // ---------------------------------------------------------------- runtime

  Globe.prototype._resize = function () {
    var w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  Globe.prototype._animate = function () {
    var self = this;
    function frame(now) {
      self._raf = requestAnimationFrame(frame);
      var dt = now - self._lastFrame;
      self._lastFrame = now;
      if (self.playing) self.time = new Date(self.time.getTime() + dt * self.timeScale);
      self.controls.update();
      self._updateSats(self.time);
      self._emit('tick', self.time);
      self.renderer.render(self.scene, self.camera);
    }
    this._lastFrame = performance.now();
    this._raf = requestAnimationFrame(frame);
  };

  Globe.prototype.dispose = function () {
    cancelAnimationFrame(this._raf);
    this.controls.dispose();
    if (this._ro) this._ro.disconnect();
    this.scene.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) [].concat(o.material).forEach(function (m) { m.dispose(); });
    });
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  };

  return {
    create: function (opts) { return new Globe(opts); },
    makeColorSampler: makeColorSampler,
    Globe: Globe,
    latLonToVec3: latLonToVec3,
    EARTH_R_KM: EARTH_R_KM
  };
}));
