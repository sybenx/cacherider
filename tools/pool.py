#!/usr/bin/env python3
"""POOL, Connect's on-demand ride: its service area and its pickup points, for the map and search.

  python3 tools/pool.py        # needs data/cvtd.json; writes data/pool.json

POOL isn't in the GTFS. Connect's website embeds the zone from Remix (platform.remix.com, the planning tool whose
Via arm runs the ride), and Remix's public map API lists every stop the agency has drawn there, POOL's pickup
points among them. The zone's outline isn't served by that API: it was read off the embed's own map on
2026-09-28 (the page's Mapbox instance, source 'zones-…') and is kept below. A pickup point is a Remix stop inside
it. To refresh the outline: open https://rideconnectutah.gov/map/pool/'s iframe, and in the console,
  window._mapboxInstance.getStyle().sources[Object.keys(...).find(k => k.startsWith('zones-'))].data.features[0].geometry.coordinates[0]
Hours and the phone number are from https://rideconnectutah.gov/pool/. Nothing here is fetched while a rider uses the app.
"""
import json, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'pool.json')
MAP_API = 'https://platform.remix.com/api/maps/4909032d'   # Connect's published map, from the embed's requests
ZONE = [[-111.8316,41.74086],[-111.83173,41.74086],[-111.83184,41.74059],[-111.83207,41.73901],[-111.83238,41.73722],[-111.83247,41.73523],[-111.83258,41.73213],[-111.83345,41.72557],[-111.82707,41.72512],[-111.82629,41.72511],[-111.82628,41.7206],[-111.82638,41.71942],[-111.82122,41.71917],[-111.82129,41.71647],[-111.82518,41.71536],[-111.82825,41.71416],[-111.82955,41.71238],[-111.82941,41.7114],[-111.82973,41.71039],[-111.83307,41.71046],[-111.83722,41.71047],[-111.8372,41.71],[-111.83417,41.70999],[-111.83245,41.70659],[-111.83525,41.70221],[-111.82494,41.70146],[-111.82557,41.69444],[-111.82576,41.68742],[-111.83222,41.68608],[-111.83182,41.68372],[-111.82769,41.68264],[-111.83062,41.67692],[-111.82752,41.67736],[-111.8098,41.6755],[-111.81002,41.6764],[-111.81288,41.67733],[-111.81323,41.69236],[-111.80853,41.69633],[-111.80504,41.7045],[-111.80087,41.70582],[-111.80912,41.70857],[-111.80933,41.71207],[-111.8093,41.72804],[-111.80789,41.72943],[-111.80669,41.72968],[-111.80613,41.72918],[-111.80599,41.72882],[-111.80471,41.72844],[-111.80343,41.72831],[-111.79931,41.7283],[-111.79938,41.73211],[-111.80613,41.73194],[-111.80637,41.7314],[-111.80651,41.73102],[-111.80689,41.73077],[-111.80761,41.73047],[-111.80855,41.7298],[-111.80935,41.72887],[-111.81102,41.72767],[-111.81614,41.72596],[-111.82109,41.72546],[-111.83319,41.72563],[-111.83233,41.73222],[-111.83222,41.73722],[-111.8316,41.74086]]
INFO = {
    'name': 'POOL', 'brand': 'Connect', 'phone': '435-753-2255', 'url': 'https://rideconnectutah.gov/pool/',
    'hours': 'Monday to Friday 6:15 AM to 8:45 PM, Saturday 9:45 AM to 6:30 PM, no Sunday service',
    'towns': ['Providence', 'Millville', 'River Heights', 'Cliffside', 'south Logan'],
    'android': 'https://play.google.com/store/apps/details?id=com.ridewithvia.connecttransit',
    'ios': 'https://apps.apple.com/us/app/connect-on-demand-by-via/id6754680175',
}

def inside(lon, lat, ring):
    c = False
    for i in range(len(ring)):
        x1, y1 = ring[i]; x2, y2 = ring[i - 1]
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1: c = not c
    return c

D = json.load(open(os.path.join(ROOT, 'data', 'cvtd.json')))
fixed = {s['id']: i for i, s in enumerate(D['stops'])}
req = urllib.request.Request(MAP_API, headers={'User-Agent': 'cacherider-pool/1.0 (+https://cacherider.com)', 'Accept': 'application/json'})
places = json.load(urllib.request.urlopen(req, timeout=60))['stops']
# The zone and its pickups, from the project the embed shows (its on-demand zone 'POOL'): the zone's outline, and its
# own named places, the pickup points Connect's page draws (parks, the Walmarts, the Center, a street corner in
# Cliffside), 48 when written. The outline kept above is the fallback for a day the project can't be read. A pickup
# at a bus stop (within 30 m of one in the timetable) carries that stop, so the stop's page says it's a pickup too.
PROJECT_API = 'https://platform.remix.com/api/projects/d203b573'
pickups = []
try:
    proj = json.load(urllib.request.urlopen(urllib.request.Request(PROJECT_API, headers={'User-Agent': 'cacherider-pool/1.0 (+https://cacherider.com)', 'Accept': 'application/json'}), timeout=60))
    zones = [z for sc in proj.get('scenarios', []) for z in sc.get('onDemandZones', []) if not z.get('isHidden')]
    zone = next((z for z in zones if (z.get('name') or '').strip().upper() == 'POOL'), zones[0] if zones else None)
    if zone and zone.get('geometry', {}).get('type') == 'Polygon':
        ZONE = [[round(x, 5), round(y, 5)] for x, y in zone['geometry']['coordinates'][0]]
        pickups = [q for q in zone.get('places', []) if q.get('geometry', {}).get('type') == 'Point']
except Exception as e: print('the POOL zone not read from the project; the outline kept here stands:', e, file=sys.stderr)
import math as _m
def _near(lon, lat):
    best = None
    for i, s_ in enumerate(D['stops']):
        d = _m.hypot((s_['lon'] - lon) * 111320 * _m.cos(_m.radians(lat)), (s_['lat'] - lat) * 110540)
        if d <= 30 and (best is None or d < best[0]): best = (d, i)
    return best[1] if best else None
stops = []
if pickups:
    for q in pickups:
        lon, lat = q['geometry']['coordinates'][:2]
        name = ' '.join(str(q.get('label') or '').replace('(', ' (').split())
        si = _near(lon, lat)
        stops.append({'id': D['stops'][si]['id'] if si is not None else 'p-' + str(q['id']), 'name': name, 'lat': round(lat, 5), 'lon': round(lon, 5), 'stop': si})
else:
    for p in places:
        lon, lat = p['geometry']['coordinates']
        if p.get('ghost') or not inside(lon, lat, ZONE): continue
        name = ' '.join(p['name'].replace('(', ' (').split())   # '5 North Main(Providence City Hall)' reads as two words
        stops.append({'id': p['gtfsStopId'], 'name': name, 'lat': round(lat, 5), 'lon': round(lon, 5), 'stop': fixed.get(p['gtfsStopId'])})
# The Transit Center: the zone reaches up to it (a strip along 100 East) to serve it, but its pickup there stands at
# the bays, just outside the strip, and the test above loses it. Where the zone comes within the Center's own radius
# (as far out as its bays go), the pickup at the Center is kept: the one Remix names for the Center, else its nearest.
import math
def metres(a, b): return math.hypot((a[0] - b[0]) * 111320 * math.cos(math.radians(a[1])), (a[1] - b[1]) * 110540)
hub = D['hub']; H = (hub['lon'], hub['lat'])
reach = max([metres(H, (s['lon'], s['lat'])) for s in D['stops'] if s.get('hub')] or [150]) + 20
if min(metres(H, v) for v in ZONE) <= reach and not any(metres(H, (s['lon'], s['lat'])) <= reach for s in stops):
    near = [p for p in places if not p.get('ghost') and metres(H, p['geometry']['coordinates'][:2]) <= reach]
    near.sort(key=lambda p: (hub['name'].lower() not in p['name'].lower(), metres(H, p['geometry']['coordinates'][:2])))
    # Where it stands, OpenStreetMap knows better than Remix (whose point is the middle of the bays), and the map's
    # own tiles (tiles/, our copy of it) have it: a bus stop named for POOL within the Center's reach (OSM node
    # 12873238387 when written). Read off disk, so it follows OpenStreetMap whenever the tiles are cut afresh;
    # Remix's point only where the tiles have none.
    osm = None
    try:
        import gzip
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import mapbox_vector_tile as mvt
        from roads import tile_of, lonlat as tile_lonlat, TILES, Z
        tx, ty = tile_of(hub['lon'], hub['lat'])
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                f = os.path.join(TILES, str(Z), str(tx + dx), str(ty + dy) + '.pbf')
                if not os.path.exists(f): continue
                b = open(f, 'rb').read()
                if b[:2] == b'\x1f\x8b': b = gzip.decompress(b)
                conv = tile_lonlat(tx + dx, ty + dy)
                for ft in mvt.decode(b, default_options={'y_coord_down': True}).get('pois', {}).get('features', []):
                    pr, g = ft['properties'], ft['geometry']
                    if pr.get('kind') != 'bus_stop' or str(pr.get('name', '')).strip().lower() != 'pool' or g['type'] != 'Point': continue
                    at = conv(*g['coordinates'])
                    if metres(H, at) <= reach and (osm is None or metres(H, at) < metres(H, osm)): osm = at
    except Exception as e: print("the Center's POOL stop not read from the tiles:", e, file=sys.stderr)
    if near or osm:
        lon, lat = osm if osm else near[0]['geometry']['coordinates'][:2]
        stops.append({'id': near[0]['gtfsStopId'] if near else 'osm-pool', 'name': hub['name'], 'lat': round(lat, 5), 'lon': round(lon, 5), 'stop': None, 'hub': True})
# A pickup at a bus stop carries that stop's own GTFS id (seven digits, as every stop in the timetable has; POOL's own
# points have Remix's short numbers). One whose bus stop has left the timetable stands at a stop that's gone (36 W
# 1200 S, South Walmart's Blue Loop stop, out during construction): marked gone, covering nothing, for as long as
# the timetable leaves it out; the first night it's back, so is the pickup. Nothing to undo by hand.
lengths = {len(s_['id']) for s_ in D['stops'] if s_['id'].isdigit()}
for s_ in stops:
    if s_['id'].isdigit() and len(s_['id']) in lengths and s_['id'] not in fixed: s_['gone'] = True
# A named pickup (the project's own point) standing at a stop on Connect's map (within 30 m of one drawn there, not
# a ghost) whose id has left the timetable: the same, gone. The project's point for Les Schwab stays where the Blue
# Loop's stop was while the timetable has no stop there; the agency's own map still draws the stop.
for s_ in stops:
    if s_.get('gone') or s_.get('hub') or s_['id'].isdigit(): continue
    for p in places:
        gid = str(p.get('gtfsStopId') or '')
        if p.get('ghost') or not gid.isdigit() or len(gid) not in lengths or gid in fixed: continue   # a timetable stop's id, not a POOL point's short number
        lon, lat = p['geometry']['coordinates'][:2]
        if _m.hypot((s_['lon'] - lon) * 111320 * _m.cos(_m.radians(lat)), (s_['lat'] - lat) * 110540) <= 30: s_['gone'] = True; s_['was'] = gid; break
stops.sort(key=lambda s: s['name'])

# The area as POOL covers it: every street and path where a POOL pickup is the nearest stop on foot, within a walk
# most riders will make (WALK, the planner's five minutes). On foot along the streets and paths of the map's own
# tiles (tools/roads.py), a climb costing CLIMB metres on the flat a metre up (none down). Bus stops compete: a street
# nearer a bus stop POOL doesn't serve is the bus's, not POOL's (the Center's bays too, so the Center isn't washed blue).
# Drawn as an area, not a skeleton: each covered street widened by about BUF, near streets running together across
# the block between (their pulls summed), small gaps filled, the outline rounded and simplified. The zone itself, Remix's outline, stays for asking
# whether a place is inside; it's a planning line, not a walk.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from roads import Roads
import heapq
WALK, CLIMB, BUF, CELL, LEVEL, KEEP, SAME = 400, 8, 70, 20, 0.5, 40, 40
STEP = 15   # metres between the points a covered street is drawn by
HOLE, SPECK, SMOOTH = 40000, 2500, 10   # m²: a gap inside smaller than two blocks is filled, a patch smaller than a lot dropped; m: simplified to
lat0 = sum(s['lat'] for s in stops) / len(stops); kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
try:
    EL = json.load(open(os.path.join(ROOT, 'data', 'elevation.json')))
    EL['z'] = [[sum(r[:k + 1]) for k in range(len(r))] for r in EL['d']]
except Exception: EL = None
def height(lon, lat):
    if not EL: return 0
    r, c = (EL['lat0'] - lat) / EL['dlat'] - 0.5, (lon - EL['lon0']) / EL['dlon'] - 0.5
    if r < 0 or c < 0 or r > EL['rows'] - 1 or c > EL['cols'] - 1: return 0
    r0, c0 = int(r), int(c); fr, fc = r - r0, c - c0; z = EL['z']; r1, c1 = min(r0 + 1, EL['rows'] - 1), min(c0 + 1, EL['cols'] - 1)
    return z[r0][c0] * (1 - fc) * (1 - fr) + z[r0][c1] * fc * (1 - fr) + z[r1][c0] * (1 - fc) * fr + z[r1][c1] * fc * fr
far = lambda a, b: math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * ky)
picks = []
# A pickup among more bus stops than POOL pickups (downtown's Tabernacle, the Center, South Walmart) covers only
# scraps between them, streaks that read as nothing: drawn as its pickup alone, no area.
BUSY = 3
everyone = [(b['lon'], b['lat']) for b in D['stops']]
in_use = [(s_['lon'], s_['lat']) for s_ in stops if not s_.get('gone')]
def busy(q):
    nb = sum(1 for b in everyone if far(b, q) <= WALK and not any(far(b, o) <= KEEP for o in in_use))
    return nb >= BUSY and nb > sum(1 for o in in_use if o != q and far(o, q) <= WALK)
for s_ in stops:
    if s_.get('gone'): continue
    q = (s_['lon'], s_['lat'])
    if busy(q): s_['alone'] = True; continue
    if not any(far(q, p_) <= SAME for p_ in picks): picks.append(q)
buses = [(b['lon'], b['lat']) for b in D['stops'] if not any(far((b['lon'], b['lat']), p_) <= KEEP for p_ in picks)]   # the Center's bays too: there the bus is the thing
lo0, la0 = min(p_[0] for p_ in picks) - 0.012, min(p_[1] for p_ in picks) - 0.009
lo1, la1 = max(p_[0] for p_ in picks) + 0.012, max(p_[1] for p_ in picks) + 0.009
buses = [b for b in buses if lo0 <= b[0] <= lo1 and la0 <= b[1] <= la1]
roads = Roads(picks, margin=0.012, kinds={'major_road', 'medium_road', 'minor_road', 'path', 'other'}, slow={})
H = {}
def hk(k):
    if k not in H: H[k] = height(*roads.lonlat_of(k))
    return H[k]
def cost(u, v, c): return c + CLIMB * max(0, hk(v) - hk(u))   # from u to v; a rider walks to the stop, so it's run from the stops backwards
# Every stop at once (Dijkstra from many sources): each street point's nearest stop on foot, and which kind it is.
best, heap = {}, []
for kind, ps in (('pool', picks), ('bus', buses)):
    for p_ in ps:
        n = roads.snap(p_)
        d0 = roads.m(roads.key(p_), n)
        heapq.heappush(heap, (d0, n, kind))
while heap:
    d, u, kind = heapq.heappop(heap)
    if u in best: continue
    best[u] = (d, kind)
    if d > WALK * 2: continue
    for v, c in roads.adj[u].items():
        if v not in best: heapq.heappush(heap, (d + cost(v, u, c), v, kind))
# The bus's streets (nearest a bus stop, within the walk), as points every STEP, for pulling the drawing back.
bus_pts = []
for u in roads.adj:
    if not (u in best and best[u][1] == 'bus' and best[u][0] <= WALK): continue
    for v, c in roads.adj[u].items():
        if not (v in best and best[v][1] == 'bus') or v < u: continue
        (ax, ay), (bx, by) = roads.lonlat_of(u), roads.lonlat_of(v)
        n = max(1, int(c / STEP))
        bus_pts += [((ax + (bx - ax) * i / n) * kx, (ay + (by - ay) * i / n) * ky) for i in range(n + 1)]
def shape(walk):
    """The area within `walk` metres on foot of a pickup, where it's nearer than any bus stop: [polygon, ...]."""
    pool_at = lambda k: k in best and best[k][1] == 'pool' and best[k][0] <= walk
    # The covered streets, as points every 15 m, each edge cut where the bus stop's side or the walk's end begins.
    cov = []
    for u in roads.adj:
        if not pool_at(u): continue
        du = best[u][0]
        for v, c in roads.adj[u].items():
            if pool_at(v): t = 0.5   # both ends POOL's: each end draws its half
            elif v in best and best[v][1] == 'bus': t = max(0, min(1, (best[v][0] - du + c) / (2 * c))) if c else 0
            else: t = max(0, min(1, (walk - du) / c)) if c else 0
            (ax, ay), (bx, by) = roads.lonlat_of(u), roads.lonlat_of(v)
            n = max(1, int(c * t / STEP))
            cov += [((ax + (bx - ax) * t * i / n) * kx, (ay + (by - ay) * t * i / n) * ky) for i in range(n + 1)]
    if not cov: return []
    x0 = min(p_[0] for p_ in cov) - 3 * BUF; x1 = max(p_[0] for p_ in cov) + 3 * BUF
    y0 = min(p_[1] for p_ in cov) - 3 * BUF; y1 = max(p_[1] for p_ in cov) + 3 * BUF
    nx, ny = int((x1 - x0) / CELL) + 1, int((y1 - y0) / CELL) + 1
    field = [[0.0] * nx for _ in range(ny)]
    norm = STEP / (math.sqrt(math.pi) * BUF)   # a lone straight street sums to 1 along its middle
    for px, py in cov:   # each covered point adds its pull to the cells within 2 BUF of it
        for j in range(max(0, int((py - y0 - 2 * BUF) / CELL)), min(ny, int((py - y0 + 2 * BUF) / CELL) + 2)):
            for i in range(max(0, int((px - x0 - 2 * BUF) / CELL)), min(nx, int((px - x0 + 2 * BUF) / CELL) + 2)):
                field[j][i] += norm * math.exp(-((x0 + i * CELL - px) ** 2 + (y0 + j * CELL - py) ** 2) / BUF ** 2)
    # The bus's streets pull it back as much: widened alike, each edge comes to rest about halfway between a POOL
    # street and the bus's, where the walk splits, not out over the bus's side.
    for px, py in bus_pts:
        if not (x0 - 2 * BUF <= px <= x1 + 2 * BUF and y0 - 2 * BUF <= py <= y1 + 2 * BUF): continue
        for j in range(max(0, int((py - y0 - 2 * BUF) / CELL)), min(ny, int((py - y0 + 2 * BUF) / CELL) + 2)):
            for i in range(max(0, int((px - x0 - 2 * BUF) / CELL)), min(nx, int((px - x0 + 2 * BUF) / CELL) + 2)):
                field[j][i] -= norm * math.exp(-((x0 + i * CELL - px) ** 2 + (y0 + j * CELL - py) ** 2) / BUF ** 2)
    # marching squares: each cell's crossings of the level, as segments, joined into rings
    def cross(a, b, fa, fb): t = (LEVEL - fa) / (fb - fa); return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
    segs = []
    for j in range(ny - 1):
        for i in range(nx - 1):
            c = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            v = [field[y][x] for x, y in c]
            edges = []
            for k in range(4):
                (ax, ay), (bx, by), fa, fb = c[k], c[(k + 1) % 4], v[k], v[(k + 1) % 4]
                if (fa >= LEVEL) != (fb >= LEVEL): edges.append(cross((ax, ay), (bx, by), fa, fb))
            if len(edges) == 2: segs.append((edges[0], edges[1]))
            elif len(edges) == 4:   # a saddle: joined as the middle's value says
                mid = sum(v) / 4
                segs += [(edges[0], edges[1]), (edges[2], edges[3])] if (mid >= LEVEL) == (v[0] >= LEVEL) else [(edges[0], edges[3]), (edges[1], edges[2])]
    key = lambda p: (round(p[0], 6), round(p[1], 6))
    ends = {}
    for a, b in segs: ends.setdefault(key(a), []).append(b); ends.setdefault(key(b), []).append(a)
    rings, used = [], set()
    for a, b in segs:
        if (key(a), key(b)) in used: continue
        ring, prev, cur = [a], a, b
        used.add((key(a), key(b))); used.add((key(b), key(a)))
        while key(cur) != key(a):
            ring.append(cur)
            nxt = next((n for n in ends[key(cur)] if key(n) != key(prev) and (key(cur), key(n)) not in used), None)
            if nxt is None: break
            used.add((key(cur), key(nxt))); used.add((key(nxt), key(cur)))
            prev, cur = cur, nxt
        if len(ring) > 3: rings.append(ring)
    def simplify(r, tol):   # Douglas-Peucker on grid units
        if len(r) < 3: return r
        (ax, ay), (bx, by) = r[0], r[-1]
        d = [abs((by - ay) * (px - ax) - (bx - ax) * (py - ay)) / (math.hypot(bx - ax, by - ay) or 1) for px, py in r[1:-1]]
        i = max(range(len(d)), key=d.__getitem__) + 1
        return simplify(r[:i + 1], tol)[:-1] + simplify(r[i:], tol) if d[i - 1] > tol / CELL else [r[0], r[-1]]
    def lonlat(p): return [round((x0 + p[0] * CELL) / kx, 5), round((y0 + p[1] * CELL) / ky, 5)]
    def contains(ring, pt):
        c = False
        for i in range(len(ring)):
            (x1_, y1_), (x2_, y2_) = ring[i], ring[i - 1]
            if (y1_ > pt[1]) != (y2_ > pt[1]) and pt[0] < (x2_ - x1_) * (pt[1] - y1_) / (y2_ - y1_) + x1_: c = not c
        return c
    def closed(r, tol):   # a loop simplified in two halves, from its first point to the point farthest from it and back
        far = max(range(len(r)), key=lambda i: math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]))
        return simplify(r[:far + 1], tol)[:-1] + simplify(r[far:] + [r[0]], tol)
    def chaikin(r, n=2):   # corners cut, twice: a stair-step from the grid rounded off
        for _ in range(n):
            r = [p for a, b in zip(r, r[1:] + r[:1]) for p in ((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]), (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))]
        return r
    def size(r): return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(r, r[1:] + r[:1]))) / 2 * CELL * CELL   # m²
    rings = [closed(chaikin(r), SMOOTH) for r in rings]
    rings = [r for r in rings if len(r) > 3]
    outer = [r for r in rings if sum(contains(o, r[0]) for o in rings if o is not r) % 2 == 0 and size(r) >= SPECK]
    holes = [r for r in rings if r not in outer and size(r) >= HOLE]
    return [[[lonlat(p) for p in o]] + [[lonlat(p) for p in h] for h in holes if contains(o, h[0])] for o in outer]
# How far riders walk falls off with the distance, not at a line (distance decay): drawn as tiers, the easy walk
# (EASY, about Via's own average to a pickup and three minutes on foot) solid, fading out to the walk most will make
# (WALK, five minutes), so the edge reads as what it is.
EASY = 250
TIERS = [EASY, (EASY + WALK) // 2, WALK]
areas = [{'walk': w, 'area': shape(w)} for w in TIERS]
area = areas[-1]['area']
# Its hours as minutes a weekday (Monday first; null, not running), read from the sentence on Connect's POOL page
# ('Monday to Friday 6:15 AM to 8:45 PM, Saturday 9:45 AM to 6:30 PM, no Sunday service'), for greying its pickups
# out of hours.
import re
DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
def mins(t):
    m = re.match(r'(\d{1,2})(?::(\d\d))?\s*([ap])\.?m', t.strip(), re.I)
    h = int(m.group(1)) % 12 + (12 if m.group(3).lower() == 'p' else 0)
    return h * 60 + int(m.group(2) or 0)
week = [None] * 7
for part in INFO['hours'].split(','):
    m = re.search(r'(\w+day)(?:\s+(?:to|-|–)\s+(\w+day))?\s+(\d[\d:]*\s*[ap]\.?m\.?)\s+(?:to|-|–)\s+(\d[\d:]*\s*[ap]\.?m\.?)', part, re.I)
    if not m: continue
    a_, b_ = DAYS.index(m.group(1).lower()), DAYS.index((m.group(2) or m.group(1)).lower())
    for d in range(a_, b_ + 1): week[d] = [mins(m.group(3)), mins(m.group(4))]
print('POOL hours by weekday:', week, file=sys.stderr)
json.dump({'from': 'Connect, via Remix', **INFO, 'week': week, 'zone': ZONE, 'area': area, 'tiers': areas, 'stops': stops}, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
print(f"covered on foot, {len(picks)} pickups against {len(buses)} bus stops: " + ', '.join(f"{a['walk']} m: {len(a['area'])} areas, {sum(len(r) for poly in a['area'] for r in poly)} points" for a in areas), file=sys.stderr)
print(f"gone (their bus stop left the timetable): {[s_['name'] for s_ in stops if s_.get('gone')]}; no area (among bus stops): {[s_['name'] for s_ in stops if s_.get('alone')]}", file=sys.stderr)
print(f"{len(stops)} POOL pickup points ({sum(1 for s in stops if s['stop'] is not None)} of them bus stops too), {os.path.getsize(OUT) // 1024} KB", file=sys.stderr)
