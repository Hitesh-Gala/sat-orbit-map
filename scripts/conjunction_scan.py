"""conjunction_scan.py — closest approach between two catalogued objects.

Written to answer a question the Dog-Fights animation could not: stepping the
clock by whole frames walks straight over a conjunction, because the frame
advances dt x rate of simulated time and a close pass lasts seconds.  This
scans coarsely, then refines around every local minimum, so the number it
reports does not depend on a frame rate.

    python scripts/conjunction_scan.py "ICEYE-X36" "COSMOS 2612" [days_back] [days_fwd]
    python scripts/conjunction_scan.py --history 68762 59103 2026-10-14 2026-10-20

--history reads data/tle-history.json instead of the one-set-per-object
catalogue, and at every instant propagates from each object's freshest element
set that PRECEDES that instant.  That matters more than the search does: one
element set describes one unperturbed orbit, so running the 28 October set back
through the 18 October rendezvous gives where Cosmos 2612 would have been had
it never manoeuvred - which is nowhere near where it was.  Stepping the element
set as the clock passes each epoch is the only way public data can follow a
manoeuvring object, and the discontinuities it steps over are the burns.

The caveat it prints is not boilerplate: public TLEs carry along-track error of
roughly a kilometre near epoch, growing with propagation, so a sub-kilometre
"miss distance" computed from them is below the noise floor of its own input.
"""
import io
import sys
from datetime import datetime, timedelta, timezone

from sgp4.api import Satrec, jday


def load(path):
    lines = io.open(path, encoding='utf-8', errors='replace').read().splitlines()
    out = {}
    for i in range(0, len(lines) - 2):
        if lines[i + 1].startswith('1 ') and lines[i + 2].startswith('2 '):
            out[lines[i].strip().upper()] = (lines[i + 1], lines[i + 2])
    return out


def find(cat, want):
    want = want.strip().upper()
    if want in cat:
        return want, cat[want]
    hits = [k for k in cat if want in k]
    if not hits:
        raise SystemExit('not in the catalogue: ' + want)
    return hits[0], cat[hits[0]]


def sep_km(a, b, when):
    jd, fr = jday(when.year, when.month, when.day, when.hour, when.minute,
                  when.second + when.microsecond / 1e6)
    ea, ra, va = a.sgp4(jd, fr)
    eb, rb, vb = b.sgp4(jd, fr)
    if ea or eb:
        return None
    return ((ra[0] - rb[0]) ** 2 + (ra[1] - rb[1]) ** 2 + (ra[2] - rb[2]) ** 2) ** 0.5


def refine(a, b, lo, hi, rounds=60):
    """Ternary search on a bracket that contains one minimum."""
    for _ in range(rounds):
        span = (hi - lo) / 3
        m1, m2 = lo + span, hi - span
        d1, d2 = sep_km(a, b, m1), sep_km(a, b, m2)
        if d1 is None or d2 is None:
            break
        if d1 < d2:
            hi = m2
        else:
            lo = m1
    mid = lo + (hi - lo) / 2
    return mid, sep_km(a, b, mid)


class Ephemeris:
    """Every element set for one object, each used from its own epoch onward."""

    def __init__(self, name, sets):
        self.name = name
        self.sets = sorted(sets, key=lambda e: e[0])   # (epoch, Satrec, line1)

    def at(self, when):
        """The freshest set that precedes `when` (the first one, before that)."""
        lo, hi = 0, len(self.sets) - 1
        if when <= self.sets[0][0]:
            return self.sets[0]
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if self.sets[mid][0] <= when:
                lo = mid
            else:
                hi = mid - 1
        return self.sets[lo]


def load_history(path='data/tle-history.json'):
    import json
    doc = json.load(io.open(path, encoding='utf-8'))
    out = {}
    for nid, sat in doc.get('sats', {}).items():
        sets = []
        for e in sat.get('tles', []):
            l1, l2 = e['t']
            sets.append((datetime.strptime(e['ep'][:19], '%Y-%m-%dT%H:%M:%S')
                         .replace(tzinfo=timezone.utc), Satrec.twoline2rv(l1, l2), l1))
        if sets:
            out[str(nid)] = Ephemeris(sat.get('name', nid), sets)
    return out, doc.get('retrieved', '')


def sep_eph(a, b, when):
    ea, ra, _ = _prop(a.at(when)[1], when)
    eb, rb, _ = _prop(b.at(when)[1], when)
    if ea or eb:
        return None
    return ((ra[0] - rb[0]) ** 2 + (ra[1] - rb[1]) ** 2 + (ra[2] - rb[2]) ** 2) ** 0.5


def _prop(rec, when):
    jd, fr = jday(when.year, when.month, when.day, when.hour, when.minute,
                  when.second + when.microsecond / 1e6)
    return rec.sgp4(jd, fr)


def refine_eph(a, b, lo, hi, rounds=60):
    for _ in range(rounds):
        span = (hi - lo) / 3
        m1, m2 = lo + span, hi - span
        d1, d2 = sep_eph(a, b, m1), sep_eph(a, b, m2)
        if d1 is None or d2 is None:
            break
        if d1 < d2:
            hi = m2
        else:
            lo = m1
    mid = lo + (hi - lo) / 2
    return mid, sep_eph(a, b, mid)


def history_mode(argv):
    ida, idb = argv[0], argv[1]
    t0 = datetime.strptime(argv[2], '%Y-%m-%d').replace(tzinfo=timezone.utc) \
        if len(argv) > 2 else None
    t1 = datetime.strptime(argv[3], '%Y-%m-%d').replace(tzinfo=timezone.utc) \
        if len(argv) > 3 else None

    eph, retrieved = load_history()
    for nid in (ida, idb):
        if nid not in eph:
            raise SystemExit('no history held for ' + nid + ' (have: ' +
                             ', '.join(sorted(eph)) + ')')
    A, B = eph[ida], eph[idb]
    lo = max(A.sets[0][0], B.sets[0][0])
    hi = min(A.sets[-1][0], B.sets[-1][0])
    t0, t1 = max(t0 or lo, lo), min(t1 or hi, hi)

    print('A  ' + A.name + '   ' + str(len(A.sets)) + ' element sets, ' +
          A.sets[0][0].strftime('%d %b %H:%M') + ' to ' + A.sets[-1][0].strftime('%d %b %H:%M'))
    print('B  ' + B.name + '   ' + str(len(B.sets)) + ' element sets, ' +
          B.sets[0][0].strftime('%d %b %H:%M') + ' to ' + B.sets[-1][0].strftime('%d %b %H:%M'))
    print('   history pulled from Space-Track ' + retrieved)
    print('   each instant propagated from the freshest set before it')
    print()

    step = timedelta(seconds=10)
    n = int((t1 - t0) / step)
    prev = prev2 = None
    mins = []
    worst = 0.0
    for i in range(n + 1):
        t = t0 + step * i
        d = sep_eph(A, B, t)
        if d is None:
            continue
        worst = max(worst, d)
        if prev2 is not None and prev < prev2 and prev <= d:
            mins.append((t - step, prev, t - step * 2, t))
        prev2, prev = prev, d

    print('scanned ' + t0.strftime('%Y-%m-%d %H:%M') + ' to ' + t1.strftime('%Y-%m-%d %H:%M') +
          ' at 10 s steps (' + format(n, ',') + ' samples)')
    if not mins:
        print('no local minimum in the window')
        return
    print('separation ranges from ' + format(min(m[1] for m in mins), '.3f') +
          ' km to ' + format(worst, '.1f') + ' km')
    print()
    mins.sort(key=lambda m: m[1])
    print('closest approaches, refined:')
    print('  when (UTC)             miss (km)   elements used (epoch of each)')
    seen = []
    for t, d, blo, bhi in mins[:600]:
        if any(abs((t - s).total_seconds()) < 1800 for s in seen):
            continue
        seen.append(t)
        tm, dm = refine_eph(A, B, blo, bhi)
        print('  ' + tm.strftime('%Y-%m-%d %H:%M:%S') + '    ' + format(dm, '9.3f') + '   ' +
              A.at(tm)[0].strftime('%d %b %H:%M') + ' / ' + B.at(tm)[0].strftime('%d %b %H:%M'))
        if len(seen) >= 12:
            break
    print()
    print('Caveat: these are public two-line element sets. Their along-track error is')
    print('of order a kilometre near epoch and grows with propagation, so a miss')
    print('distance below a few kilometres is inside the uncertainty of its own input.')
    print('Real conjunction assessment uses operator ephemerides, not TLEs.')


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--history':
        return history_mode(sys.argv[2:])
    name_a = sys.argv[1] if len(sys.argv) > 1 else 'ICEYE-X36'
    name_b = sys.argv[2] if len(sys.argv) > 2 else 'COSMOS 2612'
    back = float(sys.argv[3]) if len(sys.argv) > 3 else 21.0
    fwd = float(sys.argv[4]) if len(sys.argv) > 4 else 7.0

    cat = load('data/active.tle')
    ka, (a1, a2) = find(cat, name_a)
    kb, (b1, b2) = find(cat, name_b)
    A, B = Satrec.twoline2rv(a1, a2), Satrec.twoline2rv(b1, b2)

    epoch_a = datetime(2000, 1, 1, 12, tzinfo=timezone.utc) + timedelta(days=A.jdsatepoch + A.jdsatepochF - 2451545.0)
    epoch_b = datetime(2000, 1, 1, 12, tzinfo=timezone.utc) + timedelta(days=B.jdsatepoch + B.jdsatepochF - 2451545.0)
    print('A  ' + ka + '   epoch ' + epoch_a.strftime('%Y-%m-%d %H:%M') + 'Z')
    print('B  ' + kb + '   epoch ' + epoch_b.strftime('%Y-%m-%d %H:%M') + 'Z')
    print()

    now = max(epoch_a, epoch_b)
    t0, t1 = now - timedelta(days=back), now + timedelta(days=fwd)

    # 10 s is well inside the time it takes to cross a few kilometres at
    # 7.5 km/s, so no minimum can hide between samples.
    step = timedelta(seconds=10)
    n = int((t1 - t0) / step)
    prev = prev2 = None
    mins = []
    worst = 0.0
    for i in range(n + 1):
        t = t0 + step * i
        d = sep_km(A, B, t)
        if d is None:
            continue
        worst = max(worst, d)
        if prev2 is not None and prev < prev2 and prev <= d:
            mins.append((t - step, prev, t - step * 2, t))
        prev2, prev = prev, d

    mins.sort(key=lambda m: m[1])
    print('scanned ' + t0.strftime('%Y-%m-%d') + ' to ' + t1.strftime('%Y-%m-%d') +
          ' at 10 s steps (' + format(n, ',') + ' samples)')
    print('separation ranges from ' + format(min(m[1] for m in mins), '.3f') +
          ' km to ' + format(worst, '.1f') + ' km')
    print()
    print('closest approaches, refined:')
    print('  when (UTC)             miss (km)')
    seen = []
    for t, d, lo, hi in mins[:400]:
        if any(abs((t - s).total_seconds()) < 1800 for s in seen):
            continue
        seen.append(t)
        tm, dm = refine(A, B, lo, hi)
        print('  ' + tm.strftime('%Y-%m-%d %H:%M:%S') + '    ' + format(dm, '9.3f'))
        if len(seen) >= 12:
            break
    print()
    print('Caveat: these are public two-line element sets. Their along-track error is')
    print('of order a kilometre near epoch and grows with propagation, so a miss')
    print('distance below a few kilometres is inside the uncertainty of its own input.')
    print('Real conjunction assessment uses operator ephemerides, not TLEs.')


if __name__ == '__main__':
    main()
