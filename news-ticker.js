// Argos news ticker — Chinese rocket / launch headlines.
//
// Honest summary: there's no free, CORS-friendly, browser-callable API that
// is curated to "Chinese rocket launches".  This module fans out across the
// RSS feeds of a few credible English-language space-news outlets and one
// Chinese state outlet, filters titles for China-launch keywords, dedupes
// by URL, and shows the latest 20.  RSS pulls go through a public CORS
// proxy with two fall-backs; if both proxies are down the ticker shows a
// degraded "news unavailable" state rather than fabricated headlines.

const FEEDS = [
  { url: 'https://spacenews.com/feed/',            source: 'SpaceNews' },
  { url: 'https://www.nasaspaceflight.com/feed/',  source: 'NASASpaceflight' },
  { url: 'https://english.news.cn/rss.xml',        source: 'Xinhua' },
  { url: 'https://www.space.com/feeds/all',        source: 'Space.com' },
];

// CORS proxies, tried in order.  Both are widely used third-party
// services — neither is guaranteed up forever.  Each call is wrapped in
// an AbortController so a hung proxy can't stall the whole ticker.
const PROXIES = [
  url => 'https://corsproxy.io/?'              + encodeURIComponent(url),
  url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
];
const PROXY_TIMEOUT_MS = 6000;

// Keyword match for China-related rocket / launch coverage.
const CHINA_RE = /\b(china\b|chinese|long\s*march|cz[- ]?\d|beidou|tianzhou|tiangong|shenzhou|yaogan|fengyun|chang['ʼ]?e|kuaizhou|hyperbola|ceres[- ]\d|wenchang|jiuquan|xichang|taiyuan|cnsa|casc|casic|landspace|galactic energy|orienspace|space pioneer|i[- ]?space|deep blue aerospace)\b/i;

const MAX_ITEMS = 20;
const CACHE_KEY = 'argos.news.v1';
const CACHE_TTL = 30 * 60 * 1000;  // 30 min

async function proxyFetch(url) {
  for (const proxify of PROXIES) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PROXY_TIMEOUT_MS);
    try {
      const r = await fetch(proxify(url), { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) {
        const txt = await r.text();
        if (txt && txt.length > 200) return txt;
      }
    } catch { /* try next proxy */ }
    finally { clearTimeout(t); }
  }
  return null;
}

function parseFeed(xmlText, source) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) return [];
  // RSS 2.0 <item>, Atom <entry>.
  const nodes = [...doc.querySelectorAll('item, entry')];
  return nodes.map(n => {
    const title = (n.querySelector('title')?.textContent || '').trim();
    let link = n.querySelector('link')?.getAttribute?.('href')
             || n.querySelector('link')?.textContent
             || n.querySelector('guid')?.textContent
             || '';
    link = String(link).trim();
    const dateStr = n.querySelector('pubDate')?.textContent
                 || n.querySelector('updated')?.textContent
                 || n.querySelector('published')?.textContent
                 || '';
    return { title, link, pubDate: new Date(dateStr || Date.now()), source };
  }).filter(it => it.title && it.link);
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

  const arrays = await Promise.all(FEEDS.map(async f => {
    const xml = await proxyFetch(f.url);
    return xml ? parseFeed(xml, f.source) : [];
  }));

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

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render(items) {
  const track = document.getElementById('ticker-track');
  if (!items.length) {
    track.innerHTML = '<span class="ticker-status">No matching items — try again later (RSS or CORS proxy may be temporarily down).</span>';
    track.style.animation = 'none';
    return;
  }
  const html = items.map(it => `
    <span class="ticker-item">
      <a href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a>
      <span class="source">${esc(it.source)}</span>
    </span>
  `).join('');
  // Duplicate the run so the -50% keyframe loops seamlessly.
  track.innerHTML = html + html;

  // Scale animation duration to total content width so scroll speed stays
  // roughly constant whether we have 6 items or 20.
  requestAnimationFrame(() => {
    const w = track.scrollWidth / 2;
    const pxPerSec = 70;
    const seconds = Math.max(60, Math.round(w / pxPerSec));
    track.style.animationDuration = seconds + 's';
  });
}

(async function init() {
  // Outer guard so a wedged proxy fetch can never leave the ticker stuck
  // on its boot-time "Fetching…" placeholder.
  const guard = new Promise(resolve => setTimeout(() => resolve('__timeout__'), 18000));
  try {
    const result = await Promise.race([fetchAll(), guard]);
    if (result === '__timeout__') {
      console.warn('News ticker: outer 18 s timeout fired — proxies are likely slow or blocked.');
      render([]);
    } else {
      render(result);
    }
  } catch (e) {
    console.warn('News ticker error:', e);
    render([]);
  }
})();
