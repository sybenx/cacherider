#!/usr/bin/env python3
"""The roads a walk mustn't cut straight across, and where they can be crossed: data/walks.json.

Walks are worked out as the crow flies. That's fair on a town's grid of quiet streets, and wrong across a highway:
off Route 5 at 2810 North Wolf Pack Way for the Rush FunPlex, the straight line runs over US 91, four lanes at
50 mph, with the lights at 2500 North and 3100 North the only ways over. So a walk that would cross one of these
roads goes by the nearest crossing on it instead (app/geo.js), its time and distance with the detour in, and the
crossing said ('cross Main Street at the light').

From OpenStreetMap, once a night (data.yml), one query:
  - the roads: trunk and primary roads (the US and state highways), and secondary roads with four lanes or more
    or a 40 mph limit; not where they're on a bridge or in a tunnel (a walk goes under or over those);
  - the crossings on them: traffic signals, and crossings tagged as marked or signalled (not crossing=unmarked or
    no), and where a mapped crosswalk (footway=crossing) meets the road.

  python3 tools/walks.py            # → data/walks.json

Written as { roads: [{ n: name, p: [[lat, lon], ...] }], x: [[lat, lon, kind, roads, at]] }, kind 's' a signal,
'm' a marked crossing, `roads` the busy roads it crosses, `at` every street named there (the corner's); each road's line simplified to a few metres. Nothing here is Cache Valley's own: any valley's
OSM gives the same.
"""
import json, math, os, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'walks.json')
MARGIN = 0.02   # degrees round the stops (about 2 km): as far as a walk to a stop goes, and more


def box():
    pts = [(s['lat'], s['lon']) for s in json.load(open(os.path.join(ROOT, 'data', 'cvtd.json')))['stops']]
    return (min(p[0] for p in pts) - MARGIN, min(p[1] for p in pts) - MARGIN, max(p[0] for p in pts) + MARGIN, max(p[1] for p in pts) + MARGIN)


def busy(t):
    """A road nobody should cross but at a crossing: a highway, or a wide or fast town road."""
    h = t.get('highway', '')
    if h in ('trunk', 'primary'): return True
    if h != 'secondary': return False
    try: lanes = int((t.get('lanes') or '0').split(';')[0])
    except ValueError: lanes = 0
    mph = (t.get('maxspeed') or '').replace('mph', '').strip()
    return lanes >= 4 or (mph.isdigit() and int(mph) >= 40)


def dist(a, b):
    k = math.cos(math.radians(a[0]))
    return math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * k)


def simplify(pts, tol=4.0):
    """Douglas-Peucker, metres."""
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]
    def off(p):
        k = math.cos(math.radians(a[0]))
        ax, ay, bx, by, px, py = a[1] * k, a[0], b[1] * k, b[0], p[1] * k, p[0]
        dx, dy = bx - ax, by - ay
        if dx == dy == 0: return dist(p, a)
        u = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return dist(p, (ay + u * dy, (ax + u * dx) / k))
    i, m = max(((i, off(p)) for i, p in enumerate(pts[1:-1], 1)), key=lambda x: x[1])
    return simplify(pts[:i + 1], tol)[:-1] + simplify(pts[i:], tol) if m > tol else [a, b]


def main():
    s, w, n, e = box()
    B = f'{s:.4f},{w:.4f},{n:.4f},{e:.4f}'
    q = f"""[out:json][timeout:180];
way["highway"~"^(trunk|primary|secondary)$"]({B})->.r;
way["footway"="crossing"]({B})->.f;
.r out body geom;
node(w.r)["highway"~"^(crossing|traffic_signals)$"]->.x; .x out;
node(w.f)(w.r)->.y; .y out;
way(bn.x)["highway"]["name"]; out body;
way(bn.y)["highway"]["name"]; out body;"""
    # Overpass is often busy: a few tries, a minute apart, the main server and a mirror in turn.
    servers = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
    for tries in range(6):
        req = urllib.request.Request(servers[tries % 2], data=urllib.parse.urlencode({'data': q}).encode(),
                                     headers={'User-Agent': 'cacherider-walks/1.0 (+https://cacherider.com)'})
        try: els = json.load(urllib.request.urlopen(req, timeout=200))['elements']; break
        except Exception as ex:
            if tries == 5: raise
            print('Overpass:', ex, '- again', file=sys.stderr); time.sleep(20 if tries % 2 == 0 else 60)
    roads, ids = [], {}
    # A highway's name where a piece of it has only its number: what the rest of it with that number is called
    # (US 91 through North Logan is Main Street).
    called = {}
    for el in els:
        t = el.get('tags', {}) if el['type'] == 'way' else {}
        if t.get('ref') and t.get('name'): called.setdefault(t['ref'], []).append(t['name'])
    called = {r: max(set(ns), key=ns.count) for r, ns in called.items()}
    # The streets at each crossing, by name, for which one it's by ('at the light by 2500 North').
    at = {}
    for el in els:
        if el['type'] == 'way' and 'geometry' not in el and (el.get('tags') or {}).get('name'):
            for nd in el.get('nodes', []): at.setdefault(nd, set()).add(el['tags']['name'])
    for el in els:
        if el['type'] != 'way' or 'geometry' not in el: continue
        t = el.get('tags', {})
        if not busy(t) or t.get('bridge', 'no') != 'no' or t.get('tunnel', 'no') != 'no' or t.get('area') == 'yes': continue
        name = t.get('name') or called.get(t.get('ref', '')) or (t.get('ref') or '').split(';')[0] or 'the highway'
        pts = simplify([(p['lat'], p['lon']) for p in el['geometry']])
        roads.append({'n': name, 'p': [[round(a, 5), round(b, 5)] for a, b in pts]})
        for nd in el.get('nodes', []): ids.setdefault(nd, set()).add(name)   # every busy road through it: a light at a corner of two is a way over both
    x, seen = [], set()
    for el in els:
        if el['type'] != 'node' or el['id'] in seen or el['id'] not in ids: continue
        t = el.get('tags') or {}
        if t.get('crossing') in ('no', 'unmarked', 'informal') or t.get('crossing:markings') == 'no' and t.get('crossing:signals') != 'yes': continue
        seen.add(el['id'])
        kind = 's' if t.get('highway') == 'traffic_signals' or t.get('crossing') == 'traffic_signals' or t.get('crossing:signals') == 'yes' else 'm'
        x.append([round(el['lat'], 5), round(el['lon'], 5), kind, sorted(ids[el['id']]), sorted(at.get(el['id'], set()) | ids[el['id']])])
    # A crosswalk at a corner, its node not the cross street's: the streets of the corner's other crossings (within 40 m).
    for c in x:
        if set(c[4]) - set(c[3]): continue
        near = [o for o in x if o is not c and dist(c, o) < 40 and set(o[4]) - set(c[3])]
        if near: c[4] = sorted(set(c[4]) | set(min(near, key=lambda o: dist(c, o))[4]))
    doc = {'from': 'OpenStreetMap contributors', 'roads': roads, 'x': x}   # no date: a night's run with nothing changed is no commit
    if len(roads) < 5: sys.exit(f'only {len(roads)} roads: not kept')
    json.dump(doc, open(OUT, 'w'), separators=(',', ':'))
    print(f'wrote {os.path.relpath(OUT, ROOT)}: {len(roads)} roads, {len(x)} crossings ({sum(1 for c in x if c[2] == "s")} at lights), {os.path.getsize(OUT) // 1024} KB', file=sys.stderr)


if __name__ == '__main__':
    main()
