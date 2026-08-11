# sat-orbit-map

**NAZAR** — a static, client-only satellite tracker focused on Chinese spacecraft visibility.

Live site: https://hitesh-gala.github.io/sat-orbit-map/

Everything runs in the browser: each page pulls the NORAD/CelesTrak TLE catalogue and
propagates orbits locally with SGP4 (satellite.js). No backend, no build step — edit a
file and reload. Deployed via GitHub Pages from the `main` branch.

See [CLAUDE.md](CLAUDE.md) for architecture and development notes.
