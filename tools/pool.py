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
stops = []
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
    if near:
        lon, lat = near[0]['geometry']['coordinates'][:2]
        stops.append({'id': near[0]['gtfsStopId'], 'name': hub['name'], 'lat': round(lat, 5), 'lon': round(lon, 5), 'stop': None, 'hub': True})
stops.sort(key=lambda s: s['name'])

# The area as drawn, all of it measured as a walk is: metres on foot, the height between two points counted as CLIMB
# metres on the flat a metre (a hill as it feels), so nothing reaches up a canyon side or off a bench. Each pickup
# pulls the outline round it out to about a walk's reach (R); where pickups are near one another (metaballs: the
# outline where their pulls add up to LEVEL) they run together into one shape. Groups (three places or more, each
# within GROUP of the next) are drawn as one region, joined through a lone place between them (River Heights,
# between the Cliffside bench and Providence) by a soft band along the walk; a place on its own is a small round.
# A pickup among more bus stops POOL doesn't serve than other pickups (South Walmart's, by Main and Highway 165) is set apart as a small
# round too, rather than drawing the region over those stops, and those stops push the region's edge back. The
# zone itself, Remix's outline, stays for asking whether a place is inside; it's a planning line, not a walk.
R, R_SMALL, LEVEL, CELL, GROUP = 420, 180, 0.5, 30, 900   # R: about five minutes on foot
R_BAND, W_BAND = 300, 0.22   # the band drawing groups together
SAME, MIN_GROUP, ON_WAY, BUSY = 40, 3, 1.3, 3
R_PUSH, W_PUSH, KEEP = 300, 0.4, 40   # a bus stop's push back; a bus stop this near a pickup is that pickup
CLIMB = 8
lat0 = sum(s['lat'] for s in stops) / len(stops); kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
pts = [((s['lon']) * kx, s['lat'] * ky) for s in stops]
try:
    EL = json.load(open(os.path.join(ROOT, 'data', 'elevation.json')))
    EL['z'] = [[sum(r[:k + 1]) for k in range(len(r))] for r in EL['d']]
except Exception: EL = None
def height(x, y):
    if not EL: return None
    lat, lon = y / ky, x / kx
    r, c = (EL['lat0'] - lat) / EL['dlat'] - 0.5, (lon - EL['lon0']) / EL['dlon'] - 0.5
    if r < 0 or c < 0 or r > EL['rows'] - 1 or c > EL['cols'] - 1: return None
    r0, c0 = int(r), int(c); fr, fc = r - r0, c - c0; z = EL['z']; r1, c1 = min(r0 + 1, EL['rows'] - 1), min(c0 + 1, EL['cols'] - 1)
    return z[r0][c0] * (1 - fc) * (1 - fr) + z[r0][c1] * fc * (1 - fr) + z[r1][c0] * (1 - fc) * fr + z[r1][c1] * fc * fr
dist = lambda a, b: math.hypot(a[0] - b[0], a[1] - b[1])
def walk2(a, ha, b, hb):   # metres on foot, squared
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + ((CLIMB * (ha - hb)) ** 2 if ha is not None and hb is not None else 0)
walk = lambda a, b: math.sqrt(walk2(a, height(*a), b, height(*b)))
places = []   # places, not points: pickups within SAME are one (two at the Tabernacle, one spot)
for p in pts:
    if not any(dist(p, q) <= SAME for q in places): places.append(p)
push = [(b['lon'] * kx, b['lat'] * ky) for b in D['stops'] if not b.get('hub')]   # the Center's bays: its pickup is at them
push = [q for q in push if not any(dist(q, p) <= KEEP for p in pts)]
def busy(p):
    n = sum(1 for q in push if walk(p, q) <= R)
    return n >= BUSY and n > sum(1 for q in places if q is not p and walk(p, q) <= R)   # more bus stops than other pickups (South Walmart's)
outliers = [p for p in places if busy(p)]
clusters = []
for p in places:   # single-linkage, by the walk: a place joins every cluster it's near, and those merge
    if p in outliers: continue
    near = [g for g in clusters if any(walk(p, q) <= GROUP for q in g)]
    clusters = [g for g in clusters if g not in near] + [[p] + [q for g in near for q in g]]
groups = [g for g in clusters if len(g) >= MIN_GROUP]
alone = [p for g in clusters if len(g) < MIN_GROUP for p in g] + outliers
grouped = [p for g in groups for p in g]
bridges, joined = [], [groups[0]] if groups else []
rest = groups[1:]
while rest:   # Prim's: the nearest group to those joined, by its closest pair of places on foot
    a, b, g = min(((a, b, g) for g in rest for b in g for j in joined for a in j), key=lambda t: walk(t[0], t[1]))
    via = min((c for c in alone if c not in outliers), key=lambda c: walk(a, c) + walk(c, b), default=None)
    if via is not None and walk(a, via) + walk(via, b) <= ON_WAY * walk(a, b): bridges += [(a, via), (via, b)]
    else: bridges.append((a, b))
    joined.append(g); rest.remove(g)
via_places = {c for a, b in bridges for c in (a, b) if c in alone}   # a lone place a bridge runs through: part of the region
band = []   # along each bridge, a point every 150 m
for a, b in bridges:
    n = max(1, int(dist(a, b) / 150))
    band += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n + 1)]
H_ = lambda ps: [(p, height(*p)) for p in ps]
region, band, push = H_(grouped + list(via_places)), H_(band), H_(push)
lone = H_([p for p in alone if p not in via_places])
x0, x1 = min(p[0] for p in pts) - 2 * R, max(p[0] for p in pts) + 2 * R
y0, y1 = min(p[1] for p in pts) - 2 * R, max(p[1] for p in pts) + 2 * R
nx, ny = int((x1 - x0) / CELL) + 1, int((y1 - y0) / CELL) + 1
def pull(x, y, h, ps, r, w=1.0):
    return sum(w * math.exp(-walk2((x, y), h, p, hp) / r ** 2) for p, hp in ps if abs(x - p[0]) < 3 * r and abs(y - p[1]) < 3 * r)
def cell(x, y):
    h = height(x, y)
    return max(pull(x, y, h, lone, R_SMALL), pull(x, y, h, region, R) + pull(x, y, h, band, R_BAND, W_BAND) - pull(x, y, h, push, R_PUSH, W_PUSH))
field = [[cell(x0 + i * CELL, y0 + j * CELL) for i in range(nx)] for j in range(ny)]
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
rings = [closed(r, 6) for r in rings]
outer = [r for r in rings if sum(contains(o, r[0]) for o in rings if o is not r) % 2 == 0]
area = [[[lonlat(p) for p in o]] + [[lonlat(p) for p in h] for h in rings if h not in outer and contains(o, h[0])] for o in outer]
json.dump({'from': 'Connect, via Remix', **INFO, 'zone': ZONE, 'area': area, 'stops': stops}, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
print(f"{len(area)} blobs ({len(groups)} groups, joined through {len(via_places)} places; {len(alone) - len(via_places)} on their own, {len(outliers)} of them set apart among bus stops), {sum(len(p[0]) for p in area)} points;", file=sys.stderr)
print(f"{len(stops)} POOL pickup points ({sum(1 for s in stops if s['stop'] is not None)} of them bus stops too), {os.path.getsize(OUT) // 1024} KB", file=sys.stderr)
