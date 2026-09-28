#!/usr/bin/env python3
"""Fetch the agency's service notices and write data/alerts.json: detours, closed
stops, late starts. Two sources, the tracker site's announcements first (on the
site the minute the agency posts one, with the routes and stops each is put on)
and the GTFS-realtime alerts feed for any the site hasn't got. The feed is
decoded here without protobuf bindings, since the alert message is small and
the app only needs its words and its targets.

  python3 tools/alerts.py

The servers refuse requests that carry a browser Origin header, so the phone
can't read them itself: the live relay (worker/) serves the site's notices,
and this file, refreshed by GitHub Actions, is what the app falls back on.
"""
import datetime, json, os, sys, time, urllib.request

URL = 'https://mycvtdbus.org/gtfs-rt/alerts'
SITE = 'https://mycvtdbus.org/announcements.data'
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

UA = {'User-Agent': 'cacherider/1.0 (+https://cacherider.com)'}

def site():
    """The tracker site's announcements, from its React Router data endpoint. Turbo-stream: one array, in which
    each object's keys and values, and each array's items, are indexes into the array."""
    raw = json.load(urllib.request.urlopen(urllib.request.Request(SITE, headers=UA), timeout=30))
    memo = {}
    def dec(i):
        if not isinstance(i, int) or isinstance(i, bool) or i < 0: return None
        if i in memo: return memo[i]
        v = raw[i]
        if isinstance(v, list):
            memo[i] = out = []
            for x in v: out.append(dec(x))
            return out
        if isinstance(v, dict):
            memo[i] = out = {}
            for k, x in v.items(): out[dec(int(k[1:]))] = dec(x)
            return out
        return v
    msgs = dec(0)['routes/transit']['data']['messages']
    def epoch(t):
        try: return int(datetime.datetime.fromisoformat(t).timestamp())
        except Exception: return None
    out = []
    for m in msgs:
        if not isinstance(m, dict): continue
        asg = m.get('assignments') or {}
        out.append({'id': 'a%s' % m.get('id'), 'title': str(m.get('name') or '').strip(), 'text': str(m.get('text') or '').strip(), 'url': '', 'cause': '', 'effect': '',
                    'start': epoch(m.get('start')), 'end': epoch(m.get('end')), 'routeIds': [],
                    'routes': [r['shortName'] for r in asg.get('routes') or [] if isinstance(r, dict) and r.get('shortName')],
                    'stops': [str(s['id']) for s in asg.get('stops') or [] if isinstance(s, dict) and s.get('id') is not None],
                    'global': bool(asg.get('global')),
                    # the titles the same notice goes out under elsewhere (the feed's is the app push's), to match by
                    'aka': [str(x.get('overrideTitle') or '') for k in ('appMessage', 'webAnnouncementMessages') for x in m.get(k) or [] if isinstance(x, dict)]})
    return out

def feed():
    raw = urllib.request.urlopen(urllib.request.Request(URL, headers=UA), timeout=30).read()
    out = []
    for f, v in fields(raw):
        if f != 2: continue
        ent = dict(fields(v))
        if 5 in ent and not ent.get(2): out.append(alert(ent[5], ent.get(1, b'').decode()))
    return out

try: alerts = site()
except Exception as e: print('site announcements unreachable:', e, file=sys.stderr); alerts = []
# The feed's, for any the site hasn't (matched by title); one source down, the other still answers.
key = lambda t: ' '.join(t.lower().split())
have = {key(t) for a in alerts for t in [a['title'], *a.pop('aka', [])] if t.strip()}
try: extra = [a for a in feed() if key(a['title']) not in have]
except Exception as e:
    print('alerts feed unreachable:', e, file=sys.stderr); extra = []
    if not alerts: sys.exit(1)
alerts += extra

# Route ids become the short names the app uses; unknown ids stay as ids.
try:
    routes = {r['id']: r['short'] for r in json.load(open(os.path.join(ROOT, 'data', 'cvtd.json')))['routes']}
except Exception:
    routes = {}
for a in alerts:
    a['routes'] = sorted(set(a.get('routes') or []) | {routes[r] for r in a['routeIds'] if r in routes})
    a['routeIds'] = [r for r in a['routeIds'] if r not in routes]
alerts.sort(key=lambda a: (a['start'] or 0, a['id']))
out = {'fetched': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'source': SITE + ' + ' + URL, 'alerts': alerts}
p = os.path.join(ROOT, 'data', 'alerts.json')
json.dump(out, open(p, 'w'), separators=(',', ':'), ensure_ascii=False)
print('wrote', p, len(alerts), 'alerts')
for a in alerts: print('  %s %-10s %-40s routes %s stops %d' % (a['id'], a['effect'], a['title'][:40], a['routes'] or a['routeIds'], len(a['stops'])))
