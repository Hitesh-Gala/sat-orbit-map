"""Build data/rockets.json: the launch-vehicle catalogue behind the cards.

Facts (name, family, manufacturer, country, reusability, Wikipedia link) come
from the same open launch database NextSpaceflight's rockets page is built on.
Photographs are ours, from Commons, and only where one could be verified.
"""
import glob, io, json, os, re, unicodedata

REPO = r'D:\11 Bangalore 2026\1 Takshashila Institution\Argos Collab\sat-orbit-map'
rows, seen = [], set()
for f in sorted(glob.glob('ll-lv-*.json')):
    d = json.load(io.open(f, encoding='utf-8'))
    for r in d.get('results', []):
        key = r.get('full_name') or r.get('name')
        if not key or key in seen:
            continue
        seen.add(key)
        man = r.get('manufacturer') or {}
        rows.append({
            'name': r.get('name') or key,
            'full': r.get('full_name') or key,
            'family': (r.get('family') or '').strip(),
            'variant': (r.get('variant') or '').strip(),
            'maker': man.get('abbrev') or man.get('name') or '',
            'makerFull': man.get('name') or '',
            'cc': man.get('country_code') or '',
            'reusable': bool(r.get('reusable')),
            'wiki': r.get('wiki_url') or '',
        })


def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', s.lower())).strip('-')


photos = json.load(io.open(os.path.join(REPO, 'data', 'rockets', '_credits.json'), encoding='utf-8'))
# the photo slugs are hand-made, so match them to catalogue entries by name
ALIAS = {
 'falcon-9': ['falcon 9'], 'falcon-heavy': ['falcon heavy'], 'starship': ['starship'],
 'atlas-v': ['atlas v'], 'delta-iv-heavy': ['delta iv heavy'], 'vulcan': ['vulcan'],
 'new-glenn': ['new glenn'], 'electron': ['electron'], 'neutron': ['neutron'],
 'sls': ['sls', 'space launch system'], 'antares': ['antares'], 'minotaur': ['minotaur'],
 'pegasus': ['pegasus'], 'alpha': ['alpha'], 'ariane-5': ['ariane 5'], 'ariane-6': ['ariane 6'],
 'soyuz-2': ['soyuz 2', 'soyuz-2'], 'proton-m': ['proton'], 'angara-a5': ['angara a5', 'angara 5'],
 'long-march-5': ['long march 5'], 'long-march-2f': ['long march 2f'], 'long-march-3b': ['long march 3b'],
 'kuaizhou': ['kuaizhou'], 'zhuque-2': ['zhuque-2', 'zhuque 2'], 'pslv': ['pslv'],
 'gslv-mk3': ['lvm3', 'gslv mk iii', 'gslv mk3'], 'gslv': ['gslv'], 'sslv': ['sslv'],
 'h-iia': ['h-iia', 'h2a'], 'epsilon': ['epsilon'], 'nuri': ['nuri', 'kslv'],
 'saturn-v': ['saturn v'], 'space-shuttle': ['space shuttle', 'shuttle'],
 'soyuz-fg': ['soyuz fg', 'soyuz-fg'], 'titan-iiic': ['titan iiic', 'titan iii'],
 'miura-5': ['miura 5', 'miura'], 'eris': ['eris'], 'safir': ['safir', 'simorgh'], 'unha': ['unha'],
}
for r in rows:
    low = (r['name'] + ' ' + r['full']).lower()
    r['slug'] = slug(r['full'])
    for ps, keys in ALIAS.items():
        if ps in photos and any(k in low for k in keys):
            c = photos[ps]
            r['img'] = c['file']
            r['credit'] = {'author': c['author'], 'licence': c['licence'], 'source': c['source']}
            break

rows.sort(key=lambda r: (r['family'].lower() or r['name'].lower(), r['name'].lower()))
out = {
    'compiled': '10 October 2026',
    'note': ('Catalogue facts come from the open launch database (The Space Devs Launch Library), the same source '
             'behind NextSpaceflight\u2019s rockets page. Photographs are not taken from that site: each one is a '
             'public-domain or Creative-Commons file from Wikimedia Commons, credited on the card.'),
    'rockets': rows,
}
io.open(os.path.join(REPO, 'data', 'rockets.json'), 'w', encoding='utf-8').write(
    json.dumps(out, ensure_ascii=False, indent=1))
print('rockets:', len(rows), '| with a photo:', sum(1 for r in rows if r.get('img')))
print('families:', len({r['family'] for r in rows if r['family']}), '| countries:', len({r['cc'] for r in rows if r['cc']}))
