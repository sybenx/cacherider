// Clock and calendar arithmetic, all in the agency's own time zone. Every
// departure is minutes past midnight of its service day; a service day can run
// past 24:00, so a minute may be 1500 and still belong to "today".

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let tz = 'America/Denver';
export function setZone(z) { tz = z || tz; }

let fmt;
function parts(date) {
  fmt = fmt || new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  const o = {};
  for (const p of fmt.formatToParts(date)) o[p.type] = p.value;
  return o;
}

/** The agency's wall clock right now: { ymd: '20260924', dow: 0-6, min, sec }. Worked out once a second: the planner
 *  asks thousands of times in a search (every departure weighed asks), and Intl's formatting was half its time. */
let nowAt = 0, nowWas = null;
export function now(date) {
  const own = date === undefined, ms = own ? Date.now() : date.getTime();
  if (own && nowWas && ms - nowAt < 1000 && ms >= nowAt) return nowWas;
  const p = parts(own ? new Date(ms) : date);
  const c = {
    ymd: p.year + p.month + p.day,
    dow: DAY_SHORT.indexOf(p.weekday),
    min: parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10),
    sec: parseInt(p.second, 10),
  };
  if (own) { nowAt = ms; nowWas = c; }
  return c;
}

/** A calendar day as a plain object, shifted by whole days without any time zone drama. */
const days = new Map();   // by day and shift: asked for on every departure the planner weighs
export function dayFrom(ymd, offset = 0) {
  const key = ymd + ':' + offset;
  if (days.has(key)) return days.get(key);
  if (days.size > 2000) days.clear();
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + offset));
  const out = { ymd: d.toISOString().slice(0, 10).replace(/-/g, ''), dow: d.getUTCDay(), date: d };
  days.set(key, out);
  return out;
}

export function dayDiff(fromYmd, toYmd) {
  return Math.round((dayFrom(toYmd).date - dayFrom(fromYmd).date) / 86400000);
}

/** '20260928' → 'Mon 28 Sep'; long: 'Monday 28 Sep'. */
export function fmtDay(ymd, long = false) {
  const d = dayFrom(ymd);
  return (long ? DAY_NAMES[d.dow] : DAY_SHORT[d.dow]) + ' ' + d.date.getUTCDate() + ' ' + MON_SHORT[d.date.getUTCMonth()];
}
export function dayName(ymd, short = false) { const d = dayFrom(ymd); return short ? DAY_SHORT[d.dow] : DAY_NAMES[d.dow]; }

// 12- or 24-hour: the rider's choice on the About page, else their region's custom. A web page can't see the
// phone's own 24-hour switch, only its language and region, so a US phone starts at 12-hour whatever it's set to.
let h24 = (() => {
  let s = null;
  try { s = localStorage.getItem('cr-clock'); } catch { /* storage refused: go by the region */ }
  if (s === '12' || s === '24') return s === '24';
  try { const c = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle; return c === 'h23' || c === 'h24'; } catch { return false; }
})();
export const is24 = () => h24;
export function set24(on) { h24 = on; try { localStorage.setItem('cr-clock', on ? '24' : '12'); } catch { /* kept for this visit only */ } }

/** Minutes past midnight → { h: '8:06', ap: 'AM' }, or { h: '15:10', ap: '' } on a 24-hour clock. */
export function clock(min) {
  const m = ((min % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60), mm = m % 60;
  if (h24) return { h: String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0'), ap: '' };
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return { h: h + ':' + String(mm).padStart(2, '0'), ap };
}
export function clockText(min) { const c = clock(min); return c.ap ? c.h + ' ' + c.ap : c.h; }
/** On the hour, short: '7 AM'; a 24-hour clock keeps its minutes, '07:00'. */
export function clockShort(min) { return h24 ? clockText(min) : clockText(min).replace(':00', ''); }

/** A list of minutes → '8:17, 8:33 AM' (the meridiem once, as the design writes it). */
export function clockList(mins) {
  if (!mins.length) return '';
  const cs = mins.map(clock);
  const same = cs.every(c => c.ap === cs[0].ap);
  return same ? (cs.map(c => c.h).join(', ') + ' ' + cs[0].ap).trim() : cs.map(c => c.h + ' ' + c.ap).join(', ');
}

// ---- The one clock rule for a bus's time, on every screen (2026-10-07: nine had grown, and a late bus said 'left' on
// the route sheet while its own row said 'now'). Whole minutes, a minute running from its start: a time is due
// ('now') from the start of its minute (a bus at 8:05:59 is 'now' from 8:05:00), and gone from the start of the next.
// Its minute is the feed's where it has one (a late bus is still coming), the timetable's where not. 'Here' is the
// other question, a bus at the stop by where it is (usu.js, rt.js, hub.js), never decided by the clock.
/** Minutes until a time (`day` days on): 0 or less, it's due. */
export const minsTo = (t, clockNow) => t.min - clockNow.min + (t.day || 0) * 1440;
/** Due now: its minute has begun. */
export const isDue = (t, clockNow) => minsTo(t, clockNow) <= 0;
/** Gone: the feed says it left, or the minute after its own has begun. */
export const isGone = (t, clockNow) => !!t.gone || minsTo(t, clockNow) < 0;

/** 'in 14 min', 'in 1 h 14 min', 'later today', 'this evening', 'tomorrow', 'tomorrow, Fri', 'Monday'. */
export function relative(dep, clockNow, opts = {}) {
  const diff = minsTo(dep, clockNow);
  if (dep.day === 0 || diff < 180) {
    if (diff <= 0) return 'now';
    if (diff < 60) return 'in ' + diff + ' min';
    if (diff <= 180) return 'in ' + Math.floor(diff / 60) + ' h ' + (diff % 60) + ' min';
    return (dep.min % 1440) >= 17 * 60 ? 'this evening' : 'later today';
  }
  if (dep.day === 1) return opts.dayShort ? 'tomorrow, ' + dayName(dayFrom(clockNow.ymd, 1).ymd, true) : 'tomorrow';
  return dayName(dayFrom(clockNow.ymd, dep.day).ymd);
}

/** 'in 8 min' for the pulse, or the m:ss countdown when inside ten minutes. */
export function countdown(depMin, clockNow) {
  const s = (depMin - clockNow.min) * 60 - clockNow.sec;
  if (s <= 0) return '0:00';
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/** Headway between departures, when they are regular: 'Every 30 min until 8:36 PM'. */
export function cadence(mins) {
  if (mins.length < 3) return '';
  const gaps = mins.slice(1).map((m, i) => m - mins[i]);
  const g = gaps[0];
  if (gaps.every(x => Math.abs(x - g) <= 2)) return 'Every ' + g + ' min until ' + clockText(mins[mins.length - 1]);
  return '';
}

// Miles or kilometres: the rider's choice on the About page, miles until they choose; these are American streets.
let km = (() => { try { return localStorage.getItem('cr-units') === 'km'; } catch { return false; } })();
export const isKm = () => km;
export function setKm(on) { km = on; try { localStorage.setItem('cr-units', on ? 'km' : 'mi'); } catch { /* kept for this visit only */ } }

/** A height in the rider's units: '130 ft', or '40 m'. */
export const heightOf = m => km ? Math.max(1, Math.round(m)) + ' m' : Math.max(10, Math.round(m / 0.3048 / 10) * 10) + ' ft';
/** A distance in the rider's units: '130 ft', '0.4 mi', or '40 m', '1.2 km'. */
export function metres(m) {
  if (km) return m < 950 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1) + ' km';
  const ft = m / 0.3048;
  if (ft < 1000) return Math.max(10, Math.round(ft / 10) * 10) + ' ft';
  const mi = m / 1609.344;
  return (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + ' mi';
}
