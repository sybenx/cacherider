// The Transit Center as a board: the next time the numbered routes leave together and which of their buses are
// in, the two loops, and every departure in the next hour. The bays are the map's: at high zoom on the Center each
// bay's stop wears its route's badge with where its bus is (bays() below), and a tap on one picks that route here.
import { D, A, nextPulse, nextFromHub, servicesOn, distance, timesOn } from '../data.js';
import { relative, countdown, dayName, clock, now, dayFrom, clockText, clockShort } from '../time.js';
import { html, icon, badge, time, corners, schedOf, lastTag, routeBadgeLink, headsign, liveWord, wasLine, detourNotice } from '../ui.js';
import { rt, rtStale, isLoop, endAt } from '../rt.js';
/** The feed's gone quiet, or couldn't be had: not the moment on opening before its first word comes in, when the board
 *  said 'aren't coming in right now' on every open, a second before they were. */
const rtDown = () => rtStale() && (rt.at > 0 || !!rt.error);

let countIv = 0;   // the pulse countdown's ticker
const IN_RADIUS = 110;   // metres from the hall: a bus this close is in

/** A badge's key: the route's short name, 16 AM and 16 PM as one '16' (they share a bay and a rider). */
/** The scheduled time crossed out, for a time the feed has moved off it: placed before the estimate. */
const was = (sched, est) => html.raw(Math.abs(est - sched) >= 2 ? `<s class="was">${clock(sched).h}</s>` : '');   // moved enough to say so, as ui's moved()

const keyOf = ri => D.routes[ri].short.replace(/\s+(AM|PM)$/, '');
function keys() {
  const out = [];
  for (const b of D.hub.bays) for (const ri of b.routes) if (!out.includes(keyOf(ri))) out.push(keyOf(ri));
  return out;
}
const routesOf = k => D.routes.map((r, i) => i).filter(ri => keyOf(ri) === k && D.hub.bays.some(b => b.routes.includes(ri)));

/** Where a key's bus is and when it leaves: eta 0 when a bus is in, minutes when one is coming, else null, with
 *  `loose` when the bus out has no trip to time it by (off its scheduled trips: a detour) and `away` when it's on a
 *  run that doesn't pass here soon; off when nothing leaves soon and no bus is out. When it leaves is predict()'s. */
function status(k, clockNow) {
  const ris = routesOf(k), loop = isLoop(ris[0]);
  const deps = ris.flatMap(ri => nextFromHub(ri, 3, clockNow)).sort((a, b) => (a.day - b.day) || (a.min - b.min)).slice(0, 3);
  const dep = deps[0];
  let eta = null, loose = false, away = false, bus = null;
  if (!rtStale()) {
    const nowSec = Date.now() / 1000;
    // Buses swap between routes all day (2 and 5, 3 and 8): the bus that runs this route's next departure is the
    // one the feed has on that trip, which may well be out on the other route right now. Only when the feed names
    // none is it any bus showing this route.
    const u0 = dep && dep.day === 0 && dep.trip !== undefined ? rt.trips[D.trips[dep.trip]] : null;
    const own = u0 && u0.v ? rt.buses.find(b => b.id === 'c:' + u0.v) : null;
    for (const b of own ? [own] : rt.buses) {
      if (!own && !ris.includes(b.ri)) continue;
      let e = null;
      const u = rt.trips[b.trip];
      if (distance(b.lat, b.lon, D.hub.lat, D.hub.lon) <= IN_RADIUS) e = 0;
      else if (!u) loose = true;
      else {
        const next = u.stops.filter(([sid, , time, rel]) => rel !== 1 && time >= nowSec - 30 && D.stops[D.stopById[sid]]?.hub).sort((x, y) => x[1] - y[1])[0];
        // Its trip's end: the feed's time, or, where the feed has lost the trip, from where the bus is (in, when it's there).
        const at = next ? (next[1] === u.end ? endAt(b, u) ?? next[2] : next[2]) : null, placed = next && at !== next[2];
        if (next) e = placed && at - nowSec < 60 ? 0 : Math.max(1, Math.round((at - nowSec) / 60)); else { away = true; if (own) bus = bus || b.id; }
      }
      if (e !== null && (eta === null || e < eta)) { eta = e; bus = b.id; }
    }
  }
  const today = !!dep && dep.day === 0;
  if (dep && dep.live && dep.live.here) eta = 0;   // a loop bus waiting at its stop, however far from the hall
  const out = eta !== null || loose || away;
  const off = !today || (!out && dep.min - clockNow.min > 90);
  const leave = dep ? dep.min : null;   // the feed's word, with its bus's arrival, from predict(): every screen agrees
  const late = today && !loop ? Math.max(0, leave - schedOf(dep)) : 0;
  return { k, ris, loop, deps, dep, eta, bus: eta > 0 || (eta === null && away) ? bus : null, out, loose: eta === null && loose, away: eta === null && !loose && away, off, leave, late: late >= 2 ? late : 0 };
}
/** Where a route's card on the board goes: to its bus on the map while it's on its way in or still on the run before
 *  (where is it, and how it comes), else the route picked on the board, or put back. */
const cardHref = (s, pick) => s.bus && pick !== s.k ? '#/map/bus/' + encodeURIComponent(s.bus) : '#/hub' + (pick === s.k ? '' : '/' + s.k);

/** Every key's status, and the picked one: a key, or (from older links) a bay's stop id. */
let stKey = null, stKept = null, stAlerts = null;   // the alerts by the object: a reload is a new one
function board(bay, clockNow) {
  // Worked out once a minute and once a feed, not on every redraw that asks (the board, its badges on the map, the
  // card, all at once): the minute, the feed, the alerts and whether the feed's gone quiet are all it hangs on.
  const key = clockNow.ymd + ':' + clockNow.min + ':' + rt.at + ':' + rtStale();
  if (key !== stKey || A !== stAlerts) { stKey = key; stAlerts = A; stKept = Object.fromEntries(keys().map(k => [k, status(k, clockNow)])); }
  const st = stKept;
  let pick = bay && st[bay] ? bay : null;
  if (bay && !pick) { const b = D.hub.bays.find(x => D.stops[x.stop].id === bay); if (b) pick = keyOf(b.routes[0]); }
  return { st, pick };
}

/** The board as a page, beside the map on a wide screen. */
export function render({ bay }, clockNow) {
  const H = D.hub;
  const { st, pick } = board(bay, clockNow);

  const parts = [];
  parts.push(html`<div class="tc-head"><div class="col"><span class="eyebrow">${H.address} · ${H.town}</span><h1>${H.name}</h1></div><span class="tc-clock">${dayName(clockNow.ymd, true)} ${clock(clockNow.min).h}</span></div>`);
  parts.push(together(st, clockNow), detourNotice(clockNow));
  parts.push(loops(st, pick, clockNow));
  if (pick) parts.push(picked(st[pick], clockNow), dayTimes(st[pick], clockNow));
  parts.push(nextHour(st, pick, clockNow));
  parts.push(footnote(st));
  return { html: parts.join(''), mount, title: H.name, keepScroll: true, key: 'hub' };
}

/** Every departure from here in the next hour, soonest first: the estimate with the timetable's time struck
 *  beside it, and each route's first row tagged with where its bus is, as on the plan. With nothing in the hour
 *  (the evening, a Sunday, a gap), the hour from the next bus, so the list says when things start again. */
function nextHour(st, pick, clockNow) {
  const all = keys().map(k => ({ s: st[k], deps: st[k].ris.flatMap(ri => nextFromHub(ri, 4, clockNow)).sort((a, b) => a.day - b.day || a.min - b.min) }));
  const at = t => t.day * 1440 + t.min;
  const soon = all.some(({ deps }) => deps.some(t => t.day === 0 && t.min - clockNow.min <= 60));
  const firsts = all.flatMap(({ deps }) => deps.slice(0, 1)), start = firsts.length ? Math.min(...firsts.map(at)) : null;
  if (start === null) return '';
  const from = soon ? clockNow.min : start;
  const rows = [];
  for (const { s, deps } of all) {
    deps.filter(t => soon ? t.day === 0 && t.min - clockNow.min <= 60 : at(t) - from <= 60 && at(t) >= from)
      .forEach((t, i) => rows.push({ t, s, first: soon && i === 0 }));
  }
  rows.sort((a, b) => at(a.t) - at(b.t) || (a.s.k < b.s.k ? -1 : 1));
  const f = !soon && rows[0] && rows[0].t;
  const title = soon ? 'Leaving in the next hour' : f ? (f.day === 0 ? 'Next buses, from ' : (f.day === 1 ? 'Tomorrow' : dayName(f.ymd)) + ' from ') + clockText(f.min) : 'Next buses';
  const tags = !rtStale();
  const out = rows.map(({ t, s, first }) => {
    const tag = !first || !tags || s.off ? '' : s.eta === 0 ? 'HERE' : s.eta > 0 ? s.eta + ' MIN' : '';
    return html`<a class="tcb-row${pick === s.k ? ' on' : ''}" href="${first ? cardHref(s, pick) : '#/hub' + (pick === s.k ? '' : '/' + s.k)}">
      <span class="tcb-t">${was(schedOf(t), t.min)}<span class="t${t.live ? ' est' : ''}">${clock(t.min).h}</span></span>
      ${badge(t.r, 26)}<span class="tcb-mid"><span class="dest">${headsign(t)}</span><span class="sub${t.live ? ' live' : ''}">${t.live ? liveWord(t) : t.onTime ? 'Scheduled · on time' : 'Scheduled'}</span>${lastTag(t)}</span>
      <span class="tcb-tag">${tag ? html.raw(`<span class="tag${tag === 'HERE' ? ' in' : ''}">${tag}</span>`) : ''}</span></a>`;
  });
  return html`<div class="tcb"><div class="section between"><span>${title}</span>${rows.some(r => r.t.live) ? html`<span class="note">struck is the timetable</span>` : ''}</div>
    ${out.length ? out : html`<p class="tc-foot">Nothing leaves in the next hour.</p>`}</div>`;
}

/** On a Saturday, how often routes leave together and until when: ' · a group every 30 min until 6:00 PM'. */
function satShape(p) {
  if (dayFrom(p.ymd).dow !== 6) return '';
  const mins = [...new Set([...servicesOn(p.ymd)].flatMap(sid => D.hub.pulse[sid] || []))].sort((a, b) => a - b);
  if (mins.length < 2) return '';
  const gaps = mins.slice(1).map((m, i) => m - mins[i]), g = gaps.sort((a, b) => gaps.filter(x => x === b).length - gaps.filter(x => x === a).length)[0];
  // Not the same routes each time: a Saturday alternates two groups, on the hour and at half past.
  return ` · a group ${g === 60 ? 'hourly' : 'every ' + g + ' min'} until ${clockText(mins[mins.length - 1])}`;
}
/** The numbered routes leave together: when, the countdown, and one bar a route, its colour's outline until its bus
 *  is in, then filled with it. */
function together(st, clockNow) {
  const p = nextPulse(1, clockNow)[0];
  if (!p) return html`<div class="callout">${icon('moon', 20)}<div><b>No buses today</b><div class="sub">${D.agency.brand} doesn't run on ${dayName(clockNow.ymd)}s.</div></div></div>`;
  const ks = [...new Set((D.hub.pulseRoutes || []).map(keyOf))].filter(k => st[k]);
  // Which routes leave together is the timetable's: those with a departure from a bay at that minute that day. It was
  // each route's next departure matched against it, and as a bus pulled out its next was the run after, so at the
  // very minute the group thinned to the few still in.
  const leaving = ks.filter(k => routesOf(k).some(ri => D.hub.bays.some(b => b.routes.includes(ri) && timesOn(b.stop, p.ymd).some(t => t.r === ri && t.min === p.min))));
  const diff = p.min - clockNow.min + p.day * 1440;
  const end = p.day === 0 && diff < 60
    ? html`<span class="t tc-count" data-countdown="${p.min}">${countdown(p.min, clockNow)}</span><span class="cap">min : sec</span>`
    : html`<span class="t tc-count">${p.day === 0 ? diff : ''}</span><span class="cap">${p.day === 0 ? 'min' : relative(p, clockNow)}</span>`;
  const livenow = p.day === 0 && !rtStale();
  const segs = leaving.map(k => {
    const s = st[k], r = D.routes[s.ris[0]], full = livenow && s.eta === 0;
    return `<span class="tc-seg${full ? ' in' : ''}" style="--rc:#${r.color}"><i></i><b>${k}</b></span>`;
  }).join('');
  let note = '';
  if (livenow && leaving.length) {
    const n = leaving.length, inN = leaving.filter(k => st[k].eta === 0).length;
    const coming = leaving.filter(k => st[k].eta > 0).length, late = leaving.filter(k => st[k].late).length;
    const loose = leaving.filter(k => st[k].loose).length, away = leaving.filter(k => st[k].away).length, quiet = leaving.filter(k => !st[k].out).length;
    const rest = [coming ? coming + ' on the way' : '', late ? late + ' running late' : '', away ? away + ' still on a run' : '', loose ? loose + ' out without an estimate' : '', quiet ? quiet + ' not reporting' : ''].filter(Boolean).join(', ');
    note = html`<span class="tc-note"><b>${inN} of ${n} here.</b>${rest ? ' ' + rest.replace(/^./, c => c.toUpperCase()) + '.' : ''}</span>`;
  } else if (p.day === 0 && rtDown()) note = html`<span class="tc-note">Live positions aren't coming in right now.</span>`;
  return html`<div class="tc-together blueprint">${corners()}
    <div class="top"><div class="col"><span class="eyebrow">Next departure · ${(D.hub.pulseName || 'Routes').replace(/\s+leave$/, '')}</span>${time(p.min, 56)}<span class="sub">${leaving.length || ks.length} routes leave together${satShape(p)}</span></div><div class="end">${end}</div></div>
    ${leaving.length ? html`<div class="bars"><div class="segs" style="grid-template-columns:repeat(${leaving.length},minmax(0,1fr))">${html.raw(segs)}</div>${note}</div>` : ''}</div>`;
}

/** The two loops, side by side: the next one's time, the one after, and where its bus is. */
function loops(st, pick, clockNow) {
  const ls = (D.hub.loops || []).map(keyOf).filter(k => st[k] && st[k].dep);
  if (!ls.length) return '';
  // How often they come: the commonest gap between the next few.
  const gaps = ls.flatMap(k => { const m = nextFromHub(st[k].ris[0], 5, clockNow).filter(t => t.day === 0).map(schedOf); return m.slice(1).map((x, i) => x - m[i]); });
  const every = gaps.length ? [...gaps].sort((a, b) => gaps.filter(g => g === b).length - gaps.filter(g => g === a).length)[0] : null;
  const cells = ls.map(k => {
    const s = st[k], r = D.routes[s.ris[0]], t = s.dep, then = s.deps[1];
    const where = s.off ? 'Not running now' : s.eta === 0 ? 'Bus at its stop' : s.eta > 0 ? `Bus ${s.eta} min out` : s.away ? 'Bus on its run' : s.loose ? 'Out, no estimate' : 'Not reporting';
    // Its bus at its stop: board it now, and the line beneath is the bus after (a rider who misses this one wants
    // that, not when this one pulls out).
    // In and waiting for its minute (a bus in early holds for the timetable): that minute, with the wait. In and
    // due, or being spaced: NOW.
    const here = t.day === 0 && !s.off && s.eta === 0, waiting = here && t.min > clockNow.min;
    const thenTime = then && then.day === 0 ? html`${was(schedOf(then), then.min)}<span class="${then.live ? 'est' : ''}">${clock(then.min).h}</span>` : '';
    const rel = waiting ? html`At its stop · leaves ${relative(t, clockNow)}` : here ? (thenTime ? html`Next bus ${thenTime}` : '') : t.day === 0 ? html`${relative(t, clockNow)}${thenTime ? html` · then ${thenTime}` : ''}` : dayName(t.ymd);
    return html`<a class="tc-loop${pick === k ? ' on' : ''}" href="${cardHref(s, pick)}">
      <span class="who">${badge(s.ris[0], 36)}<span class="name">${r.long}</span></span>
      <span class="when">${here && !waiting ? html`<span class="t t-36 est">NOW</span>` : html`${wasLine(t)}<span class="whent">${time(t.min, 36, !!t.live)}</span>`}<span class="rel">${rel}</span></span>
      ${lastTag(t)}<span class="where${s.out && !s.off ? ' live' : ''}"><i></i>${where}</span></a>`;
  });
  return html`<div class="tc-loops blueprint">${corners()}
    <div class="top"><span class="eyebrow">The loops</span>${every ? html`<span class="note">Every ${every} min, on their own timetable</span>` : ''}</div>
    <div class="grid">${cells}</div></div>`;
}

/** The board as a phone's map card: its head, all a swiped-down card keeps, the countdown to the routes leaving
 *  together (or, a bay picked, that route's card); under it the loops, the next hour and the footnote. */
export function hubSheet({ bay }, clockNow) {
  const { st, pick } = board(bay, clockNow);
  return pick
    ? { pick, head: picked(st[pick], clockNow), body: html`${detourNotice(clockNow)}${dayTimes(st[pick], clockNow)}${nextHour(st, pick, clockNow)}${footnote(st)}` }
    : { pick, head: together(st, clockNow), body: html`${detourNotice(clockNow)}${loops(st, pick, clockNow)}${nextHour(st, pick, clockNow)}${footnote(st)}` };
}

/** The bays for the map, one badge a route (16 AM and PM as one), at its bay's stop as the timetable places it: the
 *  route's colours, its tag (IN, minutes away, or nothing when it isn't out), whether it's quiet today, the one
 *  picked. The map eases badges that land on one another apart; nothing is drawn by hand. */
export function bays(bay, clockNow) {
  const { st, pick } = board(bay, clockNow), tags = !rtStale();
  return keys().map(k => {
    const s = st[k], ri = s.ris[s.ris.length - 1], r = D.routes[ri], b = D.hub.bays.find(x => x.routes.includes(ri));
    if (!b) return null;
    const tag = !tags || s.off ? '' : s.eta === 0 ? 'HERE' : s.eta > 0 ? s.eta + ' MIN' : '';
    return { k, lat: b.lat, lon: b.lon, color: '#' + r.color, text: '#' + r.text, tag, off: s.off, on: pick === k, dim: !!pick && pick !== k, title: isLoop(s.ris[0]) ? r.long : 'Route ' + k };
  }).filter(Boolean);
}

/** The picked route: where its bus is, in words, and its next three departures. */
function picked(s, clockNow) {
  const r = D.routes[s.ris[0]];
  const title = s.loop ? r.long : s.ris.length > 1 ? `Route ${s.k} ${s.ris.map(ri => D.routes[ri].short.replace(/^\S+\s+/, '')).join(' & ')}` : r.long;
  const desc = (r.desc || '').replace(/^.*?\s+-\s+/, '').replace(/,\s*/g, ' · ');
  const dep = s.dep;
  const words = !dep ? 'Nothing scheduled in the next week.'
    : s.off ? (dep.day === 0 ? `No bus out yet. The next leaves at ${clockText(dep.min)}.` : `No more buses today. The next leaves ${dayName(dep.ymd)} at ${clockText(dep.min)}.`)
    : s.eta === 0 ? (s.loop ? 'The bus is at its stop.' : 'The bus is at its bay.')
    : s.eta > 0 ? `The bus is ${s.eta} min from the Transit Center${s.loop ? '.' : s.late ? `, ${s.late} min late.` : ', on time.'}`
    : s.loose ? 'The bus is out but off its scheduled trips, so there’s no estimate for it.'
    : s.away ? 'The bus is out on a run that doesn’t come back through here soon.'
    : 'This route isn’t reporting its position.';
  // The badge opens the route, landing on its bay; each time opens that bay's stop page, the rest of its day.
  const ri = s.ris[s.ris.length - 1], bay = D.hub.bays.find(b => b.routes.includes(ri));
  const baySi = bay ? bay.stop : undefined;
  // A time opens its run from here: the route from the Center at that time, drawn on the map, its stops listed.
  const stopHref = t => { const si = t.si !== undefined ? t.si : baySi; return si === undefined ? '#/hub' : '#/stop/' + D.stops[si].id + (t.trip !== undefined ? `?run=${t.trip}&on=${t.ymd}` : ''); };
  const cells = s.deps.map((t, i) => {
    const m = i === 0 && t.day === 0 ? s.leave : t.min, c = clock(m);
    const rel = t.day === 0 ? relative({ ...t, min: m }, clockNow) + (i === 0 && s.late ? ' · late' : '') : dayName(t.ymd);
    if (i === 0 && t.live && t.live.here && t.live.spacing && !t.live.leaves) return html`<a class="cell first" href="${stopHref(t)}"><span class="t">At its stop</span></a>`;
    return html`<a class="cell${i === 0 ? ' first' : ''}" href="${stopHref(t)}"><span class="whent">${t.day === 0 ? was(schedOf(t), m) : ''}<span class="t${t.live ? ' est' : ''}">${c.h}<small>${c.ap}</small></span></span><span class="rel">${rel}</span>${lastTag(t)}</a>`;
  });
  return html`<div class="tc-pick blueprint">${corners()}
    <div class="top">${baySi !== undefined ? html.raw(routeBadgeLink(ri, baySi, 44, s.deps[0] && s.deps[0].dir)) : badge(ri, 44)}<div class="col"><span class="title">${title}</span><span class="sub">${desc}</span></div><a class="btn btn-secondary btn-icon" href="#/hub" aria-label="Close">${icon('close', 20)}</a></div>
    <span class="words">${words}</span>
    ${cells.length ? html`<div class="cells">${cells}</div>` : ''}</div>`;
}

/** The picked route's whole day from here, an hour to a column, each time to come a way into its run; below its
 *  next few, a swipe up on a phone's board. */
function dayTimes(s, clockNow) {
  const seen = new Set(), list = [];
  for (const b of D.hub.bays) for (const ri of s.ris) if (b.routes.includes(ri)) for (const t of timesOn(b.stop, clockNow.ymd)) {
    if (t.r !== ri || seen.has(t.min + ':' + t.trip)) continue;
    seen.add(t.min + ':' + t.trip); list.push(t);
  }
  if (!list.length) return '';
  list.sort((a, b) => a.min - b.min);
  const hours = new Map();
  for (const t of list) { const h = Math.floor(t.min / 60); if (!hours.has(h)) hours.set(h, []); hours.get(h).push(t); }
  const nowH = Math.floor(clockNow.min / 60), name = s.loop ? D.routes[s.ris[0]].long : 'Route ' + s.k;
  const cols = [...hours].map(([h, ts]) => `<div class="hr${h === nowH ? ' now' : ''}"><span class="hr-h">${clockShort(h * 60)}</span>${ts.map(t => t.min < clockNow.min
    ? `<span class="hr-dep past">${clock(t.min).h}</span>`
    : `<a class="hr-dep" href="#/stop/${D.stops[t.si].id}?run=${t.trip}&on=${clockNow.ymd}">${clock(t.min).h}</a>`).join('')}</div>`).join('');
  return html`<section class="phone-day tc-day"><div class="ws-eye"><span>${name} today from here</span><span>${list.length} departures</span></div><div class="hours">${html.raw(cols)}</div><p class="day-hint">Tap a time for its run on the map.</p></section>`;
}

function footnote(st) {
  if (rtDown()) return html`<p class="tc-foot">Live bus positions aren't coming in right now, so every time here is the scheduled one.</p>`;
  if (rtStale()) return '';   // its first word not in yet
  const name = s => s.loop ? D.routes[s.ris[0]].long : 'Route ' + s.k;
  const list = (xs, one, many) => xs.length ? ' ' + (xs.length === 1 ? xs[0] + one : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1] + many) : '';
  const live = Object.values(st).filter(s => !s.off && s.eta === null);
  const loose = list(live.filter(s => s.loose).map(name), ' is out but off its scheduled trips, so it has no estimate.', ' are out but off their scheduled trips, so they have no estimates.');
  const quiet = list(live.filter(s => !s.out).map(name), ' isn’t reporting.', ' aren’t reporting.');
  return html`<p class="tc-foot">Bus positions from ${D.agency.brand}’s live feed. A late bus leaves when it’s ready: a crossed-out time is the scheduled one, beside the estimate.${loose}${quiet}</p>`;
}

let shownPick = null;
/** The countdown's ticker, and a picked route's card brought into view: for the page and the map's card alike. */
export function mount(el) {
  // A route just picked: its card opens below the loops, so bring it into view if it's off the screen. Once per
  // pick, not on the minute's redraw, which keeps the rider's place.
  const card = el.querySelector('.tc-pick'), pick = card ? location.hash : null;
  if (card && pick !== shownPick) {
    const r = card.getBoundingClientRect(), bottom = (el.getBoundingClientRect().bottom || innerHeight);
    if (r.bottom > bottom || r.top < 0) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  shownPick = pick;
  // The countdown runs by the second while this screen is up: one ticker, however many times the page is redrawn
  // in place (each redraw used to start another, and after a pulse an old one wrote 0:00 over the new one's
  // minutes), reading the departure off the element each second, as a redraw moves it on.
  clearInterval(countIv);
  const c = el.querySelector('[data-countdown]');
  if (!c) return;
  const tick = () => {
    if (!document.body.contains(c)) return clearInterval(countIv);
    const s = +c.dataset.countdown * 60 - nowSec();
    c.textContent = s <= 0 ? '0:00' : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  countIv = setInterval(tick, 1000);
  tick();
}
const nowSec = () => { const n = now(); return n.min * 60 + n.sec; };
