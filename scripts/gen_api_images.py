"""Attach The Space Devs' own imagery to the atlas, by reference.

The Launch Library API publishes an image URL per launch vehicle and a map
image per pad/location. Those are served from their CDN for clients to display,
so NAZAR links them rather than copying any file into the repo.
"""
import glob, io, json, math, os

REPO = r'D:\11 Bangalore 2026\1 Takshashila Institution\Argos Collab\sat-orbit-map'
CRED = 'The Space Devs · Launch Library'

# ---- rockets ----------------------------------------------------------
imgs = {}
for f in sorted(glob.glob('ll-lv-*.json')):
    for r in json.load(io.open(f, encoding='utf-8')).get('results', []):
        key = (r.get('full_name') or r.get('name') or '').strip()
        if key and r.get('image_url'):
            imgs[key] = r['image_url']

P = os.path.join(REPO, 'data', 'rockets.json')
d = json.load(io.open(P, encoding='utf-8'))
n = 0
for r in d['rockets']:
    u = imgs.get(r['full']) or imgs.get(r['name'])
    if u:
        r['imgRemote'] = u
        n += 1
d['note'] += (' Where no free photograph could be verified, the card falls back to the image the Launch Library '
              'API publishes for that vehicle, linked from their servers rather than copied.')
io.open(P, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=1))
print('rockets with an API image: %d of %d (local photo on %d)'
      % (n, len(d['rockets']), sum(1 for r in d['rockets'] if r.get('img'))))
print('cards still with neither: %d'
      % sum(1 for r in d['rockets'] if not r.get('img') and not r.get('imgRemote')))

# ---- launch sites -----------------------------------------------------
locs = []
for f in ['ll-loc.json']:
    for r in json.load(io.open(f, encoding='utf-8')).get('results', []):
        if r.get('map_image'):
            locs.append(r)
pads = []
for f in sorted(glob.glob('ll-pad*.json')):
    for p in json.load(io.open(f, encoding='utf-8')).get('results', []):
        if p.get('map_image') and p.get('latitude'):
            pads.append(p)
print('locations with a map image: %d | pads with one: %d' % (len(locs), len(pads)))


def km(a, b):
    dlat = (a[0] - b[0]) * 111.0
    dlon = (a[1] - b[1]) * 111.0 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dlat, dlon)


S = os.path.join(REPO, 'data', 'launch-map.json')
sites = json.load(io.open(S, encoding='utf-8'))
hit = 0
for s in sites:
    if s['t'] != 'launch':
        continue
    best, bd = None, 1e9
    for p in pads:
        try:
            dd = km((s['lat'], s['lon']), (float(p['latitude']), float(p['longitude'])))
        except (TypeError, ValueError):
            continue
        if dd < bd:
            best, bd = p, dd
    if best and bd <= 60:
        s['img'] = best['map_image']
        s['imgCredit'] = CRED
        hit += 1
io.open(S, 'w', encoding='utf-8').write(json.dumps(sites, ensure_ascii=False, indent=1))
print('launch sites given a pad map image: %d of %d'
      % (hit, sum(1 for s in sites if s['t'] == 'launch')))
