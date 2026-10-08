// Connect, live: CVTD's GTFS-realtime feeds by way of a small relay on Cloudflare
// (the tracker refuses browser requests; see worker/). Bus positions for the map,
// and predicted times for every stop a trip is yet to reach, so a row can say
// "Live · 3 min late" instead of "Scheduled". Polled while a live screen is open.
import { D, setLive, distance, bearing, LIVE_URL, tripStops, tripEnd, runOf, timesOn, serviceSpan } from './data.js';
import { now, dayDiff, clockText, dayFrom } from './time.js';

export const RT_URL = LIVE_URL;
const POLL = 5000, STALE = 90000;   // each bus reports every 3 to 8 seconds; the relay keeps the feed 5

export const rt = { at: 0, t: 0, buses: [], parked: [], trips: {}, doubt: new Set(), loopMode: {}, wanted: false, fetching: false, error: null };
/** A bus's route as last seen on a trip: a bus that has finished (logged off its trip, on its way in) still reports,
 *  with no trip to say whose it is. Kept by it, it stays on the map, grey (rt.parked: the map's alone, nothing else
 *  counts it). */
const lastRoute = new Map();
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
  // Stale and not asked lately: ask now. Not on every redraw: a feed that fails at once (no signal, a refused
  // origin) would redraw the page, the redraw ask again, and round it would go, many times a second.
  if (w && Date.now() - rt.at > POLL && Date.now() - lastTry > POLL) tick(true);
}
export const rtStale = () => rt.at === 0 || Date.now() - rt.at > STALE;
// A tab back in view (hidden, its polling stops): the feed asked for at once, not on the interval's next beat.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && rt.wanted && Date.now() - rt.at > POLL) tick(true); });
export const rtHasData = () => rt.at > 0;
export function rtSeen() { return clockText(now(new Date(rt.at)).min); }

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
  const a = now(new Date(sec * 1000));   // the agency's clock, as the timetable is, whatever zone the phone is set to
  return a.min + 1440 * dayDiff(today(), a.ymd);
}
let todayAt = 0, todayYmd = '';
function today() { const t = Date.now(); if (t - todayAt > 1000) { todayAt = t; todayYmd = now().ymd; } return todayYmd; }

/** Whether buses should be out now, by the timetable: from 20 minutes before the day's first departure (buses pull
 *  out ahead of it) to an hour after its last (a late one still coming in), yesterday's late night included. Outside
 *  that the feed is asked every two minutes, not every five seconds: a bus out of hours is rare, and still shows. */
const IDLE = 120000;
function busesDue() {
  const c = now(), today = serviceSpan(c.ymd), last = serviceSpan(dayFrom(c.ymd, -1).ymd);
  return (!!today && c.min >= today[0] - 20 && c.min <= today[1] + 60) || (!!last && c.min + 1440 <= last[1] + 60);
}
let lastTry = 0;
async function tick(force) {
  if (!rt.wanted || rt.fetching || !D) return;
  if (!force && document.visibilityState !== 'visible') return;
  if (!force && Date.now() - lastTry < IDLE && !busesDue()) return;
  rt.fetching = true; lastTry = Date.now();
  try {
    const j = await (await fetch(RT_URL, { cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined })).json();   // a relay that hangs would stall the polling, not just this poll
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
      trips[id] = { v: u.v, ts: u.ts, at, first, last, lastDelay, ti, stops: u.s, end, hub: hubAhead(ti, at, j.t), cancelled: u.c === 1 };
    }
    const buses = [], parked = [];
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
      if ((ri === undefined || ri < 0) && !b.trip && lastRoute.has(b.id)) { parked.push({ id: 'c:' + b.id, label: b.label || b.id, trip: '', ri: lastRoute.get(b.id), lat: b.lat, lon: b.lon, course: b.bearing ?? 0, speed: b.speed, ts: b.ts, h: null, dir: null, free: true }); continue; }
      if (ri === undefined || ri < 0) continue;
      lastRoute.set(b.id, ri);
      buses.push({ id: 'c:' + b.id, label: b.label || b.id, trip: b.trip, ri, lat: b.lat, lon: b.lon, course: b.bearing ?? 0, speed: b.speed, ts: b.ts, h: info ? info.h : null, dir: info ? info.dir : null });
    }
    // A detoured route's buses report where they are, but the tracker predicts nothing for them (off the route it
    // knows, it gives up): their times are worked out here from the bus's place along its trip, the timetable's
    // minute there set against the clock and carried to every stop ahead. Marked `est`, as a carried delay is.
    // The feed's word on a bus held against where the bus is (agrees()): where they don't agree, its trip's times
    // (only the bus the feed names for the trip: a swap bus parked at the Center reports the trip it's covering too)
    // are dropped, not guessed at, and every screen keeps to the timetable for it (the bus still on the map): right,
    // or not said. A feed waiting at a stop its bus went round had a Route 2 back and on time 'late, 3:14'.
    const doubt = new Set();
    for (const b of buses) if (trips[b.trip] && !trips[b.trip].est && trips[b.trip].v && b.id === 'c:' + trips[b.trip].v && tripIdx.has(b.trip) && !agrees(b, trips[b.trip], tripIdx.get(b.trip), j.t)) { delete trips[b.trip]; doubt.add(b.trip); }
    for (const b of buses) if (!trips[b.trip] && !doubt.has(b.trip) && tripIdx.has(b.trip) && j.t - b.ts < 180) { const u = fromPlace(b, tripIdx.get(b.trip), j.t); if (u) trips[b.trip] = u; }
    rt.doubt = doubt;
    const t0 = Date.now();
    for (const [id, old] of Object.entries(rt.trips)) for (const [sid, x] of old.at) {
      const k = id + ':' + sid;
      if (!x.skipped && !left.has(k) && D.stops[D.stopById[sid]]?.hub && !(trips[id] && trips[id].at.has(sid))) left.set(k, t0);
    }
    for (const [k, ms] of left) if (t0 - ms > 600000) left.delete(k);
    for (const ri of D.hub.loops || []) watchLoop(ri, trips, buses, t0);
    rt.trips = trips; rt.buses = buses; rt.parked = parked; rt.t = j.t; rt.at = Date.now(); rt.error = null;
  } catch (e) {
    rt.error = e.message || 'unreachable';
  }
  rt.fetching = false;
  for (const fn of listeners) fn();
}

/** A trip's Transit Center call while its bus is yet to leave it: where in the trip it is, the timetable's minute
 *  there and the feed's. The feed runs a bus on from the Center as soon as it gets in, and has the loops (whose
 *  timetable has no wait there) in early and away early, every stop after as early as they are: seven to twelve
 *  minutes, the day through. A bus waits. Null when the trip has no call there, or the bus has been. */
function hubAhead(ti, at, nowS) {
  if (ti === undefined) return null;
  const seq = tripStops(ti), k = seq.findIndex(([, si]) => D.stops[si].hub);
  if (k < 0 || k === seq.length - 1) return null;
  const x = at.get(D.stops[seq[k][1]].id);
  return x && !x.skipped && x.time >= nowS - 60 ? { k, sched: seq[k][0], at: toMin(x.time), seq } : null;
}
/** Predictions for a trip from where its bus is: the nearest leg of the trip (stop to stop, as the crow flies),
 *  how far along it, the timetable's minute there, and the clock's lead on that carried to every stop ahead. Null
 *  when the bus is nowhere near its trip (a detour can take it blocks off, not miles). */
function fromPlace(b, ti, nowS) {
  const pts = tripStops(ti).slice(), te = tripEnd(ti);
  if (te) pts.push([te.min, te.si]);
  if (pts.length < 2) return null;
  let best = null;
  for (let k = 0; k + 1 < pts.length; k++) {
    const p = along(b.lat, b.lon, D.stops[pts[k][1]], D.stops[pts[k + 1][1]]);
    if (!best || p.d < best.d) best = { ...p, k };
  }
  if (!best || best.d > 1200) return null;
  const there = pts[best.k][0] + (pts[best.k + 1][0] - pts[best.k][0]) * best.f;
  const nowM = toMin(nowS), delay = Math.round(nowM - there);
  const from = best.f < 0.1 ? best.k : best.k + 1;   // still at the leg's first stop, or short of it: that one's ahead too
  const stops = [], at = new Map(), end = pts.length - 1;
  let first = null, last = null;
  for (let i = from; i < pts.length; i++) {
    const [m, si] = pts[i], sid = D.stops[si].id, time = Math.round(nowS + (m + delay - nowM) * 60);
    stops.push([sid, i, time, 0]);
    if (i === end) continue;
    at.set(sid, { seq: i, time, skipped: false });
    if (!first) first = { sid, seq: i, time };
    last = { sid, seq: i, time };
  }
  return { v: b.id.slice(2), ts: b.ts, at, first, last, lastDelay: delay, ti, stops, end, est: true };
}
/** Whether the feed's word on a bus and the bus's place agree. The feed has it so many minutes late (its next
 *  stop's minute against the timetable's), so it should be about where the timetable had it that many minutes ago:
 *  it's looked for there, four minutes either way, on the legs between its trip's stops (as the crow flies, a
 *  corner cut allowed for), headed along them when it's moving (a street run out and back has its stops in pairs).
 *  There, they agree. On its trip's line somewhere else, they don't: the feed is wrong about it (a Route 2 back on
 *  its line and on time, the feed still waiting at a stop it went round). Off its line altogether (a detour the feed
 *  knows of, its stops skipped), there's nothing to hold against the feed's word, and it stands; so too with no word,
 *  or the bus's place minutes old. */
function agrees(b, u, ti, nowS) {
  if (!u.first || nowS - b.ts > 120) return true;
  const pts = tripStops(ti).slice(), te = tripEnd(ti);
  if (te) pts.push([te.min, te.si]);
  const k0 = pts.findIndex(([, si]) => D.stops[si].id === u.first.sid);
  if (k0 < 0 || pts.length < 2) return true;
  const late = toMin(Math.max(u.first.time, nowS)) - pts[k0][0];
  const T = Math.min(Math.max(toMin(nowS) - late, pts[0][0]), pts[pts.length - 1][0]);
  let elsewhere = false;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ma, sa] = pts[k], [mb, sb] = pts[k + 1];
    const A = D.stops[sa], C = D.stops[sb], p = along(b.lat, b.lon, A, C), len = distance(A.lat, A.lon, C.lat, C.lon);
    if (p.d > Math.max(80, len * 0.35)) continue;
    if (b.speed > 2 && len > 30 && Math.abs(((bearing(A.lat, A.lon, C.lat, C.lon) - b.course) % 360 + 540) % 360 - 180) > 75) continue;
    if (mb >= T - 4 && ma <= T + 4) return true;
    elsewhere = true;
  }
  return !elsewhere;
}
/** A point against the leg between two stops: the distance to the leg in metres, and the fraction along it. */
function along(lat, lon, a, c) {
  const kx = 111000 * Math.cos(lat * Math.PI / 180), ky = 111000;
  const ax = (a.lon - lon) * kx, ay = (a.lat - lat) * ky, dx = (c.lon - lon) * kx - ax, dy = (c.lat - lat) * ky - ay;
  const len2 = dx * dx + dy * dy, f = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return { d: Math.hypot(ax + dx * f, ay + dy * f), f };
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
  // In early, within ten minutes of its timetabled departure, it waits for that minute; earlier than that it's
  // being spaced and may go at any time, and past it it's going now.
  if (here.has(id)) { const wait = t.min - nowM, dep = wait > 0 && wait <= 10 ? t.min : nowM; return { min: dep, delay: dep - t.min, here: true, spacing: true, leaves: dep > nowM }; }
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
  // No word on it yet (within two hours: later, the run before isn't under way): its bus, on the trip before, due in
  // by its start is on time; due in after it, from a Transit Center bay, it leaves when that bus is in, estimated. Late
  // and unannounced, it had been a departure past its minute, and dropped: Route 5's 4:00, its bus 5 min late in.
  if (!u) {
    if (t.min - now().min >= 120) return null;
    const a = runArrives(t);
    if (a === null) return null;
    if (a <= tripStops(t.trip)[0][0] + 1) return KEEPS;   // in within its minute: it leaves on it
    return D.stops[t.si] && D.stops[t.si].hub && !(isLoop(t.r) && loopSpacing(t.r)) ? { min: Math.ceil(a), delay: Math.ceil(a) - t.min, est: true } : null;
  }
  if (u.cancelled) return { gone: true, cancelled: true };   // a run the feed says is cancelled isn't coming (the relay passes it on: c 1)
  const p = feedSays(t, u);
  // From a Transit Center bay, a departure can't leave before the bus that runs it is in: that bus (the trip's own
  // vehicle) may still be finishing the trip before. Every screen reads this one rule.
  if (p && !p.gone && D.stops[t.si].hub && !(isLoop(t.r) && loopSpacing(t.r))) {
    const inAt = inbound(u, D.trips[t.trip]);
    if (inAt !== null && inAt > p.min) return { ...p, min: inAt, delay: inAt - t.min };
  }
  // Past the Transit Center, before the bus has left it: no sooner than leaving it and keeping to the timetable from
  // there. A route leaves no earlier than its minute; a loop ahead waits, up to ten minutes (spacing, it waits for
  // nothing). The feed's time for a stop on the far side then, not the timetable's, is the one that's off: said
  // as an estimate.
  // Early by a whole minute at least, to the second: a trip not yet out is the feed's timetable to the second (6:31:40
  // for 6:32), and that's on time, not early. Held back to its own minute, it's on time: the timetable's, in black.
  const h = u.hub;
  if (p && !p.gone && h && !(isLoop(t.r) && loopSpacing(t.r)) && h.seq.findIndex(([m, si]) => si === t.si && m === t.min) > h.k) {
    const leaves = isLoop(t.r) ? Math.max(h.at, Math.min(h.sched, h.at + 10)) : Math.max(h.at, h.sched), floor = leaves + t.min - h.sched;
    const hit = u.at.get(D.stops[t.si].id), feedAt = hit && !hit.skipped ? toMin(hit.time) + (hit.time % 60) / 60 : p.min;
    if (floor - feedAt >= 1) return floor === t.min ? KEEPS : { ...p, min: floor, delay: floor - t.min, est: true };
  }
  // A run its bus hasn't started yet (still on the one before, or not out), the feed's time for it the timetable's to
  // within the minute: nothing live to say, so the timetable's, in black, not 'Live · On time' a minute early. On time
  // all the same when the bus on the run before is due in by this one's start: that's the bus's word, not the feed's
  // copy of the timetable. Not out, or due in late: the timetable's alone.
  if (p && !p.gone && !p.est && D.stops[t.si]) {
    const hit = u.at.get(D.stops[t.si].id), bus = u.v && rt.buses.find(b => b.id === 'c:' + u.v);
    if (hit && !hit.skipped && !(bus && bus.trip === D.trips[t.trip]) && Math.abs(toMin(hit.time) + (hit.time % 60) / 60 - t.min) < 1) return bus && dueBy(bus, u) ? KEEPS : null;
  }
  return p;
}
/** The timetable's minute, and on time: the bus that runs the trip is at its bay till then (held back to it), or due in
 *  from the run before by the trip's start. Said 'Scheduled · on time'; not a live time, nothing moved. */
const KEEPS = { keeps: true };
/** Whether a bus on another trip gets to that trip's last stop by the start of trip `u` (both the feed's times; the
 *  start, for a trip not yet begun, is the timetable's). */
function dueBy(b, u) {
  const prev = rt.trips[b.trip], at = prev && endAt(b, prev), start = Math.min(...u.stops.map(s => s[2]));
  return at != null && isFinite(start) && at <= start + 30;
}
/** A trip the feed says nothing of yet, whose bus is out on the run's trip before it: when that trip's last stop is
 *  due, in minutes, or null (the first trip of a run has no bus to go by). */
const runs = new Map();   // a trip's run, by day: the timetable's, so worked out once (it was, for every row, every redraw)
function runArrives(t) {
  const ymd = now().ymd, key = ymd + ':' + t.trip;
  if (!runs.has(key)) { if (runs.size > 4000) runs.clear(); runs.set(key, runOf(t.trip, ymd)); }
  const run = runs.get(key), i = run.indexOf(t.trip);
  if (i <= 0) return null;
  const b = rt.buses.find(x => x.trip === D.trips[run[i - 1]]), prev = b && rt.trips[b.trip], first = tripStops(t.trip)[0];
  const at = prev && endAt(b, prev);
  return at != null && first ? toMin(at) + (at % 60) / 60 : null;
}
/** When the bus that runs a trip gets to the Transit Center, if it's still on its way in on the trip before; else null. */
function inbound(u, id) {
  if (!u.v) return null;
  // A bus of its route standing at the Center (a swap, put in so it leaves on time): it doesn't wait for this one.
  const ti = tripIdx.get(id);
  if (ti !== undefined && tripInfo[ti] && standingAt(tripInfo[ti].r)) return null;
  const b = rt.buses.find(x => x.id === 'c:' + u.v);
  if (!b || b.trip === id) return null;
  const prev = rt.trips[b.trip];
  if (!prev) return null;
  const end = prev.stops.find(s => s[1] === prev.end), at = endAt(b, prev);
  if (!end || !D.stops[D.stopById[end[0]]]?.hub || at === null || at < Date.now() / 1000 - 60) return null;
  return toMin(at);
}
/** Whether the feed has lost a bus's trip: not a stop of it served, and its timetable over. The feed then times the
 *  whole trip again from now: a Route 5 bus 116 m from the Center, in for its 8:00, was 'back at 8:22' (2026-09-30),
 *  its 7:30 trip done but never marked off. The bus's place is the word then, not the feed's. */
function lost(b, u) {
  if (!u.stops.length || u.stops[0][1] > 1) return false;
  const ts = tripStops(D.trips.indexOf(b.trip));
  return ts.length > 0 && toMin(Date.now() / 1000) > ts[ts.length - 1][0] + 2;
}
/** When a bus gets to its trip's last stop, in seconds: the feed's time; where the feed has lost the trip, from where
 *  the bus is (there, within 150 m; else the way at a town bus's pace, 6 m/s, a road 1.4 times the straight line). */
export function endAt(b, u) {
  const end = u.stops.find(s => s[1] === u.end);
  if (!lost(b, u)) return end ? end[2] : null;
  const last = end ? D.stops[D.stopById[end[0]]] : null;
  if (!last) return null;
  const d = distance(b.lat, b.lon, last.lat, last.lon);
  return Date.now() / 1000 + (d < 150 ? 0 : d * 1.4 / 6);
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
  if (hit && !hit.skipped && D.stops[t.si].hub && hit.time < nowS - 30 && nowS - hit.time < cap) {
    // Still there by the bus itself, where the feed names one: its position within the bay (110 m, as below). A bus
    // on this trip a long way off has gone, whatever the listing says; a listing with no bus to check it against is
    // trusted only while the trip's word is fresh (three minutes). A feed whose trip updates froze while its positions
    // flowed had every bay of a pulse 'leaving now', the whole board late by however long the freeze.
    const bus = u.v && rt.buses.find(b => b.id === 'c:' + u.v), st = D.stops[t.si];
    const there = bus && bus.trip === D.trips[t.trip] ? distance(bus.lat, bus.lon, st.lat, st.lon) < 110 : !(rt.t - u.ts > 180);   // no timestamp on the trip: trusted, as before
    return there ? held(t, toMin(Math.floor(nowS)) - t.min) : { gone: true };
  }
  if (hit) return hit.skipped ? { gone: true } : u.est ? { ...held(t, toMin(hit.time) - t.min), est: true } : held(t, toMin(hit.time) - t.min);
  const order = (D.routes[t.r].stops || {})[String(t.dir)] || [];
  const i = order.indexOf(t.si);
  if (i < 0) return null;
  const f = u.first ? order.indexOf(D.stopById[u.first.sid]) : -1, l = u.last ? order.indexOf(D.stopById[u.last.sid]) : -1;
  // Its next stop past the middle of the trip: the bus is on its way back, not leaving. A route's trip ends where it
  // began, at the Center, and a bus in at the end of its 8:30 was 'still at its bay', the 8:30 leaving now, 21 min
  // late, until it took up its next trip: only on a fresh start, before `left` had seen it pull out.
  const homeward = f > (order.length - 1) / 2;
  // Pulling out of a Transit Center bay, the bus drops the bay from its predictions at once. Rather than vanish, the
  // row says now for a minute after it goes; and a bus, which never leaves a bay early, holds its scheduled minute
  // till that's out too. A loop spacing its buses just goes: the next one is what matters.
  if (f >= 0 && i < f) {
    if (!D.stops[t.si].hub || (isLoop(t.r) && loopSpacing(t.r))) return { gone: true };
    const ms = left.get(D.trips[t.trip] + ':' + sid);
    if (ms && Date.now() - ms < LEFT_GRACE) return held(t, toMin(Math.floor(Date.now() / 1000)) - t.min);
    // Its bus still at the bay, though the feed has it gone (its time passed, the bay dropped): it hasn't left, and a
    // late bus leaves when it's ready. Now, until it pulls out. A Blue Loop 12:53, in at 1:00 (2026-09-30), was
    // dropped with its bus sitting there, and the bay's badge showed the 1:11's bus, 12 min out.
    const bus = u.v && rt.buses.find(b => b.id === 'c:' + u.v), st = D.stops[t.si];
    if (!homeward && bus && bus.trip === D.trips[t.trip] && distance(bus.lat, bus.lon, st.lat, st.lon) < 110) return held(t, toMin(Math.floor(Date.now() / 1000)) - t.min);
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
setLive(t => { const p = predict(t); if (!p) return t; return p.keeps ? (isLoop(t.r) ? t : { ...t, onTime: true }) : p.gone ? { ...t, gone: true, cancelled: !!p.cancelled } : { ...t, min: p.min, live: p }; });
/** Today's departures from a stop the feed says are cancelled, from now to `within` minutes on (`ok`: which to look
 *  at, by route): kept in a list, struck, so a rider waiting for one sees it isn't coming rather than a gap. */
export function cancelledAt(si, clockNow = now(), within = 60, ok = null) {
  if (rtStale() || !D.trips) return [];
  return timesOn(si, clockNow.ymd).filter(t => t.min >= clockNow.min && t.min - clockNow.min <= within && (!ok || ok(t)) && t.trip !== undefined && rt.trips[D.trips[t.trip]]?.cancelled)
    .map(t => ({ ...t, day: 0, ymd: clockNow.ymd, cancelled: true }));
}

/** How late a bus is now: the feed's minute at the stop it calls at next against the timetable's. The number every
 *  screen agrees on: the feed's word at its trip's last stop (`lastDelay`) is its guess at the rest of the run, and
 *  can be six minutes more. Null without a word. */
export function busDelay(b) {
  const u = rt.trips[b.trip], ti = tripIdx && tripIdx.get(b.trip), si = nextStopOf(b);
  if (!u || ti === undefined || ti === null || si === undefined) return null;
  const hit = u.at.get(D.stops[si].id);
  if (!hit || hit.skipped) return null;
  const sm = schedMin(si, ti);
  return sm === null ? null : toMin(hit.time) - sm;
}
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
  const h = u.hub && !(isLoop(b.ri) && loopSpacing(b.ri)) ? u.hub : null, sched = h && tripInfo[u.ti] ? h.seq : null;
  // At the Transit Center it hasn't left yet, and past it, no sooner than it leaves there and keeps to the timetable
  // (predict()): its bay too, so its card says what the bay's row says, never 'now' for a bus in early.
  const held = (si, min) => {
    const k = sched ? sched.findIndex(([, x], i) => x === si && i >= h.k) : -1;
    if (k < 0) return min;
    const leaves = isLoop(b.ri) ? Math.max(h.at, Math.min(h.sched, h.at + 10)) : Math.max(h.at, h.sched);
    return Math.max(min, leaves + sched[k][0] - h.sched);
  };
  return u.stops.filter(([, , , rel]) => rel !== 1)
    .map(([sid, seq, time]) => ({ si: D.stopById[sid], seq, min: held(D.stopById[sid], toMin(time)), time, end: seq === u.end }))
    .filter(x => x.si !== undefined && x.time >= rt.t - 30).sort((a, b) => a.seq - b.seq).slice(0, n);
}
/** The stop a bus calls at next, from its trip's predictions; undefined when the feed doesn't say. */
export function nextStopOf(b) {
  const u = rt.trips[b.trip], nowS = Date.now() / 1000;
  let next = null;
  if (u) for (const [sid, x] of u.at) if (!x.skipped && x.time >= nowS - 60 && (!next || x.seq < next.seq)) next = { sid, ...x };
  return next ? D.stopById[next.sid] : undefined;
}
/** The bus running a trip right now, if the feed has one, and the stop it calls at next. */
export function busOn(ti) {
  if (rtStale() || !D.trips) return null;
  const id = D.trips[ti], b = rt.buses.find(x => x.trip === id);
  if (!b) return null;
  const u = rt.trips[id], nowS = Date.now() / 1000;
  let next = null;
  if (u) for (const [sid, x] of u.at) if (!x.skipped && x.time >= nowS - 60 && (!next || x.seq < next.seq)) next = { sid, ...x };
  return { bus: b, next: next ? D.stopById[next.sid] : undefined };
}
/** A bus of a route stopped in the Transit Center, set to go out on it: the one that leaves next, whatever bus the
 *  feed names (a swap bus is put in, parked at the bay, while the late one finishes its run). Only on a trip out from
 *  the Center that's due about now, not one it has just come in on: a bus in on its 2 goes out as a 5 (they swap all
 *  day, and 3 and 8), and one in on its last run is done. */
export const HUB_IN = 65, HUB_STILL = 3;   // metres from the hall (its bays within 51 m); metres a second
export function standingAt(ri) {
  if (!D.hub || !tripIdx) return null;
  const nowMin = toMin(Date.now() / 1000);
  return rt.buses.find(b => {
    if (b.ri !== ri || distance(b.lat, b.lon, D.hub.lat, D.hub.lon) > HUB_IN || b.speed > HUB_STILL) return false;
    const ti = tripIdx.get(b.trip), first = ti !== undefined ? tripStops(ti)[0] : null;
    return !!first && !!D.stops[first[1]]?.hub && first[0] >= nowMin - 15;
  }) || null;
}
export function findBus(id) { return rt.buses.find(b => b.id === id) || rt.parked.find(b => b.id === id); }
/** A trip's index in the timetable, by the feed's id. */
export function tripOf(id) { index(); return tripIdx ? tripIdx.get(id) : undefined; }
