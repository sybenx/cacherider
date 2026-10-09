// The ways a rider walks (data/walknet.json, tools/walknet.py, from OpenStreetMap): footways, paths, steps,
// sidewalks and crossings, and the streets, with their junctions. A walk is found along them, not as the crow flies:
// down the bluff from 400 North to the Island by the Canal Connector Trail and its steps, round the river, out of a
// cul-de-sac. Its minutes count the climb and the steep ways down along the way it goes (geo.js's pace, RISE, DROP);
// a busy road (walks.py's: a highway, or a wide or fast town road) is crossed only at its lights and marked crossings,
// unless asked otherwise; its steps are said. geo.js asks it, and falls back to the crow's line without it.

const R = 1e-5, KY = 110540;
const ROAD = 0, FOOT = 1, XING = 2, STEPS = 3, BUSY = 4;
const KIND = { r: ROAD, f: FOOT, x: XING, s: STEPS, b: BUSY };
// minutes over a busy road, waiting for the light; at a crosswalk without one, or for a gap in the traffic with none,
// longer: and of two ways as long, the one crossing fewer, and at a light
const WAIT = { s: 0.5, m: 0.75, none: 1 };

/** A small binary heap of [cost, id], in two arrays that grow. */
class Heap {
  constructor() { this.c = new Float64Array(1024); this.i = new Int32Array(1024); this.n = 0; }
  push(c, id) {
    if (this.n === this.c.length) { const c2 = new Float64Array(this.n * 2), i2 = new Int32Array(this.n * 2); c2.set(this.c); i2.set(this.i); this.c = c2; this.i = i2; }
    let k = this.n++;
    while (k > 0) { const p = (k - 1) >> 1; if (this.c[p] <= c) break; this.c[k] = this.c[p]; this.i[k] = this.i[p]; k = p; }
    this.c[k] = c; this.i[k] = id;
  }
  top() { return this.n ? this.c[0] : Infinity; }
  pop() {
    const c0 = this.c[0], i0 = this.i[0], c = this.c[--this.n], id = this.i[this.n];
    let k = 0;
    for (;;) {
      const l = 2 * k + 1, r = l + 1;
      if (l >= this.n) break;
      const m = r < this.n && this.c[r] < this.c[l] ? r : l;
      if (this.c[m] >= c) break;
      this.c[k] = this.c[m]; this.i[k] = this.i[m]; k = m;
    }
    this.c[k] = c; this.i[k] = id;
    return [c0, i0];
  }
}

export class WalkNet {
  /** `j` the file; `height(lat, lon)` the ground (or null off the grid); `crossings` the busy roads' lights and marked
   *  crossings ({ lat, lon, kind, roads, at }, walks.json's); `roadAt(lat, lon)` a busy road's name near a point;
   *  `rates` { PACE, RISE, DROP, FEEL, STEEP, STEEP_DOWN }. */
  constructor(j, height, crossings, roadAt, rates) {
    this.r = rates; this.roadAt = roadAt;
    const N = j.n.length / 2, lat = this.lat = new Float64Array(N), lon = this.lon = new Float64Array(N);
    let a = 0, o = 0;
    for (let i = 0; i < N; i++) { a += j.n[2 * i]; o += j.n[2 * i + 1]; lat[i] = a * R; lon[i] = o * R; }
    const M = j.e.length;
    this.ea = new Int32Array(M); this.eb = new Int32Array(M); this.kind = new Uint8Array(M); this.len = new Float32Array(M);
    // each edge's shape points, a to b, between its ends: one array, an offset each
    let pts = 0; for (const e of j.e) pts += (e.length - 3) / 2;
    this.so = new Int32Array(M + 1); this.slat = new Float64Array(pts); this.slon = new Float64Array(pts);
    let pa = 0, k = 0;
    j.e.forEach((e, m) => {
      const ea = pa + e[0], eb = ea + e[1]; pa = ea;
      this.ea[m] = ea; this.eb[m] = eb; this.kind[m] = KIND[e[2]] ?? ROAD;
      this.so[m] = k;
      let la = lat[ea], lo = lon[ea], L = 0, pla = la, plo = lo;
      for (let q = 3; q < e.length; q += 2) { la += e[q] * R; lo += e[q + 1] * R; this.slat[k] = la; this.slon[k] = lo; k++; L += this.dist(pla, plo, la, lo); pla = la; plo = lo; }
      this.len[m] = L + this.dist(pla, plo, lat[eb], lon[eb]);
    });
    this.so[M] = k;
    // who meets where
    const deg = new Int32Array(N + 1);
    for (let m = 0; m < M; m++) { deg[this.ea[m] + 1]++; deg[this.eb[m] + 1]++; }
    for (let i = 0; i < N; i++) deg[i + 1] += deg[i];
    this.off = deg; this.adj = new Int32Array(deg[N]);
    const fill = deg.slice(0, N);
    for (let m = 0; m < M; m++) { this.adj[fill[this.ea[m]]++] = m; this.adj[fill[this.eb[m]]++] = m; }
    // a busy road's junctions, and those it's crossed at
    this.busy = new Uint8Array(N);
    for (let m = 0; m < M; m++) if (this.kind[m] === BUSY) { this.busy[this.ea[m]] = 1; this.busy[this.eb[m]] = 1; }
    this.safe = new Map();
    const at = new Map();
    for (let i = 0; i < N; i++) if (this.busy[i]) at.set(Math.round(lat[i] / R) + ',' + Math.round(lon[i] / R), i);
    for (const x of crossings || []) { const i = at.get(Math.round(x.lat / R) + ',' + Math.round(x.lon / R)); if (i !== undefined) this.safe.set(i, x); }
    // the lie of each edge, a to b: metres up and down where they're felt, the steepest grades, and the metres down a
    // steep way (DROP's), from the ground sampled every 20 m along it
    this.up = new Float32Array(M); this.down = new Float32Array(M); this.gUp = new Float32Array(M); this.gDown = new Float32Array(M);
    this.dropAB = new Float32Array(M); this.dropBA = new Float32Array(M);
    for (let m = 0; m < M; m++) this.lie(m, height);
    // where each edge is, for the nearest one to a point
    this.grid = new Map(); this.CELL = 0.002;
    for (let m = 0; m < M; m++) this.eachPiece(m, (a1, o1, a2, o2) => {
      for (let y = Math.floor(Math.min(a1, a2) / this.CELL); y <= Math.floor(Math.max(a1, a2) / this.CELL); y++)
        for (let x = Math.floor(Math.min(o1, o2) / this.CELL); x <= Math.floor(Math.max(o1, o2) / this.CELL); x++) {
          const key = y * 100000 + x; let l = this.grid.get(key); if (!l) this.grid.set(key, l = []); if (l[l.length - 1] !== m) l.push(m);
        }
    });
    this.snaps = new Map();
    this.searches = new Map();   // resumable searches, by where they start and how
  }
  dist(a1, o1, a2, o2) { const kx = 111320 * Math.cos(a1 * Math.PI / 180); return Math.hypot((a2 - a1) * KY, (o2 - o1) * kx); }
  /** Each straight piece of an edge, a to b. */
  eachPiece(m, fn) {
    let a1 = this.lat[this.ea[m]], o1 = this.lon[this.ea[m]];
    for (let k = this.so[m]; k < this.so[m + 1]; k++) { fn(a1, o1, this.slat[k], this.slon[k]); a1 = this.slat[k]; o1 = this.slon[k]; }
    fn(a1, o1, this.lat[this.eb[m]], this.lon[this.eb[m]]);
  }
  lie(m, height) {
    const { FEEL, STEEP_DOWN } = this.r;
    const samples = [];
    this.eachPiece(m, (a1, o1, a2, o2) => {
      const d = this.dist(a1, o1, a2, o2), n = Math.max(1, Math.ceil(d / 20));
      for (let k = samples.length ? 1 : 0; k <= n; k++) samples.push([a1 + (a2 - a1) * k / n, o1 + (o2 - o1) * k / n, d / n]);
    });
    let prev = height(samples[0][0], samples[0][1]), up = 0, down = 0, gu = 0, gd = 0, dAB = 0, dBA = 0;
    if (prev === null) return;
    for (let k = 1; k < samples.length; k++) {
      const h = height(samples[k][0], samples[k][1]), step = samples[k][2];
      if (h === null || step <= 0) continue;
      const dh = h - prev, g = dh / step;
      if (g > FEEL) up += dh; else if (g < -FEEL) down -= dh;
      if (g > gu) gu = g; if (-g > gd) gd = -g;
      if (-g >= STEEP_DOWN) dAB -= dh; if (g >= STEEP_DOWN) dBA += dh;
      prev = h;
    }
    this.up[m] = up; this.down[m] = down; this.gUp[m] = gu; this.gDown[m] = gd; this.dropAB[m] = dAB; this.dropBA[m] = dBA;
  }
  /** An edge's minutes walked from `fwd` (a to b) or back; `avoid`, a steep way or steps made dear, so a way round is taken where there is one. */
  cost(m, fwd, avoid) {
    const { PACE, RISE, DROP } = this.r;
    const up = fwd ? this.up[m] : this.down[m], drop = fwd ? this.dropAB[m] : this.dropBA[m];
    let c = this.len[m] / PACE * (this.kind[m] === STEPS ? 2 : 1) + up / RISE + drop / DROP;
    if (avoid && (this.kind[m] === STEPS || this.steepEdge(m, fwd))) c += 20;
    return c;
  }
  steepEdge(m, fwd) {
    const { STEEP, STEEP_DOWN } = this.r;
    const up = fwd ? this.up[m] : this.down[m], gu = fwd ? this.gUp[m] : this.gDown[m], down = fwd ? this.down[m] : this.up[m], gd = fwd ? this.gDown[m] : this.gUp[m];
    return (up >= 2 && gu >= STEEP) || (down >= 4 && gd >= STEEP_DOWN);
  }
  /** The nearest point of the ways to a point: { m, t (metres along from a), off (metres to it), lat, lon }, a
   *  footway or street before a busy road's middle (a stop on Main is on its sidewalk), within 300 m; or null. */
  snap(la, lo) {
    const k = la + ',' + lo;   // the same stops asked of again and again by the planner
    if (this.snaps.has(k)) return this.snaps.get(k);
    const r = this.snapAt(la, lo);
    this.snaps.set(k, r);
    if (this.snaps.size > 2000) this.snaps.delete(this.snaps.keys().next().value);
    return r;
  }
  snapAt(la, lo) {
    const kx = 111320 * Math.cos(la * Math.PI / 180);
    let best = null, bestFoot = null;
    const y0 = Math.floor(la / this.CELL), x0 = Math.floor(lo / this.CELL);
    for (let ring = 0; ring <= 2; ring++) {
      for (let y = y0 - ring; y <= y0 + ring; y++) for (let x = x0 - ring; x <= x0 + ring; x++) {
        if (ring && Math.abs(y - y0) < ring && Math.abs(x - x0) < ring) continue;
        for (const m of this.grid.get(y * 100000 + x) || []) {
          let along = 0;
          this.eachPiece(m, (a1, o1, a2, o2) => {
            const ax = (o1 - lo) * kx, ay = (a1 - la) * KY, bx = (o2 - lo) * kx, by = (a2 - la) * KY, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
            const u = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0, d = Math.hypot(ax + u * dx, ay + u * dy), L = Math.sqrt(L2);
            const c = { m, t: along + u * L, off: d, lat: a1 + (a2 - a1) * u, lon: o1 + (o2 - o1) * u, left: d >= 2 ? dy * ax - dx * ay > 0 : null };   // the point left of the way a to b, or right (on it, neither)
            if (!best || d < best.off) best = c;
            if (this.kind[m] !== BUSY && (!bestFoot || d < bestFoot.off)) bestFoot = c;
            along += L;
          });
        }
      }
      if (best && best.off < ring * this.CELL * KY * 0.8) break;
    }
    const pick = bestFoot && bestFoot.off <= Math.max(30, (best ? best.off : 0) + 15) ? bestFoot : best;
    return pick && pick.off <= 300 ? pick : null;
  }
  /** The point beside `node` along edge m: its first shape point from that end, or its other end. */
  near(m, node) {
    if (this.ea[m] === node) return this.so[m] < this.so[m + 1] ? [this.slat[this.so[m]], this.slon[this.so[m]]] : [this.lat[this.eb[m]], this.lon[this.eb[m]]];
    return this.so[m] < this.so[m + 1] ? [this.slat[this.so[m + 1] - 1], this.slon[this.so[m + 1] - 1]] : [this.lat[this.ea[m]], this.lon[this.ea[m]]];
  }
  vec(u, p) { const k = Math.cos(this.lat[u] * Math.PI / 180); return [(p[1] - this.lon[u]) * k, p[0] - this.lat[u]]; }
  /** Which side of a busy road a direction from its junction u is: the road's branches there part the ground round u,
   *  and two directions between the same two branches are on the same side. */
  sector(u, v) {
    const a = Math.atan2(v[1], v[0]);
    let n = 0, below = 0;
    for (let k = this.off[u]; k < this.off[u + 1]; k++) {
      const m = this.adj[k];
      if (this.kind[m] !== BUSY) continue;
      const w = this.vec(u, this.near(m, u)); n++;
      if (Math.atan2(w[1], w[0]) < a) below++;
    }
    return n < 2 ? 0 : below % n;
  }
  /** The sector just beside edge m's branch at its end u: on its left looking out along it from u, or its right. */
  beside(u, m, left) {
    const w = this.vec(u, this.near(m, u)), a = Math.atan2(w[1], w[0]) + (left ? 1e-3 : -1e-3);
    return this.sector(u, [Math.cos(a), Math.sin(a)]);
  }
  /** Where a walker in by edge m stands at its end v, off the road: the sector its branch is in (0, no busy road). */
  inside(v, m) { return this.busy[v] ? this.sector(v, this.vec(v, this.near(m, v))) : 0; }
  /** The sectors at end u of busy edge m a point snapped to it (s) is in: on its sidewalk, the side of the road it's
   *  on; on its middle, either. */
  onSide(u, m, s) {
    if (s.left === null) return [this.beside(u, m, true), this.beside(u, m, false)];
    return [this.beside(u, m, u === this.ea[m] ? s.left : !s.left)];   // left of a to b: left looking out from a, right from b
  }
  /** On from sector `sec` of junction u, out by edge m: the [sector at its other end, crossing] pairs it can go on in
   *  (none if it can't), crossing 'safe' over a busy road at its light or marked crossing, 'none' over it without
   *  one. Where the walker stands is a sector of a junction: between two of a busy road's branches (or 0, anywhere
   *  else), the same whichever way they came, so a walk is the same either way it's searched. They go on from the
   *  sector they're in, or over at a light or crosswalk; restricted, those the only ways over. Along a busy road's
   *  middle, they keep to their side of it: on their left leaving u, on their left arriving at the other end. */
  step(S, u, sec, m) {
    const v = this.ea[m] === u ? this.eb[m] : this.ea[m];
    const over = this.safe.has(u) ? 'safe' : S.restricted ? null : 'none';
    if (this.kind[m] !== BUSY) {
      const at = this.inside(u, m);
      return at === sec ? [[this.inside(v, m), null, at]] : over ? [[this.inside(v, m), over, at]] : [];
    }
    const out = [];
    for (const left of [true, false]) {
      const at = this.beside(u, m, left);
      if (at === sec) out.push([this.beside(v, m, !left), null, at]);
      else if (over) out.push([this.beside(v, m, !left), over, at]);
    }
    return out;
  }
  /** The minutes a crossing at u takes (step()'s 'safe' or 'none'). */
  wait(u, x) { return x === 'safe' ? WAIT[this.safe.get(u).kind] ?? WAIT.m : WAIT.none; }
  /** On from sector `sec` of junction u onto the end's edge, to the end t on it: step()'s, on t's side of a busy road. */
  onto(S, u, sec, t) {
    const st = this.step(S, u, sec, t.m);
    if (this.kind[t.m] !== BUSY) return st;
    const want = this.onSide(u, t.m, t);
    return st.filter(h => want.includes(h[2]));
  }
  /** The busy roads crossed at junction u from sector a to sector b, by name: its branches between them, the shorter
   *  way round (at a light on a corner of two, the one or both a walker actually crosses). */
  crossed(u, a, b) {
    const br = [];
    for (let k = this.off[u]; k < this.off[u + 1]; k++) {
      const m = this.adj[k];
      if (this.kind[m] !== BUSY) continue;
      const p = this.near(m, u), w = this.vec(u, p), f = Math.min(1, 12 / (this.dist(this.lat[u], this.lon[u], p[0], p[1]) || 1));
      br.push({ a: Math.atan2(w[1], w[0]), la: this.lat[u] + (p[0] - this.lat[u]) * f, lo: this.lon[u] + (p[1] - this.lon[u]) * f });
    }
    const n = br.length;
    if (n < 2) return [];
    br.sort((x, y) => x.a - y.a);   // sector k is between branches k - 1 and k
    const up = ((b - a) % n + n) % n, down = n - up;
    // (a tie, the same branches whichever way it's walked)
    const idx = up < down || (up === down && a < b) ? Array.from({ length: up }, (_, i) => (a + i) % n) : Array.from({ length: down }, (_, i) => ((a - 1 - i) % n + n) % n);
    return [...new Set(idx.map(i => this.roadAt(br[i].la, br[i].lo)).filter(Boolean))];
  }
  /** The search from a snapped start, resumed for each walk asked of it: by its start and how it's walked. */
  search(s, restricted, avoid, rev = false) {
    const key = s.m + ':' + Math.round(s.t) + ':' + (restricted ? 1 : 0) + (avoid ? 1 : 0) + (rev ? 'r' : '');
    let S = this.searches.get(key);
    if (S) { this.searches.delete(key); this.searches.set(key, S); return S; }   // most recent last
    // as maps, not arrays the network's size: a walk to a stop settles a few hundred junctions, and the planner starts
    // hundreds of searches (1.7 MB each as arrays, a quarter of its time spent making them)
    S = { dist: new Map(), prev: new Map(), edge: new Map(), done: new Set(), heap: new Heap(), restricted, avoid, rev, s };
    // a state is a junction and its sector: u * 8 + sector
    const m = s.m, off = s.off / this.r.PACE;
    const seed = (node, c) => {
      const secs = this.kind[m] !== BUSY ? [this.inside(node, m)] : this.onSide(node, m, s);
      for (const sec of secs) { const id = node * 8 + sec; if (c < this.at(S, id)) { S.dist.set(id, c); S.heap.push(c, id); } }
    };
    seed(this.ea[m], off + s.t / this.r.PACE);
    seed(this.eb[m], off + (this.len[m] - s.t) / this.r.PACE);
    this.searches.set(key, S);
    if (this.searches.size > 48) this.searches.delete(this.searches.keys().next().value);
    return S;
  }
  /** A state's minutes so far on search S (Infinity, not reached). */
  at(S, id) { return S.dist.get(id) ?? Infinity; }
  /** Settle the search until nothing left in it could beat `bound` minutes, or MAX. */
  grow(S, bound, MAX = 90) {
    const H = S.heap;
    while (H.n && H.top() < bound && H.top() < MAX) {
      const [c, id] = H.pop();
      if (S.done.has(id) || c > this.at(S, id)) continue;
      S.done.add(id);
      const u = id >> 3, sec = id & 7;
      for (let k = this.off[u]; k < this.off[u + 1]; k++) {
        const m = this.adj[k], st = this.step(S, u, sec, m);
        if (!st.length) continue;
        const fwd = this.ea[m] === u, v = fwd ? this.eb[m] : this.ea[m], nc = c + this.cost(m, S.rev ? !fwd : fwd, S.avoid);   // backward, each edge as walked the other way
        for (const [s2, x] of st) { const nid = v * 8 + s2, n2 = x ? nc + this.wait(u, x) : nc; if (n2 < this.at(S, nid)) { S.dist.set(nid, n2); S.prev.set(nid, id); S.edge.set(nid, m); H.push(n2, nid); } }
      }
    }
  }
  /** A walk from one point to another along the ways: { mins, d (metres), coords ([lon, lat] each), via (the busy
   *  roads' crossings walked over: walks.json's, or { none, road } where crossed without one), up, down, steepUp,
   *  steepDown, steps }; null where either end is off the ways or there's no way within MAX minutes. */
  route(la1, lo1, la2, lo2, { restricted = true, avoid = false } = {}) {
    const s = this.snap(la1, lo1), t = this.snap(la2, lo2);
    if (!s || !t) return null;
    // From the end that keeps coming up: the planner walks from the one start to many stops, and from many stops to the
    // one end, and each walk from a stop its own search was 0.7 s on a phone to the Rush FunPlex. A search backward
    // from the end (each edge as walked the other way; the rules for a busy road the same either way) is shared.
    const ks = s.m + ':' + Math.round(s.t), kt = t.m + ':' + Math.round(t.t), tag = (restricted ? 1 : 0) + '' + (avoid ? 1 : 0);
    this.seen ??= new Map();
    const hit = k => { const n = (this.seen.get(k) || 0) + 1; this.seen.set(k, n); if (this.seen.size > 400) this.seen.delete(this.seen.keys().next().value); return n; };
    const ns = hit('s' + ks), nt = hit('t' + kt);
    const has = (k, r) => this.searches.has(k + ':' + tag + (r ? 'r' : ''));
    const back = !has(ks, false) && (has(kt, true) || nt > ns);
    if (!back) return this.walk(s, t, la1, lo1, la2, lo2, this.search(s, restricted, avoid));
    const w = this.walk(t, s, la2, lo2, la1, lo1, this.search(t, restricted, avoid, true));
    return w && { ...w, coords: w.coords.reverse(), via: w.via.reverse(), up: w.down, down: w.up, steepUp: w.steepDown, steepDown: w.steepUp };
  }
  /** The walk from snapped s to snapped t on search S (from s, forward or back): as route() gives it, as searched. */
  walk(s, t, la1, lo1, la2, lo2, S) {
    const { PACE } = this.r, m2 = t.m, offT = t.off / PACE;
    // the ways in at the end's edge: from its a, from its b, from any sector it may be gone on along from
    const ends = () => {
      let best = { c: Infinity };
      for (const [node, part] of [[this.ea[m2], t.t], [this.eb[m2], this.len[m2] - t.t]]) for (let sec = 0; sec < 8; sec++) {
        const id = node * 8 + sec;
        if (!S.dist.has(id)) continue;
        const ok = this.onto(S, node, sec, t);
        const c = this.at(S, id) + part / PACE + offT + (ok.length ? Math.min(...ok.map(([, x]) => x ? this.wait(node, x) : 0)) : 0);
        if (ok.length && c < best.c) best = { c, id };
      }
      if (s.m === m2 && !(this.kind[m2] === BUSY && s.left !== null && t.left !== null && s.left !== t.left)) { const c = (s.off + Math.abs(s.t - t.t) + t.off) / PACE; if (c < best.c) best = { c, same: true }; }   // both on one edge: along it
      return best;
    };
    let best = ends();
    for (let tries = 0; tries < 40; tries++) {
      if (S.heap.top() >= best.c || S.heap.top() >= 90 || !S.heap.n) break;
      this.grow(S, Math.min(best.c, S.heap.top() + 4));
      best = ends();
    }
    if (!isFinite(best.c)) return null;
    // the way back from the end, state by state: [edge, the state it came to]
    const steps = [];
    if (!best.same) for (let id = best.id; S.edge.has(id); id = S.prev.get(id)) steps.push([S.edge.get(id), id]);
    steps.reverse();
    const firstId = best.same ? -1 : (steps.length ? S.prev.get(steps[0][1]) : best.id);
    const coords = [[lo1, la1], [s.lon, s.lat]];
    let d = s.off, up = 0, down = 0, gu = 0, gd = 0, hasSteps = false;
    const via = [];
    const crossing = (u, sec, hop) => {   // hop: [sector on, crossing, sector left from]
      if (!hop || !hop[1]) return;
      const sx = this.safe.get(u), names = this.crossed(u, sec, hop[2]);
      if (hop[1] === 'safe' && sx) for (const road of names.length ? names : [sx.roads[0]]) via.push({ ...sx, road });
      else for (const road of names.length ? names : [this.roadAt(this.lat[u], this.lon[u]) || 'the road']) via.push({ lat: this.lat[u], lon: this.lon[u], none: true, road });
    };
    const partial = (m, from, to) => {   // the shape of edge m between two distances along it, either way
      const pts = []; let along = 0;
      const lo = Math.min(from, to), hi = Math.max(from, to);
      this.eachPiece(m, (a1, o1, a2, o2) => {
        const L = this.dist(a1, o1, a2, o2);
        if (along + L >= lo && along <= hi) { const u1 = L ? Math.max(0, (lo - along) / L) : 0, u2 = L ? Math.min(1, (hi - along) / L) : 1; pts.push([o1 + (o2 - o1) * u1, a1 + (a2 - a1) * u1], [o1 + (o2 - o1) * u2, a1 + (a2 - a1) * u2]); }
        along += L;
      });
      return to < from ? pts.reverse() : pts;
    };
    if (best.same) { coords.push(...partial(s.m, s.t, t.t)); d += Math.abs(s.t - t.t); }
    else {
      const sm = s.m, startNode = firstId >> 3, toA = startNode === this.ea[sm];
      coords.push(...partial(sm, s.t, toA ? 0 : this.len[sm])); d += toA ? s.t : this.len[sm] - s.t;
      let id = firstId;
      for (const [m, nid] of steps) {
        const u = id >> 3, st = this.step(S, u, id & 7, m).filter(([s2]) => s2 === (nid & 7));
        crossing(u, id & 7, st.find(([, x]) => !x) || st[0]);   // over a busy road here?
        const fwd = this.ea[m] === u;
        coords.push(...partial(m, fwd ? 0 : this.len[m], fwd ? this.len[m] : 0));
        d += this.len[m];
        up += fwd ? this.up[m] : this.down[m]; down += fwd ? this.down[m] : this.up[m];
        gu = Math.max(gu, fwd ? this.gUp[m] : this.gDown[m]); gd = Math.max(gd, fwd ? this.gDown[m] : this.gUp[m]);
        if (this.kind[m] === STEPS) hasSteps = true;
        id = nid;
      }
      const node = id >> 3;
      { const st = this.onto(S, node, id & 7, t); crossing(node, id & 7, st.find(([, x]) => !x) || st[0]); }   // and onto the end's edge
      const toA2 = node === this.ea[m2];
      coords.push(...partial(m2, toA2 ? 0 : this.len[m2], t.t)); d += toA2 ? t.t : this.len[m2] - t.t;
      if (this.kind[m2] === STEPS || this.kind[sm] === STEPS) hasSteps = true;
    }
    coords.push([t.lon, t.lat], [lo2, la2]);
    d += t.off;
    // the same point twice in a row dropped
    const line = coords.filter((p, i) => !i || Math.abs(p[0] - coords[i - 1][0]) > 1e-7 || Math.abs(p[1] - coords[i - 1][1]) > 1e-7);
    return { mins: best.c, d, coords: line, via, up, down, steepUp: gu, steepDown: gd, steps: hasSteps };
  }
}
