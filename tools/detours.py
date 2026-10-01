#!/usr/bin/env python3
"""Detours from the buses' own tracks: the agency's alerts can't be trusted alone, so this reads where the buses
actually went (the relay logs them, three samples a minute, in D1: worker/) and finds the stretches where buses of
a route leave the route's line and come back to it further on. The same way taken by buses of the route trip after
trip is a detour; the stops of the line it goes around are likely closed, and any stop the buses pass on the
detour itself is served (a dispatcher's rule: on a detour, a stop passed is a stop served).

How sure, from the trips through that part of the line, most recent first, each either around it or along it:
  2 in a row around it: worth a doubt.  3: quite sure.  4 or more: all but certain.
A bus back along the line breaks the run.

  python3 tools/detours.py            the last 6 hours
  python3 tools/detours.py 24         the last 24
  python3 tools/detours.py 24 -v      and every single trip off the line, one-offs too

Log only for now: what it finds is checked against the detours we know of before anything goes on the map.
"""
import json, math, os, subprocess, sys, time, urllib.request
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OFF = 60          # metres from every one of its route's lines: a bus this far off is off the route
FAR = 150         # one sample this far off counts, where otherwise two in a row are needed (a sample can be wide)
HUB_R = 150       # the Transit Center's own drives and bays are nobody's detour
GAP = 120         # seconds between a bus's samples beyond which its track is broken (the feed lost it)
SAME = 150        # metres: two trips off the line whose paths come this close, point for point, took one way
STOP_ON = 45      # metres from a path or a line a stop is on it
WORDS = {2: 'worth a doubt', 3: 'quite sure', 4: 'all but certain'}

def load():
    c = json.load(open(os.path.join(ROOT, 'data/cvtd.json')))
    lines = json.load(open(os.path.join(ROOT, 'data/cvtd-shapes.json')))['lines']
    return c, lines

def pull(hours):
    since = int(time.time() - hours * 3600)
    rows, after = [], since - 1
    while True:
        q = f"SELECT t, buses FROM samples WHERE t > {after} ORDER BY t LIMIT 400"
        out = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'cacherider-tracks', '--remote', '--json', '--command', q],
                             cwd=os.path.join(ROOT, 'worker'), capture_output=True, text=True)
        if out.returncode: sys.exit('wrangler: ' + (out.stderr or out.stdout)[-600:])
        got = json.loads(out.stdout)[0]['results']
        rows += got
        if len(got) < 400: return rows
        after = got[-1]['t']

# ---- metres on a flat map about the Transit Center: plenty for a valley this size
class Flat:
    def __init__(self, lat, lon): self.lat0, self.lon0, self.kx = lat, lon, 111320 * math.cos(math.radians(lat))
    def xy(self, lat, lon): return ((lon - self.lon0) * self.kx, (lat - self.lat0) * 110540)

def seg_near(p, a, b):
    """Distance from p to segment ab, and how far along ab the nearest point is (0..1)."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = dx * dx + dy * dy
    k = 0 if L == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L))
    return math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dy), k

class Lines:
    """Each route's lines (key: the trip id's prefix, 16's AM and PM as one), indexed in 100 m cells."""
    CELL = 100
    def __init__(self, c, lines, flat):
        self.shapes = []   # (key, [xy...], [cumulative metres...])
        self.cells = defaultdict(list)
        for l in lines:
            key = c['routes'][l['route']]['short'].split()[0]
            pts = [flat.xy(lat, lon) for lon, lat in l['coords']]
            cum = [0]
            for a, b in zip(pts, pts[1:]): cum.append(cum[-1] + math.dist(a, b))
            si = len(self.shapes)
            self.shapes.append((key, pts, cum))
            for i, (a, b) in enumerate(zip(pts, pts[1:])):
                for cx in range(int(min(a[0], b[0]) // self.CELL) - 1, int(max(a[0], b[0]) // self.CELL) + 2):
                    for cy in range(int(min(a[1], b[1]) // self.CELL) - 1, int(max(a[1], b[1]) // self.CELL) + 2):
                        self.cells[(cx, cy)].append((si, i))
    def near(self, p, key):
        """(metres, shape, metres along it) to the nearest of the route's lines; metres is 1e9 with none near."""
        best = (1e9, None, None)
        for si, i in self.cells.get((int(p[0] // self.CELL), int(p[1] // self.CELL)), ()):
            k, pts, cum = self.shapes[si]
            if k != key: continue
            d, f = seg_near(p, pts[i], pts[i + 1])
            if d < best[0]: best = (d, si, cum[i] + f * (cum[i + 1] - cum[i]))
        return best

def path_dist(p, path):
    if len(path) == 1: return math.dist(p, path[0])
    return min(seg_near(p, a, b)[0] for a, b in zip(path, path[1:]))

def main():
    hours = float(next((a for a in sys.argv[1:] if not a.startswith('-')), 6))
    verbose = '-v' in sys.argv
    c, lines = load()
    hub = c['hub']; flat = Flat(hub['lat'], hub['lon']); H = flat.xy(hub['lat'], hub['lon'])
    L = Lines(c, lines, flat)
    keys = {k for k, _, _ in L.shapes}
    stops = [(s, flat.xy(s['lat'], s['lon'])) for s in c['stops']]
    route_stops = defaultdict(set)
    for r in c['routes']:
        for d in r['stops'].values(): route_stops[r['short'].split()[0]].update(d)
    rows = pull(hours)
    if not rows: sys.exit('No samples yet.')
    print(f"{len(rows)} samples, {time.strftime('%a %H:%M', time.localtime(rows[0]['t']))} to {time.strftime('%a %H:%M', time.localtime(rows[-1]['t']))}\n")

    # Each bus's track: (t, key, xy, metres off, shape, along)
    tracks = defaultdict(list)
    for r in rows:
        for label, trip, key, lat, lon, bearing, speed, ts in json.loads(r['buses']):
            if key not in keys: continue
            p = flat.xy(lat, lon)
            d, si, m = L.near(p, key)
            if math.dist(p, H) <= HUB_R: d = 0
            tracks[label].append((r['t'], key, p, d, si, m))

    # Trips off the line: a bus's run of samples off its route, with the samples on the line either side.
    passes, along = [], []   # along: (key, t, shape, metres along) of every sample on a line, to tell who went the usual way
    for label, tr in tracks.items():
        tr.sort()
        i = 0
        while i < len(tr):
            t, key, p, d, si, m = tr[i]
            if d <= OFF: along.append((key, t, si, m, label)); i += 1; continue
            j = i
            while j + 1 < len(tr) and tr[j + 1][3] > OFF and tr[j + 1][1] == key and tr[j + 1][0] - tr[j][0] <= GAP: j += 1
            run = tr[i:j + 1]
            before = tr[i - 1] if i and tr[i - 1][1] == key and t - tr[i - 1][0] <= GAP else None
            after = tr[j + 1] if j + 1 < len(tr) and tr[j + 1][1] == key and tr[j + 1][0] - tr[j][0] <= GAP else None
            if (len(run) >= 2 or run[0][3] >= FAR) and before and after:   # off and back on: not a run in from the yard
                passes.append({'bus': label, 'key': key, 't': run[0][0], 'end': run[-1][0], 'path': [before[2]] + [x[2] for x in run] + [after[2]],
                               'out': before, 'back': after, 'far': max(x[3] for x in run)})
            i = j + 1

    # One way, many trips: passes whose paths keep close, point for point, both ways round.
    def alike(a, b):
        if a['key'] != b['key']: return False
        inner = lambda x: x['path'][1:-1]
        return all(path_dist(p, b['path']) <= SAME for p in inner(a)) and all(path_dist(p, a['path']) <= SAME for p in inner(b))
    ways = []
    for ps in sorted(passes, key=lambda x: x['t']):
        w = next((w for w in ways if alike(ps, w[0])), None)
        (w.append(ps) if w else ways.append([ps]))

    def stopname(xy):
        s = min(stops, key=lambda s: math.dist(s[1], xy))[0]
        return s['name']
    clock = lambda t: time.strftime('%H:%M', time.localtime(t))
    found = 0
    for w in sorted(ways, key=lambda w: (w[0]['key'], w[0]['t'])):
        key = w[0]['key']
        # The part of the line gone around: from where the buses left it to where they came back, on the line they left.
        out, back = w[-1]['out'], w[-1]['back']
        si = out[4]
        lo, hi = sorted((out[5], back[5])) if back[4] == si else (out[5], out[5])
        # The trips through that part, each way round, in order: around it (this way) or along it (a bus of the
        # route on the line inside it, a run of its samples within ten minutes one trip).
        trips = [(ps['t'], 'around', ps['bus']) for ps in w]
        seen = {}
        for k, t, s2, m, label in sorted(along):
            if k != key or s2 != si or not (lo + 50 < m < hi - 50): continue
            if any(label == ps['bus'] and abs(t - ps['t']) < 900 for ps in w): continue   # the same trip, before or after its way round
            if label in seen and t - seen[label] < 600: seen[label] = t; continue
            seen[label] = t
            trips.append((t, 'along', label))
        trips.sort()
        streak = 0
        for t, how, _ in reversed(trips):
            if how != 'around': break
            streak += 1
        if streak < 2 and not verbose: continue
        found += 1
        word = WORDS[min(streak, 4)] if streak >= 2 else ('once' if streak == 1 else 'over: buses back on the line since')
        print(f"Route {key}: {len(w)} trip{'s' * (len(w) != 1)} this way, the last {streak} in a row ({word}); last {clock(w[-1]['t'])}")
        print(f"  leaves the line near {stopname(out[2])}, back on it near {stopname(back[2])}, {(lambda f: f"up to {round(f)} m off" if f < 1e8 else "over 200 m off")(max(p['far'] for p in w))}")
        print('  trips:', '  '.join(f"{clock(t)} {'around' if how == 'around' else 'ALONG'} ({b})" for t, how, b in trips[-8:]))
        path = max(w, key=lambda p: len(p['path']))['path']
        _, pts, cum = L.shapes[si]
        gone = [s for s, xy in stops if s['id'] and c['stops'].index(s) in route_stops[key]
                and (lambda d: d[0] <= STOP_ON and lo + 30 < d[2] < hi - 30)(L.near(xy, key)) and L.near(xy, key)[1] == si
                and path_dist(xy, path) > STOP_ON]
        on = [s for s, xy in stops if path_dist(xy, path) <= STOP_ON and L.near(xy, key)[0] > OFF]
        if gone: print('  stops gone around (likely closed):', '; '.join(f"{s['name']} ({s['code']})" for s in gone))
        if on: print('  stops on the way round (served, by the rule):', '; '.join(f"{s['name']} ({s['code']})" for s in on))
        print()
    if not found: print('No route has gone off its line twice in a row the same way.' + ('' if verbose else ' (-v for one-offs)'))

    # The agency's word, beside ours.
    try:
        al = json.load(urllib.request.urlopen(urllib.request.Request('https://live.cacherider.com/alerts', headers={'User-Agent': 'cacherider-tools/1.0'}), timeout=10))['alerts']
        det = [a for a in al if 'detour' in (a['title'] + a['text']).lower()]
        print('\nThe agency says, of detours:')
        for a in det: print(f"  routes {', '.join(a['routes']) or '-'}: {a['title']}")
    except Exception as e:
        print('\n(alerts not read:', e, ')')

if __name__ == '__main__':
    main()
