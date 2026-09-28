#!/usr/bin/env python3
"""The pamphlet's places, found on the map once and kept.

  python3 tools/places.py            # look up any place not yet found, then write data/places.json
  python3 tools/places.py --check    # also list where the pamphlet's routes and the nearest stops' disagree

Each place is looked up once, in OpenStreetMap's Nominatim, inside Cache Valley, and the answer kept in
tools/places.found.json, so the nightly build never asks again. A place it can't find, or finds wrongly, is fixed by
hand there: give it "lat" and "lon" (and "fixed": true, so a rerun leaves it alone).
"""
import json, math, os, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC, FOUND, OUT = os.path.join(ROOT, 'tools', 'places.txt'), os.path.join(ROOT, 'tools', 'places.found.json'), os.path.join(ROOT, 'data', 'places.json')
VIEWBOX = '-112.10,42.10,-111.65,41.50'   # Cache Valley, Utah side and Franklin County's edge

def rows():
    for line in open(SRC):
        line = line.strip()
        if not line or line.startswith('#'): continue
        cat, name, routes, query = [x.strip() for x in line.split('|')]
        yield cat, name, [r.strip() for r in routes.split(',')], query

found = json.load(open(FOUND)) if os.path.exists(FOUND) else {}
for cat, name, routes, query in rows():
    if name in found: continue
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({'q': query + ', Utah', 'format': 'jsonv2', 'limit': 1, 'viewbox': VIEWBOX, 'bounded': 1})
    req = urllib.request.Request(url, headers={'User-Agent': 'cacherider-places/1.0 (+https://cacherider.com)'})
    try:
        hit = json.load(urllib.request.urlopen(req, timeout=20))
    except Exception as e:
        hit = []; print('  error', name, e, file=sys.stderr)
    found[name] = {'lat': round(float(hit[0]['lat']), 5), 'lon': round(float(hit[0]['lon']), 5), 'osm': hit[0].get('display_name', '')[:120]} if hit else {'missing': True}
    print(('found   ' if hit else 'MISSING ') + name + ('  ·  ' + found[name]['osm'][:80] if hit else ''), file=sys.stderr)
    json.dump(found, open(FOUND, 'w'), indent=1, ensure_ascii=False)
    time.sleep(1.1)   # Nominatim's rule: a request a second at most

out = []
for cat, name, routes, query in rows():
    f = found.get(name, {})
    if 'lat' not in f: continue
    out.append({'name': name, 'cat': cat, 'lat': f['lat'], 'lon': f['lon'], 'pool': 'Pool' in routes, 'hub': 'All' in routes, 'routes': [r for r in routes if r not in ('Pool', 'All')]})
json.dump({'places': out}, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
print(f'{len(out)} places written, {sum(1 for _ in rows()) - len(out)} still to place by hand', file=sys.stderr)

if '--check' in sys.argv:
    D = json.load(open(os.path.join(ROOT, 'data', 'cvtd.json')))
    dist = lambda a, b, c, d: 6371000 * 2 * math.asin(math.sqrt(math.sin(math.radians(c - a) / 2) ** 2 + math.cos(math.radians(a)) * math.cos(math.radians(c)) * math.sin(math.radians(d - b) / 2) ** 2))
    short = {r['short'].split()[0] for r in D['routes']}
    for p in out:
        near = [s for s in D['stops'] if dist(p['lat'], p['lon'], s['lat'], s['lon']) <= 400]
        have = {D['routes'][ri]['short'].split()[0] for s in near for ri in s['routes']}
        have = {'Loop' if x in ('G', 'B') else x for x in have}
        want = set(p['routes'])
        if p['hub'] or not want: continue
        miss = want - have
        if miss: print(f"{p['name']}: pamphlet {sorted(want)}, stops within 400 m {sorted(have) or 'none'}")
