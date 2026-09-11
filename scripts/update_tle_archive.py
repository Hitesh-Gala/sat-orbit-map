#!/usr/bin/env python3
"""Never lose an object from Sat-Stats on Steroids.

Runs after each catalogue refresh (both refresh workflows).  It compares the
committed catalogue files (git HEAD) with the freshly fetched ones: any object
that was listed before but is now missing from BOTH CelesTrak and Space-Track
moves into data/tle-archive.json with its last TLE and details, and the page
shows it with TLE source "None".  An archived object that reappears in either
catalogue leaves the archive (its live row takes over again).  Nothing else is
ever removed.

Usage: update_tle_archive.py   (from the repo root, after the fetch steps)
"""
import datetime, json, subprocess, sys

ARCHIVE  = 'data/tle-archive.json'
ST_FILES = (('data/spacetrack-gp.json', 'P'), ('data/spacetrack-other.json', None))
CT_FILE  = 'data/active.tle'
MAX_DROP = 1000   # more vanishing in one run means a bad pull, not real decays

A5 = 'ABCDEFGHJKLMNPQRSTUVWXYZ'   # Alpha-5 letters (no I, O)


def head(path):
    """File content as committed at HEAD, or None."""
    r = subprocess.run(['git', 'show', f'HEAD:{path}'], capture_output=True)
    return r.stdout.decode('utf-8', 'replace') if r.returncode == 0 else None


def work(path):
    try:
        with open(path, encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return None


def catno(field):
    f = field.strip()
    return (A5.index(f[0]) + 10) * 10000 + int(f[1:]) if f[:1].isalpha() else int(f)


def epoch_key(l1):
    """Sortable epoch (year * 1000 + day-of-year) from TLE line 1."""
    try:
        yy, doy = int(l1[18:20]), float(l1[20:32])
    except ValueError:
        return 0.0
    return (2000 + yy if yy < 57 else 1900 + yy) * 1000 + doy


def catalogue(read):
    """noradId -> latest record across the Space-Track bundles + CelesTrak TLEs."""
    out = {}
    for path, typ in ST_FILES:
        txt = read(path)
        for s in (json.loads(txt).get('sats', []) if txt else []):
            out[s['c']] = {'c': s['c'], 'n': s.get('n', ''), 'y': typ or s.get('y', 'U'),
                           'o': s.get('o', ''), 'ld': s.get('ld', ''), 'ls': s.get('ls', ''),
                           's': s.get('s', ''), 't': s['t'], 'was': 'ST'}
    txt = read(CT_FILE)
    lines = txt.replace('\r', '').split('\n') if txt else []
    i = 0
    while i < len(lines) - 2:
        name, l1, l2 = lines[i].strip(), lines[i + 1].rstrip(), lines[i + 2].rstrip()
        if not (l1.startswith('1 ') and l2.startswith('2 ')):
            i += 1
            continue
        i += 3
        try:
            c = catno(l1[2:7])
        except ValueError:
            continue
        cur = out.get(c)
        if cur is None:
            out[c] = {'c': c, 'n': name, 'y': 'P', 'o': '', 'ld': '', 'ls': '', 's': '+',
                      't': [l1, l2], 'was': 'CT'}
        elif epoch_key(l1) > epoch_key(cur['t'][0]):
            cur.update(n=name, t=[l1, l2], was='CT')      # fresher TLE; keep Space-Track details
    return out


def main():
    now = catalogue(work)
    if not now:
        print('no catalogue files — nothing to do')
        return
    prev = catalogue(head)
    txt = work(ARCHIVE)
    kept = {a['c']: a for a in (json.loads(txt).get('sats', []) if txt else [])}

    back = [c for c in kept if c in now]           # listed again: the live row takes over
    for c in back:
        del kept[c]
    gone = [c for c in prev if c not in now and c not in kept]
    if len(gone) > MAX_DROP:
        print(f'warning: {len(gone):,} objects vanished at once — looks like a partial pull; '
              'not archiving this run', file=sys.stderr)
        gone = []
    today = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')
    for c in gone:
        kept[c] = dict(prev[c], gone=today)

    if txt is not None and not gone and not back:
        print(f'archive unchanged ({len(kept):,} objects)')
        return
    with open(ARCHIVE, 'w', encoding='utf-8') as f:
        json.dump({'source': 'Objects dropped from both CelesTrak and Space-Track (last TLE kept)',
                   'updated': today, 'count': len(kept),
                   'sats': sorted(kept.values(), key=lambda a: a['c'])}, f, separators=(',', ':'))
    print(f'archive: +{len(gone)} dropped, -{len(back)} back in a catalogue, {len(kept):,} kept')


if __name__ == '__main__':
    main()
