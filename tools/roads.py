"""A road graph from the map's own tiles, and the shortest drive through a list of
points: how a shuttle route with no drawn line gets one, traced along the streets
between its stops in order. Used by tools/usu.py; needs mapbox-vector-tile."""
import gzip, heapq, math, os
import mapbox_vector_tile as mvt

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
TILES = os.path.join(ROOT, 'tiles')
Z, EXTENT = 15, 4096
KINDS = {'highway', 'major_road', 'medium_road', 'minor_road'}
SLOW = {'service': 1.6, 'driveway': 3.0, 'parking_aisle': 2.5}   # a bus prefers a street, but will use a lane to reach a stop

def tile_of(lon, lat):
    n = 2 ** Z
    return int((lon + 180) / 360 * n), int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
def lonlat(x, y):
    n = 2 ** Z
    return lambda px, py: ((x + px / EXTENT) / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / EXTENT) / n)))))
def metres(a, b):
    return math.hypot((b[0] - a[0]) * 111320 * math.cos(math.radians((a[1] + b[1]) / 2)), (b[1] - a[1]) * 110540)

class Roads:
    def __init__(self, points, margin=0.02):
        lons = [p[0] for p in points]; lats = [p[1] for p in points]
        x0, y0 = tile_of(min(lons) - margin, max(lats) + margin); x1, y1 = tile_of(max(lons) + margin, min(lats) - margin)
        self.lat0, self.lon0 = sum(lats) / len(lats), sum(lons) / len(lons)
        self.adj = {}      # node → {node: cost}
        self.segs = []     # (a, b, weight)
        raw = []
        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                p = os.path.join(TILES, str(Z), str(tx), str(ty) + '.pbf')
                if not os.path.exists(p): continue
                b = open(p, 'rb').read()
                if b[:2] == b'\x1f\x8b': b = gzip.decompress(b)
                conv = lonlat(tx, ty)
                for f in mvt.decode(b, default_options={'y_coord_down': True}).get('roads', {}).get('features', []):
                    pr = f['properties']
                    if pr.get('kind') not in KINDS: continue
                    w = SLOW.get(pr.get('kind_detail'), 1.0)
                    g = f['geometry']
                    for line in (g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]):
                        pts = [self.key(conv(px, py)) for px, py in line]
                        for a, c in zip(pts[:-1], pts[1:]):
                            if a != c: raw.append((a, c, w))
        for a, c, w in raw: self.link(a, c, w)
        # Tiles don't share vertices where ways meet or at their edges, so join every crossing and every end
        # that touches another segment: that is what makes the network one piece.
        cell = 30   # grid units of 2 m: a 60 m bucket
        buckets = {}
        for i, (a, c, w) in enumerate(raw):
            for gx in range(int(min(a[0], c[0]) // cell), int(max(a[0], c[0]) // cell) + 1):
                for gy in range(int(min(a[1], c[1]) // cell), int(max(a[1], c[1]) // cell) + 1):
                    buckets.setdefault((gx, gy), []).append(i)
        done = set()
        for ids in buckets.values():
            for i in ids:
                for j in ids:
                    if j <= i or (i, j) in done: continue
                    done.add((i, j))
                    self.join(raw[i], raw[j])

    def key(self, p):
        """A node id: the point on a 2 m grid, so shared vertices and near-shared ones become one."""
        return (round(p[0] * 111320 * math.cos(math.radians(self.lat0)) / 2), round(p[1] * 110540 / 2))
    def lonlat_of(self, k):
        return (k[0] * 2 / (111320 * math.cos(math.radians(self.lat0))), k[1] * 2 / 110540)
    def m(self, a, b):
        return math.hypot((a[0] - b[0]) * 2, (a[1] - b[1]) * 2)
    def link(self, a, c, w):
        if a == c: return
        d = self.m(a, c) * w
        self.adj.setdefault(a, {}); self.adj.setdefault(c, {})
        if d < self.adj[a].get(c, math.inf): self.adj[a][c] = d; self.adj[c][a] = d
        self.segs.append((a, c, w))
    def join(self, s1, s2):
        (a, b, w1), (c, d, w2) = s1, s2
        if len({a, b, c, d}) < 4 and (a in (c, d) or b in (c, d)): return   # already share a node
        # an end of one on the other
        for e, (p, q, w) in ((a, s2), (b, s2), (c, s1), (d, s1)):
            u = self.along(p, q, e)
            if u is None: continue
            n = self.at(p, q, u)
            if self.m(n, e) <= 2.5: self.link(n, p, w); self.link(n, q, w); self.link(n, e, 1.0)
        # a crossing
        den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0])
        if abs(den) < 1e-9: return
        t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den
        u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den
        if 0 < t < 1 and 0 < u < 1:
            n = self.at(a, b, t)
            self.link(n, a, w1); self.link(n, b, w1); self.link(n, c, w2); self.link(n, d, w2)
    def along(self, p, q, e):
        vx, vy = q[0] - p[0], q[1] - p[1]; L2 = vx * vx + vy * vy
        if L2 == 0: return None
        u = ((e[0] - p[0]) * vx + (e[1] - p[1]) * vy) / L2
        return u if 0 < u < 1 else None
    def at(self, p, q, u):
        return (round(p[0] + (q[0] - p[0]) * u), round(p[1] + (q[1] - p[1]) * u))

    def snap(self, lonlat):
        """The nearest point on any road, joined into the graph as a node of its own."""
        p = self.key(lonlat)
        best = None
        for a, c, w in self.segs:
            vx, vy = c[0] - a[0], c[1] - a[1]; L2 = vx * vx + vy * vy
            u = 0 if L2 == 0 else max(0, min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2))
            q = self.at(a, c, u)
            d = self.m(p, q)
            if best is None or d < best[0]: best = (d, q, a, c, w)
        d, q, a, c, w = best
        self.link(q, a, w); self.link(q, c, w)
        return q

    def path(self, s, t):
        dist = {s: 0}; prev = {}; heap = [(0, s)]
        while heap:
            d, u = heapq.heappop(heap)
            if u == t: break
            if d > dist.get(u, math.inf): continue
            for v, c in self.adj[u].items():
                nd = d + c
                if nd < dist.get(v, math.inf): dist[v] = nd; prev[v] = u; heapq.heappush(heap, (nd, v))
        if t not in dist: return None
        out = [t]
        while out[-1] != s: out.append(prev[out[-1]])
        return out[::-1]

def trace(points):
    """The drive through the points in order, back to the first: [lon, lat] pairs, or None if the roads don't connect."""
    roads = Roads(points)
    nodes = [roads.snap(p) for p in points]
    coords = []
    for a, b in zip(nodes, nodes[1:] + nodes[:1]):
        leg = roads.path(a, b)
        if not leg: return None
        coords.extend(leg if not coords else leg[1:])
    return [[round(x, 6) for x in roads.lonlat_of(c)] for c in coords]
