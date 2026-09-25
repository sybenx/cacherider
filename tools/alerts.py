#!/usr/bin/env python3
"""Fetch the agency's GTFS-realtime service alerts and write data/alerts.json:
detours, closed stops, late starts. Decoded here without protobuf bindings, since
the alert message is small and the app only needs its words and its targets.

  python3 tools/alerts.py

The server refuses requests that carry a browser Origin header, so the phone
can't read the feed itself; this runs hourly in GitHub Actions instead.
"""
import json, os, sys, time, urllib.request

URL = 'https://mycvtdbus.org/gtfs-rt/alerts'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CAUSE = {1: 'unknown', 2: 'other', 3: 'technical', 4: 'strike', 5: 'demonstration', 6: 'accident', 7: 'holiday', 8: 'weather', 9: 'maintenance', 10: 'construction', 11: 'police', 12: 'medical'}
EFFECT = {1: 'no-service', 2: 'reduced', 3: 'delays', 4: 'detour', 5: 'additional', 6: 'modified', 7: 'other', 8: 'unknown', 9: 'stop-moved', 10: 'none', 11: 'accessibility'}

def varint(b, i):
    r = s = 0
    while True:
        c = b[i]; i += 1; r |= (c & 0x7f) << s; s += 7
        if c < 0x80: return r, i

def fields(b):
    """A message as a list of (field number, value): ints for varints, bytes for length-delimited."""
    i, out = 0, []
    while i < len(b):
        k, i = varint(b, i); f, w = k >> 3, k & 7
        if w == 0: v, i = varint(b, i); out.append((f, v))
        elif w == 2: n, i = varint(b, i); out.append((f, b[i:i + n])); i += n
        elif w == 1: i += 8
        elif w == 5: i += 4
        else: raise ValueError('wire type %d' % w)
    return out

def text(ts):
    """A TranslatedString: the English translation, else the first."""
    best = None
    for f, v in fields(ts):
        if f != 1: continue
        t = dict(fields(v))
        s = t.get(1, b'').decode('utf-8', 'replace').strip()
        lang = t.get(2, b'').decode('utf-8', 'replace')
        if best is None or lang.startswith('en'): best = s
    return best or ''

def alert(b, eid):
    a = {'id': eid, 'title': '', 'text': '', 'url': '', 'cause': '', 'effect': '', 'start': None, 'end': None, 'routeIds': [], 'stops': []}
    for f, v in fields(b):
        if f == 1:
            p = dict(fields(v)); a['start'] = p.get(1, a['start']); a['end'] = p.get(2, a['end'])
        elif f == 5:
            e = dict(fields(v))
            if 2 in e: a['routeIds'].append(e[2].decode())
            if 5 in e: a['stops'].append(e[5].decode())
        elif f == 6: a['cause'] = CAUSE.get(v, str(v))
        elif f == 7: a['effect'] = EFFECT.get(v, str(v))
        elif f == 8: a['url'] = text(v)
        elif f == 10: a['title'] = text(v)
        elif f == 11: a['text'] = text(v)
    a['routeIds'] = sorted(set(a['routeIds'])); a['stops'] = sorted(set(a['stops']))
    return a

req = urllib.request.Request(URL, headers={'User-Agent': 'cacherider/1.0 (+https://cacherider.com)'})
raw = urllib.request.urlopen(req, timeout=30).read()
alerts = []
for f, v in fields(raw):
    if f != 2: continue
    ent = dict(fields(v))
    if 5 in ent and not ent.get(2): alerts.append(alert(ent[5], ent.get(1, b'').decode()))

# Route ids become the short names the app uses; unknown ids stay as ids.
try:
    routes = {r['id']: r['short'] for r in json.load(open(os.path.join(ROOT, 'data', 'cvtd.json')))['routes']}
except Exception:
    routes = {}
for a in alerts:
    a['routes'] = [routes[r] for r in a['routeIds'] if r in routes]
    a['routeIds'] = [r for r in a['routeIds'] if r not in routes]
alerts.sort(key=lambda a: (len(a['id']), a['id']))
out = {'fetched': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'source': URL, 'alerts': alerts}
p = os.path.join(ROOT, 'data', 'alerts.json')
json.dump(out, open(p, 'w'), separators=(',', ':'), ensure_ascii=False)
print('wrote', p, len(alerts), 'alerts')
for a in alerts: print('  %s %-10s %-40s routes %s stops %d' % (a['id'], a['effect'], a['title'][:40], a['routes'] or a['routeIds'], len(a['stops'])))
