#!/usr/bin/env python3
"""Each trip's timed stops, for the relay to tell a bus gone by one early: data/timed.json.

  python3 tools/timed.py           # after tools/reduce.py (and keeproute's splice), from data/cvtd.json

The relay (worker/src/early.js) reads it once an hour: the timetable's 367 KB parsed and walked on the free plan's
10 ms a run was most of a run. Per trip, in calling order, each timed stop (its route's timepoints, as data.js timed())
but the trip's first (the bus starts there) and the Transit Center's (its bays have their own rules): [stop id,
minute]; the stops' places once, by id. A sister site's the same, from its own feed's timepoints.
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
c = json.load(open(os.path.join(ROOT, 'data', 'cvtd.json')))
calls = {}   # trip index → [(minute, stop index)]
for si, per in c['times'].items():
    for rows in per.values():
        for m, r, _, d, t in rows: calls.setdefault(t, []).append((m, int(si), r, d))
trips, places = {}, {}
for ti, cs in calls.items():
    cs.sort()
    r, d = cs[0][2], cs[0][3]
    order = {si: k for k, si in reversed(list(enumerate(c['routes'][r]['stops'].get(str(d), []))))}
    cs.sort(key=lambda x: (x[0], order.get(x[1], 10 ** 6)))   # two stops in a minute: the route's own order
    tp = set(c['routes'][r].get('tp') or [])
    out = []
    for k, (m, si, _, _) in enumerate(cs):
        s = c['stops'][si]
        if k == 0 or si not in tp or s.get('hub'): continue
        out.append([s['id'], m]); places[s['id']] = [s['lat'], s['lon']]
    if out: trips[c['trips'][ti]] = out
json.dump({'tz': c['agency']['tz'], 'version': c['feed']['version'], 'stops': places, 'trips': trips},
          open(os.path.join(ROOT, 'data', 'timed.json'), 'w'), separators=(',', ':'))
print(len(trips), 'trips with timed stops,', len(places), 'stops')
