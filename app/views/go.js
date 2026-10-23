// Directions to a stop or a spot: from where the rider is, or from a stop they name. Each way there is one card: the walk
// to the first stop, the bus, where to change, where to get off, in order, with when.
import { D, stop, stopIndex, distance, tripStops, POOL, inPool, nextAt, recent, timesOn, corridor, tripEnd, closedRoutes, agencyRuns, offDayWords, nearest, quietWords } from '../data.js';
import { rt, busOn, nextStopOf, isLoop } from '../rt.js';
import { clockText, clock, relative, metres, fmtDay, dayName, now, dayFrom, isGone, minsTo } from '../time.js';
import { html, icon, badge, time, headsign, liveMark, liveWord, corners, stopTitle, heardName, replaceTo } from '../ui.js';
import { journeys } from '../plan.js';
import { walkHref } from '../pointer.js';
import { spotOf, spotKey, atPath, walkMins, CORNERS, steepKnown, whereabouts as roughly } from '../geo.js';
import { shareButton, siteLink } from '../share.js';
import { myPlaces, placeStar, sharedAs } from '../places.js';
import { U, planNet, planNetBy, chip, shuttleAlso, hours, offHours, lapSecs } from '../usu.js';
import { nearMe, app, afterSave } from '../main.js';

/** Where to and where from, from the address: the stop or spot, its name, and the origin (null till one's chosen). */
function ends({ to, from, at }) {
  // Where to: a stop by its id, or a spot (picked on the map, or a place found) by its key.
  const spot = spotOf(to), dest = spot || stopIndex(to);
  if (dest === undefined) return { dest };
  const d = spot || stop(dest), name = spot ? spot.label || 'the spot you picked' : d.hub ? D.hub.name : d.name;
  const fromSi = from ? stopIndex(from) : undefined, geo = app.geo;
  // Where from: a spot picked on the map or found as a place or address, the stop named, else where the phone is.
  const origin = at ? { lat: at.lat, lon: at.lon } : fromSi !== undefined ? { si: fromSi } : geo ? { lat: geo.lat, lon: geo.lon } : null;
  return { spot, dest, d, name, fromSi, origin, at };
}

/** Directions from a spot, where to not chosen yet (#/go/-/at/…): the same page as directions to one, the other way
 *  round. Where to: where the rider is, a spot on the map, a stop, place or address, the Transit Center. */
function fromOnly(at) {
  const name = at.label || 'the spot you picked', path = atPath(at), key = spotKey(at.lat, at.lon, at.label);
  const hubBay = D.hub.bays[0] ? stop(D.hub.bays[0].stop).id : null;
  const parts = [html`<div class="backbar"><a class="btn btn-ghost" href="#/map/${path}" onclick="if(history.state&&history.state.prev){history.back();return false}">${icon('back', 22)}Back</a></div>`];
  parts.push(html`<div class="head tight"><span class="eyebrow">Directions by bus</span><h1>From ${name}</h1></div>`);
  parts.push(html`<div class="ask"><button class="btn btn-primary btn-lg blueprint" id="go-home" type="button" data-from="${path}">${corners()}${icon('near', 20)}To where I am</button>
    <a class="btn btn-secondary btn-lg btn-block" href="#/map/to/${key}">${icon('map', 20)}To a spot on the map</a>
    <a class="btn btn-secondary btn-lg btn-block" href="#/search?from=${encodeURIComponent(key)}">To a stop, place or address</a>
    ${hubBay ? html`<a class="btn btn-secondary btn-lg btn-block" href="#/go/${hubBay}/${path}">To the ${D.hub.name}</a>` : ''}
    <span class="ask-note">Location stays on this device. It picks the stops you could get off at, a walk from where you are.</span></div>`);
  return { html: parts.join(''), mount, title: 'Directions' };
}

/** Save trip, under the From/To pair it keeps (not by the title, where a star reads as saving the stop, beside a spot's
 *  own): these two ends for the home page (tripCards), after any saved before. From where you are, the end kept is
 *  where that is (hereEnd). Either way round is the same trip, saved; unsaved here, it alone goes. Three saved, a
 *  fourth takes the last one's place, and says so first, as a second Home says where it moves from: the last, not
 *  the first, which is the commute the card is for and, without a location, the one shown whole. */
function tripSave(to, from) {
  if (!from) return '';
  const list = savedTrips(), on = list.some(t => isTrip(t, to, from)), out = !on && list.length >= CAP ? list[CAP - 1] : null;
  const e = out && endsOf(asTo(out.to), asFrom(out.from));
  const twin = e && list.some(t => t !== out && endsOf(asTo(t.to), asFrom(t.from))?.name === e.name);   // two to one place: which
  const was = e ? `instead of the one to ${e.name}${twin ? ' from ' + fromNameOf(e) : ''}` : '';
  return html`<button type="button" class="tripsave" id="trip-save" data-to="${to}" data-from="${from}" aria-pressed="${on ? 'true' : 'false'}">${icon('star', 18, 1.5, on ? 'currentColor' : 'none')}<span>${on ? 'Saved trip · on your home page' : 'Save trip'}</span>${was ? html`<small>${was}</small>` : ''}</button>`;
}
/** Where from, by name: a spot's label, a stop's (the Center as itself), or where the phone is. */
const fromNameOf = ({ at, fromSi }) => at ? (at.label || 'the spot you picked') : fromSi !== undefined ? (stop(fromSi).hub ? D.hub.name : stopTitle(fromSi)) : 'Where you are';
/** The page's head: Back, where to; and the trip's two ends as a labelled pair, From and To, with a swap between
 *  them. From, tapped, opens the start picker under the pair (once there's a start; without one the picker is the page). */
function headOf(to, e, at, t, clockNow = now()) {
  const { spot, d, name, fromSi, origin, dest } = e;
  const key = encodeURIComponent(to);   // the destination in the search's address
  const geo = app.geo;
  const back = spot ? `#/map/at/${d.lat.toFixed(5)},${d.lon.toFixed(5)}/${encodeURIComponent(d.label)}` : `#/stop/${d.id}`;
  const chosen = !!at || fromSi !== undefined;
  const fromName = fromNameOf(e);
  const parts = [html`<div class="backbar"><a class="btn btn-ghost" href="${back}" onclick="if(history.state&&history.state.prev){history.back();return false}">${icon('back', 22)}Back</a>${spot ? placeStar({ lat: d.lat, lon: d.lon, label: d.label || name }, true) : ''}${shareButton(shareOf(name, chosen ? fromName : null, t))}</div>`];
  const hubBay = D.hub.bays[0] ? stop(D.hub.bays[0].stop).id : null;
  parts.push(html`<div class="head tight"><span class="eyebrow">Directions by bus</span><h1>To ${name}</h1>${!spot && d.town && d.town !== 'Logan' && !d.hub ? html`<div class="muted">${d.town}</div>` : ''}</div>`);
  // The other way round: from where this goes to, to where it starts (where you are, as the spot the phone has).
  const toKey = at ? spotKey(at.lat, at.lon, at.label) : fromSi !== undefined ? stop(fromSi).id : geo ? spotKey(geo.lat, geo.lon, 'where you are') : null;
  const fromPath = spot ? atPath({ lat: d.lat, lon: d.lon, label: d.label || name }) : d.id;
  const swap = toKey ? html`<a class="pr-swap" href="#/go/${toKey}/${fromPath}" aria-label="Swap from and to">${icon('swap', 20)}</a>` : '';
  const from = origin ? {
    pair: html`<div class="pair"><div class="pr"><span class="pr-k">From</span><button type="button" class="pr-v" id="go-from" aria-expanded="${fromOpen ? 'true' : 'false'}">${icon(at ? 'pin' : fromSi !== undefined ? 'stops' : 'near', 16)}<span>${fromName}</span>${icon('down', 14)}</button></div>
      <div class="pr"><span class="pr-k">To</span><span class="pr-v">${icon(spot ? 'pin' : 'stops', 16)}<span>${name}</span></span></div>${swap}</div>`,
    // The picker only once it's opened (mount redraws the page for it): built on every redraw, hidden, it planned the
    // way from the Center each minute and each feed, for nothing.
    picker: fromOpen ? html`<div class="fromacts">${startPicker(to, e, key, hubBay, clockNow)}</div>` : html`<div class="fromacts" hidden></div>`,
    save: tripSave(to, fromSi !== undefined ? stop(fromSi).id : at ? atPath(at) : geo ? hereEnd(geo) : null),
  } : null;
  return { parts, key, hubBay, from };
}
/** The start, picked: search for a stop, place or address; where I am, the one main action; then the Transit Center
 *  (with the way from it, worked out), a spot on the map, and the places this phone knows (saved, and stops opened
 *  lately), each a row. The destination itself is never offered. */
function startPicker(to, e, key, hubBay, clockNow) {
  const { d, spot, dest } = e;
  const hubSi = D.hub.bays[0] ? D.hub.bays[0].stop : undefined;
  let hubPreview = '';
  if (hubSi !== undefined && !(d && d.hub)) {
    try {
      const f = journeys({ si: hubSi }, dest, clockNow, 2, null, true), p = f && f.plans && f.plans[0];
      if (f && f.walk !== undefined) hubPreview = f.walk ? `A ${walked(f.walk)} walk` : '';
      else if (p) {
        const rides = p.legs.filter(l => l.kind === 'ride'), last = p.legs[p.legs.length - 1];
        hubPreview = html`${rides.map((l, i) => html`${i ? ', then ' : ''}${l.u ? chip(l.r, 18) : badge(l.r, 18)}`)}${last.kind === 'walk' && last.mins >= 1 ? html`, then ${last.mins} min on foot` : ''} · ${p.arrive - p.leave} min`;
      }
    } catch { /* no preview: the row still opens the way */ }
  }
  const isDest = p => spot ? Math.abs(p.lat - d.lat) < 1e-4 && Math.abs(p.lon - d.lon) < 1e-4 : false;
  const saved = myPlaces().filter(p => !isDest(p)).slice(0, 4);
  const lately = recent().filter(id => !(d && d.id === id)).map(id => stopIndex(id)).filter(si => si !== undefined && si !== dest && !stop(si).hub).slice(0, 3);   // the Center has its own row
  return html`<div class="startpick">
    <a class="sp-search" href="#/search?for=${key}">${icon('search', 20)}<span>Stop, place or address</span></a>
    <button type="button" class="sp-main blueprint" id="go-near">${corners()}${icon('near', 22)}<span class="col"><b>Where I am</b><span class="sub">Uses location on this device only</span></span></button>
    ${hubBay && !(d && d.hub) ? html`<a class="sp-row" href="#/go/${to}/${hubBay}">${icon('hub', 22)}<span class="col"><b>${D.hub.name}</b><span class="sub">${hubPreview || 'Every route starts here'}</span></span></a>` : ''}
    <a class="sp-row" href="#/map/from/${to}">${icon('map', 22)}<span class="col"><b>A spot on the map</b><span class="sub">Drop a pin</span></span></a>
    ${saved.length || lately.length ? html`<div class="sp-sec">On this device</div>${saved.map(p => html`<a class="sp-row" href="#/go/${to}/${atPath(p)}">${icon('star', 22)}<span class="col"><b>${p.label}</b>${p.sub ? html`<span class="sub">${p.sub}</span>` : ''}</span></a>`)}${lately.map(si => html`<a class="sp-row" href="#/go/${to}/${stop(si).id}">${icon('history', 22)}<span class="col"><b>${stop(si).hub ? D.hub.name : stopTitle(si)}</b>${stop(si).town && stop(si).town !== 'Logan' ? html`<span class="sub">${stop(si).town}</span>` : ''}</span></a>`)}` : ''}
    <span class="ask-note">Location stays on this device. It picks the stops you can walk to.</span></div>`;
}

/** What a shared link to these directions opens: the address as it is, but the way picked only from a start picked
 *  (from the rider's location the start is theirs, not the sharer's, and so are the ways), and said in words. */
function shareOf(name, fromName, t) {
  let [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const q = new URLSearchParams(query);
  // A saved place at either end goes as its address, rounded to the street: never 'Home', exactly where.
  const as = (lat, lon, label) => sharedAs(+lat, +lon, decodeURIComponent(label || ''));
  path = path.replace(/@(-?[\d.]+),(-?[\d.]+)(?::([^/]*))?/, (m, la, lo, lb) => { const p = as(la, lo, lb); if (p.label !== decodeURIComponent(lb || '')) { name = p.label; } return spotKey(p.lat, p.lon, p.label); })
    .replace(/at\/(-?[\d.]+),(-?[\d.]+)\/([^/?]*)/, (m, la, lo, lb) => { const p = as(la, lo, lb); if (fromName && p.label !== decodeURIComponent(lb || '')) fromName = p.label; return atPath(p); });
  if (!fromName) q.delete('plan');
  const c = leaveAt(t, now()), qs = q.toString();
  const when = c ? `${c.by ? 'Arrive by' : 'Leave at'} ${clockText(c.min)}${c.ymd !== now().ymd ? ', ' + fmtDay(c.ymd, true) : ''}` : '';
  return { url: siteLink(path + (qs ? '?' + qs : '')), title: `Directions to ${name}`, lines: [fromName ? `From ${fromName}` : 'From wherever they are when they open it', when].filter(Boolean) };
}
/** When, from the address: 'leave at' (t=20260930-0815) or 'arrive by' (t=a20260930-0900), as the clock picked
 *  and `by` for the second; null for now. A time already gone is now. */
function leaveAt(t, clockNow) {
  const m = /^(a?)(\d{8})-(\d{2})(\d{2})$/.exec(t || '');
  if (!m) return null;
  const c = { ymd: m[2], dow: dayFrom(m[2]).dow, min: +m[3] * 60 + +m[4], sec: 0, by: !!m[1] };
  return c.ymd < clockNow.ymd || (c.ymd === clockNow.ymd && c.min <= clockNow.min) ? null : c;
}
/** The ways for a time picked, or for now: arriving by, the latest leaving that get there in time, from now on if it's
 *  today (from the day's start if later); none, the first way there, said so (lateBy). */
function waysFor(origin, dest, fixed, clockNow) {
  // The shuttle by its buses while they're out, by its hours and longest wait for a time further off (planNetBy).
  const c = fixed || clockNow, live = liveFor(fixed, clockNow), sh = live ? planNet(clockNow) : planNetBy();
  if (!fixed || !fixed.by) { const sh2 = live ? planNet(c) : planNetBy(); return { found: journeys(origin, dest, c, 8, sh2, live), c, live, sh: sh2 }; }
  const from = fixed.ymd === clockNow.ymd ? clockNow : { ...fixed, min: 0 };
  const found = journeys(origin, dest, from, 8, sh, live, fixed.min);
  if (found.walk !== undefined || found.plans.length) return { found, c, live, sh };
  return { found: journeys(origin, dest, from, 8, sh, live), c: from, live, lateBy: true, sh };
}
/** The feed's word counts for now and the next hour and a half today; a time further off is the timetable's alone
 *  (and the shuttle, whose times are its buses' whereabouts, only then). */
/** The shuttle where the ways above couldn't have it (its buses not out, or a time picked: no timetable, no times),
 *  on a day it runs and at the hour: the loops that go from near here to near there, how long the ride, and when it
 *  runs; each its boarding stop, a tap. Where even its longest wait (a bus once round the loop) beats the best way by
 *  bus (`plans`: arriving by a time, the leaving it takes; leaving at one, the getting there), it's said first, as the
 *  better way: arriving by 7 on campus, the Evening Express a few minutes before, not Route 2 an hour early. */
function shuttleNote(o, d, c, sh, plans = []) {
  if (sh || !U || !U.service || !U.service.days[(dayFrom(c.ymd).dow + 6) % 7]) return '';
  const runs = (x, at) => !offHours([x.ri], { ...c, min: at });
  const also = shuttleAlso(o, d).map(x => {
    const worst = Math.ceil(x.mins + lapSecs(x.ri) / 60);   // the walks, the longest wait, the ride
    return { ...x, worst, leave: c.by ? c.min - worst : c.min };
  }).filter(x => runs(x, x.leave) && runs(x, x.leave + x.worst - Math.ceil(x.wb / 80)));   // running from boarding to getting off
  if (!also.length) return '';
  const p = plans[0], bus = !p ? Infinity : c.by ? c.min - p.leave : p.arrive - c.min;
  const hrs = ri => { const h = hours(ri); return h.charAt(0).toUpperCase() + h.slice(1); };
  const how = x => `on at ${U.stops[x.a].name}${x.wa >= 60 ? ` (${metres(x.wa)} walk)` : ''}, about ${Math.max(1, Math.round(x.secs / 60))} min to ${U.stops[x.b].name}`;
  return html`<div class="shuttle-also">${also.map(x => x.worst < bus ? html`<a class="sa-row better" href="#/usu/${U.stops[x.a].id}">${chip(x.ri, 24)}<div class="col"><b>Quicker by the ${U.routes[x.ri].name}</b>
    <span class="sub">${cap(how(x))}. A bus at least every ${Math.ceil(lapSecs(x.ri) / 60)} min: ${c.by ? `leave by ${clockText(x.leave)} to be there by ${clockText(c.min)}` : `there by ${clockText(c.min + x.worst)} at the latest`}.</span></div>${icon('fwd', 18)}</a>`
    : html`<a class="sa-row" href="#/usu/${U.stops[x.a].id}">${chip(x.ri, 24)}<div class="col"><b>The ${U.name} also goes there</b>
    <span class="sub">${U.routes[x.ri].name}: ${how(x)}. ${hrs(x.ri)}. Its times show here while its buses are out.</span></div>${icon('fwd', 18)}</a>`)}</div>`;
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const tooLate = c => html`<div class="callout">${icon('info', 20)}<div><b>No bus gets there by ${clockText(c.min)}</b><div class="sub">The first way there:</div></div></div>`;
const liveFor = (c, clockNow) => !c || (c.ymd === clockNow.ymd && c.min - clockNow.min <= 90);
const hashWith = t => location.hash.split('?')[0] + (t ? '?t=' + t : '');
const dayWord = ymd => { const today = now().ymd; return ymd === today ? 'today' : ymd === dayFrom(today, 1).ymd ? 'tomorrow' : dayName(ymd); };
let pickBy = false, pickOpen = false, pickFor = null, fromOpen = false;   // the pickers and the start's choices, open through redraws
/** Leave or arrive by, as a switch, and when: Now, or the time picked; the button opens the phone's own date and
 *  time pickers, a week ahead, Set putting the time in the address. */
function whenControl(c, clockNow) {
  const today = dayFrom(clockNow.ymd), iso = ymd => ymd.slice(0, 4) + '-' + ymd.slice(4, 6) + '-' + ymd.slice(6, 8);
  const at = c || clockNow, hh = String(Math.floor(at.min / 60) % 24).padStart(2, '0'), mm = String(at.min % 60).padStart(2, '0');
  const label = c ? `${clockText(c.min)} ${dayWord(c.ymd)}` : 'Now';
  // Leave or arrive as switched, kept through the page's redraws (the minute, the feed) till Set.
  const key = (c ? (c.by ? 'a' : '') + c.ymd + c.min : '');
  if (pickFor !== key) { pickFor = key; pickBy = !!(c && c.by); pickOpen = false; }
  const by = pickBy;
  return { btn: html`<div class="whenrow"><div class="seg" role="group" aria-label="Leave or arrive"><button type="button" data-by="0" aria-pressed="${by ? 'false' : 'true'}">Leave</button><button type="button" data-by="1" aria-pressed="${by ? 'true' : 'false'}">Arrive by</button></div><button type="button" class="btn btn-secondary" id="go-when" aria-expanded="${pickOpen ? 'true' : 'false'}">${icon('clock', 18)}<span class="gw-t">${label}</span>${icon('down', 14)}</button></div>`,
    pick: html`<div class="gowhen-pick"${pickOpen ? '' : ' hidden'}><input class="input" type="date" id="go-date" value="${iso(at.ymd)}" min="${iso(today.ymd)}" max="${iso(dayFrom(clockNow.ymd, 7).ymd)}" aria-label="Day">
    <input class="input" type="time" id="go-time" value="${hh}:${mm}" step="300" aria-label="Time"><button type="button" class="btn btn-primary" id="go-set">Set</button>${c ? html`<button type="button" class="btn btn-ghost" id="go-now">Now</button>` : ''}</div>` };
}
/** The trip's settings: From and To, the start picker under them when open, then leave or arrive and when. */
const tripRow = (from, when) => html`<div class="gowhen">${from ? from.pair : ''}${from ? from.picker : ''}${from ? from.save : ''}${when.btn}${when.pick}</div>`;

export function render({ to, from, at, plan, t }, clockNow) {
  if (to === '-' && at) return fromOnly(at);
  const e = ends({ to, from, at }), { spot, dest, d, name, origin } = e;
  if (dest === undefined) return { html: html`<div class="backbar"><a class="btn btn-ghost" href="#/">${icon('back', 22)}Stops</a></div><div class="empty"><h2>No such stop</h2></div>`, title: 'Directions' };
  const { parts, key, hubBay, from: fromCtl } = headOf(to, e, at, t, clockNow);
  if (!origin) {
    parts.push(html`<div class="head tight pickhead"><h2>Where from?</h2></div>`, startPicker(to, e, key, hubBay, clockNow));
    return { html: parts.join(''), mount, title: 'Directions' };
  }

  const fixed = leaveAt(t, clockNow);
  parts.push(tripRow(fromCtl, whenControl(fixed, clockNow)));
  const { found, c, lateBy, sh } = waysFor(origin, dest, fixed, clockNow);   // the shuttle too, while it runs
  const also = shuttleNote(origin.si !== undefined ? stop(origin.si) : origin, d, fixed || c, sh, lateBy ? [] : found.plans);
  if (found.walk !== undefined) {
    parts.push(html`<div class="callout">${icon('info', 20)}<div><b>${found.walk ? `It's a ${walked(found.walk)} walk` : "You're there"}</b><div class="sub">${found.walk ? html`No bus to catch. <a href="${walkHref(d.lat, d.lon, name)}" target="_blank" rel="noopener">Walk there</a>` : spot ? 'This is the spot.' : 'This is the stop.'}</div></div></div>`);
    return { html: parts.join(''), mount, title: 'Directions' };
  }
  if (!found.plans.length) return { html: parts.concat(noWay(e, to, hubBay, also)).join(''), mount, title: 'Directions', journey: noWayJourney(e, to, parts, hubBay, also) };
  // Directions are the map: the first way (or the one the address names) drawn, and this, the sheet under it (beside
  // it on a wide screen), with the ways as rows to draw another.
  if (lateBy) parts.push(tooLate(fixed));
  const J = pickPlan(found.plans, plan, e, c, fixed ? t : null);
  return { html: sheet(J, parts, c, !!fixed, also), mount, title: 'Directions', keepScroll: true, journey: J };
}
/** The sheet: the head and the trip's settings; the way picked, summed up (leave, arrive, how long, the change) and
 *  then told step by step as a timeline; the same way later as a strip of times; and the other ways as rows, one a
 *  route, in the order asked for. */
function sheet(J, head, clockNow, fixed = false, also = '') {
  const p0 = J.plans[0], P = J.plans[J.i];
  const day = p0.day > 0 ? html`<div class="dayhead">${fixed ? fmtDay(p0.ymd, true) + ' · nothing more that day' : (p0.day === 1 ? 'Tomorrow, ' + fmtDay(p0.ymd) : fmtDay(p0.ymd, true)) + ' · nothing more today'}</div>` : '';
  const key = sigOf(P);
  const same = J.plans.map((p, k) => [p, k]).filter(([p, k]) => k !== J.i && sigOf(p) === key);
  const others = J.plans.map((p, k) => [p, k]).filter(([p, k]) => k !== J.i && sigOf(p) !== key);
  // One row a route among the other ways: the first of each, the rest of its times said on it.
  const groups = new Map();
  for (const [p, k] of others) { const g = sigOf(p); if (!groups.has(g)) groups.set(g, []); groups.get(g).push([p, k]); }
  const later = same.length ? html`<div class="later"><span class="k">Same way, ${same.every(([p]) => p.leave < P.leave) ? 'earlier' : 'later'}</span><span class="ts">${same.map(([p, k]) => html`<a class="chip" href="${J.hrefs[k]}">${clockText(p.leave)}</a>`)}</span></div>` : '';
  const sortRow = groups.size ? html`<div class="section between otherways"><span>${groups.size ? 'Other ways' : ''}</span><span class="chips-inline">${groups.size ? html`<button type="button" class="chip" data-sort="walk" aria-pressed="${goSort() === 'walk' ? 'true' : 'false'}">Least walking</button>` : ''}</span></div>` : '';
  const rows = groups.size ? html`<div class="jrows" role="list">${[...groups.values()].map(g => planRow(g[0][0], J.hrefs[g[0][1]], g.slice(1), clockNow, fixed))}</div>` : '';
  return html`<div class="gohead">${head}${day}${also}${summary(P, J, clockNow, fixed)}${walkAll(J, P, clockNow)}</div>
    <div class="journeysheet legs">${timeline(P, J)}${later}${sortRow}${rows}</div>
    <div class="fine">From the timetable and the live feed, worked out on this phone. Walks are timed from the distance as the crow flies and a third more for corners${steepKnown() ? '; the map shades steep ground red' : ''}.</div>`.s;
}
/** A way's shape, for grouping: its rides, each by route and where it's boarded. The same shape at another time is the
 *  same way, later. */
const sigOf = p => p.legs.filter(l => l.kind === 'ride').map(l => (l.u ? 'u' : '') + l.r + '@' + l.from).join('_');
/** The way picked, summed up: when it leaves and gets there, how long, and the change if there is one. */
function summary(p, J, clockNow, fixed) {
  return html`<div class="jrow picked jsum" data-go="${J.hrefs[J.i]}" aria-current="true" role="listitem link" tabindex="0">${sumOf(p, clockNow, fixed)}</div>`;
}
/** When to set off on a way, in words: 'Leave in 8 min', 'Leaving now', 'Tomorrow', 'Monday'. The one clock rule
 *  (time.js minsTo): due from its minute's start. A time picked: its day said (a plan's day 0 is the picked day's, not
 *  today). An hour off or more, as relative() says it ('Leave in 1 h 14 min', 'Later today'): at 1 AM the first bus
 *  was 'Leave in 306 min'. The summary's eyebrow and a saved trip's row (tripLine) both: a time to leave the door,
 *  never said as a bus's time at a stop. */
function eyeOf(p, clockNow, fixed = false) {
  const left = minsTo({ min: p.leave, day: 0 }, clockNow);
  return fixed ? cap(dayWord(p.ymd)) : p.day === 0 ? (left <= 0 ? 'Leaving now' : left === 1 ? 'Leave in a minute' : left < 60 ? `Leave in ${left} min` : left <= 180 ? 'Leave ' + relative({ min: p.leave, day: 0 }, clockNow) : cap(relative({ min: p.leave, day: 0 }, clockNow))) : p.day === 1 ? 'Tomorrow' : dayName(p.ymd);
}
/** The summary's words, without its row: the home page's saved trips (tripCards) say a way as this page opens with it. */
function sumOf(p, clockNow, fixed, size = 36) {
  const live = p.legs.some(l => l.kind === 'ride' && (l.t.live || (l.u && !l.t.every)));
  const walk = p.legs.filter(l => l.kind === 'walk').reduce((m, l) => m + (l.mins || 0), 0);
  const changes = p.legs.filter((l, k) => l.kind === 'ride' && p.legs.slice(0, k).some(x => x.kind === 'ride'));
  const at = [...new Set(changes.map(l => where(l.from).hub ? 'the ' + D.hub.name : stopWords(l.from)))];
  const eye = eyeOf(p, clockNow, fixed);
  // Its buses as badges first: on a phone the card opens at this block, the timeline a swipe below, and the times
  // alone didn't say which bus (a rider at the Center read the hospital's way as having no Route 2 in it).
  const rides = p.legs.filter(l => l.kind === 'ride').map(l => l.u ? chip(l.r, 22) : badge(l.r, 22));
  return html`<span class="eyebrow">${eye}</span>
    ${worstOf(p) ? html`<div class="js-t"><span class="to">Leave by</span>${time(p.leave, size, false)}</div><span class="sub">There by ${clockText(p.arrive)} at the latest, the shuttle's longest wait counted</span>`
    : html`<div class="js-t">${time(p.leave, size, live)}<span class="to">→</span>${time(p.arrive, size, live)}<span class="dur">${p.arrive - p.leave} min</span></div>`}
    <span class="sub js-legs">${rides.map((b, i) => html`${i ? html`<span class="sep">›</span>` : ''}${b}`)}<span>${changes.length ? `${changes.length === 1 ? 'One change' : changes.length + ' changes'}, at ${at.join(' and ')}` : 'No change'}${walk ? ` · ${walk} min walking` : ''}</span></span>`;
}
/** Another way as a row, one a route: its legs as badges (the walker for a walk) with minutes, how long and how much
 *  on foot, and when it leaves, large, with when it arrives; its later times, where there are any. */
function planRow(p, href, more, clockNow, fixed = false) {
  const live = p.legs.some(l => l.kind === 'ride' && (l.t.live || (l.u && !l.t.every)));
  const walk = p.legs.filter(l => l.kind === 'walk').reduce((m, l) => m + (l.mins || 0), 0);
  const rel = fixed ? dayWord(p.ymd) : p.day === 0 ? '' : p.day === 1 ? 'tomorrow' : dayName(p.ymd);
  const legs = p.legs.filter(l => l.kind === 'ride' || l.mins >= 1).map(l => l.kind === 'walk' ? html`<span class="jleg">${icon('walk', 16)}${l.mins}m</span>`
    : html`<span class="jleg">${l.u ? chip(l.r, 20) : badge(l.r, 20)}${l.off - l.on}m</span>`);
  return html`<div class="jrow" role="listitem link" tabindex="0" data-go="${href}">
    <div class="jr-top"><span class="jlegs">${legs.map((x, i) => html`${i ? html`<span class="sep">›</span>` : ''}${x}`)}</span><span class="jr-time">${time(p.leave, 26, live)}<small>${rel || (worstOf(p) ? 'by ' + clockText(p.arrive) + ' at latest' : 'arr ' + clockText(p.arrive))}</small></span></div>
    <span class="sub">${p.arrive - p.leave} min${walk ? ` · ${walk} min walking` : ''}${more.length ? ` · then ${more.map(([q]) => clockText(q.leave)).join(', ')}` : ''}</span></div>`;
}

/** A way's name in the address: its rides, a Connect bus by its trip and where it's boarded, a shuttle's (no trips)
 *  by its loop, stop and minute. Stable while the feed moves the minutes. */
export const planKey = p => p.legs.filter(l => l.kind === 'ride').map(l => l.u ? `${l.from}-${l.r}-${l.on}` : `${l.ti}-${l.from}`).join('_');
/** The way an address names among those worked out now: the same rides, a shuttle's bus within a few minutes of its
 *  own. -1 when it's gone. */
function findPlan(plans, key) {
  const want = String(key).split('_');
  let best = -1, off = Infinity;
  plans.forEach((p, i) => {
    const got = planKey(p).split('_');
    if (got.length !== want.length) return;
    let o = 0;
    for (let k = 0; k < got.length && o < Infinity; k++) {
      if (got[k] === want[k]) continue;
      const [a, b] = [got[k].split('-'), want[k].split('-')];
      o += a[0] === b[0] && a[1] === b[1] && a.length === 3 && b.length === 3 && Math.abs(a[2] - b[2]) <= 5 ? Math.abs(a[2] - b[2]) : Infinity;
    }
    if (o < off) { off = o; best = i; }
  });
  return best;
}
/** The way picked, with the others beside it for the map's card: { plans, i, from, to, dest, hrefs, top(k), legs(k),
 *  back }. A way whose first bus has since gone (the rider is on it) is kept as it was, first. */
let kept = null;
/** The ways in the order asked for: quickest (arriving soonest, then leaving latest), or least walking (the fewest
 *  minutes on foot, then arriving soonest). In the address (?sort=walk), so a chip is a navigation:
 *  the map draws an address once, and the first of the new order has to be drawn. */
/** A way's walking, for the least-walking order: its minutes on foot. */
const walkOf = p => p.legs.reduce((m, l) => m + (l.kind === 'ride' ? 0 : l.mins || 0), 0);
export const goSort = () => new URLSearchParams(location.hash.split('?')[1] || '').get('sort') === 'walk' ? 'walk' : 'quick';
// Quickest there (then leaving latest), the first opened; arriving by a time, leaving latest that makes it (then
// there soonest): to the Institute by 7, the Evening Express at 6:29, not the Green Loop at 6:25 to wait 16 minutes.
// Or by the walk.
const sortPlans = (plans, by = false) => plans.slice().sort((a, b) => goSort() === 'walk' ? (a.day - b.day) || (walkOf(a) - walkOf(b)) || (a.arrive - b.arrive)
  : by ? (a.day - b.day) || (b.leave - a.leave) || (a.arrive - b.arrive) : (a.day - b.day) || (a.arrive - b.arrive) || (b.leave - a.leave));
function pickPlan(plans0, key, e, clockNow, t = null) {
  // Arriving by: when they all make it (none does, and they're the first ways there after, quickest first)
  const by = /^a\d{8}-(\d{2})(\d{2})$/.exec(t || ''), byMin = by ? +by[1] * 60 + +by[2] : -1;
  const plans = sortPlans(plans0, !!by && plans0.every(p => p.arrive <= byMin));
  const base = location.hash.split('?')[0];
  let list = plans, i = key ? findPlan(plans, key) : -1, own = i >= 0;
  // Kept only for a way picked (not the first of whatever's listed, which then showed twice), and for the same time.
  if (i < 0 && key && kept && kept.base === base && kept.key === key && kept.t === t) { list = [kept.plan, ...plans]; i = 0; own = true; }
  if (i < 0) { if (!plans.length) return null; i = 0; }
  // Only the way the address names is kept under its name: a way gone before this page was drawn (a reload after its
  // bus left) fell back to the first listed, kept as that name, and was listed again on top of itself at the next draw.
  kept = own ? { base, key, t, plan: list[i] } : null;
  const o = e.origin.si !== undefined ? stop(e.origin.si) : e.origin;
  const fromName = e.origin.si !== undefined ? (o.hub ? D.hub.name : stopTitle(e.origin.si)) : (e.at && e.at.label) || 'Where you are';
  return { plans: list, i, from: { lat: o.lat, lon: o.lon }, fromName, to: { lat: e.d.lat, lon: e.d.lon }, name: e.name, base,
    hrefs: list.map(p => base + '?' + (t ? 't=' + t + '&' : '') + (goSort() === 'walk' ? 'sort=walk&' : '') + 'plan=' + encodeURIComponent(planKey(p))),   // a time picked, and the order, go with the way
    dest: e.dest, destName: e.name };
}
/** For the Map tab on a phone: the way the address names, worked out afresh, or null when there's none to draw. */
export function journey({ to, from, at, t }, key, clockNow) {
  const e = ends({ to, from, at });
  if (e.dest === undefined || !e.origin) return null;
  const fixed = leaveAt(t, clockNow), { found, c, lateBy, sh } = waysFor(e.origin, e.dest, fixed, clockNow);
  const J = pickPlan(found.plans || [], key, e, c, fixed ? t : null);
  const also = shuttleNote(e.origin.si !== undefined ? stop(e.origin.si) : e.origin, e.d, fixed || c, sh, lateBy ? [] : found.plans);
  // No way by bus (and not a walk): the map all the same, the two ends on it, so a rider who knows the roads sees
  // the way by car or on foot; the card says there's no bus.
  if (!J && found.walk === undefined && !(found.plans || []).length) {
    const { parts, from, hubBay } = headOf(to, e, at, t);
    parts.push(tripRow(from, whenControl(fixed, clockNow)));
    return noWayJourney(e, to, parts, hubBay, also);
  }
  if (J) { const { parts, from } = headOf(to, e, at, t); parts.push(tripRow(from, whenControl(fixed, clockNow))); if (lateBy) parts.push(tooLate(fixed)); J.sheet = () => sheet(J, parts, c, !!fixed, also); J.mount = el => mount(el, null, true); }
  return J;
}

// A shuttle stop in a plan is 'u<index>' beside Connect's stop indices.
const isU = x => typeof x === 'string';
const where = x => isU(x) ? U.stops[+x.slice(1)] : stop(x);
const stopHref = x => isU(x) ? '#/usu/' + where(x).id : '#/stop/' + where(x).id;
/** No bus goes there, and it's beyond a walk: said plainly, with what does go. How far; POOL, Connect's own
 *  on-demand ride, where the place is in its zone; and the phone's own maps for the rest. No driving worked out here. */
/** No way there by bus: far off, the maps app for the rest; within a walk's reach of the stops, no way in the week. */
function noWay(e, to, hubBay, also) {
  const { origin, d, name } = e, o = origin.si !== undefined ? stop(origin.si) : origin, apart = distance(o.lat, o.lon, d.lat, d.lon);
  // From a spot with no stop a walk off (out past the routes, Cove or Benson): not 'no bus goes there', which was
  // false; the nearest stops a bus there leaves from, to get to by car or bike.
  { const far = farOf(e, to); if (far) return [far.html]; }
  if (apart > 1000) return [noBus(d, name, apart)];
  const out = also ? [also] : [];
  out.push(html`<div class="empty"><h2>No way there by bus</h2><p>Nothing in the timetable joins these two in the next week${origin.si === undefined ? ', from the stops within a walk of you' : ''}.</p></div>`);
  if (hubBay && origin.si !== D.hub.bays[0].stop) out.push(html`<div class="chips"><a class="chip" href="#/go/${to}/${hubBay}">Try from the ${D.hub.name}</a></div>`);
  return out;
}
/** The far list that answers, either way round (a start out of a walk of any stop, or a place out of a walk of any):
 *  { html, ids, side }, its stops' ids for the map to mark, and which end they're near ('start' or 'end'). Null when neither is out of a walk. */
function farOf(e, to) {
  const o = e.origin.si !== undefined ? stop(e.origin.si) : e.origin;
  return (e.origin.si === undefined && farStarts(o, e, to)) || farEnds(e, to, e.fromSi !== undefined ? stop(e.fromSi).id : null, e.at) || null;
}
/** Out of a walk of any stop: the nearest stops a way there leaves from, each with its next way and how much more runs
 *  from it today. A farther one is listed only when it has clearly more buses left today than every nearer one (a stop on a
 *  route that runs all day, Richmond's, past one with a bus or two left, Lewiston's): near, or more often, the rider
 *  picks. Three at most. Null when a stop is within a walk (the ways' own 'no way' then) or none has a way. */
const WALK_REACH = 1000;
/** Minutes to drive to a stop this far off as the crow flies. */
const driveMins = m => Math.ceil(m * 1.33 / 20 / 60) + 5;
const farKept = new Map();   // worked out once a minute, not on every feed tick's redraw (six searches each)
function farStarts(o, e, to) {
  const k = [o.lat.toFixed(4), o.lon.toFixed(4), to, now().min].join('|');
  if (!farKept.has(k)) { if (farKept.size > 8) farKept.clear(); farKept.set(k, farStarts0(o, e, to)); }
  return farKept.get(k);
}
function farStarts0(o, e, to) {
  const near = D.stops.map((s, si) => ({ s, si, d: distance(o.lat, o.lon, s.lat, s.lon) })).filter(x => !x.s.out && !x.s.hub).sort((a, b) => a.d - b.d);
  if (!near.length || near[0].d <= WALK_REACH) return null;
  // The nearest stop of each set of routes (a town's stops are mostly the same routes; one each is enough).
  const seen = new Set(), cands = [];
  for (const x of near) { const k = x.s.routes.slice().sort().join(','); if (seen.has(k)) continue; seen.add(k); cands.push(x); if (cands.length === 6) break; }
  const c0 = now(), rows = [];
  let most = -1;
  for (const x of cands) {
    // From when the rider could be there: miles off, by car (the roads a third longer than the crow flies, 45 mph, five
    // minutes to park). A bus at 3:47 was listed from eight miles off at 3:42, there to be missed.
    const drive = driveMins(x.d), c = { ...c0, min: Math.min(c0.min + drive, 1439) };
    const p = (journeys({ si: x.si }, e.dest, c, 2).plans || [])[0];
    if (!p) continue;
    const ride = p.legs.find(l => l.kind === 'ride');
    const left = p.day === 0 && ride && !ride.u ? timesOn(ride.from, c.ymd).filter(t => t.r === ride.r && t.min >= c.min).map(t => t.min) : [];
    if (rows.length && (left.length < most * 1.5 || left.length < most + 3)) continue;   // farther and not clearly more often (half again, three more): not a better choice
    most = Math.max(most, left.length);
    rows.push({ x, p, ride, left, drive });
    if (rows.length === 3) break;
  }
  if (!rows.length) return null;
  return { html: farList('No stop within a walk of you', 'The nearest a bus there leaves from:', rows, x => `#/go/${to}/${x.s.id}`, 'away'), ids: rows.map(r => r.x.s.id), side: 'start' };
}
/** A stop's row in either list: its route, where it is, the next way, and how much more runs today. */
function farList(head, line, rows, href, rel) {
  const when = (p, m) => (p.day === 0 ? '' : p.day === 1 ? 'tomorrow ' : dayName(p.ymd) + ' ') + clockText(m);
  return html`<div class="farstarts"><div class="empty"><h2>${head}</h2><p>${line}</p></div>
    <div class="list">${rows.map(({ x, p, ride, left, drive }) => html`<a class="row" href="${href(x)}">${ride ? (ride.u ? chip(ride.r, 30) : badge(ride.r, 30)) : ''}<div class="mid"><span class="name">${stopTitle(x.si)}</span>
      <span class="sub">${metres(x.d)} ${rel}${drive ? `, a ${drive}-min drive` : ''} · leaves ${when(p, p.leave)}, there ${when(p, p.arrive)}</span>
      ${left.length ? html`<span class="sub">${left.length === 1 ? 'The last bus today' : `${left.length} buses left today, the last ${clockText(left[left.length - 1])}`}</span>` : ''}</div>${icon('fwd', 20)}</a>`)}</div></div>`;
}
/** The other way round: the start's fine, the place is out of a walk of any stop (a farm road, a canyon). The nearest
 *  stops to it a bus from here gets to, by the same choice (one of each set of routes, a farther one only when clearly
 *  more often), each with its way and its distance from the place; a tap, the way to that stop. POOL, where the place
 *  is in its zone. */
const endKept = new Map();
function farEnds(e, to, from, at) {
  const o = e.origin.si !== undefined ? stop(e.origin.si) : e.origin;
  const k = [o.lat.toFixed(4), o.lon.toFixed(4), to, now().min].join('|');
  if (!endKept.has(k)) { if (endKept.size > 8) endKept.clear(); endKept.set(k, farEnds0(e, to, from, at)); }
  return endKept.get(k);
}
function farEnds0(e, to, from, at) {
  const d = e.d, near = D.stops.map((s, si) => ({ s, si, d: distance(d.lat, d.lon, s.lat, s.lon) })).filter(x => !x.s.out && !x.s.hub).sort((a, b) => a.d - b.d);
  if (!near.length || near[0].d <= WALK_REACH) return null;
  const seen = new Set(), cands = [];
  for (const x of near) { const k = x.s.routes.slice().sort().join(','); if (seen.has(k)) continue; seen.add(k); cands.push(x); if (cands.length === 6) break; }
  const c = now(), rows = [];
  let most = -1;
  for (const x of cands) {
    const p = (journeys(e.origin, x.si, c, 2).plans || [])[0];
    if (!p) continue;
    const ride = p.legs.filter(l => l.kind === 'ride').pop();   // the bus that gets there: how often it runs
    const left = p.day === 0 && ride && !ride.u ? timesOn(ride.from, c.ymd).filter(t => t.r === ride.r && t.min >= c.min).map(t => t.min) : [];
    if (rows.length && (left.length < most * 1.5 || left.length < most + 3)) continue;
    most = Math.max(most, left.length);
    rows.push({ x, p, ride, left });
    if (rows.length === 3) break;
  }
  if (!rows.length) return null;
  // To that stop, from the same start: a stop named, a spot, or (neither) where the phone is.
  const fromPart = from ? '/' + from : at ? '/' + atPath(at) : '';
  return { html: html`${farList(`No stop within a walk of ${e.name}`, 'The nearest a bus gets you:', rows, x => `#/go/${x.s.id}${fromPart}`, 'from there')}${poolCallout(d)}`, ids: rows.map(r => r.x.s.id), side: 'end' };
}
/** The map's side of it: just the two ends, framed, and the page as its card. */
function noWayJourney(e, to, parts, hubBay, also) {
  const o = e.origin.si !== undefined ? stop(e.origin.si) : e.origin, far = farOf(e, to);
  // marks: the stops the card names (where to drive to, or where a bus gets you), for the map to show with the ends.
  // base keys its framing and its card by where to; addr is the directions' address, as a way's base is.
  return { none: true, base: 'none:' + to, addr: location.hash.split('?')[0], from: { lat: o.lat, lon: o.lon }, to: { lat: e.d.lat, lon: e.d.lon }, marks: far ? far.ids : null, side: far ? far.side : null,
    sheet: () => html`<div class="gohead gonone">${parts}${noWay(e, to, hubBay, also)}</div>`, mount: el => mount(el, null, true) };
}
/** POOL, Connect's on-demand ride, where a place is in its zone: book it, or call. */
function poolCallout(d) {
  const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return POOL && inPool(d.lat, d.lon) ? html`<div class="callout nobus-pool">${icon('info', 20)}<div><b>POOL goes there</b>
      <div class="sub">${D.agency.brand}'s on-demand ride, zero fare: book it and a van picks you up within its zone. ${POOL.hours}.</div>
      <div class="nobus-acts"><a class="btn btn-primary blueprint" href="${ios ? POOL.ios : POOL.android}" target="_blank" rel="noopener">${corners()}Book in the On-Demand app</a><a class="btn btn-secondary" href="tel:${POOL.phone}">Call ${POOL.phone}</a></div></div></div>` : '';
}
function noBus(d, name, apart) {
  const miles = apart / 1609.344, far = miles >= 10 ? Math.round(miles) + ' miles' : miles.toFixed(1) + ' miles';
  const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1), android = /Android/.test(ua);
  const ll = `${d.lat.toFixed(5)},${d.lon.toFixed(5)}`;
  const maps = android ? `geo:${ll}?q=${ll}(${encodeURIComponent(name)})` : ios ? `https://maps.apple.com/?daddr=${ll}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`;
  const pool = poolCallout(d);
  return html`<div class="empty"><h2>No bus goes there</h2><p>${name} is ${far} away, as the crow flies, and nothing in the timetable reaches within a walk of it.</p></div>
    ${pool}<p class="nobus-maps"><a href="${maps}" target="_blank" rel="noopener">Too far to walk. Open in your maps app</a></p>`;
}

/** A Connect stop in a leg by the name the bus announces (its landmark), with its address to go under it; a shuttle
 *  stop or the Transit Center has only the one name. */
const said = x => isU(x) || stop(x).hub ? null : heardName(x);
const addrLine = x => { const h = said(x); return h && h.addr ? html`<span class="sub addr">${h.addr}</span>` : ''; };
/** The way told step by step, as a timeline: times in their own column, a line down the middle in the route's
 *  colour (dotted on foot), each stop a ring and the end a dot; the change at the Center in its own frame. The step the
 *  clock is in is tinted; a bus already gone says which one comes next. For someone who doesn't know the system: stops
 *  by the names the bus announces, each bus by its badge and where it's heading. */
const CROSS = 45;   // metres: two stops this near, a change between them, are across the street from each other
/** A walk's metres as the walk is timed (geo.js walkMins): the crow's line and a third again for corners. */
const walked = d => metres(d * CORNERS);
function timeline(p, J) {
  // The clock's own now, not the time picked: arriving by 8 on Monday, Monday's 6:40 bus is neither today nor gone (it
  // said 'Missed it? The next 15 leaves at 8:10', as if the 15 ran hourly). A plan's day 0 is the picked day's.
  const clockNow = now(), rides = p.legs.filter(l => l.kind === 'ride'), today = p.ymd === clockNow.ymd, m = clockNow.min;
  const colour = l => l.u ? U.routes[l.r].color : '#' + D.routes[l.r].color;
  const within = (a, b) => today && m >= a && m < b;
  const at = x => x === undefined ? null : typeof x === 'string' && x[0] === 'u' && U ? U.stops[+x.slice(1)] : stop(x);   // a leg's end, Connect's or the shuttle's
  const tl = (t, node, body, cls = '', c = '') => html`<div class="tl ${cls}"${c ? html.raw(` style="--c:${c}"`) : ''}><span class="tl-t">${t === null ? '' : clock(t).h}</span><span class="tl-n ${node}"><i></i></span><div class="tl-b">${body}</div></div>`;
  const out = [];
  const origin = J ? (J.from && J.fromName) || null : null;
  p.legs.forEach((l, k) => {
    const prev = p.legs[k - 1], next = p.legs[k + 1];
    if (l.kind === 'walk') {
      if (prev && prev.kind === 'ride' && next && next.kind === 'ride') {   // the change, on foot
        const wait = next.on - prev.off, a = where(prev.to), b = where(next.from);
        const how = a.hub && b.hub && !next.u ? html`Walk ${walked(l.d)} to the bay for ${badge(next.r, 20)}` : l.d <= CROSS ? html`Cross the street to ${stopWords(next.from)}` : html`Walk ${walked(l.d)} to ${stopWords(next.from)}`;
        out.push(tl(null, 'none', html`<div class="tl-change"><span class="eyebrow">Change · ${wait <= l.mins ? 'as you get there' : wait - l.mins <= 0 ? 'no time to spare' : `${wait - l.mins} min to spare`}</span><span class="name">${how}</span>${a.hub && b.hub ? '' : addrLine(next.from)}<span class="sub">${wait <= l.mins ? 'The next bus leaves as you get there' : `${wait} min until it leaves`}</span></div>`, 'change' + (within(prev.off, next.on) ? ' now' : ''), colour(next)));
        return;
      }
      if (l.to !== undefined && !prev) {   // from the start to the first stop
        out.push(tl(p.leave, 'ring', html`<span class="name">${J ? J.fromName : 'Where you are'}</span><span class="sub">${icon('walk', 14)} Walk ${walked(l.d)} · about ${l.mins} min</span>`, 'walk' + (within(p.leave, next ? next.on : p.arrive) ? ' now' : '')));
        return;
      }
      // On from the last stop to where you're going: said under the get-off row (below); nothing of its own.
      if (prev && prev.kind === 'ride') return;
      out.push(tl(p.leave, 'ring', html`<span class="name">${J ? J.fromName : 'Where you are'}</span><span class="sub">${icon('walk', 14)} Walk ${walked(l.d)} · about ${l.mins} min</span>`, 'walk' + (within(p.leave, p.arrive) ? ' now' : '')));
      return;
    }
    if (prev && prev.kind === 'ride') {   // the change, staying put
      const wait = l.on - prev.off;
      out.push(tl(null, 'none', html`<div class="tl-change"><span class="eyebrow">Change · ${wait <= 0 ? 'the bus is waiting' : `${wait} min to spare`}</span><span class="name">Stay at ${stopWords(l.from)} for ${l.u ? chip(l.r, 20) : badge(l.r, 20)}</span></div>`, 'change' + (within(prev.off, l.on) ? ' now' : ''), colour(l)));
    }
    const first = l === rides[0], on = !l.u && first && l.t.live ? whereabouts(l) : '';
    // The bus gone (today, its time past): the next one of its route from the same stop, so a rider who missed it
    // has the answer in the same place.
    let missed = '';
    if (today && !l.u && isGone({ min: l.on }, clockNow) && first) {   // gone as the stop's own list drops it (time.js), not a minute later
      // Of its road's (16 AM's last gone, 16 PM's or the Preston commuter's midday run, its own badge), one that gets to
      // where this one was going: 16 AM's ride in ends at USU, 16 PM's at the Transit Center, and the commuter calls at
      // few of 16's stops.
      const road = new Set(corridor(l.r));
      const reaches = t => { const st = tripStops(t.trip), k = st.findIndex(([m, si]) => si === l.from && m === t.min), e = tripEnd(t.trip); return k >= 0 && (st.slice(k + 1).some(([, si]) => si === l.to) || (!!e && e.si === l.to)); };
      const n = nextAt(l.from, 12, clockNow).find(t => road.has(t.r) && t.min > l.on && t.day === 0 && (t.r === l.r || reaches(t)));
      missed = html`<span class="sub missed">Missed it? ${n ? html`The next ${badge(n.r, 18)} leaves at <b>${clockText(n.min)}</b>` : 'No more today on this route'}</span>`;
    }
    // A shuttle at a time picked has no times, only its longest wait: be at the stop by a time, nothing claimed after.
    out.push(tl(l.t.every ? null : l.on, 'on', html`<span class="name">${stopWords(l.from)}</span>${addrLine(l.from)}${l.t.every ? html`<span class="sub">Be at the stop by <b>${clockText(l.on)}</b></span>` : ''}
      <span class="tl-bus">${l.u ? chip(l.r, 28) : badge(l.r, 28)}<span>${toward(l)}</span>${l.u ? (l.t.every ? '' : liveMark('Estimated')) : l.t.live ? liveMark(liveWord(l.t)) : ''}</span>${on ? html`<span class="sub">${on}</span>` : ''}${missed}
      <span class="sub">${l.t.every ? `A bus at least every ${l.t.every} min · then ${Math.max(1, l.off - l.on - l.t.every)} min, ${l.n} ${l.n === 1 ? 'stop' : 'stops'}` : `Ride ${l.n} ${l.n === 1 ? 'stop' : 'stops'} · ${Math.max(1, l.off - l.on)} min`}</span>`, 'ride' + (within(l.on, l.off) ? ' now' : ''), colour(l)));
    // Getting off: the last walk, where there is one, said here; before a change, the change's own frame follows.
    const lastWalk = next && next.kind === 'walk' && !(p.legs[k + 2] && p.legs[k + 2].kind === 'ride') ? next : null;
    out.push(tl(l.t.every ? null : l.off, next ? 'ring' : 'end', html`<span class="name">${next ? 'Get off at ' : ''}${stopWords(l.to)}</span>${addrLine(l.to)}${lastWalk ? html`<span class="sub">${icon('walk', 14)} Walk ${walked(lastWalk.d)} · about ${lastWalk.mins} min</span>` : ''}`,
      (next ? 'off' : 'end') + (lastWalk && within(l.off, p.arrive) ? ' now' : ''), next && next.kind === 'walk' && p.legs[k + 2] ? colour(p.legs[k + 2]) : next && next.kind === 'ride' ? colour(next) : ''));
  });
  // The end: where you're going, at the arrival, after the last walk.
  const lastLeg = p.legs[p.legs.length - 1];
  const atWorst = worstOf(p);
  if (lastLeg.kind === 'walk') out.push(tl(atWorst ? null : p.arrive, 'end', html`<span class="name">${J ? J.destName : lastLeg.label || 'Where you’re going'}</span>${lastLeg.to !== undefined ? addrLine(lastLeg.to) : ''}${atWorst ? html`<span class="sub">There by <b>${clockText(p.arrive)}</b> at the latest</span>` : ''}`, 'end'));
  return html`<div class="tline">${out}</div>`;
}
/** Walking the whole way, beside the ways by bus: how long, how far; 'Quicker
 *  on foot' when it's sooner there (or, arriving by a time, a later start) than the way picked, in words, not lit as a
 *  second answer. A tap, the phone's own walking directions. Only a walk a rider might take: half an hour or less,
 *  or three quarters where it's the quicker way (66 min across town beside a 19-minute bus was noise). */
function walkAll(J, P, c) {
  if (!J || !J.from || !J.to) return '';
  const mins = walkMins(J.from.lat, J.from.lon, J.to.lat, J.to.lon);
  if (mins > 45) return '';
  const d = J.from && J.to ? distance(J.from.lat, J.from.lon, J.to.lat, J.to.lon) : 0;
  const better = P && (c.by ? c.min - mins > P.leave : c.min + mins < P.arrive);
  if (mins > 30 && !better) return '';
  return html`<a class="jrow walkall${better ? ' better' : ''}" href="${walkHref(J.to.lat, J.to.lon, J.destName)}" target="_blank" rel="noopener">${icon('walk', 22)}<div class="mid"><b>${better ? 'Quicker on foot' : 'Walk the whole way'}</b>
    <span class="sub">${mins} min · ${walked(d)}${better && c.by ? ` · leave by ${clockText(c.min - mins)}` : ''}</span></div>${icon('fwd', 18)}</a>`;
}
/** A way with the shuttle at a time picked: its arrival the latest it could be, not a time it's due. */
const worstOf = p => p.legs.some(l => l.kind === 'ride' && l.u && l.t.every);
/** Where a bus is heading, in words: 'Toward L.R. Hospital', 'Around the loop'. */
function toward(l) {
  if (l.u) return 'Around the loop';
  const h = headsign(l.t);
  return /loop$/i.test(h) ? 'Around the loop' : /^to /i.test(h) ? 'Toward ' + h.slice(3) : h;
}
/** A stop in a leg's words: by the name its bus announces; a shuttle stop by its own; the Transit Center as itself. */
function stopWords(x) {
  return isU(x) ? where(x).name : stop(x).hub ? 'the ' + D.hub.name : said(x).name;
}

/** 'Bus 4005 · 4 stops away, next 704 North 200 East' for a ride's bus, from the feed; '' when it has no bus. A bus
 *  still on its trip before (Route 15 runs out as one trip and back as another, the feed predicting the return
 *  while it heads out) is counted from where it is: its stops left on that trip, then ours up to the boarding stop. */
function whereabouts(l) {
  if (l.t.trip === undefined) return '';
  const u = rt.trips[D.trips[l.t.trip]], on = busOn(l.t.trip);
  let bus = on && on.bus, next = on ? on.next : undefined, before = 0;
  if (!bus && u && u.v) {
    bus = rt.buses.find(x => x.id === 'c:' + u.v) || null;
    const pti = bus ? D.trips.indexOf(bus.trip) : -1;
    if (!bus) return '';
    if (pti < 0) return `Bus ${bus.label} · on its way`;
    const ps = tripStops(pti).map(x => x[1]), a = (next = nextStopOf(bus)) !== undefined ? ps.indexOf(next) : -1;
    if (a < 0) return `Bus ${bus.label} · on its way`;
    before = ps.length - a;
  }
  if (!bus) return '';
  const who = 'Bus ' + bus.label;
  if (isLoop(l.r) || next === undefined) return who + ' · on its way';
  const seq = tripStops(l.t.trip).map(x => x[1]), a = before ? 0 : seq.indexOf(next), b = seq.indexOf(l.from);
  if (a < 0 || b < 0 || a > b) return who + ' · on its way';
  if (before + b - a === 0) return who + ' · at your stop';
  // The stops it calls at on the way, as its card lists them: not one Connect's notice closes to its route, which the
  // feed (knowing no detours) still predicts: Route 11's round 520 West 100 North (Macey's), closed on 16 Oct.
  const ymd = now().ymd, prior = before ? tripStops(D.trips.indexOf(bus.trip)).map(x => x[1]).slice(-before) : [];
  const calls = [...prior.filter(si => !closedRoutes(si, ymd).has(bus.ri)), ...seq.slice(a, b).filter(si => !closedRoutes(si, ymd).has(l.r))];
  const n = calls.length, ns = stop(calls[0] ?? l.from);
  // Headed away from the stop and coming back to it (Route 2 out to the end of its line and round): its way there
  // much longer than the road across, and the words say so, not a stop count that reads as near.
  if (before) {
    const way = [...prior, ...seq.slice(0, b + 1)];
    let d = distance(bus.lat, bus.lon, stop(way[0]).lat, stop(way[0]).lon);
    for (let i = 1; i < way.length; i++) d += distance(stop(way[i - 1]).lat, stop(way[i - 1]).lon, stop(way[i]).lat, stop(way[i]).lon);
    const across = distance(bus.lat, bus.lon, stop(l.from).lat, stop(l.from).lon), mins = Math.max(1, l.on - now().min);
    if (d > 1.6 * across + 400) return `${who} · on its way out, back past here in ${mins} min`;
  }
  if (!n) return who + ' · on its way';   // only stops it won't call at before yours: not at it yet
  return `${who} · ${n} ${n === 1 ? 'stop' : 'stops'} away, next ${ns.hub ? D.hub.name : ns.name}`;
}

// ---- Saved trips: saved on this page and kept on this phone only (as saved places are), each its two ends as this
// page's address has them (to: a stop's id or '@lat,lon:label'; from: an id or 'at/lat,lon/label'), in the order saved.
// The home page shows their ways now under the big stop (tripCards), each from the end the rider is at: the commuter's
// question, how do I get back and what's my last chance, answered without a tap. Either way round is the same trip.
const TRIPS = 'cr-trips', CAP = 3;   // three: home and work, home and school, one more; each costs a search as home redraws
const isEnds = t => !!t && typeof t.to === 'string' && typeof t.from === 'string';
/** The trips saved, in the order saved; one whose end has gone from the timetable left out (a tap would land on 'No
 *  such stop', and it couldn't be unsaved), as saved stops leave theirs out, the next save or unsave dropping it. One
 *  trip kept by the first version (cr-trip, 19 Oct 2026) is the list till then: read, never written in a redraw. */
function savedTrips() {
  let list = null;
  try { list = JSON.parse(localStorage.getItem(TRIPS) || 'null'); } catch { /* unreadable: as none */ }
  if (!Array.isArray(list)) { let one = null; try { one = JSON.parse(localStorage.getItem('cr-trip') || 'null'); } catch { /* none */ } list = one ? [one] : []; }
  return list.filter(t => isEnds(t) && endOf(t.to) && endOf(t.from)).map(({ to, from }) => ({ to, from }));
}
/** Written on a save or an unsave only: the list (none left is [], so the first version's trip doesn't come back). */
function setTrips(list) { try { localStorage.setItem(TRIPS, JSON.stringify(list)); localStorage.removeItem('cr-trip'); } catch { /* private mode: not kept */ } }
/** One end, written either way: { si } for a stop, { lat, lon, label } for a spot; null for a stop gone from the timetable. */
function endOf(k) {
  const m = /^at\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\/(.*)$/.exec(k || '');
  if (m) { let label = m[3]; try { label = decodeURIComponent(label); } catch { /* as it came */ } return { lat: +m[1], lon: +m[2], label }; }
  const sp = spotOf(k);
  if (sp) return sp;
  const si = stopIndex(k);
  return si === undefined ? null : { si };
}
/** An end as the address's where-to, or its where-from: a stop's id either way, a spot '@…' or 'at/…'. */
const asTo = k => { const e = endOf(k); return e && e.si === undefined ? spotKey(e.lat, e.lon, e.label) : k; };
const asFrom = k => { const e = endOf(k); return e && e.si === undefined ? atPath(e) : k; };
/** Where an end is: a stop's pole, the Transit Center as one place (any bay is the Center), a spot's point. */
const pointOf = e => e.si === undefined ? e : stop(e.si).hub ? D.hub : stop(e.si);
/** The same end, near enough: the same stop (the Center's bays one), or two points within a short walk (a fix moves). */
const sameEnd = (a, b) => { const x = endOf(a), y = endOf(b); if (!x || !y) return false; const p = pointOf(x), q = pointOf(y); return a === b || distance(p.lat, p.lon, q.lat, q.lon) <= 150; };
const isTrip = (t, to, from) => !!t && ((sameEnd(t.to, to) && sameEnd(t.from, from)) || (sameEnd(t.to, from) && sameEnd(t.from, to)));
/** Where you are, as a trip's end to keep: a saved place there by its name ('Home'), else the stop you're at, else the
 *  spot, by its whereabouts ('about 700 North 1000 East, Logan'): 'Where you are' would be wrong the moment you left. */
function hereEnd(g) {
  const p = myPlaces().map(p => ({ p, d: distance(g.lat, g.lon, p.lat, p.lon) })).filter(x => x.d <= 150).sort((a, b) => a.d - b.d)[0];
  if (p) return atPath({ lat: p.p.lat, lon: p.p.lon, label: p.p.name });
  const s = nearest(g.lat, g.lon, 1)[0];
  if (s && s.d <= 150) return stop(s.i).id;
  return atPath({ lat: g.lat, lon: g.lon, label: roughly(g.lat, g.lon) || 'The spot you saved' });
}

/** This page's two ends (ends()) from a trip's: null when either is gone from the timetable. */
function endsOf(to, from) {
  const f = endOf(from);
  if (!f || !endOf(to)) return null;
  const e = ends({ to, from: f.si !== undefined ? from : undefined, at: f.si === undefined ? f : null });
  return e.dest === undefined || !e.origin ? null : e;
}
/** The first way for two ends now, as this page would open with it: its own search (the shuttle while it runs, the
 *  feed's word on today's buses) and its own order, so the home page's card and the page it opens say the same.
 *  { e, found, P }: P null with no way by bus (found.walk: walk it). */
function firstWay(e, clockNow) {
  const { found } = waysFor(e.origin, e.dest, null, clockNow);
  const P = found.plans.length ? sortPlans(found.plans)[0] : null;
  return { e, found, P };
}
/** The last way of the day, by the timetable: arriving by the end of the service day, the latest leaving (plan.js, as
 *  'Arrive by' asks). Worked out once a day for each way round: the timetable's, so it doesn't move with the feed. */
const lastKept = new Map();
function lastWay(e, ymd) {
  const k = [ymd, JSON.stringify(e.origin), JSON.stringify(e.dest)].join('|');
  if (!lastKept.has(k)) {
    if (lastKept.size > 4 * CAP) lastKept.clear();   // each trip's two ways round, and room for the day after
    const f = journeys(e.origin, e.dest, { ymd, dow: dayFrom(ymd).dow, min: 0, sec: 0 }, 8, null, false, 48 * 60 - 1);
    lastKept.set(k, (f.plans || [])[0] || null);
  }
  return lastKept.get(k);
}

const NEAR_END = 800;   // an end is where the rider is within a walk of it: the big stop's own 'close enough to walk to' (home.js)
/** A saved trip now: which way round, its first way as this page would open with it, and each way round's last chance
 *  today. Null when an end is gone from the timetable (a tap would land on 'No such stop'). `near`: how far the rider
 *  is from the end it starts at, when that's within a walk (Infinity otherwise), for the order on home. `last`: this
 *  way's last today ({ leave } of the plan, or 'this' when the way shown is it); `back`: the way back's (or 'none'). */
function tripNow(t, clockNow, geo) {
  let to = asTo(t.to), from = asFrom(t.from);
  const a = endOf(from), b = endOf(to);
  if (!a || !b) return null;
  // Which way round: from the end the rider is at, within a walk of it, the nearer when both are; at neither, or with
  // no location, as it was saved. Not simply the nearer end: across town that was a countdown from an end miles off,
  // and halfway it swapped with every step the fix took.
  let near = Infinity;
  if (geo) {
    const p = pointOf(a), q = pointOf(b), dp = distance(geo.lat, geo.lon, p.lat, p.lon), dq = distance(geo.lat, geo.lon, q.lat, q.lon);
    if (dq <= NEAR_END && dq < dp) { [to, from] = [asTo(from), asFrom(to)]; near = dq; } else if (dp <= NEAR_END) near = dp;
  }
  const e = endsOf(to, from), eb = endsOf(asTo(from), asFrom(to));
  if (!e || !eb) return null;
  const w = { to, from, e, near, dest: pointOf(endOf(to)), runs: agencyRuns(clockNow.ymd), found: null, P: null, last: null, back: null };
  try {   // the planner's trouble is the card's alone: the rest of the home page still comes up (as startPicker's preview)
    const { found, P } = firstWay(e, clockNow);
    const L = w.runs ? lastWay(e, clockNow.ymd) : null, Lb = w.runs ? lastWay(eb, clockNow.ymd) : null;
    Object.assign(w, { found, P });
    // This way's last chance: the last way itself (a late bus can leave after the timetable's), or the timetable's last.
    if (P && P.day === 0 && L) w.last = planKey(P) === planKey(L) || P.leave >= L.leave ? 'this' : L;
    // The way back's: the timetable's last while it's to come; past it, the live search's word (a late bus), and
    // nothing more today when that's a later day's.
    if (w.runs) {
      const nb = Lb && !isGone({ min: Lb.leave, day: 0 }, clockNow) ? Lb : firstWay(eb, clockNow).P;
      w.back = nb && nb.day === 0 ? nb : 'none';
    }
  } catch (err) { console.error(err); w.failed = true; }
  return w;
}
/** This way's last chance in words. Nothing more today is the live search's word (its next way is a later day's), not
 *  the timetable's last minute: a late last bus is still the way, as the page lists it. A day without buses as the
 *  stop's page says it ('Connect doesn't run on Sundays.'); a gap of days, which ('no buses Sunday'). A last way as
 *  the summary's own verb has it: when to set off ('leave by'), the walk to the stop counted. */
function lastWords(w, clockNow) {
  const { P } = w;
  if (!P) return '';
  if (P.day > 0) { const quiet = P.day > 1 ? quietWords(clockNow.ymd, P.ymd) : ''; return w.runs ? 'Nothing more today' + (quiet ? ' · ' + quiet : '') : offDayWords(clockNow.ymd); }
  return w.last === 'this' ? html`<b>This is the last way today</b>` : w.last ? `Last way today: leave by ${clockText(w.last.leave)}` : '';
}
const backWords = w => !w.back ? '' : w.back === 'none' ? 'Nothing more today' : `Last way today: leave by ${clockText(w.back.leave)}`;
/** A trip's way in the card's words: the summary block, or a walk, or no way by bus. */
function wayBody(w, clockNow) {
  const { found, P } = w;
  if (w.failed) return html`<span class="sub">Tap for the ways there</span>`;
  if (found.walk !== undefined) return html`<span class="tw-none">${found.walk ? `It's a ${walked(found.walk)} walk` : "You're there"}</span><span class="sub">No bus to catch</span>`;
  if (!P) return html`<span class="tw-none">No way there by bus</span><span class="sub">Nothing in the timetable joins these two in the next week</span>`;
  const note = lastWords(w, clockNow);
  return html`${sumOf(P, clockNow, false, 26)}${note ? html`<span class="sub tw-last">${note}</span>` : ''}`;
}
/** The first trip, whole: its way as this page's summary says it, so the card and the page it opens agree; its last
 *  chance; a tap, these directions; the line under it, the way back. */
function tripFull(w, clockNow) {
  const back = backWords(w);
  return html`<a class="jrow picked jsum tripway" href="#/go/${w.to}/${w.from}"><span class="tw-to">To ${w.e.name}</span><span class="sub tw-from">from ${fromNameOf(w.e)}</span>${wayBody(w, clockNow)}</a>
    <a class="land-hub tripback" href="#/go/${asTo(w.from)}/${asFrom(w.to)}">${icon('swap', 18)}<span class="col"><span>The way back</span>${back ? html`<span class="sub">${back}</span>` : ''}</span>${icon('fwd', 18)}</a>`;
}
/** A trip after the first, as a stop's row: where to and from, its buses, this way's last chance; when to leave at its
 *  end, in the summary's own words ('Leave in 12 min'), so it isn't read as a bus's time at a stop as every other
 *  row's is. No way back of its own (three trips of two blocks each pushed the page off a phone): a tap opens its
 *  directions, whose swap is the way back, and at its other end the row turns round, its last the way back's. */
function tripLine(w, clockNow) {
  const { P } = w;
  const rides = P ? P.legs.filter(l => l.kind === 'ride').map(l => l.u ? chip(l.r, 20) : badge(l.r, 20)) : [];
  const live = !!P && P.legs.some(l => l.kind === 'ride' && (l.t.live || (l.u && !l.t.every)));
  const end = P ? html`<div class="end">${time(P.leave, 22, live)}<span class="rel">${eyeOf(P, clockNow)}</span></div>` : '';
  const last = w.failed ? 'Tap for the ways there' : w.found.walk !== undefined ? 'No bus to catch' : !P ? 'No way there by bus'
    : P.day > 0 ? lastWords(w, clockNow) : w.last === 'this' ? html`<b>Last way today</b>` : w.last ? `Last: leave by ${clockText(w.last.leave)}` : '';
  return html`<a class="stoprow triprow" href="#/go/${w.to}/${w.from}"><div class="mid"><span class="name">To ${w.e.name}</span><span class="dist">from ${fromNameOf(w.e)}</span>${rides.length || last ? html`<span class="tr-legs">${rides.map((b, i) => html`${i ? html`<span class="sep">›</span>` : ''}${b}`)}${last ? html`<span class="tr-last">${last}</span>` : ''}</span>` : ''}</div>${end}</a>`;
}
/** The saved trips on the home page (placed by home.js under the big stop): those with an end where the rider is
 *  first, then as saved; the first whole, the rest a row each. { html, to }, or null with none saved. `to`: where each
 *  way shown goes from where the rider is (its start within a walk), for home's 'Take me home': a trip to Home shown
 *  from work while the rider's downtown doesn't answer 'from here', and that line stays. */
export function tripCards(clockNow, geo) {
  const ws = savedTrips().map(t => tripNow(t, clockNow, geo)).filter(Boolean);
  if (!ws.length) return null;
  ws.sort((a, b) => (a.near < Infinity ? 0 : 1) - (b.near < Infinity ? 0 : 1));   // stable: the order saved within each
  const [first, ...rest] = ws;
  return { to: ws.filter(w => w.near < Infinity).map(w => w.dest), html: html`<div class="trip">
    <div class="land-eye"><span class="savedmark">${icon('star', 13, 1.5, 'currentColor')}${ws.length > 1 ? 'Saved trips' : 'Saved trip'}</span></div>
    ${tripFull(first, clockNow)}${rest.length ? html`<div class="list triprows">${rest.map(w => tripLine(w, clockNow))}</div>` : ''}</div>`.s };
}

function mount(el, _app, inCard = false) {
  // Save trip, or no longer: saved, after the rest (three saved, in the last one's place); unsaved, this one (either
  // way round) and no other. The button says so where it is; the home page draws them next time it's up.
  const saveTrip = b => {
    const on = b.getAttribute('aria-pressed') !== 'true', { to, from } = b.dataset, list = savedTrips();
    setTrips(on ? [...(list.length < CAP ? list : list.slice(0, CAP - 1)), { to, from }] : list.filter(t => !isTrip(t, to, from)));
    b.outerHTML = tripSave(b.dataset.to, b.dataset.from).s;   // its new words where it is, nothing else redrawn
    const nb = el.querySelector('#trip-save');
    if (nb) nb.onclick = () => saveTrip(nb);
    if (on) afterSave();   // as a stop saved: on an iPhone's browser, how to put the app on the home screen
  };
  const ts = el.querySelector('#trip-save');
  if (ts) ts.onclick = () => saveTrip(ts);
  // Least walking, on or off: the same ways re-sorted, the first drawn; in the address, so it keeps.
  for (const c of el.querySelectorAll('.chip[data-sort]')) c.onclick = () => {
    kept = null;
    const [path, query = ''] = location.hash.split('?'), q = new URLSearchParams(query);
    q.delete('plan'); if (c.getAttribute('aria-pressed') !== 'true') q.set('sort', 'walk'); else q.delete('sort');
    replaceTo(path + (q.toString() ? '?' + q.toString() : ''));   // in place, the entry's state kept (ui.js), as below
  };
  // Where I am: the phone asked for its fix now, and the directions from it (the time picked kept).
  const b = el.querySelector('#go-near');
  if (b) b.onclick = () => nearMe(g => {
    if (!g) return;
    const [path, query = ''] = location.hash.split('?'), q = new URLSearchParams(query), seg = path.replace(/^#\//, '').split('/');
    q.delete('plan'); q.delete('sort');
    replaceTo('#/go/' + seg[1] + (q.toString() ? '?' + q.toString() : ''));
  }, true);
  // From a spot to where the rider is: their fix is the end.
  const h = el.querySelector('#go-home');
  if (h) h.onclick = () => nearMe(g => { if (g) location.hash = `#/go/${spotKey(g.lat, g.lon, 'where you are')}/${h.dataset.from}`; }, true);
  // Leave or arrive by, and when: the button opens the pickers; Set puts the time in the address (the ways worked out
  // afresh from it), Now takes it out. Arrive by, switched to, opens the pickers: it needs a time.
  const fb = el.querySelector('#go-from'), fa = el.querySelector('.fromacts');
  const w = el.querySelector('#go-when'), pick = el.querySelector('.gowhen-pick');
  const setFrom = on => { fromOpen = on; if (fa) fa.hidden = !on; if (fb) fb.setAttribute('aria-expanded', String(on)); };
  const setPick = on => { pickOpen = on; if (pick) pick.hidden = !on; if (w) w.setAttribute('aria-expanded', String(on)); };
  if (fb && fa) fb.onclick = () => { const on = fa.hidden; setFrom(on); if (on) { setPick(false); if (!fa.firstElementChild) window.dispatchEvent(new HashChangeEvent('hashchange')); } };   // opened empty: drawn with the picker in
  if (w && pick) w.onclick = () => { const on = pick.hidden; setPick(on); if (on) setFrom(false); };
  for (const b of el.querySelectorAll('.whenrow [data-by]')) b.onclick = () => { pickBy = b.dataset.by === '1'; for (const x of el.querySelectorAll('.whenrow [data-by]')) x.setAttribute('aria-pressed', String(x === b)); if (pickBy && pick && pick.hidden) { setPick(true); setFrom(false); } };
  const set = el.querySelector('#go-set');
  if (set) set.onclick = () => {
    const d = el.querySelector('#go-date').value.replace(/-/g, ''), tm = el.querySelector('#go-time').value.replace(':', '');
    const by = pickBy ? 'a' : '';
    if (/^\d{8}$/.test(d) && /^\d{4}$/.test(tm)) replaceTo(hashWith(by + d + '-' + tm));
  };
  const nw = el.querySelector('#go-now');
  if (nw) nw.onclick = () => replaceTo(hashWith(null));
  // A way's row: that way drawn, in place (Back still leaves the directions). On a phone the map's card handles the tap.
  // The one already drawn, tapped again: its legs, brought into view (on a phone the map's card does it).
  const open = c => {
    if (!c) return;
    if (c.classList.contains('picked')) {
      // the panel alone scrolled to them: scrollIntoView moved the whole app's frame too, the header off the top
      const legs = el.querySelector('.journeysheet'), box = el.closest('#side') || el;
      if (legs) box.scrollTop += legs.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
      return;
    }
    if (location.hash !== c.dataset.go) replaceTo(c.dataset.go);
  };
  for (const c of el.querySelectorAll('.jrow[data-go]')) {
    if (!inCard) c.onclick = () => open(c);
    c.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === c) { e.preventDefault(); open(c); } };
  }
}
