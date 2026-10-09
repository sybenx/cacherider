// Addresses, from the valley's own arithmetic. Every town numbers its streets
// from an origin, so "1400 North 500 East" is a point once the town's grid is
// known; tools/grid.py fitted each grid from the street names in our tiles.
import { BASE, D, nearest, distance } from './data.js';

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
/** Metres climbed walking straight from one point to another: the ground sampled a cell apart along the way, only
 *  the rises counted, and only where the way is steep enough to feel (FEEL, a 2% grade): the valley floor's gentle
 *  tilt is in the walking pace already, and a metre or two of it across town is no hill. Nothing off the grid. */
const FEEL = 0.02;
export function climb(lat1, lon1, lat2, lon2) {
  if (!E) return 0;
  const d = distance(lat1, lon1, lat2, lon2), n = Math.max(1, Math.ceil(d / E.cell)), step = d / n;
  let prev = height(lat1, lon1), up = 0;
  if (prev === null) return 0;
  for (let k = 1; k <= n; k++) {
    const h = height(lat1 + (lat2 - lat1) * k / n, lon1 + (lon2 - lon1) * k / n);
    if (h === null) continue;
    if (h - prev > FEEL * step) up += h - prev;
    prev = h;
  }
  return up;
}
/** A walk's lie of the land, straight from one point to another: metres up and down (each only where it's steep
 *  enough to feel, as climb() counts it) and its steepest grades over a cell, up and down (0.08, 8%). Nothing off the grid. */
export function slope(lat1, lon1, lat2, lon2) {
  if (!E) return { up: 0, down: 0, steepUp: 0, steepDown: 0 };
  const d = distance(lat1, lon1, lat2, lon2), n = Math.max(1, Math.ceil(d / E.cell)), step = d / n;
  let prev = height(lat1, lon1), steepUp = 0, steepDown = 0;
  for (let k = 1; k <= n && prev !== null; k++) {
    const h = height(lat1 + (lat2 - lat1) * k / n, lon1 + (lon2 - lon1) * k / n);
    if (h === null) continue;
    steepUp = Math.max(steepUp, (h - prev) / step); steepDown = Math.max(steepDown, (prev - h) / step);
    prev = h;
  }
  return { up: climb(lat1, lon1, lat2, lon2), down: climb(lat2, lon2, lat1, lon1), steepUp, steepDown };
}
/** Steep, for a walk: a stretch of it climbing 6% or more (the grid's 100 m cells soften a short pitch, so not 8).
 *  Not the climb all told: 30 m over two miles is Uphill, its feet said. Or going down one: 8 m or more down, 10% or
 *  more somewhere (a gentle downhill is the easy way; the bluff from 400 North down to the Island, 80 ft at 17%, is a
 *  climb down, and a rider with a stroller or a bad knee goes another way). The one rule for the word STEEP and for
 *  avoiding steep walks. */
export const STEEP = 0.06, STEEP_DOWN = 0.10;
export const isSteep = s => (s.up >= 4 && s.steepUp >= STEEP) || (s.down >= 8 && s.steepDown >= STEEP_DOWN);
export const steepWalk = (a, b) => !!(a && b && E) && isSteep(slope(a.lat, a.lon, b.lat, b.lon));
/** The rider's choice (Settings, or the chip on directions): ways without a steep walk up, where there are any. */
let flat = (() => { try { return localStorage.getItem('cr-steep') === 'avoid'; } catch { return false; } })();
export const avoidSteep = () => flat;
export function setAvoidSteep(on) { flat = !!on; try { localStorage.setItem('cr-steep', on ? 'avoid' : 'allow'); } catch { /* this visit only */ } }
/** Walking pace: metres a minute on the flat, crossings and all; and the climb that costs a minute more, by
 *  Naismith's rule (an hour for every 600 m of ascent, so 10 m a minute). Going down costs nothing extra. */
export const PACE = 75, RISE = 10;
/** Minutes to walk from one point to another, the climb counted: the one reckoning for every walk the app
 *  times (the planner's legs, the stops nearest a rider). `d`, when the distance is already known; across a busy
 *  road, the way by its crossing instead (walkWay). */
export function walkMins(lat1, lon1, lat2, lon2, d = distance(lat1, lon1, lat2, lon2)) {
  const w = walkWay(lat1, lon1, lat2, lon2);
  return Math.max(1, Math.ceil((w.via.length ? w.d : d) / PACE + climb(lat1, lon1, lat2, lon2) / RISE + descent(lat1, lon1, lat2, lon2) / DROP));
}
/** Metres down a walk where it's steep going down (10% or more): slower than the flat, the steps placed, though not as
 *  slow as the climb: DROP metres of it a minute (RISE's up). A walk down counted as on the flat. */
export const DROP = 30;
function descent(lat1, lon1, lat2, lon2) {
  if (!E) return 0;
  const d = distance(lat1, lon1, lat2, lon2), n = Math.max(1, Math.ceil(d / E.cell)), step = d / n;
  let prev = height(lat1, lon1), down = 0;
  if (prev === null) return 0;
  for (let k = 1; k <= n; k++) {
    const h = height(lat1 + (lat2 - lat1) * k / n, lon1 + (lon2 - lon1) * k / n);
    if (h === null) continue;
    if (prev - h >= STEEP_DOWN * step) down += prev - h;
    prev = h;
  }
  return down;
}

// ---- busy roads and their crossings, for walks. data/walks.json (tools/walks.py): the highways and wide or fast
// roads from OpenStreetMap, and their lights and marked crossings. A walk is as the crow flies, but not across one of
// these: off Route 5 on the east side of US 91 for the Rush FunPlex on its west, four lanes at 50 mph, the walk goes
// by the light at 3100 North. Without the file, every walk straight, as before.
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
    // Each crossing with the busy roads it's a way over, and the streets named at it (its corner's).
    WK = { roads: j.roads, x: j.x.map(([lat, lon, kind, roads, at]) => ({ lat, lon, kind, roads, at: at || [] })), grid, memo: new Map() };
  } catch { WK = null; }
  return WK;
}
/** Where the straight line from a to b crosses a busy road, nearest a first: { t (0 to 1 along it), road } each;
 *  none within a few metres of either end (a walk from a crossing, on the road's line, onward). */
function roadsCrossed(a, b) {
  const ax = a.lon * KX, ay = a.lat * KY, bx = b.lon * KX, by = b.lat * KY, len = Math.hypot(bx - ax, by - ay);
  if (len < 1) return [];
  const seen = new Set(), out = [];
  for (let y = Math.floor(Math.min(a.lat, b.lat) / CELL); y <= Math.floor(Math.max(a.lat, b.lat) / CELL); y++)
    for (let x = Math.floor(Math.min(a.lon, b.lon) / CELL); x <= Math.floor(Math.max(a.lon, b.lon) / CELL); x++)
      for (const [ri, k] of WK.grid.get(y + ':' + x) || []) {
        const key = ri + ',' + k; if (seen.has(key)) continue; seen.add(key);
        const p = WK.roads[ri].p[k], q = WK.roads[ri].p[k + 1];
        const cx = p[1] * KX, cy = p[0] * KY, dx = q[1] * KX, dy = q[0] * KY;
        const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
        if (t * len > 4 && (1 - t) * len > 4 && u >= 0 && u <= 1) out.push({ t, road: WK.roads[ri].n });
      }
  return out.sort((p, q) => p.t - q.t);
}
/** The rider's choice (the Crosswalks chip on directions): walks over a busy road by its crossings (on, the default),
 *  or straight across as the crow flies, for where the map's crossings are wrong or a rider knows better. Either way
 *  the other is said beside it. `any` in walkWay: the way by the crossings whatever the choice, to say it. */
let xing = (() => { try { return localStorage.getItem('cr-xing') !== 'off'; } catch { return true; } })();
export const useCrossings = () => xing;
export function setUseCrossings(on) { xing = !!on; try { localStorage.setItem('cr-xing', on ? 'on' : 'off'); } catch { /* this visit only */ } }
/** Something worked out walking straight across (crossings off for its length only, the rider's choice untouched):
 *  directions' look at what ignoring the crossings would give, a different stop maybe, to say it. */
export function crossingsOff(fn) { const was = xing; xing = false; try { return fn(); } finally { xing = was; } }
const FAR = 1500;   // metres: a crossing further off than this from where the line crosses isn't the way over
/** A walk from one point to another as it's walked: straight, or across each busy road it meets by a crossing on that
 *  road (the light or crosswalk that makes the walk shortest), { d (metres), via: [{ lat, lon, kind ('s' a light,
 *  'm' a crosswalk), road }] }; one with `none` where the road has no crossing within reach (the walk straight,
 *  said). */
export function walkWay(lat1, lon1, lat2, lon2, any = false) {
  const straight = { d: distance(lat1, lon1, lat2, lon2), via: [] };
  if (!WK || !(any || xing)) return straight;   // crossings off (the rider's choice): straight, as the crow flies
  const key = lat1.toFixed(5) + ',' + lon1.toFixed(5) + '>' + lat2.toFixed(5) + ',' + lon2.toFixed(5);
  if (WK.memo.has(key)) return WK.memo.get(key);
  if (WK.memo.size > 20000) WK.memo.clear();
  const way = (a, b, depth) => {
    const hit = depth < 3 && roadsCrossed(a, b)[0];
    if (!hit) return { d: distance(a.lat, a.lon, b.lat, b.lon), via: [] };
    const at = { lat: a.lat + (b.lat - a.lat) * hit.t, lon: a.lon + (b.lon - a.lon) * hit.t };
    const c = WK.x.filter(x => x.roads.includes(hit.road) && distance(x.lat, x.lon, at.lat, at.lon) <= FAR)
      .map(x => ({ x, d: distance(a.lat, a.lon, x.lat, x.lon) + distance(x.lat, x.lon, b.lat, b.lon) })).sort((p, q) => p.d - q.d)[0];
    if (!c) return { d: distance(a.lat, a.lon, b.lat, b.lon), via: [{ ...at, none: true, road: hit.road }] };
    const rest = way(c.x, b, depth + 1);
    return { d: distance(a.lat, a.lon, c.x.lat, c.x.lon) + rest.d, via: [{ ...c.x, road: hit.road }, ...rest.via] };
  };
  const w = roadsCrossed({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 }).length ? way({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 }, 0) : straight;
  if (w.via.length && w.via.every(v => v.none)) w.d = straight.d;
  WK.memo.set(key, w);
  return w;
}
/** A walk's crossings in words, those at one corner together: 'Cross Main Street and Airport Road at the light by
 *  2500 North', 'Cross 400 North at the crosswalk'; with none in reach, 'No crosswalk on US 91 near here'. The
 *  street it's by is the corner's other street, from OpenStreetMap; none named, none said. */
export function crossWords(via) {
  const out = [];
  for (const v of via) {
    const last = out[out.length - 1];
    if (last && !v.none && !last.none && distance(last.lat, last.lon, v.lat, v.lon) < 60) { if (!last.roads2.includes(v.road)) last.roads2.push(v.road); if (v.kind === 's') last.kind = 's'; last.at = [...new Set([...last.at, ...v.at])]; continue; }
    out.push({ ...v, roads2: [v.road] });
  }
  return out.map(v => {
    if (v.none) return `No crosswalk on ${v.road} near here`;
    const by = v.at.find(n => !v.roads2.includes(n));   // the corner's other street (a light at two highways: the one not crossed)
    return `Cross ${v.roads2.join(' and ')} ${v.kind === 's' ? 'at the light' : 'at the crosswalk'}${by ? ' by ' + by : ''}`;
  }).join('; then ');
}
/** Stops nearest a point, as nearest() gives them ({ i, d }), in the order a walk to them takes: the climb counted,
 *  so the stop down the hill comes before the one as far up it. Each with its minutes. `both`, for a place rather than
 *  the rider: it's walked to from the bus and back to it after, so the climb either way counts (the Scotsman's stop
 *  below the Institute of Religion is down the hill leaving it, and 30 m up it arriving). `at`, the stop's point,
 *  for stops not Connect's (the shuttle's). */
export function byWalk(list, lat, lon, both = false, at = x => D.stops[x.i]) {
  return list.map(x => {
    const s = at(x), mins = walkMins(lat, lon, s.lat, s.lon, x.d);
    return { ...x, mins, cost: both ? mins + walkMins(s.lat, s.lon, lat, lon, x.d) : mins };
  }).sort((a, b) => a.cost - b.cost || a.d - b.d);
}
