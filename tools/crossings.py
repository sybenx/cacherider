#!/usr/bin/env python3
"""Where each route's drawn shape meets a public street: the intersections, as
distances along the shape, written to data/crossings.json. The app uses them to
cut a detour's dotted stretch at the first intersection after the last served
stop, since a bus at a served stop always drives on to the next corner.

  python3 tools/crossings.py        # needs mapbox-vector-tile and tiles/

Roads come from the map's own tiles at zoom 15. An intersection is a street of
residential class or bigger continuing across the route, or a bigger road meeting
it from one side; residential dead ends, lot lanes, driveways and paths don't count.
"""
import gzip, json, math, os
import mapbox_vector_tile as mvt

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
TILES = os.path.join(ROOT, 'tiles')
Z, EXTENT, EDGE = 15, 4096, 24          # EDGE: tile pixels; an endpoint that close to the edge is a clip, not a dead end
CROSS_ANGLE, TOUCH = 20, 7   # degrees, metres

def street(pr):
    """What a road counts as: 'big' for the main classes and their slip lanes, 'street' for a named residential
    street, None for lot lanes, driveways, unnamed stubs and paths, whatever OSM calls them."""
    kind, det = pr.get('kind'), pr.get('kind_detail') or ''
    if kind in ('highway', 'major_road', 'medium_road'): return 'big'
    if kind == 'minor_road' and det in ('residential', 'unclassified', 'living_street') and pr.get('name'): return 'street'
    return None

shapes = json.load(open(os.path.join(ROOT, 'data', 'cvtd-shapes.json')))['lines']
lat0 = sum(c[1] for l in shapes for c in l['coords']) / sum(len(l['coords']) for l in shapes)
lon0 = sum(c[0] for l in shapes for c in l['coords']) / sum(len(l['coords']) for l in shapes)
KX, KY = 111320 * math.cos(math.radians(lat0)), 110540
def xy(lon, lat): return ((lon - lon0) * KX, (lat - lat0) * KY)

def tile_of(lon, lat):
    n = 2 ** Z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y
def lonlat(x, y):
    n = 2 ** Z
    def f(px, py):
        return ((x + px / EXTENT) / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / EXTENT) / n)))))
    return f

_tiles = {}
def roads_in(tx, ty):
    """Road segments (in metres, with their class) and true endpoints (with the next vertex in, and the class)
    of the public streets in one tile."""
    if (tx, ty) in _tiles: return _tiles[(tx, ty)]
    segs, ends = [], []
    p = os.path.join(TILES, str(Z), str(tx), str(ty) + '.pbf')
    if os.path.exists(p):
        b = open(p, 'rb').read()
        if b[:2] == b'\x1f\x8b': b = gzip.decompress(b)
        conv = lonlat(tx, ty)
        for f in mvt.decode(b, default_options={'y_coord_down': True}).get('roads', {}).get('features', []):
            pr = f['properties']
            cls = street(pr)
            if not cls: continue
            g = f['geometry']
            for line in (g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]):
                pts = [xy(*conv(px, py)) for px, py in line]
                if len(pts) < 2: continue
                segs.extend((a, b, cls) for a, b in zip(pts[:-1], pts[1:]))
                for (px, py), pt, nxt in ((line[0], pts[0], pts[1]), (line[-1], pts[-1], pts[-2])):
                    if EDGE <= px <= EXTENT - EDGE and EDGE <= py <= EXTENT - EDGE: ends.append((pt, nxt, cls))
    _tiles[(tx, ty)] = (segs, ends)
    return segs, ends

def cross(p, q, a, b):
    """Where segment pq meets ab, as (t along pq, u along ab), or None."""
    d = (q[0] - p[0]) * (b[1] - a[1]) - (q[1] - p[1]) * (b[0] - a[0])
    if abs(d) < 1e-9: return None
    t = ((a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0])) / d
    u = ((a[0] - p[0]) * (q[1] - p[1]) - (a[1] - p[1]) * (q[0] - p[0])) / d
    return (t, u) if 0 <= t <= 1 and 0 <= u <= 1 else None
def angle(p, q, a, b):
    d1 = math.atan2(q[1] - p[1], q[0] - p[0]); d2 = math.atan2(b[1] - a[1], b[0] - a[0])
    x = abs(math.degrees(d1 - d2)) % 180
    return min(x, 180 - x)
def proj(p, q, pt):
    """Distance from pt to segment pq, and where along it."""
    vx, vy = q[0] - p[0], q[1] - p[1]; L2 = vx * vx + vy * vy
    u = 0 if L2 == 0 else max(0, min(1, ((pt[0] - p[0]) * vx + (pt[1] - p[1]) * vy) / L2))
    cx, cy = p[0] + u * vx, p[1] + u * vy
    return math.hypot(pt[0] - cx, pt[1] - cy), u

out = {}
for l in shapes:
    pts = [xy(*c) for c in l['coords']]
    cum = [0.0]
    for p, q in zip(pts[:-1], pts[1:]): cum.append(cum[-1] + math.hypot(q[0] - p[0], q[1] - p[1]))
    tiles = {tile_of(*c) for c in l['coords']}
    tiles |= {(x + dx, y + dy) for x, y in list(tiles) for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
    segs, ends = [], []
    for t in tiles: s, e = roads_in(*t); segs.extend(s); ends.extend(e)
    # bucket the roads so each shape segment only looks nearby
    cell = 120
    grid = {}
    for s in segs:
        for gx in range(int(min(s[0][0], s[1][0]) // cell), int(max(s[0][0], s[1][0]) // cell) + 1):
            for gy in range(int(min(s[0][1], s[1][1]) // cell), int(max(s[0][1], s[1][1]) // cell) + 1):
                grid.setdefault((gx, gy), []).append(s)
    egrid = {}
    for e in ends: egrid.setdefault((int(e[0][0] // cell), int(e[0][1] // cell)), []).append(e)
    events = []   # (distance, kind): 'x' a street crossing through, ('t', side, class) a street ending at the route
    for i, (p, q) in enumerate(zip(pts[:-1], pts[1:])):
        L = cum[i + 1] - cum[i]
        if L == 0: continue
        cells = {(gx, gy) for gx in range(int(min(p[0], q[0]) // cell) - 1, int(max(p[0], q[0]) // cell) + 2) for gy in range(int(min(p[1], q[1]) // cell) - 1, int(max(p[1], q[1]) // cell) + 2)}
        seen = set()
        for c in cells:
            for s in grid.get(c, []):
                if id(s) in seen: continue
                seen.add(id(s))
                if angle(p, q, s[0], s[1]) < CROSS_ANGLE: continue
                x = cross(p, q, s[0], s[1])
                if x: events.append((cum[i] + x[0] * L, 'x'))
            for e, nxt, cls in egrid.get(c, []):
                d, u = proj(p, q, e)
                if d > TOUCH or angle(p, q, e, nxt) < CROSS_ANGLE: continue
                side = (q[0] - p[0]) * (nxt[1] - p[1]) - (q[1] - p[1]) * (nxt[0] - p[0]) > 0   # which side the street goes off to
                events.append((cum[i] + u * L, 't', side, cls))
    # An intersection is a street continuing across the route (one way crossing, or ways ending at it from both
    # sides, as OSM often splits them), or a bigger road meeting it from one side. A residential dead end is not.
    events.sort()
    merged = []
    for ev in events:
        if merged and ev[0] - merged[-1][0] <= 12: merged[-1][1].append(ev)
        else: merged.append([ev[0], [ev]])
    keep = []
    for d, evs in merged:
        sides = {e[2] for e in evs if e[1] == 't'}
        if any(e[1] == 'x' for e in evs) or len(sides) == 2 or any(e[1] == 't' and e[3] == 'big' for e in evs): keep.append(d)
    out[l['shape']] = [round(d) for d in keep]
p = os.path.join(ROOT, 'data', 'crossings.json')
json.dump(out, open(p, 'w'), separators=(',', ':'))
print('wrote', p, os.path.getsize(p), 'bytes:', sum(len(v) for v in out.values()), 'intersections on', len(out), 'shapes')
for l in shapes: print('  route %2d shape %s: %3d intersections over %.1f km' % (l['route'], l['shape'], len(out[l['shape']]), sum(math.hypot(b[0]-a[0], b[1]-a[1]) for a, b in zip([xy(*c) for c in l['coords']][:-1], [xy(*c) for c in l['coords']][1:])) / 1000))
