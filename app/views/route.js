// A route: its stops in order, each with the route's next call there.
import { D, route, stop, nextAt, routeAlerts, closedRoutes, routeOrder, timesOn, tripStops, runEnd, tripEnd, tripRoute, nextTrip, prevTrip, lastTripOn, runOf, onRequest, dirName } from '../data.js';
import { relative, clockText, dayName } from '../time.js';
import { rt, rtStale, nextStopOf, lateWords, busDelay, isLoop, predict } from '../rt.js';
import { html, icon, badge, badges, time, sched, stopRow, lively, routeBadgeLink, corners, when, liveMark, liveTag } from '../ui.js';
import { miniSlot, mountMini } from './mini.js';

export function render({ short, dir, at, full, bus }, clockNow) {
  const ri = D.routeByShort[short];
  if (ri === undefined) return { html: html`<div class="backbar"><a class="btn btn-ghost" href="#/">${icon('back', 22)}Stops</a></div><div class="empty"><h2>No such route</h2></div>`, title: 'Route' };
  const r = route(ri);
  const dirs = Object.keys(r.stops || {});
  const d = dirs.includes(dir) ? dir : dirs[0];
  const parts = [html`<div class="backbar"><a class="btn btn-ghost" href="#/" onclick="if(history.length>1){history.back();return false}">${icon('back', 22)}Stops</a></div>`];
  parts.push(html`<div class="head"><span class="eyebrow">Route</span><div style="display:flex;align-items:center;gap:12px">${badge(ri, 44)}<div><h1 style="font-size:30px">${r.long}</h1>${r.desc ? html`<div class="muted" style="font-size:14px">${r.desc.replace(/,\s*/g, ' · ')}</div>` : ''}</div></div></div>`);
  parts.push(miniSlot({ route: r.short }));
  for (const a of routeAlerts(ri, clockNow.ymd)) parts.push(html`<div class="callout alert">${icon('ban', 20)}<div><b>${a.title}</b><div class="sub">${a.text}${a.url ? html` <a href="${a.url}" target="_blank" rel="noopener">More</a>` : ''}</div></div></div>`);
  // Each way by where it goes ('to Preston', 'to Transit Center') when that tells them apart; else the feed's words.
  const names = dirs.map(k => { const n = dirName(ri, k); return n && !n.places ? 'to ' + n.text : ''; });
  const apart = dirs.length > 1 && names.every(Boolean) && new Set(names).size === names.length;
  const dirWord = apart ? ' ' + names[dirs.indexOf(d)] : '';   // ' to Preston', for the notes that speak of this way
  if (dirs.length > 1) {
    parts.push(html`<div class="chips">${dirs.map((k, i) => html`<a class="chip" href="#/route/${encodeURIComponent(short)}/${k}" ${k === d ? html.raw('style="border-color:var(--color-accent);color:var(--color-accent-700)"') : ''}>${apart ? names[i] : r.dirs[+k] || (k === '0' ? 'Outbound' : 'Return')}</a>`)}</div>`);
  }
  const seq = routeOrder(ri, d);
  const here = at !== undefined ? D.stopById[at] : undefined;   // from a stop's badge: that stop, marked, in view
  // Where its buses are: a row for each, just before the stop it calls at next.
  const buses = rtStale() ? [] : rt.buses.filter(b => b.ri === ri && (b.dir === null || String(b.dir) === d));
  const busBefore = new Map();
  for (const b of buses) { const n = nextStopOf(b); if (n !== undefined && seq.includes(n)) busBefore.set(n, [...(busBefore.get(n) || []), b]); }
  // Come from a stop's badge: the answer for that stop first, so the list below is for those who want the route.
  if (here !== undefined && seq.includes(here)) parts.push(yourStop(ri, here, seq, buses, clockNow));
  const last = lastRun(ri, d, seq, clockNow, dirWord);
  if (last) parts.push(last.note);
  // Each stop with its next call. Late in the day most of a route is done, its next calls tomorrow's: the stops a bus
  // still has to reach today come first, and the whole route, the next day's times and all, is behind a button.
  const each = seq.map(si => {
    const bus = (busBefore.get(si) || []).map(b => busRow(b, ri));
    // A stop the route's detour skips: say so, rather than the first bus after the detour's end, days off.
    if (closedRoutes(si, clockNow.ymd).has(ri)) return { si, today: false, closed: true, bus, row: stopRow(si, null, clockNow, { none: 'Not served · detour', warn: true, here: si === here }) };
    const n = nextAt(si, 1, clockNow, 8, t => t.r === ri)[0];
    return { si, today: !!n && n.day === 0, bus, row: stopRow(si, n, clockNow, { none: 'Not today', here: si === here }) };
  });
  const onward = follow(ri, seq, buses, clockNow);
  if (onward.now) parts.push(onward.now);
  const coming = each.filter(x => x.today);
  const whole = full || !coming.length || coming.length === each.length || (here !== undefined && !coming.some(x => x.si === here));
  // The whole route, once some of it is done for the day: tonight's stops first, then a break, then the stops whose
  // next bus is the next day's, each part in route order. A stop a detour skips stays with tonight's.
  const split = whole && coming.length > 0 && coming.length < each.length;
  const done = whole && !coming.length && timesOn(seq[0], clockNow.ymd).some(t => t.r === ri);   // ran today, now finished
  const top = split ? each.filter(x => x.today || x.closed) : !whole ? coming : done ? [] : each;
  const rest = split ? each.filter(x => !x.today && !x.closed) : done ? each : [];
  const rowsOf = xs => xs.flatMap(x => [...x.bus, x.row]);
  // The last run's final stop, which the timetable leaves out (nobody boards there): where the bus ends its day.
  // An out-and-back's far end isn't an end: the bus turns round there and its way back is the other list.
  const other = dirs.length > 1 ? dirs.find(k => k !== d) : null;
  const endRow = last && last.out && last.turnSi !== null && other !== null && (top.length || !whole) ? html`<a class="stoprow endstop" href="#/route/${encodeURIComponent(short)}/${other}"><div class="mid"><span class="name">${stop(last.turnSi).name}</span><span class="dist">Turns round here · back${last.endSi !== null && stop(last.endSi).hub ? ' to the ' + D.hub.name : ''} about ${clockText(last.endMin)}</span></div><div class="end"><span class="muted">${icon('fwd', 20)}</span></div></a>`
    : last && last.out && last.endSi !== null && (top.length || !whole) ? html`<div class="stoprow endstop"><div class="mid"><span class="name">${stop(last.endSi).hub ? D.hub.name : stop(last.endSi).name}</span><span class="dist">Ends here · drop-off only${stop(last.endSi).hub ? ' · ' + stop(last.endSi).name : ''}</span></div><div class="end">${last.endAt !== null ? html`<div class="when">${time(last.endAt, 22, true)}</div>` : ''}</div></div>` : '';
  const rows = [...rowsOf(top), endRow, ...(rest.length ? [html`<div class="endservice"><span>End of service today</span></div>`, ...rowsOf(rest)] : [])];
  parts.push(html`<div class="section">${icon('stops', 16)}${!whole ? `${coming.length} of ${seq.length} stops left` : split ? `${seq.length} stops · tonight's first` : `${seq.length} stops, in order`}</div><div class="list">${rows}</div>`);
  if (onward.later) parts.push(onward.later);
  if (!whole) parts.push(html`<div style="padding:12px 16px"><a class="btn btn-secondary btn-block" style="min-height:48px" href="#/route/${encodeURIComponent(short)}/${d}?all=1">The whole route · all ${seq.length} stops</a></div>`);
  return { html: parts.join(''), title: isLoop(ri) ? r.long : 'Route ' + r.short, mount: mountMini, anchor: here !== undefined ? null : bus && buses.some(b => b.id === bus) ? busAnchor(bus) : buses.length ? busAnchor(buses[0].id) : null, anchorBlock: 'center' };
}

// ---- staying on the bus. A bus swaps routes at the Transit Center all day (9 and 1 on a Saturday): its next
// trip is where a rider who stays on goes. Ahead of the Transit Center those stops are dimmed, still to come; once
// the bus is past it they're what it's doing, and bright.

/** The trip a bus runs next: the feed's word when it has given the bus its next trip (a dispatcher's swap), else
 *  the timetable's block. */
function nextOf(b, ti, clockNow) {
  const vid = b.id.slice(2), nowS = Date.now() / 1000, cur = rt.trips[b.trip];
  // After this trip ends: the feed can keep the bus's last trip listed a while (the 3 it just finished, on an 8).
  const after = Math.max(nowS - 60, cur && cur.last ? cur.last.time - 60 : 0);
  let best = null;
  for (const [id, u] of Object.entries(rt.trips)) {
    if (id === b.trip || String(u.v) !== vid || !u.first || u.first.time < after) continue;
    if (!best || u.first.time < best.time) best = { id, time: u.first.time };
  }
  const i = best ? D.trips.indexOf(best.id) : -1;
  return i >= 0 ? i : nextTrip(ti, clockNow.ymd);
}

/** A trip's stops from `from` on, as rows with their times, the feed's where it has them. */
function tripRows(ti, from, clockNow, dim) {
  const tr = tripRoute(ti);
  return tripStops(ti).slice(from).map(([m, si]) => {
    const t = lively({ min: m, r: tr.r, dir: tr.dir, si, trip: ti, day: 0, ymd: clockNow.ymd, req: onRequest(si, tr.r, tr.dir) });
    const row = stopRow(si, t, clockNow);
    return dim ? html`<div class="later">${row}</div>` : row;
  });
}

/** `later`: the next trip of the bus furthest along this route, dimmed, under the list. `now`: a bus that ran this
 *  route and is past the Transit Center on its next one, bright, at the top: where it's going now. */
function follow(ri, seq, buses, clockNow) {
  const out = {};
  const along = b => seq.indexOf(nextStopOf(b));
  const lead = buses.filter(b => along(b) >= 0).sort((a, b) => along(b) - along(a))[0];
  if (lead) {
    const ti = D.trips.indexOf(lead.trip), nti = ti >= 0 ? nextOf(lead, ti, clockNow) : undefined, tr = nti !== undefined && tripRoute(nti);
    if (tr && tr.r !== ri) {
      const st = tripStops(nti);
      out.later = html`<div class="section onward">${icon('swap', 16)}<span>Stay on bus ${lead.label}: it becomes ${routeName(tr.r)} at ${clockText(st[0][0])}</span>${html.raw(routeBadgeLink(tr.r, st[0][1], 24, tr.dir))}</div>
        <div class="list">${tripRows(nti, 0, clockNow, true)}</div>`;
    }
  }
  // A bus off this route now, whose trip before was this route's and not long done.
  for (const b of rtStale() ? [] : rt.buses) {
    if (b.ri === ri) continue;
    const ti = D.trips.indexOf(b.trip), pti = ti >= 0 ? prevTrip(ti, clockNow.ymd) : undefined, pr = pti !== undefined && tripRoute(pti);
    if (!pr || pr.r !== ri) continue;
    const ps = tripStops(pti);
    if (!ps.length || clockNow.min - ps[ps.length - 1][0] > 60) continue;
    const st = tripStops(ti), k = st.findIndex(([, si]) => si === nextStopOf(b));
    if (k < 0) continue;
    out.now = html`<div class="section onward">${icon('swap', 16)}<span>Bus ${b.label} ran this route and is now ${routeName(b.ri)}</span>${html.raw(routeBadgeLink(b.ri, st[k][1], 24))}</div>
      <div class="list">${busRow(b, b.ri)}${tripRows(ti, k, clockNow, false)}</div>`;
    break;
  }
  return out;
}
const routeName = ri => isLoop(ri) ? 'the ' + D.routes[ri].long : 'Route ' + D.routes[ri].short;

/** The stop a rider came from: this route's next bus there, and which bus it is and how far off; or that it's done
 *  there for the day, and when it's back. */
function yourStop(ri, si, seq, buses, clockNow) {
  const s = stop(si), name = isLoop(ri) ? D.routes[ri].long : 'Route ' + D.routes[ri].short;   // 'No more Blue Loop here'
  const closed = closedRoutes(si, clockNow.ymd).has(ri);
  const t = closed ? null : nextAt(si, 1, clockNow, 8, x => x.r === ri)[0];
  let line, sub = '';
  if (closed) line = html`<span class="rel warnmark">Not served today · detour</span>`;
  else if (!t) line = html`<span class="rel">Nothing scheduled in the next week</span>`;
  else if (t.day > 0) line = html`<span class="rel">No more ${name} here today · next ${t.day === 1 ? 'tomorrow' : dayName(t.ymd)} ${clockText(t.min)}</span>`;
  else {
    line = html`${badge(ri, 20)}${when(t, 22)}<span class="rel">${relative(t, clockNow)}</span>${t.live ? liveTag(t) : sched(t)}`;
    // Which bus: the one on that trip. How far: stops from where it calls next to here, round the loop for a loop.
    const b = buses.find(x => x.trip === D.trips[t.trip]);
    if (b) {
      const k = seq.indexOf(nextStopOf(b)), h = seq.indexOf(si);
      const away = k < 0 ? null : (h - k + seq.length) % seq.length + 1;
      sub = `Bus ${b.label}${away !== null ? ` · ${away} ${away === 1 ? 'stop' : 'stops'} away` : ''}`;
    }
  }
  return html`<a class="twin blueprint yourstop" href="#/stop/${s.id}">${corners()}<span style="color:var(--color-accent-700)">${icon('pin', 22)}</span>
    <div class="mid"><span class="eyebrow">Your stop</span><span class="name">${s.name}</span><div class="when">${line}</div>${sub ? html`<span class="rel">${sub}</span>` : ''}</div>
    <span class="muted">${icon('fwd', 20)}</span></a>`;
}

const busAnchor = id => 'bus-' + String(id).replace(/[^\w-]/g, '');   // a bus's row, for a map tap to land on
/** A bus on the route, as a row between the stop it last passed and the one it calls at next. */
function busRow(b, ri) {
  // Waiting at the Transit Center a bus is never early: it leaves on time or late.
  const dl = busDelay(b), atHub = D.stops[nextStopOf(b)]?.hub;
  const words = dl !== null && !isLoop(ri) && !(atHub && dl < 2) ? lateWords(dl) : '';
  // A tap: the map, this route framed, this bus ringed with its card. The row is where the bus is in the list.
  return html`<a class="busrow" id="${busAnchor(b.id)}" href="#/map/route/${encodeURIComponent(D.routes[ri].short)}?bus=${encodeURIComponent(b.id)}"><i style="background:#${D.routes[ri].color}"></i><span>Bus ${b.label}${words ? ' · ' + words : ''}</span><span class="livetag"><i></i>Live</span>${icon('map', 16)}</a>`;
}

/** Today's last run this way, while it's still to come or on the road: when and where it leaves, where and about
 *  when it ends. An out-and-back (15's to Preston and back) is one run of two timetable trips, so the note says the
 *  bus comes back, not that it ends at the far end; and each way has its own last run, the other way's list its own. */
function lastRun(ri, d, seq, clockNow, dirWord) {
  const lt = lastTripOn(ri, clockNow.ymd, d);
  if (!lt) return null;
  const t = { min: lt.start[0], si: lt.start[1], r: ri, dir: lt.dir, h: lt.h, trip: lt.trip };
  const run = runOf(t.trip, clockNow.ymd), lastTi = run[run.length - 1], onward = run.slice(run.indexOf(t.trip) + 1);
  const stops = tripStops(lastTi);
  // How late: the bus's own, once it's out (on any trip of the run); before that, the feed's word on its leaving.
  const bus = rtStale() ? null : rt.buses.find(b => run.includes(D.trips.indexOf(b.trip)));
  const u = bus && rt.trips[bus.trip], p = predict({ ...t, day: 0 });
  const delay = u && u.lastDelay !== null ? u.lastDelay : p && !p.gone ? p.delay || 0 : 0;
  const te = tripEnd(lastTi), turn = onward.length ? tripEnd(t.trip) : null;
  const endMin = (te ? te.min : stops[stops.length - 1][0]) + delay;
  const re = runEnd(t.trip), partial = !onward.length && re && re.partial && re.end !== null;
  // Where the run ends: the feed's final stop for the bus's trip, with its time, once the bus is on the run's last
  // trip; else the last trip's end; else a partial run's end; else the stop that follows its last one on the route.
  let endSi = null, endAt = null;
  const fin = u && u.ti === lastTi && u.stops.find(x => x[1] === u.end);
  if (fin && D.stopById[fin[0]] !== undefined) { endSi = D.stopById[fin[0]]; const dd = new Date(fin[2] * 1000); endAt = dd.getHours() * 60 + dd.getMinutes(); }
  else if (te) endSi = te.si;
  else if (partial) endSi = re.end;
  else { const k = seq.indexOf(stops[stops.length - 1][1]); if (k >= 0) endSi = k + 1 < seq.length ? seq[k + 1] : isLoop(ri) ? seq[0] : null; }
  if ((endAt ?? endMin) < clockNow.min) return null;   // done for the day, its final stop reached: the times below are the next day's
  const place = si => stop(si).hub ? 'the ' + D.hub.name : stop(si).name;
  // 'leaves Preston at', 'leaves the Transit Center at'; a loop's trip starts wherever the feed cuts it, so just 'leaves at'.
  const town = si => (stop(si).town || '').replace(/,\s*[A-Z][a-z]+$/, ''), s0 = stop(t.si);
  const from = isLoop(ri) ? '' : (s0.hub ? 'the ' + D.hub.name : town(t.si) && town(t.si) !== D.hub.town ? town(t.si) : s0.name) + ' ';
  const ends = endSi !== null ? place(endSi) : 'its last stop', about = ' about ' + clockText(endAt ?? endMin);
  const far = turn ? (town(turn.si) && town(turn.si) !== D.hub.town ? town(turn.si) : stop(turn.si).name) : '';
  const where = partial ? html`only part of the route, ending at <b>${stop(re.end).name}</b>${about}`
    : onward.length ? html`out to ${far} and back, ending at ${ends}${about}` : html`the whole route, ending at ${ends}${about}`;
  const lead = t.min > clockNow.min ? html`Today's last run${dirWord} leaves ${from}at <b>${clockText(t.min)}</b> and runs ${where}.`
    : html`Today's last run${dirWord} left ${from}at ${clockText(t.min)}${bus ? html` and is on the road now, bus ${bus.label}` : ''}. It runs ${where}.`;
  return { note: html`<div class="notice lastrun-note">${icon('moon', 16)}<span>${lead}</span></div>`, out: t.min <= clockNow.min, endSi, endAt, endMin: endAt ?? endMin, turnSi: turn ? turn.si : null };
}
