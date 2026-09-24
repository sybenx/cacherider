// Clock and calendar arithmetic, all in the agency's own time zone. Every
// departure is minutes past midnight of its service day; a service day can run
// past 24:00, so a minute may be 1500 and still belong to "today".

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let tz = 'America/Denver';
export function setZone(z) { tz = z || tz; }

let fmt;
function parts(date) {
  fmt = fmt || new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  const o = {};
  for (const p of fmt.formatToParts(date)) o[p.type] = p.value;
  return o;
}

/** The agency's wall clock right now: { ymd: '20260924', dow: 0-6, min, sec }. */
export function now(date = new Date()) {
  const p = parts(date);
  return {
    ymd: p.year + p.month + p.day,
    dow: DAY_SHORT.indexOf(p.weekday),
    min: parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10),
    sec: parseInt(p.second, 10),
  };
}

/** A calendar day as a plain object, shifted by whole days without any time zone drama. */
export function dayFrom(ymd, offset = 0) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + offset));
  return { ymd: d.toISOString().slice(0, 10).replace(/-/g, ''), dow: d.getUTCDay(), date: d };
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

/** Minutes past midnight → { h: '8:06', ap: 'AM' }. */
export function clock(min) {
  const m = ((min % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60), mm = m % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return { h: h + ':' + String(mm).padStart(2, '0'), ap };
}
export function clockText(min) { const c = clock(min); return c.h + ' ' + c.ap; }

/** A list of minutes → '8:17, 8:33 AM' (the meridiem once, as the design writes it). */
export function clockList(mins) {
  if (!mins.length) return '';
  const cs = mins.map(clock);
  const same = cs.every(c => c.ap === cs[0].ap);
  return same ? cs.map(c => c.h).join(', ') + ' ' + cs[0].ap : cs.map(c => c.h + ' ' + c.ap).join(', ');
}

/** 'in 14 min', 'in 1 h 14 min', 'later today', 'this evening', 'tomorrow', 'tomorrow, Fri', 'Monday'. */
export function relative(dep, clockNow, opts = {}) {
  const diff = dep.min - clockNow.min + dep.day * 1440;
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

export function metres(m) {
  if (m < 950) return Math.round(m / 10) * 10 + ' m';
  return (m / 1000).toFixed(1) + ' km';
}
