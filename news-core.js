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
  // ORDER MATTERS.  Feeds are pulled four at a time and the proxies in front of
  // them fail in bulk — allorigins and codetabs sit behind Cloudflare and both
  // answered 522 for every URL on 30 Sep 2026, which left rss2json carrying the
  // whole pull until it returned 429.  Whatever is pulled last is what gets
  // dropped on a thin day.
  //
  // So the order is not fixed: `pin: true` holds the China block AND the four
  // SSA backfill searches at the front.  On 03 Nov 2026 only 23 of 35 feeds
  // answered and every one of those searches was in the dropped tail - which is
  // how Yaogan-50 and USA 32 stayed missing from the very pull meant to find
  // them.  Whatever a thin day costs, it must not cost the site its subject.
  // Everything after the pinned block ROTATES by
  // ROTATE_STRIDE places on each refresh.  A fixed order meant the tail of this
  // list was permanently the part that never answered, and the list has grown
  // past thirty feeds — a thin pull now reaches a third of it.  Rotating costs
  // nothing: the archive is cumulative, so a feed missed at 10:00 lands at
  // 10:30 instead of never.
  const FEEDS = [
    // ---- China ----------------------------------------------------------
    { url: 'https://spacenews.com/tag/china/feed/',           source: 'SpaceNews · China',      cat: 'China', pin: true },
    // Andrew Jones (SpaceNews' China correspondent — his was the first report
    // of the Yaogan-50 (02) break-up) writes his own newsletter; Blaine
    // Curcio's covers the Chinese space industry.  Substack exposes /feed.
    { url: 'https://chinaspacenewsroundup.substack.com/feed', source: 'China Space News Roundup', cat: 'China', pin: true },
    { url: 'https://chinaspacemonitor.substack.com/feed',     source: 'China Space Monitor',      cat: 'China', pin: true },
    { url: 'https://spaceflightnow.com/tag/china/feed/',      source: 'Spaceflight Now · China', cat: 'China', pin: true },
    // Topic searches.  Every RSS feed exposes only its newest ~25 items, so a
    // story more than a few days old has already rotated off it — which is how
    // the Yaogan-50 (02) breakup of 04 Sep 2026 never reached the ticker even
    // though SpaceNews had run it.  These look 30 days back, so a notable item
    // is still caught days later, and they reach outlets NAZAR doesn't
    // subscribe to.  `google: true` marks the "Headline - Publisher" title
    // format so the real publisher becomes the source.
    { url: 'https://news.google.com/rss/search?q=(china+OR+chinese)+(satellite+OR+spacecraft+OR+rocket+OR+launch+OR+orbit)+when:30d&hl=en-US&gl=US&ceid=US:en',
      source: 'Google News · China', cat: 'China', google: true, pin: true },
    // Crewed and programme-level news needs its own search: the query above
    // insists on satellite/rocket/orbit words, so "China trains two Pakistani
    // astronauts for Tiangong" — carried by Reuters, Global Times, The Hindu
    // and others in Sep 2026 — matched nothing and never reached the archive.
    // Kept separate rather than widening the query above, which would push
    // break-up stories out of its newest-25 window.
    { url: 'https://news.google.com/rss/search?q=(china+OR+chinese)+(astronaut+OR+taikonaut+OR+"space+station"+OR+tiangong+OR+shenzhou+OR+"space+programme"+OR+"space+program")+when:30d&hl=en-US&gl=US&ceid=US:en',
      source: 'Google News · China crewed & programme', cat: 'China', google: true, pin: true },
    // Outlets that carried the China/Pakistan astronaut training story when the
    // trade press did not - Global Times ran it first, the Indian desks and
    // Technology Org picked it up. Every one checked live before being added.
    { url: 'https://www.globaltimes.cn/rss/outbrain.xml',    source: 'Global Times',        cat: 'China', pin: true },
    { url: 'https://stratnewsglobal.com/feed/',              source: 'StratNews Global',    cat: 'China', topic: true },
    { url: 'https://www.thehindu.com/sci-tech/science/feeder/default.rss', source: 'The Hindu · Science', cat: 'Press', topic: true },
    { url: 'https://www.technology.org/feed/',               source: 'Technology Org',      cat: 'Press', topic: true },
    // ---- ISR, space domain awareness and military space -------------------
    // Break-ups, debris and rendezvous work are reported here long before they
    // reach the general press.
    //
    // Integrity ISR writes nothing but this domain - its post on the Kosmos
    // 2612 approach to ICEYE-X36 went up two days after the pass, when no feed
    // NAZAR subscribed to had carried it at all.  `topic: 'domain'` keeps the
    // space and ISR pieces and drops the purely terrestrial ones.
    { url: 'https://integrityisr.com/feed/',                 source: 'Integrity ISR',       cat: 'SSA', topic: 'domain' },
    // Its space-force tag feed is not pulled as well: the same newsroom's main
    // feed is already in this list and the two overlap almost completely, and
    // every extra feed is one more call on a proxy chain that rate-limits.
    { url: 'https://spacenews.com/tag/military-space/feed/', source: 'SpaceNews · Military', cat: 'SSA' },
    { url: 'https://www.airandspaceforces.com/feed/',        source: 'Air & Space Forces',  cat: 'SSA', topic: 'domain' },
    { url: 'https://leolabs.space/feed/',                    source: 'LeoLabs',             cat: 'SSA' },
    { url: 'https://www.esa.int/rssfeed/Our_Activities/Space_Safety', source: 'ESA Space Safety', cat: 'SSA' },
    { url: 'https://breakingdefense.com/category/space/feed/', source: 'Breaking Defense · Space', cat: 'SSA' },
    { url: 'https://www.defensenews.com/arc/outboundfeeds/rss/category/space/?outputType=xml',
      source: 'Defense News · Space', cat: 'SSA' },
    { url: 'https://www.spaceforce.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=1060&max=20',
      source: 'US Space Force', cat: 'SSA' },
    { url: 'https://news.google.com/rss/search?q=(satellite+OR+orbit)+("space+domain+awareness"+OR+"rendezvous+and+proximity"+OR+"space+surveillance"+OR+conjunction+OR+"close+approach")+when:30d&hl=en-US&gl=US&ceid=US:en',
      source: 'Google News · Space domain awareness', cat: 'SSA', google: true },
    // The four searches below look back a YEAR, not thirty days.  Everything
    // else here is a news feed and thirty days is the right window for one,
    // but these exist to BACKFILL: the Yaogan-50 (02) break-up of 04 Sep 2026,
    // the USA 32 "Farrah" fragmentation of 13 Sep, the Kosmos 2612 approach to
    // ICEYE-X36 on 18 Oct - every one of them widely reported, every one of
    // them older than a thirty-day window by the time anyone looked.  A
    // headline event is worth more at six months old than a routine launch is
    // at six weeks, which is also why the archive trim keeps them (below).
    //
    // The vocabulary matters more than the window.  The search above insists
    // on the phrase "space domain awareness" or "rendezvous and proximity",
    // and the defence desks do not write that way: they write stalked,
    // shadowed, dogfighting, inspector, close approach.  Searching the
    // catalogue's language for stories written in the press's language is why
    // these events were missing.
    { url: 'https://news.google.com/rss/search?q=(satellite+OR+spacecraft)+("proximity+operations"+OR+"rendezvous+and+proximity"+OR+co-orbital+OR+shadowing+OR+stalked+OR+"close+approach"+OR+dogfighting+OR+"inspector+satellite")+when:1y&hl=en-US&gl=US&ceid=US:en',
      source: 'Google News · Proximity operations', cat: 'SSA', google: true , pin: true },
    // Named series, because a headline often names the object and nothing
    // else: "China's Shijian-31 satellite is sweeping GEO using a unique
    // orbit" carries no proximity word at all.
    { url: 'https://news.google.com/rss/search?q=(shijian+OR+"TJS"+OR+shiyan+OR+yaogan+OR+luch+OR+olymp+OR+kosmos+OR+cosmos)+satellite+(maneuver+OR+manoeuvre+OR+approach+OR+inspect+OR+shadow+OR+rendezvous+OR+geo)+when:1y&hl=en-US&gl=US&ceid=US:en',
      source: 'Google News · Shadowing & inspection', cat: 'SSA', google: true , pin: true },
    { url: 'https://news.google.com/rss/search?q=(satellite+OR+"rocket+body"+OR+spacecraft)+(breakup+OR+"break+up"+OR+"broke+apart"+OR+fragmentation+OR+"debris+cloud"+OR+collision)+when:1y&hl=en-US&gl=US&ceid=US:en',
      source: 'Google News · Break-ups & collisions', cat: 'SSA', google: true , pin: true },
    // Bare "ASAT" is left out on purpose: it matched a person's surname and
    // pulled an Amnesty International story about a detained entrepreneur into
    // a space archive.
    { url: 'https://news.google.com/rss/search?q=("anti-satellite"+OR+counterspace+OR+"space+weapon"+OR+"orbital+warfare"+OR+"satellite+jamming"+OR+"GPS+spoofing"+OR+"ASAT+test")+when:1y&hl=en-US&gl=US&ceid=US:en',
      source: 'Google News · Counterspace', cat: 'SSA', google: true , pin: true },
    // Pixxel publishes on a Webflow site with no feed of any kind, and its
    // LinkedIn and X accounts are not readable by a web page, so the company
    // is followed through what the press writes about it instead.
    { url: 'https://news.google.com/rss/search?q=Pixxel+(satellite+OR+hyperspectral+OR+space+OR+Firefly)+when:1y&hl=en-US&gl=US&ceid=US:en',
      source: 'Google News · Pixxel', cat: 'Press', google: true , pin: true },
    // ---- Orbital events anywhere ----------------------------------------
    { url: 'https://news.google.com/rss/search?q=satellite+(breakup+OR+"break+up"+OR+fragmentation+OR+debris+OR+collision+OR+anomaly)+when:30d&hl=en-US&gl=US&ceid=US:en',
      source: 'Google News · Orbital events', cat: 'Press', google: true },
    // ---- Space press -----------------------------------------------------
    { url: 'https://spacenews.com/feed/',                     source: 'SpaceNews',       cat: 'Press'  },
    { url: 'https://www.space.com/feeds/all',                 source: 'Space.com',       cat: 'Press'  },
    { url: 'https://www.nasaspaceflight.com/feed/',           source: 'NASASpaceflight', cat: 'Press'  },
    { url: 'https://spaceflightnow.com/feed/',                source: 'Spaceflight Now', cat: 'Press'  },
    { url: 'https://payloadspace.com/feed/',                  source: 'Payload',         cat: 'Press'  },
    { url: 'https://arstechnica.com/space/feed/',             source: 'Ars Technica',    cat: 'Press'  },
    // ---- Agencies --------------------------------------------------------
    { url: 'https://www.nasa.gov/feed/',                      source: 'NASA',            cat: 'Agency' },
    { url: 'https://www.esa.int/rssfeed/Our_Activities/Space_News', source: 'ESA',       cat: 'Agency' },
    // General-interest outlets that carried the Yaogan-50 break-up when the
    // trade press had moved on.  `topic: true` keeps only their space stories —
    // their feeds are site-wide and would otherwise bury the ticker in gadgets.
    { url: 'https://gizmodo.com/feed',                        source: 'Gizmodo',         cat: 'Press', topic: true },
    { url: 'https://futurism.com/feed',                       source: 'Futurism',        cat: 'Press', topic: true },
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
  const ROTATE_STRIDE = 7;                              // feeds the pull order advances each refresh
  const PER_FEED_MAX  = 25;                             // items ingested per feed per pull
  const TICKER_MAX    = 20;                             // ≤ ~20 headlines in the ticker
  const TICKER_WINDOW_DAYS = 31;                        // ticker only shows the last ~month
  const TICKER_EVENT_DAYS  = 120;                       // …except a break-up or a close approach
  const TICKER_EVENT_MAX   = 6;                         // …and at most this many of those may be old
  const ARCHIVE_CAP   = 900;                            // bound localStorage growth
  const DESC_MAX      = 600;                            // stored snippet length

  // China relevance — matches the country, its agencies/programmes, launch
  // sites, rocket families and the commercial-launch startups.
  const CHINA_RE = /\b(china|chinese|prc|beijing|cnsa|casc|casic|long\s*march|(?:^|\s)cz[-\s]?\d|chang[' ’]?e|tiangong|tianzhou|tianwen|shenzhou|taikonaut|shijian|yaogan|gaofen|fengyun|beidou|kuaizhou|ceres[-\s]?1|hyperbola|zhuque|gravity[-\s]?1|pallas|landspace|galactic\s+energy|orienspace|space\s+pioneer|i[-\s]?space|deep\s+blue\s+aerospace|cas\s*space|expace|guowang|qianfan|thousand\s+sails|jielong|smart\s+dragon|wenchang|jiuquan|xichang|taiyuan)\b/i;

  // Space stories inside a general-interest feed (see `topic` above).
  const SPACE_RE = /\b(space(craft|flight|x)?|satellites?|orbit(al|s|ing)?|rocket|launch(es|ed|ing)?|astronauts?|cosmonauts?|nasa|esa|isro|jaxa|roscosmos|starship|falcon\s*9|debris|iss|moon|lunar|mars|asteroid|telescope|observatory|constellation|reentry|re-entry)\b/i;

  // Rendezvous and proximity operations — one satellite closing on another,
  // whoever owns it.  Kept separate from EVENT_RE because nothing breaks: the
  // story is that something came close on purpose.
  // `rendezvous` on its own is not this subject: it caught "China Plans 'Two
  // Launches, Lunar Orbit Rendezvous' to Land Taikonauts" (mission architecture)
  // and "Rendezvous Robotics Raises $20M" (a company's name).  Paired with
  // DEFENCE_RE below, MANOEUVRE_RE still catches a real military rendezvous.
  const RPO_RE = /\b(proximity\s+operations?|rendezvous\s+(?:and|with)|co-?orbital|non-?cooperative|shadow(?:ing|ed|s|er)?|stalk(?:ing|ed|s|er)?|tailing|dogfight(?:ing|s)?|inspector\s+satellite|satellite\s+inspect(?:or|ion)|close\s+approach(?:es)?|loiter(?:ing)?|sub-?satellite|grappl(?:e|ing)|servicing\s+mission)\b/i;

  // Military space, space domain awareness and ISR.  Space-coupled on purpose:
  // jamming or targeting on the ground is not this page's business.  The named
  // series are in here because a headline often names the object and nothing
  // else — "What Kosmos 2612's Approach to ICEYE-X36 Does and Doesn't Tell Us"
  // carries no domain word at all.
  const DEFENCE_RE = /\b(space\s+(?:force|command|domain\s+awareness|surveillance|warfare|weapons?)|space[\s-]?domain|counterspace|anti-?satellite|orbital\s+warfare|military\s+satellites?|spy\s+satellites?|(?:reconnaissance|surveillance|early[\s-]warning)\s+satellites?|isr|sigint|elint|geoint|satellite\s+jamming|gps\s+(?:jamming|spoofing)|missile\s+(?:defen[cs]e|warning)|18th\s+sds|space\s+systems\s+command|ussf|nro(?:l)?[\s-]?\d*|gssap|golden\s+dome|(?:kosmos|cosmos)[\s-]?\d{3,4}|shijian[\s-]?\d+|sj-\d+|tjs[\s-]?\d+|shiyan[\s-]?\d+|yaogan[\s-]?\d+|usa[\s-]?\d{2,3}|iceye|capella|hawkeye\s*360|luch|olymp)\b/i;

  // On its own, "approach" or "manoeuvre" is any story about anything; next to
  // one of the objects DEFENCE_RE names it is this page's subject.  Without
  // this pair, "What Kosmos 2612's Approach to ICEYE-X36 Does and Doesn't Tell
  // Us" - the headline that started this - read as ordinary domain news.
  const MANOEUVRE_RE = /\b(approach(?:es|ed|ing)?|man(?:o|oe)uvr(?:e|es|ed|ing)|maneuver(?:s|ed|ing)?|intercept(?:s|ed|ing)?|inspect(?:s|ed|ing|ion)?|rendezvous(?:ed|ing)?)\b/i;

  // Notable orbital events — a breakup, collision or failure leads the ticker
  // even when newer routine items exist.  Titles only: descriptions mention
  // debris in passing far too often.
  // An event is something that HAPPENED to an object, not a word a business
  // story mentions.  The first cut matched bare `debris`, `fragments`,
  // `failure` and `reentry`, and on a live archive of 190 headlines it called
  // 16 items break-ups of which almost none were: a 6.9M funding round for a
  // reentry vehicle, a conference panel on debris, university research into
  // collision risk, a launch carrying a reentry capsule.  Those then inherited
  // the extended ticker window below and would have squatted in it for four
  // months, which is the opposite of highlighting an event.  So the nouns are
  // coupled to something happening - `debris found`, `debris cloud`,
  // `43 fragments`, `fragments tracked` - and NOT_EVENT_RE throws out the
  // money-and-plans vocabulary that survives that.
  const EVENT_RE = /\b(break[\s-]?up|breaks?\s+up|broke\s+(?:up|apart)|breaking\s+up|disintegrat(?:e|es|ed|ion)|fragmentation|fragments?\s+(?:tracked|catalogued|detected)|\d+\s+fragments?|debris\s+(?:cloud|field|from|found|discovered|recovered|fell|lands?|landed)|shed(?:s|ding)?\s+debris|collision|collides?|collided|explosion|exploded|anomaly|malfunction(?:s|ed)?|lost\s+contact|went\s+silent|re-?enter(?:s|ed|ing)|de-?orbited|fell\s+(?:to\s+earth|back)|crashed)\b/i;

  // Money, plans, panels and coursework.  A story about building the capability
  // to clear debris is not a debris event.
  const NOT_EVENT_RE = /\b(rais(?:e|es|ed|ing)\s+[€£$\d]|[€£$]\d+(?:\.\d+)?\s*(?:m|bn|million|billion)|series\s+[a-f]\b|funding|investment|investors?|valuation|acquisitions?|aims?\s+to|plans?\s+to|race\s+to|seeks?\s+to|to\s+(?:build|tackle|clean|reduce|develop|remove|prevent)|startup|speakers?|panel|summit|conference|calls?\s+for|urges?|researchers?|study|students?|guidelines?|new\s+policy)/i;

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

  function isEventItem(it) {
    const t = it.title || '';
    return EVENT_RE.test(t) && !NOT_EVENT_RE.test(t);
  }

  // The military / SSA / ISR domain — what the section on the archive page
  // collects, what the ticker promotes, and what the archive trim protects.
  // The feed's own category counts: a LeoLabs or Space Force post belongs here
  // whatever words its headline happens to use.
  function isRpoItem(it) {
    const t = it.title || '';
    return RPO_RE.test(t) || (MANOEUVRE_RE.test(t) && DEFENCE_RE.test(t));
  }
  function isDomainItem(it) {
    return it.cat === 'SSA' || isEventItem(it) || isRpoItem(it) ||
           DEFENCE_RE.test((it.title || '') + ' ' + (it.desc || ''));
  }
  // The headline kind, for the tag on the card.  Order is the order of
  // interest: something broke, something came close, everything else.
  function domainTag(it) {
    if (isEventItem(it)) return 'Break-up';
    if (isRpoItem(it)) return 'Proximity op';
    return 'Military · SSA';
  }
  // Worth keeping on the ticker long after a routine item has rotated off.
  function isMajorItem(it) { return isEventItem(it) || isRpoItem(it); }

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
    // 70, not 45: mastheads like "The Diplomat – Asia-Pacific Current Affairs
    // Magazine" and "European Union Institute for Security Studies |" ran past
    // the old limit, so the item was labelled with the feed's own name instead
    // of its publisher.  Trailing separators come off with the split.
    const i = title.lastIndexOf(' - ');
    if (i > 20 && title.length - i <= 70) {
      return { title: title.slice(0, i).trim(), source: title.slice(i + 3).replace(/[\s|·—–-]+$/, '').trim() };
    }
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
      // `let`, not `const`: a Google item rewrites this below to strip the
      // " - Publisher" suffix.  As a const it threw TypeError, and since
      // nothing caught it the whole pull was abandoned — which is why the
      // Google topic searches never contributed anything through the XML
      // proxies, and why stories they alone carried never reached the archive.
      let title = cleanText(childText(n, ['title']));
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
      // One malformed feed must never abandon the pull: pmap has no per-task
      // catch, so a parser throw here used to reject the whole refresh and
      // every other feed's items were lost with it.
      let items;
      try { items = proxy.kind === 'json' ? parseJsonFeed(txt, feed) : parseXmlFeed(txt, feed); }
      catch { items = null; }
      if (items && items.length && feed.topic) {
        // 'domain' widens the test for the ISR publications: their space
        // pieces do not always say "satellite", and their terrestrial ones
        // say nothing this matches at all.
        const re = feed.topic === 'domain' ? [SPACE_RE, DEFENCE_RE, RPO_RE] : [SPACE_RE];
        items = items.filter(it => re.some(r => r.test(it.title + ' ' + it.desc)));
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
    if (merged.length > ARCHIVE_CAP) {
      // Trimming by date alone would throw away precisely what the one-year
      // searches exist to backfill - the oldest items go first, and the oldest
      // items are the break-ups and the close approaches.  Domain items are
      // kept first and the rest fill what is left, newest first either way.
      const major = merged.filter(isDomainItem);
      const rest = merged.filter(it => !isDomainItem(it));
      merged = major.slice(0, ARCHIVE_CAP)
        .concat(rest.slice(0, Math.max(0, ARCHIVE_CAP - major.length)))
        .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    }
    saveArchive(merged);
    return merged;
  }

  // The pinned feeds, then the rest rotated so no feed is permanently last.
  function pullOrder(cursor) {
    const pinned = FEEDS.filter(f => f.pin), rest = FEEDS.filter(f => !f.pin);
    if (!rest.length) return pinned;
    const k = ((cursor || 0) % rest.length + rest.length) % rest.length;
    return pinned.concat(rest.slice(k), rest.slice(0, k));
  }

  let _refreshing = null;
  async function refresh(force) {
    const meta = getMeta();
    if (!force && meta.last && (Date.now() - meta.last) < REFRESH_TTL && getArchive().length) {
      return getArchive();
    }
    if (_refreshing) return _refreshing;
    _refreshing = (async () => {
      const cursor = meta.cursor || 0;
      const results = await pmap(pullOrder(cursor), CONCURRENCY, fetchFeed);
      const fresh = results.flat();
      const merged = mergeIntoArchive(fresh);
      setMeta({
        last: Date.now(),
        cursor: cursor + ROTATE_STRIDE,
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
  // Selection for the ticker — Chinese orbital events first (a breakup or a
  // close approach shouldn't be pushed out by routine launch items), then the
  // same events anywhere, then the rest of the China feed, then the rest of
  // the military / SSA domain, then the world, capped.
  //
  // A major event also gets a four-month window rather than the one-month one
  // everything else gets.  A launch three weeks old is not news; a satellite
  // that shadowed another one in October still is in February.
  // =======================================================================
  function getTickerItems() {
    const now = Date.now();
    const cutoff = now - TICKER_WINDOW_DAYS * 864e5;
    let older = 0;
    const recent = getArchive()
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))   // newest-first before the count
      .filter(it => {
        const t = +new Date(it.pubDate);
        if (t >= cutoff) return true;
        // Past the month, only a handful of events may hold their place - this
        // is still a ticker, and a reader opening the site should mostly see
        // what happened this week.
        return isMajorItem(it) && now - t <= TICKER_EVENT_DAYS * 864e5 && ++older <= TICKER_EVENT_MAX;
      });
    const seen = new Set();
    const take = f => recent.filter(it => !seen.has(it.id) && f(it) && seen.add(it.id));
    return take(it => isChinaItem(it) && isMajorItem(it))
      .concat(take(isMajorItem), take(isChinaItem), take(isDomainItem), take(() => true))
      .slice(0, TICKER_MAX);
  }

  return {
    FEEDS, PROXIES, pullOrder, CHINA_RE, DEFENCE_RE, RPO_RE, EVENT_RE, NOT_EVENT_RE,
    ARCHIVE_START, TICKER_MAX, TICKER_WINDOW_DAYS, TICKER_EVENT_DAYS, TICKER_EVENT_MAX,
    esc, cleanText, hostOf, fmtShort, fmtLong, fmtDayKey, fmtDayLabel,
    isChinaItem, isEventItem, isRpoItem, isDomainItem, isMajorItem, domainTag,
    refresh, getArchive, getTickerItems, getMeta,
  };
})();
