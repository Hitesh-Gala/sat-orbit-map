// NAZAR service worker — cache-first for our own static assets so repeat
// visits load near-instantly and scroll smoother (no network round-trips
// for HTML/CSS/JS/fonts/textures).  Live data (TLE catalogue, SATCAT,
// RSS) keeps its existing localStorage TTLs in tle-loader.js etc.

const CACHE_NAME = 'nazar-v1';

// Pre-cache the small core that every page needs.  Larger / page-specific
// files (audio MP3, GeoJSONs, Blue-Marble textures) are added to the
// cache on first fetch via the runtime handler below.
const CORE = [
  './',
  './index.html',
  './styles.css',
  './tle-loader.js',
  './app.js',
  './assets/takshashila-logo.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(CORE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Cache-first for same-origin GETs and a curated set of CDN assets
// (Google Fonts, unpkg, etc.).  Anything else passes straight through.
const CDN_HOSTS = [
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'raw.githubusercontent.com',
];

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const cacheableCdn = CDN_HOSTS.includes(url.hostname);
  if (!sameOrigin && !cacheableCdn) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) {
      // Refresh in background ("stale-while-revalidate") so cached files
      // eventually catch up with new pushes without holding up the user.
      fetch(req).then(r => { if (r && r.ok) cache.put(req, r.clone()); }).catch(() => {});
      return cached;
    }
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch (e) {
      return cached || Response.error();
    }
  })());
});
