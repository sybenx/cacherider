// One bus's whole day: the user's block ('when i say BLOCK i mean the bus's entire day plan'), which no screen showed
// (a bus's card has its trip and the one after). Blue 2, 15(1): one of a route's buses as Connect's dispatch numbers
// them, every run it makes today from first to last, the one it's on marked, and when it comes in. Reached from its
// route's page ('Buses today'), from a search for it by name ('b2', 'blue two', '15(1)') and from its card on the map.
import { D, busBlock, routeBuses, familyKey, tripStops, tripEnd, tripRoute, timesOn, staysOn, stop, distance, opOf, keptOn } from '../data.js';
import { html, icon, badge, routeName, routeNames, routeHref, busName, headsign, heardName, time, when, lively, liveWord, liveMark } from '../ui.js';
import { clockText } from '../time.js';
import { rt, rtStale, nextStopOf, busDelay, lateWords, isLoop, offDuty, AT_STOP } from '../rt.js';

/** The route a bus name is of: its family's first that isn't another operator's ('16' for 16 AM and PM). */
const routeOf = key => D.routes.findIndex((r, ri) => familyKey(ri) === key && !opOf(ri));
/** A route's bus by its number today, on the map now: null with the feed quiet or the bus not out. */
export function liveBus(key, n, clockNow) {
  if (rtStale()) return null;
  // By the trip it's on, whatever route that is: a Saturday's 2 out as the 5 is still this bus.
  const block = busBlock(key, n, clockNow.ymd), on = block ? new Set(block.map(ti => D.trips[ti])) : null;
  return on ? rt.buses.find(b => on.has(b.trip) && !offDuty(b, clockNow)) || null : null;   // not one done for the day, still logged on to its last run
}
/** Where a bus is, in a line: 'at the Transit Center', 'by North Walmart'; '' with no next stop known. */
export function busAt(b) {
  const si = nextStopOf(b);
  if (si === undefined) return '';
  const s = stop(si), at = distance(b.lat, b.lon, s.lat, s.lon) <= AT_STOP;
  return (at ? 'at ' : 'by ') + (s.hub ? 'the ' + D.hub.name : heardName(si).name);
}
/** A block's hours, '6:18 AM to 8:49 PM': its first trip's start to its last one's end. */
export function blockHours(block) {
  const a = tripStops(block[0])[0], l = block[block.length - 1], e = tripEnd(l), ls = tripStops(l);
  return a ? [a[0], e ? e.min : ls[ls.length - 1][0]] : null;
}

export function render({ key, n }, clockNow) {
  const ri = routeOf(key), back = html`<div class="backbar"><a class="btn btn-ghost" href="${ri >= 0 ? routeHref(ri) : '#/'}" onclick="if(history.state&&history.state.prev){history.back();return false}">${icon('back', 22)}Back</a></div>`;
  const of = ri >= 0 ? routeBuses(key, clockNow.ymd) : 0, block = ri >= 0 && n >= 1 ? busBlock(key, n, clockNow.ymd) : null;
  if (!block) {
    const say = ri < 0 ? 'No such route.' : of ? `${routeName(ri).replace(/^./, c => c.toUpperCase())} runs ${of} buses today.` : n > 1 && busBlock(key, 1, clockNow.ymd) ? `${routeName(ri).replace(/^./, c => c.toUpperCase())} runs one bus today.` : `No ${routeName(ri).replace(/^the /, '')} buses today.`;
    return { html: html`${back}<div class="head"><h1>Bus plan</h1></div><div class="empty"><p>${say}</p></div>${ri >= 0 ? html`<div class="pad"><a class="btn btn-secondary btn-lg btn-block" href="${routeHref(ri)}">Open route</a></div>` : ''}`, title: 'Bus plan' };
  }
  const b = liveBus(key, n, clockNow), hours = blockHours(block);
  // Its routes, in the order it first runs them: one for most; a Saturday's swapping bus two ('Routes 2 and 5'), named
  // by them, as it has no number of its own (its routes run the one bus each).
  const ris = [...new Set(block.map(ti => (tripRoute(ti) || {}).r).filter(r => r !== undefined))].filter((r, i, all) => all.findIndex(x => familyKey(x) === familyKey(r)) === i);
  const name = of ? busName(ri, n) : ris.length > 1 ? routeNames(ris) : routeName(ri, false);
  const what = of ? `${routeName(ri, false)} · bus ${n} of ${of} today` : ris.length === 2 ? 'One bus runs both routes today' : ris.length > 2 ? 'One bus runs these routes today' : 'One bus today';
  // Each run: when it leaves, from where, as what and where to; when it's in.
  const runs = block.map(ti => {
    const st = tripStops(ti), te = tripEnd(ti), tr = tripRoute(ti), t = st.length ? timesOn(st[0][1], clockNow.ymd).find(x => x.trip === ti) : null;
    return { ti, r: tr ? tr.r : ri, from: st[0], end: te ? te.min : st.length ? st[st.length - 1][0] : null, to: t ? String(headsign(t)) : '', t: t ? { ...t, day: 0, ymd: clockNow.ymd } : null };
  }).filter(x => x.from);
  // The one it's on: the feed's word where its bus is out, else the clock's (the run under way, or none between two).
  const liveTi = b ? D.trips.indexOf(b.trip) : -1;
  const cur = runs.find(x => x.ti === liveTi) || (b ? null : runs.filter(x => x.from[0] <= clockNow.min && clockNow.min <= x.end).pop());   // at the minute two runs share, the one starting
  const before = clockNow.min < hours[0], after = !cur && !runs.some(x => x.from[0] > clockNow.min);
  const state = b ? html`<a class="plan-live" href="#/map/bus/${encodeURIComponent(b.id)}?find=1">${icon('map', 16)}<span>Bus ${b.label}${busAt(b) ? ' · ' + busAt(b) : ''}</span>${icon('fwd', 16)}</a>`
    : html`<div class="plan-live quiet">${icon('info', 16)}<span>${before ? `Starts at ${clockText(hours[0])}` : after ? 'Done for the day' : 'Not on the map now'}</span></div>`;
  // The feed's word, where it has one: how late the bus is on the run it's on (not a loop's, which holds to space its
  // buses, nor a route's on an old timetable: the card's rule), and the time it's due out on the next (the feed gives
  // a bus its next trip, no further). The rest are the timetable's, as every run was (the user: 'do 2').
  const dl = b && cur ? busDelay(b) : null, late = dl !== null && !isLoop(cur.r) && !keptOn(cur.r) ? lateWords(dl).replace(/^On/, 'on') : '';
  const rows = [];
  runs.forEach((x, i) => {
    const prev = runs[i - 1];
    // Out of service between two runs (16's morning bus, back out in the afternoon): said, with when it's back.
    if (prev && !staysOn(prev.ti, x.ti)) rows.push(html`<div class="endservice firstrun"><span>Out of service till ${clockText(x.from[0])}</span></div>`);
    const gone = cur ? x.from[0] < cur.from[0] : x.end < clockNow.min, on = x === cur;
    const lt = !gone && !on && x.t ? lively(x.t) : null, live = lt && lt.live ? lt : null;
    const where = stop(x.from[1]).hub ? D.hub.name : heardName(x.from[1]).name;
    rows.push(html`<div class="row planrow${gone ? ' gone' : ''}${on ? ' on' : ''}">${badge(x.r, 28)}<div class="mid"><span class="name">${x.to && x.to.toLowerCase() !== routeName(x.r, false).toLowerCase() ? x.to : routeName(x.r, false)}</span><span class="sub">${on ? 'On this run · ' + (late ? late + ' · ' : '') : ''}from ${where} · till ${clockText(x.end)}</span>${live ? liveMark(liveWord(live)) : ''}</div><div class="end">${live ? when(live, 22) : time(x.from[0], 22)}</div></div>`);
  });
  return {
    html: html`${back}<div class="head planhead"><div class="rs-name">${ris.length > 1 && !of ? ris.map(r => badge(r, 36)) : badge(ri, 36)}<div class="mid"><span class="name">${name}</span><span class="sub">${what} · ${clockText(hours[0])} to ${clockText(hours[1])}</span></div></div>${state}${(of ? [ri] : ris).map(r => html`<a class="plan-live plan-route" href="${routeHref(r)}">${icon('route', 16)}<span>Open ${routeName(r)}</span>${icon('fwd', 16)}</a>`)}</div>
      <div class="list planlist">${rows}</div>
      <div class="endservice"><span>In at ${clockText(hours[1])}</span></div>`,
    title: name, live: true, keepScroll: true,
  };
}
