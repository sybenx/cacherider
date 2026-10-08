#!/usr/bin/env python3
"""Snapshot the USU campus shuttle's routes, stops and route lines from the
Passio GO feed into data/usu.json. The buses themselves are fetched live by
the phone; only what changes rarely is kept here.

  python3 tools/usu.py

The endpoint is the one the Passio GO app uses, undocumented and unofficial.
"""
import json, math, os, re, sys, urllib.request, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

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

# Each loop's colour apart from Connect's routes on the one map: the feed's are a chart palette (matplotlib's ten), and
# South Campus's orange was Route 1's, Innovation's red Routes 12's and 2's, Housing's purple Route 6's. A loop too
# near any route (or a loop before it) is moved the least it takes, in its own family of colour: the same hue, give or
# take a little, lighter or darker, stronger or softer, till it's APART from all (CIELAB distance; under about 20 two
# lines can't be told apart). The feed's own kept beside it.
APART = 28
def _lab(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    r, g, b = [((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c]
    X, Y, Z = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, r * 0.2126 + g * 0.7152 + b * 0.0722, (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
    f = lambda v: v ** (1 / 3) if v > 0.008856 else 7.787 * v + 16 / 116
    return (116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z)))
def _hex(L, a, b):
    fy = (L + 16) / 116; fx, fz = fy + a / 500, fy - b / 200
    inv = lambda v: v ** 3 if v ** 3 > 0.008856 else (v - 16 / 116) / 7.787
    X, Y, Z = inv(fx) * 0.95047, inv(fy), inv(fz) * 1.08883
    rgb = [X * 3.2406 - Y * 1.5372 - Z * 0.4986, -X * 0.9689 + Y * 1.8758 + Z * 0.0415, X * 0.0557 - Y * 0.2040 + Z * 1.0570]
    if any(v < -0.001 or v > 1.001 for v in rgb): return None   # outside what a screen shows
    g = lambda v: 1.055 * max(0, v) ** (1 / 2.4) - 0.055 if v > 0.0031308 else 12.92 * max(0, v)
    return '#' + ''.join('%02x' % round(min(1, max(0, g(v))) * 255) for v in rgb)
def _apart(own, others):
    L0, a0, b0 = _lab(own)
    near = lambda c: min((math.dist(_lab(c), _lab(o)) for o in others), default=99)
    if near(own) >= APART: return own
    C0, H0 = math.hypot(a0, b0), math.atan2(b0, a0)
    best = None
    for dL in range(-40, 41, 2):
        for dC in range(-40, 31, 4):
            for dH in (0, -0.1, 0.1, -0.2, 0.2, -0.3, 0.3):
                L, C, H = L0 + dL, max(0, C0 + dC), H0 + dH
                if not 15 <= L <= 85: continue
                c = _hex(L, C * math.cos(H), C * math.sin(H))
                if not c or near(c) < APART: continue
                cost = math.dist((L0, a0, b0), _lab(c))   # the least change that does it
                if not best or cost < best[0]: best = (cost, c)
    return best[1] if best else own
try:
    connect = ['#' + r['color'] for r in json.load(open(os.path.join(ROOT, 'data', 'cvtd.json')))['routes']]
except Exception:
    connect = []
placed = []
for r in routes:
    c = _apart(r['color'], connect + placed)
    if c != r['color']: r['feedColor'] = r['color']; r['color'] = c; r['text'] = text_on(c)
    placed.append(r['color'])

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

# A route Passio draws no line for is traced along the streets between its stops, in order.
for r in routes:
    if r['shape'] or len(r['stops']) < 2: continue
    try:
        import roads
        r['shape'] = roads.trace([(stops[si]['lon'], stops[si]['lat']) for si in r['stops']]) or []
        r['traced'] = bool(r['shape'])
    except ImportError:
        print('  (mapbox-vector-tile missing: %s keeps no line)' % r['name'])

out = {'system': SYSTEM, 'name': H.get('name', 'USU campus shuttle'), 'agency': H.get('agency', 'Utah State University'),
       'hours': H.get('hours', ''), 'url': H.get('url', ''), 'phone': H.get('phone', ''), 'service': H.get('service'), 'routes': routes, 'stops': stops}
p = os.path.join(ROOT, 'data', 'usu.json')
json.dump(out, open(p, 'w'), separators=(',', ':'), ensure_ascii=False)
print('wrote', p, os.path.getsize(p), 'bytes:', len(routes), 'routes,', len(stops), 'stops')
for r in routes: print('  %-28s %-14s %s  %d stops, %d shape points%s%s' % (r['name'], r['short'], r['color'], len(r['stops']), len(r['shape']), '  (outdated)' if r['outdated'] else '', '  (traced along streets)' if r.get('traced') else ''))
