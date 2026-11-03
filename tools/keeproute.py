#!/usr/bin/env python3
"""A route the feed still lists but with no trips, its last good timetable put back into the feed: a new zip for
tools/reduce.py to read again.

  python3 tools/keeproute.py /tmp/cvtd.zip /tmp/cvtd-kept.zip    # after tools/reduce.py, the timetable before it in git (HEAD)

CVTD's export (GMV Syncromatics) has listed the Blue Loop with no trips since 22 Oct 2026, a new feed version with it
(2 Nov, 'Stop adjustments'): the night's guard kept yesterday's timetable whole, and every other route's change waited
on the Blue Loop. Now the new feed goes up, and an emptied route rides on its trips as the last timetable had them,
rebuilt from data/cvtd.json and data/cvtd-shapes.json at HEAD as GTFS rows: its trips, their calls to the minute (the
reduced file keeps no seconds), its timepoints, its blocks (the next trip each bus runs) and its line. Rebuilt each
night from the last, it stands as it was until the feed has the route's trips again.

The route's timetable is old, and the app says so: kept.txt goes in the new zip, the route and the date of the
timetable it's on (the last one's, carried night to night), which tools/reduce.py puts on the route ('kept').

Only what the new feed can carry: a calendar it no longer has is the old one's row, a stop it no longer has is left
out of the trips, said here. Prints the routes put back ('Blue Loop'), one a line; none, exit 1.
"""
import csv, io, json, subprocess, sys, zipfile

src, dst = sys.argv[1], sys.argv[2]
old = json.loads(subprocess.check_output(['git', 'show', 'HEAD:data/cvtd.json']))
old_lines = json.loads(subprocess.check_output(['git', 'show', 'HEAD:data/cvtd-shapes.json']))['lines']
z = zipfile.ZipFile(src)

def table(name):
    try: return list(csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig')))
    except KeyError: return []
def header(name):
    try: return next(csv.reader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig')))
    except KeyError: return []

trips = table('trips.txt')
running = {t['route_id'] for t in trips}
feed_routes = {r['route_id'] for r in table('routes.txt')}
lost = [(ri, r) for ri, r in enumerate(old['routes']) if r.get('stops') and not r.get('op') and r['id'] in feed_routes and r['id'] not in running]
if not lost: sys.exit(1)

stop_ids = {s['stop_id'] for s in table('stops.txt')}
calendar = {c['service_id'] for c in table('calendar.txt')}
trip_ids = {t['trip_id'] for t in trips}
shape_ids = {r['shape_id'] for r in table('shapes.txt')}
add = {'trips.txt': [], 'stop_times.txt': [], 'shapes.txt': [], 'calendar.txt': [], 'kept.txt': []}
DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
hms = lambda m: f'{m // 60:02d}:{m % 60:02d}:00'

for ri, r in lost:
    seq = r['stops'].get('0', []) + r['stops'].get('1', [])
    order = {si: k for k, si in reversed(list(enumerate(seq)))}   # a stop's first place on the route, to break a tie
    tps = set(r.get('tp', []))
    calls, svc, info = {}, {}, {}   # trip index → [(minute, stop)], its service, (headsign, direction)
    for si, per in old['times'].items():
        for sv, rows in per.items():
            for m, rr, hi, di, ti in rows:
                if rr != ri: continue
                calls.setdefault(ti, []).append((m, int(si))); svc[ti] = sv; info[ti] = (old['headsigns'][hi], di)
    # Its line: the shape the last timetable drew it with, renamed so the feed's own can't clash. Kept a night before,
    # it's named so already: once (it was kept-kept-32000 the second night, a kept- more each night after).
    shape = ''
    for ln in old_lines:
        if ln['route'] != ri: continue
        sid = str(ln['shape']) if str(ln['shape']).startswith('kept-') else 'kept-' + str(ln['shape'])
        if not shape: shape = sid
        if sid in shape_ids: continue
        shape_ids.add(sid)
        add['shapes.txt'] += [{'shape_id': sid, 'shape_pt_lat': la, 'shape_pt_lon': lo, 'shape_pt_sequence': k} for k, (lo, la) in enumerate(ln['coords'])]
    # Its blocks: the chains of next trips, each a block of its own.
    nxt = {(sv, int(a)): b for sv, n in old['next'].items() for a, b in n.items()}
    block, n = {}, 0
    for ti in sorted(calls, key=lambda t: min(calls[t])):
        if ti in block: continue
        n += 1; t = ti
        while t is not None and t in calls and t not in block:
            block[t] = f'kept-{r["short"]}-{n}'; t = nxt.get((svc[ti], t))
    for sv in set(svc.values()) - calendar:
        s = next(x for x in old['services'] if x['id'] == sv)
        add['calendar.txt'].append({'service_id': sv, **dict(zip(DAYS, s['days'])), 'start_date': s['start'], 'end_date': s['end']})
        calendar.add(sv)
    missing = set()
    for ti, cs in sorted(calls.items()):
        tid = old['trips'][ti]
        if tid in trip_ids: continue
        cs.sort(key=lambda c: (c[0], order.get(c[1], 10 ** 6)))
        end = old['ends'][2 * ti:2 * ti + 2]
        if end[0] >= 0: cs.append((end[1], end[0]))
        cs = [(m, si) for m, si in cs if old['stops'][si]['id'] in stop_ids or missing.add(old['stops'][si]['id'])]
        if len(cs) < 2: continue
        headsign, di = info[ti]
        add['trips.txt'].append({'trip_id': tid, 'route_id': r['id'], 'service_id': svc[ti], 'trip_headsign': headsign,
                                 'direction_id': di, 'block_id': block[ti], 'shape_id': shape})
        add['stop_times.txt'] += [{'trip_id': tid, 'arrival_time': hms(m), 'departure_time': hms(m), 'stop_id': old['stops'][si]['id'],
                                   'stop_sequence': k, 'pickup_type': 0, 'timepoint': int(si in tps)} for k, (m, si) in enumerate(cs)]
    if missing: print(f'{r["short"]}: stops no longer in the feed, left out of its kept trips:', ' '.join(sorted(missing)), file=sys.stderr)
    add['kept.txt'].append({'route_id': r['id'], 'since': r.get('kept') or old['feed']['built']})
    print(r['long'] or r['short'])

with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as out:
    out.writestr('kept.txt', 'route_id,since\r\n' + ''.join(f"{k['route_id']},{k['since']}\r\n" for k in add['kept.txt']))
    for name in z.namelist():
        if name == 'kept.txt': continue
        body = z.read(name)
        if add.get(name):
            cols = header(name)
            buf = io.StringIO()
            w = csv.DictWriter(buf, cols, extrasaction='ignore', lineterminator='\r\n')
            w.writerows(add[name])
            body = body.rstrip(b'\r\n') + b'\r\n' + buf.getvalue().encode()
        out.writestr(name, body)
