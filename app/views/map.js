// The map: self-hosted vector tiles, every stop in its routes' colour, the
// route lines, and a card for the stop you tap. Loaded only when first shown.
import * as maplibregl from '../../vendor/maplibre-gl.mjs';
import { layers, namedFlavor } from '../../vendor/basemaps.mjs';
import { D, BASE, stop, route, nextAt, search, servicesOn, nextServiceDay, nextPulse, distance, nearest, stopAlerts, closedRoutes, activeAlerts, A } from '../data.js';
import { now, relative, fmtDay, dayName, clockText, metres } from '../time.js';
import { html, icon, badge, badges, time, sched, corners, depRow, stopRow, stopTitle, side } from '../ui.js';
import { nearMe } from '../main.js';
import { parseAddress, geocode, townState, nearestTo } from '../geo.js';
import { U, live, busNext, board, liveRow, chip, chips, meter, liveTag, heading, loadWords, hasData, isStale, lastSeen, offNote, hours, untilWords } from '../usu.js';

// Aerial imagery, for the option: USGS's public-domain mosaic (NAIP over the valley), ends at zoom 16.
const SAT = { tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'], maxzoom: 16, attribution: 'Imagery <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS</a>' };
let sat = false;   // aerial imagery: a tap each visit, never remembered
const satOn = () => sat;
const coarse = () => matchMedia('(pointer: coarse)').matches;
const wide = () => matchMedia('(min-width: 900px)').matches;
/** A stop link opened on the Map tab of a wide screen becomes its page, without a history entry to loop back into. */
const asPage = hash => location.replace(location.href.split('#')[0] + hash);

let map = null, ready = false, selected = null, uHilite = '', meMarker = null, pinMarker = null, flavorName = null, lastFocused = null;
let mm = null, mmEl = null, mmReady = false, mmKey = null, mmSel = null;   // the small map on a stop page
const busMarkers = new Map();   // bus id → { marker, el }
let selectedBus = null, selectedU = null;
let hiLines = [], hiLoops = [];   // Connect route indices and shuttle route ids whose lines are drawn on top
// The street map is one small file a tile, cut from OpenStreetMap by tools/tiles.py; tiles/tiles.json says how far it reaches.
let TILES = { minzoom: 10, maxzoom: 15, bounds: [-111.98, 41.58, -111.68, 42.16] };
const col = document.getElementById('mapcol');
const dark = () => matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';

function style(sat = true) {
  const flavor = dark() ? 'dark' : 'light';
  flavorName = flavor;
  const f = namedFlavor(flavor);
  const base = layers('protomaps', f, { lang: 'en' });
  return {
    version: 8,
    glyphs: BASE + 'vendor/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: BASE + 'vendor/basemaps-assets/sprites/' + flavor,
    sources: {
      protomaps: { type: 'vector', tiles: [BASE + 'tiles/{z}/{x}/{y}.pbf'], minzoom: TILES.minzoom, maxzoom: TILES.maxzoom, bounds: TILES.bounds, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' },
      stops: { type: 'geojson', data: stopsGeo() },
      lines: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      lclosed: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },   // the stretches of route we can't vouch for
      spot: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      ustops: { type: 'geojson', data: usuStopsGeo() },
      ulines: { type: 'geojson', data: usuLinesGeo() },
    },
    layers: [
      ...base,
      { id: 'spot-fill', type: 'fill', source: 'spot', paint: { 'fill-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'fill-opacity': 0.18 } },
      { id: 'spot-edge', type: 'line', source: 'spot', paint: { 'line-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.8 } },
      { id: 'route-lines', type: 'line', source: 'lines', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, 3.5, 17, 6], 'line-opacity': 0.75 } },
      { id: 'route-on', type: 'line', source: 'lines', filter: ['in', ['get', 'route'], ['literal', []]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 6, 17, 10], 'line-opacity': 1 } },
      // A detour: between the served stops either side of a closed run, the line goes to dots over a paper casing.
      // Each dot wears a thin halo in the map's colour, so it reads even on its own route's other pass, while the
      // gaps still show whatever runs underneath. The halo is 1.7× the dot with the dash scaled to match, so they align.
      { id: 'route-closed-halo', type: 'line', source: 'lclosed', layout: { 'line-cap': 'round' }, paint: { 'line-color': flavor === 'dark' ? '#101214' : '#f2f2f3', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.55, 14, 5.95, 17, 10.2], 'line-dasharray': [0, 2.2 / 1.7] } },
      { id: 'route-closed', type: 'line', source: 'lclosed', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, 3.5, 17, 6], 'line-dasharray': [0, 2.2], 'line-opacity': 0.9 } },
      // a stand-in line (stop to stop, no shape) is a faint thin sketch until its route is lit
      { id: 'usu-lines', type: 'line', source: 'ulines', minzoom: 12, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, ['case', ['get', 'approx'], 0.8, 1.2], 15, ['case', ['get', 'approx'], 1.4, 2.5], 17, ['case', ['get', 'approx'], 2, 4]], 'line-opacity': ['case', ['get', 'approx'], 0.35, 0.9], 'line-dasharray': [3, 1.5] } },
      { id: 'usu-line-on', type: 'line', source: 'ulines', filter: ['in', ['get', 'id'], ['literal', []]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 15, 5.5, 17, 9], 'line-opacity': 1 } },
      { id: 'usu-selected', type: 'circle', source: 'ustops', filter: ['==', ['get', 'id'], ''], paint: { 'circle-radius': 12, 'circle-opacity': 0, 'circle-stroke-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'circle-stroke-width': 3 } },
      { id: 'usu-stops', type: 'symbol', source: 'ustops', minzoom: 12.5, layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 12.5, 0.45, 15, 0.7, 17, 1], 'icon-allow-overlap': true }, paint: {} },
      { id: 'usu-labels', type: 'symbol', source: 'ustops', minzoom: 15.5, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': flavor === 'dark' ? '#eef0f2' : '#1d1f20', 'text-halo-color': flavor === 'dark' ? '#101214' : '#f2f2f3', 'text-halo-width': 1.2 } },
      { id: 'stops', type: 'circle', source: 'stops', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5.5, 17, 8, 19, 11],
        // a closed stop is a hollow ring in its route's colour
        'circle-color': ['case', ['get', 'closed'], flavor === 'dark' ? '#101214' : '#f2f2f3', ['get', 'color']],
        'circle-stroke-color': ['case', ['get', 'closed'], ['get', 'color'], flavor === 'dark' ? '#101214' : '#ffffff'],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, ['case', ['get', 'closed'], 2.5, 1.5], 17, ['case', ['get', 'closed'], 3.5, 1.5]],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 13, 1] } },
      { id: 'stop-selected', type: 'circle', source: 'stops', filter: ['==', ['get', 'id'], ''], paint: { 'circle-radius': 11, 'circle-color': ['get', 'color'], 'circle-stroke-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'circle-stroke-width': 3 } },
      { id: 'stop-labels', type: 'symbol', source: 'stops', minzoom: 15, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': flavor === 'dark' ? '#eef0f2' : '#1d1f20', 'text-halo-color': flavor === 'dark' ? '#101214' : '#f2f2f3', 'text-halo-width': 1.2 } },
    ],
  };
}

function stopsGeo() {
  const ymd = now().ymd;
  return { type: 'FeatureCollection', features: D.stops.map((s, i) => ({ type: 'Feature', id: +s.id, properties: { id: s.id, name: s.name, color: '#' + route(s.routes[0]).color, closed: !!(A.byStop[s.id] && stopAlerts(i, ymd).length) }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })) };
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
          out.push({ type: 'Feature', properties: { color: '#' + r.color, route: +ri }, geometry: { type: 'LineString', coordinates: cut.coords } });
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

function usuStopsGeo() {
  if (!U) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: U.stops.filter(s => s.routes.length).map(s => ({ type: 'Feature', properties: { id: s.id, name: s.name, icon: 'usq-' + U.routes[s.routes[0]].color.slice(1) }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })) };
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
  ]).then(([j, x]) => { XINGS = x || {}; return { type: 'FeatureCollection', features: j.lines.map(l => ({ type: 'Feature', properties: { color: '#' + route(l.route).color, route: l.route, shape: l.shape }, geometry: { type: 'LineString', coordinates: l.coords } })) }; })
    .catch(e => { console.warn('shapes', e); shapesFC = null; return null; });
  return shapesFC;
}
async function loadShapes(m = map) {
  const fc = await shapes();
  if (!fc || !m) return;
  const { closed, gaps } = closedSegments(fc);
  if (m.getSource('lines')) m.getSource('lines').setData(openLines(fc, gaps));
  if (m.getSource('lclosed')) m.getSource('lclosed').setData(closed);
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
  const center = app.geo ? [app.geo.lon, app.geo.lat] : [-111.8300, 41.7330];
  map = new maplibregl.Map({ container: 'map', style: style(), center, zoom: app.geo ? 15 : 13, minZoom: 10, maxZoom: 19, pitchWithRotate: false, touchPitch: false, attributionControl: { compact: true }, maxBounds: [[-112.4, 41.3], [-111.3, 42.4]] });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(satControl(), 'bottom-right');
  map.addControl(northControl(), 'bottom-right');
  squaresOnDemand(map);
  map.on('load', () => { ready = true; addUsuImages(); loadShapes(); applySelection(); if (app.geo) placeMe(app.geo); map.resize(); liveUpdate(app); busScale(); });
  map.on('zoom', busScale);
  map.on('mouseenter', 'usu-stops', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'usu-stops', () => map.getCanvas().style.cursor = '');
  setTimeout(() => map.resize(), 300);
  // A tap picks the nearest stop within a thumb's reach, so two stops that nearly touch are still separable.
  // On a touch screen the pick waits a beat: a second finger-down inside it is a double-tap or a
  // tap-and-drag zoom, not a stop, so the wait is dropped rather than a card opened.
  let tapTimer = 0;
  const cancelTap = () => clearTimeout(tapTimer);
  map.on('touchstart', cancelTap); map.on('movestart', cancelTap); map.on('zoomstart', cancelTap);
  map.on('click', e => {
    if (!coarse()) return pick(e);
    clearTimeout(tapTimer); tapTimer = setTimeout(() => pick(e), 300);
  });
  const pick = e => {
    const r = coarse() ? 22 : 8;
    const hits = map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ['stops', 'usu-stops'] });
    if (hits.length) {
      const best = hits.map(f => { const p = map.project(f.geometry.coordinates); return { f, d: Math.hypot(p.x - e.point.x, p.y - e.point.y) }; }).sort((a, b) => a.d - b.d)[0].f;
      if (best.layer.id === 'stops') select(best.properties.id, app, true); else selectU(best.properties.id, app);
      return;
    }
    selectedBus = null; selectedU = null; select(null, app);
  };
  map.on('mouseenter', 'stops', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'stops', () => map.getCanvas().style.cursor = '');
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((dark() ? 'dark' : 'light') !== flavorName) { ready = false; map.setStyle(style()); map.once('style.load', () => { ready = true; loadShapes(); applySelection(); showSat(sat); }); } });
  wireChrome(app);
  wireGrip(app);
}

/** Swiping the card down closes it, and swiping it up opens the stop's page, from anywhere on the card: the
 *  gesture is claimed on the first move only when the card can't scroll that way any further (at its top for
 *  down, at its end for up) and the finger is heading that way, so scrolling and taps work as before. The grip
 *  also drags with a mouse. The browser's pull-to-refresh never sees any of it. */
function wireGrip(app) {
  const card = col.querySelector('#mapcard');
  const close = () => { selectedBus = null; selectedU = null; select(null, app); };
  const pageHref = () => { const a = card.querySelector('.open a'); return a ? a.getAttribute('href') : null; };
  let y0 = null, x0 = 0, t0 = 0, claimed = false;
  const settle = (dy, dt) => {
    card.style.transition = ''; card.style.transform = '';
    const far = Math.abs(dy) > 70 || (Math.abs(dy) > 24 && Math.abs(dy) / Math.max(dt, 1) > 0.5);   // far enough, or a flick
    if (!far) return;
    if (claimed === 'down') close();
    else { const href = pageHref(); if (href) location.hash = href; }   // the page slides up over the map
  };
  card.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { y0 = null; return; }
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; t0 = e.timeStamp; claimed = false;
  }, { passive: true });
  card.addEventListener('touchmove', e => {
    if (y0 === null || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if (!claimed) {
      const down = dy > 0 && card.scrollTop <= 0;
      const up = dy < 0 && card.scrollTop + card.clientHeight >= card.scrollHeight - 1 && !!pageHref();
      if ((!down && !up) || Math.abs(dx) > Math.abs(dy)) { y0 = null; return; }   // the browser's: a scroll, or a tap
      claimed = down ? 'down' : 'up'; card.style.transition = 'none';
    }
    e.preventDefault();
    card.style.transform = claimed === 'down' ? `translateY(${Math.max(0, dy)}px)` : `translateY(${Math.max(-160, Math.min(0, dy))}px)`;
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
  return html`<div class="mapbar"><form class="search" id="mapsearch" role="search"><input class="input" type="search" placeholder="Search streets" autocomplete="off" aria-label="Search stops"><span class="lead">${icon('search', 22)}</span></form><button class="btn btn-secondary btn-icon" id="mapnear" type="button" aria-label="Near me">${icon('near', 22)}</button></div><div class="mapresults hidden" id="mapresults"></div><div class="mapnotice" id="mapnotice"></div><div class="mapcard hidden" id="mapcard"></div>`;
}

function wireChrome(app) {
  const form = col.querySelector('#mapsearch'), input = form.querySelector('input'), results = col.querySelector('#mapresults');
  form.onsubmit = e => e.preventDefault();
  let t;
  input.oninput = () => { clearTimeout(t); t = setTimeout(() => {
    const q = input.value.trim();
    if (!q) { results.classList.add('hidden'); return; }
    const hits = search(q, 12);
    const addr = parseAddress(q);
    const places = addr ? geocode(addr, 3) : [];
    const placeRows = places.map(pl => html`<a class="stoprow" href="#/map/at/${pl.lat.toFixed(5)},${pl.lon.toFixed(5)}/${encodeURIComponent(pl.label + ', ' + pl.town)}"><div class="mid"><span class="name">${pl.label}, ${pl.town}${townState(pl.town)}${pl.near ? ' · near ' + pl.near : ''}</span><span class="dist">${pl.stops.length ? `Nearest stop ${metres(pl.stops[0].d)}` : 'No stops near'}</span></div><div class="end">${icon('pin', 18)}</div></a>`).join('');
    const stopRows = hits.map(i => html`<a class="stoprow" href="#/map/${stop(i).id}" data-i="${i}"><div class="mid"><span class="name">${stopTitle(i)}</span>${badges(stop(i).routes, 20)}</div><div class="end">${icon('fwd', 18)}</div></a>`).join('');
    results.innerHTML = placeRows + stopRows || html`<div class="empty"><p>No stops or addresses match “${q}”.</p></div>`;
    results.classList.remove('hidden');
    results.querySelectorAll('a[data-i]').forEach(a => a.onclick = e => { e.preventDefault(); input.value = ''; results.classList.add('hidden'); select(stop(+a.dataset.i).id, app, true, true); });
    results.querySelectorAll('a:not([data-i])').forEach(a => a.onclick = () => { input.value = ''; results.classList.add('hidden'); });
  }, 200); };
  col.querySelector('#mapnear').onclick = () => nearMe(geo => { if (geo) { placeMe(geo); map.flyTo({ center: [geo.lon, geo.lat], zoom: 15.5 }); } });
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
  for (const m of busMarkers.values()) m.el.classList.toggle('dim', hiLoops.length > 0 && !hiLoops.includes(U.routes[m.ri].id));
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
  const si = id ? D.stopById[id] : undefined;
  selected = id; uHilite = ''; hiLoops = []; hiLines = si !== undefined ? [...stop(si).routes] : [];
  applySelection();
  const card = col.querySelector('#mapcard');
  if (!id) { card.classList.remove('open'); return; }
  if (si === undefined) return;
  const s = stop(si);
  // On a wide screen a tap opens the stop page beside the map, wherever the tap came from; a phone gets the card.
  if (wide() && fly) {
    map.easeTo({ center: [s.lon, s.lat], zoom: zoomIn ? 16 : Math.max(map.getZoom(), 15), duration: 700 });
    if (location.hash !== '#/stop/' + id) location.hash = '#/stop/' + id;
    card.classList.remove('open'); return;
  }
  const clockNow = now();
  const next = nextAt(si, 3, clockNow);
  const fromHub = metres(distance(s.lat, s.lon, D.hub.lat, D.hub.lon));
  const closed = closedRoutes(si, clockNow.ymd), al = stopAlerts(si, clockNow.ymd);
  const alertLine = al.length ? html`<span class="eyebrow alert">${icon('ban', 14)}${closed.size ? [...closed].map(ri => 'Route ' + D.routes[ri].short).join(' and ') + (closed.size > 1 ? ' skip' : ' skips') + ' this stop' : al[0].title}</span>` : '';
  // The twin across the road, one small line: a tap swaps the card to it without leaving the map.
  const twinLine = s.twin ? html`<button class="twinline" type="button" data-twin="${stop(s.twin[0]).id}">${icon('swap', 16)}<span>${stop(s.twin[0]).name}${side(s.twin[0]) ? ' · ' + side(s.twin[0]) : ''}</span><span class="muted">· ${metres(s.twin[1])}</span></button>` : '';
  card.innerHTML = html`<div class="grip"></div><div class="head"><span class="eyebrow">${s.town} · Stop ${s.code || s.id} · ${fromHub} from the ${D.hub.name}</span><div class="name"><span>${s.name}</span>${badges(s.routes, 30, true)}</div>${alertLine}${twinLine}</div>
    ${next.length ? next.map(t => depRow(t, clockNow, { name: t.day ? undefined : undefined })) : html`<div class="empty"><p>Nothing scheduled here in the next week.</p></div>`}
    <div class="open"><a class="btn btn-primary btn-lg btn-block blueprint" href="#/stop/${s.id}">${corners()}Open stop</a></div>`;
  const tw = card.querySelector('[data-twin]');
  if (tw) tw.onclick = () => { card.scrollTop = 0; select(tw.dataset.twin, app, true); };
  card.classList.remove('hidden');
  requestAnimationFrame(() => {
    card.classList.add('open');
    if (!fly || !map) return;
    // Ease the stop into the middle of the map that's left above the card. A tap keeps the zoom as it is; only an arrival from elsewhere zooms in.
    const zoom = zoomIn ? 15.5 : map.getZoom();
    map.easeTo({ center: [s.lon, s.lat], zoom, offset: [0, -(card.offsetHeight / 2)], duration: 650, essential: true });
  });
}

function notice(clockNow) {
  const n = col.querySelector('#mapnotice');
  if (!n) return;
  if (servicesOn(clockNow.ymd).size) { n.innerHTML = ''; return; }
  const resume = nextServiceDay(clockNow);
  const first = resume ? nextPulse(1, clockNow).find(p => p.ymd === resume) : null;
  n.innerHTML = html`<div class="callout">${icon('moon', 20)}<div><b>No service today · ${dayName(clockNow.ymd)}</b><div class="sub">${resume ? `Buses resume ${fmtDay(resume)}.` : ''}${first ? ` First departures from the ${D.hub.name} at ${clockText(first.min)}.` : ''}</div></div></div>`;
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
export function liveUpdate(app) {
  if (!map || !U) return;
  const seen = new Set();
  for (const b of live.buses) {
    seen.add(b.id);
    let m = busMarkers.get(b.id);
    if (!m) {
      const el = document.createElement('div');
      el.className = 'bus'; el.innerHTML = '<div class="bus-marker">' + ARROW + '</div>'; el.title = U.routes[b.ri].name + ' · bus ' + b.name;
      el.onclick = ev => { ev.stopPropagation(); selectBus(b.id, app); };
      m = { marker: new maplibregl.Marker({ element: el, rotationAlignment: 'map' }), el, ri: b.ri };
      busMarkers.set(b.id, m);
      m.marker.setLngLat([b.lon, b.lat]).addTo(map);
    } else glide(m, b.lon, b.lat);
    m.el.style.setProperty('--bus-color', U.routes[b.ri].color);
    m.marker.setRotation(b.course);
    m.ri = b.ri;
    m.el.classList.toggle('on', selectedBus === b.id);
    m.el.classList.toggle('dim', hiLoops.length > 0 && !hiLoops.includes(U.routes[b.ri].id));
  }
  for (const [id, m] of busMarkers) if (!seen.has(id)) { if (m.anim) cancelAnimationFrame(m.anim); m.marker.remove(); busMarkers.delete(id); }
  if (selectedBus) { if (live.buses.some(b => b.id === selectedBus)) busCard(app); else { selectedBus = null; hiLoops = []; applySelection(); col.querySelector('#mapcard').classList.remove('open'); } }
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
function selectBus(id, app) {
  const b = live.buses.find(x => x.id === id);
  selectedBus = id; selectedU = null; selected = null; uHilite = ''; hiLines = []; hiLoops = b ? [U.routes[b.ri].id] : []; applySelection();
  for (const [bid, m] of busMarkers) m.el.classList.toggle('on', bid === id);
  busCard(app);
}
function busCard(app) {
  const b = live.buses.find(x => x.id === selectedBus);
  if (!b) return;
  const r = U.routes[b.ri];
  const next = r.shape.length ? busNext(b, 4) : [];
  const card = col.querySelector('#mapcard');
  card.innerHTML = html`<div class="grip"></div><div class="head buscard">
    <div class="top"><span class="eyebrow">Bus ${b.name} · heading ${heading(b.course)}</span>${isStale() ? liveTag('Last seen ' + lastSeen()) : liveTag()}</div>
    <div class="who">${chip(b.ri, 32)}<span class="name">${r.name}</span></div>
    ${b.cap ? html`<div class="load">${meter(b, true)}<span>${loadWords(b)}</span></div>` : ''}
    ${hours(b.ri) ? html`<div class="hours">${icon('clock', 15)}<span>${untilWords(b.ri) ? html`<b>${untilWords(b.ri).replace(/^./, c => c.toUpperCase())}</b> · ` : ''}usually ${hours(b.ri)}</span></div>` : ''}${offNote([b.ri])}</div>
    ${next.length ? html`<div class="nextstops"><i class="line" style="background:${r.color}"></i>${next.map((n, i) => html`<a class="ns${n.here && i === 0 ? ' here' : ''}" href="#/usu/${U.stops[n.si].id}"><span class="dot"><i style="${n.here && i === 0 ? 'background:' + r.color : ''}"></i></span><span class="nm">${U.stops[n.si].name}</span><span class="when">${n.here && i === 0 ? 'here now' : isStale() ? '' : 'about ' + Math.max(1, n.min) + ' min'}</span></a>`)}</div>` : ''}`;
  card.classList.remove('hidden');
  requestAnimationFrame(() => card.classList.add('open'));
}
function selectU(id, app) {
  const si = U.stopById[id];
  if (si === undefined) return;
  if (wide()) { location.hash = '#/usu/' + id; return; }
  selectedU = si; selectedBus = null; selected = null; uHilite = id; hiLines = []; hiLoops = U.stops[si].routes.map(ri => U.routes[ri].id); applySelection();
  for (const m of busMarkers.values()) m.el.classList.remove('on');
  const s = U.stops[si];
  uCard(app);
  const card = col.querySelector('#mapcard');
  map.easeTo({ center: [s.lon, s.lat], offset: [0, -(card.offsetHeight / 2)], duration: 650 });
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
    ${near.length ? near.map(({ i, d }) => stopRow(i, nextAt(i, 1, clockNow)[0], clockNow, { dist: metres(d) + ' away' })) : html`<div class="empty"><p>No stops within 4 km of there.</p></div>`}`;
  card.classList.remove('hidden');
  requestAnimationFrame(() => card.classList.add('open'));
  const key = 'at:' + at.lat.toFixed(4) + ',' + at.lon.toFixed(4);
  if (lastFocused !== key) map.easeTo({ center: [at.lon, at.lat], zoom: Math.max(map.getZoom(), 14.5), offset: [0, -(card.offsetHeight / 2)], duration: 700 });
  lastFocused = key;
}

/** Called by the router whenever the map is on screen. */
export async function show({ stopId, ustopId, routeShort, at, focus, hub, tick }, app, clockNow) {
  await init(app);
  requestAnimationFrame(() => map.resize());
  notice(clockNow);
  if (ready) refreshClosed(clockNow);
  if (app.geo) placeMe(app.geo);
  if (tick) return;   // the minute turning is no reason to move the map
  if (pinMarker && !at) { pinMarker.remove(); setSpot(null); }
  if (stopId || ustopId || routeShort || hub || at) { selectedBus = null; selectedU = null; }
  if (at) return showAt(at, app, clockNow);
  if (hub) {
    selected = null; uHilite = ''; hiLines = []; hiLoops = []; applySelection(); col.querySelector('#mapcard').classList.remove('open');
    if (lastFocused !== 'hub') map.easeTo({ center: [D.hub.lon, D.hub.lat], zoom: 16, duration: 700 });
    lastFocused = 'hub';
    return;
  }
  if (routeShort) {
    const ri = D.routeByShort[routeShort];
    if (ri === undefined) return;
    const changed = lastFocused !== 'r:' + ri;
    lastFocused = 'r:' + ri;
    selected = null; uHilite = ''; hiLines = [ri]; hiLoops = []; applySelection();
    col.querySelector('#mapcard').classList.remove('open');
    if (focus && changed) map.fitBounds(routeBounds(ri), { padding: 40, duration: 700, maxZoom: 15.5 });
    return;
  }
  if (stopId && app.route.name === 'map' && wide()) return asPage('#/stop/' + stopId);
  if (ustopId && app.route.name === 'map' && wide()) return asPage('#/usu/' + ustopId);
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
      else if (focus && changed && !map.isMoving()) map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 15), duration: 700 });
    }
  } else if (ustopId && U) {
    const si = U.stopById[ustopId];
    if (si === undefined) return;
    const s = U.stops[si];
    const changed = lastFocused !== 'u:' + ustopId;
    lastFocused = 'u:' + ustopId;
    selected = null; uHilite = ustopId; hiLines = []; hiLoops = s.routes.map(ri => U.routes[ri].id); applySelection();
    if (app.route.name === 'map') { if (changed) selectU(ustopId, app); else { selectedU = si; uCard(app); } }
    else if (focus && changed && !map.isMoving()) map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 15.5), duration: 700 });
  } else if (app.route && app.route.name === 'map') {
    lastFocused = null;
    select(null, app);
  }
}

/** The box around a route's stops, every direction. */
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
  const key = ri !== undefined ? 'r:' + ri : sel.ustopId ? 'u:' + sel.ustopId : sel.stopId;
  const s = ri !== undefined ? D.stops[(Object.values(D.routes[ri].stops || {})[0] || [])[0]] : sel.ustopId ? (U && U.stops[U.stopById[sel.ustopId]]) : D.stops[D.stopById[sel.stopId]];
  if (!s) return;
  if (!mmEl) {
    await loadTiles();
    if (!slot.isConnected) return;   // the page moved on while the tile index loaded
    mmEl = document.createElement('div'); mmEl.className = 'minimap';
    slot.prepend(mmEl);
    mm = new maplibregl.Map({ container: mmEl, style: style(false), center: [s.lon, s.lat], zoom: 16, minZoom: 10, maxZoom: 17.5, interactive: false, fadeDuration: 0, attributionControl: { compact: true } });
    squaresOnDemand(mm);
    mm.on('load', () => { mmReady = true; loadShapes(mm); miniSelection(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (mm && (dark() ? 'dark' : 'light') !== flavorName) { mmReady = false; mm.setStyle(style(false)); mm.once('style.load', () => { mmReady = true; loadShapes(mm); miniSelection(); }); } });
  } else if (mmEl.parentNode !== slot) {
    slot.prepend(mmEl);
    requestAnimationFrame(() => mm.resize());
  }
  if (mmKey !== key) {
    if (ri !== undefined) mm.fitBounds(routeBounds(ri), { padding: 24, duration: 0, maxZoom: 15.5 });
    else mm.jumpTo({ center: [s.lon, s.lat], zoom: 16 });
  }
  mmKey = key;
  miniSelection();
}
function miniSelection() {
  if (!mm || !mmReady || !mmSel) return;
  mm.setFilter('stop-selected', ['==', ['get', 'id'], mmSel.stopId || '']);
  mm.setFilter('usu-selected', ['==', ['get', 'id'], mmSel.ustopId || '']);
  const ri = mmSel.route !== undefined ? D.routeByShort[mmSel.route] : undefined;
  const si = mmSel.stopId ? D.stopById[mmSel.stopId] : undefined;
  const lines = ri !== undefined ? [ri] : si !== undefined ? [...D.stops[si].routes] : [];
  const loops = mmSel.ustopId && U ? U.stops[U.stopById[mmSel.ustopId]].routes.map(r => U.routes[r].id) : [];
  litLines(mm, lines, loops);
}
