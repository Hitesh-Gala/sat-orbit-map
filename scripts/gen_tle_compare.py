"""Build data/tle-compare.json - the Western vs Chinese TLE comparison table.

What this can and cannot reach, stated plainly, because it shapes the file:

  * CelesTrak  - bundled in data/active.tle, full element sets with epochs.
  * Space-Track - the bundled snapshot carries catalogue metadata for payloads
    and full element sets for non-payloads. When this runs in CI with the
    Space-Track secrets, scripts/fetch_spacetrack.py can also leave element
    sets in data/spacetrack-gp-tle.txt, and they are picked up here.
  * AOE / spacemapper.cn - their catalogue gateway answers 401 Unauthorized
    without a subscription, so nothing is scraped. The column is carried in the
    schema with a per-object deep link so a reader can check by eye, and it
    fills automatically if an AOE export is ever dropped at
    data/aoe-tle.txt (plain three-line TLE format).

The watchlist is reconnaissance and electronic-intelligence satellites on both
sides, which is where the catalogues most often disagree: Western ISR is
compared against the Chinese source, Chinese ISR against the Western ones.
"""
import io, json, os, re, sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'tle-compare.json')

# Name patterns, with the side each belongs to. The comparison runs the other
# way round for each: a Western object is checked against the Chinese source.
WATCH = [
    ('west', 'ELINT / SIGINT', r'^(USA[- ]\d+|NROL[- ]?\d+|INTRUDER|TRUMPET|MENTOR|ORION|MERCURY)'),
    ('west', 'Radar imaging',  r'^(LACROSSE|ONYX|TOPAZ|CAPELLA|ICEYE|UMBRA|SARAH)'),
    ('west', 'Optical imaging', r'^(KH-\d|CRYSTAL|WORLDVIEW|GEOEYE|LEGION)'),
    ('west', 'Space surveillance', r'^(SBSS|GSSAP|SILENT ?BARKER|ORS-?5)'),
    ('cn',   'ISR (Yaogan)',   r'^YAOGAN'),
    ('cn',   'ISR (Gaofen)',   r'^GAOFEN'),
    ('cn',   'Technology test (TJS)', r'^TJS[- ]?\d'),
    ('cn',   'Technology test (Shijian)', r'^(SHIJIAN|SJ)[- ]?\d'),
    ('cn',   'Electronic intelligence', r'^(CHUANGXIN|SHIYAN|LUDI|ZHUHAI)'),
    ('cn',   'Ocean surveillance', r'^(HAIYANG|HY-\d)'),
]


def parse_tle_file(path):
    """name -> {norad, l1, l2, epoch} from a three-line element file."""
    out = {}
    if not os.path.exists(path):
        return out
    lines = io.open(path, encoding='utf-8', errors='replace').read().splitlines()
    for i in range(0, len(lines) - 2):
        n, l1, l2 = lines[i].strip(), lines[i + 1].strip(), lines[i + 2].strip()
        if not (l1.startswith('1 ') and l2.startswith('2 ')):
            continue
        try:
            norad = int(re.sub(r'[^0-9]', '', l1[2:7]) or 0)
        except ValueError:
            continue
        out[n.upper()] = {'norad': norad, 'l1': l1, 'l2': l2, 'epoch': tle_epoch(l1)}
    return out


def tle_epoch(l1):
    """Line-1 columns 19-32 hold a two-digit year and a fractional day."""
    try:
        yy = int(l1[18:20])
        doy = float(l1[20:32])
    except (ValueError, IndexError):
        return None
    year = 2000 + yy if yy < 57 else 1900 + yy
    dt = datetime(year, 1, 1, tzinfo=timezone.utc) + timedelta(days=doy - 1)
    return dt.replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def mean_motion(l2):
    try:
        return float(l2[52:63])
    except (ValueError, IndexError):
        return None


def main():
    celes = parse_tle_file(os.path.join(ROOT, 'data', 'active.tle'))
    strack = parse_tle_file(os.path.join(ROOT, 'data', 'spacetrack-gp-tle.txt'))
    strack.update(parse_tle_file(os.path.join(ROOT, 'data', 'spacetrack-debris.tle')))
    aoe = parse_tle_file(os.path.join(ROOT, 'data', 'aoe-tle.txt'))

    # launch dates and owners come from the Space-Track summary
    meta = {}
    sp = os.path.join(ROOT, 'data', 'spacetrack-gp.json')
    if os.path.exists(sp):
        blob = json.load(io.open(sp, encoding='utf-8'))
        for s in blob.get('sats', []):
            try:                       # a few rows carry '-' instead of a number
                key = int(str(s.get('c', '')).strip())   # 'c' is the catalogue number
            except (TypeError, ValueError):
                continue
            meta[key] = {'ld': s.get('ld'), 'o': s.get('o'), 'n': s.get('n')}

    rows = []
    for name, rec in sorted(celes.items()):
        side = kind = None
        for sd, kd, pat in WATCH:
            if re.match(pat, name, re.I):
                side, kind = sd, kd
                break
        if not side:
            continue
        m = meta.get(rec['norad'], {})
        st = strack.get(name)
        ao = aoe.get(name)
        rows.append({
            'name': name.title() if name.isupper() else name,
            'norad': rec['norad'],
            'side': side,
            'kind': kind,
            'launched': m.get('ld') or '',
            'owner': m.get('o') or ('PRC' if side == 'cn' else ''),
            'celestrak': {'epoch': rec['epoch'], 'l1': rec['l1'], 'l2': rec['l2'],
                          'mm': mean_motion(rec['l2'])},
            'spacetrack': ({'epoch': st['epoch'], 'l1': st['l1'], 'l2': st['l2'],
                            'mm': mean_motion(st['l2'])} if st else None),
            'aoe': ({'epoch': ao['epoch'], 'l1': ao['l1'], 'l2': ao['l2'],
                     'mm': mean_motion(ao['l2'])} if ao else None),
        })

    out = {
        'built': datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z'),
        'sources': {
            'celestrak': 'data/active.tle (bundled CelesTrak snapshot)',
            'spacetrack': 'data/spacetrack-gp-tle.txt / spacetrack-debris.tle, refreshed in CI',
            'aoe': 'spacemapper.cn AOE catalogue - gateway returns 401 without a subscription, '
                   'so nothing is fetched; drop an export at data/aoe-tle.txt to fill this column',
        },
        'aoeLink': 'https://spacemapper.cn/en-us/catalog/aoecat/',
        'counts': {'rows': len(rows),
                   'west': sum(1 for r in rows if r['side'] == 'west'),
                   'cn': sum(1 for r in rows if r['side'] == 'cn'),
                   'withSpacetrack': sum(1 for r in rows if r['spacetrack']),
                   'withAoe': sum(1 for r in rows if r['aoe'])},
        'rows': rows,
    }
    io.open(OUT, 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=1))
    sys.stdout.write('wrote %s: %d rows (%d western, %d Chinese; %d with Space-Track, %d with AOE)\n'
                     % (OUT, len(rows), out['counts']['west'], out['counts']['cn'],
                        out['counts']['withSpacetrack'], out['counts']['withAoe']))


if __name__ == '__main__':
    main()
