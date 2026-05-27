// NAZAR service worker — aggressive static-asset caching so the site
// loads from disk on second / third / Nth visit instead of pulling from
// GitHub Pages each time.
//
// First visit: the pre-cache list below is fetched and stored under
// `nazar-v1`.  Every subsequent navigation is served cache-first from
// that entry, with a background refresh when the network is available
// (stale-while-revalidate).  Third-party assets (CelesTrak, unpkg,
// fonts.googleapis.com, raw.githubusercontent.com, etc.) get the same
// treatment so the second load doesn't pay round-trip latency.
//
// Bump CACHE_VERSION whenever you change the pre-cache list to evict
// the previous cache entries on the next page load.

const CACHE_VERSION = 'nazar-v1';

// Paths are relative — they resolve under the SW's scope, which on
// GitHub Pages is `/Third-Trial/`.  Listing the entry-point HTML files
// and the heavyweight binaries (mp3, GeoJSONs) is the high-value bit;
// everything else gets cached on first visit via the fetch handler.
const PRECACHE = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'tle-loader.js',
  'news-ticker.js',
  'prediction.html',
  'prediction.js',
  'orbits.html',
  'orbits.js',
  '2d-views.html',
  '2d-views.js',
  'chinrepo.html',
  'chinrepo.js',
  'cone.html',
  'cone.js',
  'compendium.html',
  'data/india-outline.geojson',
  'data/cn-factoids.json',
  'audio/nazar-track.mp3',
];

self.addEventListener('install', event => {
  // Take over as soon as the install step finishes — no need to wait
  // for every tab to close.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache =>
      // `cache: 'reload'` bypasses the browser HTTP cache during the
      // pre-fetch so we know the bytes saved match what's actually on
      // GitHub Pages right now, not whatever stale copy lives in disk
      // cache.
      Promise.all(PRECACHE.map(url =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
      ))
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Only intercept GETs — POSTs (none today, but future-proof) hit the
  // network unmodified.
  if (req.method !== 'GET') return;

  // Stale-while-revalidate: respond from cache instantly, then refresh
  // the cache entry from the network in the background so the next
  // visit has the latest bytes.
  event.respondWith(
    caches.open(CACHE_VERSION).then(cache =>
      cache.match(req).then(cached => {
        const networkFetch = fetch(req).then(resp => {
          if (resp && resp.ok && (resp.type === 'basic' || resp.type === 'cors' || resp.type === 'opaque')) {
            cache.put(req, resp.clone()).catch(() => {});
          }
          return resp;
        }).catch(() => cached);  // offline / network error → fall back to cache
        return cached || networkFetch;
      })
    )
  );
});
