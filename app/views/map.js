// The map: self-hosted vector tiles, every stop in its routes' colour, the
// route lines, and a card for the stop you tap. Loaded only when first shown.
import * as maplibregl from '../../vendor/maplibre-gl.mjs';
import { layers, namedFlavor } from '../../vendor/basemaps.mjs';
import { D, BASE, stop, route, nextAt, search, searchPlaces, streetish, alertsUntil, POOL, poolAt, servicesOn, nextServiceDay, nextPulse, distance, nearest, stopAlerts, closedRoutes, activeAlerts, alertRoutes, timesOn, tripStops, onRequest, A } from '../data.js';
import { now, relative, fmtDay, dayName, clock, clockText, metres } from '../time.js';
import { html, icon, badge, badges, time, sched, corners, depRow, stopRow, stopTitle, side, isLoop, routeLinks, when, loopArrival, liveMark, headsign, acrossPill } from '../ui.js';
import { nearMe } from '../main.js';
import { parseAddress, geocode, townState, nearestTo } from '../geo.js';
import { U, live, busNext, board, liveRow, chip, chips, meter, liveTag, heading, loadWords, hasData, isStale, lastSeen, offNote, hours, untilWords } from '../usu.js';
import { rt, findBus, busStops, lateWords, heldAt, rtStale, rtSeen } from '../rt.js';

// Aerial imagery, for the option: USGS's public-domain mosaic (NAIP over the valley), ends at zoom 16.
const SAT = { tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'], maxzoom: 16, attribution: 'Imagery <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS</a>' };
let sat = false;   // aerial imagery: a tap each visit, never remembered
const satOn = () => sat;
const coarse = () => matchMedia('(pointer: coarse)').matches;
const wide = () => matchMedia('(min-width: 900px)').matches;
/** So wide a stop's page takes the whole screen, map and all: a tap on the map shows its card instead. */
/** A stop link opened on the Map tab of a wide screen becomes its page, without a history entry to loop back into. */
const asPage = hash => location.replace(location.href.split('#')[0] + hash);

let focusRoute;   // the route whose page is open, its stops in its colour
let fitSize = '', map = null, ready = false, selected = null, uHilite = '', meMarker = null, pinMarker = null, flavorName = null, lastFocused = null;
let mm = null, mmEl = null, mmReady = false, mmKey = null, mmSel = null;   // the small map on a stop page
const busMarkers = new Map();   // bus id → { marker, el }
let selectedBus = null, selectedU = null;
let hiLines = [], hiLoops = [];   // Connect route indices and shuttle route ids whose lines are drawn on top
// The street map is one small file a tile, cut from OpenStreetMap by tools/tiles.py; tiles/tiles.json says how far it reaches.
let TILES = { minzoom: 10, maxzoom: 15, bounds: [-111.98, 41.58, -111.68, 42.16] };
const col = document.getElementById('mapcol');
/** A route's colour for the dark map: the darker ones (the greens of 9 and 11, the purples, 16's navy) mixed toward
 *  white just until they stand off the dark basemap; bright ones as they are. Badges keep the true colours. */
function lift(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const lum = v => { const [r, g, b] = v.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  let t = 0, v = c;
  while (lum(v) < 0.2 && t < 1) { t += 0.05; v = c.map(x => Math.round(x + (255 - x) * t)); }
  return '#' + v.map(x => x.toString(16).padStart(2, '0')).join('');
}
const dark = () => matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';

function style(sat = true) {
  const flavor = dark() ? 'dark' : 'light';
  flavorName = flavor;
  const col = flavor === 'dark' ? 'dcolor' : 'color';   // Connect's lines and stops: lifted on the dark map
  const f = namedFlavor(flavor);
  const base = layers('protomaps', f, { lang: 'en' });
  return {
    version: 8,
    glyphs: BASE + 'vendor/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: BASE + 'vendor/basemaps-assets/sprites/' + flavor,
    sources: {
      protomaps: { type: 'vector', tiles: [BASE + 'tiles/{z}/{x}/{y}.pbf'], minzoom: TILES.minzoom, maxzoom: TILES.maxzoom, bounds: TILES.bounds, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' },
      stops: { type: 'geojson', data: stopsGeo() },
      lines: { type: 'geojson', data: drawn.lines || { type: 'FeatureCollection', features: [] } },
      lclosed: { type: 'geojson', data: drawn.closed || { type: 'FeatureCollection', features: [] } },   // the stretches of route we can't vouch for
      spot: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      ustops: { type: 'geojson', data: usuStopsGeo() },
      pool: { type: 'geojson', data: poolGeo() },
      ulines: { type: 'geojson', data: usuLinesGeo() },
    },
    layers: [
      ...base,
      { id: 'spot-fill', type: 'fill', source: 'spot', paint: { 'fill-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'fill-opacity': 0.18 } },
      { id: 'spot-edge', type: 'line', source: 'spot', paint: { 'line-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.8 } },
      // POOL's zone, a faint wash under everything else; its pickup points are rings under the stops, so a bus stop
      // that is one keeps its dot inside the ring.
      { id: 'pool-zone', type: 'fill', source: 'pool', filter: ['==', ['get', 'kind'], 'zone'], paint: { 'fill-color': '#007AB8', 'fill-opacity': flavor === 'dark' ? 0.1 : 0.08 } },
      { id: 'pool-edge', type: 'line', source: 'pool', filter: ['==', ['get', 'kind'], 'zone'], paint: { 'line-color': '#007AB8', 'line-width': 1.2, 'line-dasharray': [3, 2], 'line-opacity': 0.55 } },
      { id: 'pool-stops', type: 'circle', source: 'pool', filter: ['==', ['get', 'kind'], 'stop'], minzoom: 12, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3.5, 15, 7, 17, 10], 'circle-color': '#007AB8', 'circle-opacity': 0.15, 'circle-stroke-color': '#007AB8', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 15, 2, 17, 2.5] } },
      { id: 'route-lines', type: 'line', source: 'lines', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', col], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, 3.5, 17, 6], 'line-opacity': 0.75 } },
      { id: 'route-on', type: 'line', source: 'lines', filter: ['in', ['get', 'route'], ['literal', []]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', col], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 6, 17, 10], 'line-opacity': 1 } },
      // A detour: between the served stops either side of a closed run, the line goes to dots over a paper casing.
      // Each dot wears a thin halo in the map's colour, so it reads even on its own route's other pass, while the
      // gaps still show whatever runs underneath. The halo is 1.7× the dot with the dash scaled to match, so they align.
      { id: 'route-closed-halo', type: 'line', source: 'lclosed', layout: { 'line-cap': 'round' }, paint: { 'line-color': flavor === 'dark' ? '#101214' : '#f2f2f3', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.55, 14, 5.95, 17, 10.2], 'line-dasharray': [0, 2.2 / 1.7] } },
      { id: 'route-closed', type: 'line', source: 'lclosed', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', col], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, 3.5, 17, 6], 'line-dasharray': [0, 2.2], 'line-opacity': 0.9 } },
      // a stand-in line (stop to stop, no shape) is a faint thin sketch until its route is lit
      { id: 'usu-lines', type: 'line', source: 'ulines', minzoom: 12, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, ['case', ['get', 'approx'], 0.8, 1.2], 15, ['case', ['get', 'approx'], 1.4, 2.5], 17, ['case', ['get', 'approx'], 2, 4]], 'line-opacity': ['case', ['get', 'approx'], 0.35, 0.9], 'line-dasharray': [3, 1.5] } },
      { id: 'usu-line-on', type: 'line', source: 'ulines', filter: ['in', ['get', 'id'], ['literal', []]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 15, 5.5, 17, 9], 'line-opacity': 1 } },
      { id: 'usu-selected', type: 'circle', source: 'ustops', filter: ['==', ['get', 'id'], ''], paint: { 'circle-radius': 12, 'circle-opacity': 0, 'circle-stroke-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'circle-stroke-width': 3 } },
      { id: 'usu-stops', type: 'symbol', source: 'ustops', minzoom: 12.5, layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 12.5, 0.45, 15, 0.7, 17, 1], 'icon-allow-overlap': true }, paint: {} },
      { id: 'usu-labels', type: 'symbol', source: 'ustops', minzoom: 15.5, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': flavor === 'dark' ? '#eef0f2' : '#1d1f20', 'text-halo-color': flavor === 'dark' ? '#101214' : '#f2f2f3', 'text-halo-width': 1.2 } },
      { id: 'stops', type: 'circle', source: 'stops', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5.5, 17, 8, 19, 11],
        // a closed stop is a hollow ring in its route's colour
        'circle-color': ['case', ['get', 'closed'], flavor === 'dark' ? '#101214' : '#f2f2f3', ['get', col]],
        'circle-stroke-color': ['case', ['get', 'closed'], ['get', col], flavor === 'dark' ? '#101214' : '#ffffff'],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, ['case', ['get', 'closed'], 2.5, 1.5], 17, ['case', ['get', 'closed'], 3.5, 1.5]],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 13, 1] } },
      { id: 'stop-selected', type: 'circle', source: 'stops', filter: ['==', ['get', 'id'], ''], paint: { 'circle-radius': 11, 'circle-color': ['get', col], 'circle-stroke-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'circle-stroke-width': 3 } },
      { id: 'stop-labels', type: 'symbol', source: 'stops', minzoom: 15, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': flavor === 'dark' ? '#eef0f2' : '#1d1f20', 'text-halo-color': flavor === 'dark' ? '#101214' : '#f2f2f3', 'text-halo-width': 1.2 } },
    ],
  };
}

function stopsGeo() {
  const ymd = now().ymd;
  return { type: 'FeatureCollection', features: D.stops.map((s, i) => ({ type: 'Feature', id: +s.id, properties: { id: s.id, name: s.name, routes: s.routes, color: '#' + route(s.routes[0]).color, dcolor: lift('#' + route(s.routes[0]).color), closed: !!(A.byStop[s.id] && stopAlerts(i, ymd).length) }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })) };
}

/** The stretches of route between the served stops either side of each closed run, cut from the drawn shapes:
 *  the dotted lines to draw, and per shape the along-shape gaps where its solid line is left out, so a route
 *  sharing the road underneath still shows through the dots. */
function closedSegments(fc) {
  const ymd = now().ymd;
  const byRoute = {};   // route index → set of closed stop ids
  for (const a of activeAlerts(ymd)) for (const ri of a.ri || []) for (const id of a.stops || []) (byRoute[ri] ||= new Set()).add(id);
  const out = [], gaps = {};
  for (const [ri, ids] of Object.entries(byRoute)) {
    const r = D.routes[+ri];
    const shapes = fc.features.filter(f => f.properties.route === +ri);
    if (!shapes.length) continue;
    const done = new Set();
    for (const seq of Object.values(r.stops || {})) {
      for (let i = 0; i < seq.length; i++) {
        if (!ids.has(D.stops[seq[i]].id)) continue;
        let j = i; while (j + 1 < seq.length && ids.has(D.stops[seq[j + 1]].id)) j++;
        const from = D.stops[seq[Math.max(0, i - 1)]], to = D.stops[seq[Math.min(seq.length - 1, j + 1)]];
        const key = from.id + '>' + to.id;
        i = j;
        if (done.has(key)) continue;
        done.add(key);
        for (const cut of cutShape(shapes, from, to, seq.slice(i, j + 1).map(si => D.stops[si]))) {
          out.push({ type: 'Feature', properties: { color: '#' + r.color, dcolor: lift('#' + r.color), route: +ri }, geometry: { type: 'LineString', coordinates: cut.coords } });
          (gaps[cut.shape] ||= []).push([cut.s0, cut.s1]);
        }
      }
    }
  }
  return { closed: { type: 'FeatureCollection', features: out }, gaps };
}
/** The solid lines with each shape's closed stretches left out. */
function openLines(fc, gaps) {
  const features = [];
  for (const f of fc.features) {
    const g = gaps[f.properties.shape];
    if (!g) { features.push(f); continue; }
    const c = f.geometry.coordinates, n = c.length;
    if (!f._cum) { f._cum = [0]; for (let k = 1; k < n; k++) f._cum.push(f._cum[k - 1] + distance(c[k - 1][1], c[k - 1][0], c[k][1], c[k][0])); }
    const L = f._cum[n - 1], walk = c.map((p, k) => [f._cum[k], p]);
    // a gap past the closing segment of a loop wraps: two spans on the drawn line
    const spans = g.flatMap(([s0, s1]) => s1 >= s0 ? [[s0, s1]] : [[s0, L], [0, s1]]).sort((p, q) => p[0] - q[0]);
    let at = 0;
    for (const [s0, s1] of spans) {
      if (s0 - at > 1) features.push({ type: 'Feature', properties: f.properties, geometry: { type: 'LineString', coordinates: slice(walk, at, s0) } });
      at = Math.max(at, s1);
    }
    if (L - at > 1) features.push({ type: 'Feature', properties: f.properties, geometry: { type: 'LineString', coordinates: slice(walk, at, L) } });
  }
  return { type: 'FeatureCollection', features };
}
/** Walk each of the route's shapes forward from `from` to `to`; the shortest such walk on a shape is the stretch
 *  its bus would have driven, and every shape that has one is cut, so a variant of the route on the same road
 *  doesn't show through as if it still ran. Each is trimmed: a bus at a served stop always drives on to the next
 *  corner, so the dots start at the first intersection after `from` and end at the last one before `to`, never
 *  tighter than the closed stops themselves. */
function cutShape(shapes, from, to, closed) {
  const NEAR = 60;   // metres: a stop is on the line if a vertex is this close
  const cuts = [];
  for (const f of shapes) {
    let best = null;
    const c = f.geometry.coordinates, n = c.length;
    if (!f._cum) { f._cum = [0]; for (let k = 1; k < n; k++) f._cum.push(f._cum[k - 1] + distance(c[k - 1][1], c[k - 1][0], c[k][1], c[k][0])); }
    const total = f._cum[n - 1] + distance(c[n - 1][1], c[n - 1][0], c[0][1], c[0][0]);
    const near = s => c.map((p, k) => [distance(p[1], p[0], s.lat, s.lon), k]).filter(x => x[0] <= NEAR).map(x => x[1]);
    for (const a of near(from)) {
      // forward from a, wrapping once round a loop, to the first vertex near `to`
      let len = 0, k = a, steps = 0, hit = -1;
      while (steps < n) {
        const nk = (k + 1) % n;
        len += distance(c[k][1], c[k][0], c[nk][1], c[nk][0]);
        k = nk; steps++;
        if (distance(c[k][1], c[k][0], to.lat, to.lon) <= NEAR) { hit = k; break; }
      }
      if (hit < 0 || (best && len >= best.len)) continue;
      best = { len, a, steps, total };
    }
    if (best && best.len < 6000) cuts.push(trimWalk(f, best, from, to, closed));   // a walk longer than that is the wrong pass, not a detour
  }
  return cuts;
}
function trimWalk(f, best, from, to, closed) {
  const { a, steps, total } = best, c = f.geometry.coordinates, n = c.length;
  const walk = [];   // [distance along the walk, [lon, lat]]
  for (let m = a, t = 0, d = 0; t <= steps; t++, m = (m + 1) % n) {
    if (t) d += distance(c[(m + n - 1) % n][1], c[(m + n - 1) % n][0], c[m][1], c[m][0]);
    walk.push([d, c[m]]);
  }
  const along = s => { let bi = 0; for (let i = 1; i < walk.length; i++) if (distance(walk[i][1][1], walk[i][1][0], s.lat, s.lon) < distance(walk[bi][1][1], walk[bi][1][0], s.lat, s.lon)) bi = i; return walk[bi][0]; };
  const firstClosed = Math.min(...closed.map(along)), lastClosed = Math.max(...closed.map(along));
  // The walk may begin a little before the served stop and end a little after the next; the cut is measured from the stops.
  const fromAt = along(from), toAt = along(to);
  const xs = (XINGS[f.properties.shape] || []).map(x => (x - f._cum[a] + total) % total).filter(w => w > fromAt + 10 && w < toAt - 10).sort((p, q) => p - q);
  let start = xs.find(w => w < firstClosed - 5); start = start === undefined ? fromAt : start;
  let end = [...xs].reverse().find(w => w > lastClosed + 5); end = end === undefined ? toAt : end;
  return { coords: slice(walk, start, end), shape: f.properties.shape, s0: (f._cum[a] + start) % total, s1: (f._cum[a] + end) % total };
}
/** The part of a walk between two distances along it, ends interpolated. */
function slice(walk, d0, d1) {
  const at = d => { for (let i = 1; i < walk.length; i++) if (walk[i][0] >= d) { const [a, pa] = walk[i - 1], [b, pb] = walk[i], t = b === a ? 0 : (d - a) / (b - a); return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t]; } return walk[walk.length - 1][1]; };
  return [at(d0), ...walk.filter(([d]) => d > d0 && d < d1).map(w => w[1]), at(d1)];
}

/** POOL's zone and pickup points as one collection; empty without the file. */
function poolGeo() {
  if (!POOL) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { kind: 'zone' }, geometry: { type: 'Polygon', coordinates: [POOL.zone] } },
    ...POOL.stops.map(s => ({ type: 'Feature', properties: { kind: 'stop', id: s.id, name: s.name, stop: s.stop === null || s.stop === undefined ? -1 : s.stop }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })),
  ] };
}
function usuStopsGeo() {
  if (!U) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: U.stops.filter((s, i) => s.routes.length && !U.shared[i]).map(s => ({ type: 'Feature', properties: { id: s.id, name: s.name, icon: 'usq-' + U.routes[s.routes[0]].color.slice(1) }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })) };
}
function usuLinesGeo() {
  if (!U) return { type: 'FeatureCollection', features: [] };
  // Passio's "outdated" flag doesn't stop a route running, so every route with a shape is drawn; one without gets a
  // stop-to-stop line as a stand-in.
  return { type: 'FeatureCollection', features: U.routes.filter(r => r.shape.length || r.stops.length >= 3).map(r => {
    const coords = r.shape.length ? r.shape : [...r.stops, r.stops[0]].map(si => [U.stops[si].lon, U.stops[si].lat]);
    return { type: 'Feature', properties: { id: r.id, color: r.color, approx: !r.shape.length }, geometry: { type: 'LineString', coordinates: coords } };
  }) };
}
/** A small square, white-edged, in a route's colour, for the shuttle stops. */
function squareImage(hex) {
  const n = 20, d = new Uint8ClampedArray(n * n * 4);
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4, edge = x < 3 || y < 3 || x >= n - 3 || y >= n - 3;
    d[i] = edge ? 255 : r; d[i + 1] = edge ? 255 : g; d[i + 2] = edge ? 255 : b; d[i + 3] = 255;
  }
  return { width: n, height: n, data: d };
}
function addUsuImages() {
  if (!U) return;
  for (const r of U.routes) { const name = 'usq-' + r.color.slice(1); if (!map.hasImage(name)) map.addImage(name, squareImage(r.color)); }
}

let shapesFC = null, XINGS = {};   // the route lines, fetched once for both maps; intersections along each, by shape id
function shapes() {
  if (!shapesFC) shapesFC = Promise.all([
    fetch(BASE + 'data/cvtd-shapes.json').then(r => r.json()),
    fetch(BASE + 'data/crossings.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
  ]).then(([j, x]) => { XINGS = x || {}; return { type: 'FeatureCollection', features: j.lines.map(l => ({ type: 'Feature', properties: { color: '#' + route(l.route).color, dcolor: lift('#' + route(l.route).color), route: l.route, shape: l.shape }, geometry: { type: 'LineString', coordinates: l.coords } })) }; })
    .catch(e => { console.warn('shapes', e); shapesFC = null; return null; });
  return shapesFC;
}
/** The route lines as last drawn: a restyle (light to dark, say) starts from them, so the routes never blink out
 *  while they're worked out again. */
const drawn = { lines: null, closed: null };
async function loadShapes(m = map) {
  const fc = await shapes();
  if (!fc || !m) return;
  const { closed, gaps } = closedSegments(fc);
  drawn.lines = openLines(fc, gaps); drawn.closed = closed;
  if (m.getSource('lines')) m.getSource('lines').setData(drawn.lines);
  if (m.getSource('lclosed')) m.getSource('lclosed').setData(drawn.closed);
}
/** Alerts came or the day turned: redraw the hollow stops and the dotted stretches on both maps. */
let closedKey = null;
function refreshClosed(clockNow) {
  const key = A.loadedAt + ':' + clockNow.ymd;
  if (closedKey === key) return;
  closedKey = key;
  for (const m of [map, mm]) if (m && m.getSource('stops')) { m.getSource('stops').setData(stopsGeo()); loadShapes(m); }
}
let tilesLoaded = null;
function loadTiles() {
  if (!tilesLoaded) tilesLoaded = fetch(BASE + 'tiles/tiles.json').then(r => r.json()).then(t => { TILES = { ...TILES, ...t }; }).catch(() => { /* the defaults cover the valley */ });
  return tilesLoaded;
}
function squaresOnDemand(m) {
  m.on('styleimagemissing', e => { if (e.id.startsWith('usq-') && !m.hasImage(e.id)) m.addImage(e.id, squareImage('#' + e.id.slice(4))); });
}

async function init(app) {
  if (map) return;
  await loadTiles();
  col.innerHTML = '<div id="map"></div>' + chrome();
  const center = app.geo ? [app.geo.lon, app.geo.lat] : HOME;
  map = new maplibregl.Map({ container: 'map', style: style(), center, zoom: app.geo ? 15 : 13, minZoom: 8, maxZoom: 19, pitchWithRotate: false, touchPitch: false, attributionControl: false, transformConstrain: (c, z) => keepIn(c, z) });
  placeControls();
  WIDE.addEventListener('change', placeControls);
  squaresOnDemand(map);
  map.on('load', () => { ready = true; addUsuImages(); loadShapes(); applySelection(); if (app.geo) placeMe(app.geo); map.resize(); liveUpdate(app); busScale(); if (focusRoute !== undefined) routeTimes(focusRoute, now()); });
  map.on('zoom', busScale);
  map.on('mouseenter', 'usu-stops', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'usu-stops', () => map.getCanvas().style.cursor = '');
  map.on('mouseenter', 'pool-stops', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'pool-stops', () => map.getCanvas().style.cursor = '');
  setTimeout(() => map.resize(), 300);
  // A tap picks the nearest stop within a thumb's reach, so two stops that nearly touch are still separable.
  // On a touch screen the pick waits a beat: a second finger-down inside it is a double-tap or a
  // tap-and-drag zoom, not a stop, so the wait is dropped rather than a card opened.
  let tapTimer = 0;
  const cancelTap = () => clearTimeout(tapTimer);
  map.on('touchstart', cancelTap); map.on('movestart', cancelTap); map.on('zoomstart', cancelTap);
  map.on('click', e => {
    // A tap on the map with search results open puts them away, the keyboard too, and picks nothing.
    // The words stay in the box: a tap back into it brings the results back.
    const res = col.querySelector('#mapresults');
    if (!res.classList.contains('hidden')) { res.classList.add('hidden'); document.activeElement?.blur(); return; }
    if (!coarse()) return pick(e);
    clearTimeout(tapTimer); tapTimer = setTimeout(() => pick(e), 300);
  });
  const pick = e => {
    const r = coarse() ? 22 : 8;
    const hits = map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ['stops', 'usu-stops', 'pool-stops'] });
    if (hits.length) {
      // A bus stop before a POOL ring at the same pole: the stop's card says it's a pickup too.
      const rank = f => f.layer.id === 'pool-stops' ? 1 : 0;
      const best = hits.map(f => { const p = map.project(f.geometry.coordinates); return { f, d: Math.hypot(p.x - e.point.x, p.y - e.point.y) + rank(f) * 6 }; }).sort((a, b) => a.d - b.d)[0].f;
      // The stop already picked, tapped again: closer in.
      if (best.layer.id === 'stops') select(best.properties.id, app, true, best.properties.id === selected ? 'closer' : false);
      else if (best.layer.id === 'pool-stops') { if (best.properties.stop >= 0) select(stop(best.properties.stop).id, app, true); else selectPool(best.properties.id, app); }
      else selectU(best.properties.id, app, best.properties.id === uHilite || U.stopById[best.properties.id] === selectedU);
      return;
    }
    // No stop there, but a route's line: that route lit up with its times, where the map is. Where several share the
    // road, the card asks which.
    const ris = [...new Set(map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ['route-lines'] }).map(f => f.properties.route))].sort((a, b) => a - b);
    const cardOpen = col.querySelector('#mapcard').classList.contains('open');
    selectedBus = null; selectedU = null; select(null, app);
    if (ris.length === 1) pickRoute(ris[0], app, cardOpen);
    else if (ris.length > 1) routeChooser(ris, app);
    // Nothing there at all: a route picked on the Map tab is put away, as a tap off a stop puts the stop away.
    else if (app.route.name === 'map' && focusRoute !== undefined && /^#\/map\/route\//.test(location.hash)) location.hash = '#/map';
  };
  map.on('mouseenter', 'stops', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'stops', () => map.getCanvas().style.cursor = '');
  // The look changed (the toggle, or the phone's while following it): the basemap follows without a reload.
  let bigFlavor = flavorName;   // its own, as the stop page's small map keeps its
  window.addEventListener('themechange', () => { const f = dark() ? 'dark' : 'light'; if (f !== bigFlavor) { bigFlavor = f; ready = false; map.setStyle(style()); map.once('style.load', () => { ready = true; loadShapes(); applySelection(); showSat(sat); if (MT.R) { MT.key = null; drawRun(MT); } }); } });
  wireChrome(app);
  wireGrip(app);
}

/** A route picked on the map itself: shown where the map is, not fitted as a route opened from its page is. Beside
 *  the panel, its page in the panel; on the Map tab (and a phone's), lit up with its times and a card saying which it
 *  is. Its address all the same, so Back puts it away. Picked again, the map goes out to the whole of it. */
let stayRoute = false;
function pickRoute(ri, app, cardOpen = false) {
  const short = encodeURIComponent(D.routes[ri].short);
  const panel = wide() && app.route.name !== 'map';
  const h = (panel ? '#/route/' : '#/map/route/') + short;
  if (location.hash === h || panel && location.hash.startsWith(h + '/')) {
    // The whole route: a phone's card would cover the bottom of it, so it goes; a tap on the line then brings it back.
    const card = col.querySelector('#mapcard');
    if (!panel && !wide()) { if (!cardOpen) return routeCard(ri, app); card.classList.remove('open'); }
    else if (!panel) routeCard(ri, app);
    settlePad(); map.fitBounds(routeBounds(ri), { padding: fitPad(40), duration: 700, maxZoom: 15.5 });
    return;
  }
  stayRoute = true; location.hash = h;
}
function routeCard(ri, app) {
  const r = D.routes[ri], card = col.querySelector('#mapcard');
  // Its buses on the road, a row each: which way it's heading and the feed's word on it. A tap picks the bus out,
  // and the times on the map become that bus's.
  const buses = rtStale() ? [] : rt.buses.filter(b => b.ri === ri);
  const rows = buses.map(b => { const u = rt.trips[b.trip], late = u && u.lastDelay !== null && !isLoop(ri) ? lateWords(u.lastDelay) : ''; return html`<button type="button" class="pickroute busline" data-bus="${b.id}"><i class="dot" style="background:#${r.color}"></i><span class="pr-n"><b>Bus ${b.label}</b><small>heading ${compassWord(b.course)}${late ? ' · ' + late : ''}</small></span><span class="livetag"><i></i>Live</span></button>`; });
  card.innerHTML = html`<div class="grip"></div><div class="head"><span class="eyebrow">Route</span><div class="name"><span>${r.long}</span>${badge(ri, 30)}</div>${r.desc ? html`<div class="muted">${r.desc.replace(/,\s*/g, ' · ')}</div>` : ''}</div>
    ${rows.length ? html`<div class="pickroutes">${rows}</div>` : ''}
    <div class="open"><a class="btn btn-primary btn-lg btn-block blueprint" href="#/route/${encodeURIComponent(r.short)}">${corners()}Open route</a></div>`;
  card.querySelectorAll('[data-bus]').forEach(b => { b.onclick = () => pickBus(b.dataset.bus, app); });
  card.classList.remove('hidden');
  requestAnimationFrame(() => card.classList.add('open'));
}
const compassWord = deg => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(((deg || 0) % 360) / 45) % 8];
function routeChooser(ris, app) {
  const card = col.querySelector('#mapcard');
  card.innerHTML = html`<div class="grip"></div><div class="head"><span class="eyebrow">Routes on this road</span></div>
    <div class="pickroutes">${ris.map(ri => html`<button type="button" class="pickroute" data-ri="${ri}">${badge(ri, 30)}<span class="pr-n"><b>${D.routes[ri].long}</b>${D.routes[ri].desc ? html`<small>${D.routes[ri].desc.replace(/,\s*/g, ' · ')}</small>` : ''}</span></button>`)}</div>`;
  card.querySelectorAll('[data-ri]').forEach(b => { b.onclick = () => pickRoute(+b.dataset.ri, app, true); });
  card.classList.remove('hidden');
  requestAnimationFrame(() => card.classList.add('open'));
}

/** Swiping the card down closes it, and swiping it up opens the stop's page, from anywhere on the card: the
 *  gesture is claimed on the first move only when the card can't scroll that way any further (at its top for
 *  down, at its end for up) and the finger is heading that way, so scrolling and taps work as before. The grip
 *  also drags with a mouse. The browser's pull-to-refresh never sees any of it. */
/** The peek's height: the grip and the head, whatever the stop's name and routes take. */
function fitPeek(card) {
  const g = card.querySelector('.grip'), h = card.querySelector('.head');
  if (g && h) card.style.setProperty('--peek', (g.offsetHeight + h.offsetHeight + 2) + 'px');
}
function wireGrip(app) {
  const card = col.querySelector('#mapcard');
  const close = () => { selectedBus = null; selectedU = null; select(null, app); };
  const pageHref = () => { const a = card.querySelector(':scope > .open a'); return a ? a.getAttribute('href') : null; };   // the card's own Open button: the card itself is .open too
  // Swiped down, the card shrinks to its head (the stop's name and routes) and the map shows through; swiped down
  // again it goes. Up, or a tap on the head, opens it out. The size chosen stays for the next stop tapped.
  const peeked = () => card.classList.contains('peek');
  // Between its two sizes the card only ever slides: its height changes in one go, before or after the slide, with
  // the transform holding its top edge where it was, so nothing bounces. A short transition for the settle only,
  // then none, so a tap elsewhere still shows its card at once.
  const slide = (fromY, toY, then) => {
    card.style.transition = 'none'; card.style.transform = `translateY(${fromY}px)`;
    card.getBoundingClientRect();   // the start is laid out before the transition begins
    card.style.transition = 'transform .25s ease'; card.style.transform = `translateY(${toY}px)`;
    let done = false;
    const finish = () => { if (done) return; done = true; card.style.transition = 'none'; then && then(); card.style.transform = ''; card.getBoundingClientRect(); card.style.transition = ''; };
    card.addEventListener('transitionend', finish, { once: true }); setTimeout(finish, 320);
  };
  // Down to the peek: the head slides to where it will rest, then the card is cut to it.
  const toPeek = (dy = 0) => { const full = card.offsetHeight; fitPeek(card); const peekH = parseFloat(card.style.getPropertyValue('--peek')) || full; slide(dy, Math.max(0, full - peekH), () => { card.classList.add('peek'); card.scrollTop = 0; }); };
  // Up to the whole card: it grows first, held down where the peek was, then slides up.
  const toFull = (dy = 0) => { const peekH = card.offsetHeight; card.classList.remove('peek'); const full = card.offsetHeight; slide(full - peekH + dy, 0); };
  // Off the map: the card's own transform (its closed state) with a transition on it.
  const away = () => { card.style.transition = 'transform .25s ease'; close(); setTimeout(() => { card.style.transition = ''; }, 300); };
  let y0 = null, x0 = 0, t0 = 0, claimed = false;
  const settle = (dy, dt) => {
    const far = Math.abs(dy) > 70 || (Math.abs(dy) > 24 && Math.abs(dy) / Math.max(dt, 1) > 0.5);   // far enough, or a flick
    const at = claimed === 'down' ? Math.max(0, dy) : Math.max(-24, Math.min(0, dy / 4));   // where the finger left it
    if (!far) { slide(at, 0); return; }
    if (claimed === 'down') { if (peeked()) away(); else toPeek(at); }
    else if (peeked()) toFull(at);
    else { slide(at, 0); const href = pageHref(); if (href) location.hash = href; }   // the page slides up over the map
  };
  card.addEventListener('click', e => {
    if (e.target.closest('a, button')) return;
    if (peeked()) toFull();
    else if (e.target.closest('.grip')) toPeek();
  });
  card.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { y0 = null; return; }
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; t0 = e.timeStamp; claimed = false;
  }, { passive: true });
  card.addEventListener('touchmove', e => {
    if (y0 === null || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if (!claimed) {
      const down = dy > 0 && card.scrollTop <= 0;
      const up = dy < 0 && (peeked() || (card.scrollTop + card.clientHeight >= card.scrollHeight - 1 && !!pageHref()));
      if ((!down && !up) || Math.abs(dx) > Math.abs(dy)) { y0 = null; return; }   // the browser's: a scroll, or a tap
      claimed = down ? 'down' : 'up'; card.style.transition = 'none';
    }
    e.preventDefault();
    // Down, the card follows the finger away. Up, it only gives a little, a nudge that says the page is coming: the
    // page itself rises over the map on letting go, so the card never lifts off the bottom and leaves a gap.
    card.style.transform = claimed === 'down' ? `translateY(${Math.max(0, dy)}px)` : `translateY(${Math.max(-24, Math.min(0, dy / 4))}px)`;
  }, { passive: false });
  const touchEnd = e => {
    if (y0 === null) return;
    const dy = (e.changedTouches[0] ? e.changedTouches[0].clientY : y0) - y0;
    y0 = null;
    if (claimed) settle(dy, e.timeStamp - t0);
  };
  card.addEventListener('touchend', touchEnd); card.addEventListener('touchcancel', touchEnd);
  // a mouse drags the grip
  let my0 = null;
  card.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || !e.target.closest('.grip')) return;
    my0 = e.clientY; t0 = e.timeStamp; claimed = 'down'; card.setPointerCapture(e.pointerId); card.style.transition = 'none'; e.preventDefault();
  });
  card.addEventListener('pointermove', e => { if (my0 === null) return; card.style.transform = `translateY(${Math.max(0, e.clientY - my0)}px)`; });
  const mouseEnd = e => { if (my0 === null) return; const dy = e.clientY - my0; my0 = null; settle(dy, e.timeStamp - t0); };
  card.addEventListener('pointerup', mouseEnd); card.addEventListener('pointercancel', mouseEnd);
}

/** The satellite toggle, a map control beside the zoom buttons; the choice is kept on the phone. */
/** Imagery slides in under the basemap's labels: everything drawn before its first symbol layer is covered.
 *  The layer exists only while it's on; a hidden raster layer in the initial style left the basemap unpainted. */
function showSat(on) {
  if (!map || !ready) return;
  if (!on) { if (map.getLayer('sat')) map.removeLayer('sat'); if (map.getSource('sat')) map.removeSource('sat'); return; }
  if (map.getLayer('sat')) return;
  if (!map.getSource('sat')) map.addSource('sat', { type: 'raster', tiles: SAT.tiles, tileSize: 256, maxzoom: SAT.maxzoom, bounds: TILES.bounds, attribution: SAT.attribution });
  const first = map.getStyle().layers.find(l => l.type === 'symbol');
  map.addLayer({ id: 'sat', type: 'raster', source: 'sat' }, first && first.id);
}

/** Near me nearest the bottom right corner on a phone; on a wide screen, where the stop card sits bottom right, one
 *  stack top right. Zoom buttons only for a mouse: fingers pinch. */
const WIDE = matchMedia('(min-width: 900px)');
let ctrls = [];
function placeControls() {
  for (const c of ctrls) map.removeControl(c);
  const nav = new maplibregl.NavigationControl({ showCompass: false }), near = nearControl(), sat = satControl(), north = northControl();
  const credit = new maplibregl.AttributionControl({ compact: true });
  // Bottom corners stack upward in the order added, top corners downward. The map credit keeps its own corner:
  // bottom left on a phone, under the buttons' corner on a wide screen, so it never sits in a stack of buttons.
  ctrls = coarse() ? [credit, near, sat, north] : WIDE.matches ? [credit, near, nav, sat, north] : [credit, nav, near, sat, north];
  for (const c of ctrls) map.addControl(c, c === credit ? (WIDE.matches ? 'bottom-right' : 'bottom-left') : WIDE.matches ? 'top-right' : c === nav ? 'bottom-left' : 'bottom-right');
}

/** North: a button that appears once the map is turned, and turns it back. */
function northControl() {
  return {
    onAdd(m) {
      const el = document.createElement('div'); el.className = 'maplibregl-ctrl maplibregl-ctrl-group northctl';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'northbtn'; b.title = 'Point north'; b.setAttribute('aria-label', 'Point north');
      b.innerHTML = icon('compass', 20).s;
      b.onclick = () => m.resetNorth({ duration: 400 });
      const sync = () => { const a = m.getBearing(); el.classList.toggle('on', Math.abs(a) > 0.5); b.querySelector('svg').style.transform = `rotate(${-a}deg)`; };
      m.on('rotate', sync); m.on('rotateend', sync); sync();
      this.off = () => { m.off('rotate', sync); m.off('rotateend', sync); };
      el.appendChild(b); this.el = el; return el;
    },
    onRemove() { this.off(); this.el.remove(); },
  };
}

/** Near me: the map to where you are, with your dot on it. */
function nearControl() {
  return {
    onAdd(m) {
      const el = document.createElement('div'); el.className = 'maplibregl-ctrl maplibregl-ctrl-group';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'nearbtn'; b.title = 'Near me'; b.setAttribute('aria-label', 'Near me');
      b.innerHTML = icon('near', 20).s;
      b.onclick = () => nearMe(geo => { if (geo) { placeMe(geo); m.flyTo({ center: [geo.lon, geo.lat], zoom: 15.5 }); } });
      el.appendChild(b); this.el = el; return el;
    },
    onRemove() { this.el.remove(); },
  };
}

function satControl() {
  return {
    onAdd() {
      const el = document.createElement('div'); el.className = 'maplibregl-ctrl maplibregl-ctrl-group';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'satbtn'; b.title = 'Satellite'; b.setAttribute('aria-label', 'Satellite imagery');
      b.innerHTML = icon('globe', 20).s; b.setAttribute('aria-pressed', satOn() ? 'true' : 'false');
      b.onclick = () => { sat = !sat; b.setAttribute('aria-pressed', sat ? 'true' : 'false'); showSat(sat); };
      el.appendChild(b); this.el = el; return el;
    },
    onRemove() { this.el.remove(); },
  };
}

function chrome() {
  return html`<div class="mapbar"><form class="search" id="mapsearch" role="search"><input class="input" type="search" placeholder="Search streets" autocomplete="off" aria-label="Search stops"><span class="lead">${icon('search', 22)}</span></form></div><div class="mapresults hidden" id="mapresults"></div><div class="mapnotice" id="mapnotice"></div><div class="mapcard hidden" id="mapcard"></div>`;
}

function wireChrome(app) {
  const form = col.querySelector('#mapsearch'), input = form.querySelector('input'), results = col.querySelector('#mapresults');
  form.onsubmit = e => e.preventDefault();
  // On a wide screen the header's search box serves the map (its own bar is hidden): both boxes run this.
  const clear = () => { input.value = ''; const top = document.querySelector('#topsearch input'); if (top) top.value = ''; results.classList.add('hidden'); };
  let t;
  mapSearch = v => { clearTimeout(t); t = setTimeout(() => {
    const q = v.trim();
    if (!q) { results.classList.add('hidden'); return; }
    const hits = search(q, 12);
    const addr = parseAddress(q);
    const places = addr ? geocode(addr, 3) : [];
    // Places by name (a shop, a school, a clinic), as the home search finds them: a tap frames the spot with its nearest stops.
    const spotRows = searchPlaces(q, 5).list.map(p => { const n = nearest(p.lat, p.lon, 1)[0]; const what = [p.osm ? p.word : '', p.osm ? p.area : ''].filter(Boolean).join(' · '); return html`<a class="stoprow" href="#/map/at/${p.lat.toFixed(5)},${p.lon.toFixed(5)}/${encodeURIComponent(p.name)}"><div class="mid"><span class="name">${p.name}</span><span class="dist">${[what, n ? 'Nearest stop ' + metres(n.d) : ''].filter(Boolean).join(' · ')}</span></div><div class="end">${icon('pin', 18)}</div></a>`; }).join('');
    const placeRows = places.map(pl => html`<a class="stoprow" href="#/map/at/${pl.lat.toFixed(5)},${pl.lon.toFixed(5)}/${encodeURIComponent(pl.label + ', ' + pl.town)}"><div class="mid"><span class="name">${pl.label}, ${pl.town}${townState(pl.town)}${pl.near ? ' · near ' + pl.near : ''}</span><span class="dist">${pl.stops.length ? `Nearest stop ${metres(pl.stops[0].d)}` : 'No stops near'}</span></div><div class="end">${icon('pin', 18)}</div></a>`).join('');
    const stopRows = hits.map(i => stop(i).hub
      ? html`<a class="stoprow" href="#/hub"><div class="mid"><span class="name">${D.hub.name}</span><span class="dist">${D.hub.address} · every route</span></div><div class="end">${icon('hub', 18)}</div></a>`
      : html`<a class="stoprow" href="#/map/${stop(i).id}" data-i="${i}"><div class="mid"><span class="name">${stopTitle(i)}</span>${badges(stop(i).routes, 20)}</div><div class="end">${icon('fwd', 18)}</div></a>`).join('');
    results.innerHTML = (streetish(q) ? placeRows + stopRows + spotRows : spotRows + placeRows + stopRows) || html`<div class="empty"><p>No stops, places or addresses match “${q}”.</p></div>`;
    results.classList.remove('hidden');
    results.querySelectorAll('a[data-i]').forEach(a => a.onclick = e => { e.preventDefault(); clear(); select(stop(+a.dataset.i).id, app, true, true); });
    results.querySelectorAll('a:not([data-i])').forEach(a => a.onclick = clear);
  }, 200); };
  input.oninput = () => mapSearch(input.value);
  input.onfocus = () => { if (input.value.trim()) mapSearch(input.value); };
}

function placeMe(geo) {
  if (!map) return;
  if (!meMarker) { const el = document.createElement('div'); el.className = 'me-marker'; meMarker = new maplibregl.Marker({ element: el }); }
  meMarker.setLngLat([geo.lon, geo.lat]).addTo(map);
}

function applySelection() {
  if (!map || !ready) return;
  map.setFilter('stop-selected', ['==', ['get', 'id'], selected || '']);
  map.setFilter('usu-selected', ['==', ['get', 'id'], uHilite]);
  litLines(map, hiLines, hiLoops);
  tintStops(map, focusRoute);
  // The picked bus's ring too: cleared with the rest, not left till the feed's next update (up to fifteen seconds).
  for (const [id, m] of busMarkers) { m.el.classList.toggle('dim', dimBus(m)); m.el.classList.toggle('lit', litBus(m)); m.el.classList.toggle('on', id === selectedBus); }
}

/** A route in view paints every stop it calls at in its own colour; otherwise a stop wears its first route's. */
function tintStops(m, ri) {
  const dk = dark(), base = ['get', dk ? 'dcolor' : 'color'];
  const c = ri === undefined ? null : dk ? lift('#' + D.routes[ri].color) : '#' + D.routes[ri].color;
  const fill = c ? ['case', ['in', ri, ['get', 'routes']], c, base] : base;
  m.setPaintProperty('stops', 'circle-color', ['case', ['get', 'closed'], dk ? '#101214' : '#f2f2f3', fill]);
  m.setPaintProperty('stops', 'circle-stroke-color', ['case', ['get', 'closed'], fill, dk ? '#101214' : '#ffffff']);
  m.setPaintProperty('stop-selected', 'circle-color', fill);
}

/** The picked stop's routes, or a bus's loop, drawn on top at full strength; every other line faded back. */
function litLines(m, lines, loops) {
  m.setFilter('route-on', ['in', ['get', 'route'], ['literal', lines]]);
  m.setFilter('usu-line-on', ['in', ['get', 'id'], ['literal', loops]]);
  const any = lines.length > 0 || loops.length > 0;
  m.setPaintProperty('route-lines', 'line-opacity', any ? 0.3 : 0.75);
  m.setPaintProperty('usu-lines', 'line-opacity', any ? 0.25 : ['case', ['get', 'approx'], 0.35, 0.9]);
}

function select(id, app, fly = false, zoomIn = false) {
  clearSpot();
  const si = id ? D.stopById[id] : undefined;
  // A route in view (its page, or the Map tab's route) stays in view for a stop of its own, or none: its times stay.
  const keep = focusRoute !== undefined && (si === undefined || stop(si).routes.includes(focusRoute));
  selected = id; uHilite = ''; hiLoops = []; hiLines = keep ? [focusRoute] : si !== undefined ? [...stop(si).routes] : [];
  if (!keep) focusRoute = undefined;
  applySelection();
  routeTimes(focusRoute !== undefined ? focusRoute : null, now());
  const card = col.querySelector('#mapcard');
  if (!id) { card.classList.remove('open', 'peek'); return; }
  if (si === undefined) return;
  const s = stop(si);
  // Beside the panel a tap opens the stop page there, wherever the tap came from; a phone, or the Map tab, gets the card.
  // A tap on the map centres the stop, coming in to the streets from far out; an arrival from elsewhere zooms in further.
  const zoom = zoomIn === 'closer' ? Math.min(18, Math.max(16, map.getZoom() + 1.5)) : zoomIn ? (wide() && app.route.name !== 'map' ? 16 : 15.5) : Math.max(map.getZoom(), 15);
  if (wide() && fly && app.route.name !== 'map') {
    map.easeTo({ padding: pad(), center: [s.lon, s.lat], zoom, duration: 700 });
    if (location.hash !== '#/stop/' + id) location.hash = '#/stop/' + id;
    card.classList.remove('open'); return;
  }
  const clockNow = now();
  const next = nextAt(si, 3, clockNow);
  const fromHub = metres(distance(s.lat, s.lon, D.hub.lat, D.hub.lon));
  const closed = closedRoutes(si, clockNow.ymd), al = stopAlerts(si, clockNow.ymd);
  const end = al.length ? alertsUntil(al) : null, until = end ? (end === clockNow.ymd ? ' today' : ' until ' + fmtDay(end)) : '';
  const alertLine = al.length ? html`<span class="eyebrow alert${closed.size ? ' warnmark' : ''}">${icon('ban', 14)}${closed.size ? [...closed].map(ri => 'Route ' + D.routes[ri].short).join(' and ') + (closed.size > 1 ? ' skip' : ' skips') + ' this stop' + until : al[0].title}</span>` : '';
  // The twin across the road, the stop for the other way: a pill at the right of the eyebrow, with its next bus, so
  // the card grows by nothing for it; a tap swaps the card to it without leaving the map.
  const twinLine = s.twin ? acrossPill(si, clockNow, { button: true }) : '';
  // The shuttle stop at the same pole, drawn as this one dot: its routes, and a way to its buses.
  const sh = U && U.sharedByCvtd[si], us = sh ? U.stops[sh.i] : null;
  const shuttleLine = us ? html`<a class="shuttleline" href="#/usu/${us.id}"><span class="eyebrow">${icon('hub', 14)}Also the USU shuttle · ${us.name}</span>${chips(us.routes, 20)}</a>` : '';
  const poolLine = poolAt(si) ? html`<span class="eyebrow poolline">${icon('info', 14)}Also a POOL pickup · on-demand ride, <a href="tel:${POOL.phone}">${POOL.phone}</a></span>` : '';
  card.innerHTML = html`<div class="grip"></div><div class="head"><div class="eyerow"><span class="eyebrow">${s.town} · Stop ${s.code || s.id}${twinLine ? '' : ` · ${fromHub} from the ${D.hub.name}`}</span>${twinLine}</div><div class="name"><span>${s.name}</span>${routeLinks(si)}</div>${shuttleLine}${poolLine}${alertLine}</div>
    ${next.length ? next.map(t => depRow(t, clockNow, { warn: t.day > 0 && closed.has(t.r) })) : html`<div class="empty"><p>Nothing scheduled here in the next week.</p></div>`}
    <div class="open"><a class="btn btn-primary btn-lg btn-block blueprint" href="#/stop/${s.id}">${corners()}Open stop</a><a class="btn btn-secondary btn-lg blueprint" href="#/go/${s.id}">Get here</a></div>`;
  const tw = card.querySelector('[data-twin]');
  if (tw) tw.onclick = () => { card.scrollTop = 0; select(tw.dataset.twin, app, true); };
  if (card.classList.contains('peek')) fitPeek(card);   // a new head, its own height
  card.classList.remove('hidden');
  requestAnimationFrame(() => {
    card.classList.add('open');
    if (!fly || !map) return;
    // Ease the stop into the middle of the map: on a phone the middle of what's left above the card, on a wide screen,
    // where the card sits in a corner, the middle. A tap from far out comes in to the streets; closer in it keeps the zoom.
    map.easeTo({ padding: pad(), center: [s.lon, s.lat], zoom, offset: cardOffset(card), duration: 650, essential: true });
  });
}

/** A POOL pickup point's card: what it is, when it runs, how to book. Nothing to time: the ride comes when booked. */
export function selectPool(id, app) {
  const s = POOL && POOL.byId.get(id);
  if (!s) return;
  clearSpot();
  selected = null; selectedBus = null; selectedU = null; uHilite = ''; hiLines = []; hiLoops = []; focusRoute = undefined;
  applySelection();
  const card = col.querySelector('#mapcard');
  const ua = navigator.userAgent, appHref = /iPhone|iPad|iPod/.test(ua) ? POOL.ios : POOL.android;
  card.innerHTML = html`<div class="grip"></div><div class="head"><span class="eyebrow">POOL pickup · on demand · zero fare</span><div class="name"><span>${s.name}</span></div>
      <div class="muted">${D.agency.brand}'s on-demand ride around ${POOL.towns.slice(0, 4).join(', ')}: book it and a van comes to this point. Same-day bookings twenty minutes ahead or more.</div>
      <div class="muted">${POOL.hours}.</div></div>
    <div class="open"><a class="btn btn-primary btn-lg btn-block blueprint" href="${appHref}" target="_blank" rel="noopener">${corners()}Book in the On-Demand app</a><a class="btn btn-secondary btn-lg blueprint" href="tel:${POOL.phone}">Call</a></div>`;
  card.classList.remove('hidden');
  requestAnimationFrame(() => {
    card.classList.add('open');
    map.easeTo({ padding: pad(), center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 15), offset: cardOffset(card), duration: 650, essential: true });
  });
}

/** A stop's card over the map, from a page beside it, framed with where the rider is looking from (a shuttle stop):
 *  both in view, or the stop centred when they're close. */
export function showStopFrom(id, lat, lon, app) {
  const si = D.stopById[id];
  if (!map || si === undefined) return;
  const s = stop(si);
  selectedBus = null; selectedU = null;
  select(id, app);
  const card = col.querySelector('#mapcard');
  requestAnimationFrame(() => {
    const b = new maplibregl.LngLatBounds([s.lon, s.lat], [s.lon, s.lat]).extend([lon, lat]);
    const side = wide() ? card.offsetWidth + 48 : 60;
    settlePad(), map.fitBounds(b, { padding: { top: 110, bottom: wide() ? 110 : card.offsetHeight + 40, left: 110, right: side }, maxZoom: 17, duration: 700 });
  });
}

/** Where a stop goes with a card open: above a phone's card, which spans the bottom; on a wide screen, where the card
 *  sits in the bottom right corner, the middle of the map it leaves clear, to its left. Beside a page the map is
 *  narrower, and its plain middle can fall under the card. */
// The stop in the middle of the map left clear: beside the card on a wide screen, above it on a phone, and below the
// search bar and any notice either way.
const cardOffset = card => wide() ? [-(card.offsetWidth + 16) / 2, topCover() / 2] : [0, (topCover() - card.offsetHeight) / 2];

function notice(clockNow) {
  const n = col.querySelector('#mapnotice');
  if (!n) return;
  if (servicesOn(clockNow.ymd).size) { n.innerHTML = ''; return; }
  const resume = nextServiceDay(clockNow);
  // The first buses of that day from the Transit Center, and when most routes are running (routes leaving together):
  // the early routes (12 and 15 at 5:00) start well before the rest, and a rider needing one mustn't read 6:30.
  let first = '', t0 = Infinity;
  if (resume) {
    const deps = D.stops.flatMap((s, si) => s.hub ? timesOn(si, resume) : []);
    t0 = Math.min(...deps.map(t => t.min));
    const early = [...new Set(deps.filter(t => t.min === t0).map(t => t.r))].sort((a, b) => a - b);
    const pulse = nextPulse(1, clockNow).find(p => p.ymd === resume);
    const names = early.map(ri => isLoop(ri) ? D.routes[ri].long : D.routes[ri].short);
    const which = early.length && early.length < 5 ? ` (${early.every(ri => !isLoop(ri)) ? (names.length > 1 ? 'routes ' : 'route ') : ''}${names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]})` : '';
    if (isFinite(t0)) first = ` The first leave the ${D.hub.name} at ${clockText(t0)}${which}${pulse && pulse.min > t0 ? `; most routes start at ${clockText(pulse.min)}` : ''}.`;
  }
  // One line over the map, the rest a tap away; closed, it stays closed the rest of the day on this phone.
  let shut = null;
  try { shut = localStorage.getItem('cr-notice-shut'); } catch { /* storage refused: it shows */ }
  if (shut === clockNow.ymd) { n.innerHTML = ''; return; }
  const open = n.dataset.open === clockNow.ymd;
  n.innerHTML = html`<div class="callout notice-min${open ? ' open' : ''}">${icon('moon', 18)}<button type="button" class="nm-text" aria-expanded="${open ? 'true' : 'false'}"><b>No service today</b>${resume ? html`<span> · resumes ${dayName(resume, true)}${isFinite(t0) ? ' ' + clockText(t0) : ''}</span>` : ''}${open ? html`<span class="sub">${resume ? `Buses resume ${fmtDay(resume)}.` : ''}${first}</span>` : ''}</button><button type="button" class="nm-x" aria-label="Hide for today">${icon('close', 18)}</button></div>`;
  n.querySelector('.nm-text').onclick = () => { n.dataset.open = open ? '' : clockNow.ymd; notice(clockNow); };
  n.querySelector('.nm-x').onclick = () => { try { localStorage.setItem('cr-notice-shut', clockNow.ymd); } catch { /* storage refused: hidden till the page reloads */ } n.innerHTML = ''; };
}

// ---- the shuttle, live
/** Buses follow their loops' curve: full size and tappable from zoom 14 up, shrinking below that, and
 *  bare arrows nobody can tap below 13, so a valley-wide view isn't a pile of overlapping badges. */
function busScale() {
  if (!map) return;
  const z = map.getZoom();
  const scale = z >= 14 ? 1 : z >= 12 ? 0.45 + (z - 12) * 0.275 : Math.max(0.2, 0.45 - (12 - z) * 0.125);
  const c = map.getContainer();
  c.style.setProperty('--bus-scale', scale.toFixed(3));
  c.classList.toggle('bus-small', z < 13);
}
const ARROW = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 3 20 20l-8-4-8 4z"/></svg>';
/** A bus fades when the rider has lit something else: a Connect route or a shuttle loop that isn't its own. */
function dimBus(m) {
  if (m.kind === 'c') return (hiLines.length > 0 && !hiLines.includes(m.ri)) || hiLoops.length > 0;
  return hiLoops.length > 0 && !hiLoops.includes(U.routes[m.ri].id);
}
/** A bus on a lit route or loop: drawn at full size and tappable however far out the map is zoomed. */
function litBus(m) {
  return m.kind === 'c' ? hiLines.includes(m.ri) : hiLoops.includes(U.routes[m.ri].id);
}
/** Every bus with a fix, shuttle and Connect alike, moved or placed; the ones gone from the feeds removed. */
/** On a wide screen the panel covers the map's left 420 px: the map keeps its centre in the part you can see,
 *  easing across as the panel slides, so the place you were looking at stays put. */
let padLeft = null;
// The panel's room, eased in with every move that follows it: a move started while the panel's padding is still
// easing (a stop picked as the Map tab opens) would stop it partway and leave the map off centre.
const pad = () => ({ left: padLeft || 0, top: 0, right: 0, bottom: 0 });
/** The valley's edges, which the map keeps within. MapLibre's own limit (maxBounds) measures the whole map, not the
 *  part left clear beside the panel, so it stopped short of the east edge by half the panel and let the west run on
 *  under it. This one keeps the part you can see inside the edges, and zooms in as far as it takes to. */
const EDGE = [[-112.4, 41.3], [-111.3, 42.4]];
function keepIn(c, z) {
  const zoom = Math.min(Math.max(+z, 8), 19);
  if (!map) return { center: c, zoom };
  const el = map.getContainer(), p = map.getPadding(), vw = el.clientWidth - p.left - p.right, vh = el.clientHeight - p.top - p.bottom;
  if (vw <= 0 || vh <= 0) return { center: c, zoom };
  const mx = lng => (lng + 180) / 360, my = lat => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
  const lngOf = x => x * 360 - 180, latOf = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
  let ws = 512 * 2 ** zoom, z2 = zoom;
  const x0 = mx(EDGE[0][0]), x1 = mx(EDGE[1][0]), y0 = my(EDGE[1][1]), y1 = my(EDGE[0][1]);
  const need = Math.max(vw / ((x1 - x0) * ws), vh / ((y1 - y0) * ws));
  if (need > 1) { z2 = zoom + Math.log2(need); ws = 512 * 2 ** z2; }
  const hx = vw / 2 / ws, hy = vh / 2 / ws, x = mx(c.lng), y = my(c.lat);
  const cx = x1 - x0 <= 2 * hx ? (x0 + x1) / 2 : Math.min(Math.max(x, x0 + hx), x1 - hx);
  const cy = y1 - y0 <= 2 * hy ? (y0 + y1) / 2 : Math.min(Math.max(y, y0 + hy), y1 - hy);
  return { center: new maplibregl.LngLat(lngOf(cx), latOf(cy)), zoom: z2 };
}
/** How far down the map the search bar and any notice over it reach. */
function topCover() {
  const top = map.getContainer().getBoundingClientRect().top;
  let cover = 0;
  for (const el of col.querySelectorAll('.mapbar, #mapnotice')) { const r = el.getBoundingClientRect(); if (r.height && !el.classList.contains('hidden')) cover = Math.max(cover, r.bottom - top); }
  return cover;
}
/** A fit's margins, the top's past the search bar and any notice, so what's framed isn't under them. */
const fitPad = n => ({ top: n + topCover(), bottom: n, left: n, right: n });
let padUntil = 0;
const settlePad = () => { if (map.getPadding().left !== (padLeft || 0)) map.setPadding(pad()); };
function panelPad(app) {
  const want = wide() && app.route.name !== 'map' ? 420 : 0;
  if (want === padLeft) return;
  padLeft = want;
  padUntil = Date.now() + 300;   // a move then is the panel's, not the rider's: a stop picked with it still goes to the stop
  map.easeTo({ padding: { left: want, top: 0, right: 0, bottom: 0 }, duration: 0 });   // the panel is simply there, so the map is too
}

/** The Map tab tapped again: the whole of Logan, north up, nothing picked. */
const HOME = [-111.8300, 41.7330];
export function resetView(app) {
  if (!map) return;
  selectedBus = null; selectedU = null; lastFocused = null;
  select(null, app);
  map.easeTo({ padding: pad(), center: HOME, zoom: 13, bearing: 0, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600 });
}

/** Search the map from outside it: the header's box on a wide screen. Set once the map is up. */
export let mapSearch = () => {};

export function liveUpdate(app) {
  if (rtShown !== null) routeTimes(rtShown, now());   // the feed's word moves a route's next buses
  if (!map) return;
  const seen = new Set();
  const place = (b, kind, color, title) => {
    seen.add(b.id);
    let m = busMarkers.get(b.id);
    if (!m) {
      const el = document.createElement('div');
      el.className = 'bus'; el.innerHTML = '<div class="bus-marker">' + ARROW + '</div>';
      el.onclick = ev => { ev.stopPropagation(); selectBus(b.id, app); };
      m = { marker: new maplibregl.Marker({ element: el, rotationAlignment: 'map' }), el, ri: b.ri, kind };
      busMarkers.set(b.id, m);
      m.marker.setLngLat([b.lon, b.lat]).addTo(map);
    } else glide(m, b.lon, b.lat);
    m.el.title = title;
    m.el.style.setProperty('--bus-color', color);
    m.marker.setRotation(b.course);
    m.ri = b.ri;
    m.el.classList.toggle('on', selectedBus === b.id);
    m.el.classList.toggle('dim', dimBus(m));
    m.el.classList.toggle('lit', litBus(m));
  };
  if (U) for (const b of live.buses) place(b, 'u', U.routes[b.ri].color, U.routes[b.ri].name + ' · bus ' + b.name);
  if (!rtStale()) for (const b of rt.buses) place(b, 'c', dark() ? lift('#' + D.routes[b.ri].color) : '#' + D.routes[b.ri].color, 'Route ' + D.routes[b.ri].short + ' · bus ' + b.label);
  for (const [id, m] of busMarkers) if (!seen.has(id)) { if (m.anim) cancelAnimationFrame(m.anim); m.marker.remove(); busMarkers.delete(id); }
  if (wantBus && busMarkers.has(wantBus)) pickBus(wantBus, app);
  if (selectedBus) { if (seen.has(selectedBus)) busCard(app); else { selectedBus = null; hiLoops = []; hiLines = []; applySelection(); col.querySelector('#mapcard').classList.remove('open'); } }
  if (selectedU !== null) uCard(app);
}
// Move a bus marker to its new fix over 600 ms in geographic coordinates, so the
// glide survives a pan (a CSS transform transition would drag behind the map).
function glide(m, lon, lat) {
  if (m.anim) cancelAnimationFrame(m.anim);
  const from = m.marker.getLngLat();
  if (from.lng === lon && from.lat === lat) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { m.marker.setLngLat([lon, lat]); return; }
  const t0 = performance.now(), dur = 600;
  const step = now => {
    const k = Math.min(1, (now - t0) / dur);
    m.marker.setLngLat([from.lng + (lon - from.lng) * k, from.lat + (lat - from.lat) * k]);
    m.anim = k < 1 ? requestAnimationFrame(step) : null;
  };
  m.anim = requestAnimationFrame(step);
}
/** A bus's route page: a Connect bus's in the direction it's going, landing on its row; a shuttle's loop. */
function busRouteHref(id) {
  const c = findBus(id);
  if (c) return '#/route/' + encodeURIComponent(D.routes[c.ri].short) + (c.dir !== null && c.dir !== undefined ? '/' + c.dir : '') + '?bus=' + encodeURIComponent(id);
  const b = live.buses.find(x => x.id === id);
  return b ? '#/usu/route/' + U.routes[b.ri].id : null;
}
function selectBus(id, app) {
  clearSpot();
  // Beside the panel (a wide screen, off the Map tab) a bus opens its route there, as a stop opens its page.
  if (wide() && app.route.name !== 'map') { const h = busRouteHref(id); if (h) { location.hash = h; return; } }
  const c = findBus(id), b = c || live.buses.find(x => x.id === id);
  selectedBus = id; selectedU = null; selected = null; uHilite = '';
  hiLines = c ? [c.ri] : []; hiLoops = b && !c ? [U.routes[b.ri].id] : [];
  applySelection();
  for (const [bid, m] of busMarkers) m.el.classList.toggle('on', bid === id);
  busCard(app);
  if (c && rtShown === c.ri) routeTimes(c.ri, now());   // the route's times become this bus's
}
/** A Connect bus: its route and headsign, where it's headed next with the feed's minutes. */
function connectCard(b, app) {
  const r = D.routes[b.ri], clockNow = now();
  const next = busStops(b, 5);
  const card = col.querySelector('#mapcard');
  // The word comes from the next stop the timetable has a row for: never the trip's final one, which on a loop
  // is the stop it left from, an hour's schedule earlier. Only that one left, the card just says Live.
  const at = next.find(n => !n.end);
  const late = at && !isLoop(b.ri) ? lateWords(heldAt(at.si, at.min - (schedAt(at.si, b) ?? at.min))) : '';
  card.innerHTML = html`<div class="grip"></div><div class="head buscard">
    <div class="top"><span class="eyebrow">Bus ${b.label} · heading ${heading(b.course)}</span>${rtStale() ? liveTag('Last seen ' + rtSeen()) : liveTag(late ? 'Live · ' + late : 'Live')}</div>
    <div class="who">${badge(b.ri, 32)}<span class="name">${b.h !== null ? headsign({ h: b.h, r: b.ri, dir: b.dir === null ? undefined : b.dir }) : r.long}</span></div></div>
    ${next.length ? html`<div class="nextstops"><i class="line" style="background:#${r.color}"></i>${next.map((n, i) => html`<a class="ns${i === 0 ? ' here' : ''}" href="#/stop/${D.stops[n.si].id}"><span class="dot"><i style="${i === 0 ? 'background:#' + r.color : ''}"></i></span><span class="nm">${D.stops[n.si].name}</span><span class="when">${n.min - clockNow.min <= 0 ? 'now' : 'in ' + (n.min - clockNow.min) + ' min'}</span></a>`)}</div>` : ''}
    <div class="open"><a class="btn btn-secondary btn-lg btn-block" href="${busRouteHref(b.id)}">Open route</a></div>`;
  card.classList.remove('hidden');
  requestAnimationFrame(() => card.classList.add('open'));
}
/** The scheduled minute of this bus's trip at a stop, for the late/early word. */
function schedAt(si, b) {
  const ti = D.trips ? D.trips.indexOf(b.trip) : -1;
  if (ti < 0) return null;
  for (const rows of Object.values(D.times[si] || {})) for (const t of rows) if (t[4] === ti) return t[0];
  return null;
}
function busCard(app) {
  const c = findBus(selectedBus);
  if (c) return connectCard(c, app);
  const b = live.buses.find(x => x.id === selectedBus);
  if (!b) return;
  const r = U.routes[b.ri];
  const next = r.shape.length ? busNext(b, 4) : [];
  // A route with no stops is a charter: a bus booked for an event (usually the university's), with no
  // fixed route to show and none of the regular routes' hours to hold it to.
  const charter = !r.stops.length;
  const card = col.querySelector('#mapcard');
  card.innerHTML = html`<div class="grip"></div><div class="head buscard">
    <div class="top"><span class="eyebrow">Bus ${b.name} · heading ${heading(b.course)}</span>${isStale() ? liveTag('Last seen ' + lastSeen()) : liveTag()}</div>
    <div class="who">${chip(b.ri, 32)}<span class="name">${r.name}</span></div>
    ${b.cap ? html`<div class="load">${meter(b, true)}<span>${loadWords(b)}</span></div>` : ''}
    ${charter ? html`<div class="hours">${icon('info', 15)}<span>Booked for an event, with no fixed route or stops.</span></div>`
      : hours(b.ri) ? html`<div class="hours">${icon('clock', 15)}<span>${untilWords(b.ri) ? html`<b>${untilWords(b.ri).replace(/^./, c => c.toUpperCase())}</b> · ` : ''}usually ${hours(b.ri)}</span></div>` : ''}${charter ? '' : offNote([b.ri])}</div>
    ${next.length ? html`<div class="nextstops"><i class="line" style="background:${r.color}"></i>${next.map((n, i) => html`<a class="ns${n.here && i === 0 ? ' here' : ''}" href="#/usu/${U.stops[n.si].id}"><span class="dot"><i style="${n.here && i === 0 ? 'background:' + r.color : ''}"></i></span><span class="nm">${U.stops[n.si].name}</span><span class="when">${n.here && i === 0 ? 'here now' : isStale() ? '' : 'about ' + Math.max(1, n.min) + ' min'}</span></a>`)}</div>` : ''}
    ${charter ? '' : html`<div class="open"><a class="btn btn-secondary btn-lg btn-block" href="${busRouteHref(b.id)}">Open route</a></div>`}`;
  card.classList.remove('hidden');
  requestAnimationFrame(() => card.classList.add('open'));
}
/** A shuttle stop tapped, as a Connect stop is: its card, in to the streets from far out, and closer when it's
 *  tapped again. */
function selectU(id, app, closer = false) {
  clearSpot();
  const si = U.stopById[id];
  if (si === undefined) return;
  if (U.shared[si]) return select(D.stops[U.shared[si].j].id, app, true, closer ? 'closer' : false);   // one pole, one dot: the Connect stop's card
  const zoom = closer ? Math.min(18, Math.max(16, map.getZoom() + 1.5)) : Math.max(map.getZoom(), 15);
  if (wide() && app.route.name !== 'map') {
    map.easeTo({ padding: pad(), center: [U.stops[si].lon, U.stops[si].lat], zoom, duration: 700 });
    location.hash = '#/usu/' + id; return;
  }
  selectedU = si; selectedBus = null; selected = null; uHilite = id; hiLines = []; hiLoops = U.stops[si].routes.map(ri => U.routes[ri].id); applySelection();
  for (const m of busMarkers.values()) m.el.classList.remove('on');
  const s = U.stops[si];
  uCard(app);
  const card = col.querySelector('#mapcard');
  map.easeTo({ padding: pad(), center: [s.lon, s.lat], zoom, offset: cardOffset(card), duration: 650 });
}
function uCard(app) {
  const si = selectedU, s = U.stops[si];
  const card = col.querySelector('#mapcard');
  const rows = board(si);
  card.innerHTML = html`<div class="grip"></div><div class="head"><span class="eyebrow">${U.name}${U.shared[si] ? ' · also Connect' : ''}</span><div class="name"><span>${s.name}</span></div>${chips(s.routes, 24)}</div>
    ${hasData() ? html`<div class="list">${rows.slice(0, 3).map(r => liveRow(r, { href: '#/usu/' + s.id }))}</div>` : html`<div class="empty"><p>Finding the buses…</p></div>`}
    <div class="open"><a class="btn btn-primary btn-lg btn-block blueprint" href="#/usu/${s.id}">${corners()}Open stop</a></div>`;
  card.classList.remove('hidden');
  requestAnimationFrame(() => card.classList.add('open'));
}

/** An address: a pin, and the card lists the stops nearest it. */
function circle(lat, lon, m = 90, n = 40) {
  const dlat = m / 111000, dlon = m / (111000 * Math.cos(lat * Math.PI / 180));
  const ring = [];
  for (let i = 0; i <= n; i++) { const a = i / n * 2 * Math.PI; ring.push([lon + dlon * Math.cos(a), lat + dlat * Math.sin(a)]); }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] };
}
/** A searched place's pin and disc off the map, and the address back to the plain Map tab, so a reload doesn't
 *  bring them back: the rider has moved on to something else, or closed its card. */
function clearSpot() {
  if (pinMarker) pinMarker.remove();
  if (map) setSpot(null);
  if (location.hash.startsWith('#/map/at/')) { history.replaceState(null, '', '#/map'); shownHash = '#/map'; }
}
function setSpot(at) {
  const apply = () => map.getSource('spot') && map.getSource('spot').setData(at ? circle(at.lat, at.lon) : { type: 'FeatureCollection', features: [] });
  if (ready) apply(); else map.once('load', apply);
}
function showAt(at, app, clockNow) {
  selected = null; uHilite = ''; hiLines = []; hiLoops = []; applySelection();
  // A soft disc rather than a pin: an address is arithmetic on the town's grid, good to a block, not a survey.
  setSpot(at);
  if (!pinMarker) { const el = document.createElement('div'); el.className = 'spot-marker'; pinMarker = new maplibregl.Marker({ element: el }); }
  pinMarker.setLngLat([at.lon, at.lat]).addTo(map);
  const near = nearestTo(at.lat, at.lon, 4);
  const card = col.querySelector('#mapcard');
  card.innerHTML = html`<div class="grip"></div><div class="head"><span class="eyebrow">Nearest stops to</span><div class="name"><span>${at.label || 'this spot'}</span></div></div>
    ${near.length ? near.map(({ i, d }) => stopRow(i, nextAt(i, 1, clockNow)[0], clockNow, { dist: metres(d) + ' away' })) : html`<div class="empty"><p>No stops within ${metres(4000)} of there.</p></div>`}`;
  card.classList.remove('hidden');
  requestAnimationFrame(() => card.classList.add('open'));
  const key = 'at:' + at.lat.toFixed(4) + ',' + at.lon.toFixed(4);
  if (lastFocused !== key) map.easeTo({ padding: pad(), center: [at.lon, at.lat], zoom: Math.max(map.getZoom(), 14.5), offset: cardOffset(card), duration: 700 });
  lastFocused = key;
}

/** Called by the router whenever the map is on screen. */
let shownHash = null;
export async function show(o, app, clockNow) {
  await showPage(o, app, clockNow);
  mainRun(o.run || null);   // a run open in a narrower stop page's sheet, drawn here beside it
  routeTimes(focusRoute !== undefined && !o.run ? focusRoute : null, clockNow);
}
// A bus asked for before the feed has placed it: picked out as soon as it appears.
let wantBus = null;
/** A route's bus, from its row on the route page: its ring and card, and the map panned (never zoomed) to keep it
 *  above the card. */
function pickBus(id, app) {
  const m = busMarkers.get(id);
  if (!m) { wantBus = id; return; }
  wantBus = null;
  selectBus(id, app);
  const card = col.querySelector('#mapcard'), ll = m.marker.getLngLat();
  map.easeTo({ padding: pad(), center: [ll.lng, ll.lat], offset: cardOffset(card), duration: 500 });
}
async function showPage({ stopId, ustopId, routeShort, uRoute, alertId, at, focus, hub, tick, bus }, app, clockNow) {
  await init(app);
  // A map still hidden (the Map tab not on screen yet, the page behind it just gone) has no size to fit anything to:
  // a route fitted to nothing is the whole valley and further. Waited for, a few frames at most; if the address
  // moves on meanwhile, the newer call does the work.
  const was = location.hash, box = map.getContainer();
  for (let i = 0; i < 10 && !(box.clientWidth && box.clientHeight); i++) await new Promise(requestAnimationFrame);
  if (location.hash !== was) return;
  // Still hidden (a phone's route page, its map behind it): nothing to frame, and nothing is framed, so the Map tab
  // opens where it was left, and a route's own map link, a new address, frames that route then.
  if (!(box.clientWidth && box.clientHeight)) return;
  requestAnimationFrame(() => map.resize());
  panelPad(app);
  // Beside the panel the stop is in the panel: no card over the map as well.
  if (wide() && app.route.name !== 'map') col.querySelector('#mapcard').classList.remove('open');
  notice(clockNow);
  if (ready) refreshClosed(clockNow);
  if (app.geo) placeMe(app.geo);
  if (tick) return;   // the minute turning is no reason to move the map
  if (!routeShort && !alertId && focusRoute !== undefined) { focusRoute = undefined; applySelection(); }   // off the route's page: stops back to their own colours
  // The address is acted on once. A redraw with the same one (the app coming back to the front, say)
  // leaves whatever the rider has since tapped on the map alone.
  const fresh = location.hash !== shownHash;
  shownHash = location.hash;
  if (!fresh) return;
  // The map grown or shrunk since (the route page's small map opened out into the Map tab, say): what it was fitted to
  // is fitted again, at its new size, not left where the small one had it.
  const size = box.clientWidth + 'x' + box.clientHeight, resized = size !== fitSize;
  fitSize = size;
  map.resize();   // its own idea of its size can lag a map just shown again (hidden, it shrank to nothing)
  if (app.route.name !== 'map') col.querySelector('#mapcard').classList.remove('open');   // a card tapped up beside one page isn't the next's
  if (pinMarker && !at) { pinMarker.remove(); setSpot(null); }
  if (stopId || ustopId || routeShort || alertId || hub || at) { selectedBus = null; selectedU = null; }
  if (at) return showAt(at, app, clockNow);
  if (hub) {
    selected = null; uHilite = ''; hiLines = []; hiLoops = []; applySelection(); col.querySelector('#mapcard').classList.remove('open');
    if (lastFocused !== 'hub') map.easeTo({ padding: pad(), center: [D.hub.lon, D.hub.lat], zoom: 16, duration: 700 });
    lastFocused = 'hub';
    return;
  }
  // A shuttle route's page: its line drawn on top, the rest faded, the map fitted to it, as a Connect route's is.
  if (uRoute && U && U.routeById[uRoute] !== undefined) {
    const changed = lastFocused !== 'ur:' + uRoute;
    lastFocused = 'ur:' + uRoute;
    selected = null; uHilite = ''; hiLines = []; hiLoops = [uRoute]; focusRoute = undefined; applySelection();
    col.querySelector('#mapcard').classList.remove('open');
    if (focus && (changed || resized)) settlePad(), map.fitBounds(uRouteBounds(uRoute), { padding: fitPad(40), duration: 700, maxZoom: 16 });
    return;
  }
  // An alert from the About page: its route drawn on top, the stops it closes framed (marked already, as every
  // closed stop is), or the whole route when it names none.
  if (alertId) {
    const a = A.alerts.find(x => x.id === alertId);
    if (!a) return;
    const ris = alertRoutes(a), sts = (a.stops || []).map(id => D.stopById[id]).filter(si => si !== undefined);
    lastFocused = 'a:' + alertId;
    selected = null; uHilite = ''; hiLines = ris; hiLoops = []; focusRoute = ris.length === 1 ? ris[0] : undefined; applySelection();
    col.querySelector('#mapcard').classList.remove('open');
    const b = new maplibregl.LngLatBounds();
    if (sts.length) for (const si of sts) b.extend([D.stops[si].lon, D.stops[si].lat]);
    else for (const ri of ris) b.extend(routeBounds(ri));
    if (!b.isEmpty()) settlePad(), map.fitBounds(b, { padding: 80, duration: 700, maxZoom: 16 });
    return;
  }
  if (routeShort) {
    const ri = D.routeByShort[routeShort];
    if (ri === undefined) return;
    const changed = lastFocused !== 'r:' + ri;
    lastFocused = 'r:' + ri;
    selected = null; uHilite = ''; hiLines = [ri]; hiLoops = []; focusRoute = ri; applySelection();
    col.querySelector('#mapcard').classList.remove('open');
    if (focus && (changed || resized) && !stayRoute) settlePad(), map.fitBounds(routeBounds(ri), { padding: fitPad(40), duration: 700, maxZoom: 15.5 });
    if (stayRoute && app.route.name === 'map') routeCard(ri, app);
    stayRoute = false;
    if (bus && app.route.name === 'map' && !tick) pickBus(bus, app); else if (!bus) wantBus = null;
    return;
  }
  if (stopId) {
    const si = D.stopById[stopId];
    if (si !== undefined) {
      const s = stop(si);
      const changed = lastFocused !== stopId;
      lastFocused = stopId;
      selected = stopId; uHilite = ''; hiLines = [...s.routes]; hiLoops = []; applySelection();
      // On the Map tab the card decides the framing, so the stop sits above it; beside the
      // stop list there is no card, and a fresh arrival eases to the stop itself.
      if (app.route.name === 'map') select(stopId, app, changed, changed && map.getZoom() < 15);
      else if (focus && changed && (!map.isMoving() || Date.now() < padUntil)) map.easeTo({ padding: pad(), center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 15), duration: 700 });
    }
  } else if (ustopId && U) {
    const si = U.stopById[ustopId];
    if (si === undefined) return;
    const s = U.stops[si];
    const changed = lastFocused !== 'u:' + ustopId;
    lastFocused = 'u:' + ustopId;
    const pole = U.shared[si];   // at a Connect stop's pole: that dot is this stop on the map
    selected = pole ? D.stops[pole.j].id : null; uHilite = pole ? '' : ustopId; hiLines = []; hiLoops = s.routes.map(ri => U.routes[ri].id); applySelection();
    if (app.route.name === 'map') { if (pole) select(D.stops[pole.j].id, app, changed); else if (changed) selectU(ustopId, app); else { selectedU = si; uCard(app); } }
    else if (focus && changed && (!map.isMoving() || Date.now() < padUntil)) map.easeTo({ padding: pad(), center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 15.5), duration: 700 });
  } else if (app.route && app.route.name === 'map') {
    lastFocused = null;
    select(null, app);
  }
}

/** The box around a route's stops, every direction. */
function uRouteBounds(id) {
  const r = U.routes[U.routeById[id]], b = new maplibregl.LngLatBounds();
  for (const p of r.shape || []) b.extend(p);
  for (const si of r.stops) b.extend([U.stops[si].lon, U.stops[si].lat]);
  return b;
}
function routeBounds(ri) {
  const b = new maplibregl.LngLatBounds();
  for (const seq of Object.values(D.routes[ri].stops || {})) for (const si of seq) b.extend([D.stops[si].lon, D.stops[si].lat]);
  return b;
}

// ---- the small map on a stop or route page (phones): one instance, moved from page to page
/** Draw the stop into `slot`; `sel` is { stopId } or { ustopId }. */
export async function mini(sel, slot) {
  mmSel = sel;
  const ri = sel.route !== undefined ? D.routeByShort[sel.route] : undefined;
  const ur = sel.uroute && U && U.routeById[sel.uroute] !== undefined ? sel.uroute : null;
  const key = ri !== undefined ? 'r:' + ri : ur ? 'ur:' + ur : sel.ustopId ? 'u:' + sel.ustopId : sel.stopId;
  const s = ri !== undefined ? D.stops[(Object.values(D.routes[ri].stops || {})[0] || [])[0]] : ur ? U.stops[U.routes[U.routeById[ur]].stops[0]] : sel.ustopId ? (U && U.stops[U.stopById[sel.ustopId]]) : D.stops[D.stopById[sel.stopId]];
  if (!s) return;
  if (!mmEl) {
    await loadTiles();
    if (!slot.isConnected) return;   // the page moved on while the tile index loaded
    mmEl = document.createElement('div'); mmEl.className = 'minimap';
    slot.prepend(mmEl);
    mm = new maplibregl.Map({ container: mmEl, style: style(false), center: [s.lon, s.lat], zoom: 16, minZoom: 10, maxZoom: 17.5, interactive: false, fadeDuration: 0, attributionControl: { compact: true } });
    squaresOnDemand(mm);
    mm.on('load', () => { mmReady = true; loadShapes(mm); miniSelection(); });
    let mmFlavor = dark() ? 'dark' : 'light';   // its own: the big map's restyle mustn't make this one think it's done
    window.addEventListener('themechange', () => { const f = dark() ? 'dark' : 'light'; if (mm && f !== mmFlavor) { mmFlavor = f; mmReady = false; mm.setStyle(style(false)); mm.once('style.load', () => { mmReady = true; loadShapes(mm); miniSelection(); }); } });
  } else if (mmEl.parentNode !== slot) {
    slot.prepend(mmEl);
    requestAnimationFrame(() => mm.resize());
  }
  if (mmKey !== key) {
    if (ri !== undefined) mm.fitBounds(routeBounds(ri), { padding: 24, duration: 0, maxZoom: 15.5 });
    else if (ur) mm.fitBounds(uRouteBounds(ur), { padding: 24, duration: 0, maxZoom: 16 });
    else mm.jumpTo({ center: [s.lon, s.lat], zoom: 16 });
  }
  mmKey = key;
  miniSelection();
}
function miniSelection() {
  if (!mm || !mmReady || !mmSel) return;
  // a shuttle stop at a Connect stop's pole is drawn as that stop's dot, so that dot is the one marked
  const pole = mmSel.ustopId && U && U.shared[U.stopById[mmSel.ustopId]];
  mm.setFilter('stop-selected', ['==', ['get', 'id'], pole ? D.stops[pole.j].id : mmSel.stopId || '']);
  mm.setFilter('usu-selected', ['==', ['get', 'id'], pole ? '' : mmSel.ustopId || '']);
  const ri = mmSel.route !== undefined ? D.routeByShort[mmSel.route] : undefined;
  const si = mmSel.stopId ? D.stopById[mmSel.stopId] : undefined;
  const lines = ri !== undefined ? [ri] : si !== undefined ? [...D.stops[si].routes] : [];
  const loops = mmSel.uroute ? [mmSel.uroute] : mmSel.ustopId && U ? U.stops[U.stopById[mmSel.ustopId]].routes.map(r => U.routes[r].id) : [];
  litLines(mm, lines, loops);
  tintStops(mm, ri);
}

// ---- one run on a wide stop page: its path from this stop to its end, a time by each stop. Its own small map,
// kept and moved into each redraw of the page, so the minute's redraw doesn't rebuild it.
let rmEl = null, rm = null, rmReady = false, rmRun = null, rmFlavor = null;
/** The road a run drives between its stops, from the route's drawn lines: for each pair of stops in turn, the
 *  shortest forward way along any of the route's shapes; a straight line where none has one. A stop is found anywhere
 *  along a line, not only at its points: out in the country a line's points can be half a mile apart. */
function runPath(fc, ri, seq) {
  const NEAR = 60, own = fc.features.filter(f => f.properties.route === ri), out = [];
  const kx = Math.cos(41.74 * Math.PI / 180) * 111320, ky = 110540;   // degrees to metres, near enough for the valley
  for (const f of own) {
    if (f._walk) continue;
    const c = f.geometry.coordinates;
    let d = 0;
    f._walk = c.map((p, k) => { if (k) d += Math.hypot((p[0] - c[k - 1][0]) * kx, (p[1] - c[k - 1][1]) * ky); return [d, p]; });
    const [x0, y0] = c[0], [x1, y1] = c[c.length - 1];
    f._loop = Math.hypot((x1 - x0) * kx, (y1 - y0) * ky) < NEAR;   // a line that comes round to its start: a way can wrap
  }
  // Where along a line a stop is: every stretch that passes within NEAR of it, the nearest point of each.
  const at = (f, s) => {
    const w = f._walk, hits = [];
    for (let k = 1; k < w.length; k++) {
      const [da, [ax, ay]] = w[k - 1], [db, [bx, by]] = w[k];
      const vx = (bx - ax) * kx, vy = (by - ay) * ky, px = (s.lon - ax) * kx, py = (s.lat - ay) * ky, L2 = vx * vx + vy * vy;
      const t = L2 ? Math.max(0, Math.min(1, (px * vx + py * vy) / L2)) : 0;
      const e = Math.hypot(px - t * vx, py - t * vy);
      if (e <= NEAR) { const along = da + t * (db - da); if (!hits.length || along - hits[hits.length - 1].along > 2 * NEAR) hits.push({ along, e }); else if (e < hits[hits.length - 1].e) hits[hits.length - 1] = { along, e }; }
    }
    return hits.map(h => h.along);
  };
  for (let i = 0; i + 1 < seq.length; i++) {
    const A = D.stops[seq[i][1]], B = D.stops[seq[i + 1][1]];
    let best = null;
    for (const f of own) {
      const total = f._walk[f._walk.length - 1][0];
      for (const a of at(f, A)) for (const b of at(f, B)) {
        const len = b > a ? b - a : f._loop ? total - a + b : -1;
        if (len <= 0 || (best && len >= best.len)) continue;
        best = { len, pts: b > a ? slice(f._walk, a, b) : [...slice(f._walk, a, total), ...slice(f._walk, 0, b).slice(1)] };
      }
    }
    // a way much longer than the straight line is the wrong pass round a loop, not the road
    const straight = distance(A.lat, A.lon, B.lat, B.lon);
    const pts = best && best.len < straight * 4 + 400 ? [[A.lon, A.lat], ...best.pts.slice(1, -1), [B.lon, B.lat]] : [[A.lon, A.lat], [B.lon, B.lat]];
    out.push(...pts.slice(out.length ? 1 : 0));
  }
  return out;
}
/** Draw `R` into `slot`: { key, legs: [{ ri, seq: [[min, si]…] }…] from this stop on, the same bus's runs in turn,
 *  points: [{ si, t (its label), rank, leg, r }…], hot }. */
export async function runMap(slot, R) {
  rmRun = R; RT.R = R;
  if (rm && rmFlavor !== (dark() ? 'dark' : 'light')) { rm.remove(); rm = null; rmEl = null; rmReady = false; RT.key = null; }
  if (!rmEl) {
    await loadTiles();
    if (!slot.isConnected) return;
    rmEl = document.createElement('div'); rmEl.className = 'runmap-map';
    slot.prepend(rmEl);
    rmFlavor = dark() ? 'dark' : 'light';
    rm = new maplibregl.Map({ container: rmEl, style: style(false), bounds: runBounds(R), fitBoundsOptions: { padding: 36 }, minZoom: 8, maxZoom: 18,   // out far enough for 16 from Logan to Preston, labels and all
      dragRotate: false,   // the wheel zooms it, as the big map: it's a pane of its own, beside the list
      touchPitch: false, pitchWithRotate: false, fadeDuration: 0, attributionControl: { compact: true } });
    rm.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    squaresOnDemand(rm);
    rm.on('load', async () => {
      addRunLayers(rm);
      await loadShapes(rm);
      rmReady = true; RT.key = null; drawRun(RT);
    });
    rm.on('rotateend', () => placeRunLabels(RT));
    // A drag, a pinch or the wheel is the rider's: the map stays where they put it. (A resize carries an event too,
    // the window's, so a move alone can't tell.)
    for (const ev of ['dragstart', 'wheel', 'touchstart']) rm.on(ev, () => { RT.moved = true; });
    // a stop on the map lights its row in the list beside it
    rm.on('mousemove', e => {
      const f = rm.queryRenderedFeatures([[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]], { layers: ['stops'] })[0];
      const id = f ? f.properties.id : null;
      rm.getCanvas().style.cursor = id ? 'pointer' : '';
      document.querySelectorAll('.run-stop').forEach(a => a.classList.toggle('hot', a.dataset.id === id));
    });
    rm.on('click', e => {
      const f = rm.queryRenderedFeatures([[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]], { layers: ['stops'] })[0];
      if (f && rmRun && rmRun.points.some(p => D.stops[p.si].id === f.properties.id)) location.hash = '#/stop/' + f.properties.id;
    });
  } else if (rmEl.parentNode !== slot) {
    slot.prepend(rmEl);
    requestAnimationFrame(() => rm.resize());
  }
  RT.m = rm;
  drawRun(RT);
}
function runBounds(R) {
  const b = new maplibregl.LngLatBounds();
  for (const p of R.points) b.extend([D.stops[p.si].lon, D.stops[p.si].lat]);
  return b;
}
// A run is drawn on a map through one of these: the wide stop page's own map (RT), or the big map beside a narrower
// page's sheet (MT). Each keeps what's drawn on it, so a redraw of the same run changes nothing.
const RT = { m: null, R: null, key: null, labels: null, ready: () => rmReady, pad: 36 };
const MT = { m: null, R: null, key: null, labels: null, ready: () => ready, pad: 60, main: true };
const RUN_HIDE = ['usu-lines', 'usu-line-on', 'usu-selected', 'usu-stops', 'usu-labels', 'stop-labels', 'route-on', 'pool-zone', 'pool-edge', 'pool-stops'];
/** The run's line, its lit stop and its times, added to a map once (and again after a restyle, which drops them). */
function addRunLayers(m) {
  if (m.getSource('run')) return;
  m.addSource('run', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  m.addSource('runt', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  m.addLayer({ id: 'run-line', type: 'line', source: 'run', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': ['case', ['get', 'later'], 0.5, 1] } }, 'stops');
  m.addLayer({ id: 'run-hot', type: 'circle', source: 'runt', filter: ['==', ['get', 'si'], -1], paint: { 'circle-radius': 10, 'circle-color': ['get', 'color'], 'circle-stroke-width': 3, 'circle-stroke-color': dark() ? '#eef0f2' : '#1d1f20' } });
  m.addLayer({ id: 'run-times', type: 'symbol', source: 'runt', layout: { 'text-field': ['get', 't'], 'text-font': ['Noto Sans Medium'], 'text-size': ['case', ['get', 'big'], 14, 12.5], 'text-anchor': ['get', 'a'], 'text-offset': ['get', 'o'], 'symbol-sort-key': ['get', 'rank'] }, paint: { 'text-color': dark() ? '#eef0f2' : '#1d1f20', 'text-halo-color': dark() ? '#101214' : '#f2f2f3', 'text-halo-width': 1.6 } });
}
/** Everything but the run set back: only its stops, its line on top, the other routes faint, no shuttle. */
function dressForRun(m, R) {
  for (const id of RUN_HIDE) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none');
  m.setPaintProperty('route-lines', 'line-opacity', 0.18);
  m.setFilter('stops', ['in', ['get', 'id'], ['literal', R.points.map(p => D.stops[p.si].id)]]);
  m.setFilter('stop-selected', ['==', ['get', 'id'], D.stops[R.points[0].si].id]);
  tintStops(m, R.legs[0].ri);
  m.setFilter('run-hot', ['==', ['get', 'si'], R.hot ?? -1]);
}
async function drawRun(T) {
  const R = T.R, m = T.m;
  if (!m || !T.ready() || !R) return;
  addRunLayers(m);
  dressForRun(m, R);
  if (R.key === T.key) return;
  const key = T.key = R.key;
  T.moved = false;
  const col = ri => dark() ? lift('#' + D.routes[ri].color) : '#' + D.routes[ri].color;
  const fc = await shapes();
  if (T.key !== key) return;
  const legs = R.legs.filter(l => l.seq.length > 1).map(l => ({ ...l, path: fc ? runPath(fc, l.ri, l.seq) : l.seq.map(([, si]) => [D.stops[si].lon, D.stops[si].lat]) }));
  // Each time on the side of the road its bus stops on: the right of the way it's going (a northbound stop's to the
  // east, a southbound's to the west). The way is the road's at the stop, from the path.
  const way = new Map();
  for (const l of legs) {
    let from = 0;
    for (const [, si] of l.seq) {
      if (way.has(si)) continue;
      const s = D.stops[si];
      let k = from, best = Infinity;
      for (let i = from; i < l.path.length; i++) { const d = distance(s.lat, s.lon, l.path[i][1], l.path[i][0]); if (d < best) { best = d; k = i; } if (best < 15 && d > 400) break; }
      from = k;
      const a = l.path[Math.max(0, k - 2)], b = l.path[Math.min(l.path.length - 1, k + 2)];
      if (a && b && (a[0] !== b[0] || a[1] !== b[1])) way.set(si, Math.atan2((b[0] - a[0]) * Math.cos(s.lat * Math.PI / 180), b[1] - a[1]) * 180 / Math.PI);
    }
  }
  T.labels = { way, features: R.points.map(p => ({ si: p.si, color: col(p.r), t: p.t, big: p.rank <= 1, rank: p.rank })) };
  placeRunLabels(T);
  // the first run solid, the bus's later ones lighter: which way round is which
  m.getSource('run').setData({ type: 'FeatureCollection', features: legs.map((l, i) => ({ type: 'Feature', properties: { color: col(l.ri), later: i > 0 }, geometry: { type: 'LineString', coordinates: l.path } })) });
  // Moved into a new box as the day redrew, it measured nothing while out of the page: measured again first, or the
  // run is fitted to no room at all and comes out zoomed far away.
  m.resize();
  if (T.main) { settlePad(); m.fitBounds(runBounds(R), { padding: fitPad(T.pad), duration: 600, maxZoom: 16 }); }   // clear of the search bar and notice
  else m.fitBounds(runBounds(R), { padding: T.pad, duration: 0, maxZoom: 16 });
}
/** The run's times, each to the right of its bus's way, as the map is turned now: the screen's right, left, above or
 *  below, whichever is nearest the road's right-hand side. Placed again when the map turns. */
function placeRunLabels(T) {
  if (!T.m || !T.labels || !T.m.getSource('runt')) return;
  const turn = T.m.getBearing(), { way } = T.labels;
  const side = si => {
    if (!way.has(si)) return { a: 'left', o: [0.9, 0] };
    const r = ((way.get(si) + 90 - turn) % 360 + 360) % 360;   // the bus's right, as a bearing on the screen
    return r < 45 || r >= 315 ? { a: 'bottom', o: [0, -0.8] } : r < 135 ? { a: 'left', o: [0.9, 0] } : r < 225 ? { a: 'top', o: [0, 0.8] } : { a: 'right', o: [-0.9, 0] };
  };
  T.m.getSource('runt').setData({ type: 'FeatureCollection', features: T.labels.features.map(p => ({ type: 'Feature', properties: { ...p, ...side(p.si) }, geometry: { type: 'Point', coordinates: [D.stops[p.si].lon, D.stops[p.si].lat] } })) });
}
/** The big map beside a narrower stop page takes a run picked in its sheet; null puts the map back as it was. */
function mainRun(R) {
  if (!map) return;
  if (!ready) { if (R) map.once('load', () => mainRun(R)); return; }
  if (R) {
    if (!MT.m) { MT.m = map; map.on('rotateend', () => placeRunLabels(MT)); }
    MT.R = R;
    return drawRun(MT);
  }
  if (!MT.R) return;
  MT.R = null; MT.key = null; MT.labels = null;
  for (const id of ['run', 'runt']) if (map.getSource(id)) map.getSource(id).setData({ type: 'FeatureCollection', features: [] });
  for (const id of RUN_HIDE) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
  map.setFilter('stops', null);
  applySelection();
}
const liveRun = () => MT.R ? MT : RT;
/** A row in the list pointed at: its stop lit on the run's map. */
export function runHot(si) { const T = liveRun(); if (T.R) { T.R.hot = si; if (T.m && T.ready() && T.m.getLayer('run-hot')) T.m.setFilter('run-hot', ['==', ['get', 'si'], si ?? -1]); } }
/** The run's map after its box changed size (the sheet's 'Whole map'): measured again and the run fitted. */
export function runResize() {
  if (!rm || !RT.R) return;
  // fitted again to its new room, unless the rider has moved it: then it stays where they put it
  requestAnimationFrame(() => { rm.resize(); if (!RT.moved) rm.fitBounds(runBounds(RT.R), { padding: 36, duration: 250, maxZoom: 16 }); });
}
/** A stop picked in the run's list: lit, and brought to the middle of the map, in to the streets. */
export function runFocus(si) {
  runHot(si);
  const T = liveRun();
  if (T.m && D.stops[si]) T.m.easeTo({ ...(T.main ? { padding: pad() } : {}), center: [D.stops[si].lon, D.stops[si].lat], zoom: Math.max(T.m.getZoom(), 15), duration: 500 });
}

// ---- a route in view: each of its stops with that route's next bus there today, on the side of the road it stops on.
// Not one bus's times, as a run's are: the next bus at each stop, so they needn't rise along the line.
const ways = new Map();   // route → its stops' way (bearing) along its line, worked out once
async function routeWays(ri) {
  if (ways.has(ri)) return ways.get(ri);
  const fc = await shapes(), way = new Map(), kx = Math.cos(41.74 * Math.PI / 180);
  for (const seq of Object.values(D.routes[ri].stops || {})) {
    const path = fc ? runPath(fc, ri, seq.map(si => [0, si])) : seq.map(si => [D.stops[si].lon, D.stops[si].lat]);
    let from = 0;
    for (const si of seq) {
      if (way.has(si)) continue;
      const s = D.stops[si];
      let k = from, best = Infinity;
      for (let i = from; i < path.length; i++) { const d = distance(s.lat, s.lon, path[i][1], path[i][0]); if (d < best) { best = d; k = i; } if (best < 15 && d > 400) break; }
      from = k;
      const a = path[Math.max(0, k - 2)], b = path[Math.min(path.length - 1, k + 2)];
      if (a && b && (a[0] !== b[0] || a[1] !== b[1])) way.set(si, Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) * 180 / Math.PI);
    }
  }
  ways.set(ri, way);
  return way;
}
let rtShown = null, rtWired = false, rtBase = null, rtAt = '';
/** A route's first run of a day: its trip and the stop it starts at, found once per route and day. */
const firstRuns = new Map();
function firstRun(ri, ymd) {
  const k = ri + ':' + ymd;
  if (!firstRuns.has(k)) {
    let best = null;
    for (const si of new Set(Object.values(D.routes[ri].stops || {}).flat())) for (const t of timesOn(si, ymd)) {
      if (t.r !== ri) continue;
      const st = tripStops(t.trip);
      if (st.length && (!best || st[0][0] < best.min)) best = { trip: t.trip, si: st[0][1], min: st[0][0] };
    }
    firstRuns.set(k, best);
  }
  return firstRuns.get(k);
}
const bear = (p, q) => Math.atan2((q.lon - p.lon) * Math.cos(p.lat * Math.PI / 180), q.lat - p.lat) * 180 / Math.PI;
async function routeTimes(ri, clockNow) {
  if (!map || !ready) return;
  if (!map.getSource('rtimes')) {
    map.addSource('rtimes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const dk = dark();
    // Each line its own colour (a live estimate blue, a later day grey): a stop with a time each way, one of them
    // the feed's, mustn't paint the timetable's line as live too.
    const text = { 'text-field': ['format', ['get', 't1'], { 'text-color': ['get', 'c1'] }, ['get', 't2'], { 'text-color': ['get', 'c2'] }], 'text-font': ['Noto Sans Medium'], 'text-size': 12.5, 'text-max-width': 20 };
    const paint = { 'text-color': ['case', ['get', 'live'], dk ? '#94bce3' : '#416180', ['get', 'later'], dk ? '#9a9ca0' : '#6b6c70', dk ? '#eef0f2' : '#1d1f20'], 'text-halo-color': dk ? '#101214' : '#f2f2f3', 'text-halo-width': 1.6 };
    // A stop facing another of the route's: its time on the bus's side, so the two read apart. Any other: beside its
    // own dot, off the road (either side) where there's room, along it only when neither side has.
    map.addLayer({ id: 'route-times', type: 'symbol', source: 'rtimes', layout: { ...text, 'text-variable-anchor-offset': ['get', 'v'] }, paint });
  }
  if (!rtWired) { rtWired = true; map.on('moveend', () => { const k = map.getZoom().toFixed(2) + '/' + map.getBearing().toFixed(1); if (k !== rtAt) placeTimes(); }); }
  rtShown = ri;
  if (ri === null) { rtBase = null; map.getSource('rtimes').setData({ type: 'FeatureCollection', features: [] }); return; }
  const [way, fc] = await Promise.all([routeWays(ri), shapes()]);
  if (rtShown !== ri) return;
  const all = [...new Set(Object.values(D.routes[ri].stops || {}).flat())], items = [];
  // Facing another: this route's stop the other way on the same road, across it or up to a few blocks along (16's
  // highway, both ways). Not one the other way a street over, as 5's Main and 200 East; nor a twin on another route,
  // whose dot has no time beside it to be mistaken for this one.
  const facing = si => all.some(o => { const p = D.stops[si], q = D.stops[o];
    if (o === si || !way.has(o) || Math.abs(((way.get(o) - way.get(si)) % 360 + 540) % 360 - 180) < 120) return false;
    const d = distance(p.lat, p.lon, q.lat, q.lon), x = (bear(p, q) - way.get(si)) * Math.PI / 180;
    return Math.abs(d * Math.sin(x)) < 80 && Math.abs(d * Math.cos(x)) < 800; });
  // A time as short as it reads: today's bare, a later day's with its day ("6:23 Mon"), in grey besides.
  const short = t => clock(t.min).h + (t.day === 0 ? '' : ' ' + dayName(t.ymd, true));
  const dk = dark(), colour = t => t.live ? (dk ? '#94bce3' : '#416180') : t.day > 0 ? (dk ? '#9a9ca0' : '#6b6c70') : (dk ? '#eef0f2' : '#1d1f20');
  // Whose time it is: a stop's next bus, whichever that is. A bus picked out (its ring, its card, from the route's
  // card or a tap on it) narrows them to that bus's alone, at the stops still ahead of it: with two buses out on a
  // route, that's how a rider sees which times are which without the map wearing bus numbers.
  const picked = selectedBus && !rtStale() ? rt.buses.find(b => b.id === selectedBus && b.ri === ri) : null;
  for (const si of all) {
    const t = nextAt(si, 1, clockNow, picked ? 1 : 8, x => x.r === ri && (!picked || D.trips[x.trip] === picked.trip))[0];   // a picked bus: today only, so a stop it has passed gets no time (not its run tomorrow)
    if (!t) continue;
    // The day's first run, where it starts partway along the route: said, so the stops before it (their first bus the
    // run after) don't look out of order. Not at the Transit Center, where every run starts.
    const f = firstRun(ri, t.ymd), starts = f && f.trip === t.trip && f.si === si && !D.stops[si].hub;
    let label = short(t) + (starts ? ' · starts here' : '');
    let lines = [[label, colour(t)]];
    // Where one way calls only on request (16 north at Pepperidge Farms): the next bus each way, a line apiece, the
    // way it goes on each, so the one on request doesn't read as the stop's only bus.
    if (onRequest(si, ri, 0) || onRequest(si, ri, 1)) {
      const ways = [0, 1].map(d => nextAt(si, 1, clockNow, picked ? 1 : 8, x => x.r === ri && x.dir === d && (!picked || D.trips[x.trip] === picked.trip))[0]).filter(Boolean).sort((x, y) => x.req - y.req);
      lines = ways.map(x => [short(x) + ' ' + (h => /^to /.test(h) ? h : h.replace(/bound$/i, '').toLowerCase())(headsign(x)) + (x.req ? ' · on request' : ''), colour(x)]);
      label = lines.map(l => l[0]).join('\n');
    }
    items.push({ si, w: way.has(si) ? way.get(si) : null, lock: way.has(si) && facing(si), props: { t: label, live: !!t.live, later: t.day > 0, t1: lines[0][0], c1: lines[0][1], t2: lines[1] ? '\n' + lines[1][0] : '', c2: lines[1] ? lines[1][1] : lines[0][1] } });
  }
  rtBase = { items, lines: fc ? fc.features.filter(f => f.properties.route === ri).map(f => f.geometry.coordinates) : [] };
  placeTimes();
}
// Where each time goes at this zoom and turn (a pan moves the times and the route together, so it changes nothing).
// Facing another: the bus's side, always. Any other: the spot around its dot furthest from the route's own line, so a
// time doesn't sit on the road or reach across to another street of the route, as 5's Main and 200 East, or
// Lewiston's spur and the highway.
function placeTimes() {
  if (!rtBase || !map.getSource('rtimes')) return;
  rtAt = map.getZoom().toFixed(2) + '/' + map.getBearing().toFixed(1);
  const turn = map.getBearing(), pts = [];
  for (const line of rtBase.lines) {
    let a = null;
    for (const ll of line) {
      const b = map.project(ll);
      if (a) {
        const n = Math.min(400, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
        for (let i = 1; i <= n; i++) pts.push(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n);
      }
      a = b;
    }
  }
  const off = { left: [0.9, 0], right: [-0.9, 0], top: [0, 0.8], bottom: [0, -0.8], 'top-left': [0.6, 0.5], 'top-right': [-0.6, 0.5], 'bottom-left': [0.6, -0.5], 'bottom-right': [-0.6, -0.5] };
  const opp = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }, corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  const features = rtBase.items.map(({ si, w, lock, props }) => {
    const s = D.stops[si], p = map.project([s.lon, s.lat]), rows = props.t.split('\n'), lw = Math.max(...rows.map(r => r.length)) * 7 + 4, h = 10 * rows.length;
    const box = { left: [p.x + 10, p.x + 12 + lw, p.y - h, p.y + h], right: [p.x - 12 - lw, p.x - 10, p.y - h, p.y + h],
      top: [p.x - lw / 2, p.x + lw / 2, p.y + 9, p.y + 11 + 2 * h], bottom: [p.x - lw / 2, p.x + lw / 2, p.y - 11 - 2 * h, p.y - 9],
      'top-left': [p.x + 6, p.x + 8 + lw, p.y + 5, p.y + 7 + 2 * h], 'top-right': [p.x - 8 - lw, p.x - 6, p.y + 5, p.y + 7 + 2 * h],
      'bottom-left': [p.x + 6, p.x + 8 + lw, p.y - 7 - 2 * h, p.y - 5], 'bottom-right': [p.x - 8 - lw, p.x - 6, p.y - 7 - 2 * h, p.y - 5] };
    // The route under the time counts most; the route just beyond it a little, so a time faces out from the route's
    // streets rather than into the block between them, and its neighbours along a street all face the same way.
    // And where the rest of the route lies, all told, within a few hundred pixels: a time leans away from it, so the
    // times down a street all face out even where the street itself is all that's near.
    let gx = 0, gy = 0;
    for (let i = 0; i < pts.length; i += 2) { const dx = pts[i] - p.x, dy = pts[i + 1] - p.y; if (dx * dx + dy * dy < 90000) { gx += dx; gy += dy; } }
    const g = Math.hypot(gx, gy) || 1;
    const score = k => { const [x0, x1, y0, y1] = box[k], m = 40; let n = 0;
      for (let i = 0; i < pts.length; i += 2) { const x = pts[i], y = pts[i + 1];
        if (x > x0 && x < x1 && y > y0 && y < y1) n += 1000; else if (x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m) n++; }
      const cx = (x0 + x1) / 2 - p.x, cy = (y0 + y1) / 2 - p.y;
      return n + 30 * (cx * gx + cy * gy) / (Math.hypot(cx, cy) * g); };
    let order = ['left', 'right', 'top', 'bottom'];
    if (w !== null) {
      const r = ((w + 90 - turn) % 360 + 360) % 360;   // the bus's right, on the screen
      const a = r < 45 || r >= 315 ? 'bottom' : r < 135 ? 'left' : r < 225 ? 'top' : 'right';
      order = lock ? [a] : [a, opp[a], ...(a === 'left' || a === 'right' ? ['top', 'bottom'] : ['left', 'right'])];
    }
    // Free: the clearest spot, the corners too; the next clearest kept for when another time has it. With nowhere clear
    // of the route, it waits for a closer zoom rather than sit on the road.
    if (!lock) {
      const n = Object.fromEntries([...order, ...corners].map(k => [k, score(k)]));
      order = [...order, ...corners].filter(k => n[k] < 500).sort((x, y) => n[x] - n[y]).slice(0, 2);
    }
    if (!order.length) return null;
    return { type: 'Feature', properties: { ...props, v: order.flatMap(k => [k, off[k]]) }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } };
  }).filter(Boolean);
  map.getSource('rtimes').setData({ type: 'FeatureCollection', features });
}
