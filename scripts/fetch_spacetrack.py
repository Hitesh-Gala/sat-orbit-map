#!/usr/bin/env python3
"""Fetch daily TLE / CDM / SATCAT summaries from Space-Track.org.

Runs inside GitHub Actions ONLY — credentials come from repository secrets
(SPACETRACK_USER / SPACETRACK_PASSWORD) and are never stored in the repo or
shipped to the browser.  Writes a compact data/spacetrack-summary.json (counts
+ data-currency timestamps + a small sample of the latest conjunction messages)
that the Data-Comparison page reads as a static file.

Space-Track's API rules: log in once, reuse the session cookie, keep queries
few and small, and always log out.  We make three modest queries a day.

Usage: fetch_spacetrack.py [out.json]
"""
import json, os, sys, time, datetime
import urllib.request, urllib.parse, urllib.error
from http.cookiejar import CookieJar

OUT = sys.argv[1] if len(sys.argv) > 1 else 'data/spacetrack-summary.json'
BASE = 'https://www.space-track.org'
USER = os.environ.get('SPACETRACK_USER', '').strip()
PASS = os.environ.get('SPACETRACK_PASSWORD', '')

if not USER or not PASS:
    print('FATAL: SPACETRACK_USER / SPACETRACK_PASSWORD not set (add them as '
          'repository secrets).', file=sys.stderr)
    sys.exit(1)

opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
opener.addheaders = [('User-Agent', 'NAZAR/1.0 (github.com/Hitesh-Gala/sat-orbit-map)')]


def login():
    data = urllib.parse.urlencode({'identity': USER, 'password': PASS}).encode()
    with opener.open(BASE + '/ajaxauth/login', data, timeout=60) as r:
        body = r.read().decode('utf-8', 'replace')
    if 'Failed' in body or r.status != 200:
        print('FATAL: Space-Track login failed. Check the repository secrets.', file=sys.stderr)
        sys.exit(1)
    print('logged in to Space-Track')


def query(path, tries=3):
    """GET a REST query, returning parsed JSON (or [] on persistent failure)."""
    for a in range(tries):
        try:
            with opener.open(BASE + path, timeout=180) as r:
                return json.loads(r.read().decode('utf-8', 'replace') or '[]')
        except Exception as e:
            print(f'  query attempt {a + 1} failed: {e}', file=sys.stderr)
            time.sleep(15)
    return []


def logout():
    try:
        opener.open(BASE + '/ajaxauth/logout', timeout=30).read()
        print('logged out')
    except Exception:
        pass


now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0, tzinfo=None)
out = {'source': 'Space-Track.org', 'retrieved': now.strftime('%Y-%m-%dT%H:%M:%SZ')}

login()
try:
    # ---- 1) GP / TLE currency -------------------------------------------
    # Newest element sets: count of on-orbit objects + the freshest epoch.
    gp = query('/basicspacedata/query/class/gp/decay_date/null-val/epoch/%3Enow-30'
               '/orderby/EPOCH%20desc/limit/1/format/json')
    gp_count = query('/basicspacedata/query/class/boxscore/format/json')
    latest_epoch = gp[0].get('EPOCH') if gp else None

    # Total tracked on-orbit objects, via the satcat (cheap, indexed query).
    sat_on_orbit = query('/basicspacedata/query/class/satcat/DECAY/null-val/CURRENT/Y'
                         '/predicates/NORAD_CAT_ID/format/json')
    sat_payloads = query('/basicspacedata/query/class/satcat/DECAY/null-val/CURRENT/Y'
                         '/OBJECT_TYPE/PAYLOAD/predicates/NORAD_CAT_ID/format/json')

    out['tle'] = {
        'label': 'On-orbit objects (GP catalogue)',
        'count': len(sat_on_orbit) or None,
        'latestEpoch': latest_epoch,
        'note': 'Space-Track GP/SATCAT: all catalogued objects still on orbit.',
    }
    out['satcat'] = {
        'label': 'Active payloads',
        'count': len(sat_payloads) or None,
        'note': 'SATCAT payloads with no decay date (CURRENT=Y).',
    }

    # ---- 2) CDMs (conjunction data messages) ----------------------------
    # The public CDM feed: latest screening results for the operator community.
    cdm = query('/basicspacedata/query/class/cdm_public/orderby/TCA%20asc'
                '/limit/200/format/json')
    sample = []
    for c in cdm[:12]:
        try:
            sample.append({
                'sat1': c.get('SAT_1_NAME'), 'id1': c.get('SAT_1_ID'),
                'sat2': c.get('SAT_2_NAME'), 'id2': c.get('SAT_2_ID'),
                'tca': c.get('TCA'),
                'missM': round(float(c.get('MIN_RNG', 0) or 0) * 1000),
                'prob': float(c.get('PC', 0) or 0),
                'relVel': round(float(c.get('RELATIVE_SPEED', 0) or 0), 3),
            })
        except Exception:
            continue
    tcas = sorted(x['tca'] for x in sample if x.get('tca'))
    out['conjunctions'] = {
        'label': 'Public CDMs (conjunction messages)',
        'count': len(cdm),
        'window': {'from': tcas[0], 'to': tcas[-1]} if tcas else None,
        'sample': sample,
        'note': 'cdm_public: operator-grade conjunction data messages.',
    }
finally:
    logout()

os.makedirs('data', exist_ok=True)
json.dump(out, open(OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print('wrote', OUT)
print(json.dumps({k: (v.get('count') if isinstance(v, dict) else v)
                  for k, v in out.items()}, indent=1))
