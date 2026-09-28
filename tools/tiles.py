#!/usr/bin/env python3
"""Cut Cache Valley from a Protomaps build of OpenStreetMap and lay it out as
one small file a tile, tiles/{z}/{x}/{y}.pbf, plus tiles/tiles.json.

Plain files rather than one PMTiles archive because static hosts don't all
honour byte-range requests (Cloudflare Pages sends the whole file), and a
rider should only ever fetch the few tiles on their screen.

  python3 tools/tiles.py                       # yesterday's build
  python3 tools/tiles.py --build 20260923
  python3 tools/tiles.py --from valley.pmtiles # an archive already cut

Needs the pmtiles CLI (brew install pmtiles) for the cut, and the pmtiles
Python package (pip install pmtiles) to read the archive.
"""
import argparse, datetime, gzip, json, os, shutil, subprocess, sys, tempfile

from pmtiles.reader import MmapSource, all_tiles, deserialize_header

ap = argparse.ArgumentParser()
ap.add_argument('--build', help='Protomaps daily build, YYYYMMDD; default yesterday')
ap.add_argument('--bbox', default='-111.98,41.58,-111.68,42.16', help='min_lon,min_lat,max_lon,max_lat')
ap.add_argument('--from', dest='src', help='a PMTiles archive already cut to the area')
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'tiles'))
a = ap.parse_args()

tmp = None
src = a.src
if not src:
    build = a.build or (datetime.date.today() - datetime.timedelta(days=1)).strftime('%Y%m%d')
    tmp = tempfile.NamedTemporaryFile(suffix='.pmtiles', delete=False); tmp.close()
    url = 'https://build.protomaps.com/%s.pmtiles' % build
    print('cutting', a.bbox, 'from', url)
    subprocess.run(['pmtiles', 'extract', url, tmp.name, '--bbox=' + a.bbox], check=True)
    src = tmp.name

out = os.path.normpath(a.out)
if os.path.isdir(out):
    shutil.rmtree(out)
os.makedirs(out)

with open(src, 'rb') as f:
    get = MmapSource(f)
    header = deserialize_header(get(0, 127))
    gz = str(header.get('tile_compression', '')).lower().endswith('gzip')
    names, total = [], 0
    for (z, x, y), data in all_tiles(get):
        if gz:
            try: data = gzip.decompress(data)
            except OSError: pass
        d = os.path.join(out, str(z), str(x))
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, '%d.pbf' % y), 'wb') as t: t.write(data)
        names.append('%d/%d/%d' % (z, x, y)); total += len(data)

zs = sorted({int(n.split('/')[0]) for n in names})
lon0, lat0, lon1, lat1 = (float(v) for v in a.bbox.split(','))
index = {
    'minzoom': zs[0], 'maxzoom': zs[-1], 'bounds': [lon0, lat0, lon1, lat1],
    'count': len(names), 'mb': round(total / 1e6, 1), 'built': datetime.date.today().isoformat(),
    'build': a.build or '', 'attribution': '© OpenStreetMap contributors, via Protomaps',
    'tiles': sorted(names, key=lambda n: [int(p) for p in n.split('/')]),
}
json.dump(index, open(os.path.join(out, 'tiles.json'), 'w'), separators=(',', ':'))
if tmp: os.unlink(tmp.name)
print('wrote', len(names), 'tiles, %.1f MB, zoom %d-%d, to %s' % (total / 1e6, zs[0], zs[-1], out))
