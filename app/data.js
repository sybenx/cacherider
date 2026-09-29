// The schedule, loaded once, and the questions the screens ask of it.
import { now, dayFrom, dayDiff, setZone, dayName, clockText } from './time.js';

export let D = null;           // the reduced feed
export const BASE = new URL('..', import.meta.url).href;   // the app's root, wherever it is served from

export async function load() {
  if (D) return D;
  const r = await fetch(BASE + 'data/cvtd.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('schedule ' + r.status);
  D = await r.json(); requests = null;
  setZone(D.agency.tz);
  D.routeByShort = Object.fromEntries(D.routes.map((r, i) => [r.short, i]));
  D.stopById = Object.fromEntries(D.stops.map((s, i) => [s.id, i]));
  return D;
}

// ---- service alerts: detours, closed stops, late starts, from data/alerts.json (hourly)
export let A = { fetched: null, alerts: [], byStop: {}, byRoute: {}, loadedAt: 0 };
// ---- places riders go, found by name in search, each with its nearest stops. Two lists, both on the device: the
// pamphlet's (tools/places.py), trusted, with Pool and CVTD's categories; and every named place in the valley from
// OpenStreetMap (tools/osmplaces.py). Nothing is looked up elsewhere while a rider searches.
export let P = [], O = [];
export async function loadPlaces() {
  const get = async f => { try { const r = await fetch(BASE + 'data/' + f, { cache: 'no-cache' }); return r.ok ? await r.json() : {}; } catch { return {}; } };
  const [pj, oj] = await Promise.all([get('places.json'), get('osm-places.json')]);
  P = pj.places || [];
  O = (oj.places || []).map(([name, lat, lon, word, area, also]) => ({ name, lat, lon, word, area, also: also || '', osm: true }));   // `also`: names it goes by, searched, not shown
  O.campus = oj.campus || '';   // the university's initials, the word its buildings are listed under
}
// ---- POOL, Connect's on-demand ride: its zone and its pickup points (tools/pool.py), an optional file; the app
// is whole without it. A pickup that is also a bus stop is marked on that stop.
export let POOL = null;
export async function loadPool() {
  try {
    const r = await fetch(BASE + 'data/pool.json', { cache: 'no-cache' });
    if (!r.ok) return;
    const j = await r.json();
    j.byStop = new Map(j.stops.filter(s => s.stop !== null && s.stop !== undefined).map(s => [s.stop, s]));
    j.byId = new Map(j.stops.map(s => [s.id, s]));
    POOL = j;
  } catch { /* no POOL file: no POOL */ }
}
/** Whether a point is inside POOL's zone. */
export function inPool(lat, lon) {
  if (!POOL) return false;
  const ring = POOL.zone; let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** The POOL pickup at a bus stop, if it is one. */
export const poolAt = si => POOL ? POOL.byStop.get(si) || null : null;
const wordsOf = s => norm(s.replace(/'/g, '').replace(/[()&/·;,-]/g, ' ')).split(' ').filter(Boolean);   // Miller's is millers, as it's typed; other names come semicolon-joined
/** Places with every word of the query at the start of a word of its name or its town: 'walmart', 'regional hosp',
 *  'church hyrum'. The pamphlet's first; OpenStreetMap's after, less any a pamphlet place already stands for. */
/** Whether a query reads as a street or an address ('500 north', 'main st, hyrum', '1400 N 500 E'): then the stops
 *  come first in the results, else the places ('walmart', 'library') do. */
let townSet = null;
/** A town's name alone ('Smithfield', 'hyde park'): the search puts the town's stops first, as it does a street's. */
export const townish = q => { townSet = townSet || new Set(D.stops.map(s => norm(s.town))); return townSet.has(norm(q)); };
export const streetish = q => /\d/.test(q) || /\b(main|center|st|street|ave|avenue|rd|road|dr|drive|blvd|hwy|highway|north|south|east|west|n|s|e|w)\b/i.test(q);
export function searchPlaces(q, limit = 8) {
  const words = wordsOf(q);
  if (!words.length) return { list: [], more: 0 };
  // Its name and its town ('church hyrum'); not the stop it's by, or '500 north' would find the shops there. Then its
  // kind ('dentist', 'pharmacy'), after the places named so.
  const hit = text => { const nw = wordsOf(text); return words.every(w => nw.some(x => x.startsWith(w))); };
  const town = p => (p.area || '').split(' · ')[0];
  const mine = P.filter(p => hit(p.name));
  const fresh = p => !mine.some(m => distance(m.lat, m.lon, p.lat, p.lon) < 150);
  const named = O.filter(p => hit(p.name + ' ' + town(p) + ' ' + p.also) && fresh(p));
  const kind = O.filter(p => !named.includes(p) && hit(p.word + ' ' + town(p)) && fresh(p));
  // POOL's pickup points by name, after the pamphlet's places: each a place served by POOL, with its nearest stops.
  const pool = POOL ? POOL.stops.filter(s => hit(s.name)).map(s => ({ name: s.name, lat: s.lat, lon: s.lon, word: 'POOL pickup', area: '', osm: true, pool: true, pickup: true })) : [];
  const all = [...mine, ...pool, ...named, ...kind];
  return { list: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}
/** The live relay, which serves the agency's notices minutes after they're posted; data/alerts.json (fetched by
 *  GitHub every so often) stands in when it can't be reached. */
export const LIVE_URL = 'https://live.cacherider.com/';
export async function loadAlerts() {
  try {
    let j = null;
    try { const r = await fetch(LIVE_URL + 'alerts', { cache: 'no-store' }); if (r.ok) j = await r.json(); } catch { /* the file, then */ }
    if (!j || !Array.isArray(j.alerts)) {
      const r = await fetch(BASE + 'data/alerts.json', { cache: 'no-cache' });
      if (!r.ok) return;
      j = await r.json();
    }
    const byStop = {}, byRoute = {};
    for (const a of j.alerts) {
      a.ri = (a.routes || []).map(s => D.routeByShort[s]).filter(x => x !== undefined);
      if (!(a.stops || []).length) a.stops = namedStops(a);
      a.names = namedDay(a.title || '', a.start);
      for (const id of a.stops || []) (byStop[id] ||= []).push(a);
      for (const ri of a.ri) (byRoute[ri] ||= []).push(a);
    }
    A = { ...j, byStop, byRoute, loadedAt: Date.now() };
  } catch { /* the app is fine without alerts */ }
}
// A notice that closes a stop but assigns none ('Due to construction, the stop at 355 North Main St. in Logan is
// closed', put on its routes alone): the stops whose names read in its words, up to where it offers alternatives,
// so the alternatives don't count as closed too.
const ADDR = { n: 'north', s: 'south', e: 'east', w: 'west', st: '', street: '', ave: 'avenue', rd: 'road', dr: 'drive', blvd: 'boulevard' };
const addrWords = s => s.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean).map(x => ADDR[x] !== undefined ? ADDR[x] : x).filter(Boolean);
const phraseIn = (hay, needle) => hay.some((_, i) => needle.every((x, j) => hay[i + j] === x));
function namedStops(a) {
  const words = (a.title || '') + '. ' + (a.text || '');
  if (!/\b(closed|closure|missed|not (?:be )?servic|skip|temporar)/i.test(words)) return [];
  const hay = addrWords(words.split(/\b(?:please use|alternate|alternative|instead|use the stops?\b)/i)[0]);
  const out = [];
  for (const s of D.stops) { if (s.hub) continue; const n = addrWords(s.name); if (n.length >= 2 && phraseIn(hay, n)) out.push(s.id); }
  return out;
}
let ymdFmt = null;
const ymdOf = epoch => (ymdFmt ||= new Intl.DateTimeFormat('en-CA', { timeZone: D.agency.tz, year: 'numeric', month: '2-digit', day: '2-digit' })).format(new Date(epoch * 1000)).replace(/-/g, '');
/** Connect sometimes runs a notice for a day's change up to the day before it and no further ("USU Homecoming
 *  Parade Saturday 9/26/2026", shown until the Friday). An alert naming a date in its title stays up through it. */
/** When the last of some alerts ends, as ymd, for 'skips this stop until Tue 29 Sep'; null when none says. An
 *  alert naming a day in its title ends that day. */
export function alertsUntil(alerts) {
  let last = null;
  for (const a of alerts) { const e = a.names && (!a.end || a.names > ymdOf(a.end)) ? a.names : a.end ? ymdOf(a.end) : null; if (e && (!last || e > last)) last = e; }
  return last;
}
export const alertOn = (a, ymd) => (!a.start || ymdOf(a.start) <= ymd) && (!a.end || ymdOf(a.end) >= ymd || (a.names && a.names >= ymd)) && !doneToday(a, ymd);
/** On its last day an alert is over when its buses are: a day's detour posted until midnight stops marking stops
 *  after its routes' last trips have run (the whole system's, for an alert naming none), with time for a late one:
 *  a route's last run is on time, near enough, but a loop's can be half an hour behind. */
function doneToday(a, ymd) {
  if (!a.end) return false;
  const e = ymdOf(a.end), last = a.names && a.names > e ? a.names : e;
  if (last !== ymd) return false;
  const c = now();
  if (c.ymd !== ymd || finding) return false;
  let ris = alertRoutes(a);
  if (!ris.length) ris = D.routes.map((_, ri) => ri);
  finding = true;
  let end;
  try { end = Math.max(...ris.map(ri => dayEnd(ri, ymd))); } finally { finding = false; }
  const late = ris.some(ri => (D.hub.loops || []).includes(ri)) ? 35 : 10;
  return end >= 0 && c.min > end + late;
}
/** The routes an alert is about: those it names, else one its title names ('Route 11 Detour: …'), else those at
 *  its stops. */
export function alertRoutes(a) {
  if (a.ri.length) return a.ri;
  const m = /\b(?:route|rt)\.?\s*(\d+)\b/i.exec(a.title || ''), ri = m ? D.routeByShort[m[1]] : undefined;
  if (ri !== undefined) return [ri];
  return [...new Set((a.stops || []).flatMap(id => D.stopById[id] !== undefined ? D.stops[D.stopById[id]].routes : []))];
}
const dayEnds = new Map();
let finding = false;   // a route's trips look at the day's alerts (a closed stop drops its times): all on meanwhile
/** When a route's last trip of the day reaches its last stop, in the day's minutes; -1 when it doesn't run. */
function dayEnd(ri, ymd) {
  const k = ri + ':' + ymd;
  if (!dayEnds.has(k)) { const t = lastTripOn(ri, ymd); dayEnds.set(k, t ? t.end[0] : -1); }
  return dayEnds.get(k);
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** The date a title names, as ymd: '9/26/2026', '9/26', 'Sept 26', 'September 26th'. Null when it names none. */
function namedDay(title, start) {
  const year0 = start ? +ymdOf(start).slice(0, 4) : new Date().getFullYear();
  let y, mo, d, m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(title);
  if (m) { mo = +m[1]; d = +m[2]; y = m[3] ? +(m[3].length === 2 ? '20' + m[3] : m[3]) : year0; }
  else if ((m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:uary|ruary|ch|il|e|y|ust|t|tember|ober|ember)?\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(title))) { mo = MONTHS.indexOf(m[1].toLowerCase()) + 1; d = +m[2]; y = year0; }
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return String(y) + String(mo).padStart(2, '0') + String(d).padStart(2, '0');
}
/** A system-wide alert (no stops or routes named) about this very day, for the day's heading in a list. */
export function dayAlert(ymd) { return A.alerts.find(a => a.names === ymd && !(a.stops || []).length && !(a.routes || []).length && !(a.routeIds || []).length) || null; }
export function stopAlerts(si, ymd) { return (A.byStop[D.stops[si].id] || []).filter(a => alertOn(a, ymd)); }
export function routeAlerts(ri, ymd) { return (A.byRoute[ri] || []).filter(a => alertOn(a, ymd)); }
export function systemAlerts(ymd) { return A.alerts.filter(a => !(a.stops || []).length && !(a.routes || []).length && !(a.routeIds || []).length && alertOn(a, ymd)); }
export function activeAlerts(ymd) { return A.alerts.filter(a => alertOn(a, ymd)); }
/** Routes that skip a stop on a day: an alert naming both the route and the stop. */
export function closedRoutes(si, ymd) {
  const out = new Set();
  for (const a of stopAlerts(si, ymd)) for (const ri of a.ri) out.add(ri);
  return out;
}

export const route = i => D.routes[i];
export const stop = i => D.stops[i];
export const stopIndex = id => D.stopById[id];

/** Which services run on a day: the calendar's rows, then the exceptions. */
export function servicesOn(ymd) {
  const d = dayFrom(ymd);
  const dow = (d.dow + 6) % 7;   // GTFS counts from Monday
  const on = new Set();
  for (const s of D.services) if (s.days[dow] && s.start <= ymd && ymd <= s.end) on.add(s.id);
  for (const [date, sid, type] of D.exceptions) if (date === ymd) (type === 1 ? on.add(sid) : on.delete(sid));
  return on;
}

/** Calendars for the same kind of day that start soon after: where a route missing from today's may still be found. */
export function upcomingServices(ymd, within = 45) {
  const d = dayFrom(ymd);
  const dow = (d.dow + 6) % 7;
  return D.services.filter(s => s.days[dow] && s.start > ymd && dayDiff(ymd, s.start) <= within).map(s => s.id);
}

/** Departures at a stop on a service day, sorted, as { min, r, h, dir }.
    A route the stop serves that today's calendar leaves out entirely, but an upcoming one lists, is filled in
    from that one and marked prov: the feed sometimes publishes a new timetable without the current week's. */
/** A loop bus starts its day at the Transit Center, but the feed cuts loop trips elsewhere (switching trips at the
 *  Transit Center, with its layovers, breaks things), so each bus's first trip lists stops before the Transit Center
 *  that it never runs. Those rows are left out; every later one is the end of the run before, and real. */
let unrun = null;
function notRun(ti, si, svc) {
  if (!unrun) {
    unrun = new Set();
    const loops = new Set(D.hub.loops || []);
    const bayOf = r => (D.hub.bays.find(b => b.routes.includes(r)) || {}).stop;
    const trips = new Map();   // service|trip → { t, r, svc, rows }: a trip's rows under one service
    for (const [s, per] of Object.entries(D.times)) for (const [svc, rows] of Object.entries(per)) for (const [m, r, , , t] of rows) {
      if (!loops.has(r)) continue;
      const k = svc + '|' + t;
      let x = trips.get(k);
      if (!x) trips.set(k, x = { t, r, svc, rows: [] });
      x.rows.push([m, +s]);
    }
    const first = new Map();     // service|run (G1, B2S…) → its earliest trip, by its departure from the loop's stop
    for (const x of trips.values()) {
      const bay = bayOf(x.r);
      const tc = Math.min(...x.rows.filter(([, s]) => s === bay).map(([m]) => m));
      if (!isFinite(tc)) continue;
      x.tc = tc;
      const run = x.svc + '|' + D.trips[x.t].split('_')[0], f = first.get(run);
      if (!f || tc < f.tc) first.set(run, x);
    }
    for (const x of first.values()) for (const [m, s] of x.rows) if (m < x.tc) unrun.add(x.svc + '|' + x.t + '|' + s);
  }
  return unrun.has(svc + '|' + ti + '|' + si);
}

/** A route that calls here only when asked, this way (a rider's cord, or a call ahead to be picked up): the feed
 *  lists it as any other stop. */
let requests = null;
export function onRequest(si, r, dir) {
  if (!requests) requests = new Set((D.request || []).map(([s, ri, d]) => s + ':' + ri + ':' + d));
  return requests.has(si + ':' + r + ':' + dir);
}
export function timesOn(si, ymd) {
  const per = D.times[si] || {};
  const out = [];
  const seen = new Set();
  for (const sid of servicesOn(ymd)) for (const t of per[sid] || []) {
    if (notRun(t[4], si, sid)) continue;
    out.push({ min: t[0], r: t[1], h: t[2], dir: t[3], si, trip: t[4], req: onRequest(si, t[1], t[3]) });
    seen.add(t[1]);
  }
  const missing = (D.stops[si].routes || []).filter(r => !seen.has(r) && !routeRunsOn(r, ymd));
  if (missing.length) {
    for (const sid of upcomingServices(ymd)) for (const t of per[sid] || []) if (missing.includes(t[1]) && !notRun(t[4], si, sid)) out.push({ min: t[0], r: t[1], h: t[2], dir: t[3], si, trip: t[4], prov: sid, req: onRequest(si, t[1], t[3]) });
  }
  // A detour that names this stop: that route's buses aren't calling here today.
  const closed = A.byStop[D.stops[si].id] ? closedRoutes(si, ymd) : null;
  return (closed && closed.size ? out.filter(t => !closed.has(t.r)) : out).sort((a, b) => a.min - b.min);
}

// ---- the night's last runs. Each evening a route's final trip may run only part of the way out from the
// Transit Center (the 8:30s, weekdays), so a stop's last departures get a word: the last trip that covers the
// whole route, and the partial one after it, with where it ends. Every loop run is a full one.
let tripMeta = null;
const wholeTrips = {};   // route:direction → its fullest trip, for the order its stops really come in
function metaOf(ti) {
  if (!tripMeta) {
    tripMeta = new Map();
    const most = {};
    for (const [si, per] of Object.entries(D.times)) for (const rows of Object.values(per)) for (const [m, r, , d, t] of rows) {
      let x = tripMeta.get(t);
      if (!x) tripMeta.set(t, x = { r, d, stops: new Set(), seq: [] });
      if (!x.stops.has(+si)) { x.stops.add(+si); x.seq.push([m, +si]); }
    }
    const whole = wholeTrips;   // route:direction → a trip that covers it all, its stops in the order it calls
    for (const x of tripMeta.values()) { const k = x.r + ':' + x.d; if (!most[k] || x.stops.size > most[k]) { most[k] = x.stops.size; whole[k] = x; } }
    for (const [ti, x] of tripMeta) {
      const k = x.r + ':' + x.d;
      x.partial = !(D.hub.loops || []).includes(x.r) && x.stops.size < most[k];
      // Where a partial trip ends: the timetable drops a trip's final stop, so it's the stop a full trip calls at next.
      // Its furthest stop by the full trip's order: two stops can share a minute.
      const order = whole[k].seq.slice().sort((p, q) => p[0] - q[0]).map(p => p[1]);
      const i = Math.max(...[...x.stops].map(si => order.indexOf(si)));
      const te = tripEnd(ti);
      x.end = te ? te.si : i >= 0 && i + 1 < order.length ? order[i + 1] : null;
    }
  }
  return tripMeta.get(ti);
}
/** A trip's route and direction. */
export function tripRoute(ti) {
  const m = metaOf(ti);
  return m ? { r: m.r, dir: m.d } : null;
}
/** The trip a bus runs after this one today, by the timetable's blocks; undefined at the end of its day. */
export function nextTrip(ti, ymd) {
  for (const sv of servicesOn(ymd)) { const n = D.next && D.next[sv] && D.next[sv][ti]; if (n !== undefined) return n; }
}
/** The trip a bus ran before this one today; undefined at the start of its day. */
export function prevTrip(ti, ymd) {
  for (const sv of servicesOn(ymd)) for (const [k, v] of Object.entries((D.next && D.next[sv]) || {})) if (v === ti) return +k;
}
/** A route's last trip today, one way when `dir` is given: of its trips today, the one that ends last. Not simply the last to leave the Transit
 *  Center: the feed cuts a loop's trips elsewhere, so its last run may not pass the Transit Center at all. */
export function lastTripOn(ri, ymd, dir) {
  const seen = new Set(Object.values(D.routes[ri].stops || {}).flat());
  let best = null, end = -1;
  const done = new Set();
  for (const si of seen) for (const t of timesOn(si, ymd)) {
    if (t.r !== ri || done.has(t.trip) || (dir !== undefined && String(t.dir) !== String(dir))) continue;
    done.add(t.trip);
    const st = tripStops(t.trip), te = tripEnd(t.trip), last = te ? [te.min, te.si] : st[st.length - 1], e = last ? last[0] : -1;
    if (e > end) { end = e; best = { trip: t.trip, dir: t.dir, h: t.h, start: st[0], end: last }; }
  }
  return best;
}
/** The run a trip is part of: its block's trips on the same route with no more than 45 minutes between, as trip
 *  indices in order. An out-and-back (15's to Preston and back, 12's to Hyrum) is one run of two timetable trips: the
 *  bus turns round at the far end and comes back, and nothing should read as if it ended there. */
export function runOf(ti, ymd) {
  const r = tripRoute(ti);
  if (!r) return [ti];
  const linked = (a, b) => { const rb = tripRoute(b), ea = tripEnd(a), sa = tripStops(a), sb = tripStops(b); return !!rb && rb.r === r.r && sb.length > 0 && sa.length > 0 && sb[0][0] - (ea ? ea.min : sa[sa.length - 1][0]) <= 45; };
  const run = [ti];
  for (let p = prevTrip(ti, ymd); p !== undefined && run.length < 12 && linked(p, run[0]); p = prevTrip(p, ymd)) run.unshift(p);
  for (let n = nextTrip(ti, ymd); n !== undefined && run.length < 12 && linked(run[run.length - 1], n); n = nextTrip(n, ymd)) run.push(n);
  return run;
}
/** Where a trip ends and when, { si, min }: its last stop, which the departures leave out (nobody boards there).
 *  Null for a timetable built before it was kept. */
export function tripEnd(ti) {
  const e = D.ends;
  return e && e[2 * ti] !== undefined && e[2 * ti] >= 0 ? { si: e[2 * ti], min: e[2 * ti + 1] } : null;
}
/** Whether a trip runs only part of its route (an evening's last), and the stop it ends at when it does. */
export function runEnd(ti) {
  const m = metaOf(ti);
  return m ? { partial: m.partial, end: m.end } : null;
}
/** A trip's stops in the order it calls, each [minute, stop], for the line of stops a bus runs to this one. */
export function tripStops(ti) {
  const m = metaOf(ti);
  if (!m) return [];
  // two stops in the same minute go in the order the route calls at them
  const order = (D.routes[m.r].stops || {})[m.d] || [], at = si => { const i = order.indexOf(si); return i < 0 ? 1e4 : i; };
  return m.seq.slice().sort((a, b) => a[0] - b[0] || at(a[1]) - at(b[1]));
}
/** A route's stops in the order its buses call at them. A numbered route's from its fullest trip (the stored order
 *  can be off), any that trip misses slotted in before the stop that follows them in the stored order. A loop's is
 *  the stored order, which is right, turned to start at its Transit Center stop, where every run begins. */
export function routeOrder(ri, dir) {
  metaOf(-1);
  const stored = (D.routes[ri].stops || {})[String(dir)] || [];
  if ((D.hub.loops || []).includes(ri)) {
    const once = stored.filter((si, k) => stored.indexOf(si) === k);
    const bay = (D.hub.bays.find(b => b.routes.includes(ri)) || {}).stop, i = once.indexOf(bay);
    return i > 0 ? once.slice(i).concat(once.slice(0, i)) : once;
  }
  const w = wholeTrips[ri + ':' + dir];
  if (!w) return stored;
  const order = w.seq.slice().sort((a, b) => a[0] - b[0]).map(([, si]) => si);
  [...stored].reverse().forEach((si, k, rev) => { if (order.includes(si)) return; const next = rev.slice(0, k).reverse().find(x => order.includes(x)); order.splice(next === undefined ? order.length : order.indexOf(next), 0, si); });
  return order;
}

// ---- where a route's direction goes, worked out from the timetable when the feed's headsign says only
// 'Northbound' or 'Route 06'. The far end names it: the hub when the way ends there; the town it reaches (Hyrum,
// Richmond, Preston), any town but the hub's own; the campus, from OpenStreetMap; a town the route's GTFS
// description names (11's Nibley, whose stops the grid files under Logan); a landmark by the last stop, from the
// pamphlet if there is one, else OpenStreetMap; failing all, the last stop's street. A way that starts and ends at
// the hub is the places its description lists. Nothing here is Cache Valley's: GTFS and OpenStreetMap give it all,
// so another system's names come out the same way.
const dirNames = new Map();
export function dirName(ri, dir) {
  const k = ri + ':' + dir;
  if (dirNames.has(k)) return dirNames.get(k);
  metaOf(-1);
  const w = wholeTrips[k];
  if (!w) { dirNames.set(k, null); return null; }
  let ti = -1;
  for (const [t, x] of tripMeta) if (x === w) { ti = t; break; }
  const seq = w.seq.slice().sort((a, b) => a[0] - b[0]).map(([, si]) => si);
  const te = ti >= 0 ? tripEnd(ti) : null, end = te ? te.si : seq[seq.length - 1], start = seq[0];
  const r = D.routes[ri], e = D.stops[end];
  const town = t => (t || '').replace(/,\s*[A-Z][a-z]+$/, '');   // 'Preston, Idaho' is Preston
  const home = town(D.hub.town || '');   // the hub's own town names nothing: every way starts there
  let out = null;
  if (e.hub && !D.stops[start].hub) out = { text: D.hub.name };
  else if (e.hub) out = r.desc ? { text: r.desc.replace(/,\s*/g, ' · '), places: true } : null;
  else if (e.town && town(e.town) !== home) out = { text: town(e.town) };
  else {
    const byDist = list => list.slice().sort((a, b) => distance(e.lat, e.lon, a.lat, a.lon) - distance(e.lat, e.lon, b.lat, b.lon));
    const near = (list, m) => list.filter(p => distance(e.lat, e.lon, p.lat, p.lon) <= m);
    const towns = new Set(D.stops.map(s => town(s.town)).filter(t => t && t !== home));
    const named = (r.desc || '').split(/,\s*/).map(x => x.trim()).find(x => towns.has(x));
    const LANDMARK = /^(Library|Park|School|College|Hospital|Clinic|City hall|Government office|Sports center|Stadium|Grocery|Mall|Department store|Museum|Community center|Post office)$/;
    if (O.campus && near(O, 200).some(p => p.word === O.campus)) out = { text: O.campus };
    else if (named) out = { text: named };
    else { const p = byDist(near(P, 250))[0] || byDist(near(O, 250).filter(p => LANDMARK.test(p.word)))[0]; out = { text: p ? p.name : e.name }; }
  }
  dirNames.set(k, out);
  return out;
}

const lastCache = new Map();
/** 'Last full run', 'Last run (partial, to 290 South 100 East)', or null, for a departure on its service day. */
export function lastRun(t) {
  if (t.trip === undefined || t.si === undefined) return null;
  const ymd = t.ymd || now().ymd, key = t.si + '|' + ymd + '|' + t.r;
  let words = lastCache.get(key);
  if (!words) {
    words = new Map();
    const rows = timesOn(t.si, ymd).filter(x => x.r === t.r && x.trip !== undefined);
    const last = rows[rows.length - 1];
    if (last) {
      const m = metaOf(last.trip);
      if (m && m.partial) {
        words.set(last.trip, 'Last run (partial' + (m.end !== null ? ', to ' + D.stops[m.end].name : '') + ')');
        const full = [...rows].reverse().find(x => !metaOf(x.trip)?.partial);
        if (full) words.set(full.trip, 'Last full run');
      } else words.set(last.trip, 'Last full run');
    }
    lastCache.set(key, words);
  }
  return words.get(t.trip) || null;
}

let routeDays = null;
/** Whether a route has any trip anywhere under today's calendars: if it does, its absence at a stop is real. */
function routeRunsOn(ri, ymd) {
  if (!routeDays) {
    routeDays = {};
    for (const per of Object.values(D.times)) for (const [sid, list] of Object.entries(per)) for (const t of list) (routeDays[sid] = routeDays[sid] || new Set()).add(t[1]);
  }
  for (const sid of servicesOn(ymd)) if (routeDays[sid] && routeDays[sid].has(ri)) return true;
  return false;
}

/** The next departures from a stop, rolling into the days ahead. Each carries day (0 = today) and ymd. */
/** Set by the live module: a departure today as the realtime feed has it, with `min` moved to the predicted
 *  minute and `live` set, or `gone` when the bus has already been. Untouched when the feed has nothing. */
export let live = t => t;
export function setLive(fn) { live = fn; }
export function nextAt(si, n = 7, clockNow = now(), days = 8, filter = null) {
  const out = [];
  for (let day = 0; day < days && out.length < n; day++) {
    const ymd = dayFrom(clockNow.ymd, day).ymd;
    let rows = timesOn(si, ymd);
    if (day === 0) rows = rows.map(live).filter(t => !t.gone && t.min >= clockNow.min).sort((a, b) => a.min - b.min);   // a late bus is still coming
    for (const t of rows) {
      if (filter && !filter(t)) continue;
      out.push({ ...t, day, ymd });
      if (out.length >= n) break;
    }
  }
  return out;
}

/** What today looks like at a stop: everything, the last one, and whether the system runs at all. */
export function today(si, clockNow = now()) {
  const all = timesOn(si, clockNow.ymd);
  const left = all.filter(t => t.min >= clockNow.min);
  return { all, left, last: all.length ? all[all.length - 1] : null, systemRuns: servicesOn(clockNow.ymd).size > 0 };
}

/** The first day on or after today when any service starts: the "new timetable" banner. */
export function newTimetable(clockNow = now()) {
  let best = null;
  for (const s of D.services) {
    if (s.start > clockNow.ymd && dayDiff(clockNow.ymd, s.start) <= 45 && (!best || s.start < best)) best = s.start;
  }
  return best;
}

/** Whether a stop's own departures differ under the timetable starting `start`: each weekday's first week on it
 *  against the same weekday the week before. Only then is "new timetable" worth telling a rider at this stop. */
export function timesChange(si, start) {
  if (!start) return false;
  const key = ymd => timesOn(si, ymd).map(t => t.min + ':' + t.r).join(',');
  for (let k = 0; k < 7; k++) if (key(dayFrom(start, k).ymd) !== key(dayFrom(start, k - 7).ymd)) return true;
  return false;
}

/** 'no buses Sunday': the days with no service between two days, so a next bus on Monday isn't read as tomorrow's. */
export function quietWords(fromYmd, toYmd) {
  const q = [];
  for (let k = 1; k < 14; k++) { const d = dayFrom(fromYmd, k).ymd; if (d >= toYmd) break; if (!servicesOn(d).size) q.push(dayName(d)); }
  return q.length ? 'no buses ' + q.join(' or ') : '';
}
/** A day's shape at a stop, '12:00–6:30 PM, hourly': for Saturdays, which run shorter and thinner than weekdays.
 *  The frequency only when every route here keeps the same one. */
export function dayShape(si, ymd) {
  const rows = timesOn(si, ymd);
  if (!rows.length) return '';
  const byRoute = {};
  for (const t of rows) (byRoute[t.r] ||= []).push(t.min);
  const usual = Object.values(byRoute).map(ms => {
    const gaps = ms.slice(1).map((m, i) => m - ms[i]), n = {};
    for (const g of gaps) n[g] = (n[g] || 0) + 1;
    return +(Object.entries(n).sort((a, b) => b[1] - a[1])[0] || [0])[0];
  });
  const g = usual.every(x => x === usual[0]) ? usual[0] : 0;
  const mins = rows.map(t => t.min);
  return clockText(Math.min(...mins)).replace(/ (AM|PM)$/, m => Math.min(...mins) < 720 === Math.max(...mins) < 720 ? '' : m) + '–' + clockText(Math.max(...mins)) + (g === 60 ? ', hourly' : g ? ', every ' + g + ' min' : '');
}

/** The next day with service from today, for the "resumes" line. */
export function nextServiceDay(clockNow = now()) {
  for (let day = 1; day < 14; day++) {
    const ymd = dayFrom(clockNow.ymd, day).ymd;
    if (servicesOn(ymd).size) return ymd;
  }
  return null;
}

/** The hub's pulse: next departures where the numbered routes leave together. */
export function nextPulse(n = 1, clockNow = now()) {
  const out = [];
  for (let day = 0; day < 8 && out.length < n; day++) {
    const ymd = dayFrom(clockNow.ymd, day).ymd;
    const mins = new Set();
    for (const sid of servicesOn(ymd)) for (const m of D.hub.pulse[sid] || []) mins.add(m);
    for (const m of [...mins].sort((a, b) => a - b)) {
      if (day === 0 && m < clockNow.min) continue;
      out.push({ min: m, day, ymd });
      if (out.length >= n) break;
    }
  }
  return out;
}

/** Next departures from the hub for a route (all its bays), n of them. */
export function nextFromHub(ri, n = 3, clockNow = now()) {
  const merged = [];
  for (const b of D.hub.bays) if (b.routes.includes(ri)) for (const t of nextAt(b.stop, n, clockNow, 8, t => t.r === ri)) merged.push({ ...t, stop: b.stop });
  merged.sort((a, b) => (a.day - b.day) || (a.min - b.min));
  const seen = new Set(), out = [];
  for (const t of merged) { const k = t.day + ':' + t.min + ':' + t.h; if (!seen.has(k)) { seen.add(k); out.push(t); } }
  return out.slice(0, n);
}

// ---- geography
export function distance(lat1, lon1, lat2, lon2) {
  const dy = (lat2 - lat1) * 111000, dx = (lon2 - lon1) * 111000 * Math.cos(lat1 * Math.PI / 180);
  return Math.hypot(dx, dy);
}
/** Degrees clockwise from north, from the first point to the second; and as one of eight words. */
export function bearing(lat1, lon1, lat2, lon2) {
  const dy = lat2 - lat1, dx = (lon2 - lon1) * Math.cos(lat1 * Math.PI / 180);
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}
export const compass8 = deg => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
export function nearest(lat, lon, n = 8) {
  return D.stops.map((s, i) => ({ i, d: distance(lat, lon, s.lat, s.lon) })).sort((a, b) => a.d - b.d).slice(0, n);
}

// ---- search: street, number and town, in any order
const norm = s => s.toLowerCase().replace(/[.,]/g, ' ').replace(/\b(street|st)\b/g, 'st').replace(/\b(drive|dr)\b/g, 'dr').replace(/\b(north)\b/g, 'north').replace(/\bn\b/g, 'north').replace(/\bs\b/g, 'south').replace(/\be\b/g, 'east').replace(/\bw\b/g, 'west').replace(/\bhwy\b/g, 'highway').replace(/\s+/g, ' ').trim();
let index = null;
export function search(q, limit = 40) {
  // The Transit Center's bays go by its name too: their stops are named for its street address.
  index = index || D.stops.map((s, i) => ({ i, text: norm(s.name + ' ' + s.town + ' ' + s.code + ' ' + s.id + ' ' + (s.by || '') + (s.hub ? ' ' + D.hub.name + ' ' + (D.hub.short || '') : '')) }));
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  // The Transit Center's bays share one address: the first stands for them all (the screens show it as the Transit Center).
  let hubSeen = false;
  const hits = index.filter(e => words.every(w => e.text.includes(w)) && (!D.stops[e.i].hub || !(hubSeen || !(hubSeen = true)))).map(e => e.i);
  // Stops with the words in the order given ('500 north' on 500 North) before those with them scattered ('60 North
  // 500 East'); then, in one town, street numbers read in order.
  const phrase = words.join(' ');
  const inOrder = i => D.stops[i].hub || index[i].text.includes(phrase) ? 0 : 1;
  hits.sort((a, b) => {
    const A = D.stops[a], B = D.stops[b];
    return inOrder(a) - inOrder(b) || A.town.localeCompare(B.town) || (parseInt(A.name) || 0) - (parseInt(B.name) || 0) || A.name.localeCompare(B.name);
  });
  return hits.slice(0, limit);
}

/** The routes a search names: by number ('12', 'route 12', '#12', '01'; '16' is both of 16's), by letter ('B'), or by
 *  name ('blue', 'green loop'); 'routes', every one. What a routes grid was for, typed. */
export function searchRoutes(q) {
  if (/^(all )?(routes?|buses)$/.test(norm(q))) return D.routes.map((r, i) => i);   // 'routes': the whole list, asked for
  const w = norm(q).replace(/^(route|rt)\s*|^#/, '').replace(/^the\s+/, '').trim();
  if (!w) return [];
  return D.routes.map((r, i) => i).filter(i => {
    const short = D.routes[i].short.toLowerCase(), long = D.routes[i].long.toLowerCase();
    if (short === w || short.startsWith(w + ' ')) return true;
    if (/^\d+$/.test(w) && parseInt(short) === +w) return true;
    return /[a-z]/.test(w) && w.length >= 3 && w.split(' ').every(x => long.split(' ').some(y => y.startsWith(x)));
  });
}

// ---- what this phone remembers
const RECENT = 'cr-recent';
export function recent() { try { return JSON.parse(localStorage.getItem(RECENT) || '[]').filter(id => id in D.stopById); } catch { return []; } }
export function remember(id) {
  try { localStorage.setItem(RECENT, JSON.stringify([id, ...recent().filter(x => x !== id)].slice(0, 4))); } catch { /* private mode */ }
}
const SAVED = 'cr-saved';
export function saved() { try { return JSON.parse(localStorage.getItem(SAVED) || '[]').filter(id => id in D.stopById || id.startsWith('u:')); } catch { return []; } }
export function setSaved(ids) { try { localStorage.setItem(SAVED, JSON.stringify(ids)); } catch { /* private mode */ } }
export function isSaved(id) { return saved().includes(id); }
export function toggleSaved(id) { const s = saved(); setSaved(s.includes(id) ? s.filter(x => x !== id) : [...s, id]); return !s.includes(id); }

export function pref(k, v) {
  try { if (v === undefined) return localStorage.getItem('cr-' + k); if (v === null) localStorage.removeItem('cr-' + k); else localStorage.setItem('cr-' + k, v); } catch { return null; }
}
