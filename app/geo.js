// Addresses, from the valley's own arithmetic. Every town numbers its streets
// from an origin, so "4182 South 800 West" is a point once the town's grid is
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

/** "4182 s 800 w preston" → { n: -4182, e: -800, town: 'preston', label: '4182 South 800 West' }, or null. */
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

/** The stops within 4 km, or failing that the nearest one however far. */
export function nearestTo(lat, lon, n = 4) {
  const all = nearest(lat, lon, n);
  const close = all.filter(s => s.d <= 4000);
  return close.length ? close : all.slice(0, 1);
}

export const townState = t => /preston|franklin|whitney|dayton|weston|clifton/i.test(t) ? ', Idaho' : '';
