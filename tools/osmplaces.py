#!/usr/bin/env python3
"""Every named place in Cache Valley a rider might search for, from OpenStreetMap, for search to find on the device.

  python3 tools/osmplaces.py        # needs data/cvtd.json (the stops); writes data/osm-places.json

One query to OpenStreetMap's Overpass API when the data is rebuilt; nothing is looked up while a rider searches.
Kept: places within walking distance of a stop, of kinds a rider would look for (not car parts or picnic tables).
Each gets its area, the town of its nearest stop, and where a name repeats in a town (a hundred chapels called the
same), the stop it's by. Where the same name sits twice within a block (a shop mapped as a point and a building),
it's kept once. The pamphlet's places (data/places.json) are searched first and win over these.
"""
import json, math, os, sys, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'osm-places.json')
BOX = '41.50,-112.10,42.10,-111.65'   # south, west, north, east: the valley, Idaho's end of it too
WALK = 1200                           # metres from the nearest stop: further, and the bus isn't the way there

QUERY = f"""[out:json][timeout:120];
(
  nwr["name"]["amenity"]({BOX}); nwr["name"]["shop"]({BOX}); nwr["name"]["leisure"]({BOX});
  nwr["name"]["office"]({BOX}); nwr["name"]["tourism"]({BOX}); nwr["name"]["healthcare"]({BOX});
  nwr["name"]["building"~"school|university|college|hospital|civic|public|stadium|government|retail|commercial"]({BOX});
);
out center tags;"""

KEYS = ['amenity', 'shop', 'leisure', 'healthcare', 'tourism', 'office', 'building']
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
}

def dist(a, b, c, d):
    return 6371000 * 2 * math.asin(math.sqrt(math.sin(math.radians(c - a) / 2) ** 2 + math.cos(math.radians(a)) * math.cos(math.radians(c)) * math.sin(math.radians(d - b) / 2) ** 2))

D = json.load(open(os.path.join(ROOT, 'data', 'cvtd.json')))
stops = [s for s in D['stops'] if not s.get('hub')] + [s for s in D['stops'] if s.get('hub')][:1]

req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data': QUERY}).encode(),
                             headers={'User-Agent': 'cacherider-places/1.0 (+https://cacherider.com)'})
els = json.load(urllib.request.urlopen(req, timeout=180))['elements']

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
    lat = e.get('lat') or (e.get('center') or {}).get('lat')
    lon = e.get('lon') or (e.get('center') or {}).get('lon')
    if not name or lat is None: continue
    key = next((k for k in KEYS if k in t), None)
    kind = t.get(key, '')
    if kind in SKIP.get(key, ()): continue
    near = min(stops, key=lambda s: dist(lat, lon, s['lat'], s['lon']))
    if dist(lat, lon, near['lat'], near['lon']) > WALK: continue
    word = WORDS.get(kind, kind.replace('_', ' ').capitalize())
    if kind == 'university' and campus: word = campus
    found.append({'name': name, 'lat': round(lat, 5), 'lon': round(lon, 5), 'word': word, 'rank': rank[key], 'town': near['town'], 'stop': near['name']})

# Once each: the same name within 150 m is one place (a point and its building); the better-described is kept.
found.sort(key=lambda p: (p['rank'], p['name']))
kept = []
for p in found:
    if any(q['name'].lower() == p['name'].lower() and dist(p['lat'], p['lon'], q['lat'], q['lon']) < 150 for q in kept): continue
    kept.append(p)
# A name that repeats in a town says which one: the stop it's by.
count = {}
for p in kept: count[(p['name'].lower(), p['town'])] = count.get((p['name'].lower(), p['town']), 0) + 1
out = [[p['name'], p['lat'], p['lon'], p['word'], p['town'] + (' · by ' + p['stop'] if count[(p['name'].lower(), p['town'])] > 1 else '')] for p in sorted(kept, key=lambda p: p['name'].lower())]
json.dump({'from': 'OpenStreetMap contributors', 'campus': campus, 'places': out}, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
print(f'{len(out)} places, {os.path.getsize(OUT) // 1024} KB, campus {campus or "none"}', file=sys.stderr)
