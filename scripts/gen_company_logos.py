"""Download a logo for every company on the Analogues page, once, into the repo.

Tries the site's own apple-touch-icon / favicon first, then the <link rel=icon>
declared in its HTML, then DuckDuckGo's icon service as a last resort.  Everything
is normalised to a 64px PNG so the page never calls a third party at view time.
"""
import json, io, os, re, ssl, sys, urllib.request, concurrent.futures as cf
from PIL import Image

REPO = r'D:\11 Bangalore 2026\1 Takshashila Institution\Argos Collab\sat-orbit-map'
OUT = os.path.join(REPO, 'data', 'logos')
os.makedirs(OUT, exist_ok=True)
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36'}


def get(url, timeout=12, limit=800000):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        if r.status != 200:
            raise OSError('status %s' % r.status)
        return r.read(limit), r.headers.get('Content-Type', '')


def host_of(u):
    return re.sub(r'^https?://(www\.)?', '', u or '').strip('/').split('/')[0].lower()


def save_png(raw, path):
    im = Image.open(io.BytesIO(raw))
    if getattr(im, 'n_frames', 1) > 1:          # .ico files hold several sizes
        best, area = None, -1
        for i in range(im.n_frames):
            im.seek(i)
            if im.size[0] * im.size[1] > area:
                area, best = im.size[0] * im.size[1], im.convert('RGBA')
        im = best
    else:
        im = im.convert('RGBA')
    if min(im.size) < 16:
        raise OSError('too small %s' % (im.size,))
    im.thumbnail((64, 64), Image.LANCZOS)
    im.save(path, 'PNG', optimize=True)
    return im.size


def icon_urls(site):
    h = host_of(site)
    base = 'https://' + h
    out = ['%s/apple-touch-icon.png' % base, '%s/apple-touch-icon-precomposed.png' % base, '%s/favicon.ico' % base]
    try:
        html, _ = get(base + '/', timeout=14, limit=400000)
        txt = html.decode('utf-8', 'replace')
        for m in re.finditer(r'<link[^>]+rel=["\'][^"\']*icon[^"\']*["\'][^>]*>', txt, re.I):
            tag = m.group(0)
            href = re.search(r'href=["\']([^"\']+)["\']', tag, re.I)
            if not href:
                continue
            u = href.group(1).strip()
            if u.startswith('//'):
                u = 'https:' + u
            elif u.startswith('/'):
                u = base + u
            elif not u.startswith('http'):
                u = base + '/' + u
            if u.lower().endswith(('.svg',)):
                continue                       # PIL cannot open SVG
            out.insert(0, u)
    except Exception:
        pass
    out.append('https://icons.duckduckgo.com/ip3/%s.ico' % h)
    return out


def work(job):
    slug, site = job
    if not site:
        return slug, 'no-site'
    path = os.path.join(OUT, slug + '.png')
    if os.path.exists(path):
        return slug, 'cached'
    for u in icon_urls(site):
        try:
            raw, _ = get(u)
            if len(raw) < 70:
                continue
            size = save_png(raw, path)
            return slug, 'ok %dx%d via %s' % (size[0], size[1], host_of(u))
        except Exception:
            continue
    return slug, 'FAIL'


ind = json.load(io.open(REPO + r'\data\indi-space.json', encoding='utf-8'))
an = json.load(io.open(REPO + r'\data\analogues.json', encoding='utf-8'))
jobs = [('in-' + c['num'], c.get('website', '')) for c in ind]
jobs += [('g-' + g['id'], g.get('url', '')) for g in an['global']]

res = {}
with cf.ThreadPoolExecutor(max_workers=10) as ex:
    for slug, st in ex.map(work, jobs):
        res[slug] = st
ok = [k for k, v in res.items() if v.startswith(('ok', 'cached'))]
bad = [k for k, v in res.items() if not v.startswith(('ok', 'cached'))]
io.open(os.path.join(OUT, '_manifest.json'), 'w', encoding='utf-8').write(
    json.dumps(sorted(ok), ensure_ascii=False, indent=0))
sys.stdout.write('logos saved: %d / %d\n' % (len(ok), len(jobs)))
sys.stdout.write('missing: %s\n' % ', '.join(sorted(bad)))
