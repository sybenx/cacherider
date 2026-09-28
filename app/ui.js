// Small HTML helpers: escaping, the route badge, the clock time, the icons.
import { D, route, stop, A, stopAlerts, lastRun, routeOrder, nextAt, dirName } from './data.js';
import { predict, lateWords, isLoop, loopSpacing } from './rt.js';
import { pointerMark } from './pointer.js';
import { clock, clockText, relative, dayName, now, metres } from './time.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const part = v => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : v == null || v === false ? '' : esc(v);
export const html = (strings, ...vals) => new Raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? part(vals[i]) : ''), ''));
export const raw = s => new Raw(s);
html.raw = raw;

const I = {
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  pointer: '<path d="M12 3 19 20 12 16 5 20z" fill="currentColor"/>',
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  fwd: '<path d="m9 18 6-6-6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  near: '<path d="M2 12h3M19 12h3M12 2v3M12 19v3"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  swap: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>',
  sunmoon: '<circle cx="12" cy="12" r="5"/><path d="M12 7a5 5 0 0 1 0 10Z" fill="currentColor"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M4.9 19.1l1.4-1.4M2 12h2"/>',
  stops: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  map: '<path d="M14.1 6 9 3 3 6v15l6-3 5.1 3L21 18V3z"/><path d="M9 3v15M14.1 6v15"/>',
  hub: '<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C21.1 6.8 20.1 6 19 6H5c-1.1 0-2.1.8-2.4 1.8L1.2 12.8c-.1.4-.2.8-.2 1.2 0 .4.1.8.2 1.2L2 18h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="M12 4.5 15 12H9z" fill="currentColor"/><path d="M12 19.5 15 12H9z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  share: '<path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M8 10H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2"/>',
  plusSquare: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 12h8M12 8v8"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  walk: '<circle cx="13.5" cy="4" r="1.6"/><path d="m9 21 2.5-6.5"/><path d="m12.5 15 2.5 6"/><path d="M7.5 12.5 10 8.5l3.5-1 2.5 3.5 3 1"/><path d="m10 8.5-1.5 5.5"/>',
  install: '<path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
};
export const icon = (name, size = 20, sw = 1.5, fill = 'none') => raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name]}</svg>`);

/** The route badge in the agency's colour. '16 AM' sets its suffix small, as the design draws it. */
export function badge(ri, size = 36) {
  const r = route(ri);
  const m = /^(\S+)\s+(\S+)$/.exec(r.short);
  const label = m ? esc(m[1]) + '<small>' + esc(m[2]) + '</small>' : esc(r.short);
  return raw(`<span class="badge badge-${size}" style="background:#${r.color};color:#${r.text}" title="${esc(r.long)}">${label}</span>`);
}
export function badges(ris, size = 24, wide = false) {
  return raw(`<div class="badges${wide ? ' wide' : ''}">${ris.map(ri => badge(ri, size).s).join('')}</div>`);
}

/** A stop's route badges, each a link to its route's page: in the direction that calls here, landing on this stop. */
export function routeLinks(si, size = 30) {
  return raw(`<div class="badges wide">${routeLinkItems(si, size)}</div>`);
}
export function routeLinkItems(si, size = 30) {
  return stop(si).routes.map(ri => routeBadgeLink(ri, si, size)).join('');
}
/** One route badge as a link to the route's page, landing on this stop: in `dir` when that direction calls here
 *  (a departure knows its own), else the first that does. */
export function routeBadgeLink(ri, si, size, dir) {
  const r = D.routes[ri], dirs = Object.keys(r.stops || {});
  const d = dir !== undefined && routeOrder(ri, String(dir)).includes(si) ? String(dir) : dirs.find(k => routeOrder(ri, k).includes(si)) ?? dirs[0] ?? '0';
  return `<a class="badgelink" href="#/route/${encodeURIComponent(r.short)}/${d}/${esc(stop(si).id)}" aria-label="Route ${esc(r.short)}: every stop">${badge(ri, size).s}</a>`;
}

/** '8:06 AM' as the heading type, the meridiem small. */
/** '8:06 AM' as the heading type, the meridiem small; `est` sets it in the live-estimate blue. */
export function time(min, size = 26, est = false) {
  const c = clock(min);
  return raw(`<span class="t t-${size}${est ? ' est' : ''}">${c.h}<small>${c.ap}</small></span>`);
}

export const sched = t => raw(t && t.req
  ? `<span class="sched req" title="The bus calls here this way only when asked: pull the cord to get off, or call ${esc(D.agency.phone)} ahead to be picked up">On request</span>`
  : `<span class="sched">${icon('clock', 11).s}Scheduled</span>`);
export const corners = () => raw('<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>');

/** What a departure is headed for: 'to N Logan · CV Hospital', 'to Preston', 'Island · Wilson · Tabernacle', 'Green
 *  Loop'. The feed's headsign where it names a place; where it only says 'Southbound' or 'Route 06', where the way
 *  ends by the timetable (`dirName`), and the feed's word only when that can't be told. */
export function headsign(t) {
  const h = D.headsigns[t.h], r = route(t.r);
  if (h && /loop$/i.test(h)) return h;
  const generic = !h || h === r.long || /^(north|south|east|west)bound$|^(inbound|outbound)$|^route\s*\d+$/i.test(h);
  if (!generic) return 'to ' + h;
  const n = t.dir !== undefined ? dirName(t.r, t.dir) : null;
  if (n) return n.places ? n.text : 'to ' + n.text;
  return h || r.long;
}

/** One departure row: badge · headsign + Scheduled · time + relative. */
export const liveMark = (text = 'Live') => raw(`<span class="livetag"><i></i>${esc(text)}</span>`);
/** The bare tag for a row: 'Live', or 'Estimated' where the minute comes from the bus's place rather than the feed's word. */
export const liveTag = t => liveMark(t.live && t.live.est ? 'Estimated' : 'Live');
/** The feed's word on a departure, when it has one: the row then shows the predicted time. */
export function lively(t) {
  if (t.live || t.gone) return t;
  const p = predict(t);
  return !p ? t : p.gone ? { ...t, gone: true } : { ...t, min: p.min, live: p };
}
/** The timetable's minute for a departure, live or not. The big time is always this one. */
export const schedOf = t => t.live ? t.min - t.live.delay : t.min;
export { isLoop };
/** A route as riders say it: 'Route 12', or a loop by its name, 'the Blue Loop'. Never 'Route B'. */
export const routeName = (ri, the = true) => isLoop(ri) ? (the ? 'the ' : '') + D.routes[ri].long : 'Route ' + D.routes[ri].short;
/** Several: 'Routes 2, 3 and 5', 'Route 12 and the Blue Loop', 'the Blue and Green Loops'. */
export function routeNames(ris) {
  const nums = [...new Set(ris.filter(ri => !isLoop(ri)))].sort((a, b) => +D.routes[a].short - +D.routes[b].short || D.routes[a].short.localeCompare(D.routes[b].short)).map(ri => D.routes[ri].short);
  const loops = [...new Set(ris.filter(isLoop))].map(ri => D.routes[ri].long);
  const and = xs => xs.length > 1 ? xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1] : xs[0] || '';
  const num = nums.length ? (nums.length > 1 ? 'Routes ' : 'Route ') + and(nums) : '';
  const lp = loops.length > 1 && loops.every(l => / Loop$/.test(l)) ? 'the ' + and(loops.map(l => l.replace(/ Loop$/, ''))) + ' Loops' : loops.length ? 'the ' + and(loops) : '';
  return [num, lp].filter(Boolean).join(' and ');
}
/** 'Live · 3 min late'; 'Estimated · …' where the minute is worked out from the bus's place, not the feed's word. */
export const liveWord = t => isLoop(t.r) ? (t.live.est ? 'Estimated' : 'Live') : (t.live.est ? 'Estimated · ' : 'Live · ') + lateWords(t.live.delay);
/** A loop spacing its buses, away from the Transit Center: its timetable means nothing then, so its rows give
 *  only how long till the bus is there. */
export const loopArrival = t => !!t.live && isLoop(t.r) && !D.stops[t.si]?.hub && loopSpacing(t.r);
/** '4 MIN' in a time's place, or 'NOW'. */
export function minsOut(t, size = 26, clockNow = now()) {
  const m = t.min - clockNow.min;
  return raw(`<span class="t t-${size} est">${m <= 0 ? 'NOW' : m + `<small>MIN</small>`}</span>`);
}
/** A departure's time: the timetable's in black, or the feed's estimate in blue, with the timetable's crossed out
 *  beside it when the feed has moved it. A spacing loop's, away from the Transit Center, is minutes out. */
export function when(t, size = 26) {
  return whenRaw(t, size);
}
function whenRaw(t, size) {
  if (loopArrival(t)) return minsOut(t, size);
  if (!t.live) return time(t.min, size);
  if (!t.live.delay) return time(t.min, size, true);
  return raw(`<span class="whent"><s class="was" style="font-size:${Math.max(12, Math.round(size * .55))}px">${esc(clock(schedOf(t)).h)}</s>${time(t.min, size, true).s}</span>`);
}
/** For the big displays, a line above the estimate saying what the crossed-out time is: 'Scheduled ~~3:15 PM~~'. */
export function wasLine(t) {
  if (!t.live || !t.live.delay || loopArrival(t)) return raw('');
  return raw(`<span class="wasline">Scheduled <s>${esc(clockText(schedOf(t)))}</s></span>`);
}
/** The night's-end word on a departure, when it's a route's last full run or its partial last run from here. */
export function lastTag(t) {
  const w = lastRun(t);
  return raw(w ? `<span class="lastrun">${esc(w)}</span>` : '');
}
/** One departure row: badge · headsign + Live or Scheduled · the time (crossed out and estimated when moved) + how long. */
export function depRow(t0, clockNow, opts = {}) {
  const t = lively(t0);
  const rel = opts.rel || relative(t, clockNow, opts);
  const sub = opts.sub ? `<span class="sub">${esc(opts.sub)}</span>` : t.live ? liveMark(liveWord(t)).s : sched(t).s;
  const b = t.si !== undefined ? routeBadgeLink(t.r, t.si, 36, t.dir) : badge(t.r, 36).s;
  return raw(`<div class="row${opts.href ? ' tap' : ''}">${b}<div class="mid"><span class="name">${esc(opts.name || headsign(t))}</span>${sub}${lastTag(t).s}</div><div class="end">${when(t, 26).s}${loopArrival(t) ? '' : `<span class="rel${opts.warn ? ' warnmark' : ''}">${esc(rel)}</span>`}</div></div>`);
}

/** A stop row for the home and search lists, with its next bus on the right. */
export function stopRow(si, next0, clockNow, opts = {}) {
  const s = stop(si);
  const next = next0 ? lively(next0) : next0;
  const end = next
    ? `<div class="end"><div class="when">${badge(next.r, 20).s}${when(next, 22).s}</div>${loopArrival(next) ? '' : `<span class="rel">${esc(relative(next, clockNow))}</span>`}${next.live ? liveTag(next).s : sched(next).s}</div>`
    : `<div class="end"><span class="rel${opts.warn ? ' warnmark' : ''}">${esc(opts.none || 'No service today')}</span></div>`;
  const town = s.town && s.town !== 'Logan' ? `<span class="town">, ${esc(s.town)}</span>` : '';
  const num = s.hub ? '' : 'Stop ' + (s.code || s.id);
  const alert = A.byStop[s.id] && stopAlerts(si, clockNow.ymd).length ? '<span class="alert">Detour</span>' : '';
  const way = opts.point ? pointerMark(s.lat, s.lon, opts.point) + (num ? ' · ' : '') : '';
  const dist = `<span class="dist">${way}${esc([opts.dist, s.by, num].filter(Boolean).join(' · '))}${alert ? (opts.dist || num || way ? ' · ' : '') + alert : ''}</span>`;
  return raw(`<a class="stoprow${opts.here ? ' here' : ''}"${opts.here ? ' id="here"' : ''} href="#/stop/${esc(s.id)}"><div class="mid"><span class="name">${esc(opts.name || s.name)}${town}</span>${dist}${badges(s.routes, 24).s}</div>${end}</a>`);
}

export function stopTitle(si) {
  const s = stop(si);
  return s.town && s.town !== 'Logan' ? s.name + ', ' + s.town : s.name;
}

/** Which side of the road a stop is: the direction its buses mostly run. */
export function side(si) {
  const per = D.times[si] || {};
  const count = {};
  for (const list of Object.values(per)) for (const t of list) {
    const h = D.headsigns[t[2]];
    if (/bound$/i.test(h)) count[h] = (count[h] || 0) + 1;
  }
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : '';
}

export const dayWord = (t, clockNow) => t.day === 0 ? '' : t.day === 1 ? 'tomorrow' : dayName(t.ymd);

/** The stop across the road, the stop for the other way and the commonest wrong one to stand at: one pill wherever
 *  it's offered, with that side's next bus. `dest` adds where that bus is going ('to Transit Center'), which anyone
 *  can use where a compass word can't; it's the first thing cut when the pill runs short. A link to that stop's page;
 *  on the map's card, a button that swaps the card to it. */
export function acrossPill(si, clockNow, { button = false, dest = false } = {}) {
  const [ti, td] = stop(si).twin, t = stop(ti), n = nextAt(ti, 1, clockNow)[0], sd = side(ti);
  dest = dest && n && tellsApart(n);
  const title = esc(`${t.name}${sd ? ' · ' + sd : ''} · ${metres(td)}`);
  const inner = `${icon('swap', 14).s}<span class="tw-way">Across the road</span>${n ? `<span class="tw-t">· ${esc(clockText(n.min))}</span>` : ''}${dest ? `<span class="tw-d">· ${esc(headsign(n))}</span>` : ''}`;
  return raw(button ? `<button class="twinline" type="button" data-twin="${esc(t.id)}" title="${title}">${inner}</button>` : `<a class="twinline" href="#/stop/${esc(t.id)}" title="${title}">${inner}</a>`);
}

/** The stop page's own: a row, not a pill. Which way it serves and how far, its name, and its next bus at the
 *  right the size of the departures beneath, live when the feed knows; where the destination tells the sides
 *  apart, that too. It answers the question a rider at the wrong stop has: is it this side, or that one? */
export function acrossRow(si, clockNow) {
  const [ti, td] = stop(si).twin, t = stop(ti), n = nextAt(ti, 1, clockNow)[0], sd = side(ti);
  const dest = n && tellsApart(n) ? headsign(n) : '';
  const end = n
    ? `<span class="when">${badge(n.r, 20).s}${time(n.min, 20, !!n.live).s}</span><span class="rel">${esc(relative(n, clockNow))}</span>${n.live ? liveTag(n).s : sched(n).s}`
    : '<span class="rel">No service today</span>';
  return raw(`<a class="acrossrow" href="#/stop/${esc(t.id)}">${icon('swap', 18).s}
    <span class="mid"><span class="eyebrow">Across the road${sd ? ' · ' + esc(sd) : ''} · ${esc(metres(td))}</span><span class="name">${esc(t.name)}</span>${dest ? `<span class="sub">${esc(dest)}</span>` : ''}</span>
    <span class="end">${end}</span></a>`);
}

/** Whether a bus's destination tells the two ways of its route apart: not when the timetable gives both ways one
 *  label (1, 2 and 5 go out and come back under the same words) or only the route's own name ('Route 03'). Better
 *  no destination than one that reads the same on both sides of the road. */
let wayLabels = null;
function tellsApart(t) {
  if (!wayLabels) {
    wayLabels = new Map();   // route → direction → its labels
    for (const per of Object.values(D.times)) for (const list of Object.values(per)) for (const x of list) {
      const byDir = wayLabels.get(x[1]) || wayLabels.set(x[1], new Map()).get(x[1]);
      (byDir.get(x[3]) || byDir.set(x[3], new Set()).get(x[3])).add(x[2]);
    }
  }
  if (headsign(t) === route(t.r).long && !isLoop(t.r)) return false;   // a loop's name is its way: it runs only one
  const other = (wayLabels.get(t.r) || new Map()).get(1 - t.dir);
  return !other || !other.has(t.h);
}
