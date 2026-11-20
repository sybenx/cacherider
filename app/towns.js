// The towns a bus passes through, for a route's day to mark them (the user's town highlighter, 2026-11-20, from a
// fork's mock he approved). From GTFS and OpenStreetMap alone: each town's limits (data/towns.json, tools/towns.py),
// each route's path (data/cvtd-shapes.json). Fetched only when a route's day is opened, then drawn on its next render.
import { D, BASE, tripStops, tripEnd, tripRoute, timed } from './data.js';

let TOWNS = null, LINES = null, loading = null;
export const townsReady = () => !!TOWNS;
/** Fetch the outlines and the route paths once; resolves true when they came. */
export function loadTowns() {
  if (!loading) loading = Promise.all([
    fetch(BASE + 'data/towns.json').then(r => r.json()),
    fetch(BASE + 'data/cvtd-shapes.json').then(r => r.json()).catch(() => ({ lines: [] })),
  ]).then(([t, s]) => {
    // A line names its route by its place in the route list, the timetable's only when both files are the same night's
    // (map.js lineRoutes): one whose number isn't that route's is left out, its trips timed stop to stop.
    const keyOf = ri => D.routes[ri] ? D.routes[ri].short.split(' ')[0] : undefined;
    LINES = (s.lines || []).filter(l => l.key === undefined ? !!D.routes[l.route] : keyOf(l.route) === l.key);
    TOWNS = t.towns || [];
    return true;
  }).catch(e => { console.warn('towns', e); loading = null; return false; });
  return loading;
}

const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
/** The town a point is in, by name, or null (open road). */
export function townAt(lon, lat) {
  for (const t of TOWNS || []) { const [a, b, c, d] = t.box; if (lon < a || lon > c || lat < b || lat > d) continue; let n = 0; for (const r of t.rings) if (inRing(lon, lat, r)) n++; if (n % 2) return t.name; }
  return null;
}
const townOfStop = new Map();
export const stopTown = si => { if (!townOfStop.has(si)) townOfStop.set(si, townAt(D.stops[si].lon, D.stops[si].lat)); return townOfStop.get(si); };

// A trip's time in each town by distance, not by the feed's minutes: the feed's minute at a stop between two timed
// stops is a guess (the 15's 'Maverik at 6:00'), so only timed stops (where buses hold), the first and the last keep
// their times, and every point between, a town line crossed included, is timed by how far along the route's path it
// is between them. The trip's path: of its route's lines, the one whose points lie nearest its stops in order.
const M = 111320, cosLat = Math.cos(41.8 * Math.PI / 180);
const dist = (a, b) => Math.hypot((a[0] - b[0]) * M * cosLat, (a[1] - b[1]) * M);
function along(coords, pts) {
  const idx = []; let from = 0, err = 0;
  for (const p of pts) { let best = -1, bd = Infinity; for (let i = from; i < coords.length; i++) { const d = dist(coords[i], p); if (d < bd) { bd = d; best = i; } } idx.push(best); err += bd; from = best; }
  return { idx, err };
}
const pathOf = new Map();   // a stop pattern's path: each point's distance along and town, each stop's distance along
function path(ri, sis) {
  const key = ri + ':' + sis.join(',');
  if (pathOf.has(key)) return pathOf.get(key);
  const pts = sis.map(si => [D.stops[si].lon, D.stops[si].lat]);
  let best = null;
  for (const l of LINES) { if (l.route !== ri) continue; const a = along(l.coords, pts); if (!best || a.err < best.err) best = { ...a, coords: l.coords }; }
  let out;
  if (best && best.err / pts.length < 150) {
    const c = best.coords, cum = [0];
    for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + dist(c[i - 1], c[i]));
    const pt = [];
    for (let i = best.idx[0]; i <= best.idx[best.idx.length - 1]; i++) pt.push({ d: cum[i], t: townAt(c[i][0], c[i][1]) });
    out = { pt, sd: best.idx.map(i => cum[i]) };
  } else {
    // no path to go by: a straight line stop to stop, sampled
    const pt = [], sd = [0], N = 16; let d = 0;
    pt.push({ d: 0, t: townAt(...pts[0]) });
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k - 1], q = pts[k], L = dist(p, q);
      for (let i = 1; i <= N; i++) pt.push({ d: d + L * i / N, t: townAt(p[0] + (q[0] - p[0]) * i / N, p[1] + (q[1] - p[1]) * i / N) });
      d += L; sd.push(d);
    }
    out = { pt, sd };
  }
  pathOf.set(key, out);
  return out;
}
const tripTownsOf = new Map();
/** A trip's passes through towns other than the Center's, in order: [{ t, a, b }], minutes in and out. Its last point is
 *  where it ends (tripEnd: the 16's Preston arrival) where that's past its last stop. */
export function tripTowns(ti) {
  if (!TOWNS) return [];
  if (tripTownsOf.has(ti)) return tripTownsOf.get(ti);
  const e = tripEnd(ti), st0 = tripStops(ti), st = e && (!st0.length || st0[st0.length - 1][1] !== e.si) ? [...st0, [e.min, e.si]] : st0;
  const out = [];
  if (st.length) {
    const ri = tripRoute(ti).r, { pt, sd } = path(ri, st.map(([, si]) => si));
    const anchors = st.map(([m, si], k) => ({ d: sd[k], m, k })).filter(a => a.k === 0 || a.k === st.length - 1 || timed(st[a.k][1], ri));
    const timeAt = d => { for (let k = 1; k < anchors.length; k++) { const a = anchors[k - 1], b = anchors[k]; if (d <= b.d) return b.d > a.d ? a.m + (b.m - a.m) * (d - a.d) / (b.d - a.d) : a.m; } return anchors[anchors.length - 1].m; };
    let cur = null;
    for (const p of pt) {
      const m = timeAt(p.d);
      if (cur && cur.t === p.t) { cur.b = m; continue; }
      if (cur && cur.t) out.push(cur);
      cur = { t: p.t, a: m, b: m };
    }
    if (cur && cur.t) out.push(cur);
  }
  const res = out.filter(g => g.t !== D.hub.town);
  tripTownsOf.set(ti, res);
  return res;
}

// Each town its own muted colour, from the Okabe-Ito set (made for colour-blind readers); vermillion and reddish purple
// left out, too near the red now line and the purple routes. The two blues one family.
export const TOWN_INK = ['#56B4E9', '#E69F00', '#009E73', '#F0E442', '#0072B2'];   // sky blue, orange, bluish green, yellow, blue
const FAMILY = [0, 1, 2, 3, 0];
// The colours the user picked for Cache Valley's towns (by place in TOWN_INK). Optional: a town not here, or another
// city's, gets the rule's.
const PICKED = { 'Smithfield': 0, 'North Logan': 2, 'Nibley': 2, 'Richmond': 3, 'Hyde Park': 1, 'Hyrum': 1 };
let inkOf = null;
/** A town's colour everywhere it shows: towns taken north to south, each the first colour none of its near towns has
 *  (two towns are near where a trip's stays in them come within 5 minutes of each other). */
export function townInk(t) {
  if (!TOWNS) return '#888';
  if (!inkOf) {
    const near = new Map(), add = (a, b) => { if (a === b) return; (near.get(a) || near.set(a, new Set()).get(a)).add(b); (near.get(b) || near.set(b, new Set()).get(b)).add(a); };
    for (let ti = 0; ti < D.trips.length; ti++) {
      const ts = tripTowns(ti);
      for (let i = 0; i < ts.length; i++) for (let k = i + 1; k < ts.length; k++) if (ts[i].t !== ts[k].t && Math.max(ts[i].a, ts[k].a) - Math.min(ts[i].b, ts[k].b) <= 5) add(ts[i].t, ts[k].t);
    }
    const order = TOWNS.map(x => [x.name, (x.box[1] + x.box[3]) / 2]).sort((p, q) => q[1] - p[1]).map(([n]) => n);
    inkOf = new Map(Object.entries(PICKED).filter(([n]) => order.includes(n)));
    for (const n of order) {
      if (inkOf.has(n)) continue;
      const two = [...(near.get(n) || [])], used = new Set(two.filter(o => inkOf.has(o)).map(o => FAMILY[inkOf.get(o)]));
      let k = TOWN_INK.findIndex((_, i) => !used.has(FAMILY[i]));
      if (k < 0) { const cnt = TOWN_INK.map((_, i) => two.filter(o => inkOf.get(o) === i).length); k = cnt.indexOf(Math.min(...cnt)); }   // more near towns than colours: the least used among them
      inkOf.set(n, k);
    }
  }
  return inkOf.has(t) ? TOWN_INK[inkOf.get(t)] : '#888';
}
// Hue (degrees) and lightness, to tell a town's colour that would sink into the route's own line.
function hl(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, l];
}
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const sinks = (c, line) => { const [h1, l1] = hl(c), [h2, l2] = hl(line); return hueGap(h1, h2) < 30 && Math.abs(l1 - l2) < 0.3; };
/** The colours of a route's towns: each its own, unless within 30° of hue and 0.3 of lightness of the route's line;
 *  then the first that clears the line by 45° of hue and no other town of the route has (Nibley on the 11, Hyrum on
 *  the 12). */
export function routeTownInks(towns, lineHex) {
  const on = new Map([...towns].map(t => [t, townInk(t)]));
  for (const t of towns) {
    if (!sinks(on.get(t), lineHex)) continue;
    const taken = new Set([...on].filter(([o]) => o !== t).map(([, c]) => FAMILY[TOWN_INK.indexOf(c)]));
    const alt = TOWN_INK.find((c, i) => !sinks(c, lineHex) && hueGap(hl(c)[0], hl(lineHex)[0]) >= 45 && !taken.has(FAMILY[i])) || TOWN_INK.find(c => !sinks(c, lineHex));
    if (alt) on.set(t, alt);
  }
  return on;
}
