// The map: self-hosted vector tiles, every stop in its routes' colour, the
// route lines, and a card for the stop you tap. Loaded only when first shown.
import * as maplibregl from '../../vendor/maplibre-gl.mjs';
import { layers, namedFlavor } from '../../vendor/basemaps.mjs';
import { D, BASE, stop, route, nextAt, search, servicesOn, nextServiceDay, nextPulse, distance, nearest, stopAlerts, closedRoutes } from '../data.js';
import { now, relative, fmtDay, dayName, clockText, metres } from '../time.js';
import { html, icon, badge, badges, time, sched, corners, depRow, stopRow, stopTitle } from '../ui.js';
import { nearMe } from '../main.js';
import { parseAddress, geocode, townState, nearestTo } from '../geo.js';
import { U, live, busNext, board, liveRow, chip, chips, meter, liveTag, heading, loadWords, hasData, isStale, lastSeen } from '../usu.js';

let map = null, ready = false, selected = null, uHilite = '', meMarker = null, pinMarker = null, flavorName = null, lastFocused = null;
let mm = null, mmEl = null, mmReady = false, mmKey = null, mmSel = null;   // the small map on a stop page
const busMarkers = new Map();   // bus id → { marker, el }
let selectedBus = null, selectedU = null, hiRoute = null;   // hiRoute: a shuttle route index, its loop drawn on top
// The street map is one small file a tile, cut from OpenStreetMap by tools/tiles.py; tiles/tiles.json says how far it reaches.
let TILES = { minzoom: 10, maxzoom: 15, bounds: [-111.98, 41.58, -111.68, 42.16] };
const col = document.getElementById('mapcol');
const dark = () => matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';

function style() {
  const flavor = dark() ? 'dark' : 'light';
  flavorName = flavor;
  const f = namedFlavor(flavor);
  return {
    version: 8,
    glyphs: BASE + 'vendor/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: BASE + 'vendor/basemaps-assets/sprites/' + flavor,
    sources: {
      protomaps: { type: 'vector', tiles: [BASE + 'tiles/{z}/{x}/{y}.pbf'], minzoom: TILES.minzoom, maxzoom: TILES.maxzoom, bounds: TILES.bounds, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' },
      stops: { type: 'geojson', data: stopsGeo() },
      lines: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      spot: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      ustops: { type: 'geojson', data: usuStopsGeo() },
      ulines: { type: 'geojson', data: usuLinesGeo() },
    },
    layers: [
      ...layers('protomaps', f, { lang: 'en' }),
      { id: 'spot-fill', type: 'fill', source: 'spot', paint: { 'fill-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'fill-opacity': 0.18 } },
      { id: 'spot-edge', type: 'line', source: 'spot', paint: { 'line-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.8 } },
      { id: 'route-lines', type: 'line', source: 'lines', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, 3.5, 17, 6], 'line-opacity': 0.75 } },
      { id: 'usu-lines', type: 'line', source: 'ulines', minzoom: 12, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 15, 2.5, 17, 4], 'line-opacity': 0.9, 'line-dasharray': [3, 1.5] } },
      { id: 'usu-line-on', type: 'line', source: 'ulines', filter: ['==', ['get', 'id'], ''], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 15, 5.5, 17, 9], 'line-opacity': 1 } },
      { id: 'usu-selected', type: 'circle', source: 'ustops', filter: ['==', ['get', 'id'], ''], paint: { 'circle-radius': 12, 'circle-opacity': 0, 'circle-stroke-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'circle-stroke-width': 3 } },
      { id: 'usu-stops', type: 'symbol', source: 'ustops', minzoom: 12.5, layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 12.5, 0.45, 15, 0.7, 17, 1], 'icon-allow-overlap': true }, paint: {} },
      { id: 'usu-labels', type: 'symbol', source: 'ustops', minzoom: 15.5, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': flavor === 'dark' ? '#eef0f2' : '#1d1f20', 'text-halo-color': flavor === 'dark' ? '#101214' : '#f2f2f3', 'text-halo-width': 1.2 } },
      { id: 'stops', type: 'circle', source: 'stops', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5.5, 17, 8], 'circle-color': ['get', 'color'], 'circle-stroke-color': flavor === 'dark' ? '#101214' : '#ffffff', 'circle-stroke-width': 1.5, 'circle-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 13, 1] } },
      { id: 'stop-selected', type: 'circle', source: 'stops', filter: ['==', ['get', 'id'], ''], paint: { 'circle-radius': 11, 'circle-color': ['get', 'color'], 'circle-stroke-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'circle-stroke-width': 3 } },
      { id: 'stop-labels', type: 'symbol', source: 'stops', minzoom: 15, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': flavor === 'dark' ? '#eef0f2' : '#1d1f20', 'text-halo-color': flavor === 'dark' ? '#101214' : '#f2f2f3', 'text-halo-width': 1.2 } },
    ],
  };
}

function stopsGeo() {
  return { type: 'FeatureCollection', features: D.stops.map(s => ({ type: 'Feature', id: +s.id, properties: { id: s.id, name: s.name, color: '#' + route(s.routes[0]).color }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })) };
}

function usuStopsGeo() {
  if (!U) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: U.stops.filter(s => s.routes.length).map(s => ({ type: 'Feature', properties: { id: s.id, name: s.name, icon: 'usq-' + U.routes[s.routes[0]].color.slice(1) }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })) };
}
function usuLinesGeo() {
  if (!U) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: U.routes.filter(r => r.shape.length && !r.outdated).map(r => ({ type: 'Feature', properties: { id: r.id, color: r.color }, geometry: { type: 'LineString', coordinates: r.shape } })) };
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

let shapesFC = null;   // the route lines, fetched once for both maps
function shapes() {
  if (!shapesFC) shapesFC = fetch(BASE + 'data/cvtd-shapes.json').then(r => r.json())
    .then(j => ({ type: 'FeatureCollection', features: j.lines.map(l => ({ type: 'Feature', properties: { color: '#' + route(l.route).color, route: l.route }, geometry: { type: 'LineString', coordinates: l.coords } })) }))
    .catch(e => { console.warn('shapes', e); shapesFC = null; return null; });
  return shapesFC;
}
async function loadShapes(m = map) {
  const fc = await shapes();
  if (fc && m && m.getSource('lines')) m.getSource('lines').setData(fc);
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
  map = new maplibregl.Map({ container: 'map', style: style(), center, zoom: app.geo ? 15 : 13, minZoom: 10, maxZoom: 17.5, attributionControl: { compact: true }, maxBounds: [[-112.4, 41.3], [-111.3, 42.4]] });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  squaresOnDemand(map);
  map.on('load', () => { ready = true; addUsuImages(); loadShapes(); applySelection(); if (app.geo) placeMe(app.geo); map.resize(); liveUpdate(app); });
  map.on('click', 'usu-stops', e => { const f = e.features[0]; selectU(f.properties.id, app); e.originalEvent._stopHit = true; });
  map.on('mouseenter', 'usu-stops', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'usu-stops', () => map.getCanvas().style.cursor = '');
  setTimeout(() => map.resize(), 300);
  map.on('click', 'stops', e => { const f = e.features[0]; select(f.properties.id, app, true); e.originalEvent._stopHit = true; });
  map.on('click', e => { if (!e.originalEvent._stopHit) { selectedBus = null; selectedU = null; select(null, app); } });
  map.on('mouseenter', 'stops', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'stops', () => map.getCanvas().style.cursor = '');
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((dark() ? 'dark' : 'light') !== flavorName) { ready = false; map.setStyle(style()); map.once('style.load', () => { ready = true; loadShapes(); applySelection(); }); } });
  wireChrome(app);
  wireGrip(app);
}

/** Dragging the card's grip down closes it; the browser's pull-to-refresh never sees the gesture. */
function wireGrip(app) {
  const card = col.querySelector('#mapcard');
  let y0 = null, pid = null;
  card.addEventListener('pointerdown', e => {
    if (!e.target.closest('.grip')) return;
    y0 = e.clientY; pid = e.pointerId; card.setPointerCapture(pid); card.style.transition = 'none';
    e.preventDefault();
  });
  card.addEventListener('pointermove', e => { if (y0 === null) return; card.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
  const end = e => {
    if (y0 === null) return;
    const dy = e.clientY - y0; y0 = null;
    card.style.transition = ''; card.style.transform = '';
    if (dy > 50) { selectedBus = null; selectedU = null; select(null, app); }
  };
  card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
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
  // A tapped bus: its loop on top at full strength, everything else's lines and buses faded back.
  const on = hiRoute !== null && U ? U.routes[hiRoute].id : '';
  map.setFilter('usu-line-on', ['==', ['get', 'id'], on]);
  map.setPaintProperty('usu-lines', 'line-opacity', on ? 0.25 : 0.9);
  map.setPaintProperty('route-lines', 'line-opacity', on ? 0.3 : 0.75);
  for (const m of busMarkers.values()) m.el.classList.toggle('dim', hiRoute !== null && m.ri !== hiRoute);
}

function select(id, app, fly = false, zoomIn = false) {
  selected = id; uHilite = ''; hiRoute = null;
  applySelection();
  const card = col.querySelector('#mapcard');
  if (!id) { card.classList.remove('open'); return; }
  const si = D.stopById[id];
  if (si === undefined) return;
  const s = stop(si);
  // Beside the stop list on desktop, a tap opens the stop page; on the Map tab, or a phone, the card.
  const desktop = matchMedia('(min-width: 900px)').matches && !(app.route && app.route.name === 'map');
  if (desktop && fly) {
    map.easeTo({ center: [s.lon, s.lat], zoom: zoomIn ? 16 : Math.max(map.getZoom(), 15), duration: 700 });
    if (location.hash !== '#/stop/' + id) location.hash = '#/stop/' + id;
    card.classList.remove('open'); return;
  }
  const clockNow = now();
  const next = nextAt(si, 3, clockNow);
  const fromHub = metres(distance(s.lat, s.lon, D.hub.lat, D.hub.lon));
  const closed = closedRoutes(si, clockNow.ymd), al = stopAlerts(si, clockNow.ymd);
  const alertLine = al.length ? html`<span class="eyebrow alert">${icon('ban', 14)}${closed.size ? [...closed].map(ri => 'Route ' + D.routes[ri].short).join(' and ') + (closed.size > 1 ? ' skip' : ' skips') + ' this stop' : al[0].title}</span>` : '';
  card.innerHTML = html`<div class="grip"></div><div class="head"><span class="eyebrow">${s.town} · Stop ${s.code || s.id} · ${fromHub} from the ${D.hub.name}</span><div class="name"><span>${s.name}</span>${badges(s.routes, 30, true)}</div>${alertLine}</div>
    ${next.length ? next.map(t => depRow(t, clockNow, { name: t.day ? undefined : undefined })) : html`<div class="empty"><p>Nothing scheduled here in the next week.</p></div>`}
    <div class="open"><a class="btn btn-primary btn-lg btn-block blueprint" href="#/stop/${s.id}">${corners()}Open stop</a></div>`;
  card.classList.remove('hidden');
  requestAnimationFrame(() => {
    card.classList.add('open');
    if (!fly || !map) return;
    // Move the map only if the stop would sit under the card or off screen; then ease, gently.
    const pt = map.project([s.lon, s.lat]);
    const h = map.getContainer().clientHeight, w = map.getContainer().clientWidth;
    const clear = h - card.offsetHeight - 24;
    const zoom = map.getZoom() < 13 || zoomIn ? 15.5 : map.getZoom();
    if (pt.y > clear || pt.y < 90 || pt.x < 24 || pt.x > w - 24 || zoom !== map.getZoom()) {
      map.easeTo({ center: [s.lon, s.lat], zoom, offset: [0, -(card.offsetHeight / 2)], duration: 650, essential: true });
    }
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
const ARROW = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 3 20 20l-8-4-8 4z"/></svg>';
export function liveUpdate(app) {
  if (!map || !U) return;
  const seen = new Set();
  for (const b of live.buses) {
    seen.add(b.id);
    let m = busMarkers.get(b.id);
    if (!m) {
      const el = document.createElement('div');
      el.className = 'bus-marker'; el.innerHTML = ARROW; el.title = U.routes[b.ri].name + ' · bus ' + b.name;
      el.onclick = ev => { ev.stopPropagation(); selectBus(b.id, app); };
      m = { marker: new maplibregl.Marker({ element: el, rotationAlignment: 'map' }), el, ri: b.ri };
      busMarkers.set(b.id, m);
      m.marker.setLngLat([b.lon, b.lat]).addTo(map);
    } else glide(m, b.lon, b.lat);
    m.el.style.background = U.routes[b.ri].color;
    m.marker.setRotation(b.course);
    m.ri = b.ri;
    m.el.classList.toggle('on', selectedBus === b.id);
    m.el.classList.toggle('dim', hiRoute !== null && b.ri !== hiRoute);
  }
  for (const [id, m] of busMarkers) if (!seen.has(id)) { if (m.anim) cancelAnimationFrame(m.anim); m.marker.remove(); busMarkers.delete(id); }
  if (selectedBus) { if (live.buses.some(b => b.id === selectedBus)) busCard(app); else { selectedBus = null; hiRoute = null; applySelection(); col.querySelector('#mapcard').classList.remove('open'); } }
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
  selectedBus = id; selectedU = null; selected = null; uHilite = ''; hiRoute = b ? b.ri : null; applySelection();
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
    ${b.cap ? html`<div class="load">${meter(b, true)}<span>${loadWords(b)}</span></div>` : ''}</div>
    ${next.length ? html`<div class="nextstops"><i class="line" style="background:${r.color}"></i>${next.map((n, i) => html`<a class="ns${n.here && i === 0 ? ' here' : ''}" href="#/usu/${U.stops[n.si].id}"><span class="dot"><i style="${n.here && i === 0 ? 'background:' + r.color : ''}"></i></span><span class="nm">${U.stops[n.si].name}</span><span class="when">${n.here && i === 0 ? 'here now' : isStale() ? '' : 'about ' + Math.max(1, n.min) + ' min'}</span></a>`)}</div>` : ''}`;
  card.classList.remove('hidden');
  requestAnimationFrame(() => card.classList.add('open'));
}
function selectU(id, app) {
  const si = U.stopById[id];
  if (si === undefined) return;
  if (matchMedia('(min-width: 900px)').matches && !(app.route && app.route.name === 'map')) { location.hash = '#/usu/' + id; return; }
  selectedU = si; selectedBus = null; selected = null; uHilite = id; hiRoute = null; applySelection();
  for (const m of busMarkers.values()) m.el.classList.remove('on');
  const s = U.stops[si];
  uCard(app);
  const card = col.querySelector('#mapcard');
  map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 15.5), offset: [0, -(card.offsetHeight / 2)], duration: 650 });
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
  selected = null; uHilite = ''; hiRoute = null; applySelection();
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
export async function show({ stopId, ustopId, at, focus, hub, tick }, app, clockNow) {
  await init(app);
  requestAnimationFrame(() => map.resize());
  notice(clockNow);
  if (app.geo) placeMe(app.geo);
  if (tick) return;   // the minute turning is no reason to move the map
  if (pinMarker && !at) { pinMarker.remove(); setSpot(null); }
  if (stopId || ustopId || hub || at) { selectedBus = null; selectedU = null; }
  if (at) return showAt(at, app, clockNow);
  if (hub) {
    selected = null; uHilite = ''; hiRoute = null; applySelection(); col.querySelector('#mapcard').classList.remove('open');
    if (lastFocused !== 'hub') map.easeTo({ center: [D.hub.lon, D.hub.lat], zoom: 16, duration: 700 });
    lastFocused = 'hub';
    return;
  }
  if (stopId) {
    const si = D.stopById[stopId];
    if (si !== undefined) {
      const s = stop(si);
      const changed = lastFocused !== stopId;
      lastFocused = stopId;
      selected = stopId; uHilite = ''; hiRoute = null; applySelection();
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
    selected = null; uHilite = ustopId; hiRoute = null; applySelection();
    if (app.route.name === 'map') { if (changed) selectU(ustopId, app); else { selectedU = si; uCard(app); } }
    else if (focus && changed && !map.isMoving()) map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 15.5), duration: 700 });
  } else if (app.route && app.route.name === 'map') {
    lastFocused = null;
    select(null, app);
  }
}

// ---- the small map on a stop page (phones): one instance, moved from page to page
/** Draw the stop into `slot`; `sel` is { stopId } or { ustopId }. */
export async function mini(sel, slot) {
  mmSel = sel;
  const key = sel.ustopId ? 'u:' + sel.ustopId : sel.stopId;
  const s = sel.ustopId ? (U && U.stops[U.stopById[sel.ustopId]]) : D.stops[D.stopById[sel.stopId]];
  if (!s) return;
  if (!mmEl) {
    await loadTiles();
    if (!slot.isConnected) return;   // the page moved on while the tile index loaded
    mmEl = document.createElement('div'); mmEl.className = 'minimap';
    slot.prepend(mmEl);
    mm = new maplibregl.Map({ container: mmEl, style: style(), center: [s.lon, s.lat], zoom: 16, minZoom: 10, maxZoom: 17.5, interactive: false, fadeDuration: 0, attributionControl: { compact: true } });
    squaresOnDemand(mm);
    mm.on('load', () => { mmReady = true; loadShapes(mm); miniSelection(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (mm && (dark() ? 'dark' : 'light') !== flavorName) { mmReady = false; mm.setStyle(style()); mm.once('style.load', () => { mmReady = true; loadShapes(mm); miniSelection(); }); } });
  } else if (mmEl.parentNode !== slot) {
    slot.prepend(mmEl);
    requestAnimationFrame(() => mm.resize());
  }
  if (mmKey !== key) mm.jumpTo({ center: [s.lon, s.lat], zoom: 16 });
  mmKey = key;
  miniSelection();
}
function miniSelection() {
  if (!mm || !mmReady || !mmSel) return;
  mm.setFilter('stop-selected', ['==', ['get', 'id'], mmSel.stopId || '']);
  mm.setFilter('usu-selected', ['==', ['get', 'id'], mmSel.ustopId || '']);
}
