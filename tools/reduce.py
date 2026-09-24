#!/usr/bin/env python3
"""Reduce an agency's GTFS feed to the two files the app reads.

  python3 tools/reduce.py gtfs.zip --hints tools/hints.json --out data

Writes data/cvtd.json (routes, services, stops, the hub and every departure,
as minutes past midnight) and data/cvtd-shapes.json (route lines for the
map). The app loads the first once and keeps it; the second only on the map.
"""
import argparse, csv, datetime, io, json, math, os, re, sys, zipfile

ap = argparse.ArgumentParser()
ap.add_argument('gtfs')
ap.add_argument('--hints', default=os.path.join(os.path.dirname(__file__), 'hints.json'))
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'data'))
ap.add_argument('--tag', default='cvtd')
a = ap.parse_args()
H = json.load(open(a.hints))
z = zipfile.ZipFile(a.gtfs)

def table(name, required=True):
    try:
        return list(csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig')))
    except KeyError:
        if required: sys.exit('feed has no ' + name)
        return []

def mins(hms):
    h, m = hms.split(':')[:2]
    return int(h) * 60 + int(m)

hub = H['hub']
def dist(la, lo, la2=hub['lat'], lo2=hub['lon']):
    return math.hypot((la - la2) * 111000, (lo - lo2) * 111000 * math.cos(math.radians(la2)))

# ---- routes, in the order a rider would list them: numbers, then letters as the feed has them
raw_routes = table('routes.txt')
def route_key(r):
    m = re.match(r'(\d+)\s*(\w*)', r['route_short_name'])
    return (0, int(m.group(1)), m.group(2)) if m else (1, 0, '')
raw_routes.sort(key=route_key)
dirs = {}
for d in table('directions.txt', required=False):
    dirs.setdefault(d['route_id'], ['', ''])[int(d['direction_id'])] = d['direction']
routes = []
route_idx = {}
for r in raw_routes:
    route_idx[r['route_id']] = len(routes)
    long = H.get('route_names', {}).get(r['route_long_name'], r['route_long_name'])
    routes.append({
        'id': r['route_id'], 'short': r['route_short_name'], 'long': long, 'desc': r.get('route_desc', '').strip(),
        'color': (r.get('route_color') or '888888').upper(), 'text': (r.get('route_text_color') or '000000').upper(),
        'dirs': dirs.get(r['route_id'], ['', '']),
    })

# ---- services: every calendar row, with its dates, so the app can pick the right one for any day
DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
attrs = {c['service_id']: c['service_description'] for c in table('calendar_attributes.txt', required=False)}
services = [{'id': c['service_id'], 'days': [int(c[d]) for d in DAYS], 'start': c['start_date'], 'end': c['end_date'],
             'desc': attrs.get(c['service_id'], '')} for c in table('calendar.txt')]
exceptions = [[c['date'], c['service_id'], int(c['exception_type'])] for c in table('calendar_dates.txt', required=False)]

# ---- stops
towns = H.get('towns', {})
def split_name(name):
    name = re.sub(r'\s*\((?:Temp Stop|\d+)\)\s*$', '', name).strip()
    bay = None
    m = re.match(r'(.*?)\s+-\s+Route\s+(.+)$', name)
    if m: name, bay = m.group(1), m.group(2)
    town = ''
    if ',' in name:
        name, town = (s.strip() for s in name.rsplit(',', 1))
    town = towns.get(town, town or towns.get('', H.get('town_suffix_default', '')))
    return name, town, bay

raw_stops = table('stops.txt')
stops, stop_idx = [], {}
for s in raw_stops:
    if s.get('location_type', '0') not in ('', '0'): continue
    name, town, bay = split_name(s['stop_name'])
    la, lo = float(s['stop_lat']), float(s['stop_lon'])
    stop_idx[s['stop_id']] = len(stops)
    stops.append({'id': s['stop_id'], 'code': s.get('stop_code', ''), 'name': name, 'town': town,
                  'lat': round(la, 5), 'lon': round(lo, 5), 'routes': [], 'hub': dist(la, lo) <= hub['radius'] and (bay or True)})

# ---- departures: one row per (stop, service): [minute, route index, headsign index, direction]
trips = {t['trip_id']: t for t in table('trips.txt')}
head_hints = H.get('headsigns', {})
headsigns, head_idx = [], {}
def head(t):
    r = routes[route_idx[t['route_id']]]
    h = (t.get('trip_headsign') or '').strip()
    h = head_hints.get(h, h)
    if not h: h = r['dirs'][int(t.get('direction_id') or 0)] if t.get('direction_id') else ''
    if not h: h = r['long']
    if h not in head_idx:
        head_idx[h] = len(headsigns); headsigns.append(h)
    return head_idx[h]

by_trip = {}
for st in table('stop_times.txt'):
    by_trip.setdefault(st['trip_id'], []).append(st)
times = {}
stop_routes = {}
for tid, rows in by_trip.items():
    t = trips[tid]
    rows.sort(key=lambda r: int(r['stop_sequence']))
    ri = route_idx[t['route_id']]; hi = head(t); di = int(t.get('direction_id') or 0)
    for r in rows[:-1]:  # nobody boards at a trip's last stop
        if r.get('pickup_type') == '1' or r['stop_id'] not in stop_idx: continue
        si = stop_idx[r['stop_id']]
        times.setdefault(si, {}).setdefault(t['service_id'], []).append([mins(r['departure_time']), ri, hi, di])
        stop_routes.setdefault(si, set()).add(ri)
for si, per in times.items():
    for sid in per: per[sid].sort()
for si, rs in stop_routes.items():
    stops[si]['routes'] = sorted(rs)

# The order a route calls at its stops, per direction: its longest trip's sequence.
longest = {}
for tid, rows in by_trip.items():
    t = trips[tid]; k = (route_idx[t['route_id']], int(t.get('direction_id') or 0))
    if k not in longest or len(rows) > len(longest[k]): longest[k] = rows
for (ri, di), rows in longest.items():
    routes[ri].setdefault('stops', {})[str(di)] = [stop_idx[r['stop_id']] for r in rows if r['stop_id'] in stop_idx]

# Stops nothing calls at are noise (a moved stop left in the file).
keep = [i for i, s in enumerate(stops) if s['routes']]
remap = {old: new for new, old in enumerate(keep)}
stops = [stops[i] for i in keep]
times = {str(remap[si]): per for si, per in times.items() if si in remap}
for r in routes:
    for di, seq in r.get('stops', {}).items():
        out_seq = []
        for si in seq:
            if si in remap and (not out_seq or out_seq[-1] != remap[si]): out_seq.append(remap[si])
        r['stops'][di] = out_seq

# ---- twins: the stop across the road, sharing a route, so the app can show a pair as one place
for i, s in enumerate(stops):
    s['twin'] = None
    if s['hub']: continue
    best = None
    for j, o in enumerate(stops):
        if i == j or o['hub'] or not set(s['routes']) & set(o['routes']): continue
        d = dist(s['lat'], s['lon'], o['lat'], o['lon'])
        if d <= 90 and (best is None or d < best[0]): best = (d, j)
    if best: s['twin'] = [best[1], int(best[0])]

# ---- the hub: its bays and the pulse — the minutes when the numbered routes leave together
hub_stops = [i for i, s in enumerate(stops) if s['hub']]
bays = []
for i in hub_stops:
    s = stops[i]
    bays.append({'stop': i, 'routes': s['routes'], 'lat': s['lat'], 'lon': s['lon']})
    s['hub'] = True
pulse_set = set(route_idx[r['id']] for r in routes if r['short'] in hub['pulse_routes'])
pulse = {}
for sv in services:
    count = {}
    for i in hub_stops:
        for m, ri, hi, di in times.get(str(i), {}).get(sv['id'], []):
            if ri in pulse_set: count.setdefault(m, set()).add(ri)
    pulse[sv['id']] = sorted(m for m, rs in count.items() if len(rs) >= max(3, len(pulse_set) // 2))
hub_out = {'name': hub['name'], 'short': hub['short'], 'lat': hub['lat'], 'lon': hub['lon'],
           'address': stops[hub_stops[0]]['name'] if hub_stops else '', 'town': stops[hub_stops[0]]['town'] if hub_stops else '',
           'bays': bays, 'pulse': pulse, 'pulseRoutes': sorted(pulse_set), 'pulseLabel': hub.get('pulse_label', ''),
           'loops': [route_idx[r['id']] for r in routes if r['short'] in H.get('loops', [])],
           'plan': hub.get('plan')}

agency = table('agency.txt')[0]
feed = (table('feed_info.txt', required=False) or [{}])[0]
out = {
    'agency': {'name': agency['agency_name'], 'brand': H.get('brand', agency['agency_name']), 'url': agency.get('agency_url', ''),
               'tz': agency.get('agency_timezone', 'America/Denver'), 'phone': agency.get('agency_phone', ''),
               'fares': agency.get('agency_fare_url', '')},
    'feed': {'version': feed.get('feed_version', ''), 'start': feed.get('feed_start_date', ''), 'end': feed.get('feed_end_date', ''),
             'built': datetime.date.today().isoformat()},
    'routes': routes, 'services': services, 'exceptions': exceptions, 'headsigns': headsigns,
    'stops': stops, 'hub': hub_out, 'times': times,
}
os.makedirs(a.out, exist_ok=True)
p = os.path.join(a.out, a.tag + '.json')
json.dump(out, open(p, 'w'), separators=(',', ':'), ensure_ascii=False)
print('wrote', p, os.path.getsize(p), 'bytes:', len(routes), 'routes,', len(stops), 'stops,',
      sum(len(v) for per in times.values() for v in per.values()), 'departures,', len(headsigns), 'headsigns')

# ---- shapes: one line per route and direction, for the map
shape_pts = {}
for r in table('shapes.txt', required=False):
    shape_pts.setdefault(r['shape_id'], []).append((int(r['shape_pt_sequence']), round(float(r['shape_pt_lat']), 5), round(float(r['shape_pt_lon']), 5)))
route_shapes = {}
for t in trips.values():
    if t.get('shape_id') in shape_pts:
        route_shapes.setdefault(route_idx[t['route_id']], set()).add(t['shape_id'])
lines = []
for ri, ids in sorted(route_shapes.items()):
    for sid in sorted(ids):
        pts = [[lo, la] for _, la, lo in sorted(shape_pts[sid])]
        dedup = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
        lines.append({'route': ri, 'shape': sid, 'coords': dedup})
p = os.path.join(a.out, a.tag + '-shapes.json')
json.dump({'lines': lines}, open(p, 'w'), separators=(',', ':'))
print('wrote', p, os.path.getsize(p), 'bytes:', len(lines), 'lines')
for sid, ms in pulse.items():
    print('pulse', sid, len(ms), 'times', ms[:6], '...' if len(ms) > 6 else '')
print('bays', [(b['stop'], [routes[r]['short'] for r in b['routes']]) for b in bays])
print('twins', sum(1 for s in stops if s['twin']))
