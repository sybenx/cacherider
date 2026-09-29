#!/usr/bin/env python3
"""Bake a coarse elevation grid for the walks the app works out.

Walks are costed by distance and by climb: from 800 East up the bench to USU is a
climb nobody takes when a bus goes up, though on the flat map it is the same as
600 m along 1000 North. The climb comes from this grid, sampled from USGS 3DEP
(the National Map's bare-earth DEM, 1/3 arc-second where nothing finer is
published) at about 100 m a cell. No key, fetched once: it's terrain, it keeps.

The grid covers where a walk can be: the stops (Connect's and the shuttle's) with
a walk's reach round them, as the timetable places them, so it fits whichever
valley the app is built for. Or any box: --bounds W S E N.

  python3 tools/elevation.py                       # data/cvtd.json + usu.json → data/elevation.json
  python3 tools/elevation.py --cell 150            # coarser, smaller
  python3 tools/elevation.py --bounds -111.98 41.58 -111.68 42.16

Written as { lat0, lon0 (the north-west corner), dlat, dlon (a cell, degrees),
rows, cols, cell (metres), rows of whole metres, each row its first value then
the change from one cell to the next }: small numbers, a small file.
"""
import datetime, json, math, os, struct, sys, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'data', 'elevation.json')
SERVICE = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'
MARGIN = 1500   # metres round the stops: the planner's longest walk to a stop is 1000 m, and a little over


def stops_bounds():
    pts = [(s['lon'], s['lat']) for s in json.load(open(os.path.join(ROOT, 'data', 'cvtd.json')))['stops']]
    u = os.path.join(ROOT, 'data', 'usu.json')
    if os.path.exists(u):
        pts += [(s['lon'], s['lat']) for s in json.load(open(u))['stops'] if s.get('routes')]
    lat = sum(p[1] for p in pts) / len(pts)
    mx, my = MARGIN / (111320 * math.cos(math.radians(lat))), MARGIN / 110540
    return min(p[0] for p in pts) - mx, min(p[1] for p in pts) - my, max(p[0] for p in pts) + mx, max(p[1] for p in pts) + my


def fetch(w, s, e, n, cols, rows):
    """The DEM over the box as rows of floats, north row first: one uncompressed float32 GeoTIFF, its pixels the
    cells' centres (the service resamples its best source to the size asked)."""
    q = f'?bbox={w},{s},{e},{n}&bboxSR=4326&imageSR=4326&size={cols},{rows}&format=tiff&pixelType=F32&compression=None&interpolation=RSP_BilinearInterpolation&f=image'
    b = urllib.request.urlopen(SERVICE + q, timeout=180).read()
    bo = '<' if b[:2] == b'II' else '>'
    ifd = struct.unpack(bo + 'I', b[4:8])[0]
    tags = {}
    for i in range(struct.unpack(bo + 'H', b[ifd:ifd + 2])[0]):
        tag, typ, cnt = struct.unpack(bo + 'HHI', b[ifd + 2 + 12 * i:ifd + 10 + 12 * i])
        raw = b[ifd + 10 + 12 * i:ifd + 14 + 12 * i]
        size = {3: 2, 4: 4}.get(typ, 4)
        if cnt * size <= 4: vals = struct.unpack(bo + ('H' if typ == 3 else 'I') * cnt, raw[:cnt * size])
        else:
            at = struct.unpack(bo + 'I', raw)[0]
            vals = struct.unpack(bo + ('H' if typ == 3 else 'I') * cnt, b[at:at + cnt * size])
        tags[tag] = vals
    W, H = tags[256][0], tags[257][0]
    assert (W, H) == (cols, rows), (W, H)
    assert tags.get(259, (1,))[0] == 1 and tags[258][0] == 32, 'expected uncompressed float32'
    grid = [[None] * W for _ in range(H)]
    if 322 in tags:   # tiled
        tw, th = tags[322][0], tags[323][0]
        across = (W + tw - 1) // tw
        for t, off in enumerate(tags[324]):
            ty, tx = divmod(t, across)
            for r in range(th):
                y = ty * th + r
                if y >= H: break
                row = struct.unpack_from(bo + f'{tw}f', b, off + r * tw * 4)
                for c in range(tw):
                    x = tx * tw + c
                    if x < W: grid[y][x] = row[c]
    else:             # in strips
        per = tags.get(278, (H,))[0]
        for k, off in enumerate(tags[273]):
            for r in range(per):
                y = k * per + r
                if y >= H: break
                grid[y] = list(struct.unpack_from(bo + f'{W}f', b, off + r * W * 4))
    return grid


def main():
    args = sys.argv[1:]
    cell = 100
    if '--cell' in args: cell = float(args[args.index('--cell') + 1])
    w, s, e, n = [float(x) for x in args[args.index('--bounds') + 1:args.index('--bounds') + 5]] if '--bounds' in args else stops_bounds()
    lat = (s + n) / 2
    dlon, dlat = cell / (111320 * math.cos(math.radians(lat))), cell / 110540
    cols, rows = math.ceil((e - w) / dlon), math.ceil((n - s) / dlat)
    e, s = w + cols * dlon, n - rows * dlat   # whole cells
    print(f'{cols} × {rows} cells of {cell:g} m over {w:.4f},{s:.4f} – {e:.4f},{n:.4f}', file=sys.stderr)
    grid = fetch(w, s, e, n, cols, rows)
    # No data (a gap in the source): the nearest cell before it in the row, or the row above.
    out = []
    for y, row in enumerate(grid):
        vals = []
        for x, v in enumerate(row):
            if v is None or v != v or v < -500 or v > 9000: v = vals[-1] if vals else (out[-1][x] if out else 0)
            vals.append(int(round(v)))
        out.append(vals)
    flat = [v for r in out for v in r]
    print(f'{min(flat)} – {max(flat)} m', file=sys.stderr)
    deltas = [[r[0]] + [r[i] - r[i - 1] for i in range(1, len(r))] for r in out]
    doc = {'source': 'USGS 3DEP bare-earth DEM, via the National Map', 'built': datetime.date.today().isoformat(),
           'lat0': round(n, 6), 'lon0': round(w, 6), 'dlat': round(dlat, 8), 'dlon': round(dlon, 8), 'rows': rows, 'cols': cols, 'cell': cell, 'd': deltas}
    with open(OUT, 'w') as f: json.dump(doc, f, separators=(',', ':'))
    print(f'wrote {os.path.relpath(OUT, ROOT)}: {os.path.getsize(OUT) // 1024} KB', file=sys.stderr)


if __name__ == '__main__':
    main()
