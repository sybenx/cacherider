// The schedule, loaded once, and the questions the screens ask of it.
import { now, dayFrom, dayDiff, setZone, dayName, clockText } from './time.js';

export let D = null;           // the reduced feed
export const BASE = new URL('..', import.meta.url).href;   // the app's root, wherever it is served from

// Once, however many ask at the same time (the alerts wait on it for the stops and routes they name).
let loading = null;
export function load() {
  return loading ??= (async () => {
    const r = await fetch(BASE + 'data/cvtd.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('schedule ' + r.status);
    D = await r.json(); requests = null;
    setZone(D.agency.tz);
    D.routeByShort = Object.fromEntries(D.routes.map((r, i) => [r.short, i]));
    D.stopById = Object.fromEntries(D.stops.map((s, i) => [s.id, i]));
    apart(D.routes);
    for (const r of D.routes) r.tpSet = new Set(r.tp || []);
    // The feed's long names pad the number ('Route 03'): said as riders say it, 'Route 3'.
    for (const r of D.routes) if (r.long) r.long = r.long.replace(/^(Route\s+)0+(?=\d)/i, '$1');
    return D;
  })().catch(e => { loading = null; throw e; });
}
/** A timepoint of a route's: a stop its timetable is kept to, where an early bus waits for its time (the feed's
 *  own mark, stop_times' timepoint, the same stops on every trip of a route). */
export const timed = (si, ri) => !!(D.routes[ri] && D.routes[ri].tpSet && D.routes[ri].tpSet.has(si));

/** Route colours a rider can tell apart. Every route meets at the Transit Center, and an agency's colours can sit
 *  side by side all but the same (Connect's Route 8 and Green Loop, 9 and 11): any two nearer than NEED (ΔE, CIELAB)
 *  are drawn apart in lightness, the lighter lighter and the darker darker, each hue kept, a step at a time till
 *  they're far enough. Two halves of one route (16 AM and PM, never out together) are left be. The badge's text
 *  turns black or white if the new shade needs it; the feed's own colour is kept as `gtfsColor`. */
const NEED = 22, NEED_DARK = 30;
/** A colour lightened toward white just till it stands off the dark map (relative luminance 0.2); bright ones as they are. */
export function liftHex(hex) {
  const c = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  const lum = v => { const [r, g, b] = v.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  let t = 0, v = c;
  while (lum(v) < 0.2 && t < 1) { t += 0.05; v = c.map(x => Math.round(x + (255 - x) * t)); }
  return v.map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}
function apart(routes) {
  const lin = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4, gam = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116, fi = t => t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787;
  const toLab = hex => {
    const [r, g, b] = [0, 2, 4].map(i => lin(parseInt(hex.slice(i, i + 2), 16)));
    const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), y = f(r * 0.2126 + g * 0.7152 + b * 0.0722), z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const toHex = ([L, A, B]) => {
    const y = (L + 16) / 116, x = fi(A / 500 + y) * 0.95047, z = fi(y - B / 200) * 1.08883, Y = fi(y);
    const rgb = [3.2406 * x - 1.5372 * Y - 0.4986 * z, -0.9689 * x + 1.8758 * Y + 0.0415 * z, 0.0557 * x - 0.2040 * Y + 1.0570 * z];
    return rgb.map(c => Math.round(Math.max(0, Math.min(255, gam(Math.max(0, c))))).toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  const lum = hex => { const [r, g, b] = [0, 2, 4].map(i => lin(parseInt(hex.slice(i, i + 2), 16))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const same = (a, b) => a.short.split(' ')[0] === b.short.split(' ')[0];
  const alike = new Set();   // the pairs that had to be drawn apart
  const spread = (L, need, floor, ceil, only) => {
    for (let pass = 0; pass < 24; pass++) {
      let moved = false;
      for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
        if (only && !only.has(i + ',' + j)) continue;
        if (!L[i] || !L[j] || same(routes[i], routes[j]) || Math.hypot(L[i][0] - L[j][0], L[i][1] - L[j][1], L[i][2] - L[j][2]) >= need) continue;
        if (!only) alike.add(i + ',' + j);
        const [lo, hi] = L[i][0] <= L[j][0] ? [i, j] : [j, i];
        L[lo][0] = Math.max(floor, L[lo][0] - 1); L[hi][0] = Math.min(ceil, L[hi][0] + 1);
        moved = true;
      }
      if (!moved) break;
    }
  };
  const L = routes.map(r => /^[0-9a-f]{6}$/i.test(r.color || '') ? toLab(r.color) : null);
  spread(L, NEED, 8, 92);
  // On the dark map every line is lifted till it stands off the paper, and bright colours glow alike there: two
  // greens that read apart on the light map (8 and Green) didn't on the dark. So the pairs that had to be drawn apart
  // are drawn further apart for the dark map (`dcolor`), from their lifted shades; the rest are only lifted.
  const DL = routes.map((r, i) => L[i] && toLab(liftHex(toHex(L[i]))));
  spread(DL, NEED_DARK, 52, 95, alike);
  routes.forEach((r, i) => { if (DL[i]) r.dcolor = toHex(DL[i]); });
  routes.forEach((r, i) => {
    if (!L[i]) return;
    const hex = toHex(L[i]);
    if (hex === r.color.toUpperCase()) return;
    r.gtfsColor = r.color; r.color = hex;
    // The agency's text kept unless the new shade reads worse under it than the old did (and than is easy to read).
    if (!/^[0-9a-f]{6}$/i.test(r.text || '') || (contrast(hex, r.text) < 4.5 && contrast(hex, r.text) < contrast(r.gtfsColor, r.text))) r.text = contrast(hex, '000000') >= contrast(hex, 'FFFFFF') ? '000000' : 'FFFFFF';
  });
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
 *  GitHub every so often) stands in when it can't be reached. The first page is drawn from the file alone, kept on
 *  the phone, and never waits on the relay: `relay: false`. */
export const LIVE_URL = 'https://live.cacherider.com/';
export async function loadAlerts({ relay = true } = {}) {
  try {
    let j = null;
    if (relay) try { const r = await fetch(LIVE_URL + 'alerts', { cache: 'no-store' }); if (r.ok) j = await r.json(); } catch { /* the file, then */ }
    // The file's too, beside the relay's: it keeps an alert two days after the agency drops it at its posted end
    // ('lapsed', tools/alerts.py), and the relay has only what the agency lists now.
    let file = null;
    try { const r = await fetch(BASE + 'data/alerts.json', { cache: 'no-cache' }); if (r.ok) file = await r.json(); } catch { /* the relay's alone */ }
    if (!j || !Array.isArray(j.alerts)) { if (!file) return; j = file; }
    else if (file) { const have = new Set(j.alerts.map(a => a.id)); j = { ...j, alerts: [...j.alerts, ...(file.alerts || []).filter(a => a.lapsed && !have.has(a.id))] }; }
    await load();   // the stops and routes the alerts name
    const byStop = {}, byRoute = {};
    for (const a of j.alerts) {
      if (!/^https?:\/\//i.test(a.url || '')) a.url = '';   // a link out, and only that: never a script's
      a.ri = (a.routes || []).map(s => D.routeByShort[s]).filter(x => x !== undefined);
      if (!(a.stops || []).length) a.stops = namedStops(a);
      a.names = namedDay(a.title || '', a.start);
      for (const id of a.stops || []) (byStop[id] ||= []).push(a);
      for (const ri of a.ri) (byRoute[ri] ||= []).push(a);
    }
    let tracked = [];
    if (relay && pref('detours') === 'on') try { const r = await fetch(LIVE_URL + 'detours', { cache: 'no-store' }); if (r.ok) tracked = trackedAlerts((await r.json()).detours || [], byStop); } catch { /* the agency's alone */ }
    for (const a of tracked) {
      for (const id of [...a.stops, ...a.maybe]) (byStop[id] ||= []).push(a);
      for (const ri of a.ri) (byRoute[ri] ||= []).push(a);
    }
    A = { ...j, alerts: [...j.alerts, ...tracked], byStop, byRoute, tracked, loadedAt: relay ? Date.now() : A.loadedAt };   // the file alone is no check of the relay
  } catch { /* the app is fine without alerts */ }
}
/** Detours seen from the buses themselves (the relay's watch, worker/src/detours.js), as alerts of their own: the
 *  stops of a route's line between where its buses left it and where they came back, less any they passed on the way
 *  round (a stop a detour passes is served). Three buses in a row the same way round closes them, as an alert would;
 *  two only says they may be (a.maybe: nothing dropped from the times). A way round the agency already has every stop
 *  of in a notice in force adds nothing. For now only with the switch on (?detours in the address). */
const TRACK_ON = 45;   // metres from a way round a stop is on it
function trackedAlerts(list, byStop) {
  const ymd = now().ymd, out = [];
  for (const d of list) {
    if (d.streak < 2) continue;
    const ris = D.routes.map((r, i) => i).filter(i => D.routes[i].short.split(' ')[0] === d.route);
    const [lat0, lon0] = d.leaves, [lat1, lon1] = d.rejoins;
    const gone = new Set();
    for (const ri of ris) for (const seq of Object.values(D.routes[ri].stops || {})) {
      // The stops near where the buses left the line and near where they came back, the closest pair in order: a line
      // that passes the same corner twice (out and back) would otherwise take in the whole run between.
      const near = (lat, lon) => seq.map((si, k) => distance(lat, lon, D.stops[si].lat, D.stops[si].lon) < 300 ? k : -1).filter(k => k >= 0);
      let i = -1, j = -1;
      for (const a of near(lat0, lon0)) for (const b of near(lat1, lon1)) if (b > a && (i < 0 || b - a < j - i)) { i = a; j = b; }
      if (i < 0) continue;
      for (const si of seq.slice(i, j + 1)) { const s = D.stops[si]; if (!s.hub && pathDistance(s.lat, s.lon, d.path) > TRACK_ON) gone.add(s.id); }
    }
    const ids = [...gone];
    if (!ids.length) continue;
    const posted = ids.every(id => (byStop[id] || []).some(a => alertOn(a, ymd) && ris.some(ri => a.ri.includes(ri))));
    if (posted) continue;
    const n = d.streak, who = ris.length ? routeWord(ris[0]) : 'Route ' + d.route, since = clockText(now(new Date(d.first * 1000)).min);
    const how = n >= 4 ? `every ${who} bus since ${since}, ${n} in a row, has gone another way` : `the last ${n} ${who} buses went another way`;
    const word = n >= 4 ? 'are closed' : n === 3 ? 'are likely closed' : 'may be closed';
    out.push({ id: 'trk' + d.id, tracked: d, title: `${who} is going another way`, text: ` ${D.agency.brand} hasn't posted this, but ${how}, so ${ids.length === 1 ? 'a stop' : ids.length + ' stops'} on its usual way ${word}.`,
      url: '', start: d.first, end: null, routes: [], ri: ris, stops: n >= 3 ? ids : [], maybe: n >= 3 ? [] : ids, names: null });
  }
  return out;
}
const routeWord = ri => { const r = D.routes[ri]; return /^[A-Z]$/.test(r.short) ? r.long : 'Route ' + r.short.split(' ')[0]; };
/** Metres from a point to a path of [lat, lon] points. */
function pathDistance(lat, lon, path) {
  const k = 111320 * Math.cos(lat * Math.PI / 180), xy = ([a, b]) => [(b - lon) * k, (a - lat) * 110540];
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay] = xy(path[i]), [bx, by] = xy(path[i + 1]), dx = bx - ax, dy = by - ay, n = dx * dx + dy * dy;
    const f = n ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / n)) : 0;
    best = Math.min(best, Math.hypot(ax + f * dx, ay + f * dy));
  }
  return path.length === 1 ? distance(lat, lon, path[0][0], path[0][1]) : best;
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
/** When the last of some alerts ends, as ymd, for 'the detour ends Tue 29 Sep'; null when none says. An
 *  alert naming a day in its title ends that day. */
export function alertsUntil(alerts) {
  let last = null;
  for (const a of alerts) { const e = a.names && (!a.end || a.names > endDay(a)) ? a.names : a.end ? endDay(a) : null; if (e && (!last || e > last)) last = e; }
  return last;
}
/** The day an alert ends. Posted to end at midnight (the last minute of a day), it ends some time the next day, the
 *  hour not said: the Route 2 and 5 detours on 200 East were posted to end Tue 29 Sep 11:59 PM, dropped from the
 *  notices at midnight, and the stops were still closed Wednesday afternoon ('ending Wednesday' is some time
 *  Wednesday). Closed through that day, as 'until the detour ends, later today'; one ending at an hour ends then. */
const endDay = a => {
  const e = ymdOf(a.end), t = (hmFmt ||= new Intl.DateTimeFormat('en-GB', { timeZone: D.agency.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })).format(new Date(a.end * 1000));
  return t === '23:59' ? dayFrom(e, 1).ymd : e;
};
let hmFmt = null;
export const alertOn = (a, ymd) => (!a.start || ymdOf(a.start) <= ymd) && (!a.end || endDay(a) >= ymd || (a.names && a.names >= ymd)) && !doneToday(a, ymd);
/** On its last day an alert is over when its buses are: a day's detour posted until midnight stops marking stops
 *  after its routes' last trips have run (the whole system's, for an alert naming none), with time for a late one:
 *  a route's last run is on time, near enough, but a loop's can be half an hour behind. */
function doneToday(a, ymd) {
  if (!a.end) return false;
  const e = endDay(a), last = a.names && a.names > e ? a.names : e;
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
  for (const a of stopAlerts(si, ymd)) if (!(a.maybe || []).includes(D.stops[si].id)) for (const ri of a.ri) out.add(ri);
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
/** A route's family: the halves a timetable splits one route into by time of day (Connect's 16 AM and 16 PM, a few
 *  runs each), one route to a rider. Itself alone for most. */
export const familyKey = ri => D.routes[ri].short.replace(/\s+(AM|PM)$/i, '');
export const family = ri => D.routes.map((r, i) => i).filter(i => familyKey(i) === familyKey(ri));
/** Of a route's family, the half on the road now or next today (its soonest run not yet finished); the route itself
 *  when it's alone or nothing more runs today. */
export function familyNow(ri, clockNow) {
  const fam = family(ri);
  if (fam.length < 2) return ri;
  let best = null;
  for (const r of fam) {
    const done = new Set();
    for (const si of new Set(Object.values(D.routes[r].stops || {}).flat())) for (const t of timesOn(si, clockNow.ymd)) {
      if (t.r !== r || done.has(t.trip)) continue;
      done.add(t.trip);
      const st = tripStops(t.trip), te = tripEnd(t.trip);
      if (!st.length || (te ? te.min : st[st.length - 1][0]) < clockNow.min) continue;
      const k = Math.max(st[0][0], clockNow.min);
      if (!best || k < best.k) best = { r, k };
    }
  }
  return best ? best.r : ri;
}
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
    // A late bus is still coming: today's rows from an hour and a half back, each with the feed's word. Only those, and
    // only the route asked for: every row of the day through the feed made the Transit Center's board, a bay's day of
    // every route's departures for each route's next three, a beat on a phone.
    if (day === 0) rows = rows.filter(t => t.min >= clockNow.min - 90 && (!filter || filter(t))).map(live).filter(t => !t.gone && t.min >= clockNow.min).sort((a, b) => a.min - b.min);
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
