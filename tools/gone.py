#!/usr/bin/env python3
"""Stops that have left the timetable, kept a while as closed stops: data/gone-stops.json.

  python3 tools/gone.py            # after tools/reduce.py, with the timetable before it in git (HEAD)
  python3 tools/gone.py --seed     # also look back through git history for any stop a notice names that's missing

Connect takes a stop out of the GTFS for a detour (Route 3's on Canyon Road, Route 11's on Hyclone Drive, 2026-10):
the app then had no such stop at all, a rider's saved one vanished from their home page, its notice had nothing to
mark, and a rider standing at it found nothing. Kept here, the app shows it as a closed stop (its page, the map, a
saved one at the top of home) while a notice names it (in force or lapsed: tools/alerts.py keeps those three weeks),
and for a week after it's last named. A stop that leaves with no notice naming it is kept a week, then let go. Back in
the timetable, it's taken out of here.
"""
import json, os, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'gone-stops.json')
KEEP = 7 * 86400   # a week after it's last named, or after it left if never named

def load(path, default):
    try: return json.load(open(path))
    except Exception: return default

def git_json(rev, path):
    try: return json.loads(subprocess.check_output(['git', 'show', f'{rev}:{path}'], cwd=ROOT, stderr=subprocess.DEVNULL))
    except Exception: return None

def record(s, routes):
    """A stop as the timetable had it, its routes by short name (their order in the file changes between timetables)."""
    return {'id': s['id'], 'code': s.get('code', ''), 'name': s['name'], 'town': s.get('town', ''), 'lat': s['lat'], 'lon': s['lon'],
            'routes': sorted({routes[r]['short'] for r in s.get('routes', []) if r < len(routes)})}

now = int(time.time())
cur = load(os.path.join(ROOT, 'data', 'cvtd.json'), None)
if not cur: sys.exit('no data/cvtd.json')
have = {s['id'] for s in cur['stops']}
kept = {g['id']: g for g in load(OUT, {'stops': []}).get('stops', [])}
alerts = load(os.path.join(ROOT, 'data', 'alerts.json'), {'alerts': []}).get('alerts', [])
named = {sid for a in alerts for sid in (a.get('stops') or [])}

# Left since the last timetable: in HEAD's, not in this one.
before = git_json('HEAD', 'data/cvtd.json')
if before:
    for s in before['stops']:
        if s['id'] not in have and s['id'] not in kept and not s.get('hub'):
            kept[s['id']] = {**record(s, before['routes']), 'left': now, 'named': None}

# Named by a notice but in neither: looked for back through the timetable's history (a first run, or a stop that left
# before this was kept).
if '--seed' in sys.argv:
    missing = [sid for sid in named if sid not in have and sid not in kept]
    revs = subprocess.check_output(['git', 'log', '--format=%H %ct', '-n', '80', '--', 'data/cvtd.json'], cwd=ROOT, text=True).split('\n')
    for line in revs:
        if not missing or not line: break
        rev, ct = line.split()
        old = git_json(rev, 'data/cvtd.json')
        if not old: continue
        for s in old['stops']:
            if s['id'] in missing:
                kept[s['id']] = {**record(s, old['routes']), 'left': int(ct), 'named': None}
                missing.remove(s['id'])
    for sid in missing: print('  not found in the history:', sid)

# Still missing (a stop out of the timetable since before any we kept): Connect's published Remix map has every stop
# the agency has drawn, by the same id, with its name and place; its routes are the notice's (its title's 'Route 11'
# when it names none), its town the nearest stop's.
missing = [sid for sid in named if sid not in have and sid not in kept]
if missing:
    import re, urllib.request
    try:
        req = urllib.request.Request('https://platform.remix.com/api/maps/4909032d', headers={'User-Agent': 'cacherider-gone/1.0 (+https://cacherider.com)', 'Accept': 'application/json'})
        remix = {s.get('gtfsStopId'): s for s in json.load(urllib.request.urlopen(req, timeout=60)).get('stops', []) if s.get('gtfsStopId')}
    except Exception as e:
        remix = {}; print('  Remix unreachable:', e)
    shorts = {r['short'] for r in cur['routes']}
    for sid in missing:
        r = remix.get(sid)
        if not r or (r.get('geometry') or {}).get('type') != 'Point': print('  not on the Remix map either:', sid); continue
        lon, lat = r['geometry']['coordinates'][:2]
        rs = set()
        for a in alerts:
            if sid not in (a.get('stops') or []): continue
            rs |= set(a.get('routes') or [])
            rs |= {m for m in re.findall(r'\b(?:Route|Rt)\.?\s*(\d+)', a.get('title', '')) if m in shorts}
        near = min(cur['stops'], key=lambda s: (s['lat'] - lat) ** 2 + (s['lon'] - lon) ** 2)
        name = re.sub(r'\s*\(TIMEPOINT\)\s*$', '', r.get('name') or sid, flags=re.I)
        kept[sid] = {'id': sid, 'code': '', 'name': name, 'town': near.get('town', ''), 'lat': round(lat, 5), 'lon': round(lon, 5), 'routes': sorted(rs), 'left': now, 'named': None, 'from': 'remix'}

out = []
for sid, g in kept.items():
    if sid in have: continue   # back in the timetable
    if sid in named: g['named'] = now
    if now - max(g['left'], g['named'] or 0) > KEEP: continue
    out.append(g)
out.sort(key=lambda g: g['id'])
json.dump({'built': time.strftime('%Y-%m-%d', time.gmtime(now)), 'stops': out}, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
print('wrote', OUT, len(out), 'stops kept out of the timetable')
for g in out: print('  %s %-32s routes %s%s' % (g['id'], g['name'][:32], ','.join(g['routes']) or '-', ' (named)' if g['named'] else ''))
