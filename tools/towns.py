#!/usr/bin/env python3
"""The valley's towns' outlines, from OpenStreetMap, for a route's day to mark where its bus is in a town.

  python3 tools/towns.py        # writes data/towns.json

Each town is an OpenStreetMap boundary (boundary=administrative, admin_level 8: a city or town's limits) with a part in
Cache Valley's box, Franklin and Preston in Idaho too. A boundary is a relation of ways, its outer ones joined end to
end into closed rings; each ring made lighter (points within a few metres of the line through their neighbours
dropped) and its points rounded to a metre or so. A ring that won't close is kept as it is: a point in it is told
by crossings all the same.

One query a night, through tools/overpass.py: an answer cut short, older than the file published, or far short of it,
and the file published stands (tools/upstream.py). OSM_CACHE=file (working on this script): the answer kept there and
read back, Overpass asked once.
"""
import json, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import overpass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'towns.json')
BOX = '41.55,-112.10,42.15,-111.65'   # south, west, north, east: the valley, Idaho's end of it too
TOL = 6                                # metres: a point closer than this to the line through its neighbours is dropped

QUERY = f"""[out:json][timeout:90];
relation["boundary"="administrative"]["admin_level"="8"]({BOX});
out geom;"""


def key(p):
    return (round(p[0], 7), round(p[1], 7))


def lighter(ring):
    """Douglas-Peucker, in metres near the valley's latitude."""
    kx, ky = 111320 * math.cos(math.radians(41.8)), 111320
    pts = [(x * kx, y * ky) for x, y in ring]
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        far, fi = -1, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dx * (ay - py) - dy * (ax - px)) / L if L else math.hypot(px - ax, py - ay)
            if d > far: far, fi = d, i
        if far > TOL:
            keep[fi] = True
            stack += [(a, fi), (fi, b)]
    return [[round(x, 5), round(y, 5)] for (x, y), k in zip(ring, keep) if k]


def rings_of(e):
    """A relation's outer ways joined into rings."""
    ways = [[[g['lon'], g['lat']] for g in m['geometry']] for m in e.get('members', [])
            if m.get('type') == 'way' and m.get('role') in ('outer', '') and m.get('geometry')]
    rings = []
    while ways:
        ring = ways.pop(0)
        while key(ring[0]) != key(ring[-1]):
            for i, w in enumerate(ways):
                if key(w[0]) == key(ring[-1]): ring += w[1:]; break
                if key(w[-1]) == key(ring[-1]): ring += w[::-1][1:]; break
            else:
                break   # an unclosed piece: kept as it is
            ways.pop(i)
        if len(ring) >= 4: rings.append(lighter(ring))
    return rings


WAS = overpass.published(OUT)
CACHE = os.environ.get('OSM_CACHE')
if CACHE and os.path.exists(CACHE):
    raw = json.load(open(CACHE))
    els, base = (raw.get('elements', []), (raw.get('osm3s') or {}).get('timestamp_osm_base', '')) if isinstance(raw, dict) else (raw, WAS.get('osm', ''))
else:
    els, base = overpass.query(QUERY, 'cacherider-towns/1.0 (+https://cacherider.com)', 120, since=WAS.get('osm', ''))
    if CACHE: json.dump(els, open(CACHE, 'w'))

towns = []
for e in els:
    name = (e.get('tags') or {}).get('name')
    if e.get('type') != 'relation' or not name: continue
    rings = rings_of(e)
    if not rings: continue
    xs = [p[0] for r in rings for p in r]; ys = [p[1] for r in rings for p in r]
    towns.append({'name': name, 'box': [min(xs), min(ys), max(xs), max(ys)], 'rings': rings})
towns.sort(key=lambda t: t['name'])
overpass.enough(len(towns), len(WAS.get('towns', [])), 'towns', 0.8)
json.dump({'osm': base, 'towns': towns}, open(OUT, 'w'), separators=(',', ':'))
print(f"{len(towns)} towns, {sum(len(r) for t in towns for r in t['rings'])} points, {os.path.getsize(OUT) // 1024} KB", file=sys.stderr)
