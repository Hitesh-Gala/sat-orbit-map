#!/usr/bin/env python3
"""Fetch the Google News topic searches server-side and write data/news-prefetch.json.

Why this exists
---------------
The browser cannot read news.google.com directly (no CORS headers), so
news-core.js sends every feed through a chain of free public CORS proxies.
That chain cannot serve these particular feeds:

  * allorigins and codetabs are Cloudflare-fronted and answered **HTTP 522 for
    every news.google.com URL** - long query or short, checked both ways on
    03 Nov 2026.
  * rss2json answers 429 "You are converting new feeds in a very short period"
    for any URL it has not already cached, and the whole point of these
    searches is that they are new.
  * api.cors.lol does serve them (HTTP 200, 46 items, 0.57 s) but rate-limits
    to about one request before returning 429, so it cannot carry 35 feeds.

The consequence was precisely the bug this was meant to fix: the USA 32 and
Yaogan-50 fragmentations stayed missing from the archive even after searches
written to find them were added and pinned to the front of the pull.

From a GitHub Action there is no CORS and no proxy - curl gets HTTP 200 in
half a second - so the searches are run here, on a schedule, and committed as
a static same-origin JSON file that the page reads without a proxy at all.
This is the same shape as every other generator in this directory: fetch,
regenerate a file under data/, commit if changed.

Usage:  python3 scripts/gen_news_prefetch.py data/news-prefetch.json
"""

import json
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

UA = 'Mozilla/5.0 (compatible; NAZAR/1.0; +https://hitesh-gala.github.io/sat-orbit-map/)'
TIMEOUT = 25
DESC_MAX = 400
PER_FEED_MAX = 40
# Google News search only ever returns the newest ~100 hits for a query, so a
# wider window costs nothing and a narrower one loses the events.
WINDOW = 'when:1y'

# Mirrors the SSA/Press searches in news-core.js.  Keep the two in step: these
# run server-side, the ones there are what a browser would try if this file
# were ever missing.
SEARCHES = [
    ('Proximity operations', 'SSA',
     '(satellite OR spacecraft) ("proximity operations" OR "rendezvous and proximity" '
     'OR co-orbital OR shadowing OR stalked OR "close approach" OR dogfighting '
     'OR "inspector satellite")'),
    ('Shadowing & inspection', 'SSA',
     '(shijian OR "TJS" OR shiyan OR yaogan OR luch OR olymp OR kosmos OR cosmos) '
     'satellite (maneuver OR manoeuvre OR approach OR inspect OR shadow OR rendezvous OR geo)'),
    # The subject group has to name the object families as well as the word
    # "satellite": "Yaogan-50 02 breaks up in low Earth orbit, 43 fragments
    # tracked" contains neither "satellite" nor "rocket body", so the first
    # version of this query returned nothing for the one break-up it was
    # written to catch.
    ('Break-ups & collisions', 'SSA',
     '(satellite OR "rocket body" OR spacecraft OR yaogan OR shijian OR kosmos OR cosmos '
     'OR "long march" OR starlink OR "USA 32" OR rocket) '
     '(breakup OR "break up" OR "breaks up" OR "broke apart" OR "breaks apart" '
     'OR fragmentation OR fragments OR "debris cloud" OR collision OR shatters)'),
    ('Counterspace', 'SSA',
     '("anti-satellite" OR counterspace OR "space weapon" OR "orbital warfare" '
     'OR "satellite jamming" OR "GPS spoofing" OR "ASAT test")'),
    # Pixxel has no feed of any kind - Webflow site, and LinkedIn and X expose
    # nothing a page may read - so a search on the name is the only way to
    # follow it.  Integrity ISR is NOT here: it has a real WordPress feed and
    # news-core.js subscribes to it directly.
    ('Pixxel', 'Press',
     'Pixxel (satellite OR hyperspectral OR space OR Firefly)'),
]


def search_url(query):
    from urllib.parse import quote
    q = quote(query + ' ' + WINDOW, safe='')
    return ('https://news.google.com/rss/search?q=' + q +
            '&hl=en-US&gl=US&ceid=US:en')


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read()


def clean(t):
    t = re.sub(r'<[^>]*>', ' ', t or '')
    t = (t.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<')
          .replace('&gt;', '>').replace('&quot;', '"').replace('&#39;', "'"))
    return re.sub(r'\s+', ' ', t).strip()


def split_title(title, publisher):
    """Google writes "Headline - Publisher".  <source> is authoritative when it
    is there; otherwise fall back to splitting on the last dash, with the same
    70-character publisher ceiling news-core.js uses (long mastheads like
    "The Diplomat - Asia-Pacific Current Affairs Magazine" were failing a
    shorter one and showing the feed's own name as the source)."""
    if publisher:
        suffix = ' - ' + publisher
        if title.endswith(suffix):
            title = title[:-len(suffix)]
        return title.strip(), publisher
    i = title.rfind(' - ')
    if i > 0 and len(title) - i - 3 <= 70:
        return title[:i].strip(), title[i + 3:].strip()
    return title.strip(), ''


def iso(raw):
    if not raw:
        return None
    try:
        d = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    if d is None:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


# Google matches the whole article, not the headline, so a search for
# "breaks up" returned "Ukraine's security service breaks up two schemes".
# Every item in this file is written out as cat SSA or Press, which the page
# treats as its own domain, so a non-space hit must never get in here.
SPACE_RE = re.compile(
    r'\b(satellite|satellites|spacecraft|orbit|orbital|in-orbit|on-orbit|launch|launched|'
    r'rocket|booster|space|debris|fragment|fragments|constellation|payload|'
    r'nasa|esa|isro|jaxa|roscosmos|spacex|starlink|cnsa|norad|space-?track|celestrak|'
    r'leo|geo|meo|sso|geostationary|reconnaissance|counterspace|asat|'
    r'yaogan|shijian|kosmos|cosmos|iceye|capella|pixxel|guowang|qianfan|tiangong|shenzhou)\b',
    re.I)


def parse(xml, label, cat):
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as e:
        print('  ! parse error: %s' % e)
        return []
    out = []
    for n in root.iter('item'):
        title = clean(n.findtext('title'))
        link = (n.findtext('link') or '').strip()
        src = n.find('source')
        title, publisher = split_title(title, clean(src.text) if src is not None else '')
        # Same two guards as makeItem() in news-core.js: a real absolute URL,
        # and never a one- or two-word "headline".
        if not title or not re.match(r'^https?://', link):
            continue
        if len(title.split()) < 3:
            continue
        desc = clean(n.findtext('description'))[:DESC_MAX]
        if not SPACE_RE.search(title) and not SPACE_RE.search(desc):
            continue
        out.append({
            'title': title,
            'link': link,
            'pubDate': iso(n.findtext('pubDate')),
            'desc': desc,
            'source': publisher or ('Google News · ' + label),
            'cat': cat,
            'via': label,
        })
        if len(out) >= PER_FEED_MAX:
            break
    return out


def main():
    dest = sys.argv[1] if len(sys.argv) > 1 else 'data/news-prefetch.json'
    items, seen, ok = [], set(), 0

    for label, cat, query in SEARCHES:
        url = search_url(query)
        try:
            raw = fetch(url)
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            print('  ! %-24s %s' % (label, e))
            continue
        got = parse(raw, label, cat)
        ok += 1 if got else 0
        fresh = 0
        for it in got:
            key = re.sub(r'[^a-z0-9]+', '', it['title'].lower())[:90]
            if key in seen:
                continue
            seen.add(key)
            items.append(it)
            fresh += 1
        print('  %-24s %3d items, %3d new' % (label, len(got), fresh))

    if ok == 0:
        # Never overwrite a good file with nothing: the archive in a visitor's
        # browser is cumulative, but this file is the only copy of what these
        # searches found.
        print('no search answered - leaving %s untouched' % dest)
        return 1

    items.sort(key=lambda it: it['pubDate'] or '', reverse=True)
    payload = {
        'generated': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'window': WINDOW,
        'searches': ok,
        'items': items,
    }
    with open(dest, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write('\n')
    print('%s: %d items from %d/%d searches' % (dest, len(items), ok, len(SEARCHES)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
