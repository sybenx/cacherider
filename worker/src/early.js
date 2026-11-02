// Buses gone by a timed stop early, seen as it happens and kept for the day: the app's bus card says how many times a
// bus has today ('Left timed stops early today: 781 S Main (2)'), and a phone opened after the bus went by still knows
// its stops ahead won't be waited for. The rule is the app's (rt.js watchEarly): the feed has dropped the stop from
// the trip, the bus is 100 m on from it and further on at the next look, and the stop's minute is still 2 to 30 min
// to come. How early is the least it can have been: as first seen past, not when it went.

import { clockOf } from './detours.js';

const TIMED = 'https://cacherider.com/data/timed.json';
const PAST = 100;    // metres from the stop: gone by it, not waiting its minute just beyond the pole
const ON = 20;       // metres further from it at the next look: going, not standing
const LOOK = 90;     // seconds between the two looks at most
const KEEP = 14;     // days of them kept

let T = null, tAt = 0;
/** The timed stops of each trip (tools/timed.py), fetched once an hour at most. */
async function timed() {
  if (T && Date.now() - tAt < 3600e3) return T;
  const j = await (await fetch(TIMED, { cf: { cacheTtl: 3600, cacheEverything: true } })).json();
  if (!j.trips || !j.stops) throw new Error('timed stops without trips');
  T = { ...j, clock: clockOf(j.tz || 'America/Denver') }; tAt = Date.now();
  return T;
}

const looked = new Map();   // trip|stop → { off, by, t }: the first look past it, waiting for the second

/** A minute's run: the timed stops, and the rows to write. */
export async function earlyStart() { return { T: await timed(), rows: [] }; }

/** One sample: each bus on a trip with timed stops, against the one behind it. */
export function earlyStep(E, out, t, keyOf) {
  const { T } = E, [, nowMin] = T.clock(t * 1000);
  for (const b of out.buses) {
    const list = b.trip && T.trips[b.trip], u = list && out.trips[b.trip];
    // The bus the feed has on the trip, and only it (a swap bus at the Center reports the trip it's covering too).
    if (!u || u.c || !u.s || !u.s.length || (u.v && u.v !== b.id) || (b.ts && t - b.ts > 60)) continue;
    // The nearest timed stop behind the bus: the last of the trip's the feed no longer lists, before the first it does.
    const left = new Set(u.s.map(x => x[0]));
    let behind = null;
    for (const x of list) { if (left.has(x[0])) break; behind = x; }
    if (!behind) continue;
    const [stop, m] = behind, at = T.stops[stop];
    if (!at) continue;
    let d = m - nowMin;   // minutes to its minute; a run past midnight counts its minutes on from 1440
    if (d > 720) d -= 1440; else if (d < -720) d += 1440;
    const by = Math.floor((d * 60 - t % 60) / 60), off = metres(b.lat, b.lon, at[0], at[1]), k = b.trip + '|' + stop;
    const prev = looked.get(k);
    if (by < 2 || by > 30 || off <= PAST) { if (prev && !prev.done) looked.delete(k); continue; }
    if (prev && prev.done) continue;
    if (prev && off >= prev.off + ON && t - prev.t <= LOOK) {
      E.rows.push([dayOf(T, prev.t), b.trip, b.label || b.id, keyOf(b) || '', stop, m, prev.t, prev.by]);
      looked.set(k, { done: true, t });
    } else if (!prev || t - prev.t > LOOK) looked.set(k, { off, by, t });
  }
  for (const [k, v] of looked) if (t - v.t > 3 * 3600) looked.delete(k);
}

/** The run's rows written (the first sighting of each stays: the most it can be said to have been early). */
export async function earlyEnd(env, E, t) {
  const db = env.TRACKS, q = E.rows.map(r => db.prepare('INSERT OR IGNORE INTO early (day, trip, bus, route, stop, due, seen, early) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(...r));
  if (new Date(t * 1000).getUTCMinutes() === 0) q.push(db.prepare('DELETE FROM early WHERE seen < ?').bind(t - KEEP * 86400));
  if (q.length) await db.batch(q);
}

/** GET /early: today's, as the app reads them, by the agency's day (from 3 AM: a run past midnight is the day before's). */
export async function earlyJSON(env) {
  const E = T || { clock: clockOf('America/Denver') }, t = Math.floor(Date.now() / 1000);   // the clock only: timed() not asked for it
  const r = await env.TRACKS.prepare('SELECT trip, bus, route, stop, due, seen, early FROM early WHERE day = ? ORDER BY seen').bind(dayOf(E, t)).all();
  return { t, early: r.results.map(x => [x.bus, x.trip, x.route, x.stop, x.due, x.seen, x.early]) };
}

/** The agency's day at a moment, 'YYYY-MM-DD', its start 3 AM. */
function dayOf(T, t) {
  const [, min] = T.clock(t * 1000), utc = Math.floor(t / 60) % 1440, off = ((utc - min) % 1440 + 1440) % 1440;   // minutes behind UTC
  return new Date((t - off * 60 - 3 * 3600) * 1000).toISOString().slice(0, 10);
}
function metres(la1, lo1, la2, lo2) {
  const kx = 111320 * Math.cos(la1 * Math.PI / 180);
  return Math.hypot((lo2 - lo1) * kx, (la2 - la1) * 110540);
}
