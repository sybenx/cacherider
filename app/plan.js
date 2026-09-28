// Getting from here to there by bus: which bus, where to change, where to get off. Worked out on the phone from
// the timetable, the feed's estimates where it has them, and nothing else: the valley is small (every route meets
// at the Transit Center), so a ride and one change cover nearly every journey, and the whole search is a few
// thousand lookups.
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

/** The stops a change can be made at from one: itself, and any within a short walk, each with the walk in minutes. */
const nears = new Map();
function nearOf(si) {
  let n = nears.get(si);
  if (!n) {
    const s = stop(si);
    n = [{ si, walk: 0 }, ...nearest(s.lat, s.lon, 16).filter(x => x.i !== si && x.d <= CHANGE_WALK).map(x => ({ si: x.i, walk: walkMins(x.d) }))];
    nears.set(si, n);
  }
  return n;
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

/** Where a departure's bus is in its trip's list of stops: its own stop at its own minute, else the first time it calls there. */
function boardAt(t, seq) {
  const sched = t.live ? t.min - t.live.delay : t.min;
  let i = seq.findIndex(([m, s]) => s === t.si && m === sched);
  if (i < 0) i = seq.findIndex(([, s]) => s === t.si);
  return i;
}

/** The ride from a departure to the first of the stops wanted that its trip reaches, or null. Minutes carry the
 *  feed's delay for the whole ride: a bus late leaving is late all the way. */
function rideTo(t, seq, i, wanted) {
  const delay = t.live && !isLoop(t.r) ? t.live.delay : 0;
  for (let k = i + 1; k < seq.length; k++) {
    const [m, s] = seq[k];
    if (wanted.has(s)) return { kind: 'ride', t, from: t.si, to: s, on: t.min, off: m + delay, n: k - i, ti: t.trip, r: t.r };
  }
  return null;
}

/**
 * Journeys to a stop: `origin` is { si } for a stop or { lat, lon } for where the rider is; `dest` a stop index.
 * Each journey is { day, ymd, leave, arrive, legs }, legs of kind walk / ride, in order; `leave` is when to set
 * off (before any first walk), `arrive` when the rider is at the stop asked for. The best few, sorted by arrival:
 * none is kept that leaves earlier and arrives later than another. Nothing today: the first day with a way.
 */
export function journeys(origin, dest, clockNow, days = 8) {
  const d = stop(dest);
  // The stops that count as arriving: the one asked for, and any a short walk from it (across the road, the
  // Transit Center's other bays), with the walk they cost.
  const wanted = new Map([[dest, 0]]);
  for (const { i, d: dd } of nearest(d.lat, d.lon, 12)) if (i !== dest && dd <= WALK_FROM) wanted.set(i, walkMins(dd));
  // Where to start: the stop named, or the stops within a walk of the rider, nearest first, each with its walk.
  // From a stop, the stop across the road and the other bays count too, with the walk: the way there may start
  // from the other side.
  const starts = origin.si !== undefined ? nearOf(origin.si).map(x => ({ si: x.si, walk: x.walk, d: x.walk ? Math.round(distance(stop(origin.si).lat, stop(origin.si).lon, stop(x.si).lat, stop(x.si).lon)) : 0 }))
    : nearest(origin.lat, origin.lon, 24).filter(x => x.d <= WALK_TO).slice(0, 8).map(x => ({ si: x.i, walk: walkMins(x.d), d: x.d }));
  // Standing at the stop wanted, or within its walk: no bus to catch.
  const there = origin.si !== undefined ? wanted.has(origin.si) : distance(origin.lat, origin.lon, d.lat, d.lon) <= WALK_FROM;
  if (there) return { walk: Math.round(distance(origin.si !== undefined ? stop(origin.si).lat : origin.lat, origin.si !== undefined ? stop(origin.si).lon : origin.lon, d.lat, d.lon)), plans: [] };
  for (let day = 0; day < days; day++) {
    const ymd = dayFrom(clockNow.ymd, day).ymd;
    if (!servicesOn(ymd).size) continue;
    const plans = search(starts, wanted, dest, ymd, day === 0 ? clockNow.min : 0, day === 0, day);
    if (plans.length) return { plans };
  }
  return { plans: [] };
}

function search(starts, wanted, dest, ymd, min0, live, day) {
  const cache = new Map();
  const found = [];
  const done = (legs, walk0, walkEnd) => {
    const first = legs[0], last = legs[legs.length - 1], rides = legs.filter(l => l.kind === 'ride').length;
    const leave = first.on - walk0.walk, arrive = last.off + wanted.get(last.to);
    const all = [];
    if (walk0.d) all.push({ kind: 'walk', d: walk0.d, mins: walk0.walk, to: first.from });
    all.push(...legs);
    if (last.to !== dest) all.push({ kind: 'walk', d: Math.round(distance(stop(last.to).lat, stop(last.to).lon, stop(dest).lat, stop(dest).lon)), mins: wanted.get(last.to), from: last.to, to: dest });
    found.push({ day, ymd, leave, arrive, legs: all, changes: rides - 1 });
  };
  for (const st of starts) {
    if (wanted.has(st.si)) continue;   // a first stop that is the destination's own is a walk, said elsewhere
    for (const t of deps(st.si, ymd, min0 + st.walk, live, cache)) {
      if (t.trip === undefined) continue;
      const seq = runOf(t.trip, ymd), i = boardAt(t, seq);
      if (i < 0) continue;
      const direct = rideTo(t, seq, i, wanted);
      if (direct) { done([direct], st); continue; }   // a bus straight there: no change from it is worth a look
      // One change: off at any later stop, on to another route's next buses from there.
      const delay = t.live && !isLoop(t.r) ? t.live.delay : 0;
      const seen = new Set();
      for (let k = i + 1; k < seq.length; k++) {
        const [m, x] = seq[k];
        if (seen.has(x)) break;   // a loop back round: nothing new after
        seen.add(x);
        const off = m + delay;
        // On to the next bus from this stop, or one a short walk away: the Transit Center's bays are stops of their own.
        for (const y of nearOf(x)) {
          let took = false;
          for (const t2 of deps(y.si, ymd, off + y.walk + CHANGE, live, cache)) {
            if (t2.trip === undefined || t2.r === t.r) continue;   // the same route again is the same ride
            const seq2 = runOf(t2.trip, ymd), j = boardAt(t2, seq2);
            if (j < 0) continue;
            const ride2 = rideTo(t2, seq2, j, wanted);
            if (!ride2) continue;
            const legs = [{ kind: 'ride', t, from: t.si, to: x, on: t.min, off, n: k - i, ti: t.trip, r: t.r }];
            if (y.walk) legs.push({ kind: 'walk', d: Math.round(distance(stop(x).lat, stop(x).lon, stop(y.si).lat, stop(y.si).lon)), mins: y.walk, from: x, to: y.si });
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
