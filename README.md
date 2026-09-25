# Cache Rider

An unofficial schedule app for Connect, the Cache Valley Transit District bus
in Logan, Utah. Next buses at any stop, the Transit Center bay by bay, and a
map. Made by a rider, not by the agency.

Built from a [Claude Design](https://claude.ai/design) spec, and a companion
to the [Headway](https://github.com/sybenx/headway) Pebble watchface.

**[cacherider.com](https://cacherider.com)** · also at
[sybenx.github.io/cacherider](https://sybenx.github.io/cacherider/)

## What it does

- **The watchface, on the phone** — the home screen is one answer set
  large: when the next bus leaves your saved stop, with the Transit Center pulse
  and your other stops beneath. Without a saved stop the nearest one takes the
  hero; without location, the Transit Center does, with a search box and one
  ask for location. Every route is a chip beneath. Search has its own page.
- **Stops** — search by street, number, town or stop number; the next bus at
  each stop, then the rest of the day. Any grid address in the valley, like
  “1400 N 500 E, Logan”, lists the stops nearest it, and pins it on the map. Twin stops across a road know about each other. With
  location on, the nearest stops first.
- **Transit Center** — the next pulse, when routes 1–15 leave together, with a
  countdown; the loops; a plan of the bays, tap one for its buses.
- **Map** — every stop and route line on a Cache Valley street map, with the
  next buses for the stop you tap.
- **After hours, Sundays, weekday-only stops** — it says so, and shows the
  next day that runs.
- **Service alerts** — Connect's detours, closed stops and late starts, from
  its rider-alerts feed, checked hourly. A closed stop says so and drops that
  route's departures; routes, the map and the About page carry the rest.
- **USU campus shuttle** — the Aggie Shuttle's stops, routes and buses,
  live. Shuttles have no timetable, so each stop shows how many stops away
  the next bus is and about how many minutes, estimated from where it is on
  its loop, with how full it is. Buses move on the map; tap one for its load
  and next stops. A campus stop at the same kerb as a Connect stop shares a
  page. Marked LIVE, never SCHEDULED.
- **Saved stops** — a star on any stop page keeps it at the top of the home
  screen, in your order. Saved on the phone, no account.
- **Offline** — add it to your home screen and the timetable stays on the
  phone. The map can be saved too. Chrome offers its install prompt as a
  card once a stop is saved; on an iPhone the app shows the Share → Add to Home Screen steps once,
  on the third day it's opened.
- **Live Connect buses** — CVTD's GTFS-realtime vehicle positions and trip
  updates, by way of `worker/`, a Cloudflare Worker at live.cacherider.com:
  the tracker refuses cross-origin requests, so the Worker fetches the two
  feeds, decodes the protobuf to a few kilobytes of JSON and caches it at the
  edge for ten seconds. `app/rt.js` polls it every 15 s on live screens; a
  departure the feed knows shows its predicted time and a Live tag with the
  late/early word (never early at the Transit Center, where every route lays
  over), a bus that has already been drops out, and Connect buses
  ride the map beside the shuttle. A detoured bus is off its scheduled trips
  and missing from GTFS-realtime, so for a route the feed has no bus on the
  Worker asks the tracker site's own API (`/api/rtpi`) for positions: on the
  map, no stop times. Each departure row carries its trip index
  (`trips` in `data/cvtd.json`) to match the feed. Deploy with
  `wrangler deploy` from `worker/`.
- **Android app** — for phones without Chrome (GrapheneOS and the like), a
  Trusted Web Activity in `android/`: the site full screen in the phone's own
  browser, no code of its own. `.well-known/assetlinks.json` vouches for it.
  Pushing a `v1.2.3` tag builds and signs it (`.github/workflows/android.yml`,
  keystore in the repository secrets) and attaches the APK to a GitHub
  release, which Obtainium can follow.

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
data/usu.json       the campus shuttle's routes, stops and loops, snapshotted nightly
data/alerts.json    Connect's service alerts, decoded hourly
tiles/              Cache Valley from OpenStreetMap via Protomaps, one file a tile, and tiles.json
vendor/             MapLibre GL, the Protomaps basemap style and its glyphs and sprites
fonts/              Barlow and Barlow Condensed (OFL)
tools/reduce.py     GTFS → data/*.json
tools/tiles.py      Protomaps build → tiles/
tools/grid.py       tiles/ → data/grid.json, each town's address grid fitted from its street names
tools/usu.py        Passio GO → data/usu.json (the buses themselves are fetched live by the phone)
tools/crossings.py  tiles/ + route shapes → data/crossings.json, where each route meets a public street
tools/roads.py      the road network from tiles/, and the drive through a list of points (a shuttle route with no drawn line)
tools/alerts.py     GTFS-realtime alerts → data/alerts.json, decoded without protobuf bindings
app/usu.js          live buses: polling, position along the loop, stops-away and minute estimates
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

The campus shuttle comes from the Passio GO feed the USU app uses, unofficial
and undocumented. The phone polls bus positions every 12 seconds only while a
screen that shows them is open, straight from the feed (it allows any origin),
so there is still no server. A stop's estimate is the nearest bus behind it on
the loop: distance at a walking-pace bus speed plus a dwell per stop between.
If the feed stops answering, positions are kept and minutes are dropped after
a minute; if it reports no buses, the stop says so.
A route Passio draws no line for (Water Lab) is traced along the streets
between its stops in order, over a road graph built from the map's own tiles,
and flagged `traced` so the route page can say so.

Service alerts come from Connect's GTFS-realtime alerts feed at
`mycvtdbus.org/gtfs-rt/alerts`. The server refuses requests carrying a browser
Origin header, so phones can't read it; a GitHub Action decodes it hourly into
`data/alerts.json`. An alert naming both a route and a stop means that route
skips the stop while the alert is active, and the app drops those departures.
On the map a closed stop is a hollow ring, and the stretch of route between the
served stops either side of it goes to dots, cut from the drawn shape by walking
it forward from one to the other, then trimmed to the first intersection after
the last served stop and the last one before the next, since a bus at a served
stop always drives on to the corner. `tools/crossings.py` finds the intersections
in the map's own road tiles: a street of residential class or bigger continuing
across the route, or a bigger road meeting it from one side. Dead ends, lot
lanes, driveways and paths don't count. Alerts naming only stops, or nothing, are shown
in the agency's words.

The Map tab has an optional aerial view: the USGS National Map imagery
service, public domain, NAIP over the valley, ending at zoom 16. It is loaded
straight from USGS only while switched on, and the choice is kept on the phone.

The shuttle's usual hours come from USU's page by way of `tools/hints.json`, not
from a feed; a bus reporting outside them gets a small note that it may be parked.

Addresses need no geocoder: the valley numbers its streets from each town's
origin, so `tools/grid.py` fits a grid per town from the named streets in the
tiles (latitude against the north–south number, longitude against the
east–west number) and the app places any address by arithmetic, offline.

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
Cloudflare Pages serves cacherider.com from this repository, with
connecttransit.org, connectransit.org and the www hosts attached to the same
project. A Cloudflare Bulk Redirect (account level, list `cacherider_aliases`)
sends those hosts to cacherider.com with a 301, since Pages' own `_redirects`
file can't match on hostname. `_headers` sets the cache lifetimes; the zone's
Browser Cache TTL is set to respect them. GitHub Pages serves the same commit at
sybenx.github.io/cacherider, which keeps working with no changes if the
domains ever lapse: every path in the app is relative.

## Licence

Code under the MIT licence, see `LICENSE`. Barlow and Barlow Condensed are
under the SIL Open Font License, see `fonts/OFL.txt`. Map data ©
OpenStreetMap contributors. MapLibre GL is BSD-licensed, see
`vendor/LICENSE-maplibre.txt`.
