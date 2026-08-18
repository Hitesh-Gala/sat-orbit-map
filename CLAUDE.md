# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**NAZAR** — a static, client-only satellite tracker that began focused on Chinese spacecraft visibility. Deployed via GitHub Pages from the `main` branch of `https://github.com/Hitesh-Gala/sat-orbit-map` to `https://hitesh-gala.github.io/sat-orbit-map/`. No backend; everything runs in the browser.

It has since grown into a broader space portal: live tracking and 3-D globes, an orbital-debris tracker (with a 2007-ASAT long-read), a global launch-site atlas + photo gallery, and reference sections on the Chinese and Indian private-space industries.

The tracking pages consume the same NORAD/CelesTrak TLE catalog and propagate orbits with SGP4 (satellite.js) locally; the reference/atlas pages (ChinRepo map, Indi-Space, Global Launch Sites, gallery) are driven by bundled JSON under `data/` instead. There is no JSON tracker API in the loop — `satellitetracker3d.com` is referenced in comments but not called.

## Where the code actually lives

The site is the contents of the **`sat-orbit-map/`** directory (this directory). The sibling `../Argos/` folder is a different, unrelated project that just happens to share the parent workspace — do not edit it when working on NAZAR.

`../.claude/launch.json` defines two preview servers — port **8090** serves NAZAR, port 8080 serves the unrelated Argos project.

## Running locally

The preview tool (`mcp__Claude_Preview__preview_start`) starts the static server defined in `../.claude/launch.json`:

```
name: "sat-orbit-map static server"  →  python -m http.server 8090 --directory sat-orbit-map
```

Equivalent ad-hoc command from the workspace root: `python -m http.server 8090 --directory sat-orbit-map`.

There is no build step, no bundler, no test suite, no linter. Edit a file → reload the browser.

## Deployment & cache busting

Push to `main` → GitHub Pages auto-rebuilds (~30-60 s). Verify the live commit with `gh api repos/Hitesh-Gala/sat-orbit-map/pages/builds --jq '.[0]'`.

Local script tags carry a manual `?v=N` query string (e.g. `<script src="app.js?v=19">`). **Bump that integer whenever you change the corresponding JS file** — without it, browsers serve the previous cached copy and the page silently runs old code. After deploy, users still need a hard refresh to pick up `index.html` changes (Pages sets a 10-min cache header on HTML).

## Architecture — shared data layer

All page scripts read from one shared module:

- **`tle-loader.js`** exposes the global `window.Argos = { OBSERVER, EARTH_R_KM, fetchTLEs, fetchChinaSatcat, propagate, makeSatrecs, inferPurpose, parseTLE, getTLERefreshLog, ensureRefreshBootstrap }`. Loaded on every page that needs satellite data.
- `fetchTLEs()` hits CelesTrak `gp.php?GROUP=active&FORMAT=tle`, caches the result in `localStorage` (6 h TTL), and **falls back to the bundled `data/active.tle` snapshot** when CelesTrak rate-limits the IP (returns 403 — common during dev). Always returns `{ tles, source: 'celestrak' | 'cache' | 'bundled' }`.
- `fetchChinaSatcat()` fans `?NAME=<prefix>` queries across the `CN_NAME_PREFIXES` list (~50 entries) at concurrency 4 (`pmap`) — CelesTrak's `records.php` requires a name prefix per call, and 4-in-flight stays inside their polite-use threshold. Results are filtered to `OWNER === 'PRC'` and `OBJECT_TYPE === 'PAY'`, deduped by NORAD ID, and cached 24 h.
- `propagate(satrec, date, observer)` returns `{ lat, lon, alt, az, el, range }` — lat/lon are sub-point, az/el are look-angles from the observer (defaults to New Delhi 28.61° N, 77.21° E).
- `makeSatrecs(tles)` runs each TLE through `satellite.twoline2satrec` and **dedupes by NORAD ID** — the raw feed sometimes carries the same object twice.
- **TLE refresh log** (feeds Sat-Stats' "TLE Analytics" pop-up). There is no server to diff refreshes, so `fetchBaseTLEs` captures them client-side at the exact moment a fresh live pull replaces the cached catalogue: the about-to-be-overwritten `argos.tle.v2` cache supplies each object's *previous* two lines, the incoming pull supplies the *new* ones. `scheduleRefreshDiff` runs the diff deferred (`setTimeout 0`) so it never delays first paint; only objects whose lines changed are appended to `nazar.tle.refreshlog.v1` (localStorage), deduped by `(noradId + new-epoch)`, pruned to the last **15 days** and the newest **1000**. No separate full-catalogue snapshot is stored — the cache itself is the baseline — so it adds no quota pressure. On the first live pull (no prior cache) the baseline is the bundled `data/active.tle`. `getTLERefreshLog()` returns the pruned, newest-first log; `ensureRefreshBootstrap()` (called once from Sat-Stats `boot()`) seeds the log by diffing the bundled snapshot against the cached set when it's still empty, so the table shows real data on the first visit rather than waiting a refresh cycle.

## Architecture — pages

Each `.html` is paired with a same-name `.js`. All pages share `styles.css` and most also load `tle-loader.js`.

| Page | Script | Globe library | What it does |
|------|--------|---------------|--------------|
| `index.html` | `app.js` | globe.gl | Realistic Earth + live sat dots (true altitude or flat via the 2D-3D toggle), HUD with clocks, observer-city dropdown (10 cities / All / mask-CN), over-horizon counts split by PRC flag |
| `orbits.html` | `orbits.js` | globe.gl | 3-D orbital tracks (one polyline per sat, sampled across one period) + NAZAR soundtrack with beat-driven camera moves + immersive fullscreen |
| `orbit-maker.html` | `orbit-maker.js` | globe.gl + **bare three.js r157** | **Orbit Maker** — an educational Keplerian-orbit builder (no TLEs). Six sliders (a, e, i, Ω, ω, θ) drive a closed-form two-body ellipse computed in the perifocal frame, rotated to ECI by Ω/i/ω, then remapped to globe.gl's Y-up frame `(x, z, −y)·SCALE` (globe radius 100 = 6371 km). Draws the orbit tube, satellite, radius vector, perigee/apogee, line of nodes, orbital + equatorial planes, and the γ/pole reference frame; live readouts (perigee/apogee alt, period, vis-viva speed) + orbit-type classifier; presets (LEO/SSO/GEO/Molniya/GTO); "Animate" advances mean anomaly through a Kepler solve so speed varies correctly along the ellipse. Labels are canvas sprites — use ASCII/basic glyphs (astrological symbols tofu in the WebGL canvas) |
| `2d-views.html` | `2d-views.js` | SVG overlay on a Blue Marble raster **+ a companion globe.gl globe** | Single-satellite ground-track tool. Track is a self-drawn SVG overlaid on the equirectangular basemap (lon/lat → viewBox linearly). **Time-based** mode: ±24 h SGP4 sub-point path as dotted past/future lines + 30-min direction arrows + hover place-names. **Rev-based** mode (panel toggle): dots hidden, a floating speed slider (1×–100×) flies the sat dot forward from now, tracing a golden trail capped at 3 revs, with projected UTC/IST clocks. Two small stacked 3-D globes (~1/6 width, right side) stay synced via `setNowMarker(lat,lon,alt,t)`: **Globe 1** (centred-on-sat) calls `pointOfView({lat:0, lng: subLon})` so it spins in longitude to keep the sat centred while the marker rides up/down with latitude. **Globe 2** (not centred) orbits its camera at `lng = -GMST(t)` so the Earth appears to spin at its true rate while the sat traces a fixed inertial ellipse; a per-frame occlusion test keeps the marker solid green in front and a brighter translucent green behind (`depthTest:false` so it shows through the translucent Earth — globe 2's `globeMaterial().opacity` is lowered). Each globe draws a faint golden orbit ring (globe 1: ground-track arc rebuilt throttled off wall time; globe 2: the inertial ellipse — points pre-rotated by GMST into ECI, in a group spun by `-GMST` each frame so it stays fixed in the camera view and passes through the marker). `sizeMiniGlobes()` sizes both squares off the map height (a ResizeObserver drives it; reading the globe column's own size feeds back). `globeAltFrac()` log-compresses altitude so HEO sats stay in view. Loads three@0.157 + globe.gl; amCharts is loaded for the worldLow GeoJSON only (point-in-polygon reverse-geocode, coarse ocean-basin fallback) |
| `viz3d.html` | `viz3d.js` | globe.gl + **bare three.js r157** | Every active sat at true altitude via one `THREE.InstancedMesh`; hover tooltip + click-to-isolate orbit tube; bottom search box highlights a sat (reuses `selectSat` → dim others + orbit ring + camera swing) |
| `sats-by-ops.html` | `sats-by-ops.js` | globe.gl + **bare three.js r157** | Same InstancedMesh engine, sats colour-coded by ~56 operator/constellation categories (name-prefix regex in `CATEGORIES`, each with a `COMPANY_INFO` dossier + `COMPANY_HISTORY` timeline) with per-category toggles. Regexes are validated against real catalogue names — e.g. Guowang folds in the `HULIANWANG`/`XINGWANG` HWD naming, and Galileo folds in its `GSAT0xxx` designation |
| `game-of-cones.html` | `game-of-cones.js` | globe.gl + **bare three.js r157** | Land-cone and sat-cone geometry puzzles (ConeGeometry meshes added directly to `globe.scene()`) |
| `sat-stats.html` | `sat-stats.js` | none | Cumulative satellite DB (localStorage) + Chart.js graphs + TLE Repo modal + Alpha-5 catalogue modal + **TLE Analytics** refresh-log modal (old vs new TLE per element-set change, epoch shift, field-by-field diff + Alpha-5 flag; built from `window.Argos.getTLERefreshLog()`) |
| `debris.html` | `debris.js` | globe.gl + **bare three.js r157** | Debris Tracker — InstancedMesh globe of the four major breakup clouds (Fengyun-1C, Cosmos 2251, Iridium 33, Cosmos 1408), coloured by event, hover tooltips, per-event filter. Fetches CelesTrak per-event debris GROUPs (live → `argos.debris.tle.v1` 6 h cache → bundled `data/debris.tle`). Each fragment tagged to its source by the parent launch designator (line-1 cols 10–14). "📊 Statistics & history" links to debris-stats.html. A right-edge button opens a self-contained **2007 Chinese ASAT** long-read (story + fact sheet + public-domain photos under `data/asat/` + original inline-SVG charts) |
| `debris-stats.html` | `debris-stats.js` | none | Debris Statistics dashboard — Chart.js charts from the precomputed `data/debris-history.json` (≈5 KB): the cumulative year-on-year build-up (created / decayed / net-in-orbit), per-country stacked area, altitude / inclination distributions, object-type split, and event cards. No live propagation — all derived from the SATCAT precompute |
| `chinrepo.html` | `chinrepo.js` + `launch-sites.js` | none | Filterable table of every active PRC payload (joins CelesTrak SATCAT `OWNER=PRC` with active TLEs). The red **Site** column header (and each row's site code) opens `launch-sites.js`' interactive **China launch-site map** — relief / political / photo-explorer tabs, markers projected with the Wikimedia "China edcp" conic formula; base maps + site photos under `data/launch-sites/` |
| `compendium.html` | (inline) | none | Self-contained PRC-program reference catalogue with embedded styles |
| `china-sat-series.html` | (inline) | none | Self-contained, light-themed downloadable field guide to China's satellite series (linked from ChinRepo); own inline styles, does not link `styles.css` |
| `indi-space.html` | `indi-space.js` | none | **Password-gated** (main-page 🔒 button → password `NAZAR` → sets a `nazar.indispace` session flag; the page bounces direct hits back to index). "India's private space ecosystem" — 36 colour-coded, filterable/searchable company vignettes from `data/indi-space.json`, each opening a rich modal (fact chips, achievements, founder bios, quote, origin story, sources, official-site link). Parsed from the *People Behind India's Private Space Industry* volume |
| `launch-map.html` | `launch-map.js` | globe.gl | **Global launch-site atlas** — 46 markers (launch sites / agency HQs / facilities) from `data/launch-map.json`, colour-coded by type, with hover tooltips (name, altitude, area, ≈ total launches). Toggles between a realistic Blue-Marble globe and a **political globe** (dark Earth + country polygons from bundled `data/countries-110m.geojson`). A button opens the gallery page |
| `launch-gallery.html` | `launch-gallery.js` | none | Photo gallery for the launch atlas — 12 freely-licensed spaceport photos (`data/launch-gallery/` + `_manifest.json`) as thumbnails → lightbox with per-image credit |
| `news-archive.html` | `news-archive.js` | none | The "TICKER TAPE" click-through — a chronological, day-grouped repository of every headline the ticker has caught (since 01 Jul 2026), with filter / China-only / sort controls and plain-text PDF export (jsPDF: one combined chronological doc, or one per article) |
| `news-ticker.js` | (included on `index.html`) | none | Scrolling ticker on `index.html`, numbered and China-first, ≤20 items from the last ~month. Pure UI — all data comes from `news-core.js` |
| `news-core.js` | (shared by ticker + archive) | none | Feed layer + persistent localStorage archive. See "News feeds" below |

`styles.css` is shared. Page-specific rules are scoped by `body.page-2d`, `body.page-repo`, `body.page-orbit`, `body.page-news`, `body.page-indispace`, `body.page-launchmap`, `body.page-lgal`, etc. CSS custom properties (`:root`) drive the dark theme; light-mode is implemented by re-defining the same properties under `body.light`.

## Shared chrome (`mobile-menu.js`)

Loaded on every page. Besides the phone drawer, it: (1) injects the small **Takshashila "For more on Space Policy…" credit** (`.logo-credit`) as a `<body>` child so it escapes any header containing-block — a fixed bottom-right chip on dense pages, tucked under the logo on globe pages (see `.logo-credit` rules in `styles.css`); and (2) hosts the top-left **NAZAR dropdown**. The `Indi-Space` nav button lives only in `index.html`'s `.left-nav` (never in the shared dropdown), so that gated section stays off every sub-page. The top-right lighthouse mark is `.top-logo`; most pages also carry a `.top-nazar-btn` back-button.

## Comments & Feedback (`feedback.js`, main page only)

`feedback.js` is a self-contained widget (loaded only on `index.html`) that injects a fixed bottom-left "Comments & Feedback" button, a submission modal (name, comment capped at 500 words, a **required** private email/phone field with reassurance text naming the owner), and a password-gated **"Review comments"** owner panel showing each entry's IP / device / country / city with edit + delete + CSV export. On submit it captures the visitor's device (UA parse) and IP + approximate city/country (client-side call to `ipwho.is` → `get.geojs.io` fallback, 4.5 s timeout).

**Static-site caveat:** there is no backend, so by default each submission is stored in the *visitor's own* `localStorage` (`nazar.feedback.v1`) — the review panel on a given device only shows feedback left on that device. Central collection requires setting `CONFIG.endpoint` in `feedback.js` to a backend URL; when set, every submission is also forwarded there (fire-and-forget `no-cors` POST). `feedback-backend.gs` is a ready Google Apps Script that appends each submission (with IP/geo/device) to a private Google Sheet — the owner's real all-visitor review surface. `CONFIG.adminPassword` gates the in-page review (client-side only — treat as a convenience lock, not real security).

## Static reference & media assets (hand-built, not auto-refreshed)

Downloaded or authored once and committed under `data/` — distinct from the auto-refreshed TLE/SATCAT snapshots:

- `data/indi-space.json` — 36 Indian-company profiles parsed from the *People Behind India's Private Space Industry* volume (Indi-Space).
- `data/launch-map.json` — 46 world launch sites / agency HQs / facilities (Global Launch Sites); `data/countries-110m.geojson` — Natural Earth 110m countries for the political globe.
- `data/launch-sites/` — China "edcp" relief + political base maps and per-site launch photos (the ChinRepo map).
- `data/launch-gallery/` and `data/asat/` — freely-licensed photo sets (spaceport gallery; the 2007-ASAT long-read), each with a `_manifest.json` / in-page attribution.

All bundled photos are public-domain or Creative-Commons and credited in-page; the charts/graphs on these pages are **original inline SVG**, not copied figures.

## News feeds (`news-core.js`)

`window.NazarNews` is the shared feed layer behind both the ticker and the archive page. It pulls ~10 RSS feeds (space press, NASA/ESA, plus dedicated China tag feeds), merges them into a **persistent, deduped localStorage archive** (`nazar.news.archive.v2`, keyed off normalised article URL, kept from 01 Jul 2026, capped 500), and never lets a partial pull wipe prior headlines. `getTickerItems()` returns China-first-then-world, ≤20, last ~31 days; the archive page shows everything.

- **CORS:** feeds are fetched through a proxy chain — `corsproxy.io` (raw XML → DOMParser, primary, returns full feeds) → `api.rss2json.com` (clean JSON, ~10 items) → `api.allorigins.win` (raw XML). First one yielding items wins. Every item must carry a real `http(s)` link or it's dropped (this is what fixed the old "link won't open" problem).
- **Dead/blocked feeds found the hard way (don't re-add):** Xinhua `english.news.cn/rss.xml` = 404; `nasaspaceflight.com/tag/<x>/feed/` = 403 (WordPress tag feeds blocked); CGTN/Global Times section feeds = 404 or carry no space news. Ars Technica space feed lives at `arstechnica.com/space/feed/` (the feedburner `/arstechnica/space` path returns nothing).
- Refresh is throttled to 30 min (`nazar.news.meta.v2` holds `last`); pass `refresh(true)` to force.

## Globe.gl quirks to remember

Globe.gl 2.32.0 has known issues with its `htmlElementsData` layer when the chain is configured after the initial `Globe()(...)` call — the per-item callback silently never fires. Workarounds used in this codebase:

- For small marker sets (≤ a few hundred), use `objectsData` with a returned `THREE.Mesh` — see `app.js`, `game-of-cones.js`.
- For the full ~16 k catalogue, use a single `THREE.InstancedMesh` added straight to `globe.scene()` — see `viz3d.js`, `sats-by-ops.js`.

Pages that construct three.js objects directly (`app.js`, `viz3d.js`, `sats-by-ops.js`, `game-of-cones.js`) load `three@0.157.0` from CDN explicitly **before** globe.gl — globe.gl bundles its own three internally but does not expose `window.THREE`.

## Git practice that matters here

- **Never force-push `main`**. If you must roll back state, use the non-destructive `git read-tree -u --reset <commit>` then commit on top of HEAD — this preserves history and lets the user `git checkout <old-sha> -- path` to cherry-pick discarded work. There is precedent in the history (commit `f84faed`).
- The user's local `core.autocrlf` rewrites line endings on commit; the `LF will be replaced by CRLF` warnings are expected and not actionable.
- Commits land directly on `main` (no PR workflow). The author identity is set per-repo via `git -C sat-orbit-map config user.name/email`.

## CelesTrak rate-limit reality

CelesTrak's `gp.php` aggressively 403s repeat callers from the same IP. During dev, expect to hit the limit after a handful of reloads. The localStorage cache + bundled `data/active.tle` snapshot keep the site working through outages, but any new dev test should also confirm with `data/active.tle` deleted from cache to make sure the live path still works.

**SATCAT** suffers the same problem on `records.php`. Sat-Stats uses a three-stage fallback: localStorage cache → live `records.php?GROUP=active` → bundled `data/satcat-active.json` (active payloads, ~2.6 MB pre-trimmed).

## Auto-refresh workflow

`.github/workflows/refresh-data.yml` runs every 6 hours (cron `17 */6 * * *`) and on manual `workflow_dispatch`. It:

1. Pulls the latest `/pub/satcat.csv` (CelesTrak's *static* file — NOT subject to the dynamic-endpoint 403 limit), filters to active payloads, and writes `data/satcat-active.json`.
2. Runs `scripts/gen_debris_history.py` against the same downloaded `satcat.csv` to precompute `data/debris-history.json` (the Debris Statistics dashboard's ~5 KB data file — cumulative debris by year, per country, altitude/inclination). Has its own sanity floor (≥15 000 debris).
3. Best-effort fetches fresh TLEs from `gp.php?GROUP=active` and overwrites `data/active.tle`. This step is `continue-on-error: true` — a 403 just means we keep the previous snapshot and try again next cycle.
4. Best-effort refreshes `data/debris.tle` (the Debris Tracker globe's bundled fallback) from the four breakup-cloud `gp.php` GROUPs — also `continue-on-error` with a sanity floor.
3. Commits + pushes only if at least one file changed. Push is by `github-actions[bot]` with `contents: write` permission. GitHub Pages auto-rebuilds on the push.

The job has a sanity floor (≥10 000 SATCAT records, ≥30 000 TLE lines) — if the response is truncated or replaced by an error page, the job aborts rather than commit a regressed file.
