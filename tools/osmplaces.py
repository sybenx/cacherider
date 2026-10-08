#!/usr/bin/env python3
"""Every named place in Cache Valley a rider might search for, from OpenStreetMap, for search to find on the device.

  python3 tools/osmplaces.py        # needs data/cvtd.json (the stops); writes data/osm-places.json

One query to OpenStreetMap's Overpass API when the data is rebuilt; nothing is looked up while a rider searches.
Kept: places within walking distance of a stop, of kinds a rider would look for (not car parts or picnic tables).
Each gets its area, the town of its nearest stop, and where a name repeats in a town (a hundred chapels called the
same), the stop it's by. Where the same name sits twice within a block (a shop mapped as a point and a building),
it's kept once. The pamphlet's places (data/places.json) are searched first and win over these.
"""
import json, math, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'osm-places.json')
BOX = '41.50,-112.10,42.10,-111.65'   # south, west, north, east: the valley, Idaho's end of it too
WALK = 1200                           # metres from the nearest stop: further, and the bus isn't the way there

QUERY = f"""[out:json][timeout:120];
(
  nwr["name"]["amenity"]({BOX}); nwr["name"]["shop"]({BOX}); nwr["name"]["leisure"]({BOX});
  nwr["name"]["office"]({BOX}); nwr["name"]["tourism"]({BOX}); nwr["name"]["healthcare"]({BOX});
  nwr["name"]["building"~"school|university|college|hospital|civic|public|stadium|government|retail|commercial"]({BOX});
  nwr["name"]["man_made"="works"]({BOX}); nwr["name"]["landuse"~"industrial|commercial|retail|residential"]({BOX});
  nwr["name"]["building"~"^(apartments|dormitory)$"]({BOX});
  nwr["name"]["place"~"^(neighbourhood|suburb|quarter)$"]({BOX});
  way["highway"]["loc_name"]({BOX}); way["highway"]["nickname"]({BOX});
);
out center bb tags;"""

KEYS = ['amenity', 'shop', 'leisure', 'healthcare', 'tourism', 'office', 'building', 'man_made', 'landuse']
# Names a place also goes by (a brand, an old name, what's on the sign): searched, never shown.
ALSO = ['alt_name', 'short_name', 'old_name', 'brand', 'operator', 'official_name', 'loc_name', 'nickname']   # loc_name: what the town calls it ('Aztec Building', 'First Dam')
# Kinds nobody takes a bus to find.
SKIP = {
    'amenity': {'parking', 'parking_space', 'parking_entrance', 'bench', 'waste_basket', 'bicycle_parking', 'fire_hydrant',
                'drinking_water', 'toilets', 'vending_machine', 'post_box', 'atm', 'recycling', 'shelter', 'charging_station',
                'car_wash', 'grave_yard', 'motorcycle_parking', 'loading_dock', 'waste_disposal', 'hunting_stand', 'clock', 'bbq',
                'fountain', 'telephone', 'water_point', 'compressed_air', 'bicycle_repair_station', 'letter_box', 'photo_booth'},
    'leisure': {'pitch', 'playground', 'swimming_pool', 'garden', 'picnic_table', 'firepit', 'track', 'slipway',
                'fitness_station', 'outdoor_seating', 'bleachers', 'common', 'schoolyard', 'hot_tub'},
    'tourism': {'artwork', 'camp_pitch', 'information', 'viewpoint', 'picnic_site'},
    'shop': {'car_repair', 'car_parts', 'tyres', 'vacant'},
    'office': {'yes'},
}
# What a kind is called in a result: 'Restaurant', 'Grocery', 'Church'.
WORDS = {
    'place_of_worship': 'Church', 'fast_food': 'Fast food', 'supermarket': 'Grocery', 'convenience': 'Convenience store',
    'clinic': 'Clinic', 'doctors': 'Doctor', 'dentist': 'Dentist', 'pharmacy': 'Pharmacy', 'hospital': 'Hospital',
    'university': 'University', 'college': 'College', 'school': 'School', 'kindergarten': 'Preschool', 'library': 'Library',
    'townhall': 'City hall', 'post_office': 'Post office', 'fire_station': 'Fire station', 'police': 'Police',
    'community_centre': 'Community center', 'events_venue': 'Event venue', 'sports_centre': 'Sports center',
    'fitness_centre': 'Gym', 'ice_rink': 'Ice rink', 'nature_reserve': 'Nature reserve', 'social_facility': 'Social services',
    'bank': 'Bank', 'cafe': 'Cafe', 'bar': 'Bar', 'pub': 'Pub', 'restaurant': 'Restaurant', 'ice_cream': 'Ice cream',
    'hotel': 'Hotel', 'motel': 'Motel', 'museum': 'Museum', 'theatre': 'Theater', 'cinema': 'Movie theater', 'park': 'Park',
    'department_store': 'Department store', 'mall': 'Mall', 'clothes': 'Clothing', 'government': 'Government office',
    'civic': 'Public building', 'public': 'Public building', 'retail': 'Shop', 'commercial': 'Business',
    'stadium': 'Stadium', 'yes': '', 'doityourself': 'Hardware', 'hardware': 'Hardware', 'car': 'Car dealer',
    'works': 'Plant', 'industrial': 'Industrial area',
    'apartments': 'Apartments', 'dormitory': 'Dorm', 'residential': 'Neighborhood',
}

def dist(a, b, c, d):
    return 6371000 * 2 * math.asin(math.sqrt(math.sin(math.radians(c - a) / 2) ** 2 + math.cos(math.radians(a)) * math.cos(math.radians(c)) * math.sin(math.radians(d - b) / 2) ** 2))

D = json.load(open(os.path.join(ROOT, 'data', 'cvtd.json')))
stops = [s for s in D['stops'] if not s.get('hub')] + [s for s in D['stops'] if s.get('hub')][:1]

# Overpass is often busy: a few tries, the main server and a mirror in turn. OSM_CACHE=file (working on this script):
# the answer kept there and read back, Overpass asked once.
CACHE = os.environ.get('OSM_CACHE')
els = json.load(open(CACHE)) if CACHE and os.path.exists(CACHE) else None
for tries in range(0 if els is not None else 6):
    req = urllib.request.Request(['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'][tries % 2],
                                 data=urllib.parse.urlencode({'data': QUERY}).encode(), headers={'User-Agent': 'cacherider-places/1.0 (+https://cacherider.com)'})
    try:
        els = json.load(urllib.request.urlopen(req, timeout=180))['elements']
        if CACHE: json.dump(els, open(CACHE, 'w'))
        break
    except Exception as ex:
        if tries == 5: raise
        print('Overpass:', ex, '- again', file=sys.stderr); time.sleep(20 if tries % 2 == 0 else 60)

rank = {k: i for i, k in enumerate(KEYS)}
# The campus, if the valley has one: the university's own name, shortest where several features carry it (the campus
# over its innovation campus), as initials, 'USU'. Its buildings are listed under that word, and a route ending on
# campus is 'to USU'. Nothing here is Cache Valley's: any system with a university gets the same.
uni = sorted({(e.get('tags') or {}).get('name', '').strip() for e in els if (e.get('tags') or {}).get('amenity') == 'university' and 'university' in (e.get('tags') or {}).get('name', '').lower()}, key=len)
campus = ''.join(w[0] for w in uni[0].split() if w[0].isupper() and w.lower() not in ('of', 'the', 'at', 'in')) if uni else ''
found = []
for e in els:
    t = e.get('tags', {})
    name = (t.get('name') or '').strip()
    b = e.get('bounds') or {}   # asked for with the boxes (areas, below), an outline comes with its box and no centre
    lat = e.get('lat') or (e.get('center') or {}).get('lat') or (b and (b['minlat'] + b['maxlat']) / 2)
    lon = e.get('lon') or (e.get('center') or {}).get('lon') or (b and (b['minlon'] + b['maxlon']) / 2)
    if not name or not lat: continue
    key = next((k for k in KEYS if k in t), None)
    if key is None: continue   # a neighbourhood: an area (below), not a place to go to
    kind = t.get(key, '')
    # An office known only as one ('office=yes') is no use to search for, but one mapped indoors, on its floor, was put
    # there for someone looking for it: the Admissions and Financial Aid offices in the Taggart Student Center.
    if kind in SKIP.get(key, ()) and not (key == 'office' and 'level' in t): continue
    if kind in ('apartments', 'dormitory') and len(name) < 3: continue   # a complex's building by its letter ('B'): the complex is the place
    near = min(stops, key=lambda s: dist(lat, lon, s['lat'], s['lon']))
    if dist(lat, lon, near['lat'], near['lon']) > WALK: continue
    word = WORDS.get(kind, kind.replace('_', ' ').capitalize()) or ('Office' if key == 'office' else '')
    if kind == 'university' and campus: word = campus
    # Where people live, by name: an apartment complex ('Pine View Apartments', mapped as its grounds), a dorm, a
    # subdivision. Someone's way home, or to a friend's.
    if key == 'landuse' and kind == 'residential' and t.get('residential') in ('apartments', 'student_housing'): word = 'Apartments'
    also = ' '.join(dict.fromkeys(w for k in ALSO for w in [(t.get(k) or '').strip()] if w and w.lower() != name.lower()))
    found.append({'name': name, 'lat': round(lat, 5), 'lon': round(lon, 5), 'word': word, 'rank': rank[key], 'town': near['town'], 'stop': near['name'], 'also': also, 'loc': (t.get('loc_name') or '').strip()})

# Once each: the same name within 150 m is one place (a point and its building); the better-described is kept.
found.sort(key=lambda p: (p['rank'], p['name']))
kept = []
for p in found:
    # Not two chapels a block apart called the same but known apart (the Aztec Building and the Middle Earth Building).
    if any(q['name'].lower() == p['name'].lower() and dist(p['lat'], p['lon'], q['lat'], q['lon']) < 150 and not (p['also'] and q['also'] and p['also'] != q['also']) for q in kept): continue
    kept.append(p)
# A building with places inside it (the Taggart Student Center's bookstore, cafes, post office, offices): each of them
# said to be in it, and the building an area a search can name ('tsc subway', 'taggart food'). By its outline's box,
# three places in it at least; the building by its name, its short name, its name without the bracket ('Taggart Student
# Center'), and its own word, the kind words taken off ('Taggart').
KIND_WORDS = {'student', 'center', 'centre', 'building', 'hall', 'union', 'complex', 'the', 'of', 'and'}
halls = []
for e in els:
    t = e.get('tags', {})
    name, b = (t.get('name') or '').strip(), e.get('bounds')
    if not name or 'building' not in t or not b: continue
    box = [b['minlon'], b['minlat'], b['maxlon'], b['maxlat']]
    inside = [p for p in kept if p['name'] != name and box[0] <= p['lon'] <= box[2] and box[1] <= p['lat'] <= box[3]]
    if len(inside) < 3: continue
    plain = re.sub(r'\s*\(.*?\)\s*', ' ', name).strip()
    core = ' '.join(w for w in plain.split() if w.lower() not in KIND_WORDS)
    names = [name, plain] + [(t.get(k) or '').strip() for k in ('short_name', 'loc_name', 'alt_name') if t.get(k)] + ([core] if len(core) >= 4 and core != plain else [])
    halls.append({'name': plain, 'names': list(dict.fromkeys(n for n in names if n)), 'box': [round(x, 5) for x in box]})
    for p in inside: p['in'] = plain
# A name that repeats in a town says which one: the stop it's by.
count = {}
for p in kept: count[(p['name'].lower(), p['town'])] = count.get((p['name'].lower(), p['town']), 0) + 1
# (or what the town calls it, where it's known apart that way: 'Logan · Aztec Building', not 'by 1200 North 800 East' twice)
# (Inside a building, that's where: 'Logan · in Taggart Student Center', not the stop down the road.)
out = [[p['name'], p['lat'], p['lon'], p['word'], p['town'] + (' · in ' + p['in'] if p.get('in') else (' · ' + p['loc'] if p['loc'] else ' · by ' + p['stop']) if count[(p['name'].lower(), p['town'])] > 1 else '')] + ([p['also']] if p['also'] else []) for p in sorted(kept, key=lambda p: p['name'].lower())]
# Areas a search can name ('USU institute', 'Island pizza', 'BTech library'): a campus, a college, a hospital's grounds,
# a mall, a neighbourhood, by its outline's box (a neighbourhood mapped as a point, a few blocks round it). Each by every
# name it goes by; the university by its initials too, and 'campus'. The search finds the rest of the words inside.
AREA = {('amenity', 'university'), ('amenity', 'college'), ('amenity', 'hospital'), ('shop', 'mall'), ('landuse', 'retail'),
        ('place', 'neighbourhood'), ('place', 'suburb'), ('place', 'quarter')}
areas = []
for e in els:
    t = e.get('tags', {})
    name = (t.get('name') or '').strip()
    if not name or not any(t.get(k) == v for k, v in AREA): continue
    b = e.get('bounds')
    if b: box = [b['minlon'], b['minlat'], b['maxlon'], b['maxlat']]
    else:
        lat, lon = e.get('lat') or (e.get('center') or {}).get('lat'), e.get('lon') or (e.get('center') or {}).get('lon')
        if lat is None: continue
        box = [lon - 0.0055, lat - 0.0045, lon + 0.0055, lat + 0.0045]   # about 450 m round it
    names = [name] + [(t.get(k) or '').strip() for k in ('short_name', 'loc_name', 'alt_name', 'official_name') if t.get(k)]
    if t.get('amenity') == 'university' and campus:
        names += [campus, 'campus']
        # What the campus's own places are called by (USU's 'Aggie': Aggie Marketplace, Aggie Quick Print, Aggie Blue
        # Bikes): a word leading the names of three of the places in its box at least, and mostly of places there,
        # is another name for it ('aggie bookstore'). From the map, not a list: any university's does the same.
        bx = (b['minlon'], b['minlat'], b['maxlon'], b['maxlat']) if b else None
        if bx:
            inn = lambda p: bx[0] <= p['lon'] <= bx[2] and bx[1] <= p['lat'] <= bx[3]
            tally = {}
            for p in kept:
                if p['word'] == campus: continue   # its own buildings' names (Engineering, Life Sciences) aren't what it's called by
                first = re.match(r"[A-Za-z]{4,}", p['name'])   # leading the name, as a brand does ('Aggie Marketplace'), not 'Space Dynamics Laboratory'
                if first: w = first.group(0).lower(); tally.setdefault(w, [0, 0])[0 if inn(p) else 1] += 1
            for w, (i, o) in tally.items():
                if i >= 3 and i >= 2 * o and w not in KIND_WORDS and w not in name.lower() and w not in {'store', 'shop', 'food', 'cafe', 'office', 'church', 'park', 'house', 'kitchen', 'market'}:
                    names.append(w.capitalize())
    near = min(stops, key=lambda s: dist((box[1] + box[3]) / 2, (box[0] + box[2]) / 2, s['lat'], s['lon']))
    if dist((box[1] + box[3]) / 2, (box[0] + box[2]) / 2, near['lat'], near['lon']) > 3000: continue   # out past the buses
    areas.append({'name': name, 'names': list(dict.fromkeys(names)), 'box': [round(x, 5) for x in box]})
# What the town calls a street ('10th West', 'Sixth South', 'the Dugway', 'Yonk Loop'), from its loc_name or nickname.
# One that's a long stretch of a single grid street (10th West is 1000 West across Logan) is that street: a search for
# it is a search for '1000 West', addresses on it and all ('10th west 400 north'). Any other (a hill, a bend, a loop
# of several streets) is a place, where its stretch of road is.
GRID = re.compile(r'^(?:(?:north|south|east|west)\s+)?(\d+ (?:north|south|east|west))$', re.I)
nick = {}
for e in els:
    t = e.get('tags', {})
    if 'highway' not in t or not e.get('bounds'): continue
    for k in ('loc_name', 'nickname'):
        for alias in (t.get(k) or '').split(';'):
            alias = alias.strip()
            if alias and alias.lower() != (t.get('name') or '').lower(): nick.setdefault(alias, []).append(e)
streets = {}
for alias, ways in sorted(nick.items()):
    box = [min(w['bounds']['minlon'] for w in ways), min(w['bounds']['minlat'] for w in ways), max(w['bounds']['maxlon'] for w in ways), max(w['bounds']['maxlat'] for w in ways)]
    names = [(w['tags'].get('name') or '').strip() for w in ways]
    grid = {GRID.match(n).group(1).title() for n in names if GRID.match(n)}
    clat, clon = (box[1] + box[3]) / 2, (box[0] + box[2]) / 2
    if len(grid) == 1 and all(GRID.match(n) for n in names if n) and dist(box[1], box[0], box[3], box[2]) >= 1200:
        streets[alias] = [grid.pop(), min(stops, key=lambda s: dist(clat, clon, s['lat'], s['lon']))['town']]   # its town's: Logan's 600 South, not Hyrum's
        continue
    at = lambda w: {'lat': (w['bounds']['minlat'] + w['bounds']['maxlat']) / 2, 'lon': (w['bounds']['minlon'] + w['bounds']['maxlon']) / 2}
    mid = min(map(at, ways), key=lambda c: dist(clat, clon, c['lat'], c['lon']))   # a piece of the road, not a loop's middle
    near = min(stops, key=lambda s: dist(mid['lat'], mid['lon'], s['lat'], s['lon']))
    if dist(mid['lat'], mid['lon'], near['lat'], near['lon']) > WALK: continue
    of = max(set(n for n in names if n), key=names.count, default='')
    out.append([alias, round(mid['lat'], 5), round(mid['lon'], 5), of or 'Road', near['town']])
out.sort(key=lambda p: p[0].lower())
print('streets: ' + ', '.join(f'{a} = {s}, {w}' for a, (s, w) in streets.items()), file=sys.stderr)
areas += [h for h in halls if not any(a['name'] == h['name'] for a in areas)]
print('buildings: ' + ', '.join(f"{h['name']} ({', '.join(h['names'])})" for h in halls), file=sys.stderr)
json.dump({'from': 'OpenStreetMap contributors', 'campus': campus, 'places': out, 'areas': areas, 'streets': streets}, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
print(f'{len(areas)} areas: ' + ', '.join(a['name'] for a in areas), file=sys.stderr)
print(f'{len(out)} places, {os.path.getsize(OUT) // 1024} KB, campus {campus or "none"}', file=sys.stderr)
