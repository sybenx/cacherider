#!/usr/bin/env python3
"""The routes kept by hand (hints.json's hand_routes: tools/prt.json, Pocatello Regional Transit's Preston / Logan
Commuter) were typed in from their operator's timetable and holiday page, which no feed watches. Each night: has either
changed since? A change is said, never fixed: a warning in the run's log, and a line for the night's data commit
(DATA_NOTE, in the workflow's environment). The file is put right by hand. Never a failure: the timetable goes up
whatever this finds, and a source that can't be reached is said as that.

    python3 tools/handcheck.py [--hints tools/hints.json]
"""
import argparse, datetime, json, os, urllib.error, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument('--hints', default=os.path.join(os.path.dirname(__file__), 'hints.json'))
a = ap.parse_args()
H = json.load(open(a.hints))

# A browser's: pocatellotransit.com answers urllib's and curl's own with a 404.
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

def ask(url, method='GET'):
    with urllib.request.urlopen(urllib.request.Request(url, method=method, headers={'User-Agent': UA}), timeout=30) as r:
        return r.headers, r.read() if method == 'GET' else b''

notes = []
def say(text):
    notes.append(text)
    print('::warning::' + text)

for f in H.get('hand_routes', []):
    path = os.path.join(os.path.dirname(a.hints), f)
    if not os.path.exists(path): continue
    hr = json.load(open(path))
    name = hr['route']['long']
    # The timetable: its Last-Modified against the one it was typed in from. Gone from its address is a change too.
    if hr.get('source'):
        try:
            got = ask(hr['source'], 'HEAD')[0].get('Last-Modified')
            if got is None: print(f'{name}: timetable has no Last-Modified; not checked')
            elif got != hr.get('source_modified'): say(f"{name}: its timetable has changed (last modified {got}; {f} is from {hr.get('source_modified')}): {hr['source']}")
            else: print(f'{name}: timetable as typed in ({got})')
        except urllib.error.HTTPError as e:
            if e.code in (404, 410): say(f"{name}: its timetable isn't at its address any more ({e.code}): {hr['source']}")
            else: print(f'{name}: timetable answered {e.code}; not checked')
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            print(f'{name}: timetable unreachable ({e}); not checked')
    # The holiday page (a WordPress page: its modified time, from its API, the page itself saying none).
    if hr.get('holidays_api'):
        try:
            got = json.loads(ask(hr['holidays_api'])[1]).get('modified_gmt')
            if got is None: print(f'{name}: holidays page says no modified time; not checked')
            elif got != hr.get('holidays_modified'): say(f"{name}: its holidays page has changed (modified {got}; {f} is from {hr.get('holidays_modified')}): {hr.get('holidays_source', hr['holidays_api'])}")
            else: print(f'{name}: holidays as typed in ({got})')
        except urllib.error.HTTPError as e:
            if e.code in (404, 410): say(f"{name}: its holidays page isn't at its address any more ({e.code}): {hr['holidays_api']}")
            else: print(f'{name}: holidays page answered {e.code}; not checked')
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
            print(f'{name}: holidays page unreachable ({e}); not checked')
    # This year's holidays, and from December next year's: without them its bus runs on days it doesn't.
    today = datetime.date.today()
    for y in [today.year] + ([today.year + 1] if today.month == 12 else []):
        if not any(d.startswith(str(y)) for d in hr.get('holidays', [])): say(f'{name}: no {y} holidays in {f} yet')

if notes and os.environ.get('GITHUB_ENV'):
    with open(os.environ['GITHUB_ENV'], 'a') as e: e.write('DATA_NOTE=' + ' '.join(notes) + '\n')
