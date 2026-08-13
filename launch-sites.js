// launch-sites.js — interactive map of China's launch sites & space
// infrastructure, opened from the red "Site" column on ChinRepo.
//
// Marker placement uses the exact projection of the Wikimedia "China edcp"
// location map (equidistant-conic, centred on 104°E) so pins land accurately
// on both the relief (physical) and the political base image, which share it.
(function () {
  'use strict';

  // --- edcp China location-map projection → (x,y) as % of the image ---------
  var A = 116.80932603407057, B = 0.5867115434267053, C = 1.9996655301850468,
      D = 1.3713469994670882, E = 1.256383, F = 0.02641006622571962;
  function proj(lat, lon) {
    var latR = lat * Math.PI / 180,
        ang  = B * (lon - 104) * Math.PI / 180,
        rho  = C - latR;
    return {
      x: 50 + A * (rho * Math.sin(ang)),
      y: 50 + E * A * F - E * A * (D - rho * Math.cos(ang)),
    };
  }

  var P = 'data/launch-sites/photos/';
  var CW = 'https://commons.wikimedia.org/wiki/';

  // --- data -----------------------------------------------------------------
  var SITES = [
    {
      code: 'JSC', kind: 'launch', name: 'Jiuquan Satellite Launch Center',
      cn: '酒泉卫星发射中心', lat: 40.958, lon: 100.291,
      city: 'Gobi Desert, nr Jiuquan', province: 'Inner Mongolia', since: '1958',
      blurb: 'China\'s oldest and busiest launch base, hidden in the Gobi Desert. It is the only site that flies crewed Shenzhou missions, and it lofted China\'s first satellite — Dong Fang Hong 1 — back in 1970.',
      photos: [
        { f: 'jsc-shenzhou13.jpg', cap: 'Liftoff of the crewed Shenzhou-13 mission', by: 'ForrestXYC', lic: 'CC BY-SA 4.0', page: CW + 'File:Launch_of_Shenzhou_13.jpg' },
        { f: 'jsc-tower.jpg', cap: 'The main crewed-launch tower at Jiuquan', by: 'AAxanderr', lic: 'Public domain', page: CW + 'File:Jiuquan_Satellite_Launch_Center_main_launch_tower.JPG' },
        { f: 'jsc-sign.jpg', cap: 'Entrance to the Jiuquan complex', by: 'Sparktour', lic: 'CC BY-SA 4.0', page: CW + 'File:Jiuquan_Satellite_Launch_Center_with_sign.jpg' },
      ],
    },
    {
      code: 'TAISC', kind: 'launch', name: 'Taiyuan Satellite Launch Center',
      cn: '太原卫星发射中心', lat: 38.849, lon: 111.608,
      city: 'Kelan County, nr Taiyuan', province: 'Shanxi', since: '1968',
      blurb: 'A high, cold base in the Lüliang mountains of Shanxi. It specialises in polar and sun-synchronous orbits — the weather, remote-sensing and reconnaissance satellites that need to fly over the poles.',
      photos: [
        { f: 'taisc-hongtu.png', cap: 'Launch of the Hongtu-1 satellites, 2023', by: 'China News Service', lic: 'CC BY 4.0', page: CW + 'File:30MAR2023_Launch_of_Hongtu-1_Satellites.png' },
        { f: 'taisc-sar.jpg', cap: 'The Taiyuan centre seen by radar satellite', by: 'SpaceFrom.Space', lic: 'CC BY 2.0', page: CW + 'File:Taiyuan_Satellite_Launch_Center_in_SAR_-_2023-06-20_(53264414596).jpg' },
      ],
    },
    {
      code: 'XICLF', kind: 'launch', name: 'Xichang Satellite Launch Center',
      cn: '西昌卫星发射中心', lat: 28.246, lon: 102.026,
      city: 'nr Xichang', province: 'Sichuan', since: '1984',
      blurb: 'Set among the mountains of southern Sichuan, Xichang is China\'s main gateway to high orbit: communications satellites and the entire Beidou navigation constellation launch here on Long March 3-series rockets.',
      photos: [
        { f: 'xiclf-cz3b.jpg', cap: 'A Long March 3B lifts off from Xichang', by: 'AAxanderr', lic: 'Public domain', page: CW + 'File:The_Launch_of_Long_March_3B_Rocket.jpg' },
        { f: 'xiclf-yaogan36.png', cap: 'Launch of the Yaogan-36 satellites', by: 'China News Service', lic: 'CC BY 4.0', page: CW + 'File:Yaogan-36_satellite_launch.png' },
      ],
    },
    {
      code: 'WSC', kind: 'launch', name: 'Wenchang Space Launch Site',
      cn: '文昌航天发射场', lat: 19.614, lon: 110.951,
      city: 'Wenchang, nr Haikou', province: 'Hainan', since: '2014',
      blurb: 'China\'s newest and only coastal spaceport, on the tropical island of Hainan. Its low latitude and sea access for oversized boosters make it the home of the heavy Long March 5 — and of lunar, Mars and space-station launches.',
      photos: [
        { f: 'wsc-tianwen1.jpg', cap: 'Launch of Tianwen-1, China\'s first Mars mission', by: 'Wikimedia Commons', lic: 'CC BY 4.0', page: CW + 'File:Tianwen-1_launch_04_(cropped).jpg' },
        { f: 'wsc-cz7.jpg', cap: 'A Long March 7 lifts off from Wenchang', by: 'Wikimedia Commons', lic: 'CC BY 4.0', page: CW + 'File:CZ-7_launch_from_Wenchang.jpg' },
        { f: 'wsc-site.jpg', cap: 'The coastal Wenchang launch complex', by: 'Shujianyang', lic: 'CC BY-SA 4.0', page: CW + 'File:Wenchang_Space_Launch_Site_02.jpg' },
      ],
    },
    {
      code: 'YSLA', kind: 'sea', name: 'Yellow Sea Launch Area',
      cn: '黄海海上发射', lat: 34.9, lon: 121.6,
      city: 'off Haiyang, Shandong', province: 'Yellow Sea', since: '2019',
      blurb: 'A mobile sea-launch zone in the Yellow Sea off Haiyang, Shandong. Small solid-fuel Long March 11 rockets lift off from a converted barge, sidestepping crowded land ranges and dropping spent stages safely offshore.',
      photos: [],
    },
    {
      code: 'SCSLA', kind: 'sea', name: 'South China Sea Launch Area',
      cn: '南海海上发射', lat: 20.0, lon: 112.6,
      city: 'off Guangdong / Hainan', province: 'South China Sea', since: '2022',
      blurb: 'A newer sea-launch area in the waters off Guangdong and Hainan, used for commercial launches from ship-borne platforms nearer the equator than the Yellow Sea zone.',
      photos: [],
    },
    {
      code: 'CNSA', kind: 'poi', name: 'Beijing — CNSA HQ & Mission Control',
      cn: '北京 · 国家航天局', lat: 39.98, lon: 116.34,
      city: 'Beijing', province: 'capital', since: '',
      blurb: 'The nerve centre of the programme: the China National Space Administration (CNSA), the Beijing Aerospace Control Centre that flies every mission in real time, and CAST — the country\'s main satellite builder.',
      photos: [],
    },
    {
      code: 'XSCC', kind: 'poi', name: 'Xi\'an Satellite Control Center',
      cn: '西安卫星测控中心', lat: 34.23, lon: 108.94,
      city: 'Xi\'an', province: 'Shaanxi', since: '',
      blurb: 'Once a satellite reaches orbit, control passes to Xi\'an, which tracks and commands China\'s spacecraft through a worldwide network of ground stations and tracking ships.',
      photos: [],
    },
    {
      code: 'SAST', kind: 'poi', name: 'Shanghai Academy of Spaceflight Tech (SAST)',
      cn: '上海航天技术研究院', lat: 31.17, lon: 121.43,
      city: 'Shanghai', province: 'municipality', since: '',
      blurb: 'China\'s second great rocket-and-satellite maker, builder of the Long March 2D/4 boosters and the Fengyun weather satellites — including Fengyun-1C, the target of the 2007 anti-satellite test.',
      photos: [],
    },
  ];

  // orientation cities for the political tab
  var CITIES = [
    { n: 'Beijing', lat: 39.9, lon: 116.4 },
    { n: 'Shanghai', lat: 31.23, lon: 121.47 },
    { n: 'Xi’an', lat: 34.27, lon: 108.95 },
    { n: 'Chengdu', lat: 30.66, lon: 104.07 },
    { n: 'Guangzhou', lat: 23.13, lon: 113.26 },
    { n: 'Haikou', lat: 20.04, lon: 110.32 },
    { n: 'Taiyuan', lat: 37.87, lon: 112.55 },
    { n: 'Jiuquan', lat: 39.73, lon: 98.5 },
    { n: 'Wuhan', lat: 30.58, lon: 114.3 },
    { n: 'Ürümqi', lat: 43.83, lon: 87.62 },
    { n: 'Lhasa', lat: 29.65, lon: 91.1 },
    { n: 'Harbin', lat: 45.8, lon: 126.53 },
  ];

  // PRC-owned payloads that flew from launch sites OUTSIDE China
  var FOREIGN = {
    SEAL:  'Sea Launch — the Odyssey platform, on the equatorial Pacific Ocean',
    FRGUI: 'Guiana Space Centre — Kourou, French Guiana',
    PLMSC: 'Plesetsk Cosmodrome — northern Russia',
    VOSTO: 'Vostochny Cosmodrome — far-eastern Russia',
  };

  var BASES = {
    physical: 'data/launch-sites/china-relief.jpg',
    political: 'data/launch-sites/china-political.png',
    photo: 'data/launch-sites/china-relief.jpg',
  };
  var TABHINT = {
    physical: 'Physical map — launch sites on China’s real terrain. Click any pin for its story and photos.',
    political: 'Political map — sites relative to the nearest cities and provinces. Click any pin for details.',
    photo: 'Photo explorer — click any launch site to see real photographs of the place and its launches.',
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // --- build the modal once -------------------------------------------------
  var modal, baseImg, overlay, sideEl, tabhintEl, lightbox, curTab = 'physical', selCode = null;
  var markerEls = {};

  function build() {
    modal = document.createElement('div');
    modal.className = 'lsm-modal';
    modal.id = 'lsm-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML =
      '<div class="lsm-card">' +
        '<div class="lsm-head">' +
          '<h2 class="lsm-title">China’s Launch Sites &amp; Space Infrastructure' +
            '<small>Every site code in the SITE column, mapped</small></h2>' +
          '<button type="button" class="lsm-close" id="lsm-close" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="lsm-tabs" id="lsm-tabs">' +
          '<button type="button" class="lsm-tab active" data-tab="physical">🗺 Physical</button>' +
          '<button type="button" class="lsm-tab" data-tab="political">🏙 Political</button>' +
          '<button type="button" class="lsm-tab" data-tab="photo">📷 Photo explorer</button>' +
        '</div>' +
        '<div class="lsm-tabhint" id="lsm-tabhint"></div>' +
        '<div class="lsm-body">' +
          '<div class="lsm-stage"><div class="lsm-mapwrap">' +
            '<img class="lsm-base" id="lsm-base" alt="Map of China" draggable="false">' +
            '<div class="lsm-overlay" id="lsm-overlay"></div>' +
          '</div></div>' +
          '<div class="lsm-side" id="lsm-side"></div>' +
        '</div>' +
        '<div class="lsm-foot">' +
          '<span class="lg"><i class="k" style="background:#ff4d3d"></i>Launch site</span>' +
          '<span class="lg"><i class="k" style="background:#38d0c0"></i>Sea-launch zone</span>' +
          '<span class="lg"><i class="k sq" style="background:#67c8ff"></i>Agency / control</span>' +
          '<span class="lsm-credit">Base maps: Uwe Dedering / Wikimedia Commons, CC BY-SA 3.0</span>' +
        '</div>' +
      '</div>' +
      '<div class="lsm-lightbox" id="lsm-lightbox" hidden><figure>' +
        '<img id="lsm-lb-img" alt=""><figcaption id="lsm-lb-cap"></figcaption>' +
      '</figure></div>';
    document.body.appendChild(modal);

    baseImg = modal.querySelector('#lsm-base');
    overlay = modal.querySelector('#lsm-overlay');
    sideEl = modal.querySelector('#lsm-side');
    tabhintEl = modal.querySelector('#lsm-tabhint');
    lightbox = modal.querySelector('#lsm-lightbox');

    // markers (built once; live on every tab)
    SITES.forEach(function (s) {
      var pt = proj(s.lat, s.lon);
      var m = document.createElement('button');
      m.type = 'button';
      m.className = 'lsm-marker' + (s.kind === 'poi' ? ' poi' : s.kind === 'sea' ? ' sea' : '');
      m.style.left = pt.x + '%';
      m.style.top = pt.y + '%';
      m.title = s.name;
      m.innerHTML = '<span class="dot"></span><span class="code">' + esc(s.code) + '</span>';
      m.addEventListener('click', function (e) { e.stopPropagation(); selectSite(s.code); });
      overlay.appendChild(m);
      markerEls[s.code] = m;
    });
    // city labels (shown only on political tab)
    CITIES.forEach(function (c) {
      var pt = proj(c.lat, c.lon);
      var el = document.createElement('div');
      el.className = 'lsm-city';
      el.style.left = pt.x + '%';
      el.style.top = pt.y + '%';
      el.innerHTML = '<span class="cdot"></span><span class="cname">' + esc(c.n) + '</span>';
      overlay.appendChild(el);
    });

    // wiring
    modal.querySelector('#lsm-close').addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    modal.querySelector('#lsm-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.lsm-tab'); if (b) setTab(b.dataset.tab);
    });
    lightbox.addEventListener('click', function () { lightbox.hidden = true; });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!lightbox.hidden) lightbox.hidden = true;
      else if (!modal.hidden) close();
    });
  }

  function setTab(tab) {
    curTab = tab;
    baseImg.src = BASES[tab];
    tabhintEl.textContent = TABHINT[tab];
    overlay.classList.toggle('show-cities', tab === 'political');
    modal.querySelectorAll('.lsm-tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    // city labels visibility
    overlay.querySelectorAll('.lsm-city').forEach(function (el) {
      el.style.display = tab === 'political' ? '' : 'none';
    });
  }

  function selectSite(code) {
    selCode = code;
    Object.keys(markerEls).forEach(function (k) {
      markerEls[k].classList.toggle('sel', k === code);
    });
    var s = SITES.find(function (x) { return x.code === code; });
    if (!s) { sideEl.innerHTML = ''; return; }
    var meta = [];
    meta.push('<span>📍 <b>' + esc(s.city) + '</b></span>');
    meta.push('<span>🗺 ' + esc(s.province) + '</span>');
    if (s.since) meta.push('<span>Since <b>' + esc(s.since) + '</b></span>');
    meta.push('<span>' + s.lat.toFixed(2) + '°N, ' + s.lon.toFixed(2) + '°E</span>');

    var gallery;
    if (s.photos.length) {
      gallery = '<div class="lsm-gallery">' + s.photos.map(function (ph, i) {
        return '<button type="button" class="lsm-thumb" data-code="' + esc(code) + '" data-i="' + i + '">' +
                 '<img src="' + P + esc(ph.f) + '" alt="' + esc(ph.cap) + '" loading="lazy">' +
                 '<span class="tcap">' + esc(ph.cap) + '</span></button>';
      }).join('') + '</div>';
    } else {
      gallery = '<div class="lsm-nophoto">No free-to-use photograph of this ' +
        (s.kind === 'sea' ? 'sea-launch zone' : 'site') +
        ' was available. It is marked on the map by its coordinates.</div>';
    }

    var kindCls = s.kind === 'poi' ? ' poi' : s.kind === 'sea' ? ' sea' : '';
    sideEl.innerHTML =
      '<span class="lsm-s-code' + kindCls + '">' + esc(s.code) + '</span>' +
      '<div class="lsm-s-name">' + esc(s.name) + '</div>' +
      '<div class="lsm-s-cn">' + esc(s.cn) + '</div>' +
      '<div class="lsm-s-meta">' + meta.join('') + '</div>' +
      '<div class="lsm-s-blurb">' + esc(s.blurb) + '</div>' +
      gallery;

    sideEl.querySelectorAll('.lsm-thumb').forEach(function (t) {
      t.addEventListener('click', function () {
        var ph = s.photos[+t.dataset.i];
        openLightbox(ph);
      });
    });
    sideEl.scrollTop = 0;
  }

  function openLightbox(ph) {
    modal.querySelector('#lsm-lb-img').src = P + ph.f;
    modal.querySelector('#lsm-lb-cap').innerHTML =
      esc(ph.cap) + ' &nbsp;·&nbsp; Photo: ' + esc(ph.by) + ', ' + esc(ph.lic) +
      ' — <a href="' + esc(ph.page) + '" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>';
    lightbox.hidden = false;
  }

  function showForeign(code) {
    selCode = null;
    Object.keys(markerEls).forEach(function (k) { markerEls[k].classList.remove('sel'); });
    sideEl.innerHTML =
      '<span class="lsm-s-code" style="background:#8aa0b8">' + esc(code) + '</span>' +
      '<div class="lsm-s-name">Foreign launch site</div>' +
      '<div class="lsm-s-blurb"><b>' + esc(FOREIGN[code]) + '.</b><br><br>' +
      'A handful of Chinese-owned satellites flew from launch sites outside China, so this code isn’t on the map. ' +
      'Pick any pin to explore China’s own launch sites.</div>';
    sideEl.scrollTop = 0;
  }

  function open(focusCode, tab) {
    if (!modal) build();
    setTab(tab || 'physical');
    if (focusCode && FOREIGN[focusCode]) showForeign(focusCode);
    else selectSite(SITES.some(function (s) { return s.code === focusCode; }) ? focusCode : 'JSC');
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
  }
  function close() {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    lightbox.hidden = true;
  }

  // --- triggers -------------------------------------------------------------
  function wire() {
    var headerBtn = document.getElementById('site-map-btn');
    if (headerBtn) headerBtn.addEventListener('click', function () { open('JSC', 'physical'); });
    // delegate clicks on the per-row site codes (table re-renders every 10 s)
    document.addEventListener('click', function (e) {
      var cell = e.target.closest && e.target.closest('.site-cell');
      if (!cell) return;
      open(cell.dataset.site, 'photo');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
