#!/usr/bin/env python3
"""Keep each watched object's last 20 element sets — data/tle-vault.json.

WHAT THIS IS FOR
    Everything else in data/ holds the *newest* element set and throws the
    previous one away: spacetrack-gp.json, active.tle, tle-compare.json all
    carry one TLE per object.  So there was no way to see how an object's
    elements moved, or to propagate from a set that predates a manoeuvre —
    which is exactly what the Cosmos 2612 / ICEYE-X36 rendezvous needed and
    could not have.  This file is the rolling store that fixes that, and the
    TLE Vault page renders it.

HOW IT FILLS
    The daily append costs **no Space-Track queries at all**: the workflow has
    already pulled data/spacetrack-gp.json and data/spacetrack-other.json, so
    this reads those files and appends whatever element set is new, stamped
    with that bundle's own `retrieved` time — which is the moment NAZAR
    obtained it.  A newly watched object therefore starts with one set and
    fills to twenty over about three weeks, exactly as it accretes.

    `--backfill N` is the shortcut for the impatient: gp_history is
    Space-Track's heaviest class, so it pulls the newest 20 for at most N
    objects per run, choosing the thinnest first, and sleeps between queries.
    Those rows are flagged `h: 1` — we did not obtain them one a day at the
    stamped time, we obtained them all in one backfill, and the page says so
    rather than implying a daily capture that never happened.

WHY OLDEST-FIRST
    Each object's sets are stored oldest-first and appended to.  Newest-first
    would shift every array on every run, so git would store a fresh ~1.7 MB
    blob a day with no delta to find; appending leaves yesterday's bytes where
    they were.  The page reverses for display.

Usage
    update_tle_vault.py                 # daily append from the local bundles
    update_tle_vault.py --backfill 12   # plus gp_history for 12 thin objects
"""
import datetime
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VAULT = os.path.join(ROOT, 'data', 'tle-vault.json')
WATCHFILE = os.path.join(ROOT, 'data', 'tle-vault-watch.json')
COMPARE = os.path.join(ROOT, 'data', 'tle-compare.json')
BUNDLES = ('data/spacetrack-gp.json', 'data/spacetrack-other.json')

KEEP = 20            # element sets held per object — what the page shows
MAX_WATCH = 600      # a watch list past this would outgrow a static repo
MAX_BYTES = 6_000_000
BASE = 'https://www.space-track.org'

# ---------------------------------------------------------------- elements

def epoch_of(l1):
    """TLE line 1 epoch as an ISO string, or '' if the field is malformed."""
    try:
        yy, doy = int(l1[18:20]), float(l1[20:32])
    except ValueError:
        return ''
    year = 2000 + yy if yy < 57 else 1900 + yy
    when = datetime.datetime(year, 1, 1) + datetime.timedelta(days=doy - 1)
    return when.strftime('%Y-%m-%dT%H:%M:%S')


# ------------------------------------------------------------------ inputs

def load(path, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return default


def watch_ids():
    """NORAD ids to hold history for: the ISR/ELINT comparison list, plus extras.

    data/tle-compare.json is the site's existing reconnaissance watch list (it
    is rebuilt one step earlier in the same workflow), so the vault follows it
    rather than keeping a second copy of those regexes.  data/tle-vault-watch.json
    is the hand-edited file: add `{"c": <norad>, "why": "..."}` to it and the
    object starts accreting on the next run.
    """
    ids, why = {}, {}
    for row in (load(COMPARE, {}) or {}).get('rows', []):
        if row.get('norad'):
            ids[int(row['norad'])] = row.get('name') or ''
            why[int(row['norad'])] = 'ISR/ELINT comparison list'
    for e in (load(WATCHFILE, {}) or {}).get('watch', []):
        if e.get('c'):
            ids.setdefault(int(e['c']), e.get('n') or '')
            why[int(e['c'])] = e.get('why') or 'hand-added'
    return ids, why


def latest_from_bundles():
    """norad -> (name, owner, type, [l1, l2], retrieved) from the local bundles."""
    out = {}
    for path in BUNDLES:
        doc = load(os.path.join(ROOT, path), {}) or {}
        got = doc.get('retrieved') or ''
        for s in doc.get('sats', []):
            t = s.get('t') or []
            if len(t) == 2 and t[0].startswith('1 '):
                out[int(s['c'])] = (s.get('n', ''), s.get('o', ''), s.get('y', 'P'), t, got)
    return out


# -------------------------------------------------------------- Space-Track
# A minimal client of its own: fetch_spacetrack.py logs in at import time, so
# it cannot be imported, and the backfill runs as its own workflow step.

def spacetrack():
    user = os.environ.get('SPACETRACK_USER', '').strip()
    pw = os.environ.get('SPACETRACK_PASSWORD', '')
    if not user or not pw:
        return None
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
    op.addheaders = [('User-Agent', 'NAZAR/1.0 (github.com/Hitesh-Gala/sat-orbit-map)')]
    body = urllib.parse.urlencode({'identity': user, 'password': pw}).encode()
    with op.open(BASE + '/ajaxauth/login', body, timeout=60) as r:
        txt = r.read().decode('utf-8', 'replace')
    if r.status != 200 or 'Failed' in txt:
        print('Space-Track login failed — skipping backfill', file=sys.stderr)
        return None
    return op


def query(op, path, tries=2):
    for a in range(tries):
        try:
            with op.open(BASE + path, timeout=180) as r:
                return json.loads(r.read().decode('utf-8', 'replace') or '[]')
        except Exception as e:
            print(f'  query attempt {a + 1} failed: {e}', file=sys.stderr)
            time.sleep(20)
    return []


# ------------------------------------------------------------------- store

def stamp_index(doc, when):
    """Index of `when` in the shared stamp table, appending if it is new.

    Every set appended in one run shares a retrieval time, so they are held
    once and referenced by index.  That is ~11% of the file, and it keeps the
    run that obtained a set visible as one thing rather than repeated text.
    """
    stamps = doc['stamps']
    if when not in doc['_sx']:
        doc['_sx'][when] = len(stamps)
        stamps.append(when)
    return doc['_sx'][when]


def open_vault():
    doc = load(VAULT) or {}
    doc.setdefault('stamps', [])
    sats = {int(s['c']): s for s in doc.get('sats', [])}
    doc['_sx'] = {w: i for i, w in enumerate(doc['stamps'])}
    return doc, sats


def add_set(doc, sat, lines, when, hist=False):
    """Append an element set if it is not already held.  True if it was added."""
    ep = epoch_of(lines[0])
    held = sat.setdefault('t', [])
    if any(s['e'] == ep and s['l'] == lines for s in held):
        return False
    entry = {'r': stamp_index(doc, when), 'e': ep, 'l': [lines[0].rstrip(), lines[1].rstrip()]}
    if hist:
        entry['h'] = 1
    held.append(entry)
    held.sort(key=lambda s: s['e'])          # oldest-first; see the docstring
    del held[:-KEEP]
    return True


def write(doc, sats):
    doc.pop('_sx', None)
    rows = sorted(sats.values(), key=lambda s: s['c'])
    doc.update({
        'source': 'Space-Track.org — NAZAR rolling store of each watched '
                  f'object\'s {KEEP} most recent element sets',
        'updated': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'),
        'keep': KEEP,
        'count': len(rows),
        'sets': sum(len(s['t']) for s in rows),
        'sats': rows,
    })
    blob = json.dumps(doc, separators=(',', ':'))
    if len(blob) > MAX_BYTES:
        print(f'FATAL: vault would be {len(blob):,} bytes (cap {MAX_BYTES:,}) — '
              'trim the watch list or KEEP', file=sys.stderr)
        sys.exit(1)
    with open(VAULT, 'w', encoding='utf-8') as f:
        f.write(blob)
    print(f"vault: {doc['count']:,} objects, {doc['sets']:,} element sets, "
          f'{len(blob):,} bytes')


# -------------------------------------------------------------------- main

def main():
    args = sys.argv[1:]
    backfill = 0
    if '--backfill' in args:
        i = args.index('--backfill')
        backfill = int(args[i + 1]) if len(args) > i + 1 and args[i + 1].isdigit() else 12

    ids, why = watch_ids()
    if not ids:
        print('no watch list — nothing to do (data/tle-compare.json missing?)')
        return
    if len(ids) > MAX_WATCH:
        print(f'FATAL: watch list is {len(ids)} objects (cap {MAX_WATCH})', file=sys.stderr)
        sys.exit(1)

    doc, sats = open_vault()
    live = latest_from_bundles()
    added = 0
    for c in sorted(ids):
        row = live.get(c)
        sat = sats.get(c)
        if sat is None:
            name = (row[0] if row else '') or ids[c]
            sat = sats[c] = {'c': c, 'n': name, 'o': (row[1] if row else ''),
                             'y': (row[2] if row else 'P'), 'w': why.get(c, ''), 't': []}
        elif row:
            sat.update(n=row[0] or sat['n'], o=row[1] or sat.get('o', ''))
        sat['w'] = why.get(c, sat.get('w', ''))
        if row and add_set(doc, sat, row[3], row[4]):
            added += 1
    print(f'daily append: {added} new element sets from the local bundles')

    # Objects dropped from the watch list keep what they have, but stop growing.
    for c, sat in sats.items():
        if c in ids:
            sat.pop('off', None)
        else:
            sat['off'] = 1

    if backfill:
        op = spacetrack()
        if op:
            thin = sorted((s for s in sats.values()
                           if len(s['t']) < KEEP and not s.get('off')),
                          key=lambda s: len(s['t']))[:backfill]
            now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%MZ')
            got = 0
            try:
                for sat in thin:
                    rows = query(op, '/basicspacedata/query/class/gp_history/NORAD_CAT_ID/'
                                 f"{sat['c']}/orderby/EPOCH%20desc/limit/{KEEP}/format/json")
                    for g in rows:
                        l1, l2 = g.get('TLE_LINE1'), g.get('TLE_LINE2')
                        if l1 and l2 and add_set(doc, sat, [l1, l2], now, hist=True):
                            got += 1
                    print(f"  gp_history {sat['c']} {sat['n']}: {len(rows)} rows")
                    time.sleep(3)
            finally:
                try:
                    op.open(BASE + '/ajaxauth/logout', timeout=30).read()
                except Exception:
                    pass
            print(f'backfill: {got} element sets over {len(thin)} objects')

    write(doc, sats)


if __name__ == '__main__':
    main()
