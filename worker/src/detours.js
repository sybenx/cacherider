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
const FAR = 150;       // metres off its line: one report this far off is a way round (one report a minute gets one, round a block)
const SAME = 200;      // metres apart two ways round can leave and rejoin and still be one
const THROUGH = 1800;  // seconds from passing where a way round leaves to passing where it rejoins: one trip
const CELL = 100;
const END = 120;      // metres from a trip's last stop: got there (its reports twenty seconds apart, checked between them)
const AWAY = 400;     // metres from it first, so a loop's trip, ending where it starts, isn't over as it sets out

let L = null, lAt = 0;
/** The route lines, in metres about the Transit Center, indexed by 100 m cells; fetched once an hour at most. */
async function lines() {
  if (L && Date.now() - lAt < 3600e3) return L;
  const j = await (await fetch(SHAPES, { cf: { cacheTtl: 3600, cacheEverything: true } })).json();
  if (!j.hub || !j.lines?.[0]?.key) throw new Error('shapes without keys');
  const lat0 = j.hub.lat, lon0 = j.hub.lon, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const xy = (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky];
  const cells = new Map(), byKey = new Map();   // each route's lines with the distance along each, for between()
  for (const l of j.lines) {
    const pts = l.coords.map(([lo, la]) => xy(la, lo));
    let d = 0;
    const walk = pts.map((p, i) => { if (i) d += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]); return d; });
    if (!byKey.has(l.key)) byKey.set(l.key, []);
    byKey.get(l.key).push({ pts, walk });
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
  // Metres from a point to its route's lines, as far as the cells round it hold them (beyond that, Infinity).
  const dist = (key, p) => {
    let d = Infinity;
    for (const [k, ax, ay, bx, by] of cells.get(Math.floor(p[0] / CELL) + ',' + Math.floor(p[1] / CELL)) || []) {
      if (k !== key) continue;
      const dx = bx - ax, dy = by - ay, n = dx * dx + dy * dy;
      const f = n ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / n)) : 0;
      d = Math.min(d, Math.hypot(p[0] - ax - f * dx, p[1] - ay - f * dy));
    }
    return d;
  };
  const off = (key, p) => Math.hypot(p[0], p[1]) > HUB_R && dist(key, p) > OFF;
  // Metres along the route's line from p on to q, the shortest of its lines that pass both (within NEAR of a
  // vertex), or null: how far a bus going along has to go from where a way round leaves to where it rejoins.
  const between = (key, p, q) => {
    let best = null;
    for (const { pts, walk } of byKey.get(key) || []) {
      let ap = null, aq = null, ep = NEAR, eq = NEAR;
      for (let i = 0; i < pts.length; i++) {
        const dp = Math.hypot(pts[i][0] - p[0], pts[i][1] - p[1]), dq = Math.hypot(pts[i][0] - q[0], pts[i][1] - q[1]);
        if (dp < ep) { ep = dp; ap = walk[i]; }
        if (dq < eq) { eq = dq; aq = walk[i]; }
      }
      if (ap !== null && aq !== null && aq > ap && (best === null || aq - ap < best)) best = aq - ap;
    }
    return best;
  };
  // In service: a route's hours that weekday, in the agency's own time (the timetable's, by tools/reduce.py).
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: j.tz || 'America/Denver', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const inHours = (key, ms) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(x => [x.type, x.value])), h = (j.hours || {})[key];
    const span = h && h[DAYS.indexOf(p.weekday)], m = +p.hour * 60 + +p.minute;
    return !h || (!!span && m >= span[0] - 10 && m <= span[1]);   // no hours known: counted, as before
  };
  // Where each trip ends, by its id: a bus that has got there is done with that trip, and the rest of its time on it
  // (driven to its next run's start, to the yard) is out of service, whatever the feed says.
  const ends = new Map();
  for (const [la, lo, ...ts] of j.ends || []) { const q = xy(la, lo); for (const t of ts) ends.set(t, q); }
  L = { xy, off, dist, between, inHours, ends, anyInHours: ms => !j.hours || Object.keys(j.hours).some(k => inHours(k, ms)) }; lAt = Date.now();
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
  return { L: await lines(), buses: st.results[0] ? JSON.parse(st.results[0].v) : {}, sus: sus.results.map(r => ({ ...r, paths: pathsOf(r.path) })), changed: new Set(), gone: [] };
}

/** Whether a bus is in service now: its trip live in the feed (stops still to come, the first of them due within two
 *  minutes: started, or about to), or with no trip to go by (a detoured bus, from the tracker site), its route's hours. */
export function inService(W, out, b, key, nowSec) {
  const u = b.trip && out.trips[b.trip];
  if (u && !u.c) {
    // The feed drops a trip's stops as they're passed: a first stop past the trip's second, it's started; else its first
    // stop due within two minutes, about to. Nothing still to come, it's done.
    const ahead = u.s.filter(x => x[2] > nowSec - 60);
    // Started, and not done: its first stop (sequence 0: the feed counts from nought) dropped from the feed. Not
    // 'about to' (its first stop due within minutes): a bus on its way to its first stop from the yard (16, across
    // its own route) counted as going round. (It asked for two stops dropped, read as if the feed counted from one:
    // Route 2 out of the Center was never in service by its second stop, past where its way round rejoins, so the
    // way round could never end.)
    if (u.s.some(x => x[2])) return ahead.length > 0 && Math.min(...u.s.map(x => x[1] ?? 0)) >= 1;
  }
  return W.L.inHours(key, nowSec * 1000);
}

/** One sample: [label, trip, key, lat, lon, bearing, speed, ts, live] a bus. */
export function watchStep(W, t, buses) {
  const { L } = W;
  for (const [label, trip, key, lat, lon, , , , live] of buses) {
    if (!key) continue;
    // Out of service (to the yard, between runs, a trip not started or done): its track dropped, nothing made of it.
    let b = W.buses[label];
    const dbg = key === '2' ? (m, x) => console.log('watch2', label, trip, new Date(t * 1000).toISOString().slice(11, 19), m, JSON.stringify(x)) : () => {};
    if (live === 0) { dbg('out of service', { on: !!b?.on, off: b?.off?.length }); if (b) { b.on = null; b.off = []; b.t = t; } continue; }
    // A track begun again keeps what it knew of its trip (done with it, say), its trip unchanged.
    if (!b || b.key !== key || t - b.t > GAP) { dbg('track begun', { had: !!b, gap: b ? t - b.t : null }); b = W.buses[label] = { key, t, on: null, off: [], offEnd: 0, near: {}, trip: b?.trip, away: b?.away, done: b?.done }; }
    const prevT = b.t;
    b.t = t;
    const p = L.xy(lat, lon), last = b.at;
    b.at = p;
    // Done with its trip (its last stop reached, below): nothing more made of it till the next.
    if (b.trip !== trip) { dbg('trip change', { from: b.trip }); b.trip = trip; b.away = false; b.done = false; }
    if (b.done) { dbg('done, skipped', {}); continue; }
    const end = trip && L.ends.get(trip);
    // Its trip's last stop reached, once away from it: this report taken as any other (a way round can rejoin right
    // there), then the trip done, whatever the feed says, and what the bus does after on it (driven to its next run's
    // start, to the yard) no detour.
    const ended = () => {
      if (!end) return false;
      if (Math.hypot(p[0] - end[0], p[1] - end[1]) > AWAY) b.away = true;
      else if (b.away && toSeg(end, last || p, p) <= END) { b.done = true; b.on = null; b.off = []; return true; }
      return false;
    };
    if (L.off(key, p)) { b.off.push([lat, lon]); b.offFar = Math.max(b.offFar || 0, L.dist(key, p)); dbg('off', { n: b.off.length, far: Math.round(b.offFar), on: !!b.on, away: b.away }); ended(); continue; }
    if (b.off.length) {
      // Off and back on: a way round, with two reports or more off between, or one well off (a report a minute, and a
      // way round a block takes about that: Route 2 out of the Transit Center by 300 East and 600 North, one report off
      // a trip, and none of them counted). Off and never back is a bus to the yard.
      dbg('back on', { n: b.off.length, far: Math.round(b.offFar || 0), on: !!b.on });
      if (b.on && (b.off.length >= 2 || b.offFar >= FAR)) round(W, key, b.on, [lat, lon], b.off, t);
      b.off = []; b.offEnd = t; b.offFar = 0;
    }
    b.on = [lat, lon];
    // Along the line where a suspect goes round: past where it leaves, seen on the line between (well clear of both
    // ends), then where it rejoins, no way off between. Seen only at the two ends, it may as well have gone round
    // between reports a minute apart: Route 2's way out of the Center, 220 m of 200 East, was 'along' that way, and
    // its run kept starting again at one.
    if (!b.mid) b.mid = {};
    for (const s of W.sus) {
      if (s.key !== key) continue;
      if (far(L, p, s.olat, s.olon) <= NEAR) { b.near[s.id] = t; b.mid[s.id] = false; }
      else if (b.near[s.id] && far(L, p, s.blat, s.blon) <= NEAR) {
        // A short way round (a block or two: Route 2's by 300 East out of the Center) has no report between its two
        // ends: a bus along the line there is seen at one end and then the other, the straight way between them on
        // the line, within a report or two. Its ways round have a report off between, which b.offEnd keeps.
        const straight = last && t - prevT <= 90 && !L.off(key, [(last[0] + p[0]) / 2, (last[1] + p[1]) / 2]);
        // One trip's time between the two, or as long as the line between them takes a bus in service, stops and all
        // (3.5 m/s, and five minutes): Route 16's way round from north Main to 980 East 700 North cut 7.8 km of its
        // line, which no run along it covers in thirty minutes, so no run could end it.
        const through = Math.max(THROUGH, (L.between(key, L.xy(s.olat, s.olon), L.xy(s.blat, s.blon)) || 0) / 3.5 + 300);
        dbg('at rejoins', { sus: s.id, since: t - b.near[s.id], through, offEndBefore: b.offEnd < b.near[s.id], mid: !!b.mid[s.id], straight: !!straight, streak: s.streak });
        if (t - b.near[s.id] < through && b.offEnd < b.near[s.id] && (b.mid[s.id] || straight) && s.streak > 0) { s.streak = 0; s.along = t; W.changed.add(s); }
        delete b.near[s.id]; delete b.mid[s.id];
      } else if (b.near[s.id]) b.mid[s.id] = true;   // on its line, clear of both ends, on the way from one to the other
    }
    ended();
  }
  for (const [label, b] of Object.entries(W.buses)) if (t - b.t > 600) delete W.buses[label];
}

/** A bus's way round: the run of a suspect it matches up by one (started again after a bus went along), else a
 *  new suspect. The last three buses' ways are kept, newest first. */
function round(W, key, on, back, path, t) {
  const p = W.L.xy(on[0], on[1]), q = W.L.xy(back[0], back[1]);
  let s = W.sus.find(s => s.key === key && far(W.L, p, s.olat, s.olon) <= SAME && far(W.L, q, s.blat, s.blon) <= SAME);
  if (!s) W.sus.push(s = { id: null, key, first: t, streak: 0, trips: 0, along: null });
  s.streak += 1; s.trips += 1; s.last = t;
  s.olat = on[0]; s.olon = on[1]; s.blat = back[0]; s.blon = back[1]; s.paths = [[on, ...path, back], ...(s.paths || [])].slice(0, 3);
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
      ? db.prepare('INSERT INTO detours (key, olat, olon, blat, blon, path, streak, trips, first, last, along) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(s.key, s.olat, s.olon, s.blat, s.blon, JSON.stringify(s.paths), s.streak, s.trips, s.first, s.last, s.along)
      : db.prepare('UPDATE detours SET olat = ?, olon = ?, blat = ?, blon = ?, path = ?, streak = ?, trips = ?, last = ?, along = ? WHERE id = ?').bind(s.olat, s.olon, s.blat, s.blon, JSON.stringify(s.paths), s.streak, s.trips, s.last, s.along, s.id));
  }
  q.push(db.prepare("INSERT OR REPLACE INTO state (k, v) VALUES ('buses', ?)").bind(JSON.stringify(W.buses)));
  await db.batch(q);
}

/** The last three buses' ways round, newest first (a row from before kept one: a list of points). */
const pathsOf = j => { const p = JSON.parse(j); return typeof p[0][0] === 'number' ? [p] : p; };
/** GET /detours: the ways round, newest first, as the app reads them. */
export async function detoursJSON(env) {
  const r = await env.TRACKS.prepare('SELECT * FROM detours ORDER BY last DESC').all();
  return {
    t: Math.floor(Date.now() / 1000),
    detours: r.results.map(s => ({ id: s.id, route: s.key, streak: s.streak, trips: s.trips, first: s.first, last: s.last, along: s.along, leaves: [s.olat, s.olon], rejoins: [s.blat, s.blon], paths: pathsOf(s.path), path: pathsOf(s.path)[0] })),
  };
}

/** Metres from a point to the way between two reports. */
function toSeg([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, n = dx * dx + dy * dy;
  const f = n ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / n)) : 0;
  return Math.hypot(x - ax - f * dx, y - ay - f * dy);
}
