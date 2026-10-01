// Detours from the buses' own tracks, worked out a sample at a time (cheap enough for the free plan: a lookup or
// two a bus, and a write only when something changes). A bus that leaves its route's line and comes back to it
// further on makes a suspect: that way round, from where it left to where it came back. The route's next bus
// through settles it, one way or the other: round the same way, the run goes up (2 in a row a doubt, 3 quite
// sure, 4 all but certain); along the line there, it's over. The app reads them at /detours and works out the
// stops gone round (likely closed) and those passed on the way (served: on a detour, a stop passed is served).

const SHAPES = 'https://cacherider.com/data/cvtd-shapes.json';
const OFF = 60;        // metres from every one of its route's lines: off the route
const HUB_R = 150;     // the Transit Center's own drives and bays are nobody's detour
const GAP = 120;       // seconds without a bus's report beyond which its track is broken
const NEAR = 150;      // metres from where a way round leaves or rejoins the line: passing there
const SAME = 200;      // metres apart two ways round can leave and rejoin and still be one
const THROUGH = 1800;  // seconds from passing where a way round leaves to passing where it rejoins: one trip
const CELL = 100;

let L = null, lAt = 0;
/** The route lines, in metres about the Transit Center, indexed by 100 m cells; fetched once an hour at most. */
async function lines() {
  if (L && Date.now() - lAt < 3600e3) return L;
  const j = await (await fetch(SHAPES, { cf: { cacheTtl: 3600, cacheEverything: true } })).json();
  if (!j.hub || !j.lines?.[0]?.key) throw new Error('shapes without keys');
  const lat0 = j.hub.lat, lon0 = j.hub.lon, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const xy = (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky];
  const cells = new Map();
  for (const l of j.lines) {
    const pts = l.coords.map(([lo, la]) => xy(la, lo));
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], seg = [l.key, ax, ay, bx, by];
      for (let cx = Math.floor(Math.min(ax, bx) / CELL) - 1; cx <= Math.floor(Math.max(ax, bx) / CELL) + 1; cx++)
        for (let cy = Math.floor(Math.min(ay, by) / CELL) - 1; cy <= Math.floor(Math.max(ay, by) / CELL) + 1; cy++) {
          const k = cx + ',' + cy;
          let c = cells.get(k); if (!c) cells.set(k, c = []);
          c.push(seg);
        }
    }
  }
  const off = (key, p) => {
    if (Math.hypot(p[0], p[1]) <= HUB_R) return false;
    for (const [k, ax, ay, bx, by] of cells.get(Math.floor(p[0] / CELL) + ',' + Math.floor(p[1] / CELL)) || []) {
      if (k !== key) continue;
      const dx = bx - ax, dy = by - ay, n = dx * dx + dy * dy;
      const f = n ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / n)) : 0;
      if (Math.hypot(p[0] - ax - f * dx, p[1] - ay - f * dy) <= OFF) return false;
    }
    return true;
  };
  L = { xy, off }; lAt = Date.now();
  return L;
}
const far = (L, p, lat, lon) => { const q = L.xy(lat, lon); return Math.hypot(p[0] - q[0], p[1] - q[1]); };

/** The watch's state, read at the start of a minute's run and written at its end: each bus's track so far, and the
 *  suspects. */
export async function watchStart(env) {
  const [st, sus] = await env.TRACKS.batch([
    env.TRACKS.prepare("SELECT v FROM state WHERE k = 'buses'"),
    env.TRACKS.prepare('SELECT * FROM detours'),
  ]);
  return { L: await lines(), buses: st.results[0] ? JSON.parse(st.results[0].v) : {}, sus: sus.results.map(r => ({ ...r, path: JSON.parse(r.path) })), changed: new Set(), gone: [] };
}

/** One sample: [label, trip, key, lat, lon, ...] a bus. */
export function watchStep(W, t, buses) {
  const { L } = W;
  for (const [label, , key, lat, lon] of buses) {
    if (!key) continue;
    let b = W.buses[label];
    if (!b || b.key !== key || t - b.t > GAP) b = W.buses[label] = { key, t, on: null, off: [], offEnd: 0, near: {} };
    b.t = t;
    const p = L.xy(lat, lon);
    if (L.off(key, p)) { b.off.push([lat, lon]); continue; }
    if (b.off.length) {
      // Off and back on, two reports or more off between: a way round. (Off and never back is a bus to the yard.)
      if (b.on && b.off.length >= 2) round(W, key, b.on, [lat, lon], b.off, t);
      b.off = []; b.offEnd = t;
    }
    b.on = [lat, lon];
    // Along the line where a suspect goes round: past where it leaves, then where it rejoins, no way off between.
    for (const s of W.sus) {
      if (s.key !== key) continue;
      if (far(L, p, s.olat, s.olon) <= NEAR) b.near[s.id] = t;
      else if (b.near[s.id] && far(L, p, s.blat, s.blon) <= NEAR) {
        if (t - b.near[s.id] < THROUGH && b.offEnd < b.near[s.id] && s.streak > 0) { s.streak = 0; s.along = t; W.changed.add(s); }
        delete b.near[s.id];
      }
    }
  }
  for (const [label, b] of Object.entries(W.buses)) if (t - b.t > 600) delete W.buses[label];
}

/** A bus's way round: the run of a suspect it matches up by one (started again after a bus went along), else a
 *  new suspect. The newest way's path is kept. */
function round(W, key, on, back, path, t) {
  const p = W.L.xy(on[0], on[1]), q = W.L.xy(back[0], back[1]);
  let s = W.sus.find(s => s.key === key && far(W.L, p, s.olat, s.olon) <= SAME && far(W.L, q, s.blat, s.blon) <= SAME);
  if (!s) W.sus.push(s = { id: null, key, first: t, streak: 0, trips: 0, along: null });
  s.streak += 1; s.trips += 1; s.last = t;
  s.olat = on[0]; s.olon = on[1]; s.blat = back[0]; s.blon = back[1]; s.path = [on, ...path, back];
  W.changed.add(s);
}

/** The minute's work written: each suspect changed, those long settled put away, the tracks kept for the next run. */
export async function watchEnd(env, W, t) {
  const db = env.TRACKS, q = [];
  for (const s of W.sus) {
    const stale = s.streak === 1 ? t - s.last > 4 * 3600   // one bus, once, and none since round that way
      : s.streak === 0 ? t - s.along > 6 * 3600             // over: kept a while, to tell the app it's over
      : t - s.last > 4 * 86400;                              // no bus this way in four days
    if (stale && s.id !== null) q.push(db.prepare('DELETE FROM detours WHERE id = ?').bind(s.id));
    else if (!stale && W.changed.has(s)) q.push(s.id === null
      ? db.prepare('INSERT INTO detours (key, olat, olon, blat, blon, path, streak, trips, first, last, along) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(s.key, s.olat, s.olon, s.blat, s.blon, JSON.stringify(s.path), s.streak, s.trips, s.first, s.last, s.along)
      : db.prepare('UPDATE detours SET olat = ?, olon = ?, blat = ?, blon = ?, path = ?, streak = ?, trips = ?, last = ?, along = ? WHERE id = ?').bind(s.olat, s.olon, s.blat, s.blon, JSON.stringify(s.path), s.streak, s.trips, s.last, s.along, s.id));
  }
  q.push(db.prepare("INSERT OR REPLACE INTO state (k, v) VALUES ('buses', ?)").bind(JSON.stringify(W.buses)));
  await db.batch(q);
}

/** GET /detours: the ways round, newest first, as the app reads them. */
export async function detoursJSON(env) {
  const r = await env.TRACKS.prepare('SELECT * FROM detours ORDER BY last DESC').all();
  return {
    t: Math.floor(Date.now() / 1000),
    detours: r.results.map(s => ({ id: s.id, route: s.key, streak: s.streak, trips: s.trips, first: s.first, last: s.last, along: s.along, leaves: [s.olat, s.olon], rejoins: [s.blat, s.blon], path: JSON.parse(s.path) })),
  };
}
