// Small HTML helpers: escaping, the route badge, the clock time, the icons.
import { D, route, stop, A, stopAlerts, lastRun, routeOrder, nextAt, dirName, activeAlerts, maySkip, skipsAt, closedThrough, familyKey, family, isHalf, opOf, roadOf, kinOf } from './data.js';
import { predict, lateWords, isLoop, loopSpacing } from './rt.js';
import { pointerMark } from './pointer.js';
import { iconSvg } from './icons.js';
import { clock, clockText, relative, now, metres, minsTo, isDue, dayFrom, dayName, fmtDay } from './time.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const part = v => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : v == null || v === false ? '' : esc(v);
export const html = (strings, ...vals) => new Raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? part(vals[i]) : ''), ''));
export const raw = s => new Raw(s);
/** A sheet or card put away, to the map (or wherever `h` is): Back to it when it's the address before this one, so
 *  the history doesn't gain the map again (Back then reopened what was put away); else this address turned into it,
 *  in place. Each entry's `prev` is stamped by main.js the first time it's drawn. */
export function closeTo(h) {
  const s = history.state;
  if (s && s.prev === h) { history.back(); return; }
  replaceTo(h);
}
/** An address in place of this one, the same step in the history: its state kept (the address before it, which
 *  closeTo goes by). location.replace leaves none, and the entry was stamped with the address it replaced. */
export function replaceTo(h) {
  history.replaceState(history.state, '', h); window.dispatchEvent(new HashChangeEvent('hashchange'));
}
html.raw = raw;

export const icon = (name, size = 20, sw = 1.5, fill = 'none') => raw(iconSvg(name, size, sw, fill));

/** The route badge in the agency's colour. A route the timetable splits by time of day (16 AM and 16 PM) is one route
 *  to a rider, one badge, its number alone: which half, where it matters, is said in words (its page). */
export function badge(ri, size = 36) {
  const r = route(ri), label = isHalf(ri) ? familyKey(ri) : r.short;
  return raw(`<span class="badge badge-${size}" data-r="${ri}" style="background:#${r.color};color:#${r.text}" title="${esc(routeName(ri, false))}">${esc(label)}</span>`);
}
/** Badges for routes, one a family (a stop of both 16s has one 16). */
export const oneEach = ris => [...new Map(ris.map(ri => [familyKey(ri), ri])).values()];
export function badges(ris, size = 24, wide = false) {
  return raw(`<div class="badges${wide ? ' wide' : ''}">${oneEach(ris).map(ri => badge(ri, size).s).join('')}</div>`);
}
/** A route's page: a family's by its number ('#/map/route/16'), which opens the half on the road now or next. */
export const routeHref = ri => '#/map/route/' + encodeURIComponent(isHalf(ri) ? familyKey(ri) : D.routes[ri].short);
/** Every route once, for a list or a grid of them: the timetable's order, a family once, and another operator's route
 *  on a route's road right after it (Route 16, then the Preston commuter, its midday run). `others`: the operators'
 *  routes on no road of the agency's, left for a list of their own. */
export function routeList() {
  const out = [], others = [];
  for (const ri of D.routes.keys()) {
    if (opOf(ri)) { if (roadOf(ri) === null) others.push(ri); continue; }
    if (out.some(x => !opOf(x) && familyKey(x) === familyKey(ri))) continue;
    out.push(ri, ...kinOf(ri));
  }
  return { list: out, others };
}

/** A stop's route badges, each a link to its route's page: in the direction that calls here, landing on this stop. */
export function routeLinks(si, size = 30) {
  return raw(`<div class="badges wide">${routeLinkItems(si, size)}</div>`);
}
export function routeLinkItems(si, size = 30) {
  return oneEach(stop(si).routes).map(ri => routeBadgeLink(ri, si, size, undefined, true)).join('');
}
/** One route badge as a link to the route's page, landing on this stop: in `dir` when that direction calls here
 *  (a departure knows its own), else the first that does. `any`: a family's badge, to whichever half is on the road
 *  now or next here (main.js); else this half's, a departure's own. */
export function routeBadgeLink(ri, si, size, dir, any = false) {
  const fam = any && isHalf(ri) ? family(ri).filter(x => Object.values(D.routes[x].stops || {}).some(s => s.includes(si))) : [ri];
  const r = D.routes[fam[0] ?? ri], dirs = Object.keys(r.stops || {});
  const on = k => fam.some(x => routeOrder(x, k).includes(si));
  const d = dir !== undefined && on(String(dir)) ? String(dir) : dirs.find(on) ?? dirs[0] ?? '0';
  const href = any ? routeHref(ri) : '#/map/route/' + encodeURIComponent(D.routes[ri].short);
  return `<a class="badgelink" href="${href}/${d}/${esc(stop(si).id)}" aria-label="${esc(routeName(ri, false))}: every stop">${badge(ri, size).s}</a>`;
}

/** '8:06 AM' as the heading type, the meridiem small. */
/** '8:06 AM' as the heading type, the meridiem small; `est` sets it in the live-estimate blue. */
export function time(min, size = 26, est = false) {
  const c = clock(min);
  return raw(`<span class="t t-${size}${est ? ' est' : ''}">${c.h}<small>${c.ap}</small></span>`);
}

export const sched = t => raw(t && t.req
  ? `<span class="sched req" title="The bus calls here this way only when asked: pull the cord to get off, or call ${esc(D.agency.phone)} ahead to be picked up">On request</span>`
  : `<span class="sched">${icon('clock', 11).s}Scheduled${t && t.onTime ? ' · on time' : ''}</span>`);
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
  return !p ? t : p.keeps ? (isLoop(t.r) ? t : { ...t, onTime: true }) : p.gone ? { ...t, gone: true, cancelled: !!p.cancelled, held: p.held } : { ...t, min: p.min, live: p };
}
/** The timetable's minute for a departure, live or not. The big time is always this one. */
export const schedOf = t => t.live ? t.min - t.live.delay : t.min;
/** Moved by the feed enough to say so: two minutes or more, as lateWords says 'late' from. A minute's drift was
 *  crossed out beside 'on time', the two saying different things. */
export const moved = t => !!(t && t.live && Math.abs(t.live.delay || 0) >= 2);
export { isLoop };
/** A route as riders say it: 'Route 12', or a loop by its name, 'the Blue Loop'. Never 'Route B'. Either half of 16
 *  is 'Route 16'. */
export const routeName = (ri, the = true) => isLoop(ri) || named(ri) ? (the ? 'the ' : '') + nameOf(ri) : 'Route ' + familyKey(ri);
/** A route called by a name, not a number, besides the loops: the Pumpkin Walk ('Route Pumpkin Walk', it was); and
 *  another operator's, by its timetable's name ('the Preston / Logan Commuter', not 'Route PRT'). */
export const named = ri => (!/\d/.test(D.routes[ri].short) && D.routes[ri].short.length > 2) || !!D.routes[ri].op;
const nameOf = ri => isLoop(ri) || D.routes[ri].op ? D.routes[ri].long : D.routes[ri].short;
/** Which of its route's buses a bus is (rt.js busNth), in a rider's words and then as Connect's dispatch writes it:
 *  'Bus 2 of 3 · B2', 'Bus 1 of 2 · 12(1)', 'Bus 2 of 2 · 16(2)' (16 AM and PM one route). A route called by a name has
 *  no shorthand to give: 'Bus 2 of 3' alone. Dispatch says 'Blue two', never a bare 'B'. */
export function nthWords(ri, x) {
  const k = familyKey(ri), code = named(ri) ? '' : /^\d+$/.test(k) ? `${k}(${x.n})` : k + x.n;
  return `Bus ${x.n} of ${x.of}` + (code ? ' · ' + code : '');
}
/** Several: 'Routes 2, 3 and 5', 'Route 12 and the Blue Loop', 'the Blue and Green Loops'. A family once: 'Route 16'. */
export function routeNames(ris) {
  const nums = [...new Set(oneEach(ris.filter(ri => !isLoop(ri) && !named(ri))))].sort((a, b) => parseInt(D.routes[a].short) - parseInt(D.routes[b].short) || D.routes[a].short.localeCompare(D.routes[b].short)).map(familyKey);
  const loops = [...new Set(ris.filter(ri => isLoop(ri) || named(ri)))].map(nameOf);
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
  const m = minsTo(t, clockNow);
  return raw(`<span class="t t-${size} est">${isDue(t, clockNow) ? 'NOW' : m + `<small>MIN</small>`}</span>`);
}
/** A departure's time: the timetable's in black, or the feed's estimate in blue, with the timetable's crossed out
 *  beside it when the feed has moved it. A spacing loop's, away from the Transit Center, is minutes out. */
export function when(t, size = 26) {
  return whenRaw(t, size);
}
function whenRaw(t, size) {
  if (loopArrival(t)) return minsOut(t, size);
  if (!t.live) return time(t.min, size);
  if (!moved(t)) return time(t.min, size, true);
  return raw(`<span class="whent"><s class="was" style="font-size:${Math.max(12, Math.round(size * .55)) / 16}rem">${esc(clock(schedOf(t)).h)}</s>${time(t.min, size, true).s}</span>`);
}
/** For the big displays, a line above the estimate saying what the crossed-out time is: 'Scheduled ~~3:15 PM~~'. */
export function wasLine(t) {
  if (!moved(t) || loopArrival(t)) return raw('');
  return raw(`<span class="wasline">Scheduled <s>${esc(clockText(schedOf(t)))}</s></span>`);
}
/** The night's-end word on a departure, when it's a route's last full run or its partial last run from here. */
/** Today's detours as one line, with the page that has them: 'Routes 2 and 5 · 2 detours · details'. The home page's
 *  and the Transit Center's (a route on a detour may not come to its bay as it should). '' when there are none. */
export function detourNotice(clockNow) {
  const detours = activeAlerts(clockNow.ymd).filter(a => (a.stops || []).length || (a.routes || []).length);
  if (!detours.length) return '';
  const rs = [...new Set(detours.flatMap(a => a.ri || []))];
  return raw(`<div class="notice">${icon('ban', 16).s}<span><b>${detours.length} ${detours.length === 1 ? 'detour' : 'detours'}</b>${rs.length ? ' on ' + esc(routeNames(rs).replace(/^Route/, 'route')) : ''} · <a href="#/about/alerts">details</a></span></div>`);
}
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
  // An unannounced detour may be taking this route round the stop: the time kept, a question beside it.
  const u = t.si !== undefined && maySkip(stop(t.si).id, t.r) && skipsAt(stop(t.si).id).find(u => u.ri.includes(t.r));
  const q = u ? `<span class="sub qnote">The last ${u.n} skipped this stop<span class="qmark">?</span></span>` : '';
  return raw(`<div class="row${opts.href ? ' tap' : ''}">${b}<div class="mid"><span class="name">${esc(opts.name || headsign(t))}</span>${sub}${q}${lastTag(t).s}</div><div class="end">${when(t, 26).s}${loopArrival(t) ? '' : `<span class="rel${opts.warn ? ' warnmark' : ''}">${esc(rel)}</span>`}</div></div>`);
}

/** A run the feed says is cancelled, in a list of departures: its time struck, 'Cancelled', nothing to count down to. */
export function cancelledRow(t) {
  return raw(`<div class="row cancelled">${badge(t.r, 36).s}<div class="mid"><span class="name">${esc(headsign(t))}</span><span class="sub cancelnote">Cancelled</span></div><div class="end"><s class="t t-26">${esc(clock(t.min).h)}</s></div></div>`);
}
/** A stop row for the home and search lists, with its next bus on the right. */
function stopEnd(next, clockNow, opts = {}) {
  return next
    ? `<div class="end"><div class="when">${badge(next.r, 20).s}${when(next, 22).s}</div>${loopArrival(next) ? '' : `<span class="rel">${esc(relative(next, clockNow))}</span>`}${next.live ? liveTag(next).s : sched(next).s}</div>`
    : `<div class="end"><span class="rel${opts.warn ? ' warnmark' : ''}">${esc(opts.none || 'No service today')}</span></div>`;
}
/** The next buses a list's rows were drawn without (stopRow's `later`), put in now. */
export function fillLater(el) {
  const c = now();
  for (const e of el.querySelectorAll('.end[data-later]')) { const n = nextAt(+e.dataset.later, 1, c)[0]; e.outerHTML = stopEnd(n ? lively(n) : n, c); }
}
/** 'Closed' / 'through Sat': a stop shut by notice, in its row's time place; 'for now' where no end is known. */
function closedEnd(last, clockNow) {
  const days = last ? Math.round((dayFrom(last).date - dayFrom(clockNow.ymd).date) / 864e5) : null;
  const when = !last ? 'for now' : days <= 0 ? 'through today' : days === 1 ? 'through tomorrow' : days < 7 ? 'through ' + dayName(last, true) : 'through ' + fmtDay(last);
  return `<div class="end closedend"><span class="t t-22">Closed</span><span class="rel">${when}</span></div>`;
}
export function stopRow(si, next0, clockNow, opts = {}) {
  const s = stop(si);
  const next = next0 ? lively(next0) : next0;
  // bare: no time at all; later: its place kept, the next bus put in after the list is on screen (fillLater)
  // Closed for every route of it by the agency's notices: that, in the time's place, not the first bus after it (a
  // Monday 5:49 AM on a Wednesday evening read as a mistake).
  const shut = opts.bare ? null : closedThrough(si, clockNow.ymd);
  const end = opts.bare ? '' : shut !== null ? closedEnd(shut, clockNow) : opts.later ? `<div class="end" data-later="${si}"></div>` : stopEnd(next, clockNow, opts);
  const town = s.town && s.town !== 'Logan' ? `<span class="town">, ${esc(s.town)}</span>` : '';
  const num = s.hub ? '' : 'Stop ' + (s.code || s.id);
  const alert = A.byStop[s.id] && stopAlerts(si, clockNow.ymd).length ? '<span class="alert">Detour</span>' : skipsAt(s.id).length ? `<span class="qnote">${esc(skipsAt(s.id).map(u => u.who).join(', '))} skipped last ${Math.max(...skipsAt(s.id).map(u => u.n))}<span class="qmark">?</span></span>` : '';
  const way = opts.point ? pointerMark(s.lat, s.lon, opts.point) + (num ? ' · ' : '') : '';
  // `steep`: the walk to it (or, for a place's stops, either way) has a steep climb: said in a word, bold
  const dist = `<span class="dist">${way}${esc([opts.dist, s.by, num].filter(Boolean).join(' · '))}${opts.steep ? ' · <b class="hill steep">Steep</b> walk' : ''}${alert ? (opts.dist || num || way ? ' · ' : '') + alert : ''}</span>`;
  // `dest`: where the next bus goes (a road's stops, both sides: which side is which way)
  const go = opts.dest && next ? `<span class="go">${badge(next.r, 20).s}${esc(headsign(next))}</span>` : '';
  return raw(`<a class="stoprow${opts.here ? ' here' : ''}"${opts.here ? ' id="here"' : ''} href="#/stop/${esc(s.id)}"><div class="mid"><span class="name">${esc(opts.name || s.name)}${town}</span>${go}${dist}${go ? '' : badges(s.routes, 24).s}</div>${end}</a>`);
}

/** A stop by the name a rider hears: the landmark the bus announces ('Blue Square', 'Across from Eccles Ice Center',
 *  the feed's stop_desc), with its street address under it; the address alone where it has none, the Transit Center
 *  by its own name. For where a rider is matching what they hear or see: a route's stops, a bus's next ones, a
 *  run's, a journey's. Where the address is what's looked up (search, a stop's page, near me, a spot's nearest
 *  stops), stopTitle and the address stay first. `heardName` gives the two as words; `heard` as markup, the address
 *  in `.addr` (muted, its own line), `town` (', Hyrum') after the address, or the name when there's no landmark. */
/** A timed stop's mark in a list of a route's stops: the timetable is kept to here, an early bus waiting. */
export const timedMark = () => raw(`<span class="tpmark" title="A timed stop: buses don't leave before their scheduled time">${icon('clock', 12).s}Timed stop</span>`);
export function heardName(si) {
  const s = stop(si);
  return s.hub ? { name: D.hub.name, addr: '' } : s.by ? { name: s.by, addr: s.name } : { name: s.name, addr: '' };
}
export function heard(si, town = '') {
  const h = heardName(si);
  return raw(h.addr ? `${esc(h.name)}<span class="addr">${esc(h.addr + town)}</span>` : esc(h.name + town));
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
