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
    // Andrew Jones (SpaceNews' China correspondent — his was the first report
    // of the Yaogan-50 (02) break-up) writes his own newsletter; Blaine
    // Curcio's covers the Chinese space industry.  Substack exposes /feed.
    { url: 'https://chinaspacenewsroundup.substack.com/feed', source: 'China Space News Roundup', cat: 'China' },
    { url: 'https://chinaspacemonitor.substack.com/feed',     source: 'China Space Monitor',      cat: 'China' },
    { url: 'https://spaceflightnow.com/tag/china/feed/',      source: 'Spaceflight Now · China', cat: 'China' },
    // General-interest outlets that carried the Yaogan-50 break-up when the
    // trade press had moved on.  `topic: true` keeps only their space stories —
    // their feeds are site-wide and would otherwise bury the ticker in gadgets.
    { url: 'https://gizmodo.com/feed',                        source: 'Gizmodo',         cat: 'Press', topic: true },
    { url: 'https://futurism.com/feed',                       source: 'Futurism',        cat: 'Press', topic: true },
    // Topic searches.  Every feed above exposes only its newest ~25 items, so
    // a story more than a few days old has already rotated off it — which is
    // how the Yaogan-50 (02) breakup of 04 Sep 2026 never reached the ticker
    // even though SpaceNews had run it.  These two look 30 days back, so a
    // notable item is still caught days later, and they reach outlets NAZAR
    // doesn't subscribe to.  `google: true` marks the "Headline - Publisher"
    // title format so the real publisher becomes the source.
    { url: 'https://news.google.com/rss/search?q=(china+OR+chinese)+(satellite+OR+spacecraft+OR+rocket+OR+launch+OR+orbit)+when:30d&hl=en-US&gl=US&ceid=US:en',
      source: 'Google News · China', cat: 'China', google: true },
    { url: 'https://news.google.com/rss/search?q=satellite+(breakup+OR+"break+up"+OR+fragmentation+OR+debris+OR+collision+OR+anomaly)+when:30d&hl=en-US&gl=US&ceid=US:en',
      source: 'Google News · Orbital events', cat: 'Press', google: true },
  ];

  // Ordered proxy chain — each feed tries these until one returns parseable
  // items.  `kind` selects the parser.
  //
  // corsproxy.io was first here until it began answering every request with
  // HTTP 401 "a valid API key is required" (Sep 2026), which cost every feed
  // one dead round-trip and left pulls half-empty.  Dropped; allorigins leads
  // now, with codetabs as the third way in.
  const PROXIES = [
    { name: 'allorigins', kind: 'xml',  mk: u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
    { name: 'rss2json',   kind: 'json', mk: u => 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(u) },
    { name: 'codetabs',   kind: 'xml',  mk: u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u) },
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

  // Space stories inside a general-interest feed (see `topic` above).
  const SPACE_RE = /\b(space(craft|flight|x)?|satellites?|orbit(al|s|ing)?|rocket|launch(es|ed|ing)?|astronauts?|cosmonauts?|nasa|esa|isro|jaxa|roscosmos|starship|falcon\s*9|debris|iss|moon|lunar|mars|asteroid|telescope|observatory|constellation|reentry|re-entry)\b/i;

  // Notable orbital events — a breakup, collision or failure leads the ticker
  // even when newer routine items exist.  Titles only: descriptions mention
  // debris in passing far too often.
  const EVENT_RE = /\b(break[\s-]?up|breaks?\s+up|broke\s+up|breaking\s+up|fragmentation|fragments?|debris|collision|collides?|collided|explosion|exploded|anomaly|malfunction|failure|fails?|failed|lost\s+contact|re-?entry|de-?orbit(?:s|ed|ing)?)\b/i;

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

  function isEventItem(it) { return EVENT_RE.test(it.title || ''); }

  // Same story reaching us from two feeds (the publisher's own and an
  // aggregator's copy) shares a title but not a URL — dedupe on this.
  function titleKey(t) {
    return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
  }
  const isAggregator = link => hostOf(link) === 'news.google.com';

  // Google News titles read "Headline - Publisher", and the item also carries
  // the publisher in <source>.  Prefer that element; fall back to the suffix.
  function splitGoogleTitle(title, pub) {
    if (pub && title.endsWith(' - ' + pub)) return { title: title.slice(0, -(pub.length + 3)).trim(), source: pub };
    if (pub) return { title, source: pub };
    const i = title.lastIndexOf(' - ');
    if (i > 20 && title.length - i <= 45) return { title: title.slice(0, i).trim(), source: title.slice(i + 3).trim() };
    return { title, source: '' };
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

  function makeItem(title, link, dateRaw, desc, feed, source) {
    title = (title || '').trim();
    link  = (link  || '').trim();
    // Require a real absolute URL — this is what stops dead / non-URL guids
    // ending up as unclickable ticker entries.  A one- or two-word title is
    // never a headline: agency feeds mix plain site pages (NASA's "Travel"
    // services page) in with their news.
    if (!title || !/^https?:\/\//i.test(link)) return null;
    if (title.split(/\s+/).length < 3) return null;
    const d = new Date(dateRaw);
    const pubDate = isNaN(d.getTime()) ? null : d.toISOString();
    return { title, link, source: source || feed.source, cat: feed.cat, pubDate, desc: desc || '' };
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
      let name = '';
      if (feed.google) {
        const g = splitGoogleTitle(title, cleanText(childText(n, ['source'])));
        title = g.title;
        name = g.source;
      }
      const it = makeItem(title, link, dateRaw, desc, feed, name);
      if (it) items.push(it);
    }
    return items;
  }

  function parseJsonFeed(txt, feed) {
    let j; try { j = JSON.parse(txt); } catch { return null; }
    if (!j || j.status !== 'ok' || !Array.isArray(j.items)) return null;
    return j.items
      .map(it => {
        const g = feed.google ? splitGoogleTitle(cleanText(it.title), '') : null;
        return makeItem(
          g ? g.title : cleanText(it.title),
          it.link || it.guid || '',
          it.pubDate || '',
          cleanText(it.description || it.content || '').slice(0, DESC_MAX),
          feed,
          g ? g.source : '');
      })
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
      let items = proxy.kind === 'json' ? parseJsonFeed(txt, feed) : parseXmlFeed(txt, feed);
      if (items && items.length && feed.topic) {
        items = items.filter(it => SPACE_RE.test(it.title + ' ' + it.desc));
      }
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
    const byId = new Map(), byTitle = new Map();
    for (const it of getArchive()) {
      const id = it.id || normLink(it.link);
      byId.set(id, it);
      byTitle.set(titleKey(it.title), it);
    }

    const now = Date.now();
    for (const it of fresh) {
      if (!it) continue;
      const id = normLink(it.link);
      const prev = byId.get(id);
      if (prev) { if (!prev.desc && it.desc) prev.desc = it.desc; continue; }

      const same = byTitle.get(titleKey(it.title));
      if (same) {                                    // already have this story
        if (isAggregator(same.link) && !isAggregator(it.link)) {
          byId.delete(same.id);                      // swap in the publisher's own link
          same.id = id;
          same.link = it.link;
          same.source = it.source;
          byId.set(id, same);
        }
        if (it.cat === 'China') same.cat = 'China';
        if (!same.desc && it.desc) same.desc = it.desc;
        continue;
      }

      const rec = {
        id, title: it.title, link: it.link, source: it.source, cat: it.cat,
        pubDate: it.pubDate || new Date(now).toISOString(),
        desc: it.desc, firstSeen: now,
      };
      byId.set(id, rec);
      byTitle.set(titleKey(it.title), rec);
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
  // Selection for the ticker — Chinese orbital events first (a breakup or
  // collision shouldn't be pushed out by routine launch items), then the rest
  // of the China feed, then the world, capped.
  // =======================================================================
  function getTickerItems() {
    const cutoff = Date.now() - TICKER_WINDOW_DAYS * 864e5;
    const recent = getArchive().filter(it => +new Date(it.pubDate) >= cutoff);
    const byDateDesc = (a, b) => new Date(b.pubDate) - new Date(a.pubDate);
    const china = recent.filter(isChinaItem).sort(byDateDesc);
    const world = recent.filter(it => !isChinaItem(it)).sort(byDateDesc);
    return china.filter(isEventItem)
      .concat(china.filter(it => !isEventItem(it)), world)
      .slice(0, TICKER_MAX);
  }

  return {
    FEEDS, PROXIES, CHINA_RE, ARCHIVE_START, TICKER_MAX, TICKER_WINDOW_DAYS,
    esc, cleanText, hostOf, fmtShort, fmtLong, fmtDayKey, fmtDayLabel, isChinaItem, isEventItem,
    refresh, getArchive, getTickerItems, getMeta,
  };
})();
