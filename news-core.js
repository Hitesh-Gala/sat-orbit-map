// NAZAR news core — shared feed-fetching + persistent archive layer.
//
// Loaded by index.html (drives the scrolling ticker via news-ticker.js) and
// by news-archive.html (the click-through repository page via news-archive.js).
// Exposes everything on `window.NazarNews` so the two UIs share one fetcher,
// one dedup/scoring policy and one localStorage archive.
//
// Why a persistent archive?  The old ticker fetched a single JSON proxy and
// showed whatever came back that instant — one flaky feed (or a rate-limited
// proxy) left it stuck on a single source with dead links.  Here every pull is
// merged into a growing, deduped repository keyed off the article URL, so a
// partial fetch never wipes prior headlines and the archive page can offer the
// full history since 01 July 2026 as chronological PDFs.
//
// CORS: browsers can't fetch most RSS feeds directly.  We try a chain of public
// proxies — corsproxy.io (raw XML, full item counts) first, rss2json (clean
// JSON, ~10 items) next, allorigins (raw XML) last — and stop at the first that
// yields items.  Every item must carry a real http(s) link or it is dropped,
// which is what kills the "link doesn't open as a URL" problem.

window.NazarNews = (function () {
  'use strict';

  // =======================================================================
  // Feed repository
  //
  // Global space press first (they carry NASA / ESA / ISRO / JAXA / Roscosmos
  // launches AND the private players — SpaceX, Rocket Lab, Blue Origin, ULA,
  // Firefly … — almost none of which publish a usable feed of their own).
  // Then the two national agencies that DO expose a public feed, then two
  // China-dedicated streams so PRC activity surfaces even when the global
  // feeds are quiet.  China focus is enforced by scoring (below), not by
  // which feeds happen to answer.
  // =======================================================================
  const FEEDS = [
    { url: 'https://spacenews.com/feed/',                     source: 'SpaceNews',       cat: 'Press'  },
    { url: 'https://www.space.com/feeds/all',                 source: 'Space.com',       cat: 'Press'  },
    { url: 'https://www.nasaspaceflight.com/feed/',           source: 'NASASpaceflight', cat: 'Press'  },
    { url: 'https://spaceflightnow.com/feed/',                source: 'Spaceflight Now', cat: 'Press'  },
    { url: 'https://payloadspace.com/feed/',                  source: 'Payload',         cat: 'Press'  },
    { url: 'https://arstechnica.com/space/feed/',             source: 'Ars Technica',    cat: 'Press'  },
    { url: 'https://www.nasa.gov/feed/',                      source: 'NASA',            cat: 'Agency' },
    { url: 'https://www.esa.int/rssfeed/Our_Activities/Space_News', source: 'ESA',       cat: 'Agency' },
    { url: 'https://spacenews.com/tag/china/feed/',           source: 'SpaceNews · China',      cat: 'China' },
    { url: 'https://spaceflightnow.com/tag/china/feed/',      source: 'Spaceflight Now · China', cat: 'China' },
  ];

  // Ordered proxy chain — each feed tries these until one returns parseable
  // items.  `kind` selects the parser.
  const PROXIES = [
    { name: 'corsproxy',  kind: 'xml',  mk: u => 'https://corsproxy.io/?url=' + encodeURIComponent(u) },
    { name: 'rss2json',   kind: 'json', mk: u => 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(u) },
    { name: 'allorigins', kind: 'xml',  mk: u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
  ];

  const ARCHIVE_KEY   = 'nazar.news.archive.v2';
  const META_KEY      = 'nazar.news.meta.v2';
  const ARCHIVE_START = Date.UTC(2026, 6, 1);          // 01 Jul 2026 — repository start
  const REFRESH_TTL   = 30 * 60 * 1000;                // don't re-pull feeds more than 2×/hour
  const FETCH_TIMEOUT = 7000;
  const CONCURRENCY   = 4;
  const PER_FEED_MAX  = 25;                             // items ingested per feed per pull
  const TICKER_MAX    = 20;                             // ≤ ~20 headlines in the ticker
  const TICKER_WINDOW_DAYS = 31;                        // ticker only shows the last ~month
  const ARCHIVE_CAP   = 500;                            // bound localStorage growth
  const DESC_MAX      = 600;                            // stored snippet length

  // China relevance — matches the country, its agencies/programmes, launch
  // sites, rocket families and the commercial-launch startups.
  const CHINA_RE = /\b(china|chinese|prc|beijing|cnsa|casc|casic|long\s*march|(?:^|\s)cz[-\s]?\d|chang[' ’]?e|tiangong|tianzhou|tianwen|shenzhou|shijian|yaogan|gaofen|fengyun|beidou|kuaizhou|ceres[-\s]?1|hyperbola|zhuque|gravity[-\s]?1|pallas|landspace|galactic\s+energy|orienspace|space\s+pioneer|i[-\s]?space|deep\s+blue\s+aerospace|cas\s*space|expace|guowang|qianfan|thousand\s+sails|jielong|smart\s+dragon|wenchang|jiuquan|xichang|taiyuan)\b/i;

  // =======================================================================
  // Small helpers
  // =======================================================================
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Strip HTML tags first (RSS <description> often carries CDATA markup), THEN
  // decode entities via a detached textarea so decoded < > can't re-form tags.
  // Output is only ever inserted as escaped text / textContent / PDF strings.
  const _decoder = (typeof document !== 'undefined') ? document.createElement('textarea') : null;
  function cleanText(raw) {
    let s = String(raw == null ? '' : raw).replace(/<[^>]*>/g, ' ');
    if (_decoder) { _decoder.innerHTML = s; s = _decoder.value; }
    return s.replace(/\s+/g, ' ').trim();
  }

  function hostOf(link) { try { return new URL(link).hostname.replace(/^www\./, ''); } catch { return ''; } }

  const MON  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONF = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const WD   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const d2 = n => (n < 10 ? '0' + n : '' + n);

  function fmtShort(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    const s = d2(d.getUTCDate()) + ' ' + MON[d.getUTCMonth()];
    return d.getUTCFullYear() !== new Date().getUTCFullYear() ? s + ' ' + d.getUTCFullYear() : s;
  }
  function fmtLong(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    return d2(d.getUTCDate()) + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear() +
           ' · ' + d2(d.getUTCHours()) + ':' + d2(d.getUTCMinutes()) + ' UTC';
  }
  function fmtDayKey(iso)   { const d = new Date(iso); if (isNaN(d)) return '0000-00-00';
    return d.getUTCFullYear() + '-' + d2(d.getUTCMonth() + 1) + '-' + d2(d.getUTCDate()); }
  function fmtDayLabel(iso) { const d = new Date(iso); if (isNaN(d)) return '';
    return WD[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MONF[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }

  function isChinaItem(it) {
    return it.cat === 'China' || CHINA_RE.test((it.title || '') + ' ' + (it.desc || ''));
  }

  // =======================================================================
  // Parsing
  // =======================================================================

  // Namespace-robust: match direct element children by lower-cased localName,
  // in the caller's priority order (so <description> wins over <content:encoded>
  // and <dc:date> is still found even though it's namespaced).
  function childText(node, names) {
    for (const name of names) {
      for (const c of node.children) {
        if ((c.localName || '').toLowerCase() === name) {
          const t = c.textContent;
          if (t && t.trim()) return t;
        }
      }
    }
    return '';
  }

  function makeItem(title, link, dateRaw, desc, feed) {
    title = (title || '').trim();
    link  = (link  || '').trim();
    // Require a real absolute URL — this is what stops dead / non-URL guids
    // ending up as unclickable ticker entries.
    if (!title || !/^https?:\/\//i.test(link)) return null;
    const d = new Date(dateRaw);
    const pubDate = isNaN(d.getTime()) ? null : d.toISOString();
    return { title, link, source: feed.source, cat: feed.cat, pubDate, desc: desc || '' };
  }

  function parseXmlFeed(txt, feed) {
    let doc;
    try { doc = new DOMParser().parseFromString(txt, 'text/xml'); } catch { return null; }
    if (!doc || doc.getElementsByTagName('parsererror').length) return null;
    let nodes = Array.from(doc.getElementsByTagName('item'));
    let atom = false;
    if (!nodes.length) { nodes = Array.from(doc.getElementsByTagName('entry')); atom = true; }
    if (!nodes.length) return null;

    const items = [];
    for (const n of nodes) {
      const title = cleanText(childText(n, ['title']));
      let link = '';
      if (atom) {
        // Atom: prefer <link rel="alternate" href>, else the first link href.
        let alt = '';
        for (const c of n.children) {
          if ((c.localName || '').toLowerCase() !== 'link') continue;
          const rel = c.getAttribute('rel') || 'alternate';
          const href = c.getAttribute('href') || '';
          if (rel === 'alternate') { alt = href; break; }
          if (!alt) alt = href;
        }
        link = alt;
      } else {
        link = (childText(n, ['link']) || '').trim();
        if (!/^https?:/i.test(link)) {
          const g = (childText(n, ['guid']) || '').trim();
          if (/^https?:/i.test(g)) link = g;
        }
      }
      const dateRaw = childText(n, ['pubdate', 'published', 'updated', 'date']);
      const desc = cleanText(childText(n, ['description', 'summary', 'encoded', 'content'])).slice(0, DESC_MAX);
      const it = makeItem(title, link, dateRaw, desc, feed);
      if (it) items.push(it);
    }
    return items;
  }

  function parseJsonFeed(txt, feed) {
    let j; try { j = JSON.parse(txt); } catch { return null; }
    if (!j || j.status !== 'ok' || !Array.isArray(j.items)) return null;
    return j.items
      .map(it => makeItem(
        cleanText(it.title),
        it.link || it.guid || '',
        it.pubDate || '',
        cleanText(it.description || it.content || '').slice(0, DESC_MAX),
        feed))
      .filter(Boolean);
  }

  // =======================================================================
  // Fetch
  // =======================================================================
  async function fetchVia(url, proxy) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    try {
      const r = await fetch(proxy.mk(url), { signal: ctrl.signal, redirect: 'follow' });
      clearTimeout(to);
      if (!r.ok) return null;
      return await r.text();
    } catch { clearTimeout(to); return null; }
  }

  async function fetchFeed(feed) {
    for (const proxy of PROXIES) {
      const txt = await fetchVia(feed.url, proxy);
      if (!txt) continue;
      const items = proxy.kind === 'json' ? parseJsonFeed(txt, feed) : parseXmlFeed(txt, feed);
      if (items && items.length) return items.slice(0, PER_FEED_MAX);
    }
    return [];
  }

  async function pmap(arr, limit, fn) {
    const out = new Array(arr.length);
    let i = 0;
    async function worker() { while (i < arr.length) { const idx = i++; out[idx] = await fn(arr[idx], idx); } }
    await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
    return out;
  }

  // =======================================================================
  // Archive (persistent, deduped repository)
  // =======================================================================
  function normLink(link) {
    try {
      const u = new URL(link);
      u.hash = '';
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'].forEach(p => u.searchParams.delete(p));
      return (u.origin + u.pathname + (u.search || '')).replace(/\/+$/, '').toLowerCase();
    } catch { return String(link || '').toLowerCase(); }
  }

  function getArchive() {
    try {
      const arr = JSON.parse(localStorage.getItem(ARCHIVE_KEY));
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function saveArchive(arr) { try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(arr)); } catch {} }
  function getMeta() { try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch { return {}; } }
  function setMeta(m) { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch {} }

  function mergeIntoArchive(fresh) {
    const byId = new Map();
    for (const it of getArchive()) byId.set(it.id || normLink(it.link), it);

    const now = Date.now();
    for (const it of fresh) {
      if (!it) continue;
      const id = normLink(it.link);
      const prev = byId.get(id);
      if (prev) { if (!prev.desc && it.desc) prev.desc = it.desc; continue; }
      byId.set(id, {
        id, title: it.title, link: it.link, source: it.source, cat: it.cat,
        pubDate: it.pubDate || new Date(now).toISOString(),
        desc: it.desc, firstSeen: now,
      });
    }

    let merged = Array.from(byId.values()).filter(it => {
      const t = +new Date(it.pubDate);
      return Number.isFinite(t) && t >= ARCHIVE_START && t <= now + 2 * 864e5;  // drop pre-start & wildly-future
    });
    merged.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    if (merged.length > ARCHIVE_CAP) merged = merged.slice(0, ARCHIVE_CAP);
    saveArchive(merged);
    return merged;
  }

  let _refreshing = null;
  async function refresh(force) {
    const meta = getMeta();
    if (!force && meta.last && (Date.now() - meta.last) < REFRESH_TTL && getArchive().length) {
      return getArchive();
    }
    if (_refreshing) return _refreshing;
    _refreshing = (async () => {
      const results = await pmap(FEEDS, CONCURRENCY, fetchFeed);
      const fresh = results.flat();
      const merged = mergeIntoArchive(fresh);
      setMeta({
        last: Date.now(),
        okFeeds: results.filter(r => r && r.length).length,
        feeds: FEEDS.length,
        fetched: fresh.length,
        total: merged.length,
      });
      return merged;
    })();
    try { return await _refreshing; } finally { _refreshing = null; }
  }

  // =======================================================================
  // Selection for the ticker — China first (focus), then world, capped.
  // =======================================================================
  function getTickerItems() {
    const cutoff = Date.now() - TICKER_WINDOW_DAYS * 864e5;
    const recent = getArchive().filter(it => +new Date(it.pubDate) >= cutoff);
    const byDateDesc = (a, b) => new Date(b.pubDate) - new Date(a.pubDate);
    const china = recent.filter(isChinaItem).sort(byDateDesc);
    const world = recent.filter(it => !isChinaItem(it)).sort(byDateDesc);
    return china.concat(world).slice(0, TICKER_MAX);
  }

  return {
    FEEDS, PROXIES, CHINA_RE, ARCHIVE_START, TICKER_MAX, TICKER_WINDOW_DAYS,
    esc, cleanText, hostOf, fmtShort, fmtLong, fmtDayKey, fmtDayLabel, isChinaItem,
    refresh, getArchive, getTickerItems, getMeta,
  };
})();
