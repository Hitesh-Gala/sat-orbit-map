#!/usr/bin/env python3
"""Give a just-launched payload its name back.

THE GAP THIS CLOSES
    Space-Track catalogues a new object within a day or two, but it enters the
    GP feed as `OBJECT A` with OBJECT_TYPE unset - no name, no owner, no launch
    site.  Everything here that shows payloads reads data/spacetrack-gp.json,
    which is built by filtering on that type, so a new satellite is invisible
    on the Mirror Globe for however long the typing takes.  NVS-03 launched on
    30 Oct 2026 and was still `OBJECT A` in the GP feed three days later.

    CelesTrak's SATCAT already knew it as `NVS-03 (IRNSS-1L)`, 2026-245A, an
    active payload.  So nothing here is inferred: an object that Space-Track
    carries as an unnamed OBJECT of unknown type, and that the SATCAT lists as
    an active payload, is moved into the payload bundle under the SATCAT's own
    name, owner, site and launch date.  The record is flagged `prov: 1` and the
    page says where the name came from, because Space-Track has not published
    it and a reader should be able to tell the two sources apart.

    It expires by itself.  Once Space-Track names and types the object, it
    arrives in the GP bundle on its own and this script finds nothing to do.

Usage: promote_new_launches.py   (from the repo root, after the Space-Track fetch)
"""
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GP = os.path.join(ROOT, 'data', 'spacetrack-gp.json')
OTHER = os.path.join(ROOT, 'data', 'spacetrack-other.json')
SATCAT = os.path.join(ROOT, 'data', 'satcat-active.json')

# Space-Track's placeholder names. TBA shows up too, and a blank name is the
# same thing said differently.
UNNAMED = re.compile(r'^\s*(object\s+[a-z0-9]+|tba[ -]*.*|unknown)?\s*$', re.I)
MAX_PROMOTE = 400    # ~1% of the catalogue; past that something has gone wrong

# 646 objects are unnamed in Space-Track's feed and typed PAY by the SATCAT,
# but for most of them the SATCAT has no name either - it says `OBJECT G`, or
# `QIANFAN 16 OBJECT A` / `TRANSPORTER-18 OBJECT P`, which names the launch and
# not the satellite. Those stay out: this promotes an object only when we can
# say what it is, which leaves 204.
def unidentified(name):
    return bool(UNNAMED.match(name or '')) or 'OBJECT' in (name or '').upper()


GM = 398600.4418
R_EARTH = 6378.137


def load(path, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return default


def num(v):
    try:
        return round(float(v), 1)
    except (TypeError, ValueError):
        return None


def from_tle(l2):
    """Apogee / perigee altitude in km, for when the SATCAT leaves them blank.

    A blank apogee would otherwise read as zero and file a GEO satellite under
    LEO, which is worse than not showing it at all.
    """
    try:
        e = float('0.' + l2[26:33].strip())
        n = float(l2[52:63])                       # revolutions per day
        a = (GM / (n * 2 * math.pi / 86400) ** 2) ** (1 / 3)
    except (ValueError, ZeroDivisionError):
        return None, None
    return round(a * (1 + e) - R_EARTH, 1), round(a * (1 - e) - R_EARTH, 1)


def main():
    gp = load(GP)
    other = load(OTHER)
    satcat = load(SATCAT, [])
    if not gp or not other or not satcat:
        print('missing one of the catalogue files — nothing to do')
        return

    known = {int(s['c']) for s in gp.get('sats', [])}
    named = {int(r['c']): r for r in satcat if r.get('c')}

    keep, promoted = [], []
    for s in other.get('sats', []):
        row = named.get(int(s['c']))
        if (int(s['c']) in known or not row
                or not UNNAMED.match(s.get('n') or '')     # Space-Track named it
                or unidentified(row.get('n'))):            # the SATCAT cannot either
            keep.append(s)
            continue
        t = s.get('t') or []
        if len(t) != 2:
            keep.append(s)
            continue
        ap, pe = num(row.get('a')), num(row.get('pe'))
        if ap is None or pe is None:
            ap, pe = from_tle(t[1])
        promoted.append({
            'c': int(s['c']),
            'n': row.get('n') or s.get('n'),
            'o': row.get('o') or s.get('o', ''),
            'ld': row.get('ld') or s.get('ld', ''),
            'ap': ap,
            'pe': pe,
            'inc': row.get('inc') or '',
            'ls': row.get('ls') or s.get('ls', ''),
            's': '',                       # the trimmed SATCAT carries no ops status
            't': t,
            'prov': 1,                     # named by the SATCAT, not by Space-Track
            'intl': row.get('i') or '',
        })

    if not promoted:
        print('nothing to promote — every catalogued payload is already named')
        return
    if len(promoted) > MAX_PROMOTE:
        print(f'FATAL: {len(promoted)} objects would be promoted (cap {MAX_PROMOTE}) — '
              'that looks like a bad pull, not a launch', file=sys.stderr)
        sys.exit(1)

    for p in promoted:
        print(f"  {p['c']}  {p['n']}  ({p['intl']}, {p['o']}, launched {p['ld']})")

    gp['sats'] = sorted(gp['sats'] + promoted, key=lambda s: s['c'])
    gp['count'] = len(gp['sats'])
    gp['provisional'] = len(promoted)
    other['sats'] = keep
    other['count'] = len(keep)

    with open(GP, 'w', encoding='utf-8') as f:
        json.dump(gp, f, separators=(',', ':'))
    with open(OTHER, 'w', encoding='utf-8') as f:
        json.dump(other, f, separators=(',', ':'))
    print(f"promoted {len(promoted)} newly catalogued payload(s); "
          f"gp {gp['count']:,}, other {other['count']:,}")


if __name__ == '__main__':
    main()
