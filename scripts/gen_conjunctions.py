#!/usr/bin/env python3
"""Regenerate data/conjunctions.json from CelesTrak SOCRATES.

Run by .github/workflows/refresh-conjunctions.yml every couple of days (the
predictions are valid for ~1 week, so a 2-day cadence keeps them fresh).

Reads a SOCRATES CSV (downloaded by the workflow), picks the top distinct
close-approach pairs by max collision probability, attaches each object's TLE
(from data/active.tle, else gp.php) and owner country (from
data/satcat-active.json), and writes the compact JSON the Traffic-Conjunctions
page consumes.  Aborts without overwriting if too few usable pairs survive, so a
bad fetch never clobbers a good bundle.

Usage: gen_conjunctions.py <socrates.csv> [out.json]
"""
import csv, io, json, re, sys, time, urllib.request, datetime

CSV = sys.argv[1] if len(sys.argv) > 1 else '/tmp/socrates.csv'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'data/conjunctions.json'
ACTIVE_TLE = 'data/active.tle'
SATCAT = 'data/satcat-active.json'
WANT = 10          # target number of conjunctions in the output
MIN_OK = 4         # abort (keep old file) if fewer than this survive

OWNER_NAME = {'US': 'United States', 'PRC': 'China', 'CIS': 'Russia', 'JPN': 'Japan',
              'IND': 'India', 'ESA': 'ESA', 'FR': 'France', 'UK': 'United Kingdom',
              'GER': 'Germany', 'IT': 'Italy', 'SKOR': 'South Korea', 'TBD': 'Unknown'}


def log(*a):
    print(*a, file=sys.stderr)


def find_col(headers, *needle_groups):
    """Return the first header index whose upper-cased text contains ALL of the
    substrings in any one needle_group (groups tried in order)."""
    up = [h.upper().strip() for h in headers]
    for group in needle_groups:
        for i, h in enumerate(up):
            if all(n in h for n in group):
                return i
    return -1


def parse_tca(s):
    s = s.strip().strip('"')
    s = re.sub(r'\.\d+$', '', s)                      # drop fractional seconds
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y %b %d %H:%M:%S', '%Y-%m-%dT%H:%M:%S',
                '%Y/%m/%d %H:%M:%S', '%b %d, %Y %H:%M:%S', '%d %b %Y %H:%M:%S'):
        try:
            return datetime.datetime.strptime(s, fmt).strftime('%Y-%m-%dT%H:%M:%SZ')
        except ValueError:
            pass
    return s                                          # last resort: leave as-is


# ---- read SOCRATES CSV ---------------------------------------------------
raw = open(CSV, encoding='utf-8', errors='replace').read()
rows = [r for r in csv.reader(io.StringIO(raw)) if any(c.strip() for c in r)]
if not rows:
    log('FATAL: empty SOCRATES CSV'); sys.exit(1)

hi = 0
for i, r in enumerate(rows[:6]):
    j = ' '.join(r).upper()
    if 'NORAD' in j or ('TCA' in j and 'PROB' in j):
        hi = i; break
headers = rows[hi]
data = rows[hi + 1:]
log('SOCRATES header:', headers)

# Documented SOCRATES columns:
# NORAD_CAT_ID_1, OBJECT_NAME_1, DSE_1, NORAD_CAT_ID_2, OBJECT_NAME_2, DSE_2,
# TCA, TCA_RANGE (km), TCA_RELATIVE_SPEED (km/s), MAX_PROB, DILUTION
c_id1 = find_col(headers, ['NORAD_CAT_ID_1'], ['NORAD', '1'], ['SAT1'])
c_id2 = find_col(headers, ['NORAD_CAT_ID_2'], ['NORAD', '2'], ['SAT2'])
c_nm1 = find_col(headers, ['OBJECT_NAME_1'], ['NAME', '1'])
c_nm2 = find_col(headers, ['OBJECT_NAME_2'], ['NAME', '2'])
c_tca = next((i for i, h in enumerate(headers) if h.upper().strip() == 'TCA'), find_col(headers, ['TCA']))
c_rng = find_col(headers, ['TCA_RANGE'], ['MIN', 'RANGE'], ['RANGE'])
c_prob = find_col(headers, ['MAX_PROB'], ['PROB'])
c_vel = find_col(headers, ['TCA_RELATIVE_SPEED'], ['RELSPEED'], ['SPEED'])

need = {'id1': c_id1, 'id2': c_id2, 'tca': c_tca, 'rng': c_rng, 'prob': c_prob, 'vel': c_vel}
log('column map:', need)
if min(need.values()) < 0:
    log('FATAL: could not map required SOCRATES columns from header'); sys.exit(1)


def cell(r, i):
    return r[i].strip().strip('"') if 0 <= i < len(r) else ''


def fnum(s):
    try:
        return float(re.sub(r'[^0-9eE.+-]', '', s) or 0)
    except ValueError:
        return 0.0


# ---- dedupe to distinct pairs, highest probability first -----------------
best, order = {}, []
for r in data:
    try:
        id1 = int(re.sub(r'\D', '', cell(r, c_id1)))
        id2 = int(re.sub(r'\D', '', cell(r, c_id2)))
    except ValueError:
        continue
    if not id1 or not id2:
        continue
    rng_km, vel, prob = fnum(cell(r, c_rng)), fnum(cell(r, c_vel)), fnum(cell(r, c_prob))
    if rng_km <= 0 and vel <= 0:                       # skip degenerate co-orbit dupes
        continue
    key = frozenset((id1, id2))
    rec = {'id1': id1, 'id2': id2, 'nm1': cell(r, c_nm1), 'nm2': cell(r, c_nm2),
           'tca': parse_tca(cell(r, c_tca)), 'missM': round(rng_km * 1000),
           'prob': prob, 'vel': round(vel, 3)}
    if key not in best:
        order.append(key); best[key] = rec
    elif prob > best[key]['prob']:
        best[key] = rec

pairs = [best[k] for k in order]
pairs.sort(key=lambda x: (-x['prob'], x['missM'] or 1e9))
log(f'{len(pairs)} distinct pairs parsed')

# ---- TLE index (active.tle) + gp.php fallback ----------------------------
tle = {}
try:
    L = open(ACTIVE_TLE, encoding='utf-8', errors='replace').read().splitlines()
    i = 0
    while i + 2 < len(L):
        if L[i + 1].startswith('1 ') and L[i + 2].startswith('2 '):
            tle[L[i + 1][2:7].strip()] = (L[i].strip(), L[i + 1].rstrip(), L[i + 2].rstrip())
            i += 3
        else:
            i += 1
except FileNotFoundError:
    log('warning: no', ACTIVE_TLE)


def fetch_tle(nid):
    nid = str(nid)
    if nid in tle:
        return tle[nid]
    url = f'https://celestrak.org/NORAD/elements/gp.php?CATNR={nid}&FORMAT=TLE'
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=25) as resp:
                t = resp.read().decode('utf-8', 'replace').strip().splitlines()
            if len(t) >= 3 and t[1].startswith('1 ') and t[2].startswith('2 '):
                tle[nid] = (t[0].strip(), t[1].rstrip(), t[2].rstrip())
                time.sleep(1.5)
                return tle[nid]
        except Exception as e:
            log(f'  gp.php {nid} attempt {attempt + 1}: {e}')
        time.sleep(3)
    return None


# ---- owners --------------------------------------------------------------
owner = {}
try:
    for x in json.load(open(SATCAT, encoding='utf-8')):
        owner[str(x['c'])] = x.get('o')
except Exception as e:
    log('warning: satcat load:', e)


def country(nid, name):
    o = owner.get(str(nid))
    if o:
        return OWNER_NAME.get(o, o), o
    n = name.upper()
    if n.startswith(('CZ-', 'CHANG ZHENG')) or any(k in n for k in ('TIANMU', 'JILIN', 'YAOGAN', 'BEIDOU')):
        return 'China', 'PRC'
    if 'COSMOS' in n or n.startswith('SL-'):
        return 'Russia', 'CIS'
    if n.startswith(('STARLINK', 'FLOCK')) or 'IRIDIUM' in n:
        return 'United States', 'US'
    return 'Unknown', 'TBD'


def kind(name):
    n = name.upper()
    if 'DEB' in n:
        return 'debris'
    if 'R/B' in n or 'ROCKET' in n:
        return 'rocket'
    return 'payload'


# ---- assemble ------------------------------------------------------------
out = []
for p in pairs:
    if len(out) >= WANT:
        break
    ta, tb = fetch_tle(p['id1']), fetch_tle(p['id2'])
    if not ta or not tb:
        log(f"  skip {p['id1']}-{p['id2']}: missing TLE"); continue
    # SOCRATES appends an operational-status flag to names ("NAME [+]") — strip it.
    clean = lambda s: re.sub(r'\s*\[[^\]]*\]\s*$', '', (s or '').strip())
    nm1, nm2 = clean(p['nm1']) or ta[0], clean(p['nm2']) or tb[0]
    oa, ob = country(p['id1'], nm1), country(p['id2'], nm2)
    out.append({
        'id': f"{p['id1']}-{p['id2']}", 'tca': p['tca'], 'missM': p['missM'],
        'maxProb': p['prob'], 'relVel': p['vel'],
        'a': {'norad': p['id1'], 'name': nm1, 'kind': kind(nm1), 'owner': oa[0], 'ownerCode': oa[1], 'tle': [ta[1], ta[2]]},
        'b': {'norad': p['id2'], 'name': nm2, 'kind': kind(nm2), 'owner': ob[0], 'ownerCode': ob[1], 'tle': [tb[1], tb[2]]},
    })

if len(out) < MIN_OK:
    log(f'FATAL: only {len(out)} conjunctions with TLEs (< {MIN_OK}) — not overwriting {OUT}')
    sys.exit(1)

tcas = sorted(c['tca'] for c in out)
doc = {
    'source': 'CelesTrak SOCRATES (Satellite Orbital Conjunction Reports Assessing Threatening Encounters in Space)',
    'generated': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'note': 'Public predicted close approaches. Orbits are SGP4-propagated public elements, so the on-globe convergence is a visual approximation of the real screening.',
    'window': {'from': tcas[0], 'to': tcas[-1]},
    'conjunctions': out,
}
json.dump(doc, open(OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
log(f'wrote {len(out)} conjunctions -> {OUT}; window {doc["window"]}')
