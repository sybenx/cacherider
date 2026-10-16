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

def landmark(desc, name, town=''):
    """What the stop is by, from the feed's stop_desc ('Smiths', 'Across from Cache Valley Hospital'): the same
    landmarks the bus announces. Not the agency's housekeeping ('(Timepoint)', 'Temp Stop', a detour's date stamp),
    not the address again, not the Transit Center's own name at its bays."""
    d = re.sub(r'\s*\((?:Timepoint|Detour)\)\s*', ' ', desc or '', flags=re.I)
    d = re.sub(r'\s*added \d+/\d+/\d+.*$', '', d, flags=re.I).strip(' -–·,')
    if d.count('(') > d.count(')'): d += ')'   # 'Tabernacle (Back)' with its stamp cut off after it
    while d.count(')') > d.count('(') and ')' in d:   # a stray close, 'Mountain America & Costco)': dropped, the last first
        i = d.rindex(')'); d = (d[:i] + d[i + 1:]).strip()
    if not d or re.fullmatch(r'(temp stop|timepoint|intermodal transit center)', d, re.I): return ''
    plain = lambda x: re.sub(r'\W', '', x).lower()
    if plain(d) in (plain(name), plain(town)): return ''   # the address or the town again says nothing
    return d

raw_stops = table('stops.txt')
stops, stop_idx = [], {}
for s in raw_stops:
    if s.get('location_type', '0') not in ('', '0'): continue
    name, town, bay = split_name(s['stop_name'])
    la, lo = float(s['stop_lat']), float(s['stop_lon'])
    stop_idx[s['stop_id']] = len(stops)
    stops.append({'id': s['stop_id'], 'code': s.get('stop_code', ''), 'name': name, 'town': town,
                  'lat': round(la, 5), 'lon': round(lo, 5), 'routes': [], 'hub': dist(la, lo) <= hub['radius'] and (bay or True),
                  'by': landmark(s.get('stop_desc', ''), name, town)})

# ---- departures: one row per (stop, service): [minute, route index, headsign index, direction, trip index]
# The trip index names the trip in the realtime feed, whose ids match the static ones without any -N suffix.
trips = {t['trip_id']: t for t in table('trips.txt')}
trip_ids, trip_idx = [], {}
def trip_index(tid):
    base = re.sub(r'-\d+$', '', tid)
    if base not in trip_idx:
        trip_idx[base] = len(trip_ids); trip_ids.append(base)
    return trip_idx[base]
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

timepoints = {}   # route index → its timepoint stops (feed indices)
by_trip = {}
for st in table('stop_times.txt'):
    by_trip.setdefault(st['trip_id'], []).append(st)
times = {}
stop_routes = {}
# Where each trip ends and when, which the departures leave out: [stop, arrival minute] by trip index, flat; -1 where
# its last stop isn't one of ours. A run's page draws it to its end, and a route's day ends when its last bus gets in.
ends = {}
last_stop = {}   # trip id → its last stop (GTFS id), for the relay: a bus there is done with that trip
for tid, rows in by_trip.items():
    t = trips[tid]
    rows.sort(key=lambda r: int(r['stop_sequence']))
    ri = route_idx[t['route_id']]; hi = head(t); di = int(t.get('direction_id') or 0)
    last_stop[re.sub(r'-\d+$', '', tid)] = rows[-1]['stop_id']
    if rows[-1]['stop_id'] in stop_idx: ends[trip_index(tid)] = [stop_idx[rows[-1]['stop_id']], mins(rows[-1]['arrival_time'] or rows[-1]['departure_time'])]
    # Timepoints: the stops a route's timetable is kept to, where an early bus waits for its time. The same stops on
    # every trip of a route, so one list a route.
    for r in rows:
        if r.get('timepoint') == '1' and r['stop_id'] in stop_idx: timepoints.setdefault(ri, set()).add(stop_idx[r['stop_id']])
    for r in rows[:-1]:  # nobody boards at a trip's last stop
        if r.get('pickup_type') == '1' or r['stop_id'] not in stop_idx: continue
        si = stop_idx[r['stop_id']]
        times.setdefault(si, {}).setdefault(t['service_id'], []).append([mins(r['departure_time']), ri, hi, di, trip_index(tid)])
        stop_routes.setdefault(si, set()).add(ri)

# ---- routes no feed has, kept by hand (hints' hand_routes, each a file beside them: tools/prt.json, Pocatello Regional
# Transit's Preston / Logan Commuter, a midday bus to Logan that Connect's feed doesn't carry). Each a route after the
# feed's, run by someone else (`op`: whose, and their timetable), on a calendar of its own (its days, less its holidays),
# its trips at the feed's own stops: by stop id, or by stop code where the feed has renumbered one. A file missing is no
# route (a sister site has none); a stop not found is left out, said here.
hand_trips = []   # (route index, trip id, GTFS stop ids in order), for its line on the map
hand_next = []    # (service, trip index, the trip its bus runs next): its blocks, as the feed's
for f in H.get('hand_routes', []):
    # Read and checked whole before any of it goes in: a slip in a file kept by hand leaves that route out, never the
    # night's timetable.
    try:
        hr = json.load(open(os.path.join(os.path.dirname(a.hints), f)))
        R, op = hr['route'], hr['operator']
        if not all(re.fullmatch(r'[0-9A-Fa-f]{6}', R[k]) for k in ('color', 'text')) or not (R['id'] and R['short'] and R['long'] and op['name']): raise ValueError('route or operator incomplete')
        days = [int(x) for x in hr['days']]
        holidays = [str(d) for d in hr.get('holidays', [])]
        if len(days) != 7 or not all(re.fullmatch(r'\d{8}', d) for d in holidays): raise ValueError('days or holidays')
        hand_in = [(t['id'], int(t['dir']), t.get('headsign', ''), [(x['stop'], x.get('code', ''), mins(x['time']), bool(x.get('timepoint', False)), x.get('pdf', '')) for x in t['stops']]) for t in hr['trips']]
    except FileNotFoundError:
        print('::warning::hand route', f, 'not found; left out', file=sys.stderr); continue
    except Exception as e:
        print('::warning::hand route', f, 'unreadable (' + type(e).__name__ + ': ' + str(e) + '); left out', file=sys.stderr); continue
    ri = len(routes); route_idx[R['id']] = ri
    routes.append({'id': R['id'], 'short': R['short'], 'long': R['long'], 'desc': R.get('desc', ''), 'color': R['color'].upper(), 'text': R['text'].upper(),
                   'dirs': R.get('dirs', ['', '']), 'op': {**op, 'timetable': hr.get('source', ''), 'checked': hr.get('checked', ''), 'service': R['id']}})
    # From the feed's first day (a start ahead of today would read as a new timetable coming), on with no end.
    sid = R['id']
    services.append({'id': sid, 'days': days, 'start': min((s['start'] for s in services), default=datetime.date.today().strftime('%Y%m%d')),
                     'end': '20991231', 'desc': op['name']})
    exceptions += [[d, sid, 2] for d in holidays]
    by_code = {s['code']: i for i, s in enumerate(stops) if s['code']}
    for tid, di, headsign, calls in hand_in:
        rows = []
        for stop_id, code, m, tp, pdf in calls:
            si = stop_idx.get(stop_id, by_code.get(code))
            if si is None:
                print('::warning::hand route', R['short'], tid + ': stop', stop_id, pdf, 'not in the feed; left out', file=sys.stderr); continue
            rows.append((m, si, tp))
        if len(rows) < 2: continue
        ti = trip_index(tid)
        hi = head({'route_id': R['id'], 'trip_headsign': headsign, 'direction_id': str(di)})
        ends[ti] = [rows[-1][1], rows[-1][0]]
        for m, si, _tp in rows[:-1]:
            times.setdefault(si, {}).setdefault(sid, []).append([m, ri, hi, di, ti])
            stop_routes.setdefault(si, set()).add(ri)
        for _m, si, tp in rows:
            if tp: timepoints.setdefault(ri, set()).add(si)
        if len(rows) > len(routes[ri].get('stops', {}).get(str(di), [])): routes[ri].setdefault('stops', {})[str(di)] = [si for _m, si, _tp in rows]
        hand_trips.append((ri, tid, [stops[si]['id'] for _m, si, _tp in rows]))
    run = [trip_idx[t] for t in hr.get('block', []) if t in trip_idx]
    hand_next += [(sid, ta, tb) for ta, tb in zip(run, run[1:])]

for si, per in times.items():
    for sid in per: per[sid].sort()
for si, rs in stop_routes.items():
    stops[si]['routes'] = sorted(rs)

# The trip each bus runs next, per service: the timetable's blocks, one bus's day of trips in order. A bus often
# swaps routes all day (2 and 5, 9 and 1), so a rider who stays on board rides the next trip of its block.
# { service: { trip index: next trip index } }; a block's last trip has none.
blocks = {}
family_of = {}   # trip index → its route's family: 16 AM and 16 PM one route to a rider (the app's familyKey)
for tid, rows in by_trip.items():
    t = trips[tid]
    if not t.get('block_id'): continue
    blocks.setdefault((t['service_id'], t['block_id']), []).append((mins(rows[0]['departure_time']), trip_index(tid)))
    family_of[trip_index(tid)] = re.sub(r'\s+(AM|PM)$', '', routes[route_idx[t['route_id']]]['short'], flags=re.I)
next_trip = {}
for (sv, _b), run in blocks.items():
    run.sort()
    for (_, ta), (_, tb) in zip(run, run[1:]):
        if ta != tb: next_trip.setdefault(sv, {})[str(ta)] = tb
for sv, ta, tb in hand_next: next_trip.setdefault(sv, {})[str(ta)] = tb

# Which of its route's buses that day each trip's is: per service, per route family, the blocks running it in order of
# their first trip on it, each its trips on it. Connect's dispatch numbers them so (the Blue Loop's three on a weekday
# B1, B2 and B3, said 'Blue two'; Route 12's two 12(1) and 12(2)), and a bus keeps its number all day, whichever
# vehicle runs it. Only a route with two buses or more that day: one alone has nothing to tell it from.
# { service: { family: [[trip index, ...], ...] } }
on_route = {}
for (sv, b), run in blocks.items():
    per = {}
    for m, ti in run:
        xs = per.setdefault(family_of[ti], [])
        if ti not in (x for _m, x in xs): xs.append((m, ti))
    for k, xs in per.items(): on_route.setdefault((sv, k), []).append((xs[0][0], b, [ti for _m, ti in xs]))
buses = {}
for (sv, k), bl in sorted(on_route.items()):
    if len(bl) > 1: buses.setdefault(sv, {})[k] = [ts for _m, _b, ts in sorted(bl)]

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
ends = {ti: [remap[si], m] for ti, (si, m) in ends.items() if si in remap}   # a stop only ever got off at goes with the rest
for r in routes:
    for di, seq in r.get('stops', {}).items():
        out_seq = []
        for si in seq:
            if si in remap and (not out_seq or out_seq[-1] != remap[si]): out_seq.append(remap[si])
        r['stops'][di] = out_seq
for ri, tps in timepoints.items():
    routes[ri]['tp'] = sorted(remap[si] for si in tps if si in remap)

# ---- twins: the stop across the road, sharing a route, so the app can show a pair as one place
# The Green and Blue Loops run the same streets in opposite directions, so a pair across the road can have
# one loop each and no route in common. For that the two loops count as one route, but only for two stops on
# the same street: a loop stop around the corner is somewhere else.
LOOPS = {i for i, r in enumerate(routes) if r['short'] in H.get('loops', [])}
WORD = {'N': 'North', 'S': 'South', 'E': 'East', 'W': 'West'}
def street(name):
    w = [WORD.get(x, x) for x in name.replace('.', '').split() if x not in ('St', 'Street')]
    return ' '.join(w[2:]) if len(w) > 2 and w[0].isdigit() else None
def pair(s, o):
    if set(s['routes']) & set(o['routes']): return True
    return bool(LOOPS & set(s['routes']) and LOOPS & set(o['routes'])) and street(s['name']) is not None and street(s['name']) == street(o['name'])
for i, s in enumerate(stops):
    s['twin'] = None
    if s['hub']: continue
    best = None
    for j, o in enumerate(stops):
        if i == j or o['hub'] or not pair(s, o): continue
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
# Each bay at its pole in OpenStreetMap where one's mapped (tools/osmplaces.py, the last night's poles): the feed has
# Route 9's 9 m north of Route 1's, one behind the other at the Transit Center, where the poles stand 17 m apart, 9's
# to the north-west. A pole is a bay's only when it says so: its ref the bay's stop code ('100', Route 1's), or its ref
# or name one of the bay's routes ('9', 'Route 15', 'GREEN' for the Green Loop, 'Blue Loop'). A pole that only lists a
# route among others (Route 1's, '1;9') could be the bay across the drive, and a pole whose ref is another bay's code
# is that bay's. The surest first, then the nearest, within 40 m, one pole to a bay; none, and the bay is where the
# feed has it. The stop moves with its bay, so its dot and the planner's walks to it are where the badge is.
def _poles():
    try: return json.load(open(os.path.join(a.out, 'osm-places.json'))).get('poles') or []
    except Exception: return []
def _said(x):   # 'Route 09' and '9' alike
    x = re.sub(r'^route\s+', '', x.strip().lower())
    return x.lstrip('0') or x if x.isdigit() else x
def _names(ri):   # how a pole might name a route: its short name, its long name, a loop's colour ('green')
    r = routes[ri]; long_ = _said(r.get('long') or '')
    return ({_said(r['short']), long_} | ({long_.split(' ')[0]} if long_.endswith(' loop') else set())) - {''}
_codes = {(stops[b['stop']].get('code') or '').lower() for b in bays} - {''}
def _sure(b, p):
    code, ref, name = (stops[b['stop']].get('code') or '').lower(), _said(p[2]), _said(p[4])
    if code and ref == code: return 2
    if ref in _codes: return 0
    names = set().union(*(_names(ri) for ri in b['routes']))
    return 1 if ref in names or name in names else 0
_pl = _poles()
_pairs = sorted(((_sure(b, p), -dist(b['lat'], b['lon'], p[0], p[1]), k, n) for k, b in enumerate(bays) for n, p in enumerate(_pl)
                 if dist(b['lat'], b['lon'], p[0], p[1]) <= 40), reverse=True)
_bay_took, _pole_took = set(), set()
for sure, neg, k, n in _pairs:
    if sure == 0 or k in _bay_took or n in _pole_took: continue
    p, b = _pl[n], bays[k]
    print(f"bay {', '.join(routes[r]['short'] for r in b['routes'])}: at OSM's pole '{p[4] or p[2]}' ({'stop code' if sure == 2 else 'route named'} {p[2]}), {-neg:.0f} m from the feed's", file=sys.stderr)
    b['lat'], b['lon'] = stops[b['stop']]['lat'], stops[b['stop']]['lon'] = round(p[0], 5), round(p[1], 5)
    _bay_took.add(k); _pole_took.add(n)
for k, b in enumerate(bays):
    if k not in _bay_took: print(f"bay {', '.join(routes[r]['short'] for r in b['routes'])}: no OSM pole{'' if _pl else 's'}, the feed's place", file=sys.stderr)
pulse_set = set(route_idx[r['id']] for r in routes if r['short'] in hub['pulse_routes'])
pulse = {}
for sv in services:
    count = {}
    for i in hub_stops:
        for m, ri, hi, di, _ti in times.get(str(i), {}).get(sv["id"], []):
            if ri in pulse_set: count.setdefault(m, set()).add(ri)
    # Three routes or more, as the board's list groups them (app/views/hub.js): half of those running that day left
    # out the day's ends, a Saturday's last group (1, 5, 7 and 8 at 6:30 PM) and a weekday's first (11, 12 and 15 at
    # 5:30 AM), and after 6 on a Saturday the board counted to Monday. The app reads the same from the timetable.
    pulse[sv['id']] = sorted(m for m, rs in count.items() if len(rs) >= 3)
hub_out = {'name': hub['name'], 'short': hub['short'], 'lat': hub['lat'], 'lon': hub['lon'],
           'address': stops[hub_stops[0]]['name'] if hub_stops else '', 'town': stops[hub_stops[0]]['town'] if hub_stops else '',
           'bays': bays, 'pulse': pulse, 'pulseRoutes': sorted(pulse_set), 'pulseLabel': hub.get('pulse_label', ''), 'pulseName': hub.get('pulse_name', 'Next pulse'),
           'loops': [route_idx[r['id']] for r in routes if r['short'] in H.get('loops', [])],
           'plan': hub.get('plan')}

agency = table('agency.txt')[0]
# 'CVTD Cache Valley Transit District': the initials said and then spelled out. The name alone, when the first word is
# the initials of the words after it; the brand ('Connect') is the hints', else the name.
_an = agency['agency_name'].split()
if len(_an) > 2 and _an[0].isupper() and _an[0] == ''.join(w[0] for w in _an[1:1 + len(_an[0])]).upper():
    agency['agency_name'] = ' '.join(_an[1:])
feed = (table('feed_info.txt', required=False) or [{}])[0]
out = {
    'agency': {'name': agency['agency_name'], 'brand': H.get('brand', agency['agency_name']), 'url': H.get('agency_url', agency.get('agency_url', '')),
               'tz': agency.get('agency_timezone', 'America/Denver'), 'phone': agency.get('agency_phone', ''),
               'fares': H.get('agency_fares', agency.get('agency_fare_url', ''))},
    'feed': {'version': feed.get('feed_version', ''), 'start': feed.get('feed_start_date', ''), 'end': feed.get('feed_end_date', ''),
             'built': datetime.date.today().isoformat()},
    'routes': routes, 'services': services, 'exceptions': exceptions, 'headsigns': headsigns,
    'stops': stops, 'hub': hub_out, 'times': times, 'trips': trip_ids, 'next': next_trip, 'buses': buses,
    'ends': [x for i in range(len(trip_ids)) for x in ends.get(i, [-1, -1])],
    # Where a route calls only when asked, which the feed doesn't say: [stop, route, direction] each.
    'request': [[si, route_idx[r['id']], h['direction']] for h in H.get('on_request', [])
                for si, s in enumerate(stops) if s['id'] == h['stop'] for r in routes if r['short'] in h['routes']],
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
        # key: the route as a bus's trip id names it (16's AM and PM as one), for the relay, which reads only this file
        lines.append({'route': ri, 'key': routes[ri]['short'].split()[0], 'shape': sid, 'coords': dedup})
# A route kept by hand has no shape of its own: its line is the feed's line for a trip that calls at all its stops in
# the same order, cut from its first stop to its last (the Preston commuter's is Route 16's road). The shortest such
# cut; none, and it has no line.
def along(pts, la, lo, start=0, near=50):
    """Where a point meets a line of [lon, lat] from segment `start` on: (segment, fraction along it, metres off). The
    first segment it's within `near` of, else the nearest: a line that passes a place twice is cut at the first."""
    kx, best = 111320 * math.cos(math.radians(la)), None
    for i in range(start, len(pts) - 1):
        ax, ay, bx, by = (pts[i][0] - lo) * kx, (pts[i][1] - la) * 110540, (pts[i + 1][0] - lo) * kx, (pts[i + 1][1] - la) * 110540
        dx, dy = bx - ax, by - ay
        f = max(0, min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) if dx or dy else 0
        d = math.hypot(ax + f * dx, ay + f * dy)
        if d <= near: return (i, f, d)
        if best is None or d < best[2]: best = (i, f, d)
    return best
def cut(pts, a, b):
    s, e = along(pts, *a), None
    if s: e = along(pts, *b, start=s[0])
    if not s or not e or e[2] > 150 or s[2] > 150: return None
    at = lambda i, f: [round(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, 5), round(pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f, 5)]
    seg = [at(*s[:2])] + pts[s[0] + 1:e[0] + 1] + [at(*e[:2])]
    return [p for i, p in enumerate(seg) if i == 0 or p != seg[i - 1]]
pos = {s['id']: (s['lat'], s['lon']) for s in stops}
def calls(want, have):
    it = iter(have)
    return all(x in it for x in want)
for ri, tid, ids in hand_trips:
    best = None
    for ftid, rows in by_trip.items():
        sh = trips[ftid].get('shape_id')
        if sh not in shape_pts or not calls(ids, [r['stop_id'] for r in rows]): continue
        c = cut([[lo, la] for _, la, lo in sorted(shape_pts[sh])], pos[ids[0]], pos[ids[-1]])
        if c and (best is None or len(c) < len(best)): best = c
    if best: lines.append({'route': ri, 'key': routes[ri]['short'].split()[0], 'shape': tid, 'coords': best})
    else: print('::warning::hand route', routes[ri]['short'], tid + ': no feed line calls at its stops; drawn without one', file=sys.stderr)
p = os.path.join(a.out, a.tag + '-shapes.json')
# hours: when each route's buses are in service, by weekday (Monday first, as GTFS counts), [first departure, last
# departure + 45] in minutes, null on a day it doesn't run: the relay's detour watch counts only buses then, so a bus
# driven out of service (to the yard, between runs) is never taken for a detour. Not a route run by someone else: the
# relay has none of its buses.
spans = {}
for per in out['times'].values():
    for sid, rows in per.items():
        for t in rows:
            if routes[t[1]].get('op'): continue
            k = (routes[t[1]]['short'].split()[0], sid)
            lo, hi = spans.get(k, (10 ** 9, -1))
            spans[k] = (min(lo, t[0]), max(hi, t[0]))
hours = {}
for (key, sid), (lo, hi) in spans.items():
    svc = next((x for x in out['services'] if x['id'] == sid), None)
    if not svc: continue
    h = hours.setdefault(key, [None] * 7)
    for d in range(7):
        if svc['days'][d]: h[d] = [min(lo, h[d][0]) if h[d] else lo, max(hi + 45, h[d][1]) if h[d] else hi + 45]
# ends: where each trip ends, [lat, lon, trip ids...] by place: a bus that has got there is done with its trip, and
# whatever it does on that trip id after (driven to its next run's start, to the yard) is no detour.
where = {r['stop_id']: (round(float(r['stop_lat']), 5), round(float(r['stop_lon']), 5)) for r in table('stops.txt')}
by_end = {}
for tid, sid in sorted(last_stop.items()):
    if sid in where: by_end.setdefault(where[sid], []).append(tid)
trip_ends = [[la, lo, *ts] for (la, lo), ts in sorted(by_end.items())]
# prefixes: a trip id's leading word where it isn't its route's key. The relay keys a bus by its trip's prefix (2_1400
# is 2, B1_1329 is B), and the Pumpkin Walk's trips are 'PW 1800', its lines 'Pumpkin': the detour watch looked for a
# line it never found, and counted the shuttle in service on a Sunday. A prefix two routes share is left out.
prefixes, clash = {}, set()
for t in trips.values():
    m = re.match(r'([A-Z]+|\d+)', t['trip_id'])
    k = routes[route_idx[t['route_id']]]['short'].split()[0]
    if not m or m.group(1) == k: continue
    if prefixes.get(m.group(1), k) != k: clash.add(m.group(1))
    prefixes[m.group(1)] = k
prefixes = {x: k for x, k in sorted(prefixes.items()) if x not in clash}
json.dump({'lines': lines, 'hub': {'lat': hub['lat'], 'lon': hub['lon']}, 'hours': hours, 'tz': out['agency']['tz'], 'ends': trip_ends, 'prefixes': prefixes}, open(p, 'w'), separators=(',', ':'))
print('wrote', p, os.path.getsize(p), 'bytes:', len(lines), 'lines')
for sid, ms in pulse.items():
    print('pulse', sid, len(ms), 'times', ms[:6], '...' if len(ms) > 6 else '')
print('bays', [(b['stop'], [routes[r]['short'] for r in b['routes']]) for b in bays])
print('twins', sum(1 for s in stops if s['twin']))
print('buses', {sv: {k: len(bl) for k, bl in per.items()} for sv, per in buses.items()})
