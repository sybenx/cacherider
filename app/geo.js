// Addresses, from the valley's own arithmetic. Every town numbers its streets
// from an origin, so "1400 North 500 East" is a point once the town's grid is
// known; tools/grid.py fitted each grid from the street names in our tiles.
import { BASE, D, nearest, distance } from './data.js';
import { WalkNet } from './walknet.js';

let G = null;
export async function loadGrid() {
  if (G) return G;
  try { G = await (await fetch(BASE + 'data/grid.json')).json(); } catch { G = { grids: [], places: [] }; }
  return G;
}

const DIR = { n: 'N', north: 'N', s: 'S', south: 'S', e: 'E', east: 'E', w: 'W', west: 'W' };
const WORD = { N: 'North', S: 'South', E: 'East', W: 'West' };

/** "1400 n 500 e logan" → { n: 1400, e: 500, town: 'logan', label: '1400 North 500 East' }, or null. */
export function parseAddress(q) {
  let t = q.toLowerCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/\b(street|st|road|rd|drive|dr|avenue|ave|lane|ln)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const pairs = [];
  const re = /(\d+)\s*(north|south|east|west|n|s|e|w)\b/g;
  let m;
  while ((m = re.exec(t))) pairs.push({ val: +m[1], dir: DIR[m[2]], i: m.index, len: m[0].length });
  let rest = t;
  for (const p of [...pairs].reverse()) rest = rest.slice(0, p.i) + ' ' + rest.slice(p.i + p.len);
  rest = rest.replace(/\s+/g, ' ').trim();
  let n = null, e = null, parts = [];
  for (const p of pairs) {
    if ((p.dir === 'N' || p.dir === 'S') && n === null) { n = p.dir === 'N' ? p.val : -p.val; parts.push(`${p.val} ${WORD[p.dir]}`); }
    else if ((p.dir === 'E' || p.dir === 'W') && e === null) { e = p.dir === 'E' ? p.val : -p.val; parts.push(`${p.val} ${WORD[p.dir]}`); }
  }
  // Main Street is east–west zero; Center Street is north–south zero.
  if (/\bmain\b/.test(rest) && e === null && n !== null) { e = 0; parts.push('Main'); rest = rest.replace(/\bmain\b/, ''); }
  if (/\bcenter\b/.test(rest) && n === null && e !== null) { n = 0; parts.push('Center'); rest = rest.replace(/\bcenter\b/, ''); }
  if (n === null || e === null) return null;
  const town = rest.replace(/\s+/g, ' ').trim();
  return { n, e, town, label: parts.join(' ') };
}

const norm = s => s.toLowerCase().replace(/\bn\b/, 'north').replace(/\bs\b/, 'south').replace(/\s+/g, ' ').trim();

/** Every place in the valley an address could mean, nearest stops with each. */
export function geocode(addr, maxStops = 4) {
  if (!G) return [];
  const out = [];
  const want = addr.town ? norm(addr.town) : '';
  for (const g of G.grids) {
    const towns = g.towns.map(norm);
    if (want && !towns.some(t => t.startsWith(want) || t.includes(want))) continue;
    const slack = want ? 3000 : 1200;
    if (addr.n < g.n[0] - slack || addr.n > g.n[1] + slack || addr.e < g.e[0] - slack || addr.e > g.e[1] + slack) continue;
    const lat = g.lat0 + g.klat * addr.n, lon = g.lon0 + g.klon * addr.e;
    const [la0, lo0, la1, lo1] = g.bounds;
    const pad = want ? 0.03 : 0;
    if (lat < la0 - pad || lat > la1 + pad || lon < lo0 - pad || lon > lo1 + pad) continue;
    // The nearest real town names the spot (hamlets in the map data carry made-up populations); a town's own grid names itself.
    // An address on a grid is that grid's town's address; the nearest other town is a hint.
    const near = G.places.filter(p => p.pop >= 1500 && p.name !== g.name).map(p => ({ p, d: distance(lat, lon, p.lat, p.lon) })).sort((a, b) => a.d - b.d)[0];
    const seat = G.places.find(p => p.name === g.name);
    const nearHint = g.towns.length > 1 && near && seat && near.d < 6000 && near.d < distance(lat, lon, seat.lat, seat.lon) ? near.p.name : '';
    const stops = nearestTo(lat, lon, maxStops);
    out.push({ lat, lon, town: g.name, near: nearHint, grid: g.name, label: addr.label, stops });
  }
  // Dedupe spots that two grids agree on, nearest stops first.
  const seen = [];
  return out.filter(o => { if (seen.some(s => distance(s.lat, s.lon, o.lat, o.lon) < 300)) return false; seen.push(o); return true; })
            .sort((a, b) => (a.stops[0] ? a.stops[0].d : 1e9) - (b.stops[0] ? b.stops[0].d : 1e9));
}

/** Roughly where a spot is, as the valley says it: 'about 1400 North 500 East, Logan'. A town's own grid before the
 *  county's where both cover it; on the county's, the nearest town is named. Empty off every grid. */
export function whereabouts(lat, lon) {
  if (!G) return '';
  const on = G.grids.filter(g => { const [la0, lo0, la1, lo1] = g.bounds; return lat >= la0 && lat <= la1 && lon >= lo0 && lon <= lo1; });
  const g = on.find(x => x.towns.length === 1) || on[0];
  if (!g) return '';
  const n = Math.round((lat - g.lat0) / g.klat / 10) * 10, e = Math.round((lon - g.lon0) / g.klon / 10) * 10;
  const ns = n === 0 ? 'Center' : Math.abs(n) + (n > 0 ? ' North' : ' South'), ew = e === 0 ? 'Main' : Math.abs(e) + (e > 0 ? ' East' : ' West');
  const near = g.towns.length > 1 ? G.places.filter(p => p.pop >= 1500).map(p => ({ p, d: distance(lat, lon, p.lat, p.lon) })).sort((a, b) => a.d - b.d)[0] : null;
  return `about ${ns} ${ew}, ${g.towns.length === 1 || !near || near.d >= 6000 || near.p.name === g.name ? g.name : 'near ' + near.p.name}`;
}

/** The stops within 4 km, or failing that the nearest one however far: the quickest walks first. */
export function nearestTo(lat, lon, n = 4) {
  const all = nearest(lat, lon, n + 4);   // a few more than asked: a stop up the hill can give way to one past it
  const close = all.filter(s => s.d <= 4000);
  return close.length ? byWalk(close, lat, lon, true).slice(0, n) : all.slice(0, 1);   // a spot: walked to and from
}

export const townState = t => /preston|franklin|whitney|dayton|weston|clifton/i.test(t) ? ', Idaho' : '';

/** A spot as the far end of a journey, in an address: '@41.73500,-111.83400:Old%20Main'. A stop is its id. */
export const spotKey = (lat, lon, label = '') => '@' + (+lat).toFixed(5) + ',' + (+lon).toFixed(5) + (label ? ':' + encodeURIComponent(label) : '');
export function spotOf(key) {
  const m = /^@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?::(.*))?$/.exec(key || '');
  if (!m) return null;
  let label = m[3] || '';
  try { label = decodeURIComponent(label); } catch { /* as it came */ }
  return { lat: +m[1], lon: +m[2], label };
}
/** The `at/lat,lon/label` tail of a journey's address that starts from a spot. */
export const atPath = s => `at/${(+s.lat).toFixed(5)},${(+s.lon).toFixed(5)}/${encodeURIComponent(s.label || '')}`;

// ---- the lie of the land, for walks. data/elevation.json (tools/elevation.py) is a coarse grid of the USGS DEM,
// about 100 m a cell round the stops: enough to tell the bench from the valley floor, not a kerb from the road.
let E = null;
export async function loadElevation() {
  if (E) return E;
  try {
    const j = await (await fetch(BASE + 'data/elevation.json')).json();
    j.z = j.d.map(r => { const a = new Int16Array(r.length); let s = 0; r.forEach((v, i) => { s += v; a[i] = s; }); return a; });   // each row its first height, then the change cell to cell
    E = j;
  } catch { E = null; }   // no grid: every walk on the flat, as before
  return E;
}
/** The ground's height at a point, between the four nearest cell centres; null off the grid. */
function height(lat, lon) {
  const y = (E.lat0 - lat) / E.dlat - 0.5, x = (lon - E.lon0) / E.dlon - 0.5;
  if (y < -0.5 || x < -0.5 || y > E.rows - 0.5 || x > E.cols - 0.5) return null;
  const y0 = Math.floor(y), x0 = Math.floor(x), fy = y - y0, fx = x - x0;
  const v = (r, c) => E.z[Math.max(0, Math.min(E.rows - 1, r))][Math.max(0, Math.min(E.cols - 1, c))];
  return v(y0, x0) * (1 - fx) * (1 - fy) + v(y0, x0 + 1) * fx * (1 - fy) + v(y0 + 1, x0) * (1 - fx) * fy + v(y0 + 1, x0 + 1) * fx * fy;
}
// ---- walks: one rule, the same everywhere and from the first page. A walk is the straight line between its ends and
// a third again for the corners of the town's grid, at PACE: no climb, no crossings, no network in the reckoning, so
// the stop and the bus picked never change while a file loads, and two pages never time one walk two ways. (It was a
// crow's line, then the same bent by the busy roads' crossings, then the sidewalks and paths with or without them,
// the climb counted and steep ways avoided: four answers, each switching to the next as its file came in.) The ways
// themselves (data/walknet.json) only draw a walk; steep ground is shown on the directions' map (steepImage).
export const PACE = 75, CORNERS = 1.3;
/** Metres walked from one point to another: the straight line, a third again for the corners. */
export const walkMetres = (lat1, lon1, lat2, lon2, d = distance(lat1, lon1, lat2, lon2)) => d * CORNERS;
/** Minutes walked from one point to another, at least one: the one reckoning for every walk the app times. */
export const walkMins = (lat1, lon1, lat2, lon2, d = distance(lat1, lon1, lat2, lon2)) => Math.max(1, Math.ceil(walkMetres(lat1, lon1, lat2, lon2, d) / PACE));

/** Steep ground, for the directions' map: the grid's cells (about 100 m north to south, 75 east to west: the grid is
 *  square in degrees) where the land rises SLOPE or more (6%, the grade a walk felt steep at when walks were timed by
 *  the climb), as an image in red, stronger the steeper, and its four corners for a map's image source; null without
 *  the grid. Made once. */
const SLOPE = 0.06, SLOPE_FULL = 0.2;
export const steepKnown = () => !!E;
let steepImg;
export function steepImage() {
  if (steepImg !== undefined) return steepImg;
  if (!E || typeof document === 'undefined') return null;
  const { rows, cols } = E, cv = document.createElement('canvas');
  const dy = 2 * E.dlat * 110540, dx = 2 * E.dlon * 111320 * Math.cos((E.lat0 - rows * E.dlat / 2) * Math.PI / 180);   // metres across two cells
  cv.width = cols; cv.height = rows;
  const cx = cv.getContext('2d'), img = cx.createImageData(cols, rows);
  const z = (r, c) => E.z[Math.max(0, Math.min(rows - 1, r))][Math.max(0, Math.min(cols - 1, c))];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const g = Math.hypot((z(r, c + 1) - z(r, c - 1)) / dx, (z(r + 1, c) - z(r - 1, c)) / dy);
    const k = 4 * (r * cols + c), a = Math.max(0, Math.min(1, (g - SLOPE) / (SLOPE_FULL - SLOPE)));
    img.data[k] = 214; img.data[k + 1] = 40; img.data[k + 2] = 40; img.data[k + 3] = g < SLOPE ? 0 : Math.round(80 + 100 * a);
  }
  cx.putImageData(img, 0, 0);
  const n = E.lat0, w = E.lon0, s = E.lat0 - rows * E.dlat, e = E.lon0 + cols * E.dlon;
  return steepImg = { url: cv.toDataURL(), coordinates: [[w, n], [e, n], [e, s], [w, s]] };
}

// ---- the busy roads (data/walks.json, tools/walks.py), their names for the ways' search below.
let WK = null;
const KY = 110540, KX = 111320 * Math.cos(41.75 * Math.PI / 180), CELL = 0.005;
const cellOf = (lat, lon) => Math.floor(lat / CELL) + ':' + Math.floor(lon / CELL);
export async function loadWalks() {
  if (WK) return WK;
  try {
    const j = await (await fetch(BASE + 'data/walks.json')).json(), grid = new Map();
    j.roads.forEach((r, ri) => {
      for (let k = 0; k < r.p.length - 1; k++) {
        const [a, b] = [r.p[k], r.p[k + 1]];
        for (let y = Math.floor(Math.min(a[0], b[0]) / CELL); y <= Math.floor(Math.max(a[0], b[0]) / CELL); y++)
          for (let x = Math.floor(Math.min(a[1], b[1]) / CELL); x <= Math.floor(Math.max(a[1], b[1]) / CELL); x++) {
            const key = y + ':' + x; if (!grid.has(key)) grid.set(key, []); grid.get(key).push([ri, k]);
          }
      }
    });
    WK = { roads: j.roads, x: j.x.map(([lat, lon, kind, roads, at]) => ({ lat, lon, kind, roads, at: at || [] })), grid };
  } catch { WK = null; }
  return WK;
}
/** The busy road nearest a point, by name (walks.json's). */
function roadAt(lat, lon) {
  if (!WK) return null;
  let best = null, bd = 40;
  for (const [ri, k] of WK.grid.get(cellOf(lat, lon)) || []) {
    const p = WK.roads[ri].p[k], q = WK.roads[ri].p[k + 1];
    const ax = (p[1] - lon) * KX, ay = (p[0] - lat) * KY, bx = (q[1] - lon) * KX, by = (q[0] - lat) * KY, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const u = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0, d = Math.hypot(ax + u * dx, ay + u * dy);
    if (d < bd) { bd = d; best = WK.roads[ri].n; }
  }
  return best;
}

// ---- the ways (app/walknet.js, data/walknet.json from tools/walknet.py): footways, paths, steps, sidewalks and
// streets, for drawing a walk along them. Never for timing it (walkMins). Loaded after the page.
let NET = null, netLoading = null;
const netMemo = new Map();
export function loadWalkNet() {
  return netLoading ??= (async () => {
    try {
      const [j] = await Promise.all([(await fetch(BASE + 'data/walknet.json')).json(), loadElevation(), loadWalks()]);
      NET = new WalkNet(j, (la, lo) => E ? height(la, lo) : 0, WK ? WK.x : [], roadAt, { PACE, RISE: 10, DROP: 30, FEEL: 0.02, STEEP: 0.06, STEEP_DOWN: 0.10 });
      netMemo.clear();
    } catch { NET = null; }
    return NET;
  })();
}
/** A walk as it's drawn, [lon, lat] points: along the ways the shortest way, any road crossed where it's met, once
 *  they're in; else straight. */
export function walkWay(lat1, lon1, lat2, lon2) {
  const straight = [[lon1, lat1], [lon2, lat2]];
  if (!NET) return straight;
  const key = lat1.toFixed(5) + ',' + lon1.toFixed(5) + '>' + lat2.toFixed(5) + ',' + lon2.toFixed(5);
  if (!netMemo.has(key)) {
    if (netMemo.size > 2000) netMemo.clear();
    const w = NET.route(lat1, lon1, lat2, lon2, { restricted: false, avoid: false });
    netMemo.set(key, w && w.coords && w.coords.length > 1 ? w.coords : straight);
  }
  return netMemo.get(key);
}
/** Stops nearest a point, as nearest() gives them ({ i, d }), in the order a walk to them takes, each with its
 *  minutes. `both`, for a place rather than the rider: walked to and back. `at`, the stop's point, for stops not
 *  Connect's (the shuttle's). */
export function byWalk(list, lat, lon, both = false, at = x => D.stops[x.i]) {
  return list.map(x => {
    const s = at(x), mins = walkMins(lat, lon, s.lat, s.lon, x.d);
    return { ...x, mins, cost: both ? mins + walkMins(s.lat, s.lon, lat, lon, x.d) : mins };
  }).sort((a, b) => a.cost - b.cost || a.d - b.d);
}
