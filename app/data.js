// The schedule, loaded once, and the questions the screens ask of it.
import { now, dayFrom, dayDiff, setZone } from './time.js';

export let D = null;           // the reduced feed
export const BASE = new URL('..', import.meta.url).href;   // the app's root, wherever it is served from

export async function load() {
  if (D) return D;
  const r = await fetch(BASE + 'data/cvtd.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('schedule ' + r.status);
  D = await r.json();
  setZone(D.agency.tz);
  D.routeByShort = Object.fromEntries(D.routes.map((r, i) => [r.short, i]));
  D.stopById = Object.fromEntries(D.stops.map((s, i) => [s.id, i]));
  return D;
}

// ---- service alerts: detours, closed stops, late starts, from data/alerts.json (hourly)
export let A = { fetched: null, alerts: [], byStop: {}, byRoute: {}, loadedAt: 0 };
export async function loadAlerts() {
  try {
    const r = await fetch(BASE + 'data/alerts.json', { cache: 'no-cache' });
    if (!r.ok) return;
    const j = await r.json();
    const byStop = {}, byRoute = {};
    for (const a of j.alerts) {
      a.ri = (a.routes || []).map(s => D.routeByShort[s]).filter(x => x !== undefined);
      a.names = namedDay(a.title || '', a.start);
      for (const id of a.stops || []) (byStop[id] ||= []).push(a);
      for (const ri of a.ri) (byRoute[ri] ||= []).push(a);
    }
    A = { ...j, byStop, byRoute, loadedAt: Date.now() };
  } catch { /* the app is fine without alerts */ }
}
let ymdFmt = null;
const ymdOf = epoch => (ymdFmt ||= new Intl.DateTimeFormat('en-CA', { timeZone: D.agency.tz, year: 'numeric', month: '2-digit', day: '2-digit' })).format(new Date(epoch * 1000)).replace(/-/g, '');
/** Connect sometimes runs a notice for a day's change up to the day before it and no further ("USU Homecoming
 *  Parade Saturday 9/26/2026", shown until the Friday). An alert naming a date in its title stays up through it. */
export const alertOn = (a, ymd) => (!a.start || ymdOf(a.start) <= ymd) && (!a.end || ymdOf(a.end) >= ymd || (a.names && a.names >= ymd));
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
export function timesOn(si, ymd) {
  const per = D.times[si] || {};
  const out = [];
  const seen = new Set();
  for (const sid of servicesOn(ymd)) for (const t of per[sid] || []) { out.push({ min: t[0], r: t[1], h: t[2], dir: t[3], si, trip: t[4] }); seen.add(t[1]); }
  const missing = (D.stops[si].routes || []).filter(r => !seen.has(r) && !routeRunsOn(r, ymd));
  if (missing.length) {
    for (const sid of upcomingServices(ymd)) for (const t of per[sid] || []) if (missing.includes(t[1])) out.push({ min: t[0], r: t[1], h: t[2], dir: t[3], si, trip: t[4], prov: sid });
  }
  // A detour that names this stop: that route's buses aren't calling here today.
  const closed = A.byStop[D.stops[si].id] ? closedRoutes(si, ymd) : null;
  return (closed && closed.size ? out.filter(t => !closed.has(t.r)) : out).sort((a, b) => a.min - b.min);
}

// ---- the night's last runs. Each evening a route's final trip may run only part of the way out from the
// Transit Center (the 8:30s, weekdays), so a stop's last departures get a word: the last trip that covers the
// whole route, and the partial one after it, with where it ends. Every loop run is a full one.
let tripMeta = null;
function metaOf(ti) {
  if (!tripMeta) {
    tripMeta = new Map();
    const most = {};
    for (const [si, per] of Object.entries(D.times)) for (const rows of Object.values(per)) for (const [m, r, , d, t] of rows) {
      let x = tripMeta.get(t);
      if (!x) tripMeta.set(t, x = { r, d, stops: new Set(), seq: [] });
      if (!x.stops.has(+si)) { x.stops.add(+si); x.seq.push([m, +si]); }
    }
    const whole = {};   // route:direction → a trip that covers it all, its stops in the order it calls
    for (const x of tripMeta.values()) { const k = x.r + ':' + x.d; if (!most[k] || x.stops.size > most[k]) { most[k] = x.stops.size; whole[k] = x; } }
    for (const x of tripMeta.values()) {
      const k = x.r + ':' + x.d;
      x.partial = !(D.hub.loops || []).includes(x.r) && x.stops.size < most[k];
      // Where a partial trip ends: the timetable drops a trip's final stop, so it's the stop a full trip calls at next.
      // Its furthest stop by the full trip's order: two stops can share a minute.
      const order = whole[k].seq.slice().sort((p, q) => p[0] - q[0]).map(p => p[1]);
      const i = Math.max(...[...x.stops].map(si => order.indexOf(si)));
      x.end = i >= 0 && i + 1 < order.length ? order[i + 1] : null;
    }
  }
  return tripMeta.get(ti);
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
export function nearest(lat, lon, n = 8) {
  return D.stops.map((s, i) => ({ i, d: distance(lat, lon, s.lat, s.lon) })).sort((a, b) => a.d - b.d).slice(0, n);
}

// ---- search: street, number and town, in any order
const norm = s => s.toLowerCase().replace(/[.,]/g, ' ').replace(/\b(street|st)\b/g, 'st').replace(/\b(drive|dr)\b/g, 'dr').replace(/\b(north)\b/g, 'north').replace(/\bn\b/g, 'north').replace(/\bs\b/g, 'south').replace(/\be\b/g, 'east').replace(/\bw\b/g, 'west').replace(/\bhwy\b/g, 'highway').replace(/\s+/g, ' ').trim();
let index = null;
export function search(q, limit = 40) {
  index = index || D.stops.map((s, i) => ({ i, text: norm(s.name + ' ' + s.town + ' ' + s.code + ' ' + s.id) }));
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const hits = index.filter(e => words.every(w => e.text.includes(w))).map(e => e.i);
  // In one town, street numbers read in order.
  hits.sort((a, b) => {
    const A = D.stops[a], B = D.stops[b];
    return A.town.localeCompare(B.town) || (parseInt(A.name) || 0) - (parseInt(B.name) || 0) || A.name.localeCompare(B.name);
  });
  return hits.slice(0, limit);
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
