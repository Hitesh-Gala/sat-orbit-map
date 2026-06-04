// Argos news ticker — Chinese rocket / launch headlines.
//
// Uses api.rss2json.com to convert RSS feeds to CORS-friendly JSON, so no
// browser-side XML parsing or third-party CORS proxy is needed.  The free
// tier (no API key) allows ~10 000 hits/day across all clients, which is
// plenty given our 30-minute localStorage cache.
//
// Everything below sits inside an IIFE so the top-level const declarations
// don't collide with identically-named consts in app.js (notably `esc`).
// Classic <script> tags share a single Script lexical environment per
// realm, so two scripts declaring the same top-level const are a parse
// error in the second one — silently breaking the whole file.

(function () {
const FEEDS = [
  { url: 'https://spacenews.com/feed/',            source: 'SpaceNews' },
  { url: 'https://www.space.com/feeds/all',        source: 'Space.com' },
  { url: 'https://www.nasaspaceflight.com/feed/',  source: 'NASASpaceflight' },
  { url: 'https://english.news.cn/rss.xml',        source: 'Xinhua' },
];

const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url=';
const FETCH_TIMEOUT_MS = 8000;
const MAX_ITEMS = 20;
const CACHE_KEY = 'argos.news.v2';
const CACHE_TTL = 30 * 60 * 1000;

const CHINA_RE = /\b(china|chinese|long\s*march|cz[- ]?\d|beidou|tianzhou|tiangong|shenzhou|yaogan|fengyun|kuaizhou|hyperbola|wenchang|jiuquan|xichang|taiyuan|cnsa|casc|casic|landspace|galactic\s+energy|orienspace|space\s+pioneer|i-?space|deep\s+blue\s+aerospace|chang\S?e)\b/i;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Short publication-date label for the ticker.  Drops the year when
// the item is from this year (the common case for fresh launches),
// keeps it otherwise so older items stay unambiguous.  Example
// outputs: "12 Jun", "23 Dec 2025".  Returns "" if the date is
// missing or unparseable.
function fmtTickerDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  const thisYear = new Date().getUTCFullYear();
  const opts = { day: '2-digit', month: 'short', timeZone: 'UTC' };
  if (d.getUTCFullYear() !== thisYear) opts.year = 'numeric';
  return d.toLocaleDateString('en-GB', opts);
}

async function fetchFeed({ url, source }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(RSS2JSON + encodeURIComponent(url), { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return [];
    const j = await r.json();
    if (j.status !== 'ok' || !Array.isArray(j.items)) return [];
    return j.items.map(it => ({
      title:   (it.title || '').trim(),
      link:    it.link || it.guid || '',
      pubDate: new Date(it.pubDate || Date.now()),
      source,
    })).filter(it => it.title && it.link);
  } catch {
    clearTimeout(t);
    return [];
  }
}

function cacheGet() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - t > CACHE_TTL) return null;
    return v.map(i => ({ ...i, pubDate: new Date(i.pubDate) }));
  } catch { return null; }
}
function cacheSet(items) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), v: items })); } catch {}
}

async function fetchAll() {
  const cached = cacheGet();
  if (cached && cached.length) return cached;

  const arrays = await Promise.all(FEEDS.map(fetchFeed));
  const seen = new Set();
  const combined = arrays.flat()
    .filter(it => CHINA_RE.test(it.title))
    .filter(it => {
      if (seen.has(it.link)) return false;
      seen.add(it.link);
      return true;
    })
    .sort((a, b) => b.pubDate - a.pubDate)
    .slice(0, MAX_ITEMS);

  if (combined.length) cacheSet(combined);
  return combined;
}

function render(items) {
  const track = document.getElementById('ticker-track');
  if (!track) return;
  if (!items.length) {
    track.innerHTML = '<span class="ticker-status">No Chinese-launch items in the latest RSS pulls — the feeds may not have any today, or rss2json may be temporarily down.</span>';
    track.style.animation = 'none';
    return;
  }
  const html = items.map(it => {
    const date = fmtTickerDate(it.pubDate);
    const datePart = date ? `<span class="date">${esc(date)}</span>` : '';
    return `<span class="ticker-item">${datePart}<a href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a><span class="source">${esc(it.source)}</span></span>`;
  }).join('');
  // Duplicate so the keyframe loop is seamless.
  track.innerHTML = html + html;
  track.style.animation = '';

  // Scale animation duration by total content width so the perceived
  // scroll speed stays roughly constant whether we have 6 items or 20.
  requestAnimationFrame(() => {
    const w = track.scrollWidth / 2;
    const pxPerSec = 105;  // midpoint between the original 70 and 2× 140
    const seconds = Math.max(40, Math.round(w / pxPerSec));
    track.style.animationDuration = seconds + 's';
  });
}

// Synchronous boot marker — writes immediately if this script executes at
// all, regardless of any async pipeline.  Lets us distinguish "script ran
// but data is empty" from "script never ran".
(function bootMark() {
  const t = document.getElementById('ticker-track');
  if (t) t.innerHTML = '<span class="ticker-status">Loading rocket-launch headlines…</span>';
})();

(async function init() {
  // Outer guard so a wedged fetch can never leave the ticker stuck on its
  // boot-time placeholder.
  const guard = new Promise(resolve => setTimeout(() => resolve('__timeout__'), 15_000));
  try {
    const result = await Promise.race([fetchAll(), guard]);
    if (result === '__timeout__') {
      console.warn('News ticker: outer 15 s timeout fired.');
      render([]);
    } else {
      render(result);
    }
  } catch (e) {
    console.warn('News ticker error:', e);
    render([]);
  }
})();

})();  // close IIFE
