# Cache Rider

An unofficial schedule app for Connect, the Cache Valley Transit District bus
in Logan, Utah. Next buses at any stop, the Transit Center bay by bay, and a
map. Made by a rider, not by the agency.

Built from a [Claude Design](https://claude.ai/design) spec, and a companion
to the [Headway](https://github.com/sybenx/headway) Pebble watchface.

**[cacherider.com](https://cacherider.com)** · also at
[sybenx.github.io/cacherider](https://sybenx.github.io/cacherider/)

## What it does

- **Stops** — search by street, number or town; the next bus at each stop, then
  the rest of the day. Twin stops across a road know about each other. With
  location on, the nearest stops first.
- **Transit Center** — the next pulse, when routes 1–15 leave together, with a
  countdown; the loops; a plan of the bays, tap one for its buses.
- **Map** — every stop and route line on a Cache Valley street map, with the
  next buses for the stop you tap.
- **After hours, Sundays, weekday-only stops** — it says so, and shows the
  next day that runs.
- **Offline** — add it to your home screen and the timetable stays on the
  phone. The map can be saved too.

Every time shown is the scheduled one. Nothing about you leaves the phone: no
accounts, no analytics, no cookies; location is only used to sort by distance.

## How it's built

Plain HTML, CSS and ES modules. No build step, no server code: the whole
thing is static files, so it hosts anywhere and costs nothing to run however
popular it gets.

```
index.html          the shell
app/                main.js (router), data.js (the schedule), time.js, ui.js, views/
css/app.css         the Industry design system: Barlow Condensed, hairline rows, blueprint frames
data/cvtd.json      the reduced timetable, ~50 KB gzipped, written nightly
data/cvtd-shapes.json  route lines for the map
tiles/              Cache Valley from OpenStreetMap via Protomaps, one file a tile, and tiles.json
vendor/             MapLibre GL, the Protomaps basemap style and its glyphs and sprites
fonts/              Barlow and Barlow Condensed (OFL)
tools/reduce.py     GTFS → data/*.json
tools/tiles.py      Protomaps build → tiles/
tools/hints.json    agency wording: the hub, the loops, headsigns
sw.js               offline: the app and timetable cached; map tiles kept as seen, or all at once
```

### Data

`tools/reduce.py` reads the agency's GTFS zip and writes one JSON file with
the routes (in rider order, with the agency's colours), every calendar
service and its dates, every stop with its town and the stop across the road,
the hub's bays and its pulse, and every departure as minutes past midnight.
The app picks the right service for any date, so a new timetable appears on
the day it starts and the app says so beforehand.

The [transit data workflow](.github/workflows/data.yml) fetches the feed every
night and commits the result when it changed. The
[map tiles workflow](.github/workflows/map.yml) refreshes the street map each
quarter from the latest Protomaps build. The map is one small file a tile
rather than one archive, because not every static host honours byte-range
requests; a rider only ever fetches the tiles on screen.

### Running it locally

```bash
python3 tools/serve.py 8794
```

Then open http://127.0.0.1:8794. The dev server never caches, so an edit
shows on the next reload. To rebuild the data from a fresh feed:

```bash
curl -fsSL -o /tmp/cvtd.zip https://mycvtdbus.org/gtfs
python3 tools/reduce.py /tmp/cvtd.zip
```

### Hosting

The site is static, so it runs on Cloudflare Pages and GitHub Pages alike.
Cloudflare Pages serves cacherider.com from this repository; `_redirects`
sends connecttransit.org and connectransit.org there, and `_headers` sets the
cache lifetimes. GitHub Pages serves the same commit at
sybenx.github.io/cacherider, which keeps working with no changes if the
domains ever lapse: every path in the app is relative.

## Licence

Code under the MIT licence, see `LICENSE`. Barlow and Barlow Condensed are
under the SIL Open Font License, see `fonts/OFL.txt`. Map data ©
OpenStreetMap contributors. MapLibre GL is BSD-licensed, see
`vendor/LICENSE-maplibre.txt`.
