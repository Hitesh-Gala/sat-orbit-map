#!/usr/bin/env python3
"""Summarize the bundled CelesTrak snapshots for the Data-Comparison page.

No network — reads what the CelesTrak refresh workflow already committed
(data/satcat-active.json, data/active.tle, data/conjunctions.json) and writes a
small data/celestrak-summary.json with counts and data-currency timestamps.

Run standalone, or as a step in refresh-data.yml right after the snapshots are
refreshed so the "as of" stamp is accurate.

Usage: gen_datacompare.py [out.json]
"""
import json, sys, os, datetime

OUT = sys.argv[1] if len(sys.argv) > 1 else 'data/celestrak-summary.json'


def tle_epoch_to_dt(l1):
    """TLE line-1 epoch (cols 19-32, YYDDD.dddddd) -> UTC datetime."""
    try:
        yy = int(l1[18:20]); frac = float(l1[20:32])
        year = 2000 + yy if yy < 57 else 1900 + yy
        return datetime.datetime(year, 1, 1) + datetime.timedelta(days=frac - 1)
    except Exception:
        return None


now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0, tzinfo=None)
sm = {'source': 'CelesTrak', 'retrieved': now.strftime('%Y-%m-%dT%H:%M:%SZ')}

# ---- SATCAT (active payloads bundle) ------------------------------------
try:
    sc = json.load(open('data/satcat-active.json', encoding='utf-8'))
    owners = {}
    for x in sc:
        owners[x.get('o', '?')] = owners.get(x.get('o', '?'), 0) + 1
    sm['satcat'] = {
        'label': 'Active payloads',
        'count': len(sc),
        'topOwners': sorted(owners.items(), key=lambda kv: -kv[1])[:5],
        'note': 'Active payloads only (CelesTrak /pub/satcat.csv, decay-filtered).',
    }
except Exception as e:
    sm['satcat'] = {'error': str(e)}

# ---- TLEs / GP (active.tle) ---------------------------------------------
try:
    lines = open('data/active.tle', encoding='utf-8', errors='replace').read().splitlines()
    n, latest, oldest = 0, None, None
    i = 0
    while i + 2 < len(lines):
        if lines[i + 1].startswith('1 ') and lines[i + 2].startswith('2 '):
            n += 1
            dt = tle_epoch_to_dt(lines[i + 1])
            if dt:
                latest = dt if not latest or dt > latest else latest
                oldest = dt if not oldest or dt < oldest else oldest
            i += 3
        else:
            i += 1
    sm['tle'] = {
        'label': 'Active TLE sets',
        'count': n,
        'latestEpoch': latest.strftime('%Y-%m-%dT%H:%M:%SZ') if latest else None,
        'oldestEpoch': oldest.strftime('%Y-%m-%dT%H:%M:%SZ') if oldest else None,
        'note': 'GROUP=active TLE catalogue (gp.php).',
    }
except Exception as e:
    sm['tle'] = {'error': str(e)}

# ---- Conjunctions (SOCRATES bundle) -------------------------------------
try:
    cj = json.load(open('data/conjunctions.json', encoding='utf-8'))
    sm['conjunctions'] = {
        'label': 'SOCRATES close approaches',
        'count': len(cj.get('conjunctions', [])),
        'window': cj.get('window'),
        'generated': cj.get('generated'),
        'note': 'Top pairs by max collision probability (SOCRATES).',
    }
except Exception as e:
    sm['conjunctions'] = {'error': str(e)}

os.makedirs('data', exist_ok=True)
json.dump(sm, open(OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print('wrote', OUT, '->', json.dumps(sm)[:200])
