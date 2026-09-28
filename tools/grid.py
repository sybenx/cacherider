#!/usr/bin/env python3
"""Fit each town's address grid from the street names in our own map tiles.

Cache Valley addresses are coordinates: "1400 North 500 East, Logan" is the
point 1400 units north and 500 east of Logan's origin. Streets are named for
their coordinate ("800 West", "West 800 South"), so a town's grid can be
fitted from its named roads alone: latitude against the north–south number,
longitude against the east–west number. The app then places any address
without an address database.

  python3 tools/grid.py            # reads tiles/, writes data/grid.json

Needs the mapbox-vector-tile package (pip install mapbox-vector-tile).
"""
import json, math, os, re, statistics, sys
import mapbox_vector_tile as mvt

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
TILES = os.path.join(ROOT, 'tiles')
Z = 14

def lonlat(z, x, y, extent=4096):
    n = 2 ** z
    def f(px, py):
        lon = (x + px / extent) / n * 360 - 180
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / extent) / n))))
        return lon, lat
    return f

GRID = re.compile(r'^(?:(North|South|East|West)\s+)?(\d+)\s+(North|South|East|West)$', re.I)
def parse(name):
    """'400 North' → ('N', +400); 'West 800 South' → ('N', -800); '800 West' → ('E', -800)."""
    m = GRID.match(name.strip())
    if not m: return None
    n, d = int(m.group(2)), m.group(3).lower()
    if n % 100 and n % 50: return None       # a real grid street, not a house number
    if d in ('north', 'south'): return ('N', n if d == 'north' else -n)
    return ('E', n if d == 'east' else -n)

index = json.load(open(os.path.join(TILES, 'tiles.json')))
roads, towns = [], []
for t in index['tiles']:
    z, x, y = (int(v) for v in t.split('/'))
    if z != Z: continue
    conv = lonlat(z, x, y)
    d = mvt.decode(open(os.path.join(TILES, t + '.pbf'), 'rb').read(), default_options={'y_coord_down': True})
    for f in d.get('roads', {}).get('features', []):
        g = parse(f['properties'].get('name') or '')
        if not g: continue
        geom = f['geometry']
        lines = geom['coordinates'] if geom['type'] == 'MultiLineString' else [geom['coordinates']]
        for line in lines:
            for px, py in line[::3]:
                lon, lat = conv(px, py)
                roads.append((g[0], g[1], lat, lon))
    for f in d.get('places', {}).get('features', []):
        p = f['properties']
        if p.get('kind') == 'locality' and f['geometry']['type'] == 'Point':
            lon, lat = conv(*f['geometry']['coordinates'])
            towns.append({'name': p['name'], 'lat': lat, 'lon': lon, 'pop': p.get('population') or 0})
# A locality shows up in more than one tile; keep one point each.
seen = {}
for t in towns: seen.setdefault(t['name'], t)
towns = sorted(seen.values(), key=lambda t: -t['pop'])
print(len(roads), 'grid-street points;', len(towns), 'localities')

def dist(a, b):
    return math.hypot((a[0] - b[0]) * 111000, (a[1] - b[1]) * 111000 * math.cos(math.radians(a[0])))

# Each road point belongs to its nearest sizeable town.
big = [t for t in towns if t['pop'] >= 300]
def nearest_town(lat, lon):
    return min(big, key=lambda t: dist((lat, lon), (t['lat'], t['lon'])))

def fit(pairs):
    """Least squares y = a + b x, twice: the second time without the outliers of the first."""
    if len(set(x for x, _ in pairs)) < 3: return None
    def lsq(ps):
        n = len(ps); sx = sum(x for x, _ in ps); sy = sum(y for _, y in ps)
        sxx = sum(x * x for x, _ in ps); sxy = sum(x * y for x, y in ps)
        den = n * sxx - sx * sx
        if not den: return None
        b = (n * sxy - sx * sy) / den; a = (sy - b * sx) / n
        return a, b
    r = lsq(pairs)
    if not r: return None
    a, b = r
    res = [abs(y - (a + b * x)) for x, y in pairs]
    med = statistics.median(res) or 1e-9
    keep = [p for p, e in zip(pairs, res) if e <= 4 * med + 1e-5]
    r = lsq(keep) if len(set(x for x, _ in keep)) >= 3 else r
    a, b = r
    res = [abs(y - (a + b * x)) for x, y in keep]
    return a, b, statistics.median(res), len(keep)

def fit_grid(pts):
    ns = [(val, lat) for axis, val, lat, lon in pts if axis == 'N']
    ew = [(val, lon) for axis, val, lat, lon in pts if axis == 'E']
    fn, fe = fit(ns), fit(ew)
    if not fn or not fe: return None
    mN = fn[1] * 100 * 111000; mE = fe[1] * 100 * 111000 * math.cos(math.radians(fn[0]))
    if not (150 <= mN <= 260 and 150 <= mE <= 260): return None   # a real grid: a hundred is a block, about an eighth of a mile
    return {'lat0': fn[0], 'lon0': fe[0], 'klat': fn[1], 'klon': fe[1], 'fitm': [int(fn[2] * 111000), int(fe[2] * 111000 * math.cos(math.radians(fn[0])))],
            'n': [min(v for v, _ in ns), max(v for v, _ in ns)], 'e': [min(v for v, _ in ew), max(v for v, _ in ew)], 'points': fn[3] + fe[3]}

def residual(g, axis, val, lat, lon):
    if axis == 'N': return abs(lat - (g['lat0'] + g['klat'] * val)) * 111000
    return abs(lon - (g['lon0'] + g['klon'] * val)) * 111000 * math.cos(math.radians(lat))

def bounds(pts, pad=1500):
    lats = [p[2] for p in pts]; lons = [p[3] for p in pts]
    dlat = pad / 111000; dlon = pad / (111000 * math.cos(math.radians(sum(lats) / len(lats))))
    return [round(min(lats) - dlat, 5), round(min(lons) - dlon, 5), round(max(lats) + dlat, 5), round(max(lons) + dlon, 5)]

by_town = {}
for axis, val, lat, lon in roads:
    by_town.setdefault(nearest_town(lat, lon)['name'], []).append((axis, val, lat, lon))

# Pass one: the county grids, seeded from their seats, then given every street that fits them.
grids = []
remaining = list(roads)
for seat in ('Logan', 'Preston'):
    g = fit_grid(by_town.get(seat, []))
    if not g: continue
    mine = [p for p in remaining if residual(g, *p) < 250]
    g = fit_grid(mine) or g
    mine = [p for p in remaining if residual(g, *p) < 250]
    remaining = [p for p in remaining if residual(g, *p) >= 250]
    members = sorted({nearest_town(p[2], p[3])['name'] for p in mine})
    g.update({'name': seat, 'towns': members, 'bounds': bounds(mine)})
    grids.append(g)
    print('%-12s county grid: origin %.5f,%.5f  fit ±%d/%d m  %d pts  towns %s' % (seat, g['lat0'], g['lon0'], g['fitm'][0], g['fitm'][1], g['points'], ', '.join(members)))

# Pass two: towns with a grid of their own, from the streets the county grids did not claim.
local = {}
for p in remaining:
    local.setdefault(nearest_town(p[2], p[3])['name'], []).append(p)
for name, pts in sorted(local.items(), key=lambda kv: -len(kv[1])):
    if len(pts) < 25: continue
    g = fit_grid(pts)
    if not g: 
        print('%-12s no grid of its own (%d stray points)' % (name, len(pts))); continue
    mine = [p for p in pts if residual(g, *p) < 250]
    if len(mine) < 25: continue
    g = fit_grid(mine) or g
    g.update({'name': name, 'towns': [name], 'bounds': bounds(mine, 1000)})
    grids.append(g)
    print('%-12s local grid:  origin %.5f,%.5f  100 units = %3.0f m N %3.0f m E  fit ±%d/%d m  %d pts  N %d..%d E %d..%d' % (
        name, g['lat0'], g['lon0'], g['klat'] * 100 * 111000, g['klon'] * 100 * 111000 * math.cos(math.radians(g['lat0'])), g['fitm'][0], g['fitm'][1], g['points'], g['n'][0], g['n'][1], g['e'][0], g['e'][1]))

for g in grids:
    for k in ('lat0', 'lon0'): g[k] = round(g[k], 6)
    for k in ('klat', 'klon'): g[k] = float('%.4g' % g[k])
    g.pop('points', None)
p = os.path.join(ROOT, 'data', 'grid.json')
json.dump({'grids': grids, 'places': [{'name': t['name'], 'lat': round(t['lat'], 5), 'lon': round(t['lon'], 5), 'pop': t['pop']} for t in towns], 'built': index.get('built', '')},
          open(p, 'w'), separators=(',', ':'))
print('wrote', p, os.path.getsize(p), 'bytes,', len(grids), 'grids')
