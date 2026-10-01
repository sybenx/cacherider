// The streets, from the map's own tiles (z15, the roads layer), as a network a bus can drive: enough to run a way
// seen as a few points, twenty seconds apart (a detour, from the buses' reports), along the streets between them
// instead of straight across the blocks. tools/roads.py does the same for the shuttle's routes, offline.
import { BASE } from './data.js';

const Z = 15;
const KINDS = new Set(['highway', 'major_road', 'medium_road', 'minor_road']);
const SLOW = { service: 1.6, driveway: 3.0, parking_aisle: 2.5 };   // a bus keeps to streets, but will use a lane
const SNAP = 80;   // metres from a report to the street it was on, at most

// ---- a vector tile, read just enough: the roads layer's lines and their kind
function varint(b, p) { let r = 0, m = 1, c; do { c = b[p.i++]; r += (c & 0x7f) * m; m *= 128; } while (c & 0x80); return r; }
function msg(b, from = 0, to = b.length) {
  const out = [], p = { i: from };
  while (p.i < to) {
    const k = varint(b, p), f = Math.floor(k / 8), wt = k % 8;
    if (wt === 0) out.push([f, varint(b, p)]);
    else if (wt === 2) { const n = varint(b, p); out.push([f, [p.i, p.i + n]]); p.i += n; }
    else if (wt === 1) p.i += 8; else if (wt === 5) p.i += 4; else break;
  }
  return out;
}
const packed = (b, [from, to]) => { const out = [], p = { i: from }; while (p.i < to) out.push(varint(b, p)); return out; };
const text = (b, [from, to]) => new TextDecoder().decode(b.subarray(from, to));
function roadsOf(b, tx, ty) {
  const lines = [];
  for (const [f, r] of msg(b)) {
    if (f !== 3) continue;
    const layer = msg(b, r[0], r[1]);
    const name = layer.find(x => x[0] === 1);
    if (!name || text(b, name[1]) !== 'roads') continue;
    const keys = layer.filter(x => x[0] === 3).map(x => text(b, x[1]));
    const vals = layer.filter(x => x[0] === 4).map(x => { const s = msg(b, x[1][0], x[1][1]).find(y => y[0] === 1); return s ? text(b, s[1]) : null; });
    const ext = (layer.find(x => x[0] === 5) || [0, 4096])[1], n = 2 ** Z;
    const ll = (px, py) => [(tx + px / ext) / n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + py / ext) / n))) * 180 / Math.PI];
    for (const [ff, fr] of layer) {
      if (ff !== 2) continue;
      const feat = msg(b, fr[0], fr[1]), type = (feat.find(x => x[0] === 3) || [0, 0])[1];
      if (type !== 2) continue;
      const tags = packed(b, (feat.find(x => x[0] === 2) || [0, [0, 0]])[1]), props = {};
      for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = vals[tags[i + 1]];
      if (!KINDS.has(props.kind)) continue;
      const g = packed(b, (feat.find(x => x[0] === 4) || [0, [0, 0]])[1]);
      let x = 0, y = 0, line = null;
      for (let i = 0; i < g.length;) {
        const cmd = g[i] & 7, cnt = g[i] >> 3; i++;
        for (let c = 0; c < cnt && cmd !== 7; c++) {
          x += (g[i] >> 1) ^ -(g[i] & 1); y += (g[i + 1] >> 1) ^ -(g[i + 1] & 1); i += 2;
          if (cmd === 1) { if (line && line.length > 1) lines.push({ w: SLOW[props.kind_detail] || 1, name: props.name || '', pts: line }); line = [ll(x, y)]; }
          else line.push(ll(x, y));
        }
      }
      if (line && line.length > 1) lines.push({ w: SLOW[props.kind_detail] || 1, name: props.name || '', pts: line });
    }
  }
  return lines;
}
const tileOf = (lon, lat) => { const n = 2 ** Z; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n)]; };
const tiles = new Map();
async function tile(x, y) {
  const k = x + '/' + y;
  if (!tiles.has(k)) tiles.set(k, fetch(`${BASE}tiles/${Z}/${x}/${y}.pbf`).then(r => r.ok ? r.arrayBuffer() : null).then(a => a ? roadsOf(new Uint8Array(a), x, y) : []).catch(() => []));
  return tiles.get(k);
}

// ---- the network: points on a 2 m grid as nodes (ways meet at shared points), ends that land on another way
// joined to it (where a tile cut a way, or a way ends on another)
async function network(pts) {
  const lons = pts.map(p => p[1]), lats = pts.map(p => p[0]), m = 0.006;
  const [x0, y0] = tileOf(Math.min(...lons) - m, Math.max(...lats) + m), [x1, y1] = tileOf(Math.max(...lons) + m, Math.min(...lats) - m);
  const ways = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) ways.push(...await tile(x, y));
  const lat0 = lats[0], kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const key = ([lon, lat]) => Math.round(lon * kx / 2) + ',' + Math.round(lat * ky / 2);
  const xy = k => k.split(',').map(Number).map(v => v * 2);
  const adj = new Map(), segs = [];
  const link = (a, b, w) => {
    if (a === b) return;
    const [ax, ay] = xy(a), [bx, by] = xy(b), d = Math.hypot(ax - bx, ay - by) * w;
    if (!adj.has(a)) adj.set(a, new Map()); if (!adj.has(b)) adj.set(b, new Map());
    if (d < (adj.get(a).get(b) ?? Infinity)) { adj.get(a).set(b, d); adj.get(b).set(a, d); }
  };
  for (const w of ways) for (let i = 0; i + 1 < w.pts.length; i++) { const a = key(w.pts[i]), b = key(w.pts[i + 1]); if (a !== b) segs.push([a, b, w.w, w.name]); }
  // segments by 50 m cell, for joining and for snapping
  const CELL = 50, cells = new Map();
  segs.forEach((s, i) => {
    const [ax, ay] = xy(s[0]), [bx, by] = xy(s[1]);
    for (let cx = Math.floor(Math.min(ax, bx) / CELL); cx <= Math.floor(Math.max(ax, bx) / CELL); cx++)
      for (let cy = Math.floor(Math.min(ay, by) / CELL); cy <= Math.floor(Math.max(ay, by) / CELL); cy++) { const k = cx + ',' + cy; (cells.get(k) || cells.set(k, []).get(k)).push(i); }
  });
  // Tiles don't share a point where two streets cross, or where one ends on another, unless the way bends there
  // (a straight street keeps only its ends): each segment cut at every crossing and every end that lands on it,
  // and only the pieces linked, so a bus can turn at any corner. (tools/roads.py does the same.)
  const cuts = segs.map(s => [[0, s[0]], [1, s[1]]]);
  const at = (i, f) => { const [ax, ay] = xy(segs[i][0]), [bx, by] = xy(segs[i][1]); return [ax + f * (bx - ax), ay + f * (by - ay)]; };
  const kOf = ([x, y]) => Math.round(x / 2) + ',' + Math.round(y / 2);
  const tried = new Set();
  for (const ids of cells.values()) for (const i of ids) for (const j of ids) {
    if (j <= i || tried.has(i * 1e6 + j)) continue;
    tried.add(i * 1e6 + j);
    const [a, b, w1] = segs[i], [c, d, w2] = segs[j];
    if (a === c || a === d || b === c || b === d) continue;   // already meet
    const [ax, ay] = xy(a), [bx, by] = xy(b), [cx, cy] = xy(c), [dx, dy] = xy(d);
    // an end of one on the other
    for (const [e, k] of [[a, j], [b, j], [c, i], [d, i]]) {
      const [ex, ey] = xy(e), [px, py] = xy(segs[k][0]), [qx, qy] = xy(segs[k][1]), vx = qx - px, vy = qy - py, L = vx * vx + vy * vy;
      if (!L) continue;
      const f = ((ex - px) * vx + (ey - py) * vy) / L;
      if (f <= 0 || f >= 1) continue;
      const n = at(k, f);
      if (Math.hypot(n[0] - ex, n[1] - ey) <= 3) { const nk = kOf(n); cuts[k].push([f, nk]); link(nk, e, 1); }
    }
    // a crossing
    const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(den) < 1e-9) continue;
    const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
    if (t > 0 && t < 1 && u > 0 && u < 1) { const nk = kOf(at(i, t)); cuts[i].push([t, nk]); cuts[j].push([u, nk]); }
  }
  cuts.forEach((cs, i) => { cs.sort((p, q) => p[0] - q[0]); for (let k = 0; k + 1 < cs.length; k++) link(cs[k][1], cs[k + 1][1], segs[i][2]); });
  const nearSeg = (x, y, r) => {
    let best = null;
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++)
        for (const i of cells.get(cx + ',' + cy) || []) {
          const [a, b] = segs[i], [ax, ay] = xy(a), [bx, by] = xy(b), dx = bx - ax, dy = by - ay, n = dx * dx + dy * dy;
          const f = n ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / n)) : 0, d = Math.hypot(x - ax - f * dx, y - ay - f * dy);
          if (d <= r && (!best || d < best.d)) best = { i, f, d, x: ax + f * dx, y: ay + f * dy };
        }
    return best;
  };
  // A node on a segment: linked to the cuts either side of it.
  const onto = h => {
    const cs = cuts[h.i], w = segs[h.i][2], k = kOf([h.x, h.y]);
    let n = 1; while (n < cs.length - 1 && cs[n][0] < h.f) n++;
    link(k, cs[n - 1][1], w); link(k, cs[n][1], w);
    return k;
  };
  // The street a stretch of a way runs along: the name of the way nearest its middle.
  const nameAt = (lon, lat) => { const h = nearSeg(lon * kx, lat * ky, 12); return h ? segs[h.i][3] : ''; };
  return { adj, xy, nameAt, toLL: k => { const [x, y] = xy(k); return [x / kx, y / ky]; }, snap: (lat, lon) => { const h = nearSeg(lon * kx, lat * ky, SNAP); return h ? onto(h) : null; } };
}

function shortest(adj, from, to) {
  const dist = new Map([[from, 0]]), prev = new Map(), heap = [[0, from]];
  const push = e => { heap.push(e); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, k] = pop();
    if (k === to) break;
    if (d > dist.get(k)) continue;
    for (const [n, w] of adj.get(k) || []) if (d + w < (dist.get(n) ?? Infinity)) { dist.set(n, d + w); prev.set(n, k); push([d + w, n]); }
  }
  if (!dist.has(to)) return null;
  const out = [to]; while (out[out.length - 1] !== from) out.push(prev.get(out[out.length - 1]));
  return { cost: dist.get(to), keys: out.reverse() };
}

/** A way as reported, [lat, lon] points in order, run along the streets between them: { coords: [lon, lat] for a map
 *  line, streets: the names of those it ran along, in order }. A report too far from any street, or two with no
 *  street between, are joined straight, as they came. */
const done = new Map();
export async function alongStreets(path) {
  const k = JSON.stringify(path);
  if (done.has(k)) return done.get(k);
  const run = (async () => {
    const net = await network(path);
    const out = [];
    let at = null;
    for (const [lat, lon] of path) {
      const n = net.snap(lat, lon);
      if (!n) { out.push([lon, lat]); at = null; continue; }
      const leg = at && shortest(net.adj, at, n);
      // A leg far longer than the way between its reports (a missed turn, a way off the tiles) is no better than straight.
      const [ax, ay] = at ? net.xy(at) : [0, 0], [bx, by] = net.xy(n);
      if (leg && leg.cost < 3 * Math.hypot(ax - bx, ay - by) + 200) out.push(...leg.keys.slice(1).map(net.toLL));
      else out.push(net.toLL(n));
      at = n;
    }
    // A report snapped a little past a corner leaves a spur, out and straight back: trimmed.
    const near = (a, b) => Math.hypot((a[0] - b[0]) * 83000, (a[1] - b[1]) * 110540) < 4;
    for (let i = 1; i + 1 < out.length;) if (near(out[i - 1], out[i + 1]) || near(out[i - 1], out[i])) out.splice(i, 1); else i++;
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 1; i + 1 < out.length; i++) {
        const [ax, ay] = out[i - 1], [bx, by] = out[i], [cx, cy] = out[i + 1];
        const u = [bx - ax, by - ay], v = [cx - bx, cy - by], dot = u[0] * v[0] + u[1] * v[1], len = Math.hypot(...u) * Math.hypot(...v);
        if (len && dot / len < -0.95) { out.splice(i, 1); changed = true; break; }   // a turn straight back
      }
    }
    // The streets it took, in order, each counted once it's run along for a block or so.
    const by = new Map();
    for (let i = 0; i + 1 < out.length; i++) {
      const [a, b] = [out[i], out[i + 1]], n = net.nameAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (n) by.set(n, (by.get(n) || 0) + Math.hypot((a[0] - b[0]) * 83000, (a[1] - b[1]) * 110540));
    }
    return { coords: out, streets: [...by].filter(([, m]) => m >= 80).map(([n]) => n) };
  })();
  done.set(k, run);
  return run;
}
