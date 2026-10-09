#!/usr/bin/env python3
"""The ways a rider can walk, from OpenStreetMap: data/walknet.json.

Walks were worked out as the crow flies (app/geo.js), bent only round a busy road to its crossing (tools/walks.py).
That's fair on a town's grid and wrong wherever the straight line isn't a way: down the bluff from 400 North to the
Island (the Canal Connector Trail and its steps, Canal Road), round the river, a fenced campus, a cul-de-sac. This is
the network itself: footways, paths, steps, sidewalks and crossings, and the streets a rider walks along, within a
walk of a stop. Kept are its junctions and the shape between them; the app finds a walk along it and measures its
climb on the elevation grid.

From OpenStreetMap, once a night (data.yml), one query:
  - highway footway, path, steps, pedestrian, living_street, residential, service, unclassified, tertiary, secondary,
    primary, trunk (and their _link), cycleway, track, corridor; not where foot=no, access=private or no (but
    foot=yes|designated|permissive overrides), not area=yes, not a motorway;
  - within WALK metres of a stop (the ways reaching that far, whole).

  python3 tools/walknet.py            # → data/walknet.json
  OSM_CACHE=/tmp/net.json python3 tools/walknet.py   # Overpass asked once, its answer kept there (working on this)

Written as { n: [lat, lon, ...] (1e-5 degrees, each a delta from the one before), e: [[da, db, kind, shape...]] }:
`n` the junctions and ends, in map order; `e` the ways between them, a to b (a as a step from the edge before's, b
as a step on from a), `kind` one letter (s steps, f footway or path or sidewalk, x a crossing, r a street, b a busy
road: as tools/walks.py has it, crossed only at its lights and marked crossings), `shape` the points between as deltas, in 1e-5 degrees. Lengths the app's to work
out. Nothing here is Cache Valley's own: any valley's OSM gives the same.
"""
import json, math, os, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'walknet.json')
WALK = 2000      # metres from a stop: as far as the app looks for a walk to one, and more
MARGIN = 0.03    # degrees round the stops for the query

WAYS = 'footway|path|steps|pedestrian|living_street|residential|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|trunk|trunk_link|cycleway|track|corridor|road'


def dist(a, b):
    k = math.cos(math.radians(a[0]))
    return math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * k)


def walkable(t):
    if t.get('area') == 'yes': return False
    foot = t.get('foot', '')
    if foot in ('yes', 'designated', 'permissive'): return True
    if foot == 'no' or t.get('access') in ('private', 'no'): return False
    # A house's driveway, a drive-through lane, an emergency gate: dead ends, nobody's way anywhere. A parking lot's
    # aisles are kept: a walk cuts through one. A farm track, not unless it's named or marked for walking.
    if t.get('highway') == 'service' and t.get('service') in ('driveway', 'drive-through', 'emergency_access'): return False
    if t.get('highway') == 'track' and not t.get('name'): return False
    return True


def simplify(pts, tol=2.5):
    """Douglas-Peucker, metres: a path's shape to within a pace."""
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]
    k = math.cos(math.radians(a[0]))
    def off(p):
        ax, ay, bx, by, px, py = a[1] * k, a[0], b[1] * k, b[0], p[1] * k, p[0]
        dx, dy = bx - ax, by - ay
        if dx == dy == 0: return dist(p, a)
        u = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return dist(p, (ay + u * dy, (ax + u * dx) / k))
    i, m = max(((i, off(p)) for i, p in enumerate(pts[1:-1], 1)), key=lambda x: x[1])
    return simplify(pts[:i + 1], tol)[:-1] + simplify(pts[i:], tol) if m > tol else [a, b]


def zorder(p):
    """A point's place along a Z curve over the valley: near on the map, near in the order."""
    x, y = int((p[1] + 113) * 20000), int((p[0] - 41) * 20000)
    z = 0
    for i in range(16): z |= ((x >> i) & 1) << (2 * i) | ((y >> i) & 1) << (2 * i + 1)
    return z


def kind(t):
    h = t.get('highway', '')
    if h == 'steps': return 's'
    if h == 'footway' and t.get('footway') == 'crossing': return 'x'
    if h in ('footway', 'path', 'pedestrian', 'cycleway', 'corridor', 'track'): return 'f'
    # busy as tools/walks.py has it (its crossings, the lights and marked ones, the only ways over): a highway, or a
    # wide or fast town road. A two-lane 25 mph secondary street is a street, crossed anywhere.
    if busy(t): return 'b'
    return 'r'


def busy(t):
    h = t.get('highway', '').replace('_link', '')
    if h in ('trunk', 'primary'): return True
    if h != 'secondary': return False
    try: lanes = int((t.get('lanes') or '0').split(';')[0])
    except ValueError: lanes = 0
    mph = (t.get('maxspeed') or '').replace('mph', '').strip()
    return lanes >= 4 or (mph.isdigit() and int(mph) >= 40)


def main():
    stops = [(s['lat'], s['lon']) for s in json.load(open(os.path.join(ROOT, 'data', 'cvtd.json')))['stops']]
    try: stops += [(s['lat'], s['lon']) for s in json.load(open(os.path.join(ROOT, 'data', 'usu.json')))['stops']]
    except Exception: pass
    s, w = min(p[0] for p in stops) - MARGIN, min(p[1] for p in stops) - MARGIN
    n, e = max(p[0] for p in stops) + MARGIN, max(p[1] for p in stops) + MARGIN
    q = f'[out:json][timeout:240];way["highway"~"^({WAYS})$"]({s:.4f},{w:.4f},{n:.4f},{e:.4f});out body;>;out skel qt;'
    cache = os.environ.get('OSM_CACHE')
    els = json.load(open(cache)) if cache and os.path.exists(cache) else None
    servers = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
    for tries in range(0 if els is not None else 6):
        req = urllib.request.Request(servers[tries % 2], data=urllib.parse.urlencode({'data': q}).encode(),
                                     headers={'User-Agent': 'cacherider-walknet/1.0 (+https://cacherider.com)'})
        try:
            els = json.load(urllib.request.urlopen(req, timeout=300))['elements']
            if cache: json.dump(els, open(cache, 'w'))
            break
        except Exception as ex:
            if tries == 5: raise
            print('Overpass:', ex, '- again', file=sys.stderr); time.sleep(20 if tries % 2 == 0 else 60)
    pos = {el['id']: (el['lat'], el['lon']) for el in els if el['type'] == 'node'}
    ways = [el for el in els if el['type'] == 'way' and walkable(el.get('tags', {}))]
    # Near a stop: a grid of the stops, 0.02 degrees a cell, and each way kept whole if any of its points is near one.
    CELL = 0.02
    grid = {}
    for p in stops: grid.setdefault((int(p[0] // CELL), int(p[1] // CELL)), []).append(p)
    def near(p):
        ci, cj = int(p[0] // CELL), int(p[1] // CELL)
        return any(dist(p, q) <= WALK for di in (-1, 0, 1) for dj in (-1, 0, 1) for q in grid.get((ci + di, cj + dj), ()))
    ways = [wy for wy in ways if any(nd in pos and near(pos[nd]) for nd in wy['nodes'][::4] + wy['nodes'][-1:])]
    # Junctions: a node on two ways or more, or a way's end.
    uses = {}
    for wy in ways:
        for nd in wy['nodes']: uses[nd] = uses.get(nd, 0) + 1
        uses[wy['nodes'][0]] = uses.get(wy['nodes'][0], 0) + 1; uses[wy['nodes'][-1]] = uses.get(wy['nodes'][-1], 0) + 1
    # (a way meeting the next end to end, the same kind, isn't a junction: they're joined into one below)
    junction = {nd for nd, k in uses.items() if k >= 2}
    # Every way cut at its junctions: [a, b, kind, [the OSM nodes from a to b]].
    raw = []
    for wy in ways:
        k, nds = kind(wy.get('tags', {})), [nd for nd in wy['nodes'] if nd in pos]
        start = 0
        for i in range(1, len(nds)):
            if nds[i] in junction or i == len(nds) - 1:
                seg = nds[start:i + 1]
                if len(seg) >= 2 and seg[0] != seg[-1]: raw.append([seg[0], seg[-1], k, seg])
                start = i
    # Joined where two pieces of one kind meet end to end with nothing else there (a way split for its name or its
    # surface): one run between real junctions.
    at = {}
    for i, r in enumerate(raw):
        at.setdefault(r[0], []).append(i); at.setdefault(r[1], []).append(i)
    dead = set()
    for nd, ids in list(at.items()):
        ids = [i for i in ids if i not in dead]
        if len(ids) != 2: continue
        i, j = ids
        if i == j or raw[i][2] != raw[j][2]: continue
        A, B = raw[i], raw[j]
        sa = A[3] if A[1] == nd else A[3][::-1]   # ending at nd
        sb = B[3] if B[0] == nd else B[3][::-1]   # starting at nd
        if sa[0] == sb[-1]: continue   # a loop
        merged = sa + sb[1:]
        A[0], A[1], A[3] = merged[0], merged[-1], merged
        dead.add(j)
        for end in (B[0], B[1]):
            if end != nd: at[end] = [i if x == j else x for x in at[end]]
        at[nd] = []
    # Junctions numbered in map order (along a Z curve), so a way's two ends are near each other in the list and an
    # edge's numbers stay small: written as differences, the file is a third the size.
    raw = [r for i, r in enumerate(raw) if i not in dead]
    used = sorted({r[0] for r in raw} | {r[1] for r in raw}, key=lambda nd: zorder(pos[nd]))
    index = {nd: i for i, nd in enumerate(used)}
    nodes = [pos[nd] for nd in used]
    edges = []
    for s0, s1, k, seg in raw:
        a, b = index[s0], index[s1]
        pts = [pos[nd] for nd in seg]
        if a > b: a, b, pts = b, a, pts[::-1]
        shape, prev = [], pts[0]
        for p in simplify(pts)[1:-1]:
            shape += [round((p[0] - prev[0]) * 1e5), round((p[1] - prev[1]) * 1e5)]; prev = p
        edges.append((a, b, k, shape))
    edges.sort()
    out, pa = [], 0
    for a, b, k, shape in edges:
        out.append([a - pa, b - a, k] + shape); pa = a   # a from the edge before's, b from a; a way's length the app's to work out
    edges = out
    flat, prev = [], (0, 0)
    for la, lo in nodes:
        a, b = round(la * 1e5), round(lo * 1e5)
        flat += [a - prev[0], b - prev[1]]; prev = (a, b)
    doc = {'from': 'OpenStreetMap contributors', 'n': flat, 'e': edges}
    if len(edges) < 1000: sys.exit(f'only {len(edges)} ways: not kept')
    json.dump(doc, open(OUT, 'w'), separators=(',', ':'))
    print(f'wrote {os.path.relpath(OUT, ROOT)}: {len(nodes)} junctions, {len(edges)} ways ({sum(1 for x in edges if x[2] == "s")} steps), {os.path.getsize(OUT) // 1024} KB', file=sys.stderr)


if __name__ == '__main__':
    main()
