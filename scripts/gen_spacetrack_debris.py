#!/usr/bin/env python3
"""Every tracked debris object Space-Track carries, as a TLE file for the globe.

CelesTrak publishes debris GROUPs for four historic clouds only (~2.7 k
fragments), so the Debris Tracker used to show a small slice of what is
actually up there and nothing from any recent break-up.  Space-Track's
non-payload GP set — already pulled daily into data/spacetrack-other.json —
carries every catalogued fragment, so flatten the DEBRIS half of it into a
plain TLE file the page can fetch same-origin.

Rocket bodies (y == 'R') and unknown objects (y == 'U') are deliberately left
out: this page is about fragmentation debris.

Supersedes gen_event_debris.py, which lifted out one break-up at a time.

Usage: python3 scripts/gen_spacetrack_debris.py [in.json] [out.tle]
"""
import json
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'data/spacetrack-other.json'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'data/spacetrack-debris.tle'
FLOOR = 5000   # ~12.3 k today; abort on a truncated or failed upstream pull


def main():
    with open(SRC, encoding='utf-8') as f:
        payload = json.load(f)
    sats = payload['sats']

    blocks = []
    for s in sats:
        tle = s.get('t') or []
        if len(tle) != 2 or s.get('y') != 'D':
            continue
        blocks.append('%-24s\n%s\n%s' % ((s.get('n') or '')[:24], tle[0], tle[1]))

    print('%s: %d non-payloads, %d debris with TLEs (retrieved %s)'
          % (SRC, len(sats), len(blocks), payload.get('retrieved', '?')))

    # Never replace a good snapshot with a thin one: the globe would silently
    # lose most of its fragments until the next successful run.
    if len(blocks) < FLOOR:
        print('below the %d floor — keeping the existing %s' % (FLOOR, OUT))
        return

    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(blocks) + '\n')
    print('wrote %s (%d fragments)' % (OUT, len(blocks)))


if __name__ == '__main__':
    main()
