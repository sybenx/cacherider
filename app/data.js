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

/** Departures at a stop on a service day, sorted, as { min, r, h, dir }. */
export function timesOn(si, ymd) {
  const per = D.times[si] || {};
  const out = [];
  for (const sid of servicesOn(ymd)) for (const t of per[sid] || []) out.push({ min: t[0], r: t[1], h: t[2], dir: t[3] });
  return out.sort((a, b) => a.min - b.min);
}

/** The next departures from a stop, rolling into the days ahead. Each carries day (0 = today) and ymd. */
export function nextAt(si, n = 7, clockNow = now(), days = 8, filter = null) {
  const out = [];
  for (let day = 0; day < days && out.length < n; day++) {
    const ymd = dayFrom(clockNow.ymd, day).ymd;
    for (const t of timesOn(si, ymd)) {
      if (day === 0 && t.min < clockNow.min) continue;
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
export function pref(k, v) {
  try { if (v === undefined) return localStorage.getItem('cr-' + k); if (v === null) localStorage.removeItem('cr-' + k); else localStorage.setItem('cr-' + k, v); } catch { return null; }
}
