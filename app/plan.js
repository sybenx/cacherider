// Getting from here to there by bus: which bus, where to change, where to get off. Worked out on the phone from
// the timetable, the feed's estimates where it has them, and nothing else: the valley is small (every route meets
// at the Transit Center), so a ride and one change cover nearly every journey, and the whole search is a few
// thousand lookups. The Aggie Shuttle joins in while it runs: no timetable, its buses' own estimates instead.
import { stop, timesOn, tripStops, tripEnd, nextTrip, distance, nearest, servicesOn } from './data.js';
import { lively, isLoop } from './ui.js';
import { dayFrom } from './time.js';
import { walkMins } from './geo.js';

const WALK_TO = 1000;     // how far a rider is sent on foot to a first stop
const WALK_FROM = 350;    // a stop this near the one asked for is as good, with the walk said
const CHANGE = 1;         // minutes from one bus to the next at the same stop (the Transit Center's hold for each other)
const AHEAD = 150;        // minutes of departures looked at from each first stop
const MAX_ON = 8;         // buses tried from a first stop, and from a change stop
const CHANGE_WALK = 250;  // a change can be to a stop this near: the Transit Center's other bays, the stop across the road
const WALK_LESS = 3;      // minutes on foot a way must spare to be kept for walking less: a minute or two is no reason to ride round a loop
// Every walk is timed by geo.js's walkMins: distance at a walking pace, and the climb (a minute for each 10 m up,
// Naismith's rule), from where the rider is to where they're going, so up the bench costs what down it doesn't.
const walkTo = (a, b, d) => walkMins(a.lat, a.lon, b.lat, b.lon, d);

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
    n = [{ si, walk: 0 }, ...nearest(s.lat, s.lon, 16).filter(x => x.i !== si && x.d <= CHANGE_WALK).map(x => ({ si: x.i, walk: walkTo(s, stop(x.i), x.d) }))];
    nears.set(si, n);
  }
  return n;
}
function nearOf(x) {
  const p = pt(x);
  const base = isU(x) ? [{ si: x, walk: 0 }, ...nearest(p.lat, p.lon, 16).filter(y => y.d <= CHANGE_WALK).map(y => ({ si: y.i, walk: walkTo(p, stop(y.i), y.d) }))] : connectNear(x);
  return SH ? [...base, ...nearU(p.lat, p.lon, CHANGE_WALK).filter(y => y.x !== x).map(y => ({ si: y.x, walk: walkTo(p, pt(y.x), y.d) }))] : base;
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
function deps(si, ymd, from, live, cache, until = null) {
  // A shuttle stop: every loop that calls there, each bus's estimate a departure. Today's only: tomorrow has no buses yet.
  if (isU(si)) {
    if (SH && SH.every) {
      // A time picked: every five minutes the loop runs through, the ride (rideOf) counting a whole lap's wait first.
      const out = [];
      for (const l of SH.loops) if (l.stops.includes(uOf(si))) {
        const lap = SH.lap(l.ri), ok = m => SH.runs(l.ri, ymd, m) && SH.runs(l.ri, ymd, m + lap);
        if (until === null) { for (let m = from, n = 0; n < MAX_ON && m < from + AHEAD; m += 5) if (ok(m)) { out.push({ u: true, every: lap, r: l.ri, si, min: m, secs: 0 }); n++; } }
        else for (let m = until, n = 0; n < MAX_ON && m >= from; m -= 5) if (ok(m)) { out.push({ u: true, every: lap, r: l.ri, si, min: m, secs: 0 }); n++; }
      }
      out.sort((a, b) => a.min - b.min);
      return until === null ? out.slice(0, MAX_ON) : out.slice(-MAX_ON);
    }
    if (!SH || !live) return [];
    const out = [];
    for (const l of SH.loops) if (l.stops.includes(uOf(si))) for (const w of SH.waits(uOf(si), l.ri)) if (SH.now + w.min >= from && (until === null || SH.now + w.min <= until)) out.push({ u: true, r: l.ri, si, min: SH.now + w.min, secs: w.secs });
    out.sort((a, b) => a.min - b.min);
    return until === null ? out.slice(0, MAX_ON) : out.slice(-MAX_ON);
  }
  const k = si + '|' + ymd;
  let rows = cache.get(k);
  if (!rows) {
    rows = timesOn(si, ymd);
    if (live) rows = rows.map(t => lively({ ...t, day: 0, ymd })).filter(t => !t.gone).sort((a, b) => a.min - b.min);
    cache.set(k, rows);
  }
  // To arrive by a time: the last few leaving before it, not the first few after a minute.
  if (until !== null) return rows.filter(t => t.min >= from && t.min <= until).slice(-MAX_ON);
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
    for (let j = 1; j < n; j++) { const b = l.stops[(k + j) % n]; if (b !== a) seq.push([t.every ? t.min + t.every + Math.round(SH.ride(t.r, a, b) / 60) : Math.max(t.min + 1, SH.now + Math.round((t.secs + SH.ride(t.r, a, b)) / 60)), 'u' + b]); }
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

/** The ride from a departure to the stop wanted that gets the rider there soonest, walk and all, however many stops
 *  on (`best`; else the first reached), or null. Minutes carry the feed's delay for the whole ride: a bus late leaving
 *  is late all the way, and never off before it's on. */
function rideTo(t, seq, i, wanted, best = false) {
  const delay = carried(t);
  let got = null;
  for (let k = i + 1; k < seq.length; k++) {
    const [m, s] = seq[k];
    if (!wanted.has(s)) continue;
    const ride = { kind: 'ride', t, from: t.si, to: s, on: t.min, off: Math.max(t.min, m + delay), n: k - i, ti: t.trip, r: t.r, u: !!t.u, stops: seq.slice(i, k + 1).map(x => x[1]) };
    if (!best) return ride;
    if (!got || ride.off + wanted.get(s) < got.off + wanted.get(got.to)) got = ride;
  }
  return got;
}

/**
 * Journeys to a stop or a spot: `origin` is { si } for a stop or { lat, lon } for where the rider is; `dest` a stop
 * index, or { lat, lon, label } for a spot. Either end is a place: the stops within a walk of it count, a stop's own
 * at no walk. `sh`: the
 * shuttle while it runs (usu.js's planNet()), its stops then starts, changes and ends like Connect's, today only.
 * Each journey is { day, ymd, leave, arrive, legs }, legs of kind walk / ride, in order (a ride's `stops`, every one it
 * calls at from boarding to getting off, for the map); `leave` is when to set
 * off (before any first walk), `arrive` when the rider is at the stop asked for, `walk` the minutes on foot. The best
 * few, sorted by arrival: none is kept that another beats on leaving, arriving and walking all at once. Nothing
 * today: the first day with a way.
 */
const asked = new Map();   // the last asks, by their words and a twenty-second beat: the page asks twice a redraw, a redraw a feed, five seconds apart
export function journeys(origin, dest, clockNow, days = 8, sh = null, live = true, by = null) {
  // Answered from memory within twenty seconds for the same ask: a far destination (home, out past the stops) took
  // a second or more to search, twice every feed, and the page stuttered with it.
  const key = JSON.stringify([origin.si !== undefined ? origin.si : [+origin.lat.toFixed(5), +origin.lon.toFixed(5)], typeof dest === 'object' ? [+dest.lat.toFixed(5), +dest.lon.toFixed(5)] : dest, clockNow.ymd, clockNow.min, days, sh ? sh.now : null, live, by, Math.floor(Date.now() / 20000)]);
  if (asked.has(key)) return asked.get(key);
  if (asked.size > 40) asked.clear();
  const out = journeys0(origin, dest, clockNow, days, sh, live, by);
  asked.set(key, out);
  return out;
}
function journeys0(origin, dest, clockNow, days, sh, live, by) {
  SH = sh; SERVED = new Set(sh ? sh.loops.flatMap(l => l.stops) : []);
  if (SH) SH.now = clockNow.min;
  const spot = typeof dest === 'object', d = spot ? dest : stop(dest), o = origin.si !== undefined ? stop(origin.si) : origin;
  // A stop is a place like any other: a journey to it may end at any stop within a walk of it, and one from it may
  // start at any within a walk, as a spot's do, the stop itself at no walk. Each set is the nearest few (8, as a
  // spot's), with every stop close by kept whatever the count: the Transit Center's dozen bays, across the road.
  const around = (p, self, close) => {
    const near = nearest(p.lat, p.lon, 32).filter(x => x.i !== self && x.d <= WALK_TO);
    return [...near.filter(x => x.d <= close), ...near.filter(x => x.d > close).slice(0, Math.max(0, 8 - near.filter(x => x.d <= close).length - (self !== undefined ? 1 : 0)))];
  };
  // The stops that count as arriving, each with its walk from the stop to where the rider's going (off the bus and
  // up the hill, or down it).
  const wanted = new Map(spot ? [] : [[dest, 0]]);
  for (const { i, d: dd } of around(d, spot ? undefined : dest, WALK_FROM)) wanted.set(i, walkTo(stop(i), d, dd));
  for (const { x, d: dd } of nearU(d.lat, d.lon, WALK_TO).slice(0, 6)) wanted.set(x, walkTo(pt(x), d, dd));
  // The stops close enough to the one asked for to be it (a first stop among them is no journey, just the walk).
  const at = new Set([...wanted].filter(([x]) => x === dest || distance(pt(x).lat, pt(x).lon, d.lat, d.lon) <= WALK_FROM).map(([x]) => x));
  // Where to start: the stop named at no walk, and the stops within a walk of it or of the rider, each with its walk.
  const starts = origin.si !== undefined ? [{ si: origin.si, walk: 0, d: 0 }] : [];
  // A spot's close stops are kept whatever the count too: standing in the Transit Center ('Where I am'), the eight
  // nearest bays left Route 2's out, the ninth, and the way to the hospital was the 5, or the Green Loop to a 2.
  for (const { i, d: dd } of around(o, origin.si, CHANGE_WALK)) starts.push({ si: i, walk: walkTo(o, stop(i), dd), d: Math.round(dd) });
  for (const { x, d: dd } of nearU(o.lat, o.lon, WALK_TO).slice(0, 6)) starts.push({ si: x, walk: walkTo(o, pt(x), dd), d: Math.round(dd) });
  // Standing at the stop wanted, or within its walk: no bus to catch.
  const apart = Math.round(distance(o.lat, o.lon, d.lat, d.lon));
  if (origin.si === dest || apart <= WALK_FROM) return { walk: apart, plans: [] };
  // No stop within a walk of where they're going, or of where they are: no bus goes, and nothing to search (a
  // search with nowhere to arrive ran every day of the week through every first stop before saying so).
  if (!wanted.size || !starts.length) return apart <= WALK_TO ? { walk: apart, plans: [] } : { plans: [] };
  // Arriving by a minute (`by`) on clockNow's day, leaving no earlier than clockNow: that day only, the ways that get
  // there by then, the latest leaving first; the last few buses before it from each first stop, however early (a
  // route that runs mornings and evenings). Nothing among those (a connection that only runs mornings): the few before
  // them, and so on back through the day.
  if (by !== null) {
    if (!servicesOn(clockNow.ymd).size) return { plans: [] };
    const upto = new Map(starts.filter(st => !at.has(st.si)).map(st => [st.si, by - st.walk]));
    while (upto.size) {
      const plans = search(starts, wanted, at, spot ? d : dest, clockNow.ymd, clockNow.min, live, 0, by, upto);
      if (plans.length) return { plans };
    }
    return { plans: [] };
  }
  for (let day = 0; day < days; day++) {
    const ymd = dayFrom(clockNow.ymd, day).ymd;
    if (!servicesOn(ymd).size) continue;
    const plans = search(starts, wanted, at, spot ? d : dest, ymd, day === 0 ? clockNow.min : 0, day === 0 && live, day);   // live: the feed's word on today's buses, not a later day's or a time far ahead
    if (plans.length) return { plans };
  }
  // Within a walk, with no bus there worth taking: the walk.
  if (apart <= WALK_TO) return { walk: apart, plans: [] };
  return { plans: [] };
}

function search(starts, wanted, at, dest, ymd, min0, live, day, by = null, upto = null) {
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
    if (at.has(st.si)) continue;   // a first stop that is as good as the destination is a walk, said elsewhere
    let ts;
    if (upto) {
      // Arriving by: the last few leaving this stop up to its mark, and the mark moved back past them for another pass.
      if (!upto.has(st.si)) continue;
      ts = deps(st.si, ymd, min0 + st.walk, live, cache, upto.get(st.si));
      if (ts.length < MAX_ON) upto.delete(st.si); else upto.set(st.si, ts[0].min - 1);
    } else ts = deps(st.si, ymd, min0 + st.walk, live, cache);
    for (const t of ts) {
      const got = rideOf(t, ymd);
      if (!got) continue;
      const [seq, i] = got;
      const direct = rideTo(t, seq, i, wanted, true);
      if (direct) done([direct], st);
      if (direct && at.has(direct.to)) continue;   // a bus straight to the stop (or as good): no change from it is worth a look
      // One change: off at any later stop, on to another route's next buses from there.
      const delay = carried(t);
      const seen = new Set();
      for (let k = i + 1; k < seq.length; k++) {
        const [m, x] = seq[k];
        if (seen.has(x)) break;   // a loop back round: nothing new after
        seen.add(x);
        const off = Math.max(t.min, m + delay);
        // On to the next bus from this stop, or one a short walk away: the Transit Center's bays are stops of their own.
        // The one that gets there soonest, walk and all (the first to reach any stop wanted can leave the rider half a
        // mile off while another at the same minute goes to the door); none leaving after that arrival can beat it.
        let best = null;
        for (const y of nearOf(x)) {
          for (const t2 of deps(y.si, ymd, off + y.walk + CHANGE, live, cache)) {
            if (best && t2.min >= best.at) break;
            if (sameRide(t, t2)) continue;   // the same route again is the same ride
            const got2 = rideOf(t2, ymd);
            if (!got2) continue;
            const ride2 = rideTo(t2, got2[0], got2[1], wanted, true);
            if (!ride2) continue;
            const at2 = ride2.off + wanted.get(ride2.to);
            if (!best || at2 < best.at) best = { at: at2, y, ride2 };
          }
        }
        if (best) {
          const legs = [{ kind: 'ride', t, from: t.si, to: x, on: t.min, off, n: k - i, ti: t.trip, r: t.r, u: !!t.u, stops: seq.slice(i, k + 1).map(y => y[1]) }];
          if (best.y.walk) legs.push({ kind: 'walk', d: apartOf(x, best.y.si), mins: best.y.walk, from: x, to: best.y.si });
          legs.push(best.ride2);
          done(legs, st);
        }
      }
    }
  }
  // Only journeys no other beats on every count: leaving later, arriving sooner, walking less (the minutes on foot,
  // the climb in them, and WALK_LESS of them at least), with fewer changes the tiebreak where two arrive as soon. So
  // a way that spares the walk is kept though it's no faster (Route 2 and across the road to the Green Loop, not up
  // the hill on foot); one that spares a minute by riding on round a loop is not.
  if (by !== null) for (let i = found.length - 1; i >= 0; i--) if (found[i].arrive > by) found.splice(i, 1);
  for (const p of found) p.walk = p.legs.reduce((n, l) => n + (l.kind === 'walk' ? l.mins : 0), 0);
  found.sort((a, b) => b.leave - a.leave || a.arrive - b.arrive || a.walk - b.walk || a.changes - b.changes);
  const kept = [];
  for (const p of found) {
    if (!kept.some(q => q.leave >= p.leave && q.arrive <= p.arrive && q.walk < p.walk + WALK_LESS && (q.arrive < p.arrive || q.changes <= p.changes))) kept.push(p);
  }
  if (by !== null) kept.sort((a, b) => b.leave - a.leave || a.arrive - b.arrive || a.walk - b.walk);
  else kept.sort((a, b) => a.arrive - b.arrive || a.walk - b.walk || a.changes - b.changes);
  return kept.slice(0, 4);
}
