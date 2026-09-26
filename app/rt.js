// Connect, live: CVTD's GTFS-realtime feeds by way of a small relay on Cloudflare
// (the tracker refuses browser requests; see worker/). Bus positions for the map,
// and predicted times for every stop a trip is yet to reach, so a row can say
// "Live · 3 min late" instead of "Scheduled". Polled while a live screen is open.
import { D, setLive, distance } from './data.js';

export const RT_URL = 'https://live.cacherider.com/';
const POLL = 15000, STALE = 90000;

export const rt = { at: 0, t: 0, buses: [], trips: {}, loopMode: {}, wanted: false, fetching: false, error: null };
let timer = null;
/** 'trip:stop' → when the feed first stopped predicting that Transit Center bay for that trip: the bus pulled out. */
const left = new Map();
const LEFT_GRACE = 60000;   // a departure says now for this long after the bus leaves, rather than flip at once
/** trip → when a loop bus on it was first seen at its Transit Center stop: it's in, waiting. The feed's time for a
 *  stop a bus sits at is its arrival, then minutes old, so the bus's place is what says it hasn't gone. */
const here = new Map();
const AT_STOP = 60;   // metres from its stop: a loop bus this close is at it
const loopVotes = {};   // ri → { mode, n }: a loop's mode changes after two polls in a row agree
const listeners = new Set();
export function onRt(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setRtWanted(w) {
  rt.wanted = w;
  if (w && !timer) timer = setInterval(() => tick(false), POLL);
  if (!w && timer) { clearInterval(timer); timer = null; }
  if (w && Date.now() - rt.at > POLL) tick(true);
}
export const rtStale = () => rt.at === 0 || Date.now() - rt.at > STALE;
export const rtHasData = () => rt.at > 0;
export function rtSeen() { const d = new Date(rt.at); return (d.getHours() % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0'); }

// ---- the static side of each trip, indexed once: trip id → index, and index → route/headsign/direction
let tripIdx = null, tripInfo = null;
function index() {
  if (tripIdx || !D || !D.trips) return;
  tripIdx = new Map(D.trips.map((id, i) => [id, i]));
  tripInfo = new Array(D.trips.length);
  for (const per of Object.values(D.times)) for (const rows of Object.values(per)) for (const t of rows) if (!tripInfo[t[4]]) tripInfo[t[4]] = { r: t[1], h: t[2], dir: t[3] };
}
/** The scheduled minute of a trip at a stop, from the stop's own rows. */
function schedMin(si, ti) {
  for (const rows of Object.values(D.times[si] || {})) for (const t of rows) if (t[4] === ti) return t[0];
  return null;
}
/** Minutes since local midnight for an epoch second, a day later counted past 1440. */
function toMin(sec) {
  const d = new Date(sec * 1000), t = new Date();
  let m = d.getHours() * 60 + d.getMinutes();
  if (d.getDate() !== t.getDate()) m += d > t ? 1440 : -1440;
  return m;
}

async function tick(force) {
  if (!rt.wanted || rt.fetching || !D) return;
  if (!force && document.visibilityState !== 'visible') return;
  rt.fetching = true;
  try {
    const j = await (await fetch(RT_URL, { cache: 'no-store' })).json();
    if (j.error) throw new Error(j.error);
    index();
    const trips = {};
    for (const [id, u] of Object.entries(j.trips || {})) {
      const ti = tripIdx.get(id);
      const at = new Map();
      let first = null, last = null;
      // The trip's final stop has no boarding row in the timetable (see tools/reduce.py), and on a loop it's
      // the same stop the trip left from: matched to that departure it would read as a bus half an hour late.
      const end = u.s.reduce((m, x) => Math.max(m, x[1] ?? -1), -1);
      for (const [sid, seq, time, rel] of u.s) {
        if (seq === end) continue;
        at.set(sid, { seq, time, skipped: rel === 1 });
        if (rel === 1) continue;
        if (!first || seq < first.seq) first = { sid, seq, time };
        if (!last || seq > last.seq) last = { sid, seq, time };
      }
      let lastDelay = null;
      if (last && ti !== undefined && D.stopById[last.sid] !== undefined) {
        const sm = schedMin(D.stopById[last.sid], ti);
        if (sm !== null) lastDelay = toMin(last.time) - sm;
      }
      trips[id] = { v: u.v, ts: u.ts, at, first, last, lastDelay, ti, stops: u.s, end };
    }
    const buses = [];
    for (const b of j.buses || []) {
      const ti = tripIdx.get(b.trip);
      let info = ti !== undefined ? tripInfo[ti] : null;
      let ri = info ? info.r : undefined;
      if (ri === undefined && b.route) ri = D.routeByShort[b.route];   // a detoured bus, from the tracker site: a route, no trip
      if (ri === undefined) {   // a trip the timetable doesn't know: the route is the id's prefix
        const m = /^([A-Z]*\d+)_/.exec(b.trip || '');
        if (m) ri = D.routeByShort[m[1]] ?? D.routes.findIndex(r => r.short.startsWith(m[1] + ' '));
        if (ri === -1) ri = undefined;
      }
      if (ri === undefined || ri < 0) continue;
      buses.push({ id: 'c:' + b.id, label: b.label || b.id, trip: b.trip, ri, lat: b.lat, lon: b.lon, course: b.bearing ?? 0, speed: b.speed, ts: b.ts, h: info ? info.h : null, dir: info ? info.dir : null });
    }
    const t0 = Date.now();
    for (const [id, old] of Object.entries(rt.trips)) for (const [sid, x] of old.at) {
      const k = id + ':' + sid;
      if (!x.skipped && !left.has(k) && D.stops[D.stopById[sid]]?.hub && !(trips[id] && trips[id].at.has(sid))) left.set(k, t0);
    }
    for (const [k, ms] of left) if (t0 - ms > 600000) left.delete(k);
    for (const ri of D.hub.loops || []) watchLoop(ri, trips, buses, t0);
    rt.trips = trips; rt.buses = buses; rt.t = j.t; rt.at = Date.now(); rt.error = null;
  } catch (e) {
    rt.error = e.message || 'unreachable';
  }
  rt.fetching = false;
  for (const fn of listeners) fn();
}

/** A loop at its Transit Center stop: which bus is in (the `here` pins), and whether the loop is running to its
 *  timetable or spacing its buses. Spacing is the drivers' bunching screen, or a dispatcher moving every run a
 *  trip forward: either way every bus is off by about the same, ten minutes or more, ahead or behind together. */
function watchLoop(ri, trips, buses, t0) {
  const bay = D.hub.bays.find(b => b.routes.includes(ri));
  if (!bay) return;
  const stop = D.stops[bay.stop], sid = stop.id;
  const offs = [];
  for (const b of buses) {
    if (b.ri !== ri) continue;
    const u = trips[b.trip];
    const listed = u && u.stops.some(s => s[0] === sid);
    if (listed && distance(b.lat, b.lon, stop.lat, stop.lon) <= AT_STOP) { if (!here.has(b.trip)) here.set(b.trip, t0); }
    else here.delete(b.trip);
    // Its offset at its next stop yet to come (the feed can keep a passed one listed, its time gone stale).
    if (u && u.ti !== undefined) {
      let next = null;
      for (const [s, x] of u.at) if (!x.skipped && x.time >= t0 / 1000 - 60 && (!next || x.seq < next.seq)) next = { sid: s, ...x };
      const sm = next ? schedMin(D.stopById[next.sid], u.ti) : null;
      if (sm !== null && sm !== undefined) offs.push(toMin(next.time) - sm);
    }
  }
  for (const id of here.keys()) if (!trips[id] && D.trips && tripInfo[tripIdx.get(id)]?.r === ri) here.delete(id);
  const spacing = offs.length >= 2 && offs.every(o => Math.abs(o) >= 10) && (offs.every(o => o > 0) || offs.every(o => o < 0))
    && Math.max(...offs) - Math.min(...offs) <= 4;
  const want = spacing ? 'spacing' : 'normal', v = loopVotes[ri] || (loopVotes[ri] = { mode: 'normal', n: 0 });
  if (want === v.mode) v.n = 0; else if (++v.n >= 2) { v.mode = want; v.n = 0; }
  rt.loopMode[ri] = v.mode;
}
export const loopSpacing = ri => rt.loopMode[ri] === 'spacing' && !rtStale();

/** A spacing loop's departure from its Transit Center stop. Running to its timetable, a loop is like any route
 *  (see `heldAt`); spacing, its timetable means nothing, so the bus's place does the telling. A bus at its stop
 *  (`here`) is at its stop until it pulls away, and then its row goes; one on its way leaves about five minutes
 *  after it gets in. */
function loopAtHub(t, u, sid, hit) {
  const id = D.trips[t.trip], nowS = Date.now() / 1000, nowM = toMin(Math.floor(nowS));
  if (here.has(id)) return { min: nowM, delay: nowM - t.min, here: true, spacing: true };
  if (hit && !hit.skipped && hit.time >= nowS - 60) { const dep = toMin(hit.time) + 5; return { min: dep, delay: dep - t.min, spacing: true }; }
  return hit ? { gone: true } : undefined;   // skipped, or a time gone by and the bus not there: it's been
}

/** What the feed says about a scheduled departure today: { min, delay } with the predicted minute; { gone: true }
 *  when the bus has already been (or skips the stop); null when the feed has nothing (the trip hasn't started,
 *  or the feed is stale), so the row stays as scheduled. `est` marks a minute carried from the trip's last
 *  prediction rather than one for this stop. */
export function predict(t) {
  if (t.trip === undefined || t.day || rtStale() || !D.trips) return null;
  const u = rt.trips[D.trips[t.trip]];
  if (!u) return null;
  const p = feedSays(t, u);
  // From a Transit Center bay, a departure can't leave before the bus that runs it is in: that bus (the trip's own
  // vehicle) may still be finishing the trip before. Every screen reads this one rule.
  if (p && !p.gone && D.stops[t.si].hub && !(isLoop(t.r) && loopSpacing(t.r))) {
    const inAt = inbound(u, D.trips[t.trip]);
    if (inAt !== null && inAt > p.min) return { ...p, min: inAt, delay: inAt - t.min };
  }
  return p;
}
/** When the bus that runs a trip gets to the Transit Center, if it's still on its way in on the trip before; else null. */
function inbound(u, id) {
  if (!u.v) return null;
  const b = rt.buses.find(x => x.id === 'c:' + u.v);
  if (!b || b.trip === id) return null;
  const prev = rt.trips[b.trip];
  if (!prev) return null;
  const end = prev.stops.find(s => s[1] === prev.end);
  if (!end || !D.stops[D.stopById[end[0]]]?.hub || end[2] < Date.now() / 1000 - 60) return null;
  return toMin(end[2]);
}
function feedSays(t, u) {
  const sid = D.stops[t.si].id;
  const hit = u.at.get(sid);
  if (isLoop(t.r) && D.stops[t.si].hub && loopSpacing(t.r)) { const p = loopAtHub(t, u, sid, hit); if (p !== undefined) return p; }
  // A bus still listed at its bay after the feed's time for it is still there, boarding: the feed stamps a bay a
  // bus waits at with its arrival, which then reads as gone. It leaves now (the listing drops when it goes). The
  // Transit Center is every route's first stop, the loops' too (their stop numbering starts elsewhere, a quirk of
  // how trips switch). A loop's listing is trusted for ten minutes past its time, a route's for thirty: a loop bus
  // has been seen with the Transit Center still listed, minutes old, well after it left.
  const nowS = Date.now() / 1000, cap = isLoop(t.r) ? 600 : 1800;
  if (hit && !hit.skipped && D.stops[t.si].hub && hit.time < nowS - 30 && nowS - hit.time < cap)
    return held(t, toMin(Math.floor(nowS)) - t.min);
  if (hit) return hit.skipped ? { gone: true } : held(t, toMin(hit.time) - t.min);
  const order = (D.routes[t.r].stops || {})[String(t.dir)] || [];
  const i = order.indexOf(t.si);
  if (i < 0) return null;
  const f = u.first ? order.indexOf(D.stopById[u.first.sid]) : -1, l = u.last ? order.indexOf(D.stopById[u.last.sid]) : -1;
  // Pulling out of a Transit Center bay, the bus drops the bay from its predictions at once. Rather than vanish, the
  // row says now for a minute after it goes; and a bus, which never leaves a bay early, holds its scheduled minute
  // till that's out too. A loop spacing its buses just goes: the next one is what matters.
  if (f >= 0 && i < f) {
    if (!D.stops[t.si].hub || (isLoop(t.r) && loopSpacing(t.r))) return { gone: true };
    const ms = left.get(D.trips[t.trip] + ':' + sid);
    if (ms && Date.now() - ms < LEFT_GRACE) return held(t, toMin(Math.floor(Date.now() / 1000)) - t.min);
    return held(t, 0);
  }
  if (l >= 0 && i > l && u.lastDelay !== null) return { ...held(t, u.lastDelay), est: true };
  return null;
}
/** Every route lays over at the Transit Center, and a bus that gets in ahead waits there rather than leave early:
 *  a departure from its bay is never before its scheduled minute, the feed can only make it later. A loop spacing
 *  its buses is the exception (see `loopAtHub`). */
export const heldAt = (si, delay, ri) => D.stops[si] && D.stops[si].hub && !(isLoop(ri) && loopSpacing(ri)) ? Math.max(0, delay) : delay;
const held = (t, delay) => { const d = heldAt(t.si, delay, t.r); return { min: t.min + d, delay: d }; };
/** The Green and Blue Loops: far off their timetable in traffic as a matter of course, so no late or early word. */
export const isLoop = ri => (D.hub.loops || []).includes(ri);
setLive(t => { const p = predict(t); if (!p) return t; return p.gone ? { ...t, gone: true } : { ...t, min: p.min, live: p }; });

/** 'On time', '3 min late', '2 min early'. */
export function lateWords(delay) {
  if (delay >= 2) return delay + ' min late';
  if (delay <= -2) return -delay + ' min early';
  return 'On time';
}
/** A Connect bus's next stops with predicted minutes, for its card; `end` marks the trip's final stop. */
export function busStops(b, n = 5) {
  const u = rt.trips[b.trip];
  if (!u) return [];
  return u.stops.filter(([, , , rel]) => rel !== 1)
    .map(([sid, seq, time]) => ({ si: D.stopById[sid], seq, min: toMin(time), time, end: seq === u.end }))
    .filter(x => x.si !== undefined && x.time >= rt.t - 30).sort((a, b) => a.seq - b.seq).slice(0, n);
}
export function findBus(id) { return rt.buses.find(b => b.id === id); }
