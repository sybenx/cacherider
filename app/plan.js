// Getting from here to there by bus: which bus, where to change, where to get off. Worked out on the phone from
// the timetable, the feed's estimates where it has them, and nothing else: the valley is small (every route meets
// at the Transit Center), so a ride and one change cover nearly every journey, and the whole search is a few
// thousand lookups. The Aggie Shuttle joins in while it runs: no timetable, its buses' own estimates instead.
import { D, stop, timesOn, tripStops, tripEnd, nextTrip, distance, nearest, servicesOn } from './data.js';
import { lively, isLoop } from './ui.js';
import { dayFrom } from './time.js';

const PACE = 75;          // metres a minute on foot, crossings and all
const WALK_TO = 1000;     // how far a rider is sent on foot to a first stop
const WALK_FROM = 350;    // a stop this near the one asked for is as good, with the walk said
const CHANGE = 1;         // minutes from one bus to the next at the same stop (the Transit Center's hold for each other)
const AHEAD = 150;        // minutes of departures looked at from each first stop
const MAX_ON = 8;         // buses tried from a first stop, and from a change stop
const CHANGE_WALK = 250;  // a change can be to a stop this near: the Transit Center's other bays, the stop across the road
const walkMins = d => Math.max(1, Math.ceil(d / PACE));

// ---- the Aggie Shuttle. `SH`, for the search under way, is what usu.js's planNet() gives while the shuttle runs:
// { stops: [{ lat, lon }], loops: [{ ri, stops }], waits(si, ri) → each bus's { min, secs } to a stop, ride(ri, a, b)
// → seconds on from one stop to another, added to a bus's `secs` at the first }; null when it isn't running, and the
// search is Connect's alone. A shuttle stop is a node 'u<index>' beside Connect's stop indices; a shuttle departure
// is { u: true, r: loop, si: node, min, secs }, with no trip: its ride is the loop's stops from there round, each at
// that bus's own time (so one bus gets to a stop at one time, whichever stop it's boarded at).
let SH = null, SERVED = new Set();
const isU = x => typeof x === 'string', uOf = x => +x.slice(1);
const pt = x => isU(x) ? SH.stops[uOf(x)] : stop(x);
const apartOf = (a, b) => { const p = pt(a), q = pt(b); return Math.round(distance(p.lat, p.lon, q.lat, q.lon)); };
/** The shuttle stops within `max` metres of a point, nearest first, as { x, d }: only those a running loop serves. */
function nearU(lat, lon, max) {
  if (!SH) return [];
  const out = [];
  for (const i of SERVED) { const s = SH.stops[i], d = distance(lat, lon, s.lat, s.lon); if (d <= max) out.push({ x: 'u' + i, d }); }
  return out.sort((a, b) => a.d - b.d);
}

/** The stops a change can be made at from one: itself, and any within a short walk, each with the walk in minutes:
 *  Connect's, and the shuttle's while it runs. */
const nears = new Map();
function connectNear(si) {
  let n = nears.get(si);
  if (!n) {
    const s = stop(si);
    n = [{ si, walk: 0 }, ...nearest(s.lat, s.lon, 16).filter(x => x.i !== si && x.d <= CHANGE_WALK).map(x => ({ si: x.i, walk: walkMins(x.d) }))];
    nears.set(si, n);
  }
  return n;
}
function nearOf(x) {
  const p = pt(x);
  const base = isU(x) ? [{ si: x, walk: 0 }, ...nearest(p.lat, p.lon, 16).filter(y => y.d <= CHANGE_WALK).map(y => ({ si: y.i, walk: walkMins(y.d) }))] : connectNear(x);
  return SH ? [...base, ...nearU(p.lat, p.lon, CHANGE_WALK).filter(y => y.x !== x).map(y => ({ si: y.x, walk: walkMins(y.d) }))] : base;
}

/** A trip's stops in order with the minute at each, its last stop (drop-off only, which the departures leave out) included. */
const seqs = new Map();
function seqOf(ti) {
  let s = seqs.get(ti);
  if (!s) {
    const st = tripStops(ti), te = tripEnd(ti);
    s = te && st.length && te.si !== st[st.length - 1][1] ? [...st, [te.min, te.si]] : st;
    seqs.set(ti, s);
  }
  return s;
}
/** The ride from a trip on: its stops, then the same bus's next trip's (the timetable cuts a route's runs at the far
 *  end, so the way back to the Transit Center is the trip after), while the bus goes straight on. A rider stays
 *  in their seat through the seam. */
const runs = new Map();
function runOf(ti, ymd) {
  const k = ti + '|' + ymd;
  let seq = runs.get(k);
  if (seq) return seq;
  seq = seqOf(ti);
  let cur = ti;
  for (let hop = 0; hop < 2; hop++) {
    const n = nextTrip(cur, ymd);
    if (n === undefined) break;
    const ns = seqOf(n), last = seq[seq.length - 1];
    if (!ns.length || !last || ns[0][0] - last[0] > 45) break;   // a bus that sits a while is done for now
    seq = seq.concat(ns[0][1] === last[1] ? ns.slice(1) : ns);
    cur = n;
  }
  runs.set(k, seq);
  return seq;
}

/** Departures from a stop on a day from a minute on: the feed's word on today's (a late bus is still coming; one
 *  that has been is not). Cached for the search, which asks about the same change stops again and again. */
function deps(si, ymd, from, live, cache) {
  // A shuttle stop: every loop that calls there, each bus's estimate a departure. Today's only: tomorrow has no buses yet.
  if (isU(si)) {
    if (!SH || !live) return [];
    const out = [];
    for (const l of SH.loops) if (l.stops.includes(uOf(si))) for (const w of SH.waits(uOf(si), l.ri)) if (SH.now + w.min >= from) out.push({ u: true, r: l.ri, si, min: SH.now + w.min, secs: w.secs });
    return out.sort((a, b) => a.min - b.min).slice(0, MAX_ON);
  }
  const k = si + '|' + ymd;
  let rows = cache.get(k);
  if (!rows) {
    rows = timesOn(si, ymd);
    if (live) rows = rows.map(t => lively({ ...t, day: 0, ymd })).filter(t => !t.gone).sort((a, b) => a.min - b.min);
    cache.set(k, rows);
  }
  const out = [];
  let first = null;   // the window of departures looked at starts at the first one, not at the minute asked (a day's first bus can be hours off)
  for (const t of rows) { if (t.min < from) continue; if (first === null) first = t.min; if (t.min > first + AHEAD || out.length >= MAX_ON) break; out.push(t); }
  return out;
}

/** A departure's ride as [its stops with their minutes, where it boards in them], or null: a Connect bus's run, or a
 *  shuttle's loop from the stop once round. */
function rideOf(t, ymd) {
  if (t.u) {
    const l = SH.loops.find(x => x.ri === t.r), a = uOf(t.si), k = l.stops.indexOf(a), n = l.stops.length;
    const seq = [[t.min, t.si]];
    for (let j = 1; j < n; j++) { const b = l.stops[(k + j) % n]; if (b !== a) seq.push([Math.max(t.min + 1, SH.now + Math.round((t.secs + SH.ride(t.r, a, b)) / 60)), 'u' + b]); }
    return [seq, 0];
  }
  if (t.trip === undefined) return null;
  const seq = runOf(t.trip, ymd), i = boardAt(t, seq);
  return i < 0 ? null : [seq, i];
}
/** The same ride twice over: one route (or one shuttle loop) again is no change worth making. */
const sameRide = (a, b) => !!a.u === !!b.u && a.r === b.r;

/** Where a departure's bus is in its trip's list of stops: its own stop at its own minute, else the first time it calls there. */
function boardAt(t, seq) {
  const sched = t.live ? t.min - t.live.delay : t.min;
  let i = seq.findIndex(([m, s]) => s === t.si && m === sched);
  if (i < 0) i = seq.findIndex(([, s]) => s === t.si);
  return i;
}

/** The lateness a ride carries past where it's boarded: the feed's, as it is for a route. A loop's only when late
 *  (it doesn't catch up): one ahead holds, up to ten minutes, to its timetable, and one spacing its buses keeps no
 *  timetable to be ahead of, so its minutes on stay the timetable's, the safe side of a guess. */
const carried = t => !t.live ? 0 : isLoop(t.r) ? Math.max(0, t.live.delay) : t.live.delay;

/** The ride from a departure to the first of the stops wanted that its trip reaches, or null. Minutes carry the
 *  feed's delay for the whole ride: a bus late leaving is late all the way, and never off before it's on. To a spot
 *  (`best`), whose stops spread a walk wide, the stop it gets there soonest from, walk and all, however many stops on. */
function rideTo(t, seq, i, wanted, best = false) {
  const delay = carried(t);
  let got = null;
  for (let k = i + 1; k < seq.length; k++) {
    const [m, s] = seq[k];
    if (!wanted.has(s)) continue;
    const ride = { kind: 'ride', t, from: t.si, to: s, on: t.min, off: Math.max(t.min, m + delay), n: k - i, ti: t.trip, r: t.r, u: !!t.u };
    if (!best) return ride;
    if (!got || ride.off + wanted.get(s) < got.off + wanted.get(got.to)) got = ride;
  }
  return got;
}

/**
 * Journeys to a stop or a spot: `origin` is { si } for a stop or { lat, lon } for where the rider is; `dest` a stop
 * index, or { lat, lon, label } for a spot (its stops the ones within a walk of it, as a start's are). `sh`: the
 * shuttle while it runs (usu.js's planNet()), its stops then starts, changes and ends like Connect's, today only.
 * Each journey is { day, ymd, leave, arrive, legs }, legs of kind walk / ride, in order; `leave` is when to set
 * off (before any first walk), `arrive` when the rider is at the stop asked for. The best few, sorted by arrival:
 * none is kept that leaves earlier and arrives later than another. Nothing today: the first day with a way.
 */
export function journeys(origin, dest, clockNow, days = 8, sh = null) {
  SH = sh; SERVED = new Set(sh ? sh.loops.flatMap(l => l.stops) : []);
  if (SH) SH.now = clockNow.min;
  const spot = typeof dest === 'object', d = spot ? dest : stop(dest);
  // The stops that count as arriving: the one asked for, and any a short walk from it (across the road, the
  // Transit Center's other bays), with the walk they cost. To a spot: the stops within a walk of it.
  const wanted = new Map(spot ? [] : [[dest, 0]]);
  if (spot) for (const { i, d: dd } of nearest(d.lat, d.lon, 24).filter(x => x.d <= WALK_TO).slice(0, 8)) wanted.set(i, walkMins(dd));
  else for (const { i, d: dd } of nearest(d.lat, d.lon, 12)) if (i !== dest && dd <= WALK_FROM) wanted.set(i, walkMins(dd));
  for (const { x, d: dd } of nearU(d.lat, d.lon, spot ? WALK_TO : WALK_FROM).slice(0, 6)) wanted.set(x, walkMins(dd));
  // Where to start: the stop named, or the stops within a walk of the rider, nearest first, each with its walk.
  // From a stop, the stop across the road and the other bays count too, with the walk: the way there may start
  // from the other side.
  const starts = origin.si !== undefined ? nearOf(origin.si).map(x => ({ si: x.si, walk: x.walk, d: x.walk ? apartOf(origin.si, x.si) : 0 }))
    : nearest(origin.lat, origin.lon, 24).filter(x => x.d <= WALK_TO).slice(0, 8).map(x => ({ si: x.i, walk: walkMins(x.d), d: x.d }));
  if (origin.si === undefined) for (const { x, d: dd } of nearU(origin.lat, origin.lon, WALK_TO).slice(0, 6)) starts.push({ si: x, walk: walkMins(dd), d: Math.round(dd) });   // from a stop, nearOf has them
  // Standing at the stop wanted, or within its walk: no bus to catch.
  const o = origin.si !== undefined ? stop(origin.si) : origin, apart = Math.round(distance(o.lat, o.lon, d.lat, d.lon));
  const there = origin.si !== undefined && !spot ? wanted.has(origin.si) : apart <= WALK_FROM;
  if (there) return { walk: apart, plans: [] };
  for (let day = 0; day < days; day++) {
    const ymd = dayFrom(clockNow.ymd, day).ymd;
    if (!servicesOn(ymd).size) continue;
    const plans = search(starts, wanted, spot ? d : dest, ymd, day === 0 ? clockNow.min : 0, day === 0, day);
    if (plans.length) return { plans };
  }
  // A spot within a walk with no bus to it worth taking: the walk.
  if (spot && apart <= WALK_TO) return { walk: apart, plans: [] };
  return { plans: [] };
}

function search(starts, wanted, dest, ymd, min0, live, day) {
  const cache = new Map(), spot = typeof dest === 'object', end = spot ? dest : stop(dest);
  const found = [];
  const done = (legs, walk0, walkEnd) => {
    const first = legs[0], last = legs[legs.length - 1], rides = legs.filter(l => l.kind === 'ride').length;
    const leave = first.on - walk0.walk, arrive = last.off + wanted.get(last.to);
    const all = [];
    if (walk0.d) all.push({ kind: 'walk', d: walk0.d, mins: walk0.walk, to: first.from });
    all.push(...legs);
    if (spot || last.to !== dest) all.push({ kind: 'walk', d: Math.round(distance(pt(last.to).lat, pt(last.to).lon, end.lat, end.lon)), mins: wanted.get(last.to), from: last.to, to: spot ? undefined : dest, label: spot ? end.label : undefined });
    found.push({ day, ymd, leave, arrive, legs: all, changes: rides - 1 });
  };
  for (const st of starts) {
    if (wanted.has(st.si)) continue;   // a first stop that is the destination's own is a walk, said elsewhere
    for (const t of deps(st.si, ymd, min0 + st.walk, live, cache)) {
      const got = rideOf(t, ymd);
      if (!got) continue;
      const [seq, i] = got;
      const direct = rideTo(t, seq, i, wanted, spot);
      if (direct) { done([direct], st); continue; }   // a bus straight there: no change from it is worth a look
      // One change: off at any later stop, on to another route's next buses from there.
      const delay = carried(t);
      const seen = new Set();
      for (let k = i + 1; k < seq.length; k++) {
        const [m, x] = seq[k];
        if (seen.has(x)) break;   // a loop back round: nothing new after
        seen.add(x);
        const off = Math.max(t.min, m + delay);
        // On to the next bus from this stop, or one a short walk away: the Transit Center's bays are stops of their own.
        for (const y of nearOf(x)) {
          let took = false;
          for (const t2 of deps(y.si, ymd, off + y.walk + CHANGE, live, cache)) {
            if (sameRide(t, t2)) continue;   // the same route again is the same ride
            const got2 = rideOf(t2, ymd);
            if (!got2) continue;
            const ride2 = rideTo(t2, got2[0], got2[1], wanted, spot);
            if (!ride2) continue;
            const legs = [{ kind: 'ride', t, from: t.si, to: x, on: t.min, off, n: k - i, ti: t.trip, r: t.r, u: !!t.u }];
            if (y.walk) legs.push({ kind: 'walk', d: apartOf(x, y.si), mins: y.walk, from: x, to: y.si });
            legs.push(ride2);
            done(legs, st); took = true; break;   // the first bus on from here that goes there
          }
          if (took) break;
        }
      }
    }
  }
  // Only journeys no other beats on both counts: leaving later and arriving sooner, or as soon with fewer changes.
  found.sort((a, b) => b.leave - a.leave || a.arrive - b.arrive || a.changes - b.changes);
  const kept = [];
  let best = Infinity, bestChanges = Infinity;
  for (const p of found) {
    if (p.arrive < best || (p.arrive === best && p.changes < bestChanges)) { kept.push(p); best = p.arrive; bestChanges = Math.min(bestChanges, p.changes); }
  }
  kept.sort((a, b) => a.arrive - b.arrive || a.changes - b.changes);
  return kept.slice(0, 4);
}
