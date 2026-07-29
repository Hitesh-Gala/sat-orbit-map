#!/usr/bin/env python3
"""Precompute data/debris-history.json from CelesTrak's full SATCAT.

Run by .github/workflows/refresh-data.yml every 6 h against the freshly
downloaded /tmp/satcat.csv, so the Debris Statistics dashboard
(debris-stats.html) stays current without shipping the 6.7 MB CSV to browsers.

Usage: gen_debris_history.py [satcat.csv] [out.json]

Emits: cumulative debris counts by parent launch year, a net-in-orbit
population curve (launched minus decayed), a per-country breakdown of what's
still up, altitude / inclination distributions, and the big named breakups.

Debris is binned by its PARENT LAUNCH year (the only creation-time proxy the
SATCAT exposes) — noted in the JSON so the UI can caveat it.
"""
import csv, json, sys, datetime

SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/satcat.csv'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'data/debris-history.json'
SANITY_FLOOR = 15000   # current debris count is ~36k; abort on a truncated CSV

EVENTS = {  # OBJECT_ID prefix -> (name, kind, when)
    '1999-025': ('Fengyun-1C',  'China ASAT test',      '11 January 2007'),
    '1993-036': ('Cosmos 2251', 'Accidental collision', '10 February 2009'),
    '1997-051': ('Iridium 33',  'Accidental collision', '10 February 2009'),
    '1982-092': ('Cosmos 1408', 'Russia ASAT test',     '15 November 2021'),
}

def country_group(owner):
    return {'PRC': 'China', 'CIS': 'Russia/USSR', 'US': 'United States',
            'FR': 'France', 'IND': 'India'}.get(owner, 'Other')

COUNTRY_ORDER = ['China', 'Russia/USSR', 'United States', 'France', 'India', 'Other']

def yr(s):
    s = (s or '').strip()[:4]
    return int(s) if s.isdigit() else None

debris = []
type_in_orbit = {'PAY': 0, 'R/B': 0, 'DEB': 0, 'UNK': 0}

with open(SRC, newline='', encoding='utf-8', errors='replace') as f:
    for row in csv.DictReader(f):
        t = row.get('OBJECT_TYPE', '')
        in_orbit = not (row.get('DECAY_DATE') or '').strip()
        if in_orbit and t in type_in_orbit:
            type_in_orbit[t] += 1
        if t != 'DEB':
            continue
        ly, dy = yr(row.get('LAUNCH_DATE')), yr(row.get('DECAY_DATE'))
        try:
            alt = (float(row.get('APOGEE') or 'nan') + float(row.get('PERIGEE') or 'nan')) / 2.0
            if alt != alt:
                alt = None
        except ValueError:
            alt = None
        try:
            inc = float(row.get('INCLINATION') or 'nan')
            if inc != inc:
                inc = None
        except ValueError:
            inc = None
        debris.append((ly, dy, country_group(row.get('OWNER', '')), alt, inc,
                       (row.get('OBJECT_ID', '') or '')[:8]))

deb_ever = len(debris)
if deb_ever < SANITY_FLOOR:
    print(f'FATAL: debris count {deb_ever} below sanity floor {SANITY_FLOOR}', file=sys.stderr)
    sys.exit(1)

launch_years = [d[0] for d in debris if d[0]]
Y0 = min(launch_years)
Y1 = max(datetime.date.today().year, max(launch_years))
years = list(range(Y0, Y1 + 1))
idx = {y: i for i, y in enumerate(years)}
n = len(years)

annual_launched = [0] * n
annual_decayed = [0] * n
country_inorbit_annual = {c: [0] * n for c in COUNTRY_ORDER}

for ly, dy, ctry, alt, inc, pfx in debris:
    if ly in idx:
        annual_launched[idx[ly]] += 1
    if dy in idx:
        annual_decayed[idx[dy]] += 1
    if dy is None and ly in idx:
        country_inorbit_annual[ctry][idx[ly]] += 1

def cumulate(a):
    out, s = [], 0
    for v in a:
        s += v
        out.append(s)
    return out

cum_launched = cumulate(annual_launched)
cum_decayed = cumulate(annual_decayed)
net_in_orbit = [cum_launched[i] - cum_decayed[i] for i in range(n)]
country_cum = {c: cumulate(country_inorbit_annual[c]) for c in COUNTRY_ORDER}

alt_edges = [400, 600, 800, 1000, 1500, 2000, 5000]
alt_labels = ['<400', '400–600', '600–800', '800–1000', '1000–1500', '1500–2000', '2000–5000', '>5000']
alt_hist = [0] * len(alt_labels)
inc_labels = ['0–18', '18–36', '36–54', '54–72', '72–90', '90–108', '108–126', '126–144', '144–162', '162–180']
inc_hist = [0] * 10
for ly, dy, ctry, alt, inc, pfx in debris:
    if dy is not None:
        continue
    if alt is not None and alt >= 0:
        b = len(alt_edges)
        for i, e in enumerate(alt_edges):
            if alt < e:
                b = i
                break
        alt_hist[b] += 1
    if inc is not None:
        inc_hist[min(9, max(0, int(inc // 18)))] += 1

events = []
for pfx, (name, kind, when) in EVENTS.items():
    ever = sum(1 for d in debris if d[5].startswith(pfx))
    up = sum(1 for d in debris if d[5].startswith(pfx) and d[1] is None)
    events.append({'name': name, 'kind': kind, 'when': when, 'ever': ever, 'inOrbit': up})
events.sort(key=lambda e: -e['inOrbit'])

deb_inorbit = sum(1 for d in debris if d[1] is None)

out = {
    'generated': datetime.date.today().isoformat(),
    'source': 'CelesTrak SATCAT (satcat.csv)',
    'note': 'Debris is binned by its PARENT LAUNCH year (the only creation-time proxy the SATCAT exposes); fragments from later on-orbit breakups therefore appear under the parent object’s launch year, not the breakup year.',
    'yearStart': Y0, 'yearEnd': Y1, 'years': years,
    'totals': {
        'debEver': deb_ever, 'debInOrbit': deb_inorbit, 'debDecayed': deb_ever - deb_inorbit,
        'payInOrbit': type_in_orbit['PAY'], 'rbInOrbit': type_in_orbit['R/B'],
    },
    'series': {
        'cumLaunched': cum_launched, 'cumDecayed': cum_decayed, 'netInOrbit': net_in_orbit,
        'annualLaunched': annual_launched,
    },
    'countries': {
        'labels': COUNTRY_ORDER,
        'cumInOrbit': [country_cum[c] for c in COUNTRY_ORDER],
        'totalInOrbit': [country_cum[c][-1] for c in COUNTRY_ORDER],
    },
    'altitude': {'labels': alt_labels, 'inOrbit': alt_hist},
    'inclination': {'labels': inc_labels, 'inOrbit': inc_hist},
    'events': events,
}

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(out, f, separators=(',', ':'))

print(f'Wrote {OUT}: {deb_ever:,} debris ever, {deb_inorbit:,} in orbit, {n} years ({Y0}-{Y1})')
