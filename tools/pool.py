#!/usr/bin/env python3
"""POOL, Connect's on-demand ride: its service area and its pickup points, for the map and search.

  python3 tools/pool.py        # needs data/cvtd.json; writes data/pool.json

POOL isn't in the GTFS. Connect's website embeds the zone from Remix (platform.remix.com, the planning tool whose
Via arm runs the ride), and Remix's public map API lists every stop the agency has drawn there, POOL's pickup
points among them. The zone's outline isn't served by that API: it was read off the embed's own map on
2026-09-28 (the page's Mapbox instance, source 'zones-…') and is kept below. A pickup point is a Remix stop inside
it. To refresh the outline: open https://rideconnectutah.gov/map/pool/'s iframe, and in the console,
  window._mapboxInstance.getStyle().sources[Object.keys(...).find(k => k.startsWith('zones-'))].data.features[0].geometry.coordinates[0]
Hours and the phone number are from https://rideconnectutah.gov/pool/. Nothing here is fetched while a rider uses the app.
"""
import json, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'pool.json')
MAP_API = 'https://platform.remix.com/api/maps/4909032d'   # Connect's published map, from the embed's requests
ZONE = [[-111.8316,41.74086],[-111.83173,41.74086],[-111.83184,41.74059],[-111.83207,41.73901],[-111.83238,41.73722],[-111.83247,41.73523],[-111.83258,41.73213],[-111.83345,41.72557],[-111.82707,41.72512],[-111.82629,41.72511],[-111.82628,41.7206],[-111.82638,41.71942],[-111.82122,41.71917],[-111.82129,41.71647],[-111.82518,41.71536],[-111.82825,41.71416],[-111.82955,41.71238],[-111.82941,41.7114],[-111.82973,41.71039],[-111.83307,41.71046],[-111.83722,41.71047],[-111.8372,41.71],[-111.83417,41.70999],[-111.83245,41.70659],[-111.83525,41.70221],[-111.82494,41.70146],[-111.82557,41.69444],[-111.82576,41.68742],[-111.83222,41.68608],[-111.83182,41.68372],[-111.82769,41.68264],[-111.83062,41.67692],[-111.82752,41.67736],[-111.8098,41.6755],[-111.81002,41.6764],[-111.81288,41.67733],[-111.81323,41.69236],[-111.80853,41.69633],[-111.80504,41.7045],[-111.80087,41.70582],[-111.80912,41.70857],[-111.80933,41.71207],[-111.8093,41.72804],[-111.80789,41.72943],[-111.80669,41.72968],[-111.80613,41.72918],[-111.80599,41.72882],[-111.80471,41.72844],[-111.80343,41.72831],[-111.79931,41.7283],[-111.79938,41.73211],[-111.80613,41.73194],[-111.80637,41.7314],[-111.80651,41.73102],[-111.80689,41.73077],[-111.80761,41.73047],[-111.80855,41.7298],[-111.80935,41.72887],[-111.81102,41.72767],[-111.81614,41.72596],[-111.82109,41.72546],[-111.83319,41.72563],[-111.83233,41.73222],[-111.83222,41.73722],[-111.8316,41.74086]]
INFO = {
    'name': 'POOL', 'brand': 'Connect', 'phone': '435-753-2255', 'url': 'https://rideconnectutah.gov/pool/',
    'hours': 'Monday to Friday 6:15 AM to 8:45 PM, Saturday 9:45 AM to 6:30 PM, no Sunday service',
    'towns': ['Providence', 'Millville', 'River Heights', 'Cliffside', 'south Logan'],
    'android': 'https://play.google.com/store/apps/details?id=com.ridewithvia.connecttransit',
    'ios': 'https://apps.apple.com/us/app/connect-on-demand-by-via/id6754680175',
}

def inside(lon, lat, ring):
    c = False
    for i in range(len(ring)):
        x1, y1 = ring[i]; x2, y2 = ring[i - 1]
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1: c = not c
    return c

D = json.load(open(os.path.join(ROOT, 'data', 'cvtd.json')))
fixed = {s['id']: i for i, s in enumerate(D['stops'])}
req = urllib.request.Request(MAP_API, headers={'User-Agent': 'cacherider-pool/1.0 (+https://cacherider.com)', 'Accept': 'application/json'})
places = json.load(urllib.request.urlopen(req, timeout=60))['stops']
stops = []
for p in places:
    lon, lat = p['geometry']['coordinates']
    if p.get('ghost') or not inside(lon, lat, ZONE): continue
    name = ' '.join(p['name'].replace('(', ' (').split())   # '5 North Main(Providence City Hall)' reads as two words
    stops.append({'id': p['gtfsStopId'], 'name': name, 'lat': round(lat, 5), 'lon': round(lon, 5), 'stop': fixed.get(p['gtfsStopId'])})
stops.sort(key=lambda s: s['name'])
json.dump({'from': 'Connect, via Remix', **INFO, 'zone': ZONE, 'stops': stops}, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
print(f"{len(stops)} POOL pickup points ({sum(1 for s in stops if s['stop'] is not None)} of them bus stops too), {os.path.getsize(OUT) // 1024} KB", file=sys.stderr)
