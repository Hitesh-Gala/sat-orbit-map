# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**NAZAR** — a static, client-only satellite tracker focused on Chinese spacecraft visibility. Deployed via GitHub Pages from the `main` branch of `https://github.com/hdgala-cpu/Third-Trial` to `https://hdgala-cpu.github.io/Third-Trial/`. No backend; everything runs in the browser.

Every page consumes the same NORAD/CelesTrak TLE catalog and propagates orbits with SGP4 (satellite.js) locally. There is no JSON tracker API in the loop — `satellitetracker3d.com` is referenced in comments but not called.

## Where the code actually lives

The site is the contents of the **`Third-Trial/`** directory (this directory). The sibling `../Argos/` folder is a different, unrelated project that just happens to share the parent workspace — do not edit it when working on NAZAR.

`../.claude/launch.json` defines two preview servers — port **8090** serves NAZAR, port 8080 serves the unrelated Argos project.

## Running locally

The preview tool (`mcp__Claude_Preview__preview_start`) starts the static server defined in `../.claude/launch.json`:

```
name: "Third-Trial static server"  →  python -m http.server 8090 --directory Third-Trial
```

Equivalent ad-hoc command from the workspace root: `python -m http.server 8090 --directory Third-Trial`.

There is no build step, no bundler, no test suite, no linter. Edit a file → reload the browser.

## Deployment & cache busting

Push to `main` → GitHub Pages auto-rebuilds (~30-60 s). Verify the live commit with `gh api repos/hdgala-cpu/Third-Trial/pages/builds --jq '.[0]'`.

Local script tags carry a manual `?v=N` query string (e.g. `<script src="app.js?v=19">`). **Bump that integer whenever you change the corresponding JS file** — without it, browsers serve the previous cached copy and the page silently runs old code. After deploy, users still need a hard refresh to pick up `index.html` changes (Pages sets a 10-min cache header on HTML).

## Architecture — shared data layer

All page scripts read from one shared module:

- **`tle-loader.js`** exposes the global `window.Argos = { OBSERVER, EARTH_R_KM, fetchTLEs, fetchChinaSatcat, propagate, makeSatrecs, inferPurpose, parseTLE }`. Loaded on every page that needs satellite data.
- `fetchTLEs()` hits CelesTrak `gp.php?GROUP=active&FORMAT=tle`, caches the result in `localStorage` (6 h TTL), and **falls back to the bundled `data/active.tle` snapshot** when CelesTrak rate-limits the IP (returns 403 — common during dev). Always returns `{ tles, source: 'celestrak' | 'cache' | 'bundled' }`.
- `fetchChinaSatcat()` fans `?NAME=<prefix>` queries across the `CN_NAME_PREFIXES` list (~50 entries) at concurrency 4 (`pmap`) — CelesTrak's `records.php` requires a name prefix per call, and 4-in-flight stays inside their polite-use threshold. Results are filtered to `OWNER === 'PRC'` and `OBJECT_TYPE === 'PAY'`, deduped by NORAD ID, and cached 24 h.
- `propagate(satrec, date, observer)` returns `{ lat, lon, alt, az, el, range }` — lat/lon are sub-point, az/el are look-angles from the observer (defaults to New Delhi 28.61° N, 77.21° E).
- `makeSatrecs(tles)` runs each TLE through `satellite.twoline2satrec` and **dedupes by NORAD ID** — the raw feed sometimes carries the same object twice.

## Architecture — pages

Each `.html` is paired with a same-name `.js`. All pages share `styles.css` and most also load `tle-loader.js`.

| Page | Script | Globe library | What it does |
|------|--------|---------------|--------------|
| `index.html` | `app.js` | globe.gl | Realistic Earth + live sat dots (true altitude or flat via the 2D-3D toggle), HUD with clocks, observer-city dropdown (10 cities / All / mask-CN), over-horizon counts split by PRC flag |
| `orbits.html` | `orbits.js` | globe.gl | 3-D orbital tracks (one polyline per sat, sampled across one period) + NAZAR soundtrack with beat-driven camera moves + immersive fullscreen |
| `2d-views.html` | `2d-views.js` | SVG overlay on a Blue Marble raster **+ a companion globe.gl globe** | Single-satellite ground-track tool. Track is a self-drawn SVG overlaid on the equirectangular basemap (lon/lat → viewBox linearly). **Time-based** mode: ±24 h SGP4 sub-point path as dotted past/future lines + 30-min direction arrows + hover place-names. **Rev-based** mode (panel toggle): dots hidden, a floating speed slider (1×–100×) flies the sat dot forward from now, tracing a golden trail capped at 3 revs, with projected UTC/IST clocks. Two small stacked 3-D globes (~1/6 width, right side) stay synced via `setNowMarker(lat,lon,alt,t)`: **Globe 1** (centred-on-sat) calls `pointOfView({lat:0, lng: subLon})` so it spins in longitude to keep the sat centred while the marker rides up/down with latitude. **Globe 2** (not centred) orbits its camera at `lng = -GMST(t)` so the Earth appears to spin at its true rate while the sat traces a fixed inertial ellipse; a per-frame occlusion test fades + lightens the marker when it passes behind the globe (`depthTest:false` so the far side of the orbit still shows). `sizeMiniGlobes()` sizes both squares off the map height (a ResizeObserver drives it; reading the globe column's own size feeds back). `globeAltFrac()` log-compresses altitude so HEO sats stay in view. Loads three@0.157 + globe.gl; amCharts is loaded for the worldLow GeoJSON only (point-in-polygon reverse-geocode, coarse ocean-basin fallback) |
| `viz3d.html` | `viz3d.js` | globe.gl + **bare three.js r157** | Every active sat at true altitude via one `THREE.InstancedMesh`; hover tooltip + click-to-isolate orbit tube; bottom search box highlights a sat (reuses `selectSat` → dim others + orbit ring + camera swing) |
| `sats-by-ops.html` | `sats-by-ops.js` | globe.gl + **bare three.js r157** | Same InstancedMesh engine, sats colour-coded by ~37 operator/constellation categories with per-category toggles |
| `game-of-cones.html` | `game-of-cones.js` | globe.gl + **bare three.js r157** | Land-cone and sat-cone geometry puzzles (ConeGeometry meshes added directly to `globe.scene()`) |
| `sat-stats.html` | `sat-stats.js` | none | Cumulative satellite DB (localStorage) + Chart.js graphs + TLE Repo modal |
| `chinrepo.html` | `chinrepo.js` | none | Filterable table of every active PRC payload (joins CelesTrak SATCAT `OWNER=PRC` with active TLEs) |
| `compendium.html` | (inline) | none | Self-contained PRC-program reference catalogue with embedded styles |
| `news-ticker.js` | (included on `index.html`) | none | Scrolling ticker that fetches Chinese-launch RSS via `api.rss2json.com`, filtered by a keyword regex, 30-min localStorage cache |

`styles.css` is shared. Page-specific rules are scoped by `body.page-2d`, `body.page-repo`, `body.page-orbit`, etc. CSS custom properties (`:root`) drive the dark theme; light-mode is implemented by re-defining the same properties under `body.light`.

## Globe.gl quirks to remember

Globe.gl 2.32.0 has known issues with its `htmlElementsData` layer when the chain is configured after the initial `Globe()(...)` call — the per-item callback silently never fires. Workarounds used in this codebase:

- For small marker sets (≤ a few hundred), use `objectsData` with a returned `THREE.Mesh` — see `app.js`, `game-of-cones.js`.
- For the full ~16 k catalogue, use a single `THREE.InstancedMesh` added straight to `globe.scene()` — see `viz3d.js`, `sats-by-ops.js`.

Pages that construct three.js objects directly (`app.js`, `viz3d.js`, `sats-by-ops.js`, `game-of-cones.js`) load `three@0.157.0` from CDN explicitly **before** globe.gl — globe.gl bundles its own three internally but does not expose `window.THREE`.

## Git practice that matters here

- **Never force-push `main`**. If you must roll back state, use the non-destructive `git read-tree -u --reset <commit>` then commit on top of HEAD — this preserves history and lets the user `git checkout <old-sha> -- path` to cherry-pick discarded work. There is precedent in the history (commit `f84faed`).
- The user's local `core.autocrlf` rewrites line endings on commit; the `LF will be replaced by CRLF` warnings are expected and not actionable.
- Commits land directly on `main` (no PR workflow). The author identity is set per-repo via `git -C Third-Trial config user.name/email`.

## CelesTrak rate-limit reality

CelesTrak's `gp.php` aggressively 403s repeat callers from the same IP. During dev, expect to hit the limit after a handful of reloads. The localStorage cache + bundled `data/active.tle` snapshot keep the site working through outages, but any new dev test should also confirm with `data/active.tle` deleted from cache to make sure the live path still works.

**SATCAT** suffers the same problem on `records.php`. Sat-Stats uses a three-stage fallback: localStorage cache → live `records.php?GROUP=active` → bundled `data/satcat-active.json` (active payloads, ~2.6 MB pre-trimmed).

## Auto-refresh workflow

`.github/workflows/refresh-data.yml` runs every 6 hours (cron `17 */6 * * *`) and on manual `workflow_dispatch`. It:

1. Pulls the latest `/pub/satcat.csv` (CelesTrak's *static* file — NOT subject to the dynamic-endpoint 403 limit), filters to active payloads, and writes `data/satcat-active.json`.
2. Best-effort fetches fresh TLEs from `gp.php?GROUP=active` and overwrites `data/active.tle`. This step is `continue-on-error: true` — a 403 just means we keep the previous snapshot and try again next cycle.
3. Commits + pushes only if at least one file changed. Push is by `github-actions[bot]` with `contents: write` permission. GitHub Pages auto-rebuilds on the push.

The job has a sanity floor (≥10 000 SATCAT records, ≥30 000 TLE lines) — if the response is truncated or replaced by an error page, the job aborts rather than commit a regressed file.
