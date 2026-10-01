// The map: self-hosted vector tiles, every stop in its routes' colour, the
// route lines, and a card for the stop you tap. Loaded only when first shown.
import * as maplibregl from '../../vendor/maplibre-gl.mjs';
import { layers, namedFlavor } from '../../vendor/basemaps.mjs';
import { D, BASE, nearest, stop, route, nextAt, timed, POOL, servicesOn, nextServiceDay, nextPulse, distance, stopAlerts, closedRoutes, activeAlerts, alertRoutes, timesOn, tripStops, tripEnd, nextTrip, tripRoute, onRequest, A, P as PLACES, O as OSM_PLACES, routeAlerts, routeOrder, runEnd, prevTrip, lastTripOn, runOf, dirName, family, familyKey, familyNow, maySkip, skipsAt, lastBuses, pref } from '../data.js';
import { now, relative, fmtDay, dayName, clock, clockText, metres, dayFrom } from '../time.js';
import { routeName, html, icon, timedMark, badge, badges, time, sched, corners, stopRow, isLoop, when, loopArrival, liveMark, headsign, lively, fillLater, routeBadgeLink, heard } from '../ui.js';
import { nearMe, morph } from '../main.js';
import { nearestTo, whereabouts, spotKey, spotOf, atPath, byWalk } from '../geo.js';
import { U, live, busNext, stopRowU, nearestUSU, chip, meter, liveTag, heading, loadWords, isStale, lastSeen, offNote, hours, untilWords } from '../usu.js';
import { rt, findBus, busOn, busStops, nextStopOf, lateWords, heldAt, busDelay, rtStale, rtSeen, predict } from '../rt.js';
import { bays, hubSheet, mount as hubMount } from './hub.js';
import { results as searchResults, forMap, placeRows } from './find.js';
import { WIDE_MQ, isWide } from '../wide.js';
import { openShare, siteLink } from '../share.js';
import { lightInks } from '../ink.js';
import { placeStar, openSave } from '../places.js';

// Aerial imagery, for the option: USGS's public-domain mosaic (NAIP over the valley), ends at zoom 16.
const SAT = { tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'], maxzoom: 16, attribution: 'Imagery <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS</a>' };
let sat = false;   // aerial imagery: a tap each visit, never remembered
const satOn = () => sat;
const coarse = () => matchMedia('(pointer: coarse)').matches;
const wide = isWide;
/** So wide a stop's page takes the whole screen, map and all: a tap on the map shows its card instead. */
/** A stop link opened on the Map tab of a wide screen becomes its page, without a history entry to loop back into. */
const asPage = hash => location.replace(location.href.split('#')[0] + hash);

let focusRoute;   // the route whose page is open, its stops in its colour
let fitSize = '', map = null, ready = false, selected = null, uHilite = '', meMarker = null, pinMarker = null, flavorName = null, lastFocused = null;
const busMarkers = new Map();   // bus id → { marker, el }
let selectedBus = null, selectedU = null;
let pickFor = null;   // the stop directions are wanted to, while the map is asked where from
let pickTo = null;
let pickNow = false;  // beside a wide screen's directions page: a click is the other end, straight away, no card first    // the spot directions are wanted from, while the map is asked where to
let hiLines = [], hiLoops = [];   // Connect route indices and shuttle route ids whose lines are drawn on top
let runRoutes = [];   // the routes whose way on is drawn from a picked bus or stop: their buses stay bright, the rest dim
let runLoops = [];    // the shuttle loops whose way on is drawn, likewise
// The street map is one small file a tile, cut from OpenStreetMap by tools/tiles.py; tiles/tiles.json says how far it reaches.
let TILES = { minzoom: 10, maxzoom: 15, bounds: [-111.98, 41.58, -111.68, 42.16] };
const col = document.getElementById('mapcol');
/** A route's colour for the dark map: the darker ones (the greens of 9 and 11, the purples, 16's navy) mixed toward
 *  white just until they stand off the dark basemap; bright ones as they are. Badges keep the true colours. */
/** `k` of a colour over the rest of the paper: a line faded back by colour, not opacity, so two ways of a route
 *  up one road (12's, both sides of Main) don't add up to a brighter line than the rest. */
function mix(hex, paper, k) {
  const c = i => Math.round(parseInt(hex.slice(i, i + 2), 16) * k + parseInt(paper.slice(i, i + 2), 16) * (1 - k));
  return '#' + [1, 3, 5].map(i => c(i).toString(16).padStart(2, '0')).join('');
}
let darkOf = null;   // a Connect route's colour → its dark map shade, drawn apart where two are alike (data.js)
/** A route's line on the light map: pale ones sunk to show, and a pair that came out alike parted (ink.js). */
let lightOf = null;
function sinkLine(hex) {
  lightOf ??= lightInks(D.routes.map(r => ({ color: r.color })));
  return lightOf.get(hex.slice(1).toUpperCase()) || hex;
}
/** A route's colour as the map draws it: lifted on the dark map, sunk on the light. Badges keep the feed's own. */
const lineInk = hex => dark() ? lift(hex) : sinkLine(hex);
function lift(hex) {
  darkOf ??= new Map(D.routes.filter(r => r.dcolor).map(r => [r.color.toUpperCase(), '#' + r.dcolor]));
  const own = darkOf.get(hex.slice(1).toUpperCase());
  if (own) return own;
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const lum = v => { const [r, g, b] = v.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  let t = 0, v = c;
  while (lum(v) < 0.2 && t < 1) { t += 0.05; v = c.map(x => Math.round(x + (255 - x) * t)); }
  return '#' + v.map(x => x.toString(16).padStart(2, '0')).join('');
}
const dark = () => matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';

const QUIET = /^(roads_tunnels_|roads_bridges_\w+_casing$|roads_runway$|roads_taxiway$|roads_pier$|landuse_(runway|aerodrome|pier|beach|zoo|pedestrian)$|boundaries|places_(country|region)$|water_label_ocean$|earth_label_islands$|address_label$|roads_oneway$|pois$)/;
function style(sat = true) {
  const flavor = dark() ? 'dark' : 'light';
  flavorName = flavor;
  const col = flavor === 'dark' ? 'dcolor' : 'color';   // Connect's lines and stops: lifted on the dark map
  const f = namedFlavor(flavor);
  // The basemap, less what draws nothing in the valley (no tunnels, piers, beaches, zoo, airfield worth a layer; no
  // borders, country or ocean names) and what only clutters it (one-way arrows, house numbers, shops and churches):
  // the map is the buses', and a street's name is all a rider reads off it. Buildings come in half a zoom later.
  const base = layers('protomaps', f, { lang: 'en' }).filter(l => !QUIET.test(l.id)).map(l => l.id === 'buildings' ? { ...l, minzoom: 12.5 } : l)
    .flatMap(l => [l, ...with500(l)]);
  const st = {
    version: 8,
    // A paint change is there at once: MapLibre eased each over 300 ms, and the Center's washed streets coming back on
    // the Map tab read as an empty map for its first frames.
    transition: { duration: 0, delay: 0 },
    glyphs: BASE + 'vendor/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: BASE + 'vendor/basemaps-assets/sprites/' + flavor,
    sources: {
      protomaps: { type: 'vector', tiles: [BASE + 'tiles/{z}/{x}/{y}.pbf'], minzoom: TILES.minzoom, maxzoom: TILES.maxzoom, bounds: TILES.bounds, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' },
      stops: { type: 'geojson', data: stopsGeo() },
      lines: { type: 'geojson', data: drawn.lines || { type: 'FeatureCollection', features: [] } },
      lclosed: { type: 'geojson', data: drawn.closed || { type: 'FeatureCollection', features: [] } },
      trk: { type: 'geojson', data: trackedPaths() },   // the ways round the buses have been seen to take   // the stretches of route we can't vouch for
      spot: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      runs: { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } },   // the way on from a picked bus or stop, fading along itself
      ustops: { type: 'geojson', data: usuStopsGeo() },
      pool: { type: 'geojson', data: poolGeo() },
      places: { type: 'geojson', data: placesGeo() },
      ulines: { type: 'geojson', data: usuLinesGeo() },
    },
    layers: [
      ...base,
      { id: 'spot-fill', type: 'fill', source: 'spot', paint: { 'fill-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'fill-opacity': 0.18 } },
      { id: 'spot-edge', type: 'line', source: 'spot', paint: { 'line-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.8 } },
      // POOL's zone, a faint wash under everything else; its pickup points are rings under the stops, so a bus stop
      // that is one keeps its dot inside the ring.
      // No outline: the walk fades out, it doesn't stop at a line. Zoomed in to the streets it steps back, for its pickups.
      { id: 'pool-zone', type: 'fill', source: 'pool', filter: ['==', ['get', 'kind'], 'zone'], paint: { 'fill-color': '#007AB8', 'fill-antialias': false, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, flavor === 'dark' ? 0.08 : 0.065, 16.5, 0.025] } },
      { id: 'pool-stops', type: 'circle', source: 'pool', filter: ['==', ['get', 'kind'], 'stop'], minzoom: 12, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3.5, 15, 7, 17, 10], 'circle-color': ['case', ['get', 'closed'], '#8a8d91', '#007AB8'], 'circle-opacity': 0.15, 'circle-stroke-color': ['case', ['get', 'closed'], '#8a8d91', '#007AB8'], 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 15, 2, 17, 2.5] } },
      // A P in each, from the streets' zoom: a POOL pickup, not a bus stop, at a glance (the Blue Loop is blue too).
      { id: 'pool-p', type: 'symbol', source: 'pool', filter: ['==', ['get', 'kind'], 'stop'], minzoom: 14.5, layout: { 'text-field': 'P', 'text-font': ['Noto Sans Medium'], 'text-size': ['interpolate', ['linear'], ['zoom'], 14.5, 8, 17, 12], 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': ['case', ['get', 'closed'], '#8a8d91', '#007AB8'] } },
      { id: 'route-lines', type: 'line', source: 'lines', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', col], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, 3.5, 17, 6], 'line-opacity': 0.75 } },
      { id: 'route-on', type: 'line', source: 'lines', filter: ['in', ['get', 'route'], ['literal', []]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', col], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 6, 17, 10], 'line-opacity': 1 } },
      // A route under the pointer on a desktop (on the map, or its badge in the panel): drawn up, over the rest.
      { id: 'route-hover', type: 'line', source: 'lines', filter: ['in', ['get', 'route'], ['literal', []]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', col], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3.5, 14, 7, 17, 11], 'line-opacity': 1 } },
      // The way on from a picked bus or stop: bright there, fading smoothly as it goes, one line a strand with its own
      // gradient (a layer holds one gradient, so a strand a layer; a stop with three routes lights three). It was up to
      // 48 pieces a strand, each a step fainter: bands, and a seam at every bend where two pieces met. Several ways from
      // one stop run as strands side by side (`lane`, in widths), each a little narrower (`wf`).
      ...RUN_STRANDS.map((id, k) => ({ id, type: 'line', source: 'runs', filter: ['==', ['get', 'strand'], k], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-gradient': fadeRamp('#888888'), 'line-width': ['interpolate', ['linear'], ['zoom'], 11, ['*', 4, ['get', 'wf']], 14, ['*', 8, ['get', 'wf']], 17, ['*', 12, ['get', 'wf']]], 'line-offset': ['interpolate', ['linear'], ['zoom'], 11, ['*', 4, ['get', 'lane']], 14, ['*', 8, ['get', 'lane']], 17, ['*', 12, ['get', 'lane']]] } })),
      // A shuttle loop drawn stop to stop (no shape to follow): its way on dashed, as its line is.
      { id: 'runs-approx', type: 'line', source: 'runs', filter: ['all', ['to-boolean', ['get', 'approx']], ['!', ['to-boolean', ['get', 'arrow']]]], layout: { 'line-join': 'round', 'line-cap': 'butt' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, ['*', 4, ['get', 'wf']], 14, ['*', 8, ['get', 'wf']], 17, ['*', 12, ['get', 'wf']]], 'line-offset': ['interpolate', ['linear'], ['zoom'], 11, ['*', 4, ['get', 'lane']], 14, ['*', 8, ['get', 'lane']], 17, ['*', 12, ['get', 'lane']]], 'line-dasharray': [2, 1.2] } },
      // Which way a lit route goes, and a way on: small arrows along the line from the streets in, each in its line's
      // colour edged in the paper's. A lit route's sit a little to the right of the way they point, so two loops on one
      // street, or a route's out and back, show both ways side by side; a way on's ride its own strand. Never over a
      // stop's name or a time: placed after them, they give way, and they push nothing else aside.
      { id: 'route-arrows', type: 'symbol', source: 'lines', minzoom: 14, filter: ['in', ['get', 'route'], ['literal', []]], layout: { ...ARROWS, 'icon-image': ['concat', 'arw-', ['slice', ['get', col], 1], '-' + flavor[0]], 'icon-offset': [0, 3.5] } },
      { id: 'runs-arrows', type: 'symbol', source: 'runs', minzoom: 14, filter: ['to-boolean', ['get', 'arrow']], layout: { ...ARROWS, 'icon-image': ['concat', 'arw-', ['get', 'hex'], '-' + flavor[0]], 'icon-offset': ['interpolate', ['linear'], ['zoom'], 14, ['array', 'number', 2, ['get', 'o14']], 17, ['array', 'number', 2, ['get', 'o17']]] }, paint: { 'icon-opacity': ['get', 'op'] } },
      // A detour: between the served stops either side of a closed run, the line goes to dots over a paper casing.
      // Each dot wears a thin halo in the map's colour, so it reads even on its own route's other pass, while the
      // gaps still show whatever runs underneath. The halo is 1.7× the dot with the dash scaled to match, so they align.
      { id: 'trk-path', type: 'line', source: 'trk', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', col], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, 3, 17, 5], 'line-dasharray': [1.6, 1.2], 'line-opacity': ['get', 'sure'] } },
      { id: 'route-closed-halo', type: 'line', source: 'lclosed', layout: { 'line-cap': 'round' }, paint: { 'line-color': flavor === 'dark' ? '#101214' : '#f2f2f3', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.55, 14, 5.95, 17, 10.2], 'line-dasharray': [0, 2.2 / 1.7] } },
      { id: 'route-closed', type: 'line', source: 'lclosed', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', col], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, 3.5, 17, 6], 'line-dasharray': [0, 2.2], 'line-opacity': 0.9 } },
      // a stand-in line (stop to stop, no shape) is a faint thin sketch until its route is lit
      { id: 'usu-lines', type: 'line', source: 'ulines', minzoom: 12, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, ['case', ['get', 'approx'], 0.8, 1.2], 15, ['case', ['get', 'approx'], 1.4, 2.5], 17, ['case', ['get', 'approx'], 2, 4]], 'line-opacity': ['case', ['get', 'approx'], 0.35, 0.9], 'line-dasharray': [3, 1.5] } },
      { id: 'usu-line-on', type: 'line', source: 'ulines', filter: ['in', ['get', 'id'], ['literal', []]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 15, 5.5, 17, 9], 'line-opacity': 1 } },
      { id: 'usu-hover', type: 'line', source: 'ulines', filter: ['in', ['get', 'id'], ['literal', []]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3.5, 15, 6.5, 17, 10], 'line-opacity': 1 } },
      { id: 'usu-selected', type: 'circle', source: 'ustops', filter: ['==', ['get', 'id'], ''], paint: { 'circle-radius': 12, 'circle-opacity': 0, 'circle-stroke-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'circle-stroke-width': 3 } },
      { id: 'usu-stops', type: 'symbol', source: 'ustops', minzoom: 12.5, layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 12.5, 0.45, 15, 0.7, 17, 1], 'icon-allow-overlap': true }, paint: {} },
      { id: 'usu-labels', type: 'symbol', source: 'ustops', minzoom: 15.5, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': flavor === 'dark' ? '#eef0f2' : '#1d1f20', 'text-halo-color': flavor === 'dark' ? '#101214' : '#f2f2f3', 'text-halo-width': 1.2 } },
      // Stops from the streets in (z14); further out only the lit route's, in the layer after, so a stop is there because it was asked for.
      { id: 'stops', type: 'circle', source: 'stops', minzoom: 12, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5.5, 17, 8, 19, 11],
        // a closed stop is a hollow ring in its route's colour
        // an unannounced detour's stop: the same ring, a ? in it
        'circle-color': ['case', ['any', ['get', 'closed'], ['get', 'maybe']], flavor === 'dark' ? '#101214' : '#f2f2f3', ['get', col]],
        'circle-stroke-color': ['case', ['any', ['get', 'closed'], ['get', 'maybe']], ['get', col], flavor === 'dark' ? '#101214' : '#ffffff'],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, ['case', ['any', ['get', 'closed'], ['get', 'maybe']], 2.5, 1.5], 17, ['case', ['any', ['get', 'closed'], ['get', 'maybe']], 3.5, 1.5]],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 13, 1] } },
      // A stop the buses have been going round, the detour not announced: a question mark in its ring, its times kept.
      { id: 'stops-maybe', type: 'symbol', source: 'stops', minzoom: 13.5, filter: ['get', 'maybe'], layout: { 'text-field': '?', 'text-font': ['Noto Sans Medium'], 'text-size': ['interpolate', ['linear'], ['zoom'], 13.5, 9, 17, 14, 19, 18], 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': ['get', col] } },
      // A stop under the pointer in the panel (a row of the home page's lists): ringed, as a picked stop is, lighter.
      { id: 'stop-hover', type: 'circle', source: 'stops', filter: ['==', ['get', 'id'], ''], paint: { 'circle-radius': 10, 'circle-opacity': 0, 'circle-stroke-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'circle-stroke-width': 2.5 } },
      { id: 'stop-selected', type: 'circle', source: 'stops', filter: ['==', ['get', 'id'], ''], paint: { 'circle-radius': 11, 'circle-color': ['get', col], 'circle-stroke-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'circle-stroke-width': 3 } },
      { id: 'stop-labels', type: 'symbol', source: 'stops', minzoom: 15, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': flavor === 'dark' ? '#eef0f2' : '#1d1f20', 'text-halo-color': flavor === 'dark' ? '#101214' : '#f2f2f3', 'text-halo-width': 1.2 } },
    ],
  };
  // The places search knows (the pamphlet's, OpenStreetMap's), their names only, quiet, from the streets in: what's
  // here, without a menu. Placed just under the basemap's street names, so a street's name (the address grid) and a
  // stop's win where they'd meet, and a place fills the gaps between.
  const placeLabels = { id: 'place-labels', type: 'symbol', source: 'places', minzoom: 15, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 10.5, 'text-max-width': 8, 'text-padding': 4 }, paint: { 'text-color': flavor === 'dark' ? '#8d9095' : '#7a7c80', 'text-halo-color': flavor === 'dark' ? '#101214' : '#f2f2f3', 'text-halo-width': 1.2 } };
  const under = st.layers.findIndex(l => /^roads_labels/.test(l.id));
  st.layers.splice(under >= 0 ? under : st.layers.findIndex(l => l.id === 'spot-fill'), 0, placeLabels);
  const all = st.layers.find(l => l.id === 'stops'), { minzoom, ...lit } = all;
  st.layers.splice(st.layers.indexOf(all) + 1, 0, { ...lit, id: 'stops-lit', maxzoom: 12, filter: ['in', ['get', 'id'], ['literal', []]] });
  // The rider's nearest stops, out in the valley, where the near view is wider than stops are drawn: dot and name.
  st.layers.splice(st.layers.indexOf(all) + 2, 0, { ...lit, id: 'stops-near', maxzoom: 12, filter: ['in', ['get', 'id'], ['literal', []]] },
    { ...st.layers.find(l => l.id === 'stop-labels'), id: 'stops-near-labels', minzoom: 0, maxzoom: 15, filter: ['in', ['get', 'id'], ['literal', []]] });
  // A lit route's timed stops (its timepoints, where an early bus waits): a ring round the dot in the map's ink.
  st.layers.splice(st.layers.indexOf(all) + 2, 0, { id: 'stops-tp', type: 'circle', source: 'stops', filter: ['in', ['get', 'id'], ['literal', []]],
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 5, 14, 9, 17, 12.5, 19, 16], 'circle-opacity': 0, 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 15, 2], 'circle-stroke-color': flavor === 'dark' ? '#eef0f2' : '#1d1f20' } });
  return st;
}

/** A stop's state on the map: closed (a hollow ring) by the agency's notice, or only perhaps skipped (a '?') by an
 *  unannounced detour. */
function closedOrMaybe(s, i, ymd) {
  const closed = !!(A.byStop[s.id] && stopAlerts(i, ymd).length);
  return { closed, maybe: !closed && skipsAt(s.id).length > 0 };
}
function stopsGeo() {
  const ymd = now().ymd;
  return { type: 'FeatureCollection', features: D.stops.map((s, i) => ({ type: 'Feature', id: +s.id, properties: { id: s.id, name: s.name, by: s.hub ? '' : s.by || '', routes: s.routes, color: sinkLine('#' + route(s.routes[0]).color), dcolor: lift('#' + route(s.routes[0]).color), ...closedOrMaybe(s, i, ymd) }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })) };
}

/** The stretches of route between the served stops either side of each closed run, cut from the drawn shapes:
 *  the dotted lines to draw, and per shape the along-shape gaps where its solid line is left out, so a route
 *  sharing the road underneath still shows through the dots. */
function closedSegments(fc) {
  const ymd = now().ymd;
  const byRoute = {};   // route index → set of closed stop ids
  for (const a of activeAlerts(ymd)) for (const ri of a.ri || []) for (const id of a.stops || []) (byRoute[ri] ||= new Set()).add(id);
  const cuts = [];
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
        for (const cut of cutShape(shapes, from, to, seq.slice(i, j + 1).map(si => D.stops[si]))) cuts.push({ ...cut, ri: +ri, r });
      }
    }
  }
  // A road another route runs on as usual isn't closed to buses: where a closed stretch shares a road with another
  // route's solid line for a block or so, that stretch is vouched for, its dots dropped and its own line drawn solid
  // again. Two routes both closed on a road vouch for neither. A road merely crossed isn't shared.
  const gaps1 = {};
  for (const c of cuts) (gaps1[c.shape] ||= []).push([c.s0, c.s1]);
  const grid = cuts.length ? segmentGrid(openLines(fc, gaps1)) : null;
  const out = [], gaps = {};
  for (const c of cuts) {
    for (const [d0, d1] of unvouched(c, grid)) {
      out.push({ type: 'Feature', properties: { color: sinkLine('#' + c.r.color), dcolor: lift('#' + c.r.color), route: c.ri }, geometry: { type: 'LineString', coordinates: slice(c.walk, d0, d1) } });
      (gaps[c.shape] ||= []).push([(c.base + d0) % c.total, (c.base + d1) % c.total]);
    }
  }
  return { closed: { type: 'FeatureCollection', features: out }, gaps };
}
/** The parts of a closed stretch no other route's solid line runs along: [from, to] along its walk. Sampled every
 *  10 m; a sample within 15 m of another line is on a shared road, and a shared run of 50 m or more is vouched for
 *  (a crossing street is shorter); what's left under 40 m between two vouched runs goes too. `grid` holds the solid
 *  lines' segments by where they are (segmentGrid), so a sample is checked against the few segments near it, not
 *  every point of every line in the valley. */
const VOUCH = { STEP: 10, NEAR: 15, SHARE: 50, SCRAP: 40, CELL: 50 };
function unvouched(c, grid) {
  const { STEP, NEAR, SHARE, SCRAP, CELL } = VOUCH;
  const shared = p => (grid.get(Math.floor(p[0] * KX / CELL) + ',' + Math.floor(p[1] * KY / CELL)) || []).some(([r, ax, ay, bx, by]) => {
    if (r === c.ri) return false;
    const vx = (bx - ax) * KX, vy = (by - ay) * KY, px = (p[0] - ax) * KX, py = (p[1] - ay) * KY, L2 = vx * vx + vy * vy;
    const t = L2 ? Math.max(0, Math.min(1, (px * vx + py * vy) / L2)) : 0;
    return Math.hypot(px - t * vx, py - t * vy) <= NEAR;
  });
  // runs of the same verdict along the walk, its points found in one pass along it
  const runs = [], w = c.walk;
  let i = 1;
  for (let d = c.start; d <= c.end; d += STEP) {
    while (i < w.length && w[i][0] < d) i++;
    let p;
    if (i < w.length) { const [a, pa] = w[i - 1], [b, pb] = w[i], t = b === a ? 0 : (d - a) / (b - a); p = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t]; }
    else p = w[w.length - 1][1];
    const v = shared(p), last = runs[runs.length - 1];
    if (last && last.v === v) last.d1 = Math.min(d + STEP, c.end); else runs.push({ v, d0: d, d1: Math.min(d + STEP, c.end) });
  }
  for (const r of runs) if (r.v && r.d1 - r.d0 < SHARE) r.v = false;   // a crossing, not a shared road
  const keep = [];
  for (const r of runs) { const last = keep[keep.length - 1]; if (!r.v) { if (last && last[1] >= r.d0 - 0.01) last[1] = r.d1; else keep.push([r.d0, r.d1]); } }
  return keep.filter(([a, b], i) => b - a >= SCRAP || keep.length === 1 && runs.every(r => !r.v));
}
/** Every segment of the solid lines, filed under each grid cell it passes within NEAR of: [route, ax, ay, bx, by]. */
function segmentGrid(lines) {
  const { NEAR, CELL } = VOUCH, grid = new Map();
  for (const f of lines.features) {
    const r = f.properties.route, c = f.geometry.coordinates;
    for (let k = 1; k < c.length; k++) {
      const [ax, ay] = c[k - 1], [bx, by] = c[k], seg = [r, ax, ay, bx, by];
      const x0 = Math.floor((Math.min(ax, bx) * KX - NEAR) / CELL), x1 = Math.floor((Math.max(ax, bx) * KX + NEAR) / CELL);
      const y0 = Math.floor((Math.min(ay, by) * KY - NEAR) / CELL), y1 = Math.floor((Math.max(ay, by) * KY + NEAR) / CELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const key = x + ',' + y; const list = grid.get(key); if (list) list.push(seg); else grid.set(key, [seg]); }
    }
  }
  return grid;
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
function cutShape(shapes, from, to, closed, most = 6000) {
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
    if (best && best.len < most) cuts.push(trimWalk(f, best, from, to, closed));   // a walk longer than that is the wrong pass, not a detour
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
  return { coords: slice(walk, start, end), shape: f.properties.shape, s0: (f._cum[a] + start) % total, s1: (f._cum[a] + end) % total, walk, start, end, base: f._cum[a], total };
}
/** The passed stretches (passedRuns) cut from their route's shapes as the detours' are: the lines left open there,
 *  and each stretch drawn as its own feature, done (faded at the town's zoom). */
const stretchCuts = new Map();   // 'route:from:to' → its cuts
function passedSegments(fc) {
  const done = [], gaps = {};
  for (const [ri, a, b] of passedRuns()) {
    const k = ri + ':' + a + ':' + b;
    if (!stretchCuts.has(k)) {   // a stretch's shape never changes: cut once
      const shapes = fc.features.filter(f => f.properties.route === ri);
      const from = D.stops[a], to = D.stops[b];
      // between towns (16 to Preston) two stops can be kilometres apart: the walk allowed as long as their gap, thrice
      stretchCuts.set(k, cutShape(shapes, from, to, [from, to], Math.max(6000, 3 * distance(from.lat, from.lon, to.lat, to.lon)))
        .map(cut => ({ props: { ...shapes.find(f => f.properties.shape === cut.shape).properties, done: true }, coords: cut.coords, shape: cut.shape, s0: cut.s0, s1: cut.s1 })));
    }
    for (const cut of stretchCuts.get(k)) {
      done.push({ type: 'Feature', properties: cut.props, geometry: { type: 'LineString', coordinates: cut.coords } });
      (gaps[cut.shape] ||= []).push([cut.s0, cut.s1]);
    }
  }
  return { done, gaps };
}
/** The part of a walk between two distances along it, ends interpolated. */
function slice(walk, d0, d1) {
  const at = d => { for (let i = 1; i < walk.length; i++) if (walk[i][0] >= d) { const [a, pa] = walk[i - 1], [b, pb] = walk[i], t = b === a ? 0 : (d - a) / (b - a); return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t]; } return walk[walk.length - 1][1]; };
  return [at(d0), ...walk.filter(([d]) => d > d0 && d < d1).map(w => w[1]), at(d1)];
}

/** The named places as points: the pamphlet's, and OpenStreetMap's but where the pamphlet has the same place. */
function placesGeo() {
  const seen = PLACES.map(p => [p.name.toLowerCase(), p.lat, p.lon]);
  const dup = o => seen.some(([n, la, lo]) => n === o.name.toLowerCase() && distance(la, lo, o.lat, o.lon) < 200);
  return { type: 'FeatureCollection', features: [...PLACES, ...OSM_PLACES.filter(o => !dup(o))].map(p => ({ type: 'Feature', properties: { name: p.name }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) };
}
/** Whether POOL is running now: its hours that weekday (tools/pool.py, from Connect's POOL page), and only on a
 *  day the buses run (a holiday off for one is off for both). Said on a pickup's card, not drawn: greyed out of
 *  hours, the map would be no use for planning tomorrow's ride tonight. */
function poolRunning(c = now()) {
  if (!POOL || !POOL.week) return true;
  const span = POOL.week[(dayFrom(c.ymd).dow + 6) % 7];
  return !!span && c.min >= span[0] && c.min < span[1] && servicesOn(c.ymd).size > 0;
}
/** A pickup at the same place as a bus stop that's closed is closed too: the stop it is (Remix says), else a bus stop
 *  within 25 m, closed by a notice in force. */
function poolClosed(p) {
  const ymd = now().ymd;
  const si = p.stop !== null && p.stop !== undefined ? p.stop : D.stops.findIndex(b => distance(p.lat, p.lon, b.lat, b.lon) <= 25);
  return si >= 0 && !!A.byStop[D.stops[si].id] && stopAlerts(si, ymd).length > 0;
}
/** POOL's zone and pickup points as one collection; empty without the file. */
function poolGeo() {
  if (!POOL) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: [
    // Drawn as it covers on foot (tools/pool.py): tiers of the walk to a pickup, stacked, so the easy walk is the
    // deepest and the edge fades out where most riders stop walking. Remix's outline, a planning line, without them.
    ...(POOL.tiers ? POOL.tiers.map((t, i) => ({ type: 'Feature', properties: { kind: 'zone', outer: i === POOL.tiers.length - 1 }, geometry: { type: 'MultiPolygon', coordinates: t.area } }))
      : [{ type: 'Feature', properties: { kind: 'zone', outer: true }, geometry: POOL.area ? { type: 'MultiPolygon', coordinates: POOL.area } : { type: 'Polygon', coordinates: [POOL.zone] } }]),
    ...POOL.stops.map(s => ({ type: 'Feature', properties: { kind: 'stop', id: s.id, name: s.name, stop: s.stop === null || s.stop === undefined ? -1 : s.stop, closed: !!s.gone || poolClosed(s) }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })),
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
/** An arrow for a line, pointing along it (+x, as line placement lays an icon): a chevron in the line's colour edged
 *  in the paper's, drawn at twice the size for a sharp screen. Made on demand, one per colour and look. */
/** The way-on strands' layers, one each; and a strand's fade, full strength at its start to a trace at its end. */
const RUN_STRANDS = ['runs', 'runs-1', 'runs-2', 'runs-3', 'runs-4', 'runs-5', 'runs-6', 'runs-7'];
function fadeRamp(col) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(col.slice(i, i + 2), 16));
  return ['interpolate', ['linear'], ['line-progress'], 0, `rgba(${r},${g},${b},1)`, 1, `rgba(${r},${g},${b},0.08)`];
}
const ARROWS = { 'symbol-placement': 'line', 'symbol-spacing': 120, 'icon-rotation-alignment': 'map', 'icon-allow-overlap': false, 'icon-ignore-placement': true, 'icon-padding': 1 };
function arrowImage(hex, darkPaper) {
  const k = 2, n = 12 * k, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d', { willReadFrequently: true });   // read back at once: a canvas kept on the CPU, not the GPU's round trip
  g.scale(k, k); g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(4, 2.5); g.lineTo(8.5, 6); g.lineTo(4, 9.5);
  g.strokeStyle = darkPaper ? '#101214' : '#f2f2f3'; g.lineWidth = 4.6; g.stroke();
  g.strokeStyle = '#' + hex; g.lineWidth = 2; g.stroke();
  const im = g.getImageData(0, 0, n, n);
  return { width: n, height: n, data: im.data };
}
/** Every route's arrows made while the phone has a moment, not on the frame a route is first lit (a route page's first
 *  draw spent a fifth of a second on them): the same names the layers ask for, in this map's flavour. */
function makeArrows(m) {
  const d = dark();
  for (const r of D.routes) {
    const hex = (d ? lift('#' + r.color) : sinkLine('#' + r.color)).slice(1), id = 'arw-' + hex + '-' + (d ? 'd' : 'l');
    if (!m.hasImage(id)) m.addImage(id, arrowImage(hex, d), { pixelRatio: 2 });
  }
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
  ]).then(([j, x]) => { XINGS = x || {}; return { type: 'FeatureCollection', features: j.lines.map(l => { const raw = '#' + route(l.route).color, c = sinkLine(raw), dc = lift(raw); return { type: 'Feature', properties: { color: c, dcolor: dc, fade: mix(c, '#f2f2f3', 0.3), dfade: mix(dc, '#101214', 0.3), soft: mix(c, '#f2f2f3', 0.35), dsoft: mix(dc, '#101214', 0.35), gone: mix(c, '#f2f2f3', 0.3), dgone: mix(dc, '#101214', 0.3), route: l.route, shape: l.shape }, geometry: { type: 'LineString', coordinates: l.coords } }; }) }; })
    .catch(e => { console.warn('shapes', e); shapesFC = null; return null; });
  return shapesFC;
}
/** A way round on the map: its route lit, its card up, the way and its stops in view. */
let wantSeen = null;
function openSeen(u) {
  wantSeen = null;
  selected = null; uHilite = ''; hiLines = u.ri; hiLoops = []; focusRoute = u.ri.length === 1 ? u.ri[0] : undefined; applySelection();
  detourCard(u);
  const b = new maplibregl.LngLatBounds();
  for (const [la, lo] of u.d.way) b.extend([lo, la]);
  for (const id of [...u.gone, ...u.on]) { const t = D.stops[D.stopById[id]]; b.extend([t.lon, t.lat]); }
  frame(b, { maxZoom: 16.5, duration: 700 });
}
/** A way round's card: whose, how many buses went that way and by which streets, the stops they skipped and those
 *  they came past, and whether the agency has announced it; for an unannounced one, that it's ours. */
function detourCard(u) {
  const card = col.querySelector('#mapcard');
  const links = ids => ids.map(id => D.stops[D.stopById[id]]).map(t => html`<a href="#/stop/${t.id}">${t.name}</a>`).reduce((acc, x, i) => acc.concat(i ? [' · ', x] : [x]), []);
  const theirs = u.announced ? activeAlerts(now().ymd).filter(a => a.ri.some(ri => u.ri.includes(ri)) && (a.stops || []).some(id => u.gone.includes(id))) : [];
  card.innerHTML = html`<div class="grip"></div><div class="head"><span class="eyebrow">${u.announced ? 'Detour' : 'Unannounced detour'}</span><div class="dname">${badge(u.ri[0], 30)}<span>${u.who}</span></div></div>
    <div class="detourcard">
      <p><b>${lastBuses(u)} went this way</b>${u.by.length ? ', by ' + u.by.join(' and ') : ''}. The latest at ${u.last}.</p>
      ${u.gone.length ? html`<p class="muted">Skipped: ${links(u.gone)}</p>` : ''}
      ${u.on.length ? html`<p class="muted">Came past: ${links(u.on)}</p>` : ''}
      ${u.announced ? html`<p>${D.agency.brand} has announced it${theirs.length ? html`: <a href="#/about/alerts">${theirs[0].title}</a>` : ''}. The line shows the way its buses have been taking.</p>`
        : html`<p class="fine">Unannounced: seen from ${D.agency.brand}'s buses, not posted by ${D.agency.brand}. Times at skipped stops are kept until it is.</p>`}
    </div>`.s;
  card.scrollTop = 0;
  card.classList.remove('hidden', 'peek');
  card.classList.add('open');
}
/** The ways round the buses have been seen to take (data.js's A.seen, announced or not), along the streets, dashed
 *  in the route's colour, fainter while only two buses have gone that way. */
function trackedPaths() {
  return { type: 'FeatureCollection', features: (A.seen || []).flatMap(u => u.ri.slice(0, 1).map(ri => ({ type: 'Feature', properties: { color: sinkLine('#' + D.routes[ri].color), dcolor: lift('#' + D.routes[ri].color), sure: u.n >= 3 || u.announced ? 0.95 : 0.6, id: u.id }, geometry: { type: 'LineString', coordinates: u.d.way.map(([la, lo]) => [lo, la]) } }))) };
}
/** The route lines as last drawn: a restyle (light to dark, say) starts from them, so the routes never blink out
 *  while they're worked out again. */
const drawn = { lines: null, closed: null, key: null };
/** What the closed stops and dotted stretches are drawn from: the day and the detours in force, not when the alerts
 *  were fetched, so a refetch saying the same thing (every ten minutes, and the relay's just after launch) redraws
 *  nothing, and a detour whose day's buses are done is dropped when it is. */
function closedKeyOf(clockNow) {
  return clockNow.ymd + JSON.stringify(passedRuns(clockNow)) + JSON.stringify(activeAlerts(clockNow.ymd).map(a => [a.ri || [], a.stops || []])) + JSON.stringify((A.seen || []).map(u => [u.d.id, u.n, u.d.last, u.announced, u.d.way.length]));   // traced along the streets: redrawn
}
async function loadShapes(m = map) {
  const fc = await shapes();
  if (!fc || !m) return;
  // Worked out once for the detours as they stand: the map's first load, a restyle and the first page shown all ask.
  const key = closedKeyOf(now());
  if (drawn.key !== key) {
    const { closed, gaps } = closedSegments(fc);
    const { done, gaps: by } = passedSegments(fc);
    for (const [sh, g] of Object.entries(by)) (gaps[sh] ||= []).push(...g);
    drawn.lines = openLines(fc, gaps); drawn.lines.features.push(...done); drawn.closed = closed; drawn.key = key;
  }
  closedKey = key;
  if (m.getSource('lines')) m.getSource('lines').setData(drawn.lines);
  if (m.getSource('lclosed')) m.getSource('lclosed').setData(drawn.closed);
  if (m.getSource('trk')) m.getSource('trk').setData(trackedPaths());
  if (wantSeen && location.hash === '#/map/alert/' + wantSeen) { const u = (A.seen || []).find(x => x.id === wantSeen); if (u) openSeen(u); }
}
/** Alerts came or the day turned: redraw the hollow stops and the dotted stretches on both maps. */
let closedKey = null;
function refreshClosed(clockNow) {
  const key = closedKeyOf(clockNow);   // the last buses moving on fade the stretches behind them
  if (closedKey === key) return;
  closedKey = key;
  for (const m of [map]) if (m && m.getSource('stops')) { m.getSource('stops').setData(stopsGeo()); if (m.getSource('pool')) m.getSource('pool').setData(poolGeo()); loadShapes(m); }
}
let tilesLoaded = null;
function loadTiles() {
  if (!tilesLoaded) tilesLoaded = fetch(BASE + 'tiles/tiles.json').then(r => r.json()).then(t => { TILES = { ...TILES, ...t }; }).catch(() => { /* the defaults cover the valley */ });
  return tilesLoaded;
}
function squaresOnDemand(m) {
  m.on('styleimagemissing', e => {
    if (e.id.startsWith('usq-') && !m.hasImage(e.id)) m.addImage(e.id, squareImage('#' + e.id.slice(4)));
    const a = /^arw-([0-9a-f]{6})-([dl])$/i.exec(e.id);
    if (a && !m.hasImage(e.id)) m.addImage(e.id, arrowImage(a[1], a[2] === 'd'), { pixelRatio: 2 });
  });
}

/** The map made ready before it's asked for: the app's first page up, it's built out of sight (its style, sprites,
 *  glyphs, worker and the route lines), so the first tap on the Map or the Transit Center finds it drawn, not a beat
 *  and a half of loading. */
export function warm(app) { shapes(); init(app).catch(() => { /* made when it's asked for, then */ }); }

// Made once: a first page and the feed's first redraw both asked for it at once, and each made a map.
let initP = null, bornCam = null, homePending = true;
function init(app) { return initP ??= made(app).catch(e => { initP = null; throw e; }); }
async function made(app) {
  if (map) return;
  await loadTiles();
  col.innerHTML = '<div id="map"></div>' + chrome();
  const center = homeCentre();
  map = new maplibregl.Map({ container: 'map', style: style(), center, zoom: 13, minZoom: 8, maxZoom: 19, pitchWithRotate: false, touchPitch: false, attributionControl: false, transformConstrain: (c, z) => keepIn(c, z), trackResize: false,
    // Drawn at twice the screen's resolution at most: a phone's three times filled half again the pixels on every frame
    // of a zoom (15 frames a second to 25, at a quarter speed), for sharpness no one sees at arm's length. And within a
    // budget of pixels (inkRatio): a 12.9-inch tablet at twice is four phones' worth every frame.
    pixelRatio: inkRatio(document.getElementById('map')),
    // Tiles already built kept for coming back to (the Map tab and the Center, a zoom out and in again): a tile not
    // kept is built again, gray until it is. MapLibre keeps five screens' worth at most whatever the size says, some
    // 30 tiles on a phone, and the Center and the town at once overflowed it: twenty screens, up to the 120.
    maxTileCacheSize: 120, maxTileCacheZoomLevels: 20 });
  bornCam = { center, zoom: 13 };
  // Its box watched here, not by MapLibre: hidden (the Stops tab on a phone), the box is nothing, and MapLibre
  // shrank the canvas to nothing and grew it back on every tab tapped, reallocating its whole drawing buffer each
  // way, the costliest thing a tab did on a phone. A box of nothing is left be; a real change (turned, the update bar)
  // is fitted.
  new ResizeObserver(() => sized()).observe(map.getContainer());
  placeControls();
  WIDE.addEventListener('change', placeControls);
  squaresOnDemand(map);
  map.on('load', () => { ready = true; markNear(nearIds, nearBy); addUsuImages(); (window.requestIdleCallback || (f => setTimeout(f, 200)))(() => makeArrows(map), { timeout: 2000 }); loadShapes(); searchKey = null; searchMarks(wantMarks); applySelection(); if (app.geo) placeMe(app.geo); map.resize(); liveUpdate(app); busScale(); if (focusRoute !== undefined) routeTimesSoon(focusRoute, now()); });
  map.on('idle', () => (window.requestIdleCallback || (f => setTimeout(f, 200)))(warmViews, { timeout: 2000 }));
  map.on('zoom', busScale);
  map.on('move', quiet);
  map.on('moveend', northAgain);
  map.on('rotatestart', e => { if (e.originalEvent) { hubTurned = false; northDue = false; } });   // turned by the rider: theirs to keep
  // A desktop's pointer over a line: that route drawn up, its badges in the panel ringed. Looked up once a frame at most.
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    let at = null;
    // A place, not a line: every route on the road under the pointer lit, the ones a click there lists ('On this
    // road'). It was the one line drawn on top, flickering between five on Main Street.
    map.on('mousemove', e => { if (!at) requestAnimationFrame(() => { const p = at; at = null; if (!p || !ready) return; hover(linesNear(p, 8)); }); at = e.point; });
    map.getCanvas().addEventListener('mouseleave', () => hover());
  }
  map.on('mouseenter', 'usu-stops', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'usu-stops', () => map.getCanvas().style.cursor = '');
  map.on('mouseenter', 'pool-stops', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'pool-stops', () => map.getCanvas().style.cursor = '');
  setTimeout(() => sized(), 300);
  // A tap picks the nearest stop within a thumb's reach, so two stops that nearly touch are still separable.
  // On a touch screen the pick waits a beat: a second finger-down inside it is a double-tap or a
  // tap-and-drag zoom, not a stop, so the wait is dropped rather than a card opened.
  let tapTimer = 0, lastTap = 0, lastAt = null;
  const cancelTap = () => clearTimeout(tapTimer);
  map.on('touchstart', cancelTap); map.on('movestart', cancelTap); map.on('zoomstart', cancelTap);
  // A long press (a right click with a mouse) picks the spot under it: its nearest stops, and directions to or from
  // it. A finger that moves, or a second one, is a pan or a pinch, and picks nothing; the tap it ends in is swallowed.
  let pressTimer = 0, pressFrom = null, pressedAt = 0;
  const spotAt = e => {
    if (Date.now() - pressedAt < 800) return;   // Android sends a long press as a context menu too: once
    pressedAt = Date.now(); clearTimeout(tapTimer);
    const { lat, lng } = e.lngLat;
    if (JR) { location.hash = '#/map/' + atPath({ lat, lon: lng, label: whereabouts(lat, lng) }); return; }   // off the way, to the spot: Back comes back
    showAt({ lat, lon: lng, label: whereabouts(lat, lng) }, app, now(), pickFor, pickTo);
  };
  const unpress = () => { clearTimeout(pressTimer); pressFrom = null; };
  map.on('touchstart', e => { unpress(); if (e.originalEvent.touches.length !== 1) return; pressFrom = e.point; pressTimer = setTimeout(() => { pressFrom = null; spotAt(e); }, 550); });
  map.on('touchmove', e => { if (pressFrom && Math.hypot(e.point.x - pressFrom.x, e.point.y - pressFrom.y) > 10) unpress(); });
  map.on('touchend', unpress); map.on('touchcancel', unpress);
  map.on('contextmenu', e => { e.originalEvent.preventDefault(); unpress(); spotAt(e); });
  map.on('click', e => {
    if (Date.now() - pressedAt < 800) return;   // the lift of a long press
    // A tap on the map with search results open puts them away, the keyboard too, and picks nothing.
    // The words stay in the box: a tap back into it brings the results back.
    const res = col.querySelector('#mapresults');
    if (!res.classList.contains('hidden')) { res.classList.add('hidden'); document.activeElement?.blur(); return; }
    if (!coarse()) return pick(e);
    // The second tap of a double tap (MapLibre's own window: 500 ms, 30 px) is MapLibre's zoom about the finger: it
    // picks nothing, or its pick would ease to a stop and cut the zoom short.
    const t = Date.now(), again = t - lastTap < 500 && lastAt && Math.hypot(e.point.x - lastAt.x, e.point.y - lastAt.y) < 30;
    lastTap = again ? 0 : t; lastAt = e.point;
    clearTimeout(tapTimer);
    if (!again) tapTimer = setTimeout(() => pick(e), 300);
  });
  const pick = e => {
    // Beside the board on a wide screen, the Center's own view: a click on it leaves the board up and the map where it
    // is (a route picked from a badge put away, the board as it was). The board is the page there, not a card over it.
    if (wide() && hubOn && /^#\/hub/.test(location.hash)) { if (/^#\/hub\/./.test(location.hash)) location.replace(location.href.split('#')[0] + '#/hub'); return; }
    const r = coarse() ? 22 : 8;
    const all = map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ['stops', 'stops-lit', 'stops-near', 'usu-stops', 'pool-stops', 'place-labels'].filter(id => map.getLayoutProperty(id, 'visibility') !== 'none') });
    const hits = all.filter(f => f.layer.id !== 'place-labels');
    // Beside the directions page, a click is the other end: a stop that stop, a place's name that place, anywhere else
    // that spot, a way drawn or not. A stop of the way drawn is still that stop, though: its page, as on a phone.
    const ofWay = JR && hits.some(f => f.layer.id.startsWith('stops') ? JR.stops.includes(f.properties.id) : f.layer.id === 'usu-stops' && JR.ustops.includes(f.properties.id));
    if (pickNow && (pickFor || pickTo) && !ofWay) {
      const near = f => { const q = map.project(f.geometry.coordinates); return Math.hypot(q.x - e.point.x, q.y - e.point.y); };
      const st = hits.filter(f => f.layer.id.startsWith('stops')).sort((a, b) => near(a) - near(b))[0];
      const pl = !st && all.filter(f => !f.layer.id.startsWith('stops') && f.layer.id !== 'pool-stops').sort((a, b) => near(a) - near(b))[0];
      const at = pl ? { lat: pl.geometry.coordinates[1], lon: pl.geometry.coordinates[0], label: pl.properties.name } : { lat: e.lngLat.lat, lon: e.lngLat.lng, label: whereabouts(e.lngLat.lat, e.lngLat.lng) };
      location.hash = pickFor ? `#/go/${pickFor}/${st ? st.properties.id : atPath(at)}` : `#/go/${st ? st.properties.id : spotKey(at.lat, at.lon, at.label)}/${atPath(spotOf(pickTo))}`;
      return;
    }
    // A way drawn: one of its stops tapped is that stop, as anywhere (Back comes to the way again); nothing else.
    if (JR) {
      const st = hits.map(f => { const q = map.project(f.geometry.coordinates); return { f, d: Math.hypot(q.x - e.point.x, q.y - e.point.y) }; }).sort((a, b) => a.d - b.d)[0];
      if (st) location.hash = st.f.layer.id === 'usu-stops' ? (wide() ? '#/usu/' : '#/map/usu/') + st.f.properties.id : (wide() ? '#/stop/' : '#/map/') + st.f.properties.id;
      return;
    }
    // A place's name tapped, and no stop there: its spot, with the stops nearest it, as a search result opens it.
    if (!hits.length && all.length) {
      const f = all.map(f => { const q = map.project(f.geometry.coordinates); return { f, d: Math.hypot(q.x - e.point.x, q.y - e.point.y) }; }).sort((a, b) => a.d - b.d)[0].f, [lon, lat] = f.geometry.coordinates;
      showAt({ lat, lon, label: f.properties.name }, app, now(), pickFor, pickTo);
      return;
    }
    // Asked where the rider will start from: a stop tapped is the start; anywhere else, that spot, with the stops
    // nearest it, and the directions a tap away.
    if (pickFor || pickTo) {
      const st = hits.find(f => f.layer.id.startsWith('stops'));
      if (st) { location.hash = pickFor ? `#/go/${pickFor}/${st.properties.id}` : `#/go/${st.properties.id}/${atPath(spotOf(pickTo))}`; return; }
      const { lat, lng } = e.lngLat;
      showAt({ lat, lon: lng, label: whereabouts(lat, lng) }, app, now(), pickFor, pickTo);
      return;
    }
    if (hits.length) {
      // A bus stop before a POOL ring at the same pole: the stop's card says it's a pickup too.
      const rank = f => f.layer.id === 'pool-stops' ? 1 : 0;
      const best = hits.map(f => { const p = map.project(f.geometry.coordinates); return { f, d: Math.hypot(p.x - e.point.x, p.y - e.point.y) + rank(f) * 6 }; }).sort((a, b) => a.d - b.d)[0].f;
      // The stop already picked, tapped again: closer in.
      if (best.layer.id.startsWith('stops')) select(best.properties.id, app, true, best.properties.id === selected ? 'closer' : false);
      else if (best.layer.id === 'pool-stops') { if (best.properties.stop >= 0) select(stop(best.properties.stop).id, app, true); else selectPool(best.properties.id, app); }
      else selectU(best.properties.id, app, best.properties.id === uHilite || U.stopById[best.properties.id] === selectedU);
      return;
    }
    // A way round the buses have been taking (dashed): its card, what's known of it.
    const way = map.getLayer('trk-path') && map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ['trk-path'] })[0];
    if (way) { location.hash = '#/map/alert/' + way.properties.id; return; }
    // No stop there, but a route's line: that route lit up with its times, where the map is. Where several share the
    // road, the card asks which.
    // A route the timetable splits by time of day (16 AM and PM) is one route here: the half on the road now or next.
    const ris = [...new Map(linesNear(e.point, r).rs.map(ri => [familyKey(ri), ri])).values()].map(ri => focusRoute !== undefined && familyKey(ri) === familyKey(focusRoute) ? focusRoute : familyNow(ri, now()));   // the half up stays up
    const card = col.querySelector('#mapcard'), cardOpen = card.classList.contains('open');
    // A route up on the Map tab, its sheet (or a card over it) open: a tap on nothing puts the card away and leaves the
    // route lit; the next tap puts the route away.
    if (!ris.length && cardOpen && app.route.name === 'map' && focusRoute !== undefined && /^#\/map\/route\//.test(location.hash)) {
      card.classList.remove('open', 'peek');
      if (selectedBus) { selectedBus = null; hiLines = [focusRoute]; applySelection(); routeTimesSoon(focusRoute, now()); }
      return;
    }
    // Another route's line tapped with one up on the Map tab: that one put away first; a tap on the line then picks it.
    // The same beside a wide screen's panel, the route its page there (app.route 'route'): a tablet's tap, wider than a
    // mouse's, caught a road there and opened its stops over the route.
    const routeUp = (app.route.name === 'map' || app.route.name === 'route') && focusRoute !== undefined && /^#\/map\/route\//.test(location.hash);
    if (ris.length && !ris.some(ri => focusRoute !== undefined && familyKey(ri) === familyKey(focusRoute)) && routeUp) {
      card.classList.remove('open', 'peek'); location.hash = '#/map'; return;
    }
    selectedBus = null; selectedU = null; select(null, app);
    // The route up, its own line tapped: the whole of it again, its sheet back.
    if (ris.length && focusRoute !== undefined && ris.some(ri => familyKey(ri) === familyKey(focusRoute)) && /^#\/map\/route\//.test(location.hash)) pickRoute(focusRoute, app);
    // A road tapped is a place, as a long press is: its card, with the stops along that road a short walk off, both
    // sides, nearest first, each with its next bus and where it's going, and a badge a route for anyone who wants its
    // line. A road with one route lights it too, as a tap on it always has. (It was a chooser of routes: a menu that
    // only someone who already knew the system could pick from.)
    else if (ris.length) { const { lat, lng } = e.lngLat; showAt({ lat, lon: lng, label: whereabouts(lat, lng) }, app, now(), null, null, ris); }
    // Only the shuttle's line there: that spot, with its stops a walk off, as a road of Connect's gets.
    else if (map.getLayoutProperty('usu-lines', 'visibility') !== 'none' && map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ['usu-lines'] }).length) { const { lat, lng } = e.lngLat; showAt({ lat, lon: lng, label: whereabouts(lat, lng) }, app, now()); }
    // Nothing there at all: a route picked on the Map tab is put away, as a tap off a stop puts the stop away.
    else if (routeUp) location.hash = '#/map';
    // At the Center, a route picked from its badge: put away as well, the board back as it was. Nothing picked there,
    // the board is put away for the map itself on a phone: the Map tab, the map where it is, turned north (as its
    // north button). Beside it on a wide screen, the board stays.
    else if (/^#\/hub\/./.test(location.hash)) location.replace(location.href.split('#')[0] + '#/hub');
    else if (/^#\/hub(\?|$)/.test(location.hash) && !wide()) leaveHubKept();
  };
  for (const id of ['stops', 'stops-lit', 'stops-near']) { map.on('mouseenter', id, () => map.getCanvas().style.cursor = 'pointer'); map.on('mouseleave', id, () => map.getCanvas().style.cursor = ''); }
  // The look changed (the toggle, or the phone's while following it): the basemap follows without a reload.
  let bigFlavor = flavorName;   // its own, as the stop page's small map keeps its
  window.addEventListener('themechange', () => { const f = dark() ? 'dark' : 'light'; if (f !== bigFlavor) { bigFlavor = f; ready = false; map.setStyle(style(), { diff: false }); map.once('style.load', () => { ready = true; (window.requestIdleCallback || (f => setTimeout(f, 200)))(() => makeArrows(map), { timeout: 2000 }); paperKept = null; labelsHeard = false; searchKey = null; runsKey = null; searchMarks(wantMarks); if (hubOn) { hubOn = false; for (const m of hubMarks.values()) m.marker.remove(); hubMarks.clear(); } loadShapes(); applySelection(); showSat(sat); markNear(nearIds, nearBy); if (MT.R) { MT.key = null; drawRun(MT); } if (JR) { jrKey = null; window.dispatchEvent(new HashChangeEvent('hashchange')); } }); } });
  wireChrome(app);
  wireGrip(app);
}

/** A route picked on the map itself: its address, so Back puts it away; lit where the map is, not fitted as a route
 *  opened from elsewhere is. Picked again: the map goes out to the whole of it, and a phone's sheet comes back up. */
let stayRoute = false;
function pickRoute(ri, app) {
  const h = '#/map/route/' + encodeURIComponent(D.routes[ri].short);
  if (location.hash === h || location.hash.startsWith(h + '/') || location.hash.startsWith(h + '?')) {
    // A bus ringed on it (?bus=): the route itself now, the address too, and the bus let go.
    if (location.hash.includes('?')) location.hash = location.hash.split('?')[0];
    frame(routeBounds(ri), { maxZoom: 15.5, duration: 700 });
    const card = col.querySelector('#mapcard');
    if (!wide() && card.querySelector(':scope > .routesheet')) { card.classList.remove('peek'); card.classList.add('open'); }
    return;
  }
  stayRoute = true; location.hash = h;
}
// ---- a route: the map with the route lit and its times, and its stops in order as the map's card (a phone's) or
// beside it (a wide screen's panel), each with the route's next call there. Once the route page; now the map's.

/** The route's sheet: which way, its last run, its stops still to come today with its buses among them, and where
 *  the bus goes on. `short`/`dir`: the route and way; `at`: the stop it was opened from (a badge), its answer first
 *  and its row marked; `full`: the whole route, done parts and all. Markup, the row to land on, and the title. */
function routeSheet({ short, dir, at, full, bus }, clockNow) {
  const ri = D.routeByShort[short];
  if (ri === undefined) return null;
  const r = route(ri);
  const dirs = Object.keys(r.stops || {});
  const d = dirs.includes(dir) ? dir : dirs[0];
  const base = '#/map/route/' + encodeURIComponent(short);
  // Each way by where it goes ('to Preston', 'to Transit Center') when that tells them apart; else the feed's words.
  const names = dirs.map(k => { const n = dirName(ri, k); return n && !n.places ? 'to ' + n.text : ''; });
  const apart = dirs.length > 1 && names.every(Boolean) && new Set(names).size === names.length;
  const dirWord = apart ? ' ' + names[dirs.indexOf(d)] : '';   // ' to Preston', for the notes that speak of this way
  const seq = routeOrder(ri, d);
  const here = at !== undefined ? D.stopById[at] : undefined;   // from a stop's badge: that stop, marked, in view
  // Where its buses are: a row for each, just before the stop it calls at next.
  const buses = rtStale() ? [] : rt.buses.filter(b => b.ri === ri && (b.dir === null || String(b.dir) === d));
  const busBefore = new Map();
  for (const b of buses) { const n = nextStopOf(b); if (n !== undefined && seq.includes(n)) busBefore.set(n, [...(busBefore.get(n) || []), b]); }
  // Before the first run has left, the morning's word; the evening's once it's near (the first run the last too, a
  // peak route's only one, that says the more).
  const first = firstRunNote(ri, d, clockNow, dirWord), lt = first && lastTripOn(ri, clockNow.ymd, d);
  const last = first && lt && lt.trip !== first.f.trip ? null : lastRun(ri, d, seq, clockNow, dirWord);
  // Each stop with its next call. Late in the day most of a route is done, its next calls tomorrow's: the stops a bus
  // still has to reach today come first, and the whole route, the next day's times and all, is behind a button.
  const each = seq.map(si => {
    const bus = (busBefore.get(si) || []).map(b => busRow(b, ri));
    // A stop the route's detour skips: say so, rather than the first bus after the detour's end, days off.
    if (closedRoutes(si, clockNow.ymd).has(ri)) return { si, today: false, closed: true, bus, row: routeRow(si, ri, null, clockNow, { none: 'detour', warn: true, here: si === here }) };
    const n = nextAt(si, 1, clockNow, 8, t => t.r === ri)[0];
    return { si, today: !!n && n.day === 0, bus, row: routeRow(si, ri, n, clockNow, { none: 'not today', here: si === here }) };
  });
  const onward = follow(ri, seq, buses, clockNow);
  const coming = each.filter(x => x.today);
  const whole = full || !coming.length || coming.length === each.length || (here !== undefined && !coming.some(x => x.si === here));
  // The whole route, once some of it is done for the day: tonight's stops first, then a break, then the stops whose
  // next bus is the next day's, each part in route order. A stop a detour skips stays with tonight's.
  const split = whole && coming.length > 0 && coming.length < each.length;
  const done = whole && !coming.length && timesOn(seq[0], clockNow.ymd).some(t => t.r === ri);   // ran today, now finished
  const top = split ? each.filter(x => x.today || x.closed) : !whole ? coming : done ? [] : each;
  const rest = split ? each.filter(x => !x.today && !x.closed) : done ? each : [];
  const rowsOf = xs => xs.flatMap(x => [...x.bus, x.row]);
  // The last run's final stop, which the timetable leaves out (nobody boards there): where the bus ends its day.
  // An out-and-back's far end isn't an end: the bus turns round there and its way back is the other list.
  const other = dirs.length > 1 ? dirs.find(k => k !== d) : null;
  const endRow = last && last.out && last.turnSi !== null && other !== null && (top.length || !whole) ? html`<a class="croute endstop" href="${base}/${other}"><span class="c-t">${icon('swap', 16)}</span><span class="c-n">${stop(last.turnSi).name}<small>Turns round here · back${last.endSi !== null && stop(last.endSi).hub ? ' to the ' + D.hub.name : ''} about ${clockText(last.endMin)}</small></span><span class="c-r">${icon('fwd', 18)}</span></a>`
    : last && last.out && last.endSi !== null && (top.length || !whole) ? html`<div class="croute endstop"><span class="c-t">${last.endAt !== null ? time(last.endAt, 17, true) : ''}</span><span class="c-n">${stop(last.endSi).hub ? D.hub.name : stop(last.endSi).name}<small>Ends here · drop-off only${stop(last.endSi).hub ? ' · ' + stop(last.endSi).name : ''}</small></span></div>` : '';
  // Before the day's first run, where it starts partway along (6 at 100 North 600 West, not the Transit Center): the
  // list starts where it does, marked, and the stops before it, whose first bus is the run after, come after.
  const k = first && !last ? seq.indexOf(first.f.si) : -1, morning = k > 0 && !done;
  const rows = morning ? [html`<div class="endservice firstrun"><span>First run starts here · ${clockText(first.f.min)}</span></div>`, ...rowsOf(each.slice(k)),
      html`<div class="endservice firstrun"><span>Then from ${stop(seq[0]).hub ? 'the ' + D.hub.name : stop(seq[0]).name}</span></div>`, ...rowsOf(each.slice(0, k))]
    : [...rowsOf(top), endRow, ...(rest.length ? [html`<div class="endservice"><span>End of service today</span></div>`, ...rowsOf(rest)] : [])];
  const count = !whole ? `${coming.length} of ${seq.length} stops left` : split ? `${seq.length} stops · tonight's first` : `${seq.length} stops, in order`;
  // The head is what a swiped-down sheet keeps: the route, and which way with how much of it is left.
  const chipsRow = html`<div class="rs-ways">${dirs.length > 1 ? dirs.map((k, i) => html`<a class="chip${k === d ? ' on' : ''}" href="${base}/${k}">${apart ? names[i] : r.dirs[+k] || (k === '0' ? 'Outbound' : 'Return')}</a>`) : ''}<span class="rs-count">${count}</span></div>`;
  // The route's other half (16 PM from 16 AM), a tap away, with when it next leaves today: one route to a rider.
  const also = family(ri).filter(x => x !== ri).map(x => {
    const next = Object.keys(D.routes[x].stops || {}).flatMap(k => runsOn(x, clockNow.ymd, k)).filter(t => t.min > clockNow.min).sort((p, q) => p.min - q.min)[0];
    const lt = next ? null : lastTripOn(x, clockNow.ymd), out = lt && lt.start[0] <= clockNow.min && lt.end[0] >= clockNow.min;
    return html`<a class="rs-also" href="#/map/route/${encodeURIComponent(D.routes[x].short)}">${badge(x, 22)}<span class="rs-also-t">Also ${routeName(x, false)}${next ? ` · next run ${clockText(next.min)}` : out ? ' · its last run on the road now' : ' · no more runs today'}</span>${icon('fwd', 16)}</a>`;
  });
  const head = html`<div class="head routehead"><div class="rs-name">${badge(ri, 36)}<div class="mid"><span class="name">${routeName(ri, false)}</span>${r.desc ? html`<span class="sub">${r.desc.replace(/^.*? - /, '').replace(/,\s*/g, ' · ')}</span>` : ''}</div></div>${also}${chipsRow}</div>`;
  // Alerts folded to their titles: the line on the map already shows where; the words are a tap away.
  const alerts = routeAlerts(ri, clockNow.ymd).map(a => html`<details class="callout alert rs-alert"><summary>${icon('ban', 20)}<b>${a.title}</b><span class="more">More</span></summary><div class="sub">${a.text}${a.url ? html` <a href="${a.url}" target="_blank" rel="noopener">More</a>` : ''}</div></details>`);
  // Come from a stop's badge: the answer for that stop first, so the list below is for those who want the route.
  const yours = here !== undefined && seq.includes(here) ? yourStop(ri, here, seq, buses, clockNow) : '';
  const body = html`<div class="routesheet">${alerts}${yours}${last ? last.note : first ? first.note : ''}${onward.now || ''}<div class="list rs-list">${rows}</div>${onward.later || ''}
    ${!whole ? html`<div class="rs-all"><a class="btn btn-secondary btn-block" href="${base}/${d}?all=1">The whole route · all ${seq.length} stops</a></div>` : ''}</div>`;
  // Opened from a stop, the list lands on that stop; for a bus (its row, its card's route link), on the bus. Else at
  // the top: the stops still to come start there.
  const anchor = here !== undefined ? 'here' : bus && buses.some(b => b.id === bus) ? busAnchor(bus) : null;
  return { head, body, anchor, title: isLoop(ri) ? r.long : 'Route ' + r.short, ri };
}

/** One stop on a route's list: the route's next call there, the stop with the other routes that call (a change)
 *  under it, and how long, with whose minute it is. A tap opens the stop. */
function routeRow(si, ri, next0, clockNow, opts = {}) {
  const s = stop(si), t = next0 ? lively(next0) : null;
  const town = s.town && s.town !== 'Logan' ? html`<span class="town">, ${s.town}</span>` : '';
  const others = s.routes.filter(x => x !== ri);
  const rel = !t ? html`<span class="${opts.warn ? 'warnmark' : ''}">${opts.none}</span>` : loopArrival(t) ? '' : relative(t, clockNow);
  // Whose minute it is, as the stop page says it: a live estimate with the timetable's struck above it and Live (or
  // Estimated, from the bus's place); a timetable time, Scheduled.
  const mark = !t ? '' : t.live ? liveMark(t.live.est ? 'Estimated' : 'Live') : sched(t);
  const tp = timed(si, ri);
  return html`<a class="croute${opts.here ? ' here' : ''}${tp ? ' tp' : ''}"${opts.here ? html.raw(' id="here"') : ''} href="#/stop/${s.id}"><span class="c-t">${!t ? '—' : when(t, 17)}</span><span class="c-n">${heard(si, s.town && s.town !== 'Logan' ? ', ' + s.town : '')}${tp ? timedMark() : ''}${maySkip(s.id, ri) ? html.raw('<span class="qmark" title="May be skipped: unannounced detour">?</span>') : ''}${others.length ? html`<span class="c-b">${badges(others, 20)}</span>` : ''}</span><span class="c-r"><span>${rel}</span>${mark}</span></a>`;
}

// ---- staying on the bus. A bus swaps routes at the Transit Center all day (9 and 1 on a Saturday): its next
// trip is where a rider who stays on goes. Ahead of the Transit Center those stops are dimmed, still to come; once
// the bus is past it they're what it's doing, and bright.

/** The trip a bus runs next: the feed's word when it has given the bus its next trip (a dispatcher's swap), else
 *  the timetable's block. */
function nextOf(b, ti, clockNow) {
  const vid = b.id.slice(2), nowS = Date.now() / 1000, cur = rt.trips[b.trip];
  // After this trip ends: the feed can keep the bus's last trip listed a while (the 3 it just finished, on an 8).
  const after = Math.max(nowS - 60, cur && cur.last ? cur.last.time - 60 : 0);
  let best = null;
  for (const [id, u] of Object.entries(rt.trips)) {
    if (id === b.trip || String(u.v) !== vid || !u.first || u.first.time < after) continue;
    if (!best || u.first.time < best.time) best = { id, time: u.first.time };
  }
  const i = best ? D.trips.indexOf(best.id) : -1;
  return i >= 0 ? i : nextTrip(ti, clockNow.ymd);
}

/** A trip's stops from `from` on, as rows with their times, the feed's where it has them. */
function tripRows(ti, from, clockNow, dim) {
  const tr = tripRoute(ti);
  return tripStops(ti).slice(from).map(([m, si]) => {
    const row = routeRow(si, tr.r, { min: m, r: tr.r, dir: tr.dir, si, trip: ti, day: 0, ymd: clockNow.ymd, req: onRequest(si, tr.r, tr.dir) }, clockNow);
    return dim ? html`<div class="later">${row}</div>` : row;
  });
}

/** `later`: the next trip of the bus furthest along this route, dimmed, under the list. `now`: a bus that ran this
 *  route and is past the Transit Center on its next one, bright, at the top: where it's going now. */
function follow(ri, seq, buses, clockNow) {
  const out = {};
  const along = b => seq.indexOf(nextStopOf(b));
  const lead = buses.filter(b => along(b) >= 0).sort((a, b) => along(b) - along(a))[0];
  if (lead) {
    const ti = D.trips.indexOf(lead.trip), nti = ti >= 0 ? nextOf(lead, ti, clockNow) : undefined, tr = nti !== undefined && tripRoute(nti);
    if (tr && tr.r !== ri) {
      const st = tripStops(nti);
      out.later = html`<div class="section onward">${icon('swap', 16)}<span>Stay on bus ${lead.label}: it becomes ${routeName(tr.r)} at ${clockText(st[0][0])}</span>${html.raw(routeBadgeLink(tr.r, st[0][1], 24, tr.dir))}</div>
        <div class="list rs-list">${tripRows(nti, 0, clockNow, true)}</div>`;
    }
  }
  // A bus off this route now, whose trip before was this route's and not long done.
  for (const b of rtStale() ? [] : rt.buses) {
    if (b.ri === ri) continue;
    const ti = D.trips.indexOf(b.trip), pti = ti >= 0 ? prevTrip(ti, clockNow.ymd) : undefined, pr = pti !== undefined && tripRoute(pti);
    if (!pr || pr.r !== ri) continue;
    const ps = tripStops(pti);
    if (!ps.length || clockNow.min - ps[ps.length - 1][0] > 60) continue;
    const st = tripStops(ti), k = st.findIndex(([, si]) => si === nextStopOf(b));
    if (k < 0) continue;
    out.now = html`<div class="section onward">${icon('swap', 16)}<span>Bus ${b.label} ran this route and is now ${routeName(b.ri)}</span>${html.raw(routeBadgeLink(b.ri, st[k][1], 24))}</div>
      <div class="list rs-list">${busRow(b, b.ri)}${tripRows(ti, k, clockNow, false)}</div>`;
    break;
  }
  return out;
}

/** The stop a rider came from: this route's next bus there, and which bus it is and how far off; or that it's done
 *  there for the day, and when it's back. */
function yourStop(ri, si, seq, buses, clockNow) {
  const s = stop(si), name = isLoop(ri) ? D.routes[ri].long : 'Route ' + D.routes[ri].short;   // 'No more Blue Loop here'
  const closed = closedRoutes(si, clockNow.ymd).has(ri);
  const t = closed ? null : nextAt(si, 1, clockNow, 8, x => x.r === ri)[0];
  let line, sub = '';
  if (closed) line = html`<span class="rel warnmark">Not served today · detour</span>`;
  else if (!t) line = html`<span class="rel">Nothing scheduled in the next week</span>`;
  else if (t.day > 0) line = html`<span class="rel">No more ${name} here today · next ${t.day === 1 ? 'tomorrow' : dayName(t.ymd)} ${clockText(t.min)}</span>`;
  else {
    const lt = lively(t);
    line = html`${badge(ri, 20)}${when(lt, 22)}<span class="rel">${relative(lt, clockNow)}</span>${lt.live ? liveMark(lt.live.est ? 'Estimated' : 'Live') : sched(lt)}`;
    // Which bus: the one on that trip. How far: stops from where it calls next to here, round the loop for a loop.
    const b = buses.find(x => x.trip === D.trips[t.trip]);
    if (b) {
      const k = seq.indexOf(nextStopOf(b)), h = seq.indexOf(si);
      const away = k < 0 ? null : (h - k + seq.length) % seq.length + 1;
      sub = `Bus ${b.label}${away !== null ? ` · ${away} ${away === 1 ? 'stop' : 'stops'} away` : ''}`;
    }
  }
  return html`<a class="twin blueprint yourstop" href="#/stop/${s.id}">${corners()}<span style="color:var(--color-accent-700)">${icon('pin', 22)}</span>
    <div class="mid"><span class="eyebrow">Your stop</span><span class="name">${heard(si)}</span><div class="when">${line}</div>${sub ? html`<span class="rel">${sub}</span>` : ''}</div>
    <span class="muted">${icon('fwd', 20)}</span></a>`;
}

const busAnchor = id => 'bus-' + String(id).replace(/[^\w-]/g, '');   // a bus's row, for the list to open on
/** A bus on the route, as a row between the stop it last passed and the one it calls at next. A tap rings it on
 *  the map, the sheet left as it is. */
function busRow(b, ri) {
  // Waiting at the Transit Center a bus is never early: it leaves on time or late.
  const dl = busDelay(b), atHub = D.stops[nextStopOf(b)]?.hub;
  const words = dl !== null && !isLoop(ri) && !(atHub && dl < 2) ? lateWords(dl) : '';
  return html`<a class="busrow" id="${busAnchor(b.id)}" data-ring="${b.id}" href="#/map/route/${encodeURIComponent(D.routes[ri].short)}?bus=${encodeURIComponent(b.id)}"><i style="background:#${D.routes[ri].color}"></i><span>Bus ${b.label}${words ? ' · ' + words : ''}</span><span class="livetag"><i></i>Live</span>${icon('map', 16)}</a>`;
}

/** Today's last run this way, while it's still to come or on the road: when and where it leaves, where and about
 *  when it ends. An out-and-back (15's to Preston and back) is one run of two timetable trips, so the note says the
 *  bus comes back, not that it ends at the far end; and each way has its own last run, the other way's list its own. */
/** A way's runs today, each trip once with where and when it starts, in order: found once per route, way and day. */
const runsCache = new Map();
function runsOn(ri, ymd, d) {
  const k = ri + ':' + ymd + ':' + d;
  if (!runsCache.has(k)) {
    const out = [], done = new Set();
    for (const si of new Set(Object.values(D.routes[ri].stops || {}).flat())) for (const t of timesOn(si, ymd)) {
      if (t.r !== ri || String(t.dir) !== String(d) || done.has(t.trip)) continue;
      done.add(t.trip);
      const st = tripStops(t.trip);
      if (st.length) out.push({ trip: t.trip, min: st[0][0], si: st[0][1] });
    }
    runsCache.set(k, out.sort((a, b) => a.min - b.min));
  }
  return runsCache.get(k);
}
/** Where a run leaves from, as the notes say it: 'Preston ', 'the Transit Center '; a loop's '' (it starts wherever the
 *  feed cuts its trip). */
function runFrom(ri, si) {
  if (isLoop(ri)) return '';
  const s0 = stop(si), town = (s0.town || '').replace(/,\s*[A-Z][a-z]+$/, '');
  return (s0.hub ? 'the ' + D.hub.name : town && town !== D.hub.town ? town : s0.name) + ' ';
}
/** Before the day's first run has left: when and where it does. Morning's word, where the evening's is the last run's. */
function firstRunNote(ri, d, clockNow, dirWord) {
  const f = runsOn(ri, clockNow.ymd, d)[0];
  if (!f) return null;
  // Left by the feed's word, not the clock's: a bus out early is gone from its first stop, a late one not yet.
  const row = timesOn(f.si, clockNow.ymd).find(t => t.trip === f.trip), t = row ? lively({ ...row, day: 0, ymd: clockNow.ymd }) : { min: f.min };
  if (t.gone || t.min < clockNow.min) return null;
  return { f: { ...f, min: t.min }, note: html`<div class="notice lastrun-note">${icon('sun', 16)}<span>Today's first run${dirWord} leaves ${runFrom(ri, f.si)}at <b>${clockText(t.min)}</b>.</span></div>` };
}
function lastRun(ri, d, seq, clockNow, dirWord) {
  const lt = lastTripOn(ri, clockNow.ymd, d);
  if (!lt) return null;
  // Said once it's near: out already, or one of the way's next two runs to leave (an hourly route's from two hours
  // before, a half-hourly one's from one). All day long it was last night's word still up at dawn.
  if (lt.start[0] > clockNow.min && runsOn(ri, clockNow.ymd, d).filter(x => x.min > clockNow.min).length > 2) return null;
  const t = { min: lt.start[0], si: lt.start[1], r: ri, dir: lt.dir, h: lt.h, trip: lt.trip };
  const run = runOf(t.trip, clockNow.ymd), lastTi = run[run.length - 1], onward = run.slice(run.indexOf(t.trip) + 1);
  const stops = tripStops(lastTi);
  // How late: the bus's own, once it's out (on any trip of the run); before that, the feed's word on its leaving.
  const bus = rtStale() ? null : rt.buses.find(b => run.includes(D.trips.indexOf(b.trip)));
  const u = bus && rt.trips[bus.trip], p = predict({ ...t, day: 0 });
  const delay = u && u.lastDelay !== null ? u.lastDelay : p && !p.gone ? p.delay || 0 : 0;
  const te = tripEnd(lastTi), turn = onward.length ? tripEnd(t.trip) : null;
  const endMin = (te ? te.min : stops[stops.length - 1][0]) + delay;
  const re = runEnd(t.trip), partial = !onward.length && re && re.partial && re.end !== null;
  // Where the run ends: the feed's final stop for the bus's trip, with its time, once the bus is on the run's last
  // trip; else the last trip's end; else a partial run's end; else the stop that follows its last one on the route.
  let endSi = null, endAt = null;
  const fin = u && u.ti === lastTi && u.stops.find(x => x[1] === u.end);
  if (fin && D.stopById[fin[0]] !== undefined) { endSi = D.stopById[fin[0]]; endAt = now(new Date(fin[2] * 1000)).min; }
  else if (te) endSi = te.si;
  else if (partial) endSi = re.end;
  else { const k = seq.indexOf(stops[stops.length - 1][1]); if (k >= 0) endSi = k + 1 < seq.length ? seq[k + 1] : isLoop(ri) ? seq[0] : null; }
  if ((endAt ?? endMin) < clockNow.min) return null;   // done for the day, its final stop reached: the times below are the next day's
  const place = si => stop(si).hub ? 'the ' + D.hub.name : stop(si).name;
  // 'leaves Preston at', 'leaves the Transit Center at'; a loop's trip starts wherever the feed cuts it, so just 'leaves at'.
  const town = si => (stop(si).town || '').replace(/,\s*[A-Z][a-z]+$/, ''), s0 = stop(t.si);
  const from = isLoop(ri) ? '' : (s0.hub ? 'the ' + D.hub.name : town(t.si) && town(t.si) !== D.hub.town ? town(t.si) : s0.name) + ' ';
  const ends = endSi !== null ? place(endSi) : 'its last stop', about = ' about ' + clockText(endAt ?? endMin);
  const far = turn ? (town(turn.si) && town(turn.si) !== D.hub.town ? town(turn.si) : stop(turn.si).name) : '';
  const where = partial ? html`only part of the route, ending at <b>${stop(re.end).name}</b>${about}`
    : onward.length ? html`out to ${far} and back, ending at ${ends}${about}` : html`the whole route, ending at ${ends}${about}`;
  const lead = t.min > clockNow.min ? html`Today's last run${dirWord} leaves ${from}at <b>${clockText(t.min)}</b> and runs ${where}.`
    : html`Today's last run${dirWord} left ${from}at ${clockText(t.min)}${bus ? html` and is on the road now, bus ${bus.label}` : ''}. It runs ${where}.`;
  return { note: html`<div class="notice lastrun-note">${icon('moon', 16)}<span>${lead}</span></div>`, out: t.min <= clockNow.min, endSi, endAt, endMin: endAt ?? endMin, turnSi: turn ? turn.si : null };
}

/** The route's sheet as a phone's map card: drawn afresh for a new route or way, redrawn in place for the minute and
 *  the feed, so its scroll and its size stay where the rider left them. */
let sheetKey = null;
function sheetCard(o, clockNow) {
  const s = routeSheet(o, clockNow), card = col.querySelector('#mapcard');
  if (!s) return;
  const key = [o.short, o.dir, o.at, o.full].join('|'), again = sheetKey === key && !!card.querySelector(':scope > .routesheet');
  const markup = html`<div class="grip"></div>${s.head}${s.body}`.s;
  if (again) morph(card, markup);
  else { card.innerHTML = markup; card.scrollTop = 0; card.classList.remove('peek'); sheetKey = key; }
  card.classList.remove('hidden');
  card.classList.add('open');
  if (!again && s.anchor) { const a = card.querySelector('#' + s.anchor); if (a) card.scrollTop = Math.max(0, a.getBoundingClientRect().top - card.getBoundingClientRect().top - card.clientHeight / 3); }
}
/** The route's page beside the map on a wide screen: the same sheet, in the panel. */
export function routePage(o, clockNow) {
  const s = routeSheet(o, clockNow);
  if (!s) return { html: html`<div class="backbar"><a class="btn btn-ghost" href="#/">${icon('back', 22)}Stops</a></div><div class="empty"><h2>No such route</h2></div>`, title: 'Route' };
  return { html: html`<div class="backbar"><a class="btn btn-ghost" href="#/" onclick="if(history.length>1){history.back();return false}">${icon('back', 22)}Back</a></div><div class="routepage">${s.head}${s.body}</div>`.s,
    title: s.title, key: 'route' + o.short + '/' + (o.dir || '') + (o.at || '') + (o.full ? '*' : ''), keepScroll: true, anchor: s.anchor, anchorBlock: 'center' };
}
/** A bus from a route's list, ringed on the map and the map eased to it; the sheet stays. One not placed yet is
 *  ringed when it appears. */
let ringed = null, wantRing = null;
/** The ringed bus let go: the route as it is, its times the route's, not that bus's. */
function unring() {
  ringed = null;
  for (const m of busMarkers.values()) m.el.classList.toggle('on', selectedBus === m.id);
  applySelection();
  if (focusRoute !== undefined) routeTimesSoon(focusRoute, now());
}
function ringBus(id) {
  const m = busMarkers.get(id);
  if (!m) { wantRing = id; return; }
  wantRing = null; ringed = id;
  applySelection();   // its way on from where it is, the route stepped back behind it, as a bus picked on the map
  if (focusRoute !== undefined) routeTimesSoon(focusRoute, now());   // and the route's times, that bus's
  const ll = m.marker.getLngLat();
  frame([ll.lng, ll.lat], { duration: 500 });
}
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('[data-ring]');
  if (!a || !map) return;
  e.preventDefault(); ringBus(a.dataset.ring);
});

/** Swiping the card down closes it, and swiping it up opens the stop's page, from anywhere on the card: the
 *  gesture is claimed on the first move only when the card can't scroll that way any further (at its top for
 *  down, at its end for up) and the finger is heading that way, so scrolling and taps work as before. The grip
 *  also drags with a mouse. The browser's pull-to-refresh never sees any of it. */
/** The peek's height: the grip and the head, whatever the stop's name and routes take. */
function fitPeek(card) {
  // The directions: down to the last way, every one there to tap between, the way picked drawn in the map above;
  // never more than 60% of it. (Down to the way picked, the ways after it were a swipe up away each time.)
  const rows = card.querySelectorAll('.gohead .jrow'), last = rows[rows.length - 1];
  if (last) { card.style.setProperty('--peek', Math.min(last.getBoundingClientRect().bottom - card.getBoundingClientRect().top + card.scrollTop + 1, 0.6 * map.getContainer().clientHeight) + 'px'); return; }
  // Down to the bottom of its head, wherever the head sits (a stop's page has its Back row above it).
  const h = card.querySelector('.head');
  if (h) card.style.setProperty('--peek', Math.round(h.getBoundingClientRect().bottom - card.getBoundingClientRect().top + card.scrollTop + 2) + 'px');
}
function wireGrip(app) {
  const card = col.querySelector('#mapcard');
  // A route's sheet swiped away puts the route away with it, as a tap on nothing does.
  // The Center's board swiped away is the board put away: the Center stays, the map as the rider has it.
  const close = () => { if (card.querySelector(':scope > .hubsheet') && /^#\/hub/.test(location.hash)) {
      card.classList.remove('open', 'peek');
      // A route picked on it goes with the board: its badge lit and the rest dimmed, with nothing to say why, read as
      // stuck. The address in place, so Back doesn't pick it again.
      if (hubBay !== null) { hubBay = null; hubKey = null; history.replaceState(null, '', '#/hub'); shownHash = '#/hub'; hubBadges(); }
      return; }
    if (card.querySelector(':scope > .routesheet') && /^#\/map\/route\//.test(location.hash)) { card.classList.remove('open', 'peek'); location.hash = '#/map'; return; }
    if (card.querySelector(':scope > .journeysheet') && JR) { card.classList.remove('open', 'peek'); backToWays(); return; }
    if (card.querySelector(':scope > .pagesheet') && /^#\/(stop|usu)\//.test(location.hash)) { card.classList.remove('open', 'peek'); location.hash = '#/map'; return; }   // a stop's sheet put away: the Map tab
    selectedBus = null; selectedU = null; select(null, app); };
  // The card's own Open button (the card itself is .open too): a place's page. A spot's card has none: its first
  // button is directions, and a swipe up is no ask for those.
  const pageHref = () => { const a = card.querySelector(':scope > .open a'), h = a && a.getAttribute('href'); return h && !/^#\/go\//.test(h) ? h : null; };
  // Swiped down, the card shrinks to its head (the stop's name and routes) and the map shows through; swiped down
  // again it goes. Up, or a tap on the head, opens it out. The size chosen stays for the next stop tapped.
  const peeked = () => card.classList.contains('peek');
  // The Center's board scrolls as one page over the map (hubPlace), none of this: nor is it put away, as gone, only
  // leaving the Center brought it back.
  const board = () => !!card.querySelector(':scope > .hubsheet') && /^#\/hub/.test(location.hash);
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
  // A way's card at its new size: the way framed again in what it leaves (after the slide's settle).
  const refitWay = () => { if (card.querySelector(':scope > .journeysheet')) setTimeout(() => frameWay(400), 340); };
  const toPeek = (dy = 0) => { const full = card.offsetHeight; fitPeek(card); const peekH = parseFloat(card.style.getPropertyValue('--peek')) || full; slide(dy, Math.max(0, full - peekH), () => { card.classList.add('peek'); card.scrollTop = 0; }); refitWay(); };
  // Up to the whole card: it grows first, held down where the peek was, then slides up.
  const toFull = (dy = 0) => { const peekH = card.offsetHeight; card.classList.remove('peek'); const full = card.offsetHeight; slide(full - peekH + dy, 0); refitWay(); };
  // Off the map: the card's own transform (its closed state) with a transition on it.
  // The finger's offset goes with it: left on the card, the next card opened (a stop, the routes on a road) came up
  // that far short, its last rows under the tabs.
  const away = () => { card.style.transition = 'transform .25s ease'; card.style.transform = ''; close(); setTimeout(() => { card.style.transition = ''; }, 300); };
  let y0 = null, x0 = 0, t0 = 0, claimed = false;
  const settle = (dy, dt) => {
    const far = Math.abs(dy) > 70 || (Math.abs(dy) > 24 && Math.abs(dy) / Math.max(dt, 1) > 0.5);   // far enough, or a flick
    const at = claimed === 'down' ? Math.max(0, dy) : Math.max(-24, Math.min(0, dy / 4));   // where the finger left it
    if (!far) { slide(at, 0); return; }
    // A stop's sheet opens part way (down to its next two buses): a swipe down from there is down to its head, the map
    // to the finger; the next one puts it away.
    const tall = !!card.dataset.tall && !!card.querySelector(':scope > .pagesheet');
    if (claimed === 'down') { if (peeked() && board()) slide(at, 0); else if (peeked() && !tall) away(); else { delete card.dataset.tall; toPeek(at); } }
    else if (peeked()) { delete card.dataset.tall; toFull(at); }
    else { slide(at, 0); const href = pageHref(); if (href) location.hash = href; }   // the page slides up over the map
  };
  card.addEventListener('click', e => {
    // A way's row is a tap on that way, not on the card: it opened the card out, and the way picked was framed in the
    // sliver of map left above it.
    // The way already picked, tapped again: its legs, the card opened out and brought to them.
    if (e.target.closest('.jrow.picked')) {
      if (peeked()) { delete card.dataset.tall; card.classList.remove('peek'); }
      // Up to its legs, as far as the card scrolls; where that stops part way down the way's own row, at its top.
      const legs = card.querySelector(':scope > .journeysheet'), row = card.querySelector('.jrow.picked');
      if (legs) {
        let top = Math.min(legs.offsetTop - 8, card.scrollHeight - card.clientHeight);
        const rt = row ? row.offsetTop : -1;
        if (row && top > rt && top < rt + row.offsetHeight) top = rt;
        card.scrollTop = top;
      }
      requestAnimationFrame(() => frameWay(400));   // the whole way again, in what the card leaves
      return;
    }
    if (e.target.closest('a, button, [data-go]')) return;
    if (board()) { if (hubFolded) hubFold(false); return; }   // folded, a tap on it opens it
    if (peeked()) { delete card.dataset.tall; toFull(); }
    else if (e.target.closest('.grip')) toPeek();
  });
  // A mouse's wheel or a trackpad (a desktop window narrow enough for a phone's layout): scrolled on a card down to
  // its head, the card opens out, as a swipe up does; it had nothing to scroll, so did nothing. Opened, it scrolls.
  // Opened and at its top, a fresh scroll up (not the tail of the one that brought it there) is down to its head again,
  // as a swipe down is: there was no way back but the grip.
  let wheelAt = 0, wheelLast = -1e9, pullOn = false, pull = 0, pullAbs = 0;
  card.addEventListener('wheel', e => {
    const gap = e.timeStamp - wheelLast, fresh = gap > 300; wheelLast = e.timeStamp;
    if (e.ctrlKey) return;
    if (board()) {
      // Folded, a scroll down opens it. At its top, a pull up folds it: a new one, not the tail of the scroll that
      // brought it there. A trackpad's tail runs on for a second, dying away, and a rider's next pull began inside it:
      // waiting for a quiet gap, only the first fold ever came. A pull after a pause, or one gathering speed, is new.
      if (hubFolded) { if (e.deltaY > 0) { e.preventDefault(); hubFold(false); } return; }
      const abs = Math.abs(e.deltaY);
      if (e.deltaY >= 0 || card.scrollTop > 0) { pullOn = false; pull = 0; pullAbs = abs; return; }
      if (gap > 250 || abs > pullAbs * 1.3 + 1) pullOn = true;
      pullAbs = abs;
      if (!pullOn) return;
      e.preventDefault();
      pull += abs;
      if (pull > 40) { pullOn = false; pull = 0; hubFold(true); }
      return;
    }
    if (!peeked() && e.deltaY < 0 && card.scrollTop <= 0 && fresh && card.classList.contains('open') && !wide()) { e.preventDefault(); wheelAt = e.timeStamp; toPeek(); return; }
    if (!peeked() || e.deltaY <= 0) return;
    e.preventDefault();
    if (e.timeStamp - wheelAt < 400) return;   // one opening for one flick
    wheelAt = e.timeStamp; delete card.dataset.tall; toFull();
  }, { passive: false });
  // The board: a swipe down begun at its top folds it, one up opens it again (its own scroll does the rest).
  let bY = null, bTop = false;
  card.addEventListener('touchstart', e => { if (board() && e.touches.length === 1) { bY = e.touches[0].clientY; bTop = card.scrollTop <= 0; } else bY = null; }, { passive: true });
  card.addEventListener('touchend', e => {
    if (bY === null || !board()) return;
    const dy = (e.changedTouches[0] ? e.changedTouches[0].clientY : bY) - bY;
    bY = null;
    if (!hubFolded && bTop && dy > 60) hubFold(true);
    else if (hubFolded && dy < -40) hubFold(false);
  });
  card.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { y0 = null; return; }
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; t0 = e.timeStamp; claimed = false;
  }, { passive: true });
  card.addEventListener('touchmove', e => {
    if (y0 === null || e.touches.length !== 1) return;
    if (board()) { y0 = null; return; }   // its own scroll
    const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if (!claimed) {
      const down = dy > 0 && card.scrollTop <= 0;
      const up = dy < 0 && ((peeked() && !board()) || (card.scrollTop + card.clientHeight >= card.scrollHeight - 1 && !!pageHref()));
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
  // A way's card: a swipe across is the next way or the one before, its arrows too; All ways goes back to the list.
  let sx = null, sy = 0;
  card.addEventListener('touchstart', e => { sx = e.touches.length === 1 && card.querySelector(':scope > .journeysheet') ? e.touches[0].clientX : null; sy = e.touches[0] ? e.touches[0].clientY : 0; }, { passive: true });
  card.addEventListener('touchend', e => {
    if (sx === null || !e.changedTouches[0]) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) stepWay(dx < 0 ? 1 : -1);
  });
  card.addEventListener('click', e => {
    const g = e.target.closest('[data-go]'), bk = e.target.closest('[data-back]'), a = e.target.closest('a[href^="#"]');
    if (g) asPage(g.dataset.go);
    else if (bk) { e.preventDefault(); backToWays(); }
    // A card's link to the address already up (a bus's Open route, on its route): nothing to change to, so the tap
    // did nothing. It's shown again instead: the route's sheet back, the bus ringed.
    else if (a && a.getAttribute('href') === location.hash) { e.preventDefault(); shownHash = null; window.dispatchEvent(new HashChangeEvent('hashchange')); }
  });
  // a mouse drags the grip
  let my0 = null;
  card.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || !e.target.closest('.grip') || board()) return;
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
const WIDE = matchMedia(WIDE_MQ);
let ctrls = [];
function placeControls() {
  for (const c of ctrls) map.removeControl(c);
  const nav = new maplibregl.NavigationControl({ showCompass: false }), near = nearControl(), sat = satControl(), north = northControl();
  const credit = new maplibregl.AttributionControl({ compact: true });
  // Bottom corners stack upward in the order added, top corners downward. The map credit keeps its own corner:
  // bottom left on a phone, under the buttons' corner on a wide screen, so it never sits in a stack of buttons.
  ctrls = coarse() ? [credit, near, sat, north] : WIDE.matches ? [credit, near, nav, sat, north] : [credit, nav, near, sat, north];
  // A phone's compass under the search bar, top right: in the bottom corner the Center's board covered it, and there,
  // always shown, it's how the bays are turned round and back.
  for (const c of ctrls) map.addControl(c, c === credit ? (WIDE.matches ? 'bottom-right' : 'bottom-left') : WIDE.matches || c === north ? 'top-right' : c === nav ? 'bottom-left' : 'bottom-right');
}

/** North: a button that appears once the map is turned, and turns it back. */
function northControl() {
  return {
    onAdd(m) {
      const el = document.createElement('div'); el.className = 'maplibregl-ctrl maplibregl-ctrl-group northctl';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'northbtn';
      b.innerHTML = icon('compass', 20).s;
      // On the Center, always there: the bays turned between south up (as its benches face, the way it opens) and north
      // up, and the turn kept for next time; a desktop has no turn of the fingers to find. Elsewhere, north again.
      const atHub = () => /^#\/hub/.test(location.hash);
      b.onclick = () => {
        if (!atHub()) { m.resetNorth({ duration: 400 }); return; }
        pref('hub-up', Math.abs(m.getBearing()) > 90 ? 'north' : null);
        frame(hubBounds(), { ...hubFit(), duration: 500 });
      };
      const sync = () => {
        const a = m.getBearing(), hub = atHub(), say = hub ? (Math.abs(a) > 90 ? 'North up' : 'South up, as the benches face') : 'Point north';
        el.classList.toggle('on', hub || Math.abs(a) > 0.5); b.querySelector('svg').style.transform = `rotate(${-a}deg)`;
        if (b.title !== say) { b.title = say; b.setAttribute('aria-label', say); }
      };
      m.on('rotate', sync); m.on('rotateend', sync); addEventListener('hashchange', sync); sync();
      this.off = () => { m.off('rotate', sync); m.off('rotateend', sync); removeEventListener('hashchange', sync); };
      el.appendChild(b); this.el = el; return el;
    },
    onRemove() { this.off(); this.el.remove(); },
  };
}

/** The rider's dot tapped: directions to where they are, to send someone ('come to me'). Rounded to the street
 *  (about 50 m, the grid the app names places by), and the panel says what the link shows before anything's sent. */
function shareHere() {
  if (!meGeo) return;
  const lat = Math.round(meGeo.lat / 0.0005) * 0.0005, lon = Math.round(meGeo.lon / 0.0005) * 0.0005, label = whereabouts(lat, lon) || 'where I am';
  openShare({ url: siteLink('go/' + spotKey(lat, lon, label)), title: 'Share where you are', lines: [`Directions to ${label}`, 'Rounded to the street, from wherever they open it'],
    also: [{ label: 'Save as a place (Home, Work…)', act: () => openSave({ lat, lon, label }) }] });   // at home, the natural moment to set it
}
/** Where the map rested after the near view was last framed: the Map tab, tapped with the map still there, goes on out. */
let homeRest = null;
const movedSinceHome = () => { if (!homeRest) return true; const c = map.getCenter(); return Math.abs(map.getZoom() - homeRest.zoom) > 0.05 || distance(c.lat, c.lng, homeRest.lat, homeRest.lon) > 30; };
/** Near me: the map to where you are, with your dot on it. */
function nearControl() {
  return {
    onAdd(m) {
      const el = document.createElement('div'); el.className = 'maplibregl-ctrl maplibregl-ctrl-group';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'nearbtn'; b.title = 'Near me'; b.setAttribute('aria-label', 'Near me');
      b.innerHTML = icon('near', 20).s;
      // Near me, every tap: the rider and their four nearest stops. It never turns location off. (Tried from 2026-09-30,
      // for a week: three buttons, three places. It was the stretch view, then them close up.)
      b.onclick = () => nearMe(geo => {
        if (!geo) return;
        placeMe(geo);
        // At the Center (the map too, its board up): leave it for the near view, as the Map tab leaves it for the map.
        if (/^#\/hub/.test(location.hash)) { resetDue = true; location.hash = '#/map'; return; }
        toNear(geo, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700);
      });
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
  return html`<div class="mapbar"><form class="search" id="mapsearch" role="search"><input class="input" type="search" placeholder="Street, place or route" autocomplete="off" aria-label="Search stops, places and routes"><span class="lead">${icon('search', 22)}</span></form></div><div class="mapresults hidden" id="mapresults"></div><div class="mapnotice" id="mapnotice"></div><div class="mapcard hidden" id="mapcard"></div>`;
}

function wireChrome(app) {
  const form = col.querySelector('#mapsearch'), input = form.querySelector('input'), results = col.querySelector('#mapresults');
  form.onsubmit = e => e.preventDefault();
  // On a wide screen the header's search box serves the map (its own bar is hidden): both boxes run this.
  const clear = () => { input.value = ''; const top = document.querySelector('#topsearch input'); if (top) top.value = ''; results.classList.add('hidden'); };
  let t, searchTok = 0;
  // The one search, as the Stops tab's page has it: its results over the map, each shown here when tapped.
  mapSearch = v => { clearTimeout(t); t = setTimeout(() => {
    const q = v.trim();
    if (!q) { results.classList.add('hidden'); return; }
    results.innerHTML = searchResults(q, now(), null, true);   // the matches at once, their next buses just after
    const tok = ++searchTok;
    afterPaint(() => { if (tok === searchTok && !results.classList.contains('hidden')) fillLater(results); });
    forMap(results);
    results.classList.remove('hidden');
    results.scrollTop = 0;
    results.querySelectorAll('[data-q]').forEach(a => a.onclick = e => { e.preventDefault(); input.value = a.dataset.q; mapSearch(a.dataset.q); });
    results.querySelectorAll('a:not([data-q])').forEach(a => a.onclick = clear);
  }, 200); };
  input.oninput = () => mapSearch(input.value);
  // Before a word, the rider's saved places (the Stops tab's search has them the same): directions there in a tap.
  input.onfocus = () => {
    if (input.value.trim()) return mapSearch(input.value);
    const rows = placeRows();
    if (!rows) return;
    results.innerHTML = rows; results.classList.remove('hidden'); results.scrollTop = 0;
    results.querySelectorAll('a').forEach(a => a.onclick = clear);
  };
}

function placeMe(geo) {
  meGeo = geo;
  if (!map) return;
  if (!meMarker) {
    const el = document.createElement('div'); el.className = 'me-marker';
    el.setAttribute('role', 'button'); el.setAttribute('aria-label', 'Share where you are'); el.tabIndex = 0;
    const go = e => { e.stopPropagation(); e.preventDefault(); shareHere(); };
    el.addEventListener('click', go); el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') go(e); });
    meMarker = new maplibregl.Marker({ element: el });
  }
  meMarker.setLngLat([geo.lon, geo.lat]).addTo(map);
}

let labelsHeard = false, asking = false;
function applySelection() {
  if (!map || !ready) return;
  // A search's stops beside the panel, several at once, with the ring a picked stop wears; a stop picked, that one.
  map.setFilter('stop-selected', !selected && searchIds.length ? ['in', ['get', 'id'], ['literal', searchIds]] : ['==', ['get', 'id'], selected || '']);
  map.setFilter('usu-selected', ['==', ['get', 'id'], uHilite]);
  runRoutes = routesInPlay(); runLoops = loopsInPlay();
  // A loop with its way on drawn isn't drawn solid on top as well: the way is the loop, bright where it starts.
  litLines(map, hiLines, runLoops.length ? [] : hiLoops, runRoutes.length > 0 || runLoops.length > 0);
  // Out past the streets, only a lit route's stops: the rest wait for a closer look.
  const lit = new Set(focusRoute !== undefined ? [...hiLines, focusRoute] : hiLines);
  map.setFilter('stops-lit', ['in', ['get', 'id'], ['literal', lit.size ? D.stops.filter(s => s.routes.some(r => lit.has(r))).map(s => s.id) : []]]);
  tintStops(map, focusRoute);
  // A route or bus lit (or a way drawn): only its own detours' dotted stretches, not every route's at full strength
  // across the faded map and over the way it's going.
  // A lit route's timed stops ringed; none with nothing lit, the whole valley's would be clutter.
  map.setFilter('stops-tp', ['in', ['get', 'id'], ['literal', JR ? [] : D.stops.filter((s, i) => [...lit].some(ri => timed(i, ri))).map(s => s.id)]]);
  const ownClosed = JR ? JR.routes : [...new Set([...lit, ...routesInPlay()])];   // a bus's or a stop's too
  for (const id of ['route-closed', 'route-closed-halo']) map.setFilter(id, ownClosed.length ? ['in', ['get', 'route'], ['literal', ownClosed]] : null);
  // A route or bus lit: the stops it passes without calling at faded back, so a stop on its line that isn't its (8 up
  // Main past the Green Loop's) doesn't read as one it stops at.
  const fade = lit.size > 0 && !JR, theirs = fade ? ['any', ...[...lit].map(r => ['in', r, ['get', 'routes']])] : true;
  map.setPaintProperty('stops', 'circle-opacity', fade ? ['case', theirs, 1, 0.28] : ['interpolate', ['linear'], ['zoom'], 10, 0.5, 13, 1]);
  map.setPaintProperty('stops', 'circle-stroke-opacity', fade ? ['case', theirs, 1, 0.28] : 1);
  map.setPaintProperty('stop-labels', 'text-opacity', fade ? ['case', theirs, 1, 0.4] : 1);
  // A route lit: its stops by the names its bus announces (the landmark, the address under it, smaller and muted),
  // as the rider on it hears them; the map at large by address, what's looked up on it.
  const heardOn = hiLines.length > 0 || focusRoute !== undefined;
  if (heardOn !== labelsHeard) {
    labelsHeard = heardOn;
    map.setLayoutProperty('stop-labels', 'text-field', heardOn ? ['case', ['!=', ['get', 'by'], ''], ['format', ['get', 'by'], {}, '\n', {}, ['get', 'name'], { 'font-scale': 0.85, 'text-color': dark() ? '#9a9ca0' : '#6b6c70' }], ['get', 'name']] : ['get', 'name']);
  }
  // Asked for a spot, the map's places are named from further out: they're what a rider picks by.
  const placeZ = asking ? 13 : 15;
  if (map.getLayer('place-labels') && map.getLayer('place-labels').minzoom !== placeZ) map.setLayerZoomRange('place-labels', placeZ, 24);
  quiet();
  drawRunsSoon();
  // The picked bus's ring too: cleared with the rest, not left till the feed's next update (up to fifteen seconds).
  for (const [id, m] of busMarkers) { paintBus(m); m.el.classList.toggle('on', id === selectedBus || id === ringed); }
  dressJourney();
  if (MT.R && map.getLayer('run-hot')) dressForRun(map, MT.R);   // a run up keeps its own dress over all the above
}

/** The shuttle and POOL drawn only where they run, or when asked for: near campus (the shuttle's stops) or POOL's zone,
 *  from the streets in, and a shuttle loop, stop or bus picked. Out over the valley they'd be noise over Connect's. */
const U_LAYERS = ['usu-lines', 'usu-line-on', 'usu-selected', 'usu-stops', 'usu-labels'], POOL_LAYERS = ['pool-zone', 'pool-stops', 'pool-p'];
let campusBox = null, poolBox = null;
const boxOf = pts => pts.length ? pts.reduce((b, [lon, lat]) => [Math.min(b[0], lon), Math.min(b[1], lat), Math.max(b[2], lon), Math.max(b[3], lat)], [180, 90, -180, -90]) : null;
function quiet() {
  if (!map || !ready || MT.R || JR) return;   // a run or a way dresses the map its own way
  if (!campusBox && U) campusBox = boxOf(U.stops.filter(s => s.routes.length).map(s => [s.lon, s.lat]));
  if (!poolBox && POOL) poolBox = boxOf([...(POOL.area ? POOL.area.flatMap(p => p[0]) : POOL.zone), ...POOL.stops.map(s => [s.lon, s.lat])]);   // its pickups too: one with no area round it (the Center's) still shown
  const z = map.getZoom(), v = map.getBounds(), m = 0.003;   // a few hundred metres round the box
  const near = (b, zmin = 13.5) => !!b && z >= zmin && v.getWest() < b[2] + m && v.getEast() > b[0] - m && v.getSouth() < b[3] + m && v.getNorth() > b[1] - m;
  const show = (ids, on) => { for (const id of ids) if (map.getLayer(id) && (map.getLayoutProperty(id, 'visibility') !== 'none') !== on) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
  const asked = selectedU !== null || !!uHilite || hiLoops.length > 0 || runLoops.length > 0;
  show(U_LAYERS, asked || near(campusBox));
  // its buses to arrows with its lines put away, and a zoom further in than its lines: at the lines' first zoom its
  // squared markers crowded the campus streets
  map.getContainer().classList.toggle('u-small', !(asked || near(campusBox, 14.5)));
  show(POOL_LAYERS, near(poolBox, 12));   // from the zoom Connect's stops come in at, 12: the two sets of stops together
  hubCheck();
}

// ---- the Transit Center close up. From the streets in (HUB_Z) with the Center on screen, the bays are the map:
// each bay's stop wears its route's badge with where its bus is, as the timetable places it; the route lines, stop
// dots and times, all converging on one block, are put away, and the buses standing in their bays with them (each
// drawn on its badge). Badges that land on one another are eased apart on the screen, afresh at each zoom.
const HUB_Z = 17.5;
const HUB_HIDE = ['route-hover', 'usu-hover', 'stops-tp', 'route-lines', 'route-on', 'route-arrows', 'runs-arrows', 'route-closed', 'route-closed-halo', 'trk-path', 'pool-zone', 'route-times', 'stops', 'stops-lit', 'stops-maybe', 'stop-labels', 'place-labels'];
let hubOn = false, hubBay = null, hubMarks = new Map();   // the view's on; the route picked (#/hub/<k>); badges by route
let hubTurned = false, northDue = false;   // the Center framed south-up by fitHub; north to come back once the move ends
function hubCheck() {
  const on = !!D.hub && !MT.R && !JR && map.getZoom() >= HUB_Z && map.getBounds().contains([D.hub.lon, D.hub.lat]);
  if (on || hubOn) for (const id of HUB_HIDE) if (map.getLayer(id) && (map.getLayoutProperty(id, 'visibility') !== 'none') === on) map.setLayoutProperty(id, 'visibility', on ? 'none' : 'visible');
  if (on !== hubOn) {
    hubOn = on;
    paper(on);
    map.getContainer().classList.toggle('hubon', on);   // its buses over its badges: one moving at its bay was hidden under it
    // Zoomed or panned off the Center, the turn stays: the rider's hands moved the map, not the page. North comes back
    // with the page (the Map tab, another tab).
    if (on) hubBadges(); else { for (const m of hubMarks.values()) m.marker.remove(); hubMarks.clear(); }
    hubBuses();
  }
  if (on) easeBays();
}
/** Back to north-up, once the move that left the Center is over (a turn in the middle of a pinch would fight the
 *  fingers): the south-up was the Center's framing, as the lines' absence was its view. */
function northAgain(jump) {
  if (!northDue) return;
  northDue = false; hubTurned = false;
  // After the rider's own move off the Center, turned back, not snapped; for another tab, at once (out of sight on a
  // phone, a turn is frames drawn for no one).
  if (map.getBearing() !== 0) map.easeTo({ bearing: 0, duration: jump === true || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500 });
}
/** The basemap stepped back at the Center, so the bays read like a plan: the hall's footprint, the drives and paths,
 *  and 500 North (its band and its name) as they are; every other street, the parks, water, labels and all washed
 *  toward the paper. Each layer's own paint kept aside and put back on leaving. */
const PAPER_KEEP = /^(background|earth|buildings|roads_minor_service(_casing)?|roads_other)$/;
/** 500 North's own copy of each road layer (its band, its name), always in the style and unseen until the Center
 *  washes the rest: a wash that picked 500 North out by name was a rule on each road's data, and changing such a rule
 *  rebuilds every street tile on screen, on the way in and on the way out, the phone's worker busy with that while
 *  the Center's own tiles waited, gray. Plain opacities, these copies' and the rest's, rebuild nothing. */
const IS500 = ['any', ['==', 'name:en', '500 North'], ['==', 'name', '500 North']];   // the basemap's filters' own syntax
function with500(l) {
  const lines = /^roads_/.test(l.id) && l.type === 'line' && !PAPER_KEEP.test(l.id), names = /^roads_labels_/.test(l.id) && l.type === 'symbol';
  if (!lines && !names) return [];
  const filter = l.filter ? ['all', l.filter, IS500] : IS500;
  return [lines ? { ...l, id: l.id + '-500n', filter, paint: { ...l.paint, 'line-opacity': 0 } }
    : { ...l, id: l.id + '-500n', filter, layout: { ...l.layout, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { ...l.paint, 'text-opacity': 0 } }];
}
let paperKept = null;
function paper(on) {
  if (on && !paperKept) {
    paperKept = [];
    for (const l of map.getStyle().layers) {
      if (l.source !== 'protomaps' || PAPER_KEEP.test(l.id)) continue;
      const own = /-500n$/.test(l.id);   // 500 North's copies come up; everything else steps back
      const props = own ? [[l.type === 'line' ? 'line-opacity' : 'text-opacity', 1]]
        : l.type === 'fill' ? [['fill-opacity', 0.2]] : l.type === 'line' ? [['line-opacity', 0.2]]
        : l.type === 'symbol' ? [['text-opacity', 0.12], ['icon-opacity', 0.12]] : [];
      for (const [prop, v] of props) { paperKept.push([l.id, prop, map.getPaintProperty(l.id, prop)]); map.setPaintProperty(l.id, prop, v); }
    }
    // The paths drawn as paths, thin and broken, the drives the buses take wider and whole: alike in the basemap,
    // where a path was the wider of the two.
    for (const [prop, v] of [['line-width', ['interpolate', ['exponential', 1.6], ['zoom'], 14, 0.5, 20, 3]], ['line-dasharray', [2, 1.5]]]) if (map.getLayer('roads_other')) { paperKept.push(['roads_other', prop, map.getPaintProperty('roads_other', prop)]); map.setPaintProperty('roads_other', prop, v); }
  } else if (!on && paperKept) {
    for (const [id, prop, v] of paperKept) if (map.getLayer(id)) map.setPaintProperty(id, prop, v === undefined ? null : v);
    paperKept = null;
  }
}
/** The badges drawn, or brought up to date (the feed, the minute, a route picked). */
let onBadges = new Set();   // the buses drawn on their badges, put away on the map
function hubBadges() {
  if (!hubOn) return;
  const items = bays(hubBay, now());
  onBadges = new Set(items.map(b => b.bus).filter(Boolean));
  for (const b of items) {
    let m = hubMarks.get(b.k);
    if (!m) {
      const el = document.createElement('a');
      // The badge's tap is the badge's: let through to the map it was a tap on nothing there, which put away the
      // route's card it had just opened (a moment later on a phone, the map's tap waiting out a double tap).
      el.addEventListener('click', e => e.stopPropagation());
      m = { el, marker: new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([b.lon, b.lat]).addTo(map), at: [b.lon, b.lat] };
      hubMarks.set(b.k, m);
    }
    m.here = b.here;
    m.el.classList.add('hbay');   // toggled, not set: the marker's own classes place it
    for (const [c, on] of [['on', b.on], ['dim', b.dim], ['off', b.off]]) m.el.classList.toggle(c, on);
    m.el.href = b.on ? '#/hub' : '#/hub/' + b.k;
    m.el.title = b.title;
    // Its bus in, the map's own bus on the badge (they're put away there), facing as it stands: the bus at its bay.
    const inner = (b.here ? `<span class="bus hbus" style="--bus-color:${dark() ? lift(b.color) : b.color}"><span class="bus-marker"${b.course === null ? ' data-still' : ` style="--course:${b.course}deg"`}>${b.course === null ? '' : ARROW}</span></span>` : '') + `<span class="b" style="background:${b.color};color:${b.text}">${b.k}</span>` + (b.tag ? `<span class="tag${b.late ? ' late' : ''}"${b.late ? ` title="${b.late} min late"` : ''}>${b.tag.replace(' MIN', 'm')}</span>` : '');
    if (m.el.innerHTML !== inner) m.el.innerHTML = inner;
  }
  easeBays();
}
/** Badges that would touch pushed apart on the screen, a little air between each pair, each still pointing from
 *  as near its own stop as the others let it. */
function easeBays() {
  const ms = [...hubMarks.values()], AIR_X = 34, AIR_Y = 38, BUS_Y = 26;   // and room for a bus on the lower one's top
  const p = ms.map(m => { const q = map.project(m.at); return { x: q.x, y: q.y, x0: q.x, y0: q.y }; });
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
      const a = p[i], b = p[j], dx = b.x - a.x, dy = b.y - a.y, ox = AIR_X - Math.abs(dx), oy = AIR_Y + (ms[dy >= 0 ? j : i].here ? BUS_Y : 0) - Math.abs(dy);
      if (ox <= 0 || oy <= 0) continue;
      moved = true;
      if (ox < oy) { const k = (dx >= 0 ? 1 : -1) * ox / 2; a.x -= k; b.x += k; }
      else { const k = (dy > 0 || (dy === 0 && i < j) ? 1 : -1) * oy / 2; a.y -= k; b.y += k; }
    }
    if (!moved) break;
  }
  ms.forEach((m, i) => m.marker.setOffset([p[i].x - p[i].x0, p[i].y - p[i].y0]));
  const turn = -map.getBearing() + 'deg';   // a bus on a badge faces the way it does on the map, turned or not
  for (const m of ms) m.el.style.setProperty('--map-turn', turn);
}
/** The buses standing at the Center out of the way of its badges while they're up (each drawn on its badge); one
 *  driving in or out stays, its arrow showing the way it goes. */
function hubBuses() {
  for (const [id, m] of busMarkers) m.el.classList.toggle('athub', hubOn && onBadges.has(id));
}
/** The board as a phone's card: the countdown alone at first (the map's the thing), the loops and the next hour a
 *  swipe up; a route picked, its card alone, the badges still in view above it. Redrawn in place for the minute and
 *  the feed. */
let hubKey = null;
function hubCard(clockNow) {
  const s = hubSheet({ bay: hubBay }, clockNow), card = col.querySelector('#mapcard');
  const markup = html`<div class="grip"></div><div class="head hubhead">${s.head}</div><div class="hubsheet">${s.body}</div>`.s;
  // The same board redrawn in place only while it's up: closed (the Map tab, a swipe), it opens afresh, at the countdown.
  const again = hubKey === (s.pick || '') && !!card.querySelector(':scope > .hubsheet') && card.classList.contains('open');
  if (again) morph(card, markup);
  else { card.innerHTML = markup; card.classList.remove('peek'); hubKey = s.pick || ''; }
  card.classList.remove('hidden');
  card.classList.add('open');
  if (!again) { hubFolded = false; hubPlace(card); card.scrollTop = 0; }
  hubMount(card);
}
/** The board on a phone rests where the bays' own room ends (hubRoom), the countdown at the least, and scrolls as one
 *  page over the map: down, it slides up over the bays and on through the departures; back at its top, it's where
 *  it rested. The card is the map's height, the room above the board an empty band that lets the map have the finger.
 *  It had two sizes, snapped between, and a scroll that opened it out covered the bays with no way back but the grip. */
let hubRest = 0, hubFolded = false;   // the board's top, from the map's; folded down to its countdown
function hubPlace(card) {
  const H = map.getContainer().clientHeight, top = topCover();
  const g = card.querySelector(':scope > .grip'), h = card.querySelector(':scope > .head');
  const headH = (g ? g.offsetHeight : 24) + (h ? h.offsetHeight : 100) + 1;
  const rest = Math.max(top, Math.min(hubRoom(), H - headH));
  hubRest = hubFolded ? Math.max(rest, H - headH) : rest;
  card.classList.toggle('hubfold', hubFolded);
  card.style.setProperty('--hub-top', top + 'px'); card.style.setProperty('--hub-room', (hubRest - top) + 'px');
}
/** A swipe down at the board's top folds it to its first card (when the next group leaves, and who's in), the bays
 *  framed larger in the room it frees; up, or a tap on it, and it's back where it rests. Never put away: gone, only
 *  leaving the Center brought it back. */
function hubFold(on) {
  const card = col.querySelector('#mapcard');
  if (hubFolded === on || !card.querySelector(':scope > .hubsheet')) return;
  hubFolded = on; card.scrollTop = 0;
  // Slid, not snapped: the board and its ground move together (--hub-room, a registered length, eases), and the
  // bays are framed again over the same time.
  card.classList.add('hubslide'); clearTimeout(card._slide); card._slide = setTimeout(() => card.classList.remove('hubslide'), 320);
  hubPlace(card);
  fitHub(false, 280);
}
/** The bays, and how the Center frames them: south up, as a rider stands at the Center facing the hall from 500
 *  North; in to the bays' own zoom at the least, whatever covers the map. */
function hubBounds() { const bb = new maplibregl.LngLatBounds(); for (const b of D.hub.bays) bb.extend([b.lon, b.lat]); return bb; }
/** Which way the Center faces: south up, as its benches do, unless the rider turned it north (its compass button). */
const hubBearing = () => pref('hub-up') === 'north' ? 0 : 180;
const hubFit = () => ({ margin: wide() ? 100 : HUB_M, bearing: hubBearing(), minZoom: HUB_Z + 0.2, maxZoom: wide() ? 19 : 18.4 });   // beside a wide panel, the bays fill the map (it was a third of it)

/** The tiles of the views a tab will ask for, built ahead while the map sits idle: the Center's bays, and the town as
 *  the Map tab shows it. Built only when first shown, each was gray a beat after its tab was tapped, seconds after
 *  the app had opened with nothing else to do: opened on the Center, the town's tiles waited for the Map tab, and
 *  the other way round. MapLibre has no way to load a view it isn't showing, so this reaches into its tile manager
 *  (the vendored build, pinned; anything not as expected and it does nothing): a view's tiles by its own covering,
 *  asked for beside the ones on screen, and each put in its cache the moment it's in, before a frame is drawn. Left
 *  among the tiles on screen, a frame readied its labels for drawing while placing none of them: their buffers made
 *  empty, and once that view was shown every frame threw on them ("length of new data ... current length of 0"). */
let warmStyle = null, warmExtra = [], warmAt = 0;
function warmViews() {
  // Topped up, not built once: browsing elsewhere lets the tiles kept aside go (MapLibre keeps 120 or so out of
  // view), and the near view moves with the rider. Each time the map rests, at most every ten seconds, what's missing.
  if (!map || !ready || !map.style || warmExtra.length || (warmStyle === map.style && Date.now() - warmAt < 10000) || map.isMoving()) return;
  warmAt = Date.now();
  const T = map.style.tileManagers && map.style.tileManagers.protomaps;
  if (!T || typeof T.update !== 'function' || typeof T._updateRetainedTiles !== 'function' || typeof T._addTile !== 'function' || typeof T._tileLoaded !== 'function'
    || typeof T._removeTile !== 'function' || !T._inViewTiles || !T._outOfViewCache || typeof T._outOfViewCache.has !== 'function' || !T.transform || typeof T.transform.clone !== 'function') return;
  warmStyle = map.style;
  try {
    if (!T._warmed) {
      const retain = T._updateRetainedTiles, loaded = T._tileLoaded;
      let ideal = new Set();
      T._updateRetainedTiles = function (ids, z) {
        ideal = new Set(ids.map(i => i.key));
        const kept = retain.call(this, ids, z);
        for (const id of warmExtra) if (!ideal.has(id.key)) { this._addTile(id); kept[id.key] = id; }
        return kept;
      };
      T._tileLoaded = function (tile, ...rest) {
        const r = loaded.call(this, tile, ...rest), k = tile.tileID.key;
        if (warmExtra.some(id => id.key === k)) {
          warmExtra = warmExtra.filter(id => id.key !== k);
          if (!ideal.has(k) && this._inViewTiles.getTileById(k) === tile) this._removeTile(k);   // to the cache, undrawn
        }
        return r;
      };
      T._warmed = true;
    }
    const bb = hubBounds(), fit = frameCam(bb, hubFit()), hz = fit ? fit.zoom : 18, home = homeBounds() && frameCam(...homeView(meGeo)), cams = home ? [{ center: home.center, zoom: home.zoom }] : [];
    if (bornCam) cams.push(bornCam);
    // Where the map rests, a zoom level in and out: a pinch crosses into the next level's tiles mid-gesture (13 to 14,
    // 14 to 15), and those built then, uploaded mid-zoom, were its stutters. Past 15 the tiles are 15's, drawn larger.
    const z0 = map.getZoom(), here = map.getCenter();
    for (const z of [Math.floor(z0) + 1, Math.floor(z0) - 1]) if (z >= 10 && z <= 15) cams.push({ center: here, zoom: z + 0.5, bearing: map.getBearing() });
    if (beforeHub) cams.push(beforeHub);
    // The town, as the Map tab frames it from the Transit Center (frameHome): the near view was built ahead and the
    // town wasn't, gray a long beat after the tab was tapped there.
    const town = homeBounds() && frameCam(homeBounds(), HOME_FIT);
    if (town) cams.push({ center: town.center, zoom: town.zoom });
    for (const z of [hz - 0.4, hz, hz + 0.4]) cams.push({ center: bb.getCenter(), zoom: Math.min(18.4, Math.max(HUB_Z, z)), bearing: hubBearing() });
    // The zooms between, along the flight from the town to the bays (fitHub): its middle drawn toward the Center and
    // its turn half made as it comes in, so none is built mid-flight, gray till it is.
    if (home) for (const z of [14, 15, 16, 17]) {
      const k = Math.max(0, Math.min(1, (z - home.zoom) / Math.max(0.1, hz - home.zoom))), c = bb.getCenter(), h = maplibregl.LngLat.convert(home.center);
      cams.push({ center: [h.lng + (c.lng - h.lng) * k, h.lat + (c.lat - h.lat) * k], zoom: z, bearing: hubBearing() * k });
    }
    const want = new Map();
    for (const c of cams) for (const id of tilesFor(T, c)) if (!T._inViewTiles.getTileById(id.key) && !T._outOfViewCache.has(id)) want.set(id.key, id);
    if (!want.size) return;
    warmExtra = [...want.values()];
    // Its tiles are fitted to the view only when the map moves (a repaint alone doesn't): asked here, at the view as it is.
    const refit = () => T.update(T.transform, T.terrain);
    refit();
    // Any not in after a while (the tiles slow to come): let go, not kept loading beside the view for good.
    setTimeout(() => { if (warmExtra.length) { warmExtra = []; if (!map.isMoving()) refit(); } }, 8000);
  } catch { warmExtra = []; }
}
/** The tiles MapLibre would want for a camera, a little past the screen's edges: its own covering, run on a copy of
 *  the map's transform, with nothing added or let go. */
function tilesFor(T, cam) {
  const box = map.getContainer(), tr = T.transform.clone();   // the map's own, as the tiles were last fitted to it
  tr.resize(Math.round((box.clientWidth || 400) * 1.3), Math.round((box.clientHeight || 300) * 1.3));
  tr.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
  tr.setBearing(cam.bearing || 0); tr.setZoom(cam.zoom); tr.setCenter(maplibregl.LngLat.convert(cam.center));
  const retain = T._updateRetainedTiles, was = T.transform;
  let got = [];
  T._updateRetainedTiles = function (ids) {
    got = ids;
    const keep = {};
    for (const k of this._inViewTiles.getAllIds()) keep[k] = this._inViewTiles.getTileById(k).tileID;
    return keep;
  };
  try { T.update(tr, T.terrain); } finally { T._updateRetainedTiles = retain; T.transform = was; if (was) T.updateCacheSize(was); }
  return got;
}

/** The map's height the bays need on a phone: the arc across the width, south up, its badges and their tags clear of
 *  the search bar above it and the board below. */
const HUB_M = 52;   // the margin round the bays on a phone: room for a bus on a top badge, and 500 North below
function hubRoom() {
  let w = 180, n = 90, e = -180, so = -90;
  for (const b of D.hub.bays) { w = Math.min(w, b.lon); e = Math.max(e, b.lon); so = Math.max(so, b.lat); n = Math.min(n, b.lat); }
  const my = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const spanX = (e - w) / 360, spanY = (my(so) - my(n)) / (2 * Math.PI);   // as fractions of the world
  const width = map.getContainer().clientWidth - 2 * HUB_M;
  const z = Math.min(18.4, Math.max(HUB_Z + 0.2, Math.log2(width / (512 * spanX))));
  return Math.round(topCover() + 2 * HUB_M + spanY * 512 * 2 ** z);
}
let hubFlew = false;   // the Center flown to (from a view with it on screen): the way back is flown too, where it's to such a view
function fitHub(arriving = false, duration = 700, fly = false) {
  // Where the map was, for the Map tab to go back to: kept from the arrival, not from a route picked after a zoom out.
  // Arrived at from the map zoomed in on the Center already (its badges up), that's where it was: it was kept only when
  // the Center's view was off, and the Map tab went back to a view from before, the town's.
  if (arriving) beforeHub = { center: map.getCenter(), zoom: map.getZoom() };
  // Arriving from another tab it was there at once: the flight from the town down to the bays, turning half round on
  // the way, loaded the streets at every zoom between and re-placed every label, frame by frame, 700 ms of a phone's
  // work. With the zooms between built ahead (warmViews) and the map lighter to draw, it flies again, briefly, where
  // the map was already on screen (the Map tab, a wide screen), and the half turn is seen rather than sprung: not with
  // less motion asked for, nor on a weak device. Framed again from the Center itself (its tab tapped again), it moves.
  // Only from where the Center's on screen: from Fairview's near view, 30 km and six zoom levels off, the flight
  // crossed the valley in half a second with nothing built ahead of it (warmViews builds the town's way down), and
  // stuttered. From further out it's there at once, as it was.
  const flies = fly && !WEAK && !matchMedia('(prefers-reduced-motion: reduce)').matches && map.getBounds().contains([D.hub.lon, D.hub.lat]);
  if (arriving) hubFlew = flies;
  if (!frame(hubBounds(), { ...hubFit(), duration: arriving ? (flies ? 550 : 0) : duration })) return;
  hubTurned = true; northDue = false;
}

/** A route in view paints every stop it calls at in its own colour; otherwise a stop wears its first route's. */
function tintStops(m, ri) {
  const dk = dark(), base = ['get', dk ? 'dcolor' : 'color'];
  const c = ri === undefined ? null : lineInk('#' + D.routes[ri].color);
  const fill = c ? ['case', ['in', ri, ['get', 'routes']], c, base] : base;
  for (const id of ['stops', 'stops-lit']) {
    const ring = ['any', ['get', 'closed'], ['get', 'maybe']];   // closed, or an unannounced detour's (its ? in the ring)
    m.setPaintProperty(id, 'circle-color', ['case', ring, dk ? '#101214' : '#f2f2f3', fill]);
    m.setPaintProperty(id, 'circle-stroke-color', ['case', ring, fill, dk ? '#101214' : '#ffffff']);
  }
  m.setPaintProperty('stop-selected', 'circle-color', fill);
}

/** The stretches of each route the day's last bus has been by: for each way, each stop's last call today (the
 *  timetable's, the feed's where its bus is out), and a stretch between two stops passed once that last bus has left
 *  the far one. Per stop, not per route: a last run that turns back partway (16, 12) leaves the rest to the run
 *  before it, and each part fades when its own last bus has gone. Each passed stretch, as [route, from, to] stop
 *  indices. None from midnight on: the next day's last calls are all to come. */
let passedAt = '', passed = [], lastDay = null, lastRows = [];
function passedRuns(c = now()) {
  const key = c.ymd + ':' + c.min;   // once a minute: the live feed's word on the last buses with it
  if (key === passedAt) return passed;
  passedAt = key; passed = [];
  // The timetable's last calls worked out once a day; only the feed's word on them each minute.
  if (lastDay !== c.ymd) {
    lastDay = c.ymd;
    lastRows = [];
    for (let ri = 0; ri < D.routes.length; ri++) for (const [dir, seq] of Object.entries(D.routes[ri].stops || {})) {
      // this way's calls only: the Center's stop is the end of one way and the start of the other
      lastRows.push([ri, seq, seq.map(si => timesOn(si, c.ymd).filter(t => t.r === ri && !t.prov && String(t.dir) === dir).reduce((m, t) => !m || t.min > m.min ? t : m, null))]);
    }
  }
  for (const [ri, seq, rows] of lastRows) {
    const last = rows.map(t => { if (!t) return null; const l = t.min < c.min - 120 ? t : lively(t); return l.gone ? -1 : l.min; });   // long gone: no need to ask the feed
    for (let i = last.length - 1; i >= 0 && last[i] === null; i--) last[i] = i ? last[i - 1] : null;   // the last stop, no call of its own: as the one before
    // stop to stop: a run passed end to end on a round trip starts and ends at the Center, a cut of nothing
    for (let i = 1; i < seq.length; i++) if (last[i] !== null && last[i - 1] !== null && c.min > last[i] && seq[i] !== seq[i - 1]) passed.push([ri, seq[i - 1], seq[i]]);
  }
  return passed;
}
/** A picked route, or a bus's loop, drawn on top at full strength; every other line faded back. With a way on drawn
 *  from a bus or stop (`soft`), everything fades back, the lit route too, so the way stands out from the road. */
function litLines(m, lines, loops, soft = false) {
  m.setFilter('route-on', ['in', ['get', 'route'], ['literal', lines]]);
  m.setFilter('route-arrows', ['in', ['get', 'route'], ['literal', soft ? [] : lines]]);   // a way on's strands carry the arrows then
  m.setFilter('usu-line-on', ['in', ['get', 'id'], ['literal', loops]]);
  const any = lines.length > 0 || loops.length > 0 || soft, dk = dark();
  m.setPaintProperty('route-on', 'line-color', ['get', soft ? (dk ? 'dsoft' : 'soft') : dk ? 'dcolor' : 'color']);
  // Nothing picked: the stretches the day's last bus has been by (passedRuns) drawn faded at the town's zoom, what's
  // still to be run tonight standing out; in at the streets, every line as ever.
  const own = dk ? 'dcolor' : 'color', gone = dk ? 'dgone' : 'gone';
  m.setPaintProperty('route-lines', 'line-color', any ? ['get', dk ? 'dfade' : 'fade'] : ['interpolate', ['linear'], ['zoom'], 13, ['case', ['==', ['get', 'done'], true], ['get', gone], ['get', own]], 15, ['get', own]]);
  m.setPaintProperty('route-lines', 'line-opacity', any ? 1 : 0.75);
  m.setPaintProperty('usu-lines', 'line-opacity', any ? 0.25 : ['case', ['get', 'approx'], 0.35, 0.9]);
}

/** `go`: to the stop's page (a tap); false, the stop picked on the map alone (a page already up, a shuttle stop's at
 *  the same pole). */
function select(id, app, fly = false, zoomIn = false, go = true) {
  clearSpot();
  const si = id ? D.stopById[id] : undefined;
  // A route in view (its page, or the Map tab's route) stays in view for a stop of its own, or none: its times stay.
  const keep = focusRoute !== undefined && (si === undefined || stop(si).routes.includes(focusRoute));
  // A stop draws the way its buses go on from it (both ways of a road can't be told apart lit whole); the hub, where
  // every route calls, lights them all.
  selected = id; selectedBus = null; selectedU = null; uHilite = ''; hiLoops = []; ringed = null; wantRing = null; hiLines = keep ? [focusRoute] : si !== undefined && stop(si).hub ? [...stop(si).routes] : [];
  if (!keep) focusRoute = undefined;
  applySelection();
  routeTimesSoon(focusRoute !== undefined ? focusRoute : null, now());
  const card = col.querySelector('#mapcard');
  if (!id) { card.classList.remove('open', 'peek'); return; }
  if (si === undefined) return;
  const s = stop(si);
  if (!go) return;
  // A stop is its page, wherever it's tapped: a phone's is the map with the page as its sheet, opening down to the
  // next buses; beside the panel, the panel's. There was a card first, the page's first lines again with an Open
  // button under them, a tap more for what was already there.
  if (new RegExp('^#/stop/' + id + '(?:[/?]|$)').test(location.hash)) {
    // Tapped again on the map: closer in.
    if (zoomIn === 'closer') frame([s.lon, s.lat], { zoom: Math.min(18, Math.max(16, map.getZoom() + 1.5)), duration: 650 });
    return;
  }
  // From one stop to the next on the map, the address replaced: Back is the map, not each stop tapped on the way.
  const to = '#/stop/' + id;
  if (STOP_PAGE.test(location.hash)) location.replace(to); else location.hash = to;
}
/** A stop's page, or a shuttle stop's (or an old link to either on the map): the address a stop tapped replaces. */
const STOP_PAGE = /^#\/(stop\/|usu\/(?!route\/)|map\/(\d|usu\/))/;
/** What can wait a frame: a card drawn and on screen first, the tap answered at once; its times worked out and put in
 *  just after, the first chance the phone has once that frame is painted. */
const afterPaint = f => requestAnimationFrame(() => setTimeout(f, 0));
/** The routes (and shuttle loops) drawn within r px of a point: a road's, as a tap takes them and a hover lights them. */
function linesNear(p, r) {
  const layers = ['route-hover', 'route-on', 'route-lines', 'usu-line-on', 'usu-lines'].filter(id => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
  const fs = map.queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers });
  return { rs: [...new Set(fs.filter(f => f.source !== 'ulines').map(f => f.properties.route))].sort((a, b) => a - b), us: [...new Set(fs.filter(f => f.source === 'ulines').map(f => f.properties.id))] };
}
/** The pointer over a route, a shuttle loop or a stop, on a desktop: drawn up on the map, and their badges in the panel
 *  ringed. From the panel (a badge, a stop's row) or the map (its lines) alike; nothing, everything back. */
let hoverKey = '';
export function hover({ rs = [], us = [], stop = '' } = {}) {
  // Only on the home page with nothing picked: anywhere else, or with a stop, bus, route or way up, the map is already
  // saying something, and a line lit under the pointer would talk over it.
  const quietHome = ['', '#', '#/'].includes(location.hash) && selected === null && selectedBus === null && selectedU === null && !uHilite
    && focusRoute === undefined && !hiLines.length && !hiLoops.length && !JR && !MT.R && !hubOn && !spotUp;
  if (!quietHome) rs = [], us = [], stop = '';
  const key = rs.join(',') + '|' + us.join(',') + '|' + stop;
  if (key === hoverKey || !map || !ready) return;
  hoverKey = key;
  map.setFilter('route-hover', ['in', ['get', 'route'], ['literal', rs]]);
  if (map.getLayer('usu-hover')) map.setFilter('usu-hover', ['in', ['get', 'id'], ['literal', us]]);
  map.setFilter('stop-hover', ['==', ['get', 'id'], stop]);
  for (const el of document.querySelectorAll('.hov')) el.classList.remove('hov');
  for (const ri of rs) for (const el of document.querySelectorAll(`[data-r="${ri}"]`)) el.classList.add('hov');
  for (const id of us) for (const el of document.querySelectorAll(`[data-u="${CSS.escape(id)}"]`)) el.classList.add('hov');
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
  // Its bus stop out of the timetable (tools/pool.py marks it gone each night it's missing, and not once it's back):
  // not served for now, as during construction.
  const shut = s.gone ? html`<div class="callout alert">${icon('ban', 20)}<div><b class="warnmark">Not served right now</b><div class="sub">The bus stop here is out of service right now.</div></div></div>`
    : poolClosed(s) ? html`<div class="callout alert">${icon('ban', 20)}<div><b class="warnmark">Closed with the bus stop here</b><div class="sub">A notice closes the stop at this spot, and the pickup with it. Book from the nearest open pickup instead.</div></div></div>` : !poolRunning() ? html`<div class="callout">${icon('moon', 20)}<div><b>POOL isn't running right now</b><div class="sub">${POOL.hours}.</div></div></div>` : '';
  card.innerHTML = html`<div class="grip"></div><div class="head"><span class="eyebrow">POOL pickup · on demand · zero fare</span><div class="name"><span>${s.name}</span></div>${shut}
      <div class="muted">${D.agency.brand}'s on-demand ride around ${POOL.towns.slice(0, 4).join(', ')}: book it and a van comes to this point. Same-day bookings twenty minutes ahead or more.</div>
      <div class="muted">${POOL.hours}.</div></div>
    <div class="open"><a class="btn btn-primary btn-lg btn-block blueprint" href="${appHref}" target="_blank" rel="noopener">${corners()}Book in the On-Demand app</a><a class="btn btn-secondary btn-lg blueprint" href="tel:${POOL.phone}">Call</a></div>`;
  card.classList.remove('hidden');
  requestAnimationFrame(() => {
    card.classList.add('open');
    frame([s.lon, s.lat], { zoom: Math.max(map.getZoom(), 15), duration: 650, essential: true });
  });
}


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
// Written only when it changes, in steps of a tenth: set every frame of a zoom, the size restyled every bus marker
// (and redrew its shadow) at every frame, which a cheap tablet's zoom felt as a low frame rate. A few steps across a
// zoom look the same.
let busScaleAt = null, busSmallAt = null;
function busScale() {
  if (!map) return;
  const z = map.getZoom();
  const scale = (Math.round((z >= 14 ? 1 : z >= 12 ? 0.45 + (z - 12) * 0.275 : Math.max(0.2, 0.45 - (12 - z) * 0.125)) * 10) / 10).toFixed(1), small = z < 13;
  const c = map.getContainer();
  if (scale !== busScaleAt) { busScaleAt = scale; c.style.setProperty('--bus-scale', scale); }
  if (small !== busSmallAt) { busSmallAt = small; c.classList.toggle('bus-small', small); }
}
const ARROW = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 3 20 20l-8-4-8 4z"/></svg>';
/** A bus fades when the rider has lit something else: a Connect route or a shuttle loop that isn't its own. */
/** A way drawn for another day: no bus out now is one of its. */
const wayLater = () => !!(JR && JR.plan && JR.plan.ymd !== now().ymd);
/** A run drawn: the bus running it (or the feed's for it), today; none else is its. The route's every bus was bright
 *  on it, and the 5:30 twelve half way to Hyrum stood on the 6:00's line as if it were the 6:00's. */
function runBusId() {
  const R = MT.R;
  if (!R || R.trip === undefined || R.ymd !== now().ymd) return null;
  const b = rideBus({ t: { trip: R.trip } });
  return b ? b.id : null;
}
function dimBus(m) {
  if (wayLater()) return true;
  if (MT.R) return m.id !== runBusId();
  if (JR && JR.appBus) return m.id !== JR.appBus;   // a way drawn with its bus coming: that bus alone, the rest dim
  const on = hiLines.length ? hiLines : runRoutes;
  if (m.kind === 'c') return (on.length > 0 && !on.includes(m.ri)) || hiLoops.length > 0;
  return hiLoops.length > 0 && !hiLoops.includes(U.routes[m.ri].id);
}
/** A bus's marker as the map is now: dimmed, lit, or on a way drawn not its own, not there at all (the buses parked
 *  at the Center, dimmed, lay over the way's end ring there, five deep). */
function paintBus(m) {
  const dim = dimBus(m);
  m.el.classList.toggle('dim', dim);
  m.el.classList.toggle('lit', litBus(m));
  m.el.classList.toggle('away', !!JR && dim);
}
/** A bus on a lit route or loop: drawn at full size and tappable however far out the map is zoomed. */
function litBus(m) {
  if (wayLater()) return false;
  if (MT.R) return m.id === runBusId();
  if (JR && JR.appBus) return m.id === JR.appBus;
  return m.kind === 'c' ? hiLines.includes(m.ri) || runRoutes.includes(m.ri) : hiLoops.includes(U.routes[m.ri].id);
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
/** The part of the map left clear, as its margins: the search bar and any notice across the top; on a phone the sheet
 *  up over the bottom (the run's, or the map's card as it rests, the Center's board down to where it rests); on a
 *  wide screen the card in its bottom right corner, a column the map's height. The panel is the map's own padding
 *  (pad) already. */
function room() {
  const card = col.querySelector('#mapcard'), H = map.getContainer().clientHeight, r = { top: topCover(), bottom: 0, left: 0, right: 0 };
  const up = !!card && card.classList.contains('open') && getComputedStyle(card).visibility !== 'hidden';
  if (!wide()) {
    const rs = document.querySelector('#runsheet .rs');
    r.bottom = rs ? rs.offsetHeight : !up ? 0 : card.querySelector(':scope > .hubsheet') && hubRest ? H - hubRest : card.offsetHeight;
  } else if (up) r.right = card.offsetWidth + 16;
  return r;
}
const MIN_ROOM = 120;   // what's framed gets this much height at least, whatever covers the map
/** Where a place goes in the room left (room): a shape (bounds) fitted with a margin round it, between minZoom and
 *  maxZoom; a point ([lon, lat]) at `zoom`, or the map's own. Its middle in the room's middle at whatever zoom it
 *  comes to (a fit's own centre is right only at the fit's own zoom). `bearing`: turned so (unset, as it is). */
function frameCam(target, { margin, zoom, minZoom = 0, maxZoom = 19, bearing } = {}) {
  const r = room(), H = map.getContainer().clientHeight, m = margin ?? (wide() ? 40 : 16);
  const p = { top: r.top + m, bottom: r.bottom + m, left: r.left + m, right: r.right + m };
  p.bottom = Math.min(p.bottom, Math.max(m, H - p.top - MIN_ROOM));
  const brg = bearing ?? map.getBearing();
  let z = zoom ?? map.getZoom(), center = target;
  if (!Array.isArray(target)) {
    if (target.isEmpty()) return null;
    const cam = map.cameraForBounds(target, { padding: p, maxZoom, bearing: brg });
    if (!cam) return null;
    z = cam.zoom; center = midOf(target);
  }
  return { center, zoom: Math.min(maxZoom, Math.max(minZoom, z)), bearing: brg, offset: [(p.left - p.right) / 2, (p.top - p.bottom) / 2] };
}
/** Framed: every stop, route, run, way, the Center, a spot, an alert's stops, all in the one room, the one way. There
 *  were five reckonings of the room (the panel alone, the search bar and a run's sheet, those and a phone's card, a
 *  card's corner for a point, the Center's own) and nine margins among them, and a fix to one missed the rest. */
function frame(target, { duration = 600, essential = false, ...o } = {}) {
  settlePad();
  const c = frameCam(target, o);
  if (c) map.easeTo({ ...c, duration, essential });
  return c;
}
/** A box's middle as the map draws it (Mercator), not its latitudes' average. */
function midOf(b) {
  const my = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)), y = (my(b.getNorth()) + my(b.getSouth())) / 2;
  return [(b.getWest() + b.getEast()) / 2, (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI];
}
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
/** The Map tab's own view: where the service is, from the timetable, not a point picked by hand. Each stop weighed by
 *  its departures in a day (today's, or the next day with buses), the middle 80% of them north to south and east to
 *  west, and the Transit Center; framed to the screen as anything else is. Logan, North Logan, Hyde Park, Providence,
 *  River Heights; the long arms (Smithfield, Richmond, Hyrum, Wellsville) run off its edges. It was a point 800 m
 *  south of the Center at zoom 13 on every screen: downtown alone on a phone, the north end cut off on a desktop. */
let homeB = null;
function homeBounds() {
  if (homeB) return homeB;
  let ymd = now().ymd;
  if (!servicesOn(ymd).size) ymd = nextServiceDay(now()) || ymd;
  const pts = [];
  D.stops.forEach((s, i) => { const n = timesOn(i, ymd).length; if (n) pts.push([s.lon, s.lat, n]); });
  if (!pts.length) return null;
  const at = (k, p) => {
    const xs = pts.map(x => [x[k], x[2]]).sort((a, b) => a[0] - b[0]), total = xs.reduce((t, x) => t + x[1], 0);
    let acc = 0;
    for (const [v, w] of xs) { acc += w; if (acc >= p * total) return v; }
    return xs[xs.length - 1][0];
  };
  const b = new maplibregl.LngLatBounds([at(0, 0.1), at(1, 0.1)], [at(0, 0.9), at(1, 0.9)]);
  if (D.hub) b.extend([D.hub.lon, D.hub.lat]);
  return (homeB = b);
}
const HOME_FIT = { bearing: 0, maxZoom: 14 };
let meGeo = null;   // the rider's last fix, as the map has it
/** The near view: the rider and the four stops the home page lists as nearest, marked with their names, wherever they
 *  are in the valley (20 km of a stop: downtown it's their block, from Fairview Lewiston's and Franklin's). Without a
 *  fix, or out of the valley, the town's own view. (It was the town stretched to take them in, and them close up.) */
function homeView(geo) {
  const b = homeBounds(), fit = { ...HOME_FIT };
  // At the Transit Center: the Center and the first stop each route makes on its way out (within 700 m, a walk): every
  // way out in view, Main Street and 500 North, Route 9 west, marked with their names. Its nearest street stops were a
  // ring two blocks off, Main just out of the picture.
  if (b && geo && D.hub && distance(geo.lat, geo.lon, D.hub.lat, D.hub.lon) <= 150) {
    const outs = firstStopsOut().filter(si => distance(D.hub.lat, D.hub.lon, D.stops[si].lat, D.stops[si].lon) <= 700);
    if (outs.length) {
      const box = new maplibregl.LngLatBounds([geo.lon, geo.lat], [geo.lon, geo.lat]).extend([D.hub.lon, D.hub.lat]);
      for (const si of outs) box.extend([D.stops[si].lon, D.stops[si].lat]);
      return [box, { ...fit, maxZoom: 16, margin: wide() ? 80 : 56 }, outs.map(si => D.stops[si].id)];
    }
  }
  const four = geo ? nearFour(geo).filter(x => x.d < 20000) : [];
  if (!b || !four.length) return [b, fit];
  const out = new maplibregl.LngLatBounds([geo.lon - 0.0015, geo.lat - 0.001], [geo.lon + 0.0015, geo.lat + 0.001]);   // a little round them: not on the edge
  for (const x of four) out.extend([D.stops[x.i].lon, D.stops[x.i].lat]);
  return [out, { ...fit, maxZoom: 16, margin: wide() ? 80 : 56 }, four.map(x => D.stops[x.i].id)];   // room for their names
}
/** The first stop each route makes after the Transit Center, from the timetable's stop orders: where each way out
 *  goes. Worked out once. */
let outsOf = null;
function firstStopsOut() {
  if (outsOf) return outsOf;
  const set = new Set();
  for (const r of D.routes) for (const seq of Object.values(r.stops || {})) for (let k = 0; k < seq.length - 1; k++) if (D.stops[seq[k]].hub && !D.stops[seq[k + 1]].hub) set.add(seq[k + 1]);
  return (outsOf = [...set]);
}
/** The rider's four nearest stops, as the home page lists them (its big one and the three beneath): by the walk. */
const nearFour = g => byWalk(nearest(g.lat, g.lon, 24).filter(x => !D.stops[x.i].hub), g.lat, g.lon).slice(0, 4);
let nearBy = null, nearIds = [];   // whose marks they are (the near view's, 'home', or a no-way map's, 'none'), and which
/** Marked at any zoom, with their names: out in the valley the near view is wider than stops are drawn. Kept, and put
 *  on the map once its style is in (a first open straight onto the near view marks them before it is), or again. */
function markNear(ids = [], by = null) {
  nearBy = ids.length ? by : null; nearIds = ids;
  if (!map || !map.getLayer('stops-near')) return;
  for (const id of ['stops-near', 'stops-near-labels']) map.setFilter(id, ['in', ['get', 'id'], ['literal', ids]]);
}
/** The Map tab's view: the near view on arriving, and the town's (without the rider) when it's tapped again on the map
 *  with a fix, from the near view untouched or from the town's already: one way, out. Moved off the near view first,
 *  a tap brings it back. */
let townTap = false;
function frameHome(app, duration, again = false) {
  // At the Transit Center (150 m, as the home page's card has it) the tab opens on the town: the Center close up is its
  // own tab, and what the map adds there is the routes and the buses on their way in. The locate button still gives
  // the streets round about.
  const atHub = !!app.geo && !!D.hub && distance(app.geo.lat, app.geo.lon, D.hub.lat, D.hub.lon) <= 150;
  const town = !!app.geo && (atHub || again && (townTap || !movedSinceHome()));
  if (town) { townTap = true; homeRest = null; markNear(); frame(homeBounds(), { ...HOME_FIT, duration }); return; }
  toNear(app.geo, duration);
  townTap = false;
}
/** The near view framed (by either button), and where the map comes to rest noted, for the Map tab's next step. */
function toNear(geo, duration) {
  const [t, f, ids] = homeView(geo);
  markNear(/^#\/map/.test(location.hash) ? ids : [], 'home');   // the map made under another page (a stop, directions): theirs, not these
  const rest = () => { const c = map.getCenter(); homeRest = { zoom: map.getZoom(), lat: c.lat, lon: c.lng }; };
  map.once('moveend', rest);
  if (!frame(t, { ...f, duration })) { map.off('moveend', rest); rest(); }
}
/** Where the map is first made (before it has a size to fit the home view to): the home view's middle. */
const homeCentre = () => { const b = homeBounds(); return b ? b.getCenter().toArray() : [D.hub.lon, D.hub.lat]; };
let resetDue = false;   // asked for as the Map tab opens: done once it's drawn (the panel's room going would stop it)
export function resetView(app, once = false, to = null, jump = false, due = false) {
  if (once) { resetDue = true; return; }
  if (!map) return;
  selectedBus = null; selectedU = null; lastFocused = null; hubTurned = false; northDue = false;
  focusRoute = undefined; ringed = null; wantRing = null;   // a route up goes too: select() alone would keep it lit
  select(null, app);
  // Back from the Center (jump 'hub'): the flight there in reverse, the half turn unwound, as briefly; at once where
  // the flight in was (less motion asked for, a weak device).
  const backTo = !to && jump === 'hub' && homeView(app.geo)[0];   // back from the Center to the near view: flown only if the Center's in it
  const still = jump === true || matchMedia('(prefers-reduced-motion: reduce)').matches || jump === 'hub' && (WEAK || !hubFlew || (backTo && !backTo.contains([D.hub.lon, D.hub.lat])));
  const duration = still ? 0 : jump === 'hub' ? 550 : 600;
  if (to) map.easeTo({ padding: pad(), center: to.center, zoom: to.zoom, bearing: 0, duration });
  else frameHome(app, duration, !due);
}
/** The Map tab from the Transit Center: the map as it was before the Center framed itself, north up, nothing picked
 *  (a tab keeps its place; a second tap is the reset). The whole of Logan when the app opened at the Center. Done
 *  once the Map tab is drawn, as the reset is. */
let beforeHub = null, backDue = false, stayOff = false, stayAt = null;
/** Leaving the Center for the Map tab, the map kept (its north button, a tap off the board): where the rider was
 *  looking, the middle of what the board left in view, to keep in the middle once the map is turned north. */
function leaveHubKept() {
  const box = map.getContainer(), r = room(), left = padLeft || 0;
  // The board's own rest, not the card's state: a tap on the map has put the card away by now (select), and the
  // middle of the whole map, under the board, was kept instead of what the rider could see.
  if (!wide() && hubRest) r.bottom = Math.max(r.bottom, box.clientHeight - hubRest);
  const x = left + (box.clientWidth - left + r.left - r.right) / 2, y = (r.top + box.clientHeight - r.bottom) / 2;
  stayAt = map.unproject([x, y]); stayOff = true; location.hash = '#/map';
}   // stayOff: the Center left by a tap off its board, the map kept
export function leaveHub() { backDue = true; }
/** The Transit Center tab tapped at the Center: framed again, as the tab first framed it (the rider may have zoomed
 *  out or panned off), and on a phone its board back up if it was put away. */
export function hubAgain(app) {
  if (!map) return;
  fitHub();
  if (!wide() && app.route.name === 'map' && !col.querySelector('#mapcard.open > .hubsheet')) hubCard(now());
}

/** Search the map from outside it: the header's box on a wide screen. Set once the map is up. */
export let mapSearch = () => {};

export function liveUpdate(app) {
  if (rtShown !== null) routeTimes(rtShown, now());   // the feed's word moves a route's next buses
  if (!map) return;
  if (selectedBus || ringed || JR) drawRuns();   // the line follows the bus (a way's bus, coming to it, too)
  const seen = new Set();
  const place = (b, kind, color, title) => {
    seen.add(b.id);
    let m = busMarkers.get(b.id);
    if (!m) {
      const el = document.createElement('div');
      el.className = kind === 'u' ? 'bus shuttle' : 'bus'; el.innerHTML = '<div class="bus-marker">' + ARROW + '</div>';   // a shuttle bus is drawn apart: its colours are a chart's, and share Connect's
      el.onclick = ev => { ev.stopPropagation(); selectBus(b.id, app); };
      m = { marker: new maplibregl.Marker({ element: el, rotationAlignment: 'map' }), el, ri: b.ri, kind, id: b.id };
      busMarkers.set(b.id, m);
      m.marker.setLngLat([b.lon, b.lat]).addTo(map);
    } else glide(m, b.lon, b.lat);
    m.el.title = title;
    m.el.style.setProperty('--bus-color', color);
    m.marker.setRotation(b.course);
    m.ri = b.ri; m.speed = b.speed; m.to = [b.lon, b.lat];   // where it's gliding to: in or out by that, not by where it's got
    m.el.classList.toggle('on', selectedBus === b.id || ringed === b.id);
    paintBus(m);
  };
  if (U) for (const b of live.buses) place(b, 'u', U.routes[b.ri].color, U.routes[b.ri].name + ' · bus ' + b.name);
  if (!rtStale()) for (const b of rt.buses) place(b, 'c', dark() ? lift('#' + D.routes[b.ri].color) : '#' + D.routes[b.ri].color, routeName(b.ri, false) + ' · bus ' + b.label);
  for (const [id, m] of busMarkers) if (!seen.has(id)) { if (m.anim) cancelAnimationFrame(m.anim); m.marker.remove(); busMarkers.delete(id); }
  if (wantIn && busMarkers.has(wantIn) && /^#\/map\/bus\//.test(location.hash)) busIn(wantIn, app);
  if (wantRing && busMarkers.has(wantRing)) ringBus(wantRing);
  if (hubOn) { hubBadges(); hubBuses(); }
  if (selectedBus) { if (seen.has(selectedBus)) busCard(app); else { selectedBus = null; hiLoops = []; hiLines = []; applySelection(); routeTimesSoon(focusRoute !== undefined ? focusRoute : null, now()); col.querySelector('#mapcard').classList.remove('open'); } }
}
// A cheap tablet (four cores or fewer, or 4 GB or less) spends its frames on the map: its buses jump to each fix.
const WEAK = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
// Move a bus marker to its new fix over 600 ms in geographic coordinates, so the
// glide survives a pan (a CSS transform transition would drag behind the map).
function glide(m, lon, lat) {
  if (m.anim) cancelAnimationFrame(m.anim);
  const from = m.marker.getLngLat();
  if (from.lng === lon && from.lat === lat) return;
  // A weak tablet, a rider who'd rather not, or a map out of sight (built early, or another tab up): straight there.
  if (WEAK || !map.getContainer().clientWidth || matchMedia('(prefers-reduced-motion: reduce)').matches) { m.marker.setLngLat([lon, lat]); return; }
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
  if (c) return '#/map/route/' + encodeURIComponent(D.routes[c.ri].short) + (c.dir !== null && c.dir !== undefined ? '/' + c.dir : '') + '?bus=' + encodeURIComponent(id);
  const b = live.buses.find(x => x.id === id);
  return b ? '#/usu/route/' + U.routes[b.ri].id : null;
}
function selectBus(id, app) {
  clearSpot();
  // Beside the panel (a wide screen, off the Map tab) a bus opens its route there, as a stop opens its page.
  if (wide() && app.route.name !== 'map') { const h = busRouteHref(id); if (h) { location.hash = h; return; } }
  const c = findBus(id), b = c || live.buses.find(x => x.id === id);
  selectedBus = id; selectedU = null; selected = null; uHilite = '';
  // A Connect bus draws its way on, not its whole route: the route's line, if lit, drops back so the bus's reads.
  hiLines = []; hiLoops = b && !c ? [U.routes[b.ri].id] : [];
  applySelection();
  for (const [bid, m] of busMarkers) m.el.classList.toggle('on', bid === id);
  busCard(app, true);   // the bus at once; where it's headed next, with its minutes, the moment after
  afterPaint(() => { if (selectedBus !== id) return; busCard(app); if (c) routeTimesSoon(c.ri, now()); });   // its times along its route: the route's, if up, become this bus's; else its own appear
}
/** A Connect bus: its route and headsign, where it's headed next with the feed's minutes. */
function connectCard(b, app, bare = false) {
  const r = D.routes[b.ri], clockNow = now();
  const next = bare ? [] : busStops(b, 5);
  const card = col.querySelector('#mapcard');
  // The word comes from the next stop the timetable has a row for: never the trip's final one, which on a loop
  // is the stop it left from, an hour's schedule earlier. Only that one left, the card just says Live.
  const at = next.find(n => !n.end);
  const dl = busDelay(b) ?? (at ? at.min - (schedAt(at.si, b) ?? at.min) : null);
  const late = dl !== null && !isLoop(b.ri) ? lateWords(heldAt(nextStopOf(b) ?? (at && at.si), dl)) : '';
  card.innerHTML = html`<div class="grip"></div><div class="head buscard">
    <div class="top"><span class="eyebrow">Bus ${b.label} · heading ${heading(b.course)}</span>${rtStale() ? liveTag('Last seen ' + rtSeen()) : liveTag(late ? 'Live · ' + late : 'Live')}</div>
    <div class="who">${badge(b.ri, 32)}<span class="name">${b.h !== null ? headsign({ h: b.h, r: b.ri, dir: b.dir === null ? undefined : b.dir }) : r.long}</span></div></div>
    ${next.length ? html`<div class="nextstops"><i class="line" style="background:#${r.color}"></i>${next.map((n, i) => html`<a class="ns${i === 0 ? ' here' : ''}" href="#/stop/${D.stops[n.si].id}"><span class="dot"><i style="${i === 0 ? 'background:#' + r.color : ''}"></i></span><span class="nm">${heard(n.si)}</span><span class="when">${n.min - clockNow.min <= 0 ? 'now' : 'in ' + (n.min - clockNow.min) + ' min'}</span></a>`)}</div>` : ''}
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
function busCard(app, bare = false) {
  const c = findBus(selectedBus);
  if (c) return connectCard(c, app, bare);
  const b = live.buses.find(x => x.id === selectedBus);
  if (!b) return;
  const r = U.routes[b.ri];
  const next = !bare && r.shape.length ? busNext(b, 4) : [];
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
  if (U.shared[si]) return select(D.stops[U.shared[si].j].id, app, true, closer ? 'closer' : false);   // one pole, one dot: the Connect stop's page
  // Its page, as a Connect stop's is (select): the card before it said its first lines again with an Open button.
  const s = U.stops[si];
  if (new RegExp('^#/usu/' + id + '(?:[/?]|$)').test(location.hash)) {
    if (closer) frame([s.lon, s.lat], { zoom: Math.min(18, Math.max(16, map.getZoom() + 1.5)), duration: 650 });
    return;
  }
  const to = '#/usu/' + id;
  if (STOP_PAGE.test(location.hash)) location.replace(to); else location.hash = to;
}

/** An address: a pin, and the card lists the stops nearest it. */
function circle(lat, lon, m = 90, n = 40) {
  const dlat = m / 111000, dlon = m / (111000 * Math.cos(lat * Math.PI / 180));
  const ring = [];
  for (let i = 0; i <= n; i++) { const a = i / n * 2 * Math.PI; ring.push([lon + dlon * Math.cos(a), lat + dlat * Math.sin(a)]); }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] };
}
/** The stops along a road's routes a short walk from a point on it, both sides, nearest first; the nearest few on
 *  those routes where none is that near (out in the country). */
function roadStops(at, road) {
  const all = [...new Set(road.flatMap(ri => Object.values(D.routes[ri].stops || {}).flat()))]
    .map(i => ({ i, d: distance(at.lat, at.lon, D.stops[i].lat, D.stops[i].lon) })).sort((a, b) => a.d - b.d);
  const close = all.filter(x => x.d <= 400).slice(0, 6);
  return close.length ? close : all.slice(0, 3);
}
/** A searched place's pin and disc off the map, and the address back to the plain Map tab, so a reload doesn't
 *  bring them back: the rider has moved on to something else, or closed its card. */
function clearSpot() {
  if (pinMarker) pinMarker.remove();
  if (map) setSpot(null);
  if (location.hash.startsWith('#/map/at/')) { history.replaceState(null, '', '#/map'); shownHash = '#/map'; }
}
let spotUp = false;   // a spot tapped or found is on the map (its disc and its card)
function setSpot(at) {
  spotUp = !!at;
  if (at) hover();   // a spot tapped: nothing lit under the pointer over it
  const apply = () => map.getSource('spot') && map.getSource('spot').setData(at ? circle(at.lat, at.lon) : { type: 'FeatureCollection', features: [] });
  if (ready) apply(); else map.once('load', apply);
}
function showAt(at, app, clockNow, forId = null, toFrom = null, road = null) {
  selected = null; uHilite = ''; hiLoops = []; selectedBus = null; selectedU = null;   // a bus picked before is put down: the spot's card is the card
  hiLines = road && road.length === 1 ? [road[0]] : [];   // a road with one route: that route lit, with its times
  applySelection();
  // A soft disc rather than a pin: an address is arithmetic on the town's grid, good to a block, not a survey.
  setSpot(at);
  if (!pinMarker) { const el = document.createElement('div'); el.className = 'spot-marker'; pinMarker = new maplibregl.Marker({ element: el }); }
  pinMarker.setLngLat([at.lon, at.lat]).addTo(map);
  const near = road ? roadStops(at, road) : nearestTo(at.lat, at.lon, 4);
  // The Aggie Shuttle's stops a short walk off too, on a road's card as anywhere, in among Connect's by distance: on
  // campus they're the nearer buses. One at the same pole as a Connect stop is listed as well, its loops and their
  // buses being what its row says (the Connect stop's row says only Connect's).
  const ushare = !U ? [] : nearestUSU(at.lat, at.lon, 6).filter(x => x.d <= 400 && U.stops[x.i].routes.length).slice(0, 3).map(x => ({ ...x, u: true }));
  const rows = [...near, ...ushare].sort((a, b) => a.d - b.d);
  const card = col.querySelector('#mapcard');
  // A start picked for directions: the way there from this spot is the card's one button, the nearest stops under it.
  // Otherwise (a place found, a long press) the spot either end of a journey: to it from where the rider is, or from it
  // to a stop, place or address asked for next.
  const go = forId ? html`<div class="open"><a class="btn btn-primary btn-lg blueprint" href="#/go/${forId}/${atPath(at)}">${corners()}Directions from here</a></div>`
    : toFrom ? html`<div class="open"><a class="btn btn-primary btn-lg blueprint" href="#/go/${spotKey(at.lat, at.lon, at.label)}/${atPath(spotOf(toFrom))}">${corners()}Directions to here</a></div>`
    : html`<div class="open"><a class="btn btn-primary btn-lg btn-block blueprint" href="#/go/${spotKey(at.lat, at.lon, at.label)}">${corners()}Directions to here</a><a class="btn btn-secondary btn-lg blueprint" href="#/go/-/${atPath(at)}">From here</a></div>`;
  // On a road, its routes' next buses only, each with where it's going, and the routes as badges that light them.
  const next = i => nextAt(i, 1, clockNow, 8, road ? t => road.includes(t.r) : undefined)[0];
  const lines = road ? html`<div class="roadroutes">${road.map(ri => html`<button type="button" class="roadroute" data-ri="${ri}" aria-label="${routeName(ri, false)} on the map">${badge(ri, 30)}</button>`)}</div>` : '';
  // The stops at once, their next buses (and a road's route times on the map) the moment after.
  const markup = bare => html`<div class="grip"></div><div class="head"><span class="eyebrow">${forId ? 'Start from' : toFrom ? 'Go to' : road ? 'On this road' : 'Nearest stops to'}</span><div class="name"><span>${at.label || 'this spot'}</span>${road ? '' : placeStar(at)}</div>${lines}</div>${go}
    ${rows.length ? rows.map(x => x.u ? stopRowU(x.i, { dist: metres(x.d) + ' away', bare }) : stopRow(x.i, bare ? null : next(x.i), clockNow, { dist: metres(x.d) + ' away', dest: !!road, bare })) : html`<div class="empty"><p>No stops within ${metres(4000)} of there.</p></div>`}`.s;
  card.innerHTML = markup(true);
  card.querySelectorAll('[data-ri]').forEach(b => { b.onclick = () => pickRoute(+b.dataset.ri, app); });
  const spotKeyNow = 'at:' + at.lat.toFixed(4) + ',' + at.lon.toFixed(4);
  afterPaint(() => {
    if (lastFocused !== spotKeyNow || selected !== null || selectedBus !== null) return;   // something else picked meanwhile
    morph(card, markup(false));
    if (road && road.length === 1) routeTimesSoon(road[0], now());
  });
  card.classList.remove('hidden');
  const key = 'at:' + at.lat.toFixed(4) + ',' + at.lon.toFixed(4), move = lastFocused !== key;
  requestAnimationFrame(() => {
    card.classList.add('open');   // up first: the spot goes above it
    if (move) frame([at.lon, at.lat], { zoom: forId || toFrom ? map.getZoom() : Math.max(map.getZoom(), 14.5), duration: 700 });
  });
  lastFocused = key;
}
/** A stop's page as the map's sheet (a phone's, a portrait tablet's), as a route's stops and the Transit Center's
 *  board are. Opened down to its next two departures, the head and the way here and from here above them; a swipe up
 *  is the rest of the page, scrolling in the sheet; down, its head alone and the map to the finger. Redrawn in place
 *  for the minute and the feed, its scroll kept. */
let pageShown = null;   // the stop page last put in the sheet
function pageSheet(page, app, fresh) {
  const card = col.querySelector('#mapcard');
  const markup = `<div class="grip"></div><div class="pagesheet">${page.html}</div>`;
  // Redrawn in place only while it's up: swiped away, the page is still in the card, and the same stop tapped again
  // came up as a redraw, at the whole card's height, not at its opening one.
  const again = card.dataset.page === page.key && !!card.querySelector(':scope > .pagesheet') && card.classList.contains('open');
  if (!again && !fresh) return;   // a tick with something else in the card (a stop tapped on the map): left be
  if (again) { if (card.lastHtml !== markup) morph(card, markup); }
  else { card.style.removeProperty('--jh'); card.innerHTML = markup; card.scrollTop = 0; card.classList.remove('peek'); }
  card.lastHtml = markup; card.dataset.page = page.key; pageShown = page.key;
  if (page.mount) page.mount(card, app);
  card.classList.remove('hidden');
  // Its opening height is measured again as the page fills in (the live feed, the shuttle's line at the same pole),
  // until the rider first lays a finger on it.
  if (!again) {
    card.dataset.opening = page.key;
    const hands = () => { delete card.dataset.opening; };
    card.addEventListener('touchstart', hands, { once: true, passive: true }); card.addEventListener('pointerdown', hands, { once: true });
  }
  if (card.dataset.opening === page.key) { openingPeek(card); card.classList.add('peek'); card.dataset.tall = '1'; if (!again) setTimeout(() => { if (card.dataset.opening === page.key) openingPeek(card); }, 400); }
  card.classList.add('open');
}
/** The sheet's opening height: down to the next bus, or where that would take more than half the map (a long name,
 *  the road across), or there's none, to the head alone: the stop, its routes, the way there. It went on to the bus
 *  after, and at a stop with a stop across the road that was most of the screen, the map it was tapped on gone. */
function openingPeek(card) {
  const pg = card.querySelector('.pagesheet'), nx = pg.querySelector('.next'), head = pg.querySelector('.head');
  const H = map.getContainer().clientHeight, top = card.getBoundingClientRect().top - card.scrollTop;
  const to = el => el.getBoundingClientRect().bottom - top + 1;
  let h = nx ? to(nx) : Infinity;
  if (h > 0.5 * H) h = head ? to(head) : Infinity;
  if (!isFinite(h)) return fitPeek(card);
  card.style.setProperty('--peek', Math.round(Math.min(h, 0.6 * H)) + 'px');
}
/** A stop framed above its sheet: at the streets, in the middle of the map left over. */
function frameStop(ll) {
  // A run up by the frame (a time opened): the run's framing is the one, however the two land.
  requestAnimationFrame(() => { if (!MT.R) frame(ll, { zoom: Math.max(map.getZoom(), 16), duration: 650, essential: true }); });
}

/** The map asked where the rider will start from, for directions to a stop: the ask on the card, the map left as it is. */
function askSpot(toId, app, dest = false) {
  const sp = spotOf(toId), si = D.stopById[toId], name = sp ? sp.label || 'the spot you picked' : si === undefined ? '' : stop(si).hub ? D.hub.name : stop(si).name;
  selected = null; uHilite = ''; hiLines = []; hiLoops = []; applySelection();
  const card = col.querySelector('#mapcard');
  // Asked where to (a journey from a spot), or where from (to a stop or spot): the same ask, the other way round.
  card.innerHTML = dest ? html`<div class="grip"></div><div class="head"><span class="eyebrow">Directions from ${name}</span><div class="name"><span>Tap where you're going</span></div>
    <div class="muted">A stop, or any spot: the stops you could walk to it from are the end.</div></div>`
    : html`<div class="grip"></div><div class="head"><span class="eyebrow">Directions to ${name}</span><div class="name"><span>Tap where you'll start from</span></div>
    <div class="muted">A stop, or any spot: the stops you could walk to from it are the start.</div></div>`;
  card.classList.remove('hidden', 'peek');
  requestAnimationFrame(() => card.classList.add('open'));
}

/** A search in the panel beside the map: the stops its results start with ringed, as a picked stop is, several at
 *  once, and its places' spots marked; fitted in view when any is off it. Put away with the search. */
let searchKey = null, searchIds = [], searchPins = [], wantMarks = null;
function searchMarks(m) {
  const key = m ? m.stops.join(',') + '|' + m.spots.map(p => p.lat + ',' + p.lon).join(';') : null;
  if (key === searchKey) return;
  searchKey = key;
  for (const p of searchPins) p.remove();
  searchPins = [];
  searchIds = m ? m.stops.filter(id => D.stopById[id] !== undefined) : [];
  applySelection();
  if (!m) return;
  for (const p of m.spots) { const el = document.createElement('div'); el.className = 'spot-marker'; searchPins.push(new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map)); }
  const pts = [...searchIds.map(id => stop(D.stopById[id])).map(s => [s.lon, s.lat]), ...m.spots.map(p => [p.lon, p.lat])];
  if (!pts.length) return;
  // In view is in the part not under the panel or the header's shade.
  const box = map.getContainer(), W = box.clientWidth, H = box.clientHeight, x0 = (padLeft || 0) + 16, y0 = topCover() + 16;
  if (pts.every(p => { const q = map.project(p); return q.x >= x0 && q.x <= W - 16 && q.y >= y0 && q.y <= H - 16; })) return;
  const b = new maplibregl.LngLatBounds();
  for (const p of pts) b.extend(p);
  frame(b, { maxZoom: 16 });
}

/** Called by the router whenever the map is on screen. */
let shownHash = null, lastMeasured = '';
export async function show(o, app, clockNow) {
  if (!/^#\/(map|hub)/.test(location.hash)) { townTap = false; markNear(); }   // the map left (the Center is the map too): the Map tab starts again at the near view
  await showPage(o, app, clockNow);
  // Marked once the map's ready: a reload straight onto a search gets there before its style does.
  wantMarks = wide() && o.searchMarks || null;
  if (map && ready) searchMarks(wantMarks);
  // The minute or the feed: a phone's route sheet redrawn in place, its scroll kept.
  if (o.tick && o.routeArgs && app.route.name === 'map' && !wide() && col.querySelector('#mapcard.open > .routesheet')) sheetCard(o.routeArgs, clockNow);
  // The board is a phone's card whenever the Transit Center is up: redrawn for the minute, and put back when the
  // layout turned phone under it (a tablet turned upright) with the address unchanged.
  if (o.hub && app.route.name === 'map' && !wide() && (o.tick ? !!col.querySelector('#mapcard.open > .hubsheet') : !col.querySelector('#mapcard.open > .hubsheet'))) hubCard(clockNow);
  if (o.tick) hubBadges();
  if (!o.hub && hubBay !== null) { hubBay = null; hubBadges(); }   // off the Transit Center: no route picked on its badges
  // Off the Center to another tab: a page that frames something of its own (a stop, a route, a way) gets north up and
  // frames it; any other (Stops, search, About, the Map tab) gets the map back as it was before the Center, at once.
  // North alone left a desktop's map on the bays, turned: Transit Center, Stops, then Map never came out again.
  if (!o.hub && hubTurned && !o.tick) {
    const own = stayOff || o.stopId || o.routeShort || o.ustopId || o.campus || o.uRoute || o.alertId || o.at || o.journey || o.run || o.busId || o.page || o.from || o.to;
    // Left by a tap off the board: the bays north up in the whole map, not turned about a middle
    // that was set above the board (they came to rest low on the screen).
    // Zoomed out or panned off them first, the rider's own view is kept, only turned north.
    if (stayOff) {
      const onBays = map.getZoom() >= HUB_Z - 0.5 && map.getBounds().contains([D.hub.lon, D.hub.lat]);
      hubTurned = false; northDue = false;
      // Turned about the map's own middle, half under the board, the place looked at swung off to the screen's foot.
      const at = stayAt; stayAt = null;
      requestAnimationFrame(() => onBays ? frame(hubBounds(), { margin: wide() ? 50 : HUB_M, maxZoom: 18.4, bearing: 0, duration: 500 })
        : frame(at ? [at.lng, at.lat] : map.getCenter().toArray(), { zoom: map.getZoom(), bearing: 0, duration: 500 }));
    }
    else if (own) { northDue = true; if (!map.isMoving()) northAgain(true); } else backDue = true;
  }
  stayOff = false;
  mainRun(o.run || null);   // a run open in a narrower stop page's sheet, drawn here beside it
  mainJourney(o.journey || null, app);   // a way from the directions page
  if (((resetDue && app.route.name === 'map') || backDue) && !o.hub) { const back = backDue && !resetDue, to = back ? beforeHub : null, jump = backDue ? 'hub' : false; resetDue = backDue = false; resetView(app, false, to, jump, true); }   // back from the Center: flown back, as the Center was flown to
  const pb = selectedBus && findBus(selectedBus);   // a bus picked on the map keeps its times through a redraw
  // A page's picture is a picture: no times on it. A route's page keeps its route's, a picked bus its own, and a road
  // tapped with one route on it that route's: the feed's redraw every few seconds took those away again.
  const road = !o.run && !o.hub && !JR && !o.journey && selected === null && selectedU === null && !pb && hiLines.length === 1 && focusRoute === undefined ? hiLines[0] : null;
  routeTimesSoon(focusRoute !== undefined && !o.run ? focusRoute : pb ? pb.ri : road, clockNow);
}
// A bus asked for before the feed has placed it: picked out as soon as it appears.
let wantIn = null;
/** A bus on its way to the Transit Center, from the board: its card and its way on, framed with the Center, so where
 *  it is and how it comes in read at once. North up: off the Center, its turn is put away. */
function busIn(id, app) {
  const m = busMarkers.get(id);
  if (!m) { wantIn = id; return; }
  wantIn = null;
  col.querySelector('#mapcard').classList.remove('peek');   // the board's opening size, not the rider's: its next stops shown
  selectBus(id, app);
  const ll = m.marker.getLngLat(), b = new maplibregl.LngLatBounds([ll.lng, ll.lat], [ll.lng, ll.lat]);
  b.extend([D.hub.lon, D.hub.lat]);
  requestAnimationFrame(() => frame(b, { maxZoom: 16, bearing: 0, duration: 700 }));
}
async function showPage({ stopId, ustopId, campus, routeShort, routeArgs, uRoute, alertId, at, from, to, focus, hub, hubPick, tick, bus, journey, busId, goPick, page }, app, clockNow) {
  await init(app);
  // A spot's disc and pin go with its card: gone to another page (the Center, a stop, Stops) the card was replaced and
  // the dashed disc stayed on the map. Kept for a spot's own address and for picking one; not by the minute's redraw.
  if (!tick && spotUp && !at && !goPick && !from && !to) clearSpot();
  // A map still hidden (the Map tab not on screen yet, the page behind it just gone) has no size to fit anything to:
  // a route fitted to nothing is the whole valley and further. Waited for, a few frames at most; if the address
  // moves on meanwhile, the newer call does the work.
  const was = location.hash, box = map.getContainer();
  for (let i = 0; i < 10 && !(box.clientWidth && box.clientHeight); i++) await new Promise(requestAnimationFrame);
  if (location.hash !== was) return;
  // Still hidden (a phone's route page, its map behind it): nothing to frame, and nothing is framed, so the Map tab
  // opens where it was left, and a route's own map link, a new address, frames that route then.
  if (!(box.clientWidth && box.clientHeight)) return;
  // Made before it had a size: the home view, now there's a screen to fit it to (a stop, a route or the Center then
  // frames itself over this). The canvas brought to the box first: made hidden, it's MapLibre's 400 by 300 until the
  // resize watcher's next frame, and the town fitted into that opened two zoom levels out.
  if (homePending) { homePending = false; sized(); frameHome(app, 0); }
  // Measured again when it may have changed; not on every minute and feed redraw, when a resize's move events would
  // cut short a tap waiting out its double-tap beat.
  const measured = box.clientWidth + 'x' + box.clientHeight;
  if (!tick || measured !== lastMeasured) requestAnimationFrame(() => sized());
  lastMeasured = measured;
  panelPad(app);
  // Beside the panel the stop is in the panel: no card over the map as well.
  if (wide() && app.route.name !== 'map') col.querySelector('#mapcard').classList.remove('open');
  if (app.route.name !== 'map') col.querySelector('#mapresults').classList.add('hidden');   // the search's list is the Map tab's, not the page's beside it
  notice(clockNow);
  pickFor = from || goPick && goPick.for || null; pickTo = to || goPick && goPick.to || null; pickNow = !!goPick;
  if (ready) refreshClosed(clockNow);
  if (app.geo) placeMe(app.geo);
  if (page && tick) { pageSheet(page, app, false); return; }   // a stop's sheet: its times, counting down
  if (tick) return;   // the minute turning is no reason to move the map
  if (!routeShort && ringed !== null) { ringed = null; wantRing = null; applySelection(); }   // a bus ringed from its route's list goes with the route
  if (!routeShort && !alertId && focusRoute !== undefined) { focusRoute = undefined; applySelection(); }   // off the route's page: stops back to their own colours
  // The address is acted on once. A redraw with the same one (the app coming back to the front, say)
  // leaves whatever the rider has since tapped on the map alone.
  // A stop's page not yet in the sheet is fresh too: a shuttle stop's address arrives before the shuttle's data, and
  // its page with it.
  const fresh = location.hash !== shownHash || !!page && pageShown !== page.key, cameFrom = shownHash || '';
  shownHash = location.hash;
  if (!fresh) return;
  // The map grown or shrunk since (the route page's small map opened out into the Map tab, say): what it was fitted to
  // is fitted again, at its new size, not left where the small one had it.
  const size = box.clientWidth + 'x' + box.clientHeight, resized = size !== fitSize;
  fitSize = size;
  sized();   // its own idea of its size can lag a map just shown again (hidden, it shrank to nothing)
  if (app.route.name !== 'map' && !page) col.querySelector('#mapcard').classList.remove('open');   // a card tapped up beside one page isn't the next's
  if (pinMarker && !at) { pinMarker.remove(); setSpot(null); }
  if (stopId || ustopId || routeShort || alertId || hub || at || from || to) { selectedBus = null; selectedU = null; }
  if (asking !== !!(from || to || goPick)) { asking = !asking; applySelection(); }
  if (busId) { lastFocused = 'b:' + busId; focusRoute = undefined; return busIn(busId, app); }
  if (at) return showAt(at, app, clockNow);
  if (from) { if (pinMarker) pinMarker.remove(); setSpot(null); return askSpot(from, app); }
  if (to) { if (pinMarker) pinMarker.remove(); setSpot(null); return askSpot(to, app, true); }
  if (hub) {
    selected = null; uHilite = ''; hiLines = []; hiLoops = []; applySelection();
    hubBay = hubPick || null;
    // On a phone the board is the map's card; beside a wide screen's panel, the panel.
    if (app.route.name === 'map' && !wide()) hubCard(clockNow); else col.querySelector('#mapcard').classList.remove('open');
    // Framed whenever the tab opens; from one of its routes to another, the rider's zoom and turn are kept.
    if (!cameFrom.startsWith('#/hub') || !hubOn) fitHub(!cameFrom.startsWith('#/hub'), 700, wide() || /^#\/map(\/|$)/.test(cameFrom));
    lastFocused = 'hub';
    hubBadges();
    return;
  }
  // A shuttle route's page: its line drawn on top, the rest faded, the map fitted to it, as a Connect route's is.
  if (uRoute && U && U.routeById[uRoute] !== undefined) {
    const changed = lastFocused !== 'ur:' + uRoute;
    lastFocused = 'ur:' + uRoute;
    selected = null; uHilite = ''; hiLines = []; hiLoops = [uRoute]; focusRoute = undefined; applySelection();
    // On a phone or a portrait tablet its page is the map's sheet, the loop framed above it, as a Connect route's is.
    if (page) pageSheet(page, app, true); else col.querySelector('#mapcard').classList.remove('open');
    if (focus && (changed || resized)) frame(uRouteBounds(uRoute), { maxZoom: 16, duration: 700 });
    return;
  }
  // The shuttle as a whole, from the home page's line: every loop drawn on top (at a zoom that fits them all they'd
  // otherwise be put away). Beside a wide screen's panel, all of it framed; on a phone, where its stops are (the middle
  // 80% of them each way), not where its lines reach: a loop's run up the canyon to one stop had campus at zoom 13
  // and off-centre. A rider on campus is kept in the frame.
  if (campus && U) {
    lastFocused = 'campus';
    selected = null; uHilite = ''; hiLines = []; hiLoops = U.routes.filter(r => r.stops.length).map(r => r.id); focusRoute = undefined; applySelection();
    col.querySelector('#mapcard').classList.remove('open');
    frame(campusBounds(app.geo), { maxZoom: 16, bearing: 0, duration: 700 });
    return;
  }
  // An alert from the About page: its route drawn on top, the stops it closes framed (marked already, as every
  // closed stop is), or the whole route when it names none.
  if (alertId && /^seen/.test(alertId)) {
    const u = (A.seen || []).find(x => x.id === alertId);
    lastFocused = 'a:' + alertId;
    // Opened before the relay's word is in (a link, a reload): opened when it comes (loadShapes).
    if (u) openSeen(u); else wantSeen = alertId;
    return;
  }
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
    frame(b, { maxZoom: 16, duration: 700 });   // it was a flat 80 px: under a phone's sheet and the search bar
    return;
  }
  if (routeShort) {
    const ri = D.routeByShort[routeShort];
    if (ri === undefined) return;
    const changed = lastFocused !== 'r:' + ri;
    lastFocused = 'r:' + ri;
    // "The whole route" asked for: the whole of it in view, and nothing picked on it, the bus it was opened from too.
    const whole = !!(routeArgs && routeArgs.full) && !/[?&]all=1/.test(cameFrom);
    if (changed || whole) { ringed = null; wantRing = null; selectedBus = null; }
    // From a stop's badge, that stop ringed on the route.
    const at = routeArgs && routeArgs.at !== undefined && D.stopById[routeArgs.at] !== undefined ? routeArgs.at : null;
    selected = at; uHilite = ''; hiLines = [ri]; hiLoops = []; focusRoute = ri; applySelection();
    // On a phone's Map tab its stops are the card, the map framed above it; beside a wide screen's panel, the panel.
    if (app.route.name === 'map' && !wide() && routeArgs) sheetCard(routeArgs, clockNow);
    else col.querySelector('#mapcard').classList.remove('open');
    if (focus && (changed || resized || whole) && !stayRoute) frame(routeBounds(ri), { maxZoom: 15.5, duration: 700 });
    stayRoute = false;
    if (bus) ringBus(bus); else { wantRing = null; if (ringed) unring(); }
    return;
  }
  if (stopId) {
    const si = D.stopById[stopId];
    if (si !== undefined) {
      const s = stop(si);
      const changed = lastFocused !== stopId;
      lastFocused = stopId;
      selected = stopId; uHilite = ''; hiLines = s.hub ? [...s.routes] : []; hiLoops = []; applySelection();
      // On the Map tab the card decides the framing, so the stop sits above it; beside the
      // stop list there is no card, and a fresh arrival eases to the stop itself.
      if (page) { select(stopId, app, false, false, false); pageSheet(page, app, true); if (changed || resized) frameStop([s.lon, s.lat]); }
      else if (app.route.name === 'map') { lastFocused = null; select(stopId, app); }   // an old #/map/<stop> link: its page, framed as it comes
      else if (focus && changed && (!map.isMoving() || Date.now() < padUntil)) frame([s.lon, s.lat], { zoom: Math.max(map.getZoom(), 15), duration: 700 });
    }
  } else if (ustopId && U) {
    const si = U.stopById[ustopId];
    if (si === undefined) return;
    const s = U.stops[si];
    const changed = lastFocused !== 'u:' + ustopId;
    lastFocused = 'u:' + ustopId;
    const pole = U.shared[si];   // at a Connect stop's pole: that dot is this stop on the map
    selected = pole ? D.stops[pole.j].id : null; uHilite = pole ? '' : ustopId; hiLines = []; hiLoops = s.routes.map(ri => U.routes[ri].id); applySelection();
    if (page) { if (pole) select(D.stops[pole.j].id, app, false, false, false); else { selectedU = null; applySelection(); } pageSheet(page, app, true); if (changed || resized) frameStop([s.lon, s.lat]); }
    else if (app.route.name === 'map') { lastFocused = null; selectU(ustopId, app); }   // an old #/map/usu/<stop> link: its page
    else if (focus && changed && (!map.isMoving() || Date.now() < padUntil)) frame([s.lon, s.lat], { zoom: Math.max(map.getZoom(), 15.5), duration: 700 });
  } else if (journey) {
    // A way from the directions page: nothing picked, the way drawn (mainJourney) and its card.
    lastFocused = null; selected = null; uHilite = ''; hiLines = []; hiLoops = []; focusRoute = undefined;
  } else if (app.route && app.route.name === 'map') {
    lastFocused = null;
    select(null, app);
  } else {
    // A page with nothing of its own on the map (home, search, About, directions): every line back as it was,
    // not the last route's drawn on top of the rest faded.
    hiLines = []; hiLoops = []; applySelection();
  }
}

/** The box around a route's stops, every direction. */
function campusBounds(geo) {
  const b = new maplibregl.LngLatBounds(), used = U.stops.filter(s => s.routes.length);
  if (wide()) for (const r of U.routes) { if (r.stops.length) b.extend(uRouteBounds(r.id)); }
  else {
    const q = (a, p) => a[Math.round(p * (a.length - 1))];
    const lats = used.map(s => s.lat).sort((x, y) => x - y), lons = used.map(s => s.lon).sort((x, y) => x - y);
    b.extend([q(lons, 0.1), q(lats, 0.1)]).extend([q(lons, 0.9), q(lats, 0.9)]);
  }
  if (geo && used.some(s => distance(geo.lat, geo.lon, s.lat, s.lon) < 400)) b.extend([geo.lon, geo.lat]);   // on campus: 400 m from one of its stops
  return b;
}
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

/** The map's canvas fitted to its box, only when they differ: a resize reallocates the canvas's whole drawing buffer
 *  (at a phone's pixel density, megabytes), and it was done on every tab tapped, the size unchanged, the costliest
 *  thing a tab did. */
function sized(m = map) {
  const box = m.getContainer(), cv = m.getCanvas();
  if (!box.clientWidth || !box.clientHeight) return;   // hidden: fitted when it's shown
  const r = inkRatio(box);
  if (Math.abs(r - m.getPixelRatio()) > 0.05) { m.setPixelRatio(r); return; }   // a size the budget draws differently: redrawn at its ratio
  if (cv.clientWidth === box.clientWidth && cv.clientHeight === box.clientHeight) return;
  m.resize();
}
/** The map's drawing resolution: the screen's, twice at most, and within PIXELS for the whole map. A phone or a laptop
 *  is under it at full sharpness; a big tablet (a 12.9-inch iPad, 5.6 million at twice) draws a little under twice,
 *  where its fill rate, not its sharpness, is what a zoom runs short of. */
const PIXELS = 4.2e6;
function inkRatio(box) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), w = box && box.clientWidth, h = box && box.clientHeight;
  return !w || !h ? dpr : Math.max(1, Math.min(dpr, Math.round(Math.sqrt(PIXELS / (w * h)) * 20) / 20));
}

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
/** What a run frames: this ride, from the rider's stop on (the bus's later runs, drawn lighter, may run off the
 *  edges), as far along as fits at the zoom floor. It framed every run the bus makes, the middle of them all: the 12's
 *  5:30 from the Center to Hyrum and back sat somewhere in Nibley, neither the rider's stop nor Hyrum in view. */
function runBounds(R, o) {
  const pts = R.points.filter(p => !p.leg).map(p => [D.stops[p.si].lon, D.stops[p.si].lat]);
  let b = null;
  for (const p of pts) {
    const nb = b ? new maplibregl.LngLatBounds(b.getSouthWest(), b.getNorthEast()).extend(p) : new maplibregl.LngLatBounds(p, p);
    const c = b && frameCam(nb, { ...o, minZoom: 0 });
    if (c && c.zoom < o.minZoom) break;   // the rest runs off the edge, the start kept
    b = nb;
  }
  return b || new maplibregl.LngLatBounds();
}
// A run is drawn on the map through this: it keeps what's drawn, so a redraw of the same run changes nothing.
const MT = { m: null, R: null, key: null, labels: null, ready: () => ready, pad: 60 };
const RUN_HIDE = ['stops-tp', 'stops-lit', 'place-labels', 'usu-lines', 'usu-line-on', 'usu-selected', 'usu-stops', 'usu-labels', 'stop-labels', 'route-on', 'route-arrows', ...RUN_STRANDS, 'runs-approx', 'runs-arrows', 'pool-zone', 'pool-stops', 'pool-p'];
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
  m.setLayerZoomRange('stops', 0, 24);   // the run's stops at any zoom: the sheet's map fits the whole run
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
  const col = ri => lineInk('#' + D.routes[ri].color);
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
      // Its way over the next 300 m, not the next few points: leaving the Center the 12 heads west for a block and
      // turns south, and a label put by that block sat across the line it turns onto.
      let j = k, run = 0;
      while (j < l.path.length - 1 && run < 300) { run += distance(l.path[j][1], l.path[j][0], l.path[j + 1][1], l.path[j + 1][0]); j++; }
      const a = l.path[Math.max(0, k - 1)], b = l.path[j];
      if (a && b && (a[0] !== b[0] || a[1] !== b[1])) way.set(si, Math.atan2((b[0] - a[0]) * Math.cos(s.lat * Math.PI / 180), b[1] - a[1]) * 180 / Math.PI);
    }
  }
  // This ride's times alone: the bus's later runs, drawn lighter, often come back up the same road, and their times
  // stood beside this one's at every stop, two columns to tell apart (the sheet lists them).
  T.labels = { way, features: R.points.filter(p => !p.leg).map(p => ({ si: p.si, color: col(p.r), t: p.t, big: p.rank <= 1, rank: p.rank })) };
  placeRunLabels(T);
  // the first run solid, the bus's later ones lighter: which way round is which
  m.getSource('run').setData({ type: 'FeatureCollection', features: legs.map((l, i) => ({ type: 'Feature', properties: { color: col(l.ri), later: i > 0 }, geometry: { type: 'LineString', coordinates: l.path } })) });
  // Moved into a new box as the day redrew, it measured nothing while out of the page: measured again first, or the
  // run is fitted to no room at all and comes out zoomed far away.
  sized(m);
  // Clear of the search bar and notice, and on a phone of the run's sheet: the whole run in the map above it, with a
  // little room round it, never further out than zoom 11.25: a loop about town fits (the Green Loop at 11.4 on a
  // phone); a long route out of town (12 to Hyrum) is centred and runs off the edges rather than shrink to a thread.
  const fit = { margin: wide() ? T.pad : 24, minZoom: 11.25, maxZoom: 16, bearing: 0 };
  frame(runBounds(R, fit), fit);
}
/** The run's times, each to the right of its bus's way, as the map is turned now: the screen's right, left, above or
 *  below, whichever is nearest the road's right-hand side. Placed again when the map turns. */
function placeRunLabels(T) {
  if (!T.m || !T.labels || !T.m.getSource('runt')) return;
  const turn = T.m.getBearing(), { way } = T.labels;
  const side = si => {
    // Clear of the bus on the line (its marker 28 px across at a run's zoom), not under it as it passes.
    if (!way.has(si)) return { a: 'left', o: [1.5, 0] };
    const r = ((way.get(si) + 90 - turn) % 360 + 360) % 360;   // the bus's right, as a bearing on the screen
    return r < 45 || r >= 315 ? { a: 'bottom', o: [0, -1.4] } : r < 135 ? { a: 'left', o: [1.5, 0] } : r < 225 ? { a: 'top', o: [0, 1.4] } : { a: 'right', o: [-1.5, 0] };
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
    // the Center's view put away (its badges, the washed-out streets, the south-up turn): a run is drawn like any other
    const was = hubOn;
    hubCheck();
    if (was && hubTurned) { hubTurned = false; northDue = false; }
    return drawRun(MT);
  }
  if (!MT.R) return;
  MT.R = null; MT.key = null; MT.labels = null;
  for (const id of ['run', 'runt']) if (map.getSource(id)) map.getSource(id).setData({ type: 'FeatureCollection', features: [] });
  for (const id of RUN_HIDE) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
  map.setFilter('stops', null);
  map.setLayerZoomRange('stops', 12, 24);
  applySelection();
  quiet();   // back at the Center, its view again
}
/** A row in the list pointed at: its stop lit on the run's map. */
export function runHot(si) { const T = MT; if (T.R) { T.R.hot = si; if (T.m && T.ready() && T.m.getLayer('run-hot')) T.m.setFilter('run-hot', ['==', ['get', 'si'], si ?? -1]); } }
/** A stop picked in the run's list: lit, and brought to the middle of the map, in to the streets. */
export function runFocus(si) {
  runHot(si);
  const T = MT;
  if (T.m && D.stops[si]) frame([D.stops[si].lon, D.stops[si].lat], { zoom: Math.max(map.getZoom(), 15), duration: 500 });
}

// ---- a way from the directions page, drawn: each ride along its route's line in the route's colour (a shuttle's
// along its loop), the walks dashed in the paper's ink as the crow flies, the change ringed, the start and the end
// marked, and only the stops it calls at, each tappable as anywhere. On a phone its card is the way's own, the others
// a swipe away; beside a wide screen's panel the directions page stays, the way picked marked there.
let JR = null, jrKey = null, jrFramed = null, jrBounds = null;
/** The way drawn, framed in the room left: its ends' rings clear of the edges (a margin wider than theirs, 11 px). */
const frameWay = (duration = 600) => { if (JR && jrBounds) frame(jrBounds, { margin: wide() ? 40 : 28, maxZoom: 16.5, bearing: 0, duration }); };
const ink = () => dark() ? '#eef0f2' : '#1d1f20', paperInk = () => dark() ? '#101214' : '#f2f2f3';
const jpt = x => typeof x === 'string' ? U.stops[+x.slice(1)] : D.stops[x];
/** The layers a way adds, once (and again after a restyle, which drops them): its walks, its ring and its ends. */
function addJourneyLayers(m) {
  addRunLayers(m);
  if (m.getSource('jr')) return;
  m.addSource('jr', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  m.addLayer({ id: 'jr-walk', type: 'line', source: 'jr', filter: ['==', ['get', 'k'], 'walk'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ink(), 'line-width': 3, 'line-dasharray': [0.1, 2] } }, 'stops');
  m.addLayer({ id: 'jr-ring', type: 'circle', source: 'jr', filter: ['==', ['get', 'k'], 'change'], paint: { 'circle-radius': 13, 'circle-opacity': 0, 'circle-stroke-width': 3, 'circle-stroke-color': ink() } });
  m.addLayer({ id: 'jr-ends', type: 'circle', source: 'jr', filter: ['in', ['get', 'k'], ['literal', ['start', 'end']]], paint: { 'circle-radius': 8, 'circle-color': ['case', ['==', ['get', 'k'], 'end'], ink(), paperInk()], 'circle-stroke-width': 3, 'circle-stroke-color': ['case', ['==', ['get', 'k'], 'end'], paperInk(), ink()] } });
}
/** A shuttle ride's line: its loop from where it's boarded, round to where it's left. */
function loopLeg(l) {
  const r = U.routes[l.r], a = +l.from.slice(1), b = +l.to.slice(1), A = U.stops[a], B = U.stops[b];
  const path = loopPath(l.r, [A.lon, A.lat], r.stopAlong ? r.stopAlong[a] : undefined);
  if (path.length < 2) return [[A.lon, A.lat], [B.lon, B.lat]];
  const L = [0];
  for (let i = 1; i < path.length; i++) L.push(L[i - 1] + Math.hypot((path[i][0] - path[i - 1][0]) * KX, (path[i][1] - path[i - 1][1]) * KY));
  // Where along the way round the stop left is: the shape's own measure where it has one, else its nearest point.
  const T = r.cum && r.cum.length ? r.cum[r.cum.length - 1] : 0;
  let want = r.stopAlong && T && r.stopAlong[a] !== undefined && r.stopAlong[b] !== undefined ? ((r.stopAlong[b] - r.stopAlong[a]) % T + T) % T : null, k = path.length - 1;
  if (want !== null) { k = L.findIndex(d => d >= want); if (k < 1) k = path.length - 1; }
  else { let best = Infinity; for (let i = 1; i < path.length; i++) { const d = distance(B.lat, B.lon, path[i][1], path[i][0]); if (d < best) { best = d; k = i; } } }
  return [...path.slice(0, k), [B.lon, B.lat]];
}
/** Only the way's stops and lines: the rest put away, as a run's are, the other routes faint. */
function dressJourney() {
  if (!JR || !map.getSource('jr')) return;
  for (const id of [...RUN_HIDE, 'stop-selected']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', APPROACH.includes(id) ? 'visible' : 'none');
  map.setPaintProperty('route-lines', 'line-opacity', 0.18);
  map.setFilter('stops', ['in', ['get', 'id'], ['literal', JR.stops]]);
  map.setLayerZoomRange('stops', 0, 24);
  if (JR.ustops.length) { map.setLayoutProperty('usu-stops', 'visibility', 'visible'); map.setFilter('usu-stops', ['in', ['get', 'id'], ['literal', JR.ustops]]); }
  // Each stop in the colour of the bus it's on the way for, not its own first route's.
  const pairs = Object.entries(JR.tint).flat();
  map.setPaintProperty('stops', 'circle-color', pairs.length ? ['match', ['get', 'id'], ...pairs, ink()] : ink());
  map.setPaintProperty('stops', 'circle-stroke-color', paperInk());
}
/** The way drawn, or put away (null). Drawn afresh only when the way itself changes; framed when it's a new one. */
let jrNone = null;   // a 'no way by bus' up: its two ends on the map, its card
async function mainJourney(J, app) {
  if (!map) return;
  if (!ready) { if (J) map.once('load', () => mainJourney(J, app)); return; }
  if (!(J && J.none) && jrNone) {
    jrNone = null; if (nearBy === 'none') markNear();   // its own marks only: the near view may have just made its own
    if (map.getSource('jr')) map.getSource('jr').setData({ type: 'FeatureCollection', features: [] });
    const card = col.querySelector('#mapcard');
    if (!J && card.querySelector(':scope > .gonone')) card.classList.remove('open', 'peek');
  }
  if (J && J.none) {
    if (JR) mainJourney(null, app);
    addJourneyLayers(map);
    map.getSource('jr').setData({ type: 'FeatureCollection', features: [['start', J.from], ['end', J.to]].map(([k, p]) => ({ type: 'Feature', properties: { k }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) });
    // As the near view has them: the start's four nearest stops, marked with their names, where a bus could be met.
    const four = nearFour(J.from).filter(x => x.d < 20000);
    markNear(four.map(x => D.stops[x.i].id), 'none');
    if (app.route.name === 'map' && !wide()) journeyCard(J, app);
    if (jrNone === J.base) return;
    jrNone = J.base;
    const b = new maplibregl.LngLatBounds([J.from.lon, J.from.lat], [J.from.lon, J.from.lat]).extend([J.to.lon, J.to.lat]);
    for (const x of four) b.extend([D.stops[x.i].lon, D.stops[x.i].lat]);
    requestAnimationFrame(() => frame(b, { margin: wide() ? 80 : 56, maxZoom: 16, bearing: 0, duration: 600 }));
    return;
  }
  if (!J) {
    if (!JR) return;
    JR = null; jrKey = null; jrFramed = null;
    for (const id of ['run', 'jr']) if (map.getSource(id)) map.getSource(id).setData({ type: 'FeatureCollection', features: [] });
    for (const id of [...RUN_HIDE, 'stop-selected']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
    map.setFilter('stops', null); map.setFilter('usu-stops', null);
    map.setLayerZoomRange('stops', 12, 24);
    const card = col.querySelector('#mapcard');
    if (card.querySelector(':scope > .journeysheet')) card.classList.remove('open', 'peek');
    applySelection();
    return;
  }
  const p = J.plans[J.i], rides = p.legs.filter(l => l.kind === 'ride');
  const colOf = l => l.u ? U.routes[l.r].color : lineInk('#' + D.routes[l.r].color);
  const tint = {}, ustops = new Set();
  for (const l of rides) for (const x of l.stops) {
    if (typeof x !== 'string') { tint[D.stops[x].id] ??= colOf(l); continue; }
    const sh = U.shared[+x.slice(1)];
    if (sh) tint[D.stops[sh.j].id] ??= colOf(l); else ustops.add(U.stops[+x.slice(1)].id);
  }
  JR = { routes: [...new Set(rides.filter(l => !l.u).map(l => l.r))], stops: Object.keys(tint), ustops: [...ustops], tint, plan: p, appBus: JR ? JR.appBus : null };
  const was = hubOn;
  hubCheck();   // the Center's view put away: a way through it is drawn like any other
  if (was && hubTurned) { hubTurned = false; northDue = false; }
  addJourneyLayers(map);
  applySelection();
  if (app.route.name === 'map' && !wide()) journeyCard(J, app);
  const key = J.hrefs[J.i] + '|' + rides.map(l => l.from + '>' + l.to).join(';') + '|' + (dark() ? 'd' : 'l');
  if (key === jrKey) return;
  jrKey = key;
  const fc = await shapes();
  if (jrKey !== key || !JR) return;
  const lines = rides.map(l => ({ type: 'Feature', properties: { color: colOf(l), later: false }, geometry: { type: 'LineString', coordinates: l.u ? loopLeg(l) : fc ? runPath(fc, l.r, l.stops.map(si => [0, si])) : l.stops.map(si => [D.stops[si].lon, D.stops[si].lat]) } }));
  const ll = x => [jpt(x).lon, jpt(x).lat];
  const marks = [];
  p.legs.forEach((l, k) => {
    if (l.kind === 'walk') {
      const a = k === 0 ? [J.from.lon, J.from.lat] : ll(l.from), b = k === p.legs.length - 1 ? [J.to.lon, J.to.lat] : ll(l.to);
      marks.push({ type: 'Feature', properties: { k: 'walk' }, geometry: { type: 'LineString', coordinates: [a, b] } });
    } else if (k > 0 && p.legs[k - 1].kind === 'ride') marks.push({ type: 'Feature', properties: { k: 'change' }, geometry: { type: 'Point', coordinates: ll(l.from) } });
    else if (k > 1 && p.legs[k - 1].kind === 'walk' && p.legs[k - 2].kind === 'ride') {
      marks.push({ type: 'Feature', properties: { k: 'change' }, geometry: { type: 'Point', coordinates: ll(p.legs[k - 2].to) } });
      marks.push({ type: 'Feature', properties: { k: 'change' }, geometry: { type: 'Point', coordinates: ll(l.from) } });
    }
  });
  marks.push({ type: 'Feature', properties: { k: 'start' }, geometry: { type: 'Point', coordinates: [J.from.lon, J.from.lat] } });
  marks.push({ type: 'Feature', properties: { k: 'end' }, geometry: { type: 'Point', coordinates: [J.to.lon, J.to.lat] } });
  map.getSource('run').setData({ type: 'FeatureCollection', features: lines });
  map.getSource('runt').setData({ type: 'FeatureCollection', features: [] });
  map.getSource('jr').setData({ type: 'FeatureCollection', features: marks });
  // Framed when it's a new way (not when the feed only moved its minutes): the whole of it, above a phone's card.
  // A map just shown (a reload straight onto the way) may have no size yet: waited for, a few frames, and the way
  // framed only once it has one, or it's fitted to nothing and left there.
  if (jrFramed === J.hrefs[J.i]) return;
  const box = map.getContainer();
  for (let i = 0; i < 10 && box.clientHeight < 200; i++) await new Promise(requestAnimationFrame);
  if (box.clientHeight < 200 || jrKey !== key) return;
  jrFramed = J.hrefs[J.i];
  const b = new maplibregl.LngLatBounds();
  for (const f of [...lines, ...marks]) for (const c of f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates) b.extend(c);
  sized();
  jrBounds = b;
  frameWay();
}
/** A phone's card for the directions: the page's own sheet (where to and from, the ways as rows, the drawn way told
 *  leg by leg), under the map with the way drawn. A row tapped draws that way; a swipe across, the next. */
function journeyCard(J, app) {
  const card = col.querySelector('#mapcard');
  const markup = `<div class="grip"></div>` + J.sheet();
  const again = !!card.querySelector(':scope > .journeysheet') && card.classList.contains('open') && card.dataset.way === J.base;
  // From way to way, the card keeps its height, so the rows stay under the thumb: a longer way scrolls in it.
  if (again) { if (!card.classList.contains('peek')) card.style.setProperty('--jh', card.offsetHeight + 'px'); morph(card, markup); }
  else { card.style.removeProperty('--jh'); card.innerHTML = markup; card.scrollTop = 0; card.classList.remove('peek'); }
  J.mount(card);
  card.dataset.way = J.base;
  card.classList.remove('hidden');
  card.classList.add('open');
  // A long card would leave the map a sliver: it opens at its head (where to, from, the ways), the legs a swipe up.
  if (!again && card.offsetHeight > 0.5 * map.getContainer().clientHeight) { fitPeek(card); card.classList.add('peek'); }
}
/** Out of the directions: back where they were opened from. */
function backToWays() {
  const base = col.querySelector('#mapcard').dataset.way;
  if (history.length > 1) history.back(); else if (base) location.hash = base;
}
/** To the next way or the one before, in place: Back still leaves the directions. */
function stepWay(dir) {
  const rows = [...col.querySelectorAll('#mapcard .jrow[data-go]')], i = rows.findIndex(r => r.classList.contains('picked'));
  const b = rows[i + dir];
  if (b) asPage(b.dataset.go);
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
const bear = (p, q) => Math.atan2((q.lon - p.lon) * Math.cos(p.lat * Math.PI / 180), q.lat - p.lat) * 180 / Math.PI;
/** A route's times on the map just after the frame that asked for them: the page or card it comes with is on screen
 *  first. Asked for again before then, the last word counts. */
let rtWant = null, rtDue = false;
function routeTimesSoon(ri) {
  rtWant = ri;
  if (rtDue) return;
  rtDue = true;
  afterPaint(() => { rtDue = false; routeTimes(rtWant, now()); });
}
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
    map.addLayer({ id: 'route-times', type: 'symbol', source: 'rtimes', layout: { ...text, 'text-variable-anchor-offset': ['get', 'v'], 'symbol-sort-key': ['get', 'sk'] }, paint });   // a first run's 'starts here' placed before the rest
  }
  if (!rtWired) { rtWired = true; map.on('moveend', () => { const k = map.getZoom().toFixed(2) + '/' + map.getBearing().toFixed(1); if (k !== rtAt) placeTimes(); }); }
  // A route's own page (its stops listed beside the map, or as the card) says each stop's next time already: the map
  // keeps out of it. Its times come when they add something: a bus ringed or picked (that bus's, along its way on), or
  // a route lit from a road, with no list beside it.
  if (ri !== null && /^#\/map\/route\//.test(location.hash) && !ringed && !selectedBus) ri = null;
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
  // Whose time it is. With two buses out on the route a stop's next bus could be either, so each time says which
  // ('6:10 · bus 4006'), the same numbers the route's card lists. A bus picked out (its ring, its card) narrows the
  // times to that bus's alone, at the stops still ahead of it, and the numbers come off. One bus out: plain times.
  const buses = rtStale() ? [] : rt.buses.filter(b => b.ri === ri);
  const sb = selectedBus || ringed, picked = sb ? buses.find(b => b.id === sb) : null;   // one ringed from the route's list, as one picked
  const busOf = t => { const u = t.trip !== undefined && rt.trips[D.trips[t.trip]]; return u && u.v ? buses.find(b => b.id === 'c:' + u.v) : null; };
  const which = t => { if (picked || buses.length < 2) return ''; const b = busOf(t); return b ? ' · bus ' + b.label : ''; };
  // A picked bus's times run from where it is to its next call at the Transit Center, and today only, so a stop it
  // has passed gets no time (not its run tomorrow). Without a run (a trip the timetable lacks) its trip's stops.
  const run = picked ? runAhead(picked, clockNow) : null;
  const inRun = x => run ? !!run.trips.get(x.trip)?.has(x.si) : D.trips[x.trip] === picked.trip;
  let late = null;   // the feed's word at the last stop of the run it has one for, carried to the run's end
  for (const si of all) {
    const t = nextAt(si, 1, clockNow, picked ? 1 : 8, x => x.r === ri && (!picked || inRun(x)))[0];
    if (!t) continue;
    if (run && t.live && (late === null || t.min > late.min)) late = { min: t.min, delay: t.live.delay };
    // The day's first run, where it starts partway along the route: said, so the stops before it (their first bus the
    // run after) don't look out of order. Not at the Transit Center, where every run starts.
    // Each way's first, as the route's sheet marks it (the day's single earliest missed the other way's).
    const starts = !D.stops[si].hub && Object.keys(D.routes[ri].stops || {}).some(d => { const f = runsOn(ri, t.ymd, d)[0]; return f && f.trip === t.trip && f.si === si; });
    let label = short(t) + which(t) + (starts ? ' · starts here' : '');
    let lines = [[label, colour(t)]];
    // Where one way calls only on request (16 north at Pepperidge Farms): the next bus each way, a line apiece, the
    // way it goes on each, so the one on request doesn't read as the stop's only bus.
    if (onRequest(si, ri, 0) || onRequest(si, ri, 1)) {
      const ways = [0, 1].map(d => nextAt(si, 1, clockNow, picked ? 1 : 8, x => x.r === ri && x.dir === d && (!picked || inRun(x)))[0]).filter(Boolean).sort((x, y) => x.req - y.req);
      lines = ways.map(x => [short(x) + ' ' + (h => /^to /.test(h) ? h : h.replace(/bound$/i, '').toLowerCase())(headsign(x)) + which(x) + (x.req ? ' · on request' : ''), colour(x)]);
      label = lines.map(l => l[0]).join('\n');
    }
    items.push({ si, w: way.has(si) ? way.get(si) : null, lock: way.has(si) && facing(si), starts, props: { sk: starts ? 0 : 1, t: label, live: !!t.live, later: t.day > 0, t1: lines[0][0], c1: lines[0][1], t2: lines[1] ? '\n' + lines[1][0] : '', c2: lines[1] ? lines[1][1] : lines[0][1] } });
  }
  // The run's end where the departures don't reach it: the arrival at the Transit Center that closes a numbered
  // route's trip (nobody boards there, so the timetable's departures leave it out), as late as the run is.
  if (run && run.end && !items.some(i => i.si === run.end.si)) {
    const si = run.end.si, t = { min: run.end.min + (late ? late.delay : 0), day: 0, ymd: clockNow.ymd, live: !!late };
    const label = short(t) + ' · arrives', c = colour(t);
    items.push({ si, w: way.has(si) ? way.get(si) : null, lock: way.has(si) && facing(si), props: { sk: 1, t: label, live: !!late, later: false, t1: label, c1: c, t2: '', c2: c } });
  }
  rtBase = { items, lines: fc ? fc.features.filter(f => f.properties.route === ri).map(f => f.geometry.coordinates) : [] };
  placeTimes();
}
/** The run ahead of a picked bus: its stops from where it is to its next call at the Transit Center, as
 *  { trips: Map(trip index → Set(stop)), end: { si, min } | null }, the end being the trip's last stop when the run
 *  gets there (the Center, for a numbered route: an arrival the departures leave out). A loop's trip runs from
 *  55 North Main round to 55 North Main with the Center partway, so the run cuts off there; a bus past the Center
 *  runs to its trip's end and on into the next trip, up to the Center. Null for a trip the timetable lacks. */
function runAhead(b, clockNow) {
  const ti0 = D.trips.indexOf(b.trip);
  if (ti0 < 0) return null;
  const trips = new Map(), u = rt.trips[b.trip], nowS = Date.now() / 1000;
  // Where it is: the stop the feed says it calls at next; failing that, the first stop not long behind the clock
  // (the times themselves drop any stop the bus has been to, so a start too early costs nothing).
  const nextSi = nextStopOf(b);
  let seq = tripStops(ti0), ti = ti0, ymd = clockNow.ymd;
  let k = nextSi !== undefined ? seq.findIndex(x => x[1] === nextSi) : -1;
  if (k < 0) k = seq.findIndex(x => x[0] >= clockNow.min - 15);
  if (k < 0) k = seq.length;
  // At the Center already, by the feed's word (listed there past its time, boarding): the run is the one leaving it.
  const leaving = si => { const hit = ti === ti0 && u && u.at.get(D.stops[si].id); return hit && !hit.skipped && hit.time < nowS - 30; };
  for (let hops = 0; hops < 3; hops++) {
    const set = new Set();
    trips.set(ti, set);
    for (; k < seq.length; k++) {
      const si = seq[k][1];
      set.add(si);
      if (D.stops[si].hub && k > 0 && !leaving(si)) return { trips, end: null };
    }
    const te = tripEnd(ti);
    if (te && D.stops[te.si].hub) return { trips, end: te };
    const n = nextTrip(ti, ymd), ns = n !== undefined ? tripStops(n) : [];
    if (!ns.length || ns[0][0] - (te ? te.min : seq[seq.length - 1][0]) > 45) return { trips, end: te };
    ti = n; seq = ns; k = 0;
  }
  return { trips, end: null };
}
/** The way on from a point of a trip, as [[minute, stop, (route)] …]. The route is a loop of string and the picked
 *  point cuts it: from the stop just passed (`seq[k - 1]`, the picked stop itself for a stop), on round the run and
 *  through the next trips on the same route until it comes back to that very stop. On a loop that's one lap; on a
 *  route that runs out and back (12's to Hyrum) it's out, round the far end and back, three timetable trips at most.
 *  A run that changes route at the Transit Center (a Saturday's 2 and 5, 9 and 1) gets a short tail on the other
 *  route instead, its stops marked with it. */
function pathFrom(ti0, k, ri, clockNow) {
  const seq0 = tripStops(ti0);
  const passed = k > 0 ? seq0[k - 1][1] : null, self = si => si === passed;
  const path = k > 0 ? [seq0[k - 1]] : [], add = x => { if (!path.length || path[path.length - 1][1] !== x[1]) path.push(x); };
  let ti = ti0, seq = seq0, ymd = clockNow.ymd;
  for (let hops = 0; hops < 4; hops++) {
    for (; k < seq.length; k++) { add(seq[k]); if (self(seq[k][1])) return path; }
    const te = tripEnd(ti);
    if (te) { add([te.min, te.si]); if (self(te.si)) return path; }
    const n = nextTrip(ti, ymd), ns = n !== undefined ? tripStops(n) : [], nr = n !== undefined ? tripRoute(n) : null;
    if (!ns.length || ns[0][0] - (te ? te.min : seq[seq.length - 1][0]) > 45) return path;
    if (nr && nr.r !== ri) { for (const x of ns.slice(0, 3)) add([x[0], x[1], nr.r]); return path; }
    ti = n; seq = ns; k = 0;
  }
  return path;
}
/** A way's bus coming to it, with the direction arrows: the layers a way drawn leaves up (the rest of a run's go). */
const APPROACH = [...RUN_STRANDS, 'runs-approx', 'runs-arrows'];
/** The bus a way's ride boards, from the feed: the one on the ride's trip, or the one the feed says will run it. */
function rideBus(l) {
  if (l.u || l.t.trip === undefined) return null;
  const on = busOn(l.t.trip);
  if (on) return on.bus;
  const u = rt.trips[D.trips[l.t.trip]];
  return u && u.v ? rt.buses.find(x => x.id === 'c:' + u.v) || null : null;
}
/** The drawn way's bus coming to it: the first ride's bus to the stop it's boarded at; once that's gone (the rider on
 *  it), the change's bus to the change stop. Its way from where it is to that stop and no further (the way's own line
 *  takes over there), round the turn of an out-and-back if that's how it comes. None for a bus not yet out. */
function approach(clockNow) {
  const p = JR && JR.plan;
  // Today's only, by its date: a way worked out for a time picked is day 0 of that day, and tomorrow's 9:11 took the
  // bus running that trip today for its own.
  if (!p || p.ymd !== clockNow.ymd) return null;
  const rides = p.legs.filter(l => l.kind === 'ride');
  const l = rides.length > 1 && clockNow.min > rides[0].on ? rides[1] : rides[0], b = l && rideBus(l);
  const stops = b ? approachPath(b, l.t.trip, l.from, clockNow) : null;
  return stops && stops.length > 1 ? { bus: b, stops } : null;
}
/** A bus's way on, trip to trip, up to a stop of a trip it's yet to run (or is running): null when it's past it or
 *  doesn't come to it. Each stop [minute, stop, route where it's another's]. */
function approachPath(b, target, si, clockNow) {
  let ti = D.trips.indexOf(b.trip);
  if (ti < 0) return null;
  let seq = tripStops(ti);
  const nextSi = nextStopOf(b), te0 = tripEnd(ti);
  let k = nextSi !== undefined ? seq.findIndex(x => x[1] === nextSi) : -1;
  if (k < 0 && te0 && nextSi === te0.si) k = seq.length;
  if (k < 0) return null;
  const path = k > 0 ? [seq[k - 1]] : [];
  const add = (x, r) => { if (!path.length || path[path.length - 1][1] !== x[1]) path.push(r !== b.ri ? [x[0], x[1], r] : [x[0], x[1]]); };
  for (let hops = 0; hops < 4; hops++) {
    const tr = tripRoute(ti), r = tr ? tr.r : b.ri;
    for (; k < seq.length; k++) { add(seq[k], r); if (ti === target && seq[k][1] === si) return path; }
    if (ti === target) return null;
    const te = tripEnd(ti);
    if (te) add([te.min, te.si], r);
    const n = nextTrip(ti, clockNow.ymd);
    if (n === undefined) return null;
    ti = n; seq = tripStops(n); k = 0;
  }
  return null;
}
/** A picked bus's way on: from where it is, by the feed's next stop, or failing that the clock. Empty for a trip the
 *  timetable lacks. */
function busPath(b, clockNow) {
  const ti0 = D.trips.indexOf(b.trip);
  if (ti0 < 0) return [];
  const seq0 = tripStops(ti0), nextSi = nextStopOf(b);
  let k = nextSi !== undefined ? seq0.findIndex(x => x[1] === nextSi) : -1;
  // Its next stop the trip's end (the Transit Center, kept apart from the trip's stops): past them all. Unfound, the
  // way was worked out by the clock instead, from a stop behind the bus, and cut at none of it.
  const te = tripEnd(ti0);
  if (k < 0 && te && nextSi === te.si) k = seq0.length;
  if (k < 0) k = seq0.findIndex(x => x[0] >= clockNow.min - 15);
  if (k < 0) k = seq0.length;
  return pathFrom(ti0, k, b.ri, clockNow);
}
/** A picked stop's ways on, one per route (and per direction, where a route calls both ways at one stop): the way
 *  its next bus goes, or the day's last when they've all gone, so a stop late at night still shows the way. */
function stopPaths(si, ris, clockNow) {
  const out = [], ts = timesOn(si, clockNow.ymd).sort((a, b) => a.min - b.min);
  for (const ri of ris) {
    const own = ts.filter(t => t.r === ri);
    for (const d of new Set(own.map(t => t.dir))) {
      const list = own.filter(t => t.dir === d), t = list.find(t => t.min >= clockNow.min) || list[list.length - 1];
      const k = tripStops(t.trip).findIndex(x => x[1] === si && x[0] === t.min);   // by minute: a loop's trip passes its first stop twice
      if (k >= 0) out.push({ ri, stops: pathFrom(t.trip, k + 1, ri, clockNow) });
    }
  }
  return out;
}
/** The routes whose way on is drawn: a picked Connect bus's, or a picked stop's (a route in view, when the stop is
 *  its; the hub's none, its bays say). */
function routesInPlay() {
  if (JR) return JR.routes;   // a way drawn: its buses bright, the rest dim
  const sb = selectedBus || ringed;   // a bus ringed from its route's list draws its way on as one picked does
  if (sb) { const c = findBus(sb); return c ? [c.ri] : []; }
  const si = selected ? D.stopById[selected] : undefined;
  if (si === undefined || stop(si).hub) return [];
  return focusRoute !== undefined && stop(si).routes.includes(focusRoute) ? [focusRoute] : [...stop(si).routes];
}
/** The shuttle loops whose way on is drawn: a picked shuttle bus's; a picked shuttle stop's, every loop that calls
 *  there (the same pole as a Connect stop's included, beside that stop's routes). A loop with no line at all (under
 *  three stops, no shape) has no way to draw. */
function loopsInPlay() {
  if (!U || JR) return [];
  const drawn = ri => U.routes[ri].shape.length || U.routes[ri].stops.length >= 3;
  const sb = selectedBus || ringed;
  if (sb) { if (findBus(sb)) return []; const b = live.buses.find(x => x.id === sb); return b && drawn(b.ri) ? [b.ri] : []; }
  const usi = selectedU !== null ? selectedU : uHilite ? U.stopById[uHilite] : selected && D.stopById[selected] !== undefined && U.sharedByCvtd[D.stopById[selected]] ? U.sharedByCvtd[D.stopById[selected]].i : undefined;
  return usi === undefined ? [] : U.stops[usi].routes.filter(drawn);
}
/** A shuttle loop's way on from a point: its line (the shape, or stop to stop where it has none) cut at the point's
 *  place on it and closed back there, so it runs once round, the way the buses go, and ends where it began. `along`:
 *  the point's distance along the shape where it's known (a stop's, a bus's), so a road the loop passes twice is cut
 *  on the right pass; else the nearest stretch. */
function loopPath(ri, from, along) {
  const r = U.routes[ri], ring = r.shape.length ? r.shape.slice() : r.stops.map(si => [U.stops[si].lon, U.stops[si].lat]);
  if (ring.length < 2) return [];
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push(ring[0]);
  let hint = -1;
  if (along !== undefined && r.shape.length) { let d = Infinity; r.cum.forEach((c, i) => { if (Math.abs(c - along) < d) { d = Math.abs(c - along); hint = i; } }); }
  let bi = 0, best = Infinity;
  for (let i = 0; i + 1 < ring.length; i++) {
    if (hint >= 0 && Math.abs(i - hint) > 1 && Math.abs(i - hint) < ring.length - 2) continue;   // beside the known place only
    const [ax, ay] = ring[i], [bx, by] = ring[i + 1], vx = (bx - ax) * KX, vy = (by - ay) * KY, px = (from[0] - ax) * KX, py = (from[1] - ay) * KY, L2 = vx * vx + vy * vy;
    const t = L2 ? Math.max(0, Math.min(1, (px * vx + py * vy) / L2)) : 0, e = Math.hypot(px - t * vx, py - t * vy);
    if (e < best) { best = e; bi = i; }
  }
  return [from, ...ring.slice(bi + 1), ...ring.slice(1, bi + 1), from];
}
const KX = Math.cos(41.74 * Math.PI / 180) * 111320, KY = 110540;   // degrees to metres, near enough for the valley
/** A way in pieces of equal length, each coloured with the strength of its place along, fading evenly from full at
 *  the start to faint at the end, where it melts into the road: where two stretches of the way share a road, the
 *  stronger is the sooner. */
function fadePieces(path, hex, props) {
  const col = lineInk('#' + hex), [r, g, b] = [1, 3, 5].map(i => parseInt(col.slice(i, i + 2), 16));
  const L = [0];
  for (let i = 1; i < path.length; i++) L.push(L[i - 1] + Math.hypot((path[i][0] - path[i - 1][0]) * KX, (path[i][1] - path[i - 1][1]) * KY));
  const T = L[L.length - 1];
  if (!(T > 0)) return [];
  const N = Math.max(6, Math.min(48, Math.round(T / 150))), strength = p => 1 - 0.92 * p;   // a straight fade: two ways of a route can share a road anywhere along it, and the line's strength says which comes first
  const at = d => { let i = 1; while (i < L.length - 1 && L[i] < d) i++; const f = L[i] > L[i - 1] ? (d - L[i - 1]) / (L[i] - L[i - 1]) : 0; return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f]; };
  const out = [];
  for (let n = 0; n < N; n++) {
    const a = T * n / N, z = T * (n + 1) / N, pts = [at(a)];
    for (let i = 0; i < path.length; i++) if (L[i] > a && L[i] < z) pts.push(path[i]);
    pts.push(at(z));
    const al = strength((n + 0.5) / N);
    out.push({ type: 'Feature', properties: { ...props, a: al, color: `rgba(${r},${g},${b},${al.toFixed(3)})` }, geometry: { type: 'LineString', coordinates: pts } });
  }
  return out;
}
/** A strand's arrows, in its lane: the way in a few long stretches (its pieces are too short to carry one each), each
 *  as strong as the strand is there, so where a loop comes back past, the sooner way's arrows are the plain ones. */
function arrowLines(path, hex, lane) {
  const c = lineInk('#' + hex).slice(1).toLowerCase(), L = [0];
  for (let i = 1; i < path.length; i++) L.push(L[i - 1] + Math.hypot((path[i][0] - path[i - 1][0]) * KX, (path[i][1] - path[i - 1][1]) * KY));
  const T = L[L.length - 1], N = Math.max(1, Math.min(6, Math.round(T / 700))), out = [];
  for (let n = 0, i = 0; n < N; n++) {
    const z = T * (n + 1) / N, pts = [path[i]];
    while (i + 1 < path.length && L[i + 1] <= z) pts.push(path[++i]);
    if (n === N - 1) while (i + 1 < path.length) pts.push(path[++i]);
    if (pts.length > 1) out.push({ type: 'Feature', properties: { arrow: true, hex: c, op: Math.max(0.35, 1 - 0.92 * (n + 0.5) / N), o14: [0, lane * 8], o17: [0, lane * 12] }, geometry: { type: 'LineString', coordinates: pts } });
  }
  return out;
}
/** The way on from what's picked, drawn: a bus's from the bus, a stop's from the stop, each along its route's shape,
 *  bright there and fading round to where it comes back to itself. Nothing picked, or nothing to draw: cleared. */
let runsKey = null;
/** The ways the buses come (to a stop picked, a bus's own) drawn just after the frame that picked it: the card first. */
let runsDue = false;
function drawRunsSoon() { if (runsDue) return; runsDue = true; afterPaint(() => { runsDue = false; drawRuns(); }); }
async function drawRuns() {
  if (!map || !ready || !map.getSource('runs')) return;
  const clockNow = now(), empty = { type: 'FeatureCollection', features: [] };
  const sb = selectedBus || ringed, c = sb ? findBus(sb) : null, si = !sb && selected ? D.stopById[selected] : undefined, ris = routesInPlay();
  let wants = [];
  const ap = JR ? approach(clockNow) : null;
  if (JR) { const was = JR.appBus; JR.appBus = ap ? ap.bus.id : null; if (was !== JR.appBus) for (const m of busMarkers.values()) paintBus(m); }
  if (ap) wants = [{ ri: ap.bus.ri, stops: ap.stops, from: [ap.bus.lon, ap.bus.lat], open: true }];
  else if (JR) wants = [];
  else if (c) wants = [{ ri: c.ri, stops: busPath(c, clockNow), from: [c.lon, c.lat] }];
  else if (si !== undefined && ris.length) wants = stopPaths(si, ris, clockNow);
  wants = wants.filter(w => w.stops.length > 1);
  // The shuttle's: no timetable, so each loop's line itself, from the bus or the stop round to it again.
  const ub = sb && !c ? live.buses.find(x => x.id === sb) : null;
  const usi = ub ? undefined : selectedU !== null ? selectedU : uHilite ? U.stopById[uHilite] : si !== undefined && U && U.sharedByCvtd[si] ? U.sharedByCvtd[si].i : undefined;
  const loops = loopsInPlay().map(ri => ({ ri, path: ub ? loopPath(ri, [ub.lon, ub.lat], ub.along) : loopPath(ri, [U.stops[usi].lon, U.stops[usi].lat], U.routes[ri].stopAlong[usi]) })).filter(w => w.path.length > 1);
  if (!wants.length && !loops.length) { if (runsKey !== null) { runsKey = null; map.getSource('runs').setData(empty); } return; }
  const pick = [sb, selected, selectedU, uHilite].join('|');
  const key = (ap ? ap.bus.id + '@' + ap.bus.lat.toFixed(4) + ',' + ap.bus.lon.toFixed(4) : c ? c.id + '@' + c.lat.toFixed(4) + ',' + c.lon.toFixed(4) : ub ? ub.id + '@' + ub.lat.toFixed(4) + ',' + ub.lon.toFixed(4) : pick) + '|' + (dark() ? 'd' : 'l') + '|' + wants.map(w => w.ri + ':' + w.stops.map(x => x[1]).join('.')).join(';') + '|' + loops.map(w => w.ri).join('.');
  if (key === runsKey) return;
  const fc = wants.length ? await shapes() : null;
  if (!map || !map.getSource('runs') || pick !== [selectedBus || ringed, selected, selectedU, uHilite].join('|')) return;   // moved on while the shapes came
  const n = wants.length + loops.length, feats = [], wf = n === 1 ? 1 : n === 2 ? 0.75 : 0.6;   // strands side by side, each narrower
  // One line a strand, faded along itself by its layer's gradient in its route's colour.
  let ns = 0;
  const strand = (path, hex, ln) => {
    const k = ns++;
    if (k >= RUN_STRANDS.length) return [];   // more ways than layers: no stop in the valley has them
    map.setPaintProperty(RUN_STRANDS[k], 'line-gradient', fadeRamp(lineInk('#' + hex)));
    return [{ type: 'Feature', properties: { strand: k, wf, lane: ln }, geometry: { type: 'LineString', coordinates: path } }];
  };
  const lane = idx => (idx - (n - 1) / 2) * wf * 1.15;
  for (const [idx, w] of wants.entries()) {
    // The shape of each route in turn: the tail onto another route is that route's shape.
    const routeAt = i => w.stops[i][2] !== undefined ? w.stops[i][2] : w.ri;
    let path = [], firstLeg = 0;
    for (let i = 0; i < w.stops.length;) {
      const r = routeAt(i); let j = i;
      while (j + 1 < w.stops.length && routeAt(j + 1) === r) j++;
      const part = fc ? runPath(fc, r, w.stops.slice(i, j + 1)) : w.stops.slice(i, j + 1).map(([, x]) => [D.stops[x].lon, D.stops[x].lat]);
      if (i === 0) firstLeg = fc ? runPath(fc, r, w.stops.slice(0, 2)).length : 2;
      path.push(...(path.length && part.length ? part.slice(1) : part));
      i = j + 1;
    }
    // From the bus itself: the way cut at the bus's nearest point along its first leg only (an out-and-back road
    // comes past again on the way back), unless the bus is off the line altogether, a detour. The string closes at
    // the bus too: where the way came back round to the stop the bus passed, the stretch from that stop up to the
    // bus goes on the end, so the line ends where it began.
    if (w.from && path.length > 1) {
      let bi = -1, best = Infinity;
      for (let i = 0; i + 1 < Math.min(firstLeg, path.length); i++) {
        const [ax, ay] = path[i], [bx, by] = path[i + 1], vx = (bx - ax) * KX, vy = (by - ay) * KY, px = (w.from[0] - ax) * KX, py = (w.from[1] - ay) * KY, L2 = vx * vx + vy * vy;
        const t = L2 ? Math.max(0, Math.min(1, (px * vx + py * vy) / L2)) : 0, e = Math.hypot(px - t * vx, py - t * vy);
        if (e < best) { best = e; bi = i; }
      }
      if (bi >= 0 && best < 150) {
        const round = !w.open && w.stops.length > 2 && w.stops[w.stops.length - 1][1] === w.stops[0][1];
        path = [w.from, ...path.slice(bi + 1), ...(round ? [...path.slice(1, bi + 1), w.from] : [])];
      }
    }
    if (path.length > 1) feats.push(...strand(path, D.routes[w.ri].color, lane(idx)), ...arrowLines(path, D.routes[w.ri].color, lane(idx)));
  }
  for (const [k, w] of loops.entries()) { const hx = U.routes[w.ri].color.slice(1), ln = lane(wants.length + k);
    feats.push(...(U.routes[w.ri].shape.length ? strand(w.path, hx, ln) : fadePieces(w.path, hx, { wf, lane: ln, approx: true })), ...arrowLines(w.path, U.routes[w.ri].color.slice(1), lane(wants.length + k))); }
  feats.sort((x, y) => (x.properties.a ?? 0) - (y.properties.a ?? 0));   // the brightest pieces drawn last, on top, where ways share a road
  runsKey = key;
  map.getSource('runs').setData({ type: 'FeatureCollection', features: feats });
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
  const features = rtBase.items.map(({ si, w, lock, starts, props }) => {
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
      // A first run's 'starts here' never waits: its clearest spot, clear or not.
      order = [...order, ...corners].filter(k => n[k] < 500 || starts).sort((x, y) => n[x] - n[y]).slice(0, 2);
    }
    if (!order.length) return null;
    return { type: 'Feature', properties: { ...props, v: order.flatMap(k => [k, off[k]]) }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } };
  }).filter(Boolean);
  map.getSource('rtimes').setData({ type: 'FeatureCollection', features });
}
