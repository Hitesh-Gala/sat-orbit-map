#!/usr/bin/env python3
"""Fragments from break-ups CelesTrak publishes no debris GROUP for.

CelesTrak keeps dedicated debris groups only for the four historic clouds
(Fengyun-1C, Cosmos 2251, Iridium 33, Cosmos 1408), so a fresh break-up never
reaches the Debris Tracker no matter how well it is tracked.  Space-Track does
carry the fragments — they already arrive in data/spacetrack-other.json with
the daily non-payload pull — so lift the ones belonging to the launches listed
below into a small TLE file the globe loads alongside the CelesTrak groups.

Keyed by the TLE's launch designator (line 1, cols 10-14: 2-digit launch year +
launch number), which is exactly how debris.js tags a fragment to its event.

Usage: python3 scripts/gen_event_debris.py [in.json] [out.tle]
"""
import json
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'data/spacetrack-other.json'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'data/event-debris.tle'

EVENTS = {
    '26051': 'Yaogan-50 (02) — broke up 4 Sep 2026 in a ~950 km, 142° retrograde orbit',
}


def main():
    with open(SRC, encoding='utf-8') as f:
        sats = json.load(f)['sats']

    blocks, counts = [], {k: 0 for k in EVENTS}
    for s in sats:
        tle = s.get('t') or []
        if len(tle) != 2 or s.get('y') != 'D':      # debris only
            continue
        key = tle[0][9:14]
        if key not in EVENTS:
            continue
        blocks.append('%-24s\n%s\n%s' % ((s.get('n') or '')[:24], tle[0], tle[1]))
        counts[key] += 1

    for key, name in EVENTS.items():
        print('%s: %d fragments — %s' % (key, counts[key], name))

    # Never replace a good snapshot with an empty one: a truncated or failed
    # Space-Track pull upstream would otherwise wipe the event off the globe.
    if not blocks:
        print('no fragments found — keeping the existing %s' % OUT)
        return

    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(blocks) + '\n')
    print('wrote %s (%d fragments)' % (OUT, len(blocks)))


if __name__ == '__main__':
    main()
