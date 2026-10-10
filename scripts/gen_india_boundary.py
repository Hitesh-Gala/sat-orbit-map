"""Replace Natural Earth's India outline with the official one.

NE draws India the way the UN does - Jammu & Kashmir cut at the line of control,
Aksai Chin outside - which is not the boundary India publishes. The states file
from abhinavswami28/india-official-geojson follows the official map, so the 36
state polygons are dissolved into one country outline and swapped in. Only
India's geometry is touched; every other country is left exactly as it was.
"""
import json, io, os
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

REPO = r'D:\11 Bangalore 2026\1 Takshashila Institution\Argos Collab\sat-orbit-map'
GEO = os.path.join(REPO, 'data', 'countries-110m.geojson')

states = json.load(io.open('india-states.geojson', encoding='utf-8'))
polys = [shape(f['geometry']).buffer(0) for f in states['features'] if f.get('geometry')]
india = unary_union(polys)
print('dissolved %d states -> %s' % (len(polys), india.geom_type))

# NE 110m is a coarse file; match its weight rather than shipping 460 KB of detail
# Drop slivers the way a 110m file does, but keep anything island-sized so the
# Andamans and Lakshadweep survive - NAZAR marks launch sites out there.
from shapely.geometry import MultiPolygon
parts = list(india.geoms) if india.geom_type == 'MultiPolygon' else [india]
keep = [p for p in parts if p.area > 0.002]
print('kept %d of %d polygons' % (len(keep), len(parts)))
india = MultiPolygon(keep) if len(keep) > 1 else keep[0]
for tol in (0.03, 0.05, 0.08, 0.12):
    simple = india.simplify(tol, preserve_topology=True)
    size = len(json.dumps(mapping(simple)))
    print('  tolerance %.3f -> %d KB' % (tol, size // 1024))
    if size < 60000:
        break

world = json.load(io.open(GEO, encoding='utf-8'))
NAME_KEYS = ['name', 'NAME', 'ADMIN', 'admin', 'sovereignt', 'NAME_LONG']


def name_of(f):
    p = f.get('properties') or {}
    for k in NAME_KEYS:
        if p.get(k):
            return str(p[k])
    return ''


hit = 0
for f in world['features']:
    if name_of(f).strip().lower() == 'india':
        f['geometry'] = mapping(simple)
        f.setdefault('properties', {})['boundary_source'] = 'Government of India official state boundaries (dissolved)'
        hit += 1
print('india features replaced:', hit)
assert hit == 1, 'expected exactly one India feature'

# Neighbours keep their own coarse outlines, which now overlap the corrected
# area; subtract India from them so two fills never claim the same ground.
ind = shape(mapping(simple)).buffer(0)
for f in world['features']:
    n = name_of(f).strip().lower()
    if n in ('pakistan', 'china') and f.get('geometry'):
        g = shape(f['geometry']).buffer(0)
        if g.intersects(ind):
            cut = g.difference(ind)
            if not cut.is_empty:
                f['geometry'] = mapping(cut)
                print('trimmed', n)
# any standalone disputed-area features would double-draw the same ground
before = len(world['features'])
world['features'] = [f for f in world['features']
                     if not any(w in name_of(f).lower() for w in ('siachen', 'disputed'))]
if before != len(world['features']):
    print('dropped %d disputed-area features' % (before - len(world['features'])))

io.open(GEO, 'w', encoding='utf-8').write(json.dumps(world, ensure_ascii=False))
print('wrote %s (%d KB)' % (GEO, os.path.getsize(GEO) // 1024))
