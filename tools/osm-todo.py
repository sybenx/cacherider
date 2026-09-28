#!/usr/bin/env python3
"""What Cache Valley's riders look for that OpenStreetMap hasn't got, laid out for JOSM.

  python3 tools/osm-todo.py [--out DIR]     # writes places-todo.osm and bus-stops.osm

Two files of proposed nodes, each with its tags filled in, for a person to review in JOSM (File → Open), drag onto
the right building, and upload. Nothing here uploads by itself: OpenStreetMap's automated-edits policy asks for a
human eye on every change, and the agency's names and positions are hints, not survey.

places-todo.osm — the rider pamphlet's places (data/places.json) and the landmarks the buses announce (stop_desc,
kept as `by` in data/cvtd.json) that have nothing like them in OpenStreetMap within 300 m. Each node sits at its
stop (or the pamphlet's point) with a note saying so; move it onto the place before uploading. The tags are a best
guess from the pamphlet's category and the name; check them.

routes/*.gpx — each route's drawn shape as a GPX track, one file per shape, for JOSM to show under the roads
while a route relation is built (the PT_Assistant plugin's routing helper follows a track like this). A bus route
in OpenStreetMap is a relation of the map's own road segments in order, so it can't be written from the GTFS,
only traced against it.

bus-stops.osm — every Connect stop as highway=bus_stop, from the GTFS. Exact positions, but a full import needs a
note to the OpenStreetMap US community first (wiki: Import/Guidelines); until then, upload a few at a time as you
verify them on the ground, or use it to check stops others have mapped.
"""
import argparse, json, math, os, re
from xml.sax.saxutils import quoteattr

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument('--out', default=os.path.join(os.path.expanduser('~'), 'cacherider-osm-todo'))
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

D = json.load(open(os.path.join(ROOT, 'data', 'cvtd.json')))
P = json.load(open(os.path.join(ROOT, 'data', 'places.json')))['places']
O = json.load(open(os.path.join(ROOT, 'data', 'osm-places.json')))['places']

def dist(a, b, c, d): return math.hypot((c - a) * 111000, (d - b) * 111000 * math.cos(math.radians(a)))
STOP = {'the', 'of', 'and', '&', 'at', 'st', 'street', 'north', 'south', 'east', 'west', 'n', 's', 'e', 'w', 'center', 'centre', 'main'}
def words(x): return {w for w in re.sub(r"[^\w\s]", ' ', x.lower().replace("'", '')).split() if w not in STOP and not w.isdigit()}
def alike(a, b):
    A, B = words(a), words(b)
    return bool(A and B) and len(A & B) / min(len(A), len(B)) >= 0.5
def mapped(name, lat, lon, m=300, pamphlet=True):
    return any(alike(name, o[0]) for o in O if dist(lat, lon, o[1], o[2]) < m) or (pamphlet and any(alike(name, p['name']) for p in P if dist(lat, lon, p['lat'], p['lon']) < m))

# A guess at tags from the pamphlet's category, or the name's own words.
CAT = {'schools': {'amenity': 'school'}, 'medical': {'amenity': 'clinic', 'healthcare': 'clinic'}, 'grocery': {'shop': 'supermarket'},
       'entertainment': {'leisure': 'park'}, 'shopping': {'shop': 'yes'}, 'community': {'office': 'government'}}
def guess(name, cat=None):
    n = name.lower()
    if cat in CAT: t = dict(CAT[cat])
    elif re.search(r'\b(apts?|apartments?|manor|village|cove|court|townhomes?|terrace|estates|meadows|springs|hollow|pointe?|square)\b', n): t = {'building': 'apartments', 'residential': 'apartments'}
    elif re.search(r'\b(district office|city offices?|dmv|wic|services|dept|department)\b', n): t = {'office': 'government'}
    elif re.search(r'\b(lds|church|kingdom hall|ward|stake|temple)\b', n): t = {'amenity': 'place_of_worship', 'religion': 'christian'}
    elif re.search(r'\b(clinic|medical|health|urgent care|hospital|dental|pediatric)\b', n): t = {'amenity': 'clinic', 'healthcare': 'clinic'}
    elif re.search(r'\b(school|academy|elementary|middle|high)\b', n): t = {'amenity': 'school'}
    elif re.search(r'\b(bank|credit union)\b', n): t = {'amenity': 'bank'}
    elif re.search(r'\b(pizza|grill|cafe|restaurant|dough|creamery)\b', n): t = {'amenity': 'restaurant'}
    elif re.search(r'\b(park|trailhead|lake)\b', n): t = {'leisure': 'park'}
    elif re.search(r'\b(center|centre|hall|office|dept|department|library|civic|city)\b', n): t = {'amenity': 'community_centre'}
    elif re.search(r'\b(tire|auto|oil)\b', n): t = {'shop': 'car_repair'}
    elif re.search(r'\b(farms?|plant|metals|mfg|manufacturing|inc|sei|presto|nes)\b', n): t = {'man_made': 'works'}
    else: t = {'fixme': 'what kind of place is this?'}
    return t

def node(i, lat, lon, tags):
    return f'  <node id="{i}" lat="{lat:.6f}" lon="{lon:.6f}" version="0" action="modify">\n' + ''.join(f'    <tag k={quoteattr(k)} v={quoteattr(str(v))}/>\n' for k, v in tags.items()) + '  </node>\n'
def write(path, nodes):
    with open(path, 'w') as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="cacherider osm-todo" upload="true">\n' + ''.join(nodes) + '</osm>\n')

# ---- places-todo
todo, nid, seen = [], -1, set()
for p in P:
    if mapped(p['name'], p['lat'], p['lon'], pamphlet=False): continue   # against OpenStreetMap only: the guide can't vouch for itself
    seen.add(p['name'].lower())
    todo.append(node(nid, p['lat'], p['lon'], {'name': p['name'], **guess(p['name'], p['cat']), 'note': "From Connect's rider guide; position is the guide's, move onto the place", 'source': 'survey;CVTD rider guide'})); nid -= 1
for s in D['stops']:
    by = s.get('by')
    if not by: continue
    name = re.sub(r'^(across from|near|by|behind|in front of)\s+', '', by, flags=re.I).strip()
    if name.lower() in seen or not words(name) or mapped(name, s['lat'], s['lon']): continue
    seen.add(name.lower())
    todo.append(node(nid, s['lat'], s['lon'], {'name': name, **guess(name), 'note': f"Announced at Connect stop {s['code'] or s['id']} ({s['name']}); placed at the stop, move onto the place", 'source': 'survey;CVTD GTFS stop_desc'})); nid -= 1
write(os.path.join(a.out, 'places-todo.osm'), todo)

# ---- bus stops
stops = []
for s in D['stops']:
    t = {'highway': 'bus_stop', 'public_transport': 'platform', 'bus': 'yes', 'name': s['name'], 'ref': s['code'] or s['id'], 'network': D['agency']['brand'], 'operator': D['agency']['name'].split(' ', 1)[1] if ' ' in D['agency']['name'] else D['agency']['name'], 'route_ref': ';'.join(D['routes'][r]['short'] for r in s['routes'])}
    if s.get('by'): t['description'] = s['by']
    stops.append(node(nid, s['lat'], s['lon'], t)); nid -= 1
write(os.path.join(a.out, 'bus-stops.osm'), stops)

# ---- routes as GPX tracks
lines = json.load(open(os.path.join(ROOT, 'data', 'cvtd-shapes.json')))['lines']
os.makedirs(os.path.join(a.out, 'routes'), exist_ok=True)
for l in lines:
    r = D['routes'][l['route']]
    name = f"Route {r['short']} shape {l['shape']}"
    pts = ''.join(f'      <trkpt lat="{lat:.6f}" lon="{lon:.6f}"/>\n' for lon, lat in l['coords'])
    with open(os.path.join(a.out, 'routes', f"route-{r['short'].replace(' ', '-')}-{l['shape']}.gpx"), 'w') as f:
        f.write(f'<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="cacherider osm-todo" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk><name>{name}</name><desc>{r["long"]}: {r["desc"]}</desc><trkseg>\n{pts}    </trkseg></trk>\n</gpx>\n')
print(f'{len(todo)} places to add → {a.out}/places-todo.osm; {len(stops)} bus stops → {a.out}/bus-stops.osm; {len(lines)} route shapes → {a.out}/routes/')
