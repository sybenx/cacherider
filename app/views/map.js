// The map: self-hosted vector tiles, every stop in its routes' colour, the
// route lines, and a card for the stop you tap. Loaded only when first shown.
import maplibregl from '../../vendor/maplibre-gl.mjs';
import { Protocol } from '../../vendor/pmtiles.mjs';
import { layers, namedFlavor } from '../../vendor/basemaps.mjs';
import { D, BASE, stop, route, nextAt, search, servicesOn, nextServiceDay, nextPulse } from '../data.js';
import { now, relative, fmtDay, dayName, clockText, metres } from '../time.js';
import { html, icon, badge, badges, time, sched, corners, depRow, stopRow, stopTitle } from '../ui.js';
import { nearMe } from '../main.js';
import { distance } from '../data.js';

let map = null, ready = false, selected = null, meMarker = null, shapesLoaded = false, flavorName = null;
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
      protomaps: { type: 'vector', url: 'pmtiles://' + BASE + 'data/cachevalley.pmtiles', attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' },
      stops: { type: 'geojson', data: stopsGeo() },
      lines: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      ...layers('protomaps', f, { lang: 'en' }),
      { id: 'route-lines', type: 'line', source: 'lines', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, 3.5, 17, 6], 'line-opacity': 0.75 } },
      { id: 'stops', type: 'circle', source: 'stops', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5.5, 17, 8], 'circle-color': ['get', 'color'], 'circle-stroke-color': flavor === 'dark' ? '#101214' : '#ffffff', 'circle-stroke-width': 1.5, 'circle-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 13, 1] } },
      { id: 'stop-selected', type: 'circle', source: 'stops', filter: ['==', ['get', 'id'], ''], paint: { 'circle-radius': 11, 'circle-color': ['get', 'color'], 'circle-stroke-color': flavor === 'dark' ? '#94bce3' : '#5980a6', 'circle-stroke-width': 3 } },
      { id: 'stop-labels', type: 'symbol', source: 'stops', minzoom: 15, layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': flavor === 'dark' ? '#eef0f2' : '#1d1f20', 'text-halo-color': flavor === 'dark' ? '#101214' : '#f2f2f3', 'text-halo-width': 1.2 } },
    ],
  };
}

function stopsGeo() {
  return { type: 'FeatureCollection', features: D.stops.map(s => ({ type: 'Feature', id: +s.id, properties: { id: s.id, name: s.name, color: '#' + route(s.routes[0]).color }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })) };
}

async function loadShapes() {
  if (shapesLoaded) return;
  shapesLoaded = true;
  try {
    const r = await fetch(BASE + 'data/cvtd-shapes.json');
    const j = await r.json();
    const fc = { type: 'FeatureCollection', features: j.lines.map(l => ({ type: 'Feature', properties: { color: '#' + route(l.route).color, route: l.route }, geometry: { type: 'LineString', coordinates: l.coords } })) };
    if (map.getSource('lines')) map.getSource('lines').setData(fc);
  } catch (e) { console.warn('shapes', e); }
}

function init(app) {
  if (map) return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  col.innerHTML = '<div id="map"></div>' + chrome();
  const center = app.geo ? [app.geo.lon, app.geo.lat] : [-111.8300, 41.7330];
  map = new maplibregl.Map({ container: 'map', style: style(), center, zoom: app.geo ? 15 : 13, minZoom: 10, maxZoom: 17.5, attributionControl: { compact: true }, maxBounds: [[-112.4, 41.3], [-111.3, 42.4]] });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.on('load', () => { ready = true; loadShapes(); if (selected) applySelection(); if (app.geo) placeMe(app.geo); });
  map.on('click', 'stops', e => { const f = e.features[0]; select(f.properties.id, app, true); e.originalEvent._stopHit = true; });
  map.on('click', e => { if (!e.originalEvent._stopHit) select(null, app); });
  map.on('mouseenter', 'stops', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'stops', () => map.getCanvas().style.cursor = '');
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((dark() ? 'dark' : 'light') !== flavorName) { ready = false; shapesLoaded = false; map.setStyle(style()); map.once('style.load', () => { ready = true; loadShapes(); applySelection(); }); } });
  wireChrome(app);
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
    results.innerHTML = hits.length ? hits.map(i => html`<a class="stoprow" href="#/map/${stop(i).id}" data-i="${i}"><div class="mid"><span class="name">${stopTitle(i)}</span>${badges(stop(i).routes, 20)}</div><div class="end">${icon('fwd', 18)}</div></a>`).join('') : html`<div class="empty"><p>No stops match “${q}”.</p></div>`;
    results.classList.remove('hidden');
    results.querySelectorAll('a').forEach(a => a.onclick = e => { e.preventDefault(); input.value = ''; results.classList.add('hidden'); select(stop(+a.dataset.i).id, app, true, true); });
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
}

function select(id, app, fly = false, zoomIn = false) {
  selected = id;
  applySelection();
  const card = col.querySelector('#mapcard');
  if (!id) { card.classList.add('hidden'); return; }
  const si = D.stopById[id];
  if (si === undefined) return;
  const s = stop(si);
  if (fly && map) map.easeTo({ center: [s.lon, s.lat], zoom: zoomIn ? 16 : Math.max(map.getZoom(), 15), offset: [0, -120] });
  const desktop = matchMedia('(min-width: 900px)').matches;
  if (desktop && fly) { if (location.hash !== '#/stop/' + id) location.hash = '#/stop/' + id; card.classList.add('hidden'); return; }
  const clockNow = now();
  const next = nextAt(si, 3, clockNow);
  const fromHub = metres(distance(s.lat, s.lon, D.hub.lat, D.hub.lon));
  card.innerHTML = html`<div class="grip"></div><div class="head"><span class="eyebrow">${s.town} · Stop ${s.code || s.id} · ${fromHub} from the ${D.hub.name}</span><div class="name"><span>${s.name}</span>${badges(s.routes, 30, true)}</div></div>
    ${next.length ? next.map(t => depRow(t, clockNow, { name: t.day ? undefined : undefined })) : html`<div class="empty"><p>Nothing scheduled here in the next week.</p></div>`}
    <div class="open"><a class="btn btn-primary btn-lg btn-block blueprint" href="#/stop/${s.id}">${corners()}Open stop</a></div>`;
  card.classList.remove('hidden');
}

function notice(clockNow) {
  const n = col.querySelector('#mapnotice');
  if (!n) return;
  if (servicesOn(clockNow.ymd).size) { n.innerHTML = ''; return; }
  const resume = nextServiceDay(clockNow);
  const first = resume ? nextPulse(1, clockNow).find(p => p.ymd === resume) : null;
  n.innerHTML = html`<div class="callout">${icon('moon', 20)}<div><b>No service today · ${dayName(clockNow.ymd)}</b><div class="sub">${resume ? `Buses resume ${fmtDay(resume)}.` : ''}${first ? ` First departures from the ${D.hub.name} at ${clockText(first.min)}.` : ''}</div></div></div>`;
}

/** Called by the router whenever the map is on screen. */
export function show({ stopId, focus, hub }, app, clockNow) {
  init(app);
  requestAnimationFrame(() => map.resize());
  notice(clockNow);
  if (app.geo) placeMe(app.geo);
  if (hub) { selected = null; applySelection(); col.querySelector('#mapcard').classList.add('hidden'); map.easeTo({ center: [D.hub.lon, D.hub.lat], zoom: 16 }); return; }
  if (stopId) {
    const si = D.stopById[stopId];
    if (si !== undefined) {
      const s = stop(si);
      selected = stopId; applySelection();
      if (focus) map.jumpTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 15) });
      if (!matchMedia('(min-width: 900px)').matches) select(stopId, app, false);
    }
  } else if (app.route && app.route.name === 'map') {
    select(null, app);
  }
}
