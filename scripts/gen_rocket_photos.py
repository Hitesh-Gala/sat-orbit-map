"""Third pass: take each rocket's Wikipedia lead image, but only if Commons
says it is freely licensed.

The lead image of an article is almost always the right subject, which free-text
search and even categories are not. Every file is still checked on Commons for a
public-domain or CC licence and credited.
"""
import io, json, os, re, ssl, sys, time, urllib.parse, urllib.request
from PIL import Image

REPO = r'D:\11 Bangalore 2026\1 Takshashila Institution\Argos Collab\sat-orbit-map'
OUT = os.path.join(REPO, 'data', 'rockets')
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
UA = {'User-Agent': 'NAZAR-static-site/1.0 (rocket card illustrations; contact hdgala@gmail.com)'}
WP = 'https://en.wikipedia.org/w/api.php'
COMMONS = 'https://commons.wikimedia.org/w/api.php'
OK_LIC = re.compile(r'public domain|^pd|cc0|cc[ -]?by(?![ -]?nc)|attribution', re.I)

TITLES = {
 'falcon-9': 'Falcon 9', 'falcon-heavy': 'Falcon Heavy', 'starship': 'SpaceX Starship',
 'atlas-v': 'Atlas V', 'delta-iv-heavy': 'Delta IV Heavy', 'vulcan': 'Vulcan Centaur',
 'new-glenn': 'New Glenn', 'electron': 'Rocket Lab Electron', 'neutron': 'Rocket Lab Neutron',
 'sls': 'Space Launch System', 'antares': 'Antares (rocket)', 'minotaur': 'Minotaur IV',
 'pegasus': 'Pegasus (rocket)', 'alpha': 'Firefly Alpha', 'ariane-5': 'Ariane 5',
 'ariane-6': 'Ariane 6', 'vega-c': 'Vega C', 'soyuz-2': 'Soyuz-2', 'proton-m': 'Proton-M',
 'angara-a5': 'Angara A5', 'long-march-5': 'Long March 5', 'long-march-2f': 'Long March 2F',
 'long-march-3b': 'Long March 3B', 'kuaizhou': 'Kuaizhou', 'zhuque-2': 'Zhuque-2',
 'pslv': 'Polar Satellite Launch Vehicle', 'gslv-mk3': 'LVM3',
 'gslv': 'Geosynchronous Satellite Launch Vehicle', 'sslv': 'Small Satellite Launch Vehicle',
 'h-iia': 'H-IIA', 'h3': 'H3 (rocket)', 'epsilon': 'Epsilon (rocket)', 'nuri': 'Nuri (rocket)',
 'saturn-v': 'Saturn V', 'space-shuttle': 'Space Shuttle', 'soyuz-fg': 'Soyuz-FG',
 'titan-iiic': 'Titan IIIC', 'miura-5': 'Miura 5', 'spectrum': 'Spectrum (rocket)',
 'eris': 'Eris (rocket)', 'kairos': 'Kairos (rocket)', 'safir': 'Safir (rocket)',
 'unha': 'Unha', 'vikram-1': 'Vikram (rocket family)',
}
ONLY = set(sys.argv[1:]) or None


def get(url, params):
    params = dict(params); params['format'] = 'json'
    req = urllib.request.Request(url + '?' + urllib.parse.urlencode(params), headers=UA)
    with urllib.request.urlopen(req, timeout=40, context=CTX) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))


def lead_file(title):
    d = get(WP, {'action': 'query', 'titles': title, 'prop': 'pageimages',
                 'piprop': 'name', 'redirects': 1})
    for p in ((d.get('query') or {}).get('pages') or {}).values():
        if p.get('pageimage'):
            return 'File:' + p['pageimage']
    return None


def commons_info(filetitle):
    d = get(COMMONS, {'action': 'query', 'titles': filetitle, 'prop': 'imageinfo',
                      'iiprop': 'url|extmetadata|size', 'iiurlwidth': 900})
    for p in ((d.get('query') or {}).get('pages') or {}).values():
        ii = (p.get('imageinfo') or [{}])[0]
        if not ii.get('thumburl'):
            return None
        meta = ii.get('extmetadata') or {}
        lic = (meta.get('LicenseShortName', {}).get('value') or '') + ' ' + (meta.get('License', {}).get('value') or '')
        if not OK_LIC.search(lic):
            return {'blocked': lic.strip() or 'unclear licence'}
        author = re.sub(r'<[^>]+>', '', meta.get('Artist', {}).get('value') or '').strip()
        author = re.sub(r'\s+', ' ', author)[:70] or 'Unknown'
        return {'thumb': ii['thumburl'], 'page': ii.get('descriptionurl'), 'author': author,
                'lic': (meta.get('LicenseShortName', {}).get('value') or 'PD').strip(),
                'title': p.get('title'), 'w': ii.get('width'), 'h': ii.get('height')}
    return None


def grab(url, path):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
        raw = r.read()
    im = Image.open(io.BytesIO(raw)).convert('RGB')
    im.thumbnail((900, 900), Image.LANCZOS)
    im.save(path, 'JPEG', quality=82, optimize=True)
    return im.size


mf = os.path.join(OUT, '_credits.json')
manifest = json.load(io.open(mf, encoding='utf-8')) if os.path.exists(mf) else {}
good = bad = 0
for slug, title in TITLES.items():
    if ONLY and slug not in ONLY:
        continue
    try:
        ft = lead_file(title)
    except Exception as e:
        sys.stdout.write('ERR   %-15s %s\n' % (slug, e)); continue
    if not ft:
        sys.stdout.write('none  %-15s (no lead image on "%s")\n' % (slug, title)); bad += 1; continue
    info = commons_info(ft)
    if not info or info.get('blocked'):
        sys.stdout.write('nofree %-14s %s [%s]\n' % (slug, ft[:40], (info or {}).get('blocked', 'not on Commons'))); bad += 1; continue
    try:
        size = grab(info['thumb'], os.path.join(OUT, slug + '.jpg'))
    except Exception as e:
        sys.stdout.write('FAIL  %-15s %s\n' % (slug, e)); bad += 1; continue
    manifest[slug] = {'file': 'data/rockets/%s.jpg' % slug, 'author': info['author'],
                      'licence': info['lic'], 'source': info['page'], 'title': info['title']}
    good += 1
    sys.stdout.write('ok    %-15s %dx%d  %s\n' % (slug, size[0], size[1], info['title'][:52]))
    time.sleep(0.35)

io.open(mf, 'w', encoding='utf-8').write(json.dumps(manifest, ensure_ascii=False, indent=1))
sys.stdout.write('\nlead images taken: %d   left alone: %d\n' % (good, bad))
