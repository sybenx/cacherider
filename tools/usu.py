#!/usr/bin/env python3
"""Snapshot the USU campus shuttle's routes, stops and route lines from the
Passio GO feed into data/usu.json. The buses themselves are fetched live by
the phone; only what changes rarely is kept here.

  python3 tools/usu.py

The endpoint is the one the Passio GO app uses, undocumented and unofficial.
"""
import json, os, re, sys, urllib.request, urllib.parse

SYSTEM = '3499'   # Utah State University
BASE = 'https://passiogo.com/mapGetData.php'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
H = json.load(open(os.path.join(ROOT, 'tools', 'hints.json'))).get('usu', {})

def post(query, payload):
    req = urllib.request.Request(BASE + '?' + query + '&deviceId=1', data=('json=' + json.dumps(payload)).encode(),
                                 headers={'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'cacherider/1.0'})
    return json.load(urllib.request.urlopen(req, timeout=30))

routes_raw = post('getRoutes=1', {'systemSelected0': SYSTEM, 'amount': 1})
stops_raw = post('getStops=2', {'s0': SYSTEM, 'sA': 1})

def short(name):
    name = name.strip()
    if name in H.get('short', {}): return H['short'][name]
    return re.sub(r'\s*(Campus )?Express$', '', name).strip()

def text_on(hexcol):
    r, g, b = (int(hexcol[i:i+2], 16) for i in (1, 3, 5))
    return '#000' if (0.299 * r + 0.587 * g + 0.114 * b) > 150 else '#fff'

# routes: id (Passio "myid"), name, colour, ordered stops, shape
routes, ridx = [], {}
for r in routes_raw:
    rid = str(r['myid'])
    if r.get('archive') == '1': continue
    ridx[rid] = len(routes)
    routes.append({'id': rid, 'name': r['name'].strip(), 'short': short(r['name']), 'color': r['color'], 'text': text_on(r['color']),
                   'outdated': r.get('outdated') == '1', 'stops': [], 'shape': []})

stops, sidx = [], {}
for key, s in stops_raw['stops'].items():
    sid = str(s['stopId'])
    if sid not in sidx:
        sidx[sid] = len(stops)
        stops.append({'id': sid, 'name': s['name'].strip(), 'lat': round(float(s['latitude']), 6), 'lon': round(float(s['longitude']), 6), 'routes': []})
for rid, seq in stops_raw['routes'].items():
    if rid not in ridx: continue
    order = sorted(((int(p[0]), str(p[1])) for p in seq[2:] if isinstance(p, list)), key=lambda x: x[0])
    for _, sid in order:
        if sid in sidx:
            routes[ridx[rid]]['stops'].append(sidx[sid])
            if ridx[rid] not in stops[sidx[sid]]['routes']: stops[sidx[sid]]['routes'].append(ridx[rid])
for rid, segs in stops_raw.get('routePoints', {}).items():
    if rid not in ridx: continue
    pts = []
    for seg in segs if isinstance(segs, list) else [segs]:
        for p in (seg if isinstance(seg, list) else []):
            try: pts.append([round(float(p['lng'] if 'lng' in p else p['longitude']), 6), round(float(p['lat'] if 'lat' in p else p['latitude']), 6)])
            except (KeyError, TypeError, ValueError): pass
    routes[ridx[rid]]['shape'] = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]

out = {'system': SYSTEM, 'name': H.get('name', 'USU campus shuttle'), 'agency': H.get('agency', 'Utah State University'),
       'hours': H.get('hours', ''), 'routes': routes, 'stops': stops}
p = os.path.join(ROOT, 'data', 'usu.json')
json.dump(out, open(p, 'w'), separators=(',', ':'), ensure_ascii=False)
print('wrote', p, os.path.getsize(p), 'bytes:', len(routes), 'routes,', len(stops), 'stops')
for r in routes: print('  %-28s %-14s %s  %d stops, %d shape points%s' % (r['name'], r['short'], r['color'], len(r['stops']), len(r['shape']), '  (outdated)' if r['outdated'] else ''))
