// service-worker.js — kill switch for the legacy offline-cache SW.
//
// Background
// ----------
// Between 2026-05-27 (commit 4175ec0, "Takshashila design pass + offline
// service-worker cache") and 2026-06-01 (commit f84faed, the rollback
// to e18bb3c), the site shipped an aggressive cache-first service worker
// at this same URL.  Any browser that visited during that window
// registered it.  Even though the SW source was removed from the repo
// by the rollback, the SW remains installed in those browsers and
// continues serving stale cached HTML / JS / data on every visit —
// e.g. data/active.tle from May 12 (≈ 860 sats → 725 deduped) and
// sat-stats.js?v=1 (no bundled SATCAT fallback).  That's the
// "725 satellites instead of 15 000" report on a second laptop.
//
// What this file does
// -------------------
// Browsers revalidate the SW JS on every navigation.  When they fetch
// THIS file in place of the old aggressive-cache SW, the lifecycle is:
//
//   install   → skipWaiting() so we don't sit pending behind the old SW
//   activate  → wipe every Cache Storage entry, claim all open clients,
//               unregister this SW, and navigate every client to its
//               own URL (force a reload so the freshly-fetched HTML +
//               JS take over).
//   fetch     → pass through to the network unchanged — during the
//               brief window between activate and the unregister
//               taking effect, requests must NOT hit the legacy cache.
//
// After the reload, no SW is registered on the origin, so future visits
// behave like any normal static site.  This file can stay deployed
// indefinitely — for users without the old SW it's never even fetched.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 1. Wipe every Cache Storage entry the old SW populated.
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) { /* ignore — caches API failure shouldn't block cleanup */ }

    // 2. Take over from the previous SW immediately.
    try { await self.clients.claim(); } catch (e) { /* ignore */ }

    // 3. Unregister ourselves — job done.
    try { await self.registration.unregister(); } catch (e) { /* ignore */ }

    // 4. Force every open client to reload so the freshly-fetched HTML
    //    + JS replace whatever the legacy SW was serving.  Use
    //    .navigate() rather than postMessage()+reload — the latter
    //    needs the page's JS to participate, which won't happen if
    //    that JS itself is stale.
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        // Strip the hash so navigate() reliably reloads.
        const url = client.url.replace(/#.*$/, '');
        client.navigate(url);
      }
    } catch (e) { /* ignore */ }
  })());
});

// Network pass-through.  This handler exists only to make sure no
// request is served from the old cache during the activate window.
// Once unregister() takes effect this listener stops firing entirely.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
