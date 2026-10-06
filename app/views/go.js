// Directions to a stop or a spot: from where the rider is, or from a stop they name. Each way there is one card: the walk
// to the first stop, the bus, where to change, where to get off, in order, with when.
import { D, stop, stopIndex, distance, tripStops, POOL, inPool, skipsAt } from '../data.js';
import { rt, busOn, nextStopOf, isLoop } from '../rt.js';
import { clockText, relative, metres, fmtDay, dayName, now, dayFrom } from '../time.js';
import { html, icon, badge, time, headsign, liveMark, liveWord, corners, stopTitle, heardName } from '../ui.js';
import { journeys } from '../plan.js';
import { walkHref } from '../pointer.js';
import { spotOf, spotKey, atPath, climb, RISE } from '../geo.js';
import { shareButton, siteLink } from '../share.js';
import { myPlaces, placeStar, sharedAs } from '../places.js';
import { U, planNet, chip, shuttleAlso, hours } from '../usu.js';
import { nearMe, app } from '../main.js';

/** Where to and where from, from the address: the stop or spot, its name, and the origin (null till one's chosen). */
function ends({ to, from, at }) {
  // Where to: a stop by its id, or a spot (picked on the map, or a place found) by its key.
  const spot = spotOf(to), dest = spot || stopIndex(to);
  if (dest === undefined) return { dest };
  const d = spot || stop(dest), name = spot ? spot.label || 'the spot you picked' : d.hub ? D.hub.name : d.name;
  const fromSi = from ? stopIndex(from) : undefined, geo = app.geo;
  // Where from: a spot picked on the map or found as a place or address, the stop named, else where the phone is.
  const origin = at ? { lat: at.lat, lon: at.lon } : fromSi !== undefined ? { si: fromSi } : geo ? { lat: geo.lat, lon: geo.lon } : null;
  return { spot, dest, d, name, fromSi, origin };
}

/** Directions from a spot, where to not chosen yet (#/go/-/at/…): the same page as directions to one, the other way
 *  round. Where to: where the rider is, a spot on the map, a stop, place or address, the Transit Center. */
function fromOnly(at) {
  const name = at.label || 'the spot you picked', path = atPath(at), key = spotKey(at.lat, at.lon, at.label);
  const hubBay = D.hub.bays[0] ? stop(D.hub.bays[0].stop).id : null;
  const parts = [html`<div class="backbar"><a class="btn btn-ghost" href="#/map/${path}" onclick="if(history.length>1){history.back();return false}">${icon('back', 22)}Back</a></div>`];
  parts.push(html`<div class="head tight"><span class="eyebrow">Directions by bus</span><h1>From ${name}</h1></div>`);
  parts.push(html`<div class="ask"><button class="btn btn-primary btn-lg blueprint" id="go-home" type="button" data-from="${path}">${corners()}${icon('near', 20)}To where I am</button>
    <a class="btn btn-secondary btn-lg btn-block" href="#/map/to/${key}">${icon('map', 20)}To a spot on the map</a>
    <a class="btn btn-secondary btn-lg btn-block" href="#/search?from=${encodeURIComponent(key)}">To a stop, place or address</a>
    ${hubBay ? html`<a class="btn btn-secondary btn-lg btn-block" href="#/go/${hubBay}/${path}">To the ${D.hub.name}</a>` : ''}
    <span class="ask-note">Location stays on this device. It picks the stops you could get off at, a walk from where you are.</span></div>`);
  return { html: parts.join(''), mount, title: 'Directions' };
}

/** The page's head: Back, where to, and where from with its ways to change it (once there's a start). */
function headOf(to, e, at, t) {
  const { spot, d, name, fromSi, origin } = e;
  const key = encodeURIComponent(to);   // the destination in the search's address
  const geo = app.geo;
  const back = spot ? `#/map/at/${d.lat.toFixed(5)},${d.lon.toFixed(5)}/${encodeURIComponent(d.label)}` : `#/stop/${d.id}`;
  // None chosen yet, and no location: the choice.
  const chosen = !!at || fromSi !== undefined;
  const fromName = at ? (at.label || 'the spot you picked') : fromSi !== undefined ? (stop(fromSi).hub ? D.hub.name : stopTitle(fromSi)) : 'where you are';
  const parts = [html`<div class="backbar"><a class="btn btn-ghost" href="${back}" onclick="if(history.length>1){history.back();return false}">${icon('back', 22)}Back</a>${spot ? placeStar({ lat: d.lat, lon: d.lon, label: d.label || name }, true) : ''}${shareButton(shareOf(name, chosen ? fromName : null, t))}</div>`];
  const hubBay = D.hub.bays[0] ? stop(D.hub.bays[0].stop).id : null;
  parts.push(html`<div class="head tight"><span class="eyebrow">Directions by bus</span><h1>To ${name}</h1>${!spot && d.town && d.town !== 'Logan' && !d.hub ? html`<div class="muted">${d.town}</div>` : ''}</div>`);
  // Where from, the trip's first setting, as when (whenControl) is its second: a button alike, the pin for 'from', the
  // name whole, and tapped, the ways to change it under it. It was 'From 1111 N…' and three buttons on a line.
  const from = origin ? { btn: html`<button type="button" class="btn btn-secondary" id="go-from" aria-expanded="${fromOpen ? 'true' : 'false'}" aria-label="Starting from ${fromName}">${icon(at ? 'pin' : 'near', 18)}<span class="gw-t" data-short="${gridShort(fromName)}">${fromName}</span></button>`,
    acts: html`<div class="fromacts"${fromOpen ? '' : ' hidden'}>${chosen && !geo ? html`<button class="btn btn-ghost" id="go-near" type="button">My location</button>` : ''}${chosen && geo ? html`<a class="btn btn-ghost" href="#/go/${to}">My location</a>` : ''}${myPlaces().filter(p => !(spot && Math.abs(p.lat - d.lat) < 1e-4 && Math.abs(p.lon - d.lon) < 1e-4)).map(p => html`<a class="btn btn-ghost" href="#/go/${to}/${atPath({ lat: p.lat, lon: p.lon, label: p.name })}">${p.name}</a>`)}<a class="btn btn-ghost" href="#/search?for=${key}">Stop or address</a><a class="btn btn-ghost" href="#/map/from/${to}">Map</a></div>` } : null;
  return { parts, key, hubBay, from };
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
  const c = fixed || clockNow, live = liveFor(fixed, clockNow), sh = live ? planNet(clockNow) : null;
  if (!fixed || !fixed.by) { const sh2 = live ? planNet(c) : null; return { found: journeys(origin, dest, c, 8, sh2, live), c, live, sh: sh2 }; }
  const from = fixed.ymd === clockNow.ymd ? clockNow : { ...fixed, min: 0 };
  const found = journeys(origin, dest, from, 8, sh, live, fixed.min);
  if (found.walk !== undefined || found.plans.length) return { found, c, live, sh };
  return { found: journeys(origin, dest, from, 8, sh, live), c: from, live, lateBy: true, sh };
}
/** The feed's word counts for now and the next hour and a half today; a time further off is the timetable's alone
 *  (and the shuttle, whose times are its buses' whereabouts, only then). */
/** The shuttle where the ways above couldn't have it (its buses not out, or a time picked: no timetable, no times),
 *  on a day it runs: the loops that go from near here to near there, how long the ride, and when it runs. */
function shuttleNote(o, d, c, sh) {
  if (sh || !U || !U.service || !U.service.days[(dayFrom(c.ymd).dow + 6) % 7]) return '';
  const also = shuttleAlso(o, d);
  if (!also.length) return '';
  const hrs = ri => { const h = hours(ri); return h.charAt(0).toUpperCase() + h.slice(1); };
  return html`<div class="shuttle-also">${also.map(x => html`<div class="sa-row">${chip(x.ri, 24)}<div class="col"><b>The ${U.name} also goes there</b>
    <span class="sub">${U.routes[x.ri].name}: on at ${U.stops[x.a].name}${x.wa >= 60 ? ` (${metres(x.wa)} walk)` : ''}, about ${Math.max(1, Math.round(x.secs / 60))} min to ${U.stops[x.b].name}. ${hrs(x.ri)}. Its times show here while its buses are out.</span></div></div>`)}</div>`;
}
const tooLate = c => html`<div class="callout">${icon('info', 20)}<div><b>No bus gets there by ${clockText(c.min)}</b><div class="sub">The first way there:</div></div></div>`;
const liveFor = (c, clockNow) => !c || (c.ymd === clockNow.ymd && c.min - clockNow.min <= 90);
const hashWith = t => location.hash.split('?')[0] + (t ? '?t=' + t : '');
const dayWord = ymd => { const today = now().ymd; return ymd === today ? 'today' : ymd === dayFrom(today, 1).ymd ? 'tomorrow' : dayName(ymd); };
let pickBy = false, pickOpen = false, pickFor = null, fromOpen = false;   // the pickers and the start's choices, open through redraws
/** Leave now, at a time picked, or arrive by one: the button says which; tapped, Leave or Arrive and the phone's own
 *  date and time pickers, a week ahead. */
function whenControl(c, clockNow) {
  const today = dayFrom(clockNow.ymd), iso = ymd => ymd.slice(0, 4) + '-' + ymd.slice(4, 6) + '-' + ymd.slice(6, 8);
  const at = c || clockNow, hh = String(Math.floor(at.min / 60) % 24).padStart(2, '0'), mm = String(at.min % 60).padStart(2, '0');
  const label = c ? `${c.by ? 'Arrive by' : 'Leave'} ${clockText(c.min)} ${dayWord(c.ymd)}` : 'Leave now';
  // Leave or arrive as switched in the pickers, kept through the page's redraws (the minute, the feed) till Set.
  const key = (c ? (c.by ? 'a' : '') + c.ymd + c.min : '');
  if (pickFor !== key) { pickFor = key; pickBy = !!(c && c.by); pickOpen = false; }
  const by = pickBy;
  return { btn: html`<button type="button" class="btn btn-secondary" id="go-when" aria-expanded="${pickOpen ? 'true' : 'false'}">${icon('clock', 18)}<span class="gw-t">${label}</span></button>`,
    pick: html`<div class="gowhen-pick"${pickOpen ? '' : ' hidden'}><div class="seg" role="group" aria-label="Leave or arrive"><button type="button" data-by="0" aria-pressed="${by ? 'false' : 'true'}">Leave at</button><button type="button" data-by="1" aria-pressed="${by ? 'true' : 'false'}">Arrive by</button></div><input class="input" type="date" id="go-date" value="${iso(at.ymd)}" min="${iso(today.ymd)}" max="${iso(dayFrom(clockNow.ymd, 7).ymd)}" aria-label="Day">
    <input class="input" type="time" id="go-time" value="${hh}:${mm}" step="300" aria-label="Time"><button type="button" class="btn btn-primary" id="go-set">Set</button>${c ? html`<button type="button" class="btn btn-ghost" id="go-now">Now</button>` : ''}</div>` };
}
/** A grid address the short way: '1111 N 1200 E', '55 N Main'. A direction only after a number, so North Logan and
 *  West Stadium stay as they are. Used only where it helps (fitTrip): whole, the words read better. */
const gridShort = n => String(n).replace(/(\d+)\s+(North|South|East|West)\b/g, (_, d, w) => d + ' ' + w[0]);
/** The start's name whole, unless shortening it (1111 N 1200 E) is what lets where from and when share a line, or
 *  keeps a name too long for a line of its own from being cut. Measured as drawn. */
function fitTrip(fb, w) {
  const t = fb && fb.querySelector('.gw-t[data-short]');
  if (!t || !w || !fb.offsetWidth) return;
  const full = t.dataset.full || (t.dataset.full = t.textContent), short = t.dataset.short;
  if (short === full) return;
  const inline = () => Math.round(fb.getBoundingClientRect().top) === Math.round(w.getBoundingClientRect().top);
  const cut = () => t.scrollWidth > t.clientWidth + 1;
  t.textContent = full;
  if (inline() && !cut()) return;
  t.textContent = short;
  if (inline() && !cut()) return;
  if (!cut()) { t.textContent = full; if (cut()) t.textContent = short; }   // on a line of its own: whole if it fits there
}
/** Where from and when, the trip's two settings: side by side where both fit (when drops under where from where they
 *  don't, the start's name kept whole), each one's choices opening under them the whole width. No arrow on either:
 *  a bordered button says it's one, and the two arrows kept 'from here' and 'leave now' from sharing a phone's line. */
const tripRow = (from, when) => html`<div class="gowhen"><div class="gw-row">${from ? from.btn : ''}${when.btn}</div>${from ? from.acts : ''}${when.pick}</div>`;

export function render({ to, from, at, plan, t }, clockNow) {
  if (to === '-' && at) return fromOnly(at);
  const e = ends({ to, from, at }), { spot, dest, d, name, origin } = e;
  if (dest === undefined) return { html: html`<div class="backbar"><a class="btn btn-ghost" href="#/">${icon('back', 22)}Stops</a></div><div class="empty"><h2>No such stop</h2></div>`, title: 'Directions' };
  const { parts, key, hubBay, from: fromCtl } = headOf(to, e, at, t);
  if (!origin) {
    parts.push(html`<div class="ask"><button class="btn btn-primary btn-lg blueprint" id="go-near" type="button">${corners()}${icon('near', 20)}From where I am</button>
      <a class="btn btn-secondary btn-lg btn-block" href="#/map/from/${to}">${icon('map', 20)}From a spot on the map</a>
      <a class="btn btn-secondary btn-lg btn-block" href="#/search?for=${key}">From a stop, place or address</a>
      ${hubBay ? html`<a class="btn btn-secondary btn-lg btn-block" href="#/go/${to}/${hubBay}">From the ${D.hub.name}</a>` : ''}
      <span class="ask-note">Location stays on this device. It picks the stops you can walk to.</span></div>`);
    return { html: parts.join(''), mount, title: 'Directions' };
  }

  const fixed = leaveAt(t, clockNow);
  parts.push(tripRow(fromCtl, whenControl(fixed, clockNow)));
  const { found, c, lateBy, sh } = waysFor(origin, dest, fixed, clockNow);   // the shuttle too, while it runs
  const also = shuttleNote(origin.si !== undefined ? stop(origin.si) : origin, d, c, sh);
  if (found.walk !== undefined) {
    parts.push(html`<div class="callout">${icon('info', 20)}<div><b>${found.walk ? `It's a ${metres(found.walk)} walk` : "You're there"}</b><div class="sub">${found.walk ? html`No bus to catch. <a href="${walkHref(d.lat, d.lon, name)}" target="_blank" rel="noopener">Walk there</a>` : spot ? 'This is the spot.' : 'This is the stop.'}</div></div></div>`);
    return { html: parts.join(''), mount, title: 'Directions' };
  }
  if (!found.plans.length) return { html: parts.concat(noWay(e, to, hubBay, also)).join(''), mount, title: 'Directions', journey: noWayJourney(e, to, parts, hubBay, also) };
  // Directions are the map: the first way (or the one the address names) drawn, and this, the sheet under it (beside
  // it on a wide screen), with the ways as rows to draw another.
  if (lateBy) parts.push(tooLate(fixed));
  const J = pickPlan(found.plans, plan, e, c, fixed ? t : null);
  return { html: sheet(J, parts, c, !!fixed, also), mount, title: 'Directions', keepScroll: true, journey: J };
}
/** The sheet: the head, the ways as rows (the drawn one marked), then the drawn way told leg by leg. */
function sheet(J, head, clockNow, fixed = false, also = '') {
  const p0 = J.plans[0];
  const day = p0.day > 0 ? html`<div class="dayhead">${fixed ? fmtDay(p0.ymd, true) + ' · nothing more that day' : (p0.day === 1 ? 'Tomorrow, ' + fmtDay(p0.ymd) : fmtDay(p0.ymd, true)) + ' · nothing more today'}</div>` : '';
  const sortRow = J.plans.length > 1 ? html`<div class="chips gosort">${['quick', 'walk'].map(k => html`<button type="button" class="chip" data-sort="${k}" aria-pressed="${goSort() === k ? 'true' : 'false'}">${k === 'quick' ? 'Quickest' : 'Least walking'}</button>`)}</div>` : '';
  return html`<div class="gohead">${head}${day}${also}${sortRow}<div class="jrows" role="list">${J.plans.map((p, k) => planRow(p, J.hrefs[k], k === J.i, clockNow, fixed))}</div></div>
    <div class="journeysheet legs">${planLegs(J.plans[J.i], J)}</div>
    <div class="fine">Worked out on this phone from the timetable and the live feed: leave when it says, and the next bus is the answer if one is missed. Walks are as the crow flies.</div>`.s;
}
/** A way as a row: leave and arrive, then its legs, each a badge (or the walker) with a word. */
function planRow(p, href, picked, clockNow, fixed = false) {
  const live = p.legs.some(l => l.kind === 'ride' && (l.t.live || l.u));
  // leaving at a time picked: which day, not how long from a moment that isn't now
  const rel = fixed ? dayWord(p.ymd) : p.day === 0 ? relative({ min: p.leave, day: 0 }, clockNow) : p.day === 1 ? 'tomorrow' : dayName(p.ymd);
  const legs = p.legs.filter(l => l.kind === 'ride' || l.mins >= 1).map(l => l.kind === 'walk' ? html`<span class="jleg">${icon('walk', 18)}${l.mins}m</span>`
    : html`<span class="jleg">${l.u ? chip(l.r, 20) : badge(l.r, 20)}${l.off - l.on}m</span>`);
  return html`<div class="jrow${picked ? ' picked' : ''}" role="listitem link" tabindex="0" data-go="${href}"${picked ? ' aria-current="true"' : ''}>
    <span class="jt">${time(p.leave, 20, live)}<span class="to">→</span>${time(p.arrive, 20, live)}<span class="rel">${rel}</span></span>
    <span class="jlegs">${legs.map((x, i) => html`${i ? html`<span class="sep">›</span>` : ''}${x}`)}</span></div>`;
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
 *  minutes on foot, climb and all, then arriving soonest). In the address (?sort=walk), so a chip is a navigation:
 *  the map draws an address once, and the first of the new order has to be drawn. */
/** A way's walking, for the least-walking order: its minutes on foot (which count a climb once, a minute for each
 *  10 m up) with the climb counted twice more, so a way up the bench (USU's hill from 800 East) is dearly bought
 *  against one along the flat, and a bus up the hill wins. `o` and `d` are the way's own ends; a leg's missing end is
 *  one of them. */
function walkOf(p, o, d) {
  const at = x => x === undefined ? null : typeof x === 'string' && x[0] === 'u' && U ? U.stops[+x.slice(1)] : stop(x);
  let m = 0;
  for (const l of p.legs) {
    if (l.kind === 'ride') continue;
    const a = at(l.from) || o, b = at(l.to) || d;
    m += (l.mins || 0) + (a && b ? 2 * climb(a.lat, a.lon, b.lat, b.lon) / RISE : 0);
  }
  return m;
}
export const goSort = () => new URLSearchParams(location.hash.split('?')[1] || '').get('sort') === 'walk' ? 'walk' : 'quick';
const sortPlans = (plans, o, d) => plans.slice().sort((a, b) => goSort() === 'walk' ? (walkOf(a, o, d) - walkOf(b, o, d)) || (a.arrive - b.arrive) : (a.day - b.day) || (a.arrive - b.arrive) || (b.leave - a.leave));
function pickPlan(plans0, key, e, clockNow, t = null) {
  const plans = sortPlans(plans0, e.origin.si !== undefined ? stop(e.origin.si) : e.origin, e.d);
  const base = location.hash.split('?')[0];
  let list = plans, i = key ? findPlan(plans, key) : -1, own = i >= 0;
  // Kept only for a way picked (not the first of whatever's listed, which then showed twice), and for the same time.
  if (i < 0 && key && kept && kept.base === base && kept.key === key && kept.t === t) { list = [kept.plan, ...plans]; i = 0; own = true; }
  if (i < 0) { if (!plans.length) return null; i = 0; }
  // Only the way the address names is kept under its name: a way gone before this page was drawn (a reload after its
  // bus left) fell back to the first listed, kept as that name, and was listed again on top of itself at the next draw.
  kept = own ? { base, key, t, plan: list[i] } : null;
  const o = e.origin.si !== undefined ? stop(e.origin.si) : e.origin;
  return { plans: list, i, from: { lat: o.lat, lon: o.lon }, to: { lat: e.d.lat, lon: e.d.lon }, name: e.name, base,
    hrefs: list.map(p => base + '?' + (t ? 't=' + t + '&' : '') + (goSort() === 'walk' ? 'sort=walk&' : '') + 'plan=' + encodeURIComponent(planKey(p))),   // a time picked, and the order, go with the way
    dest: e.dest, destName: e.name };
}
/** For the Map tab on a phone: the way the address names, worked out afresh, or null when there's none to draw. */
export function journey({ to, from, at, t }, key, clockNow) {
  const e = ends({ to, from, at });
  if (e.dest === undefined || !e.origin) return null;
  const fixed = leaveAt(t, clockNow), { found, c, lateBy, sh } = waysFor(e.origin, e.dest, fixed, clockNow);
  const J = pickPlan(found.plans || [], key, e, c, fixed ? t : null);
  const also = shuttleNote(e.origin.si !== undefined ? stop(e.origin.si) : e.origin, e.d, c, sh);
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
  if (apart > 1000) return [noBus(d, name, apart)];
  const out = also ? [also] : [];
  out.push(html`<div class="empty"><h2>No way there by bus</h2><p>Nothing in the timetable joins these two in the next week${origin.si === undefined ? ', from the stops within a walk of you' : ''}.</p></div>`);
  if (hubBay && origin.si !== D.hub.bays[0].stop) out.push(html`<div class="chips"><a class="chip" href="#/go/${to}/${hubBay}">Try from the ${D.hub.name}</a></div>`);
  return out;
}
/** The map's side of it: just the two ends, framed, and the page as its card. */
function noWayJourney(e, to, parts, hubBay, also) {
  const o = e.origin.si !== undefined ? stop(e.origin.si) : e.origin;
  return { none: true, base: 'none:' + to, from: { lat: o.lat, lon: o.lon }, to: { lat: e.d.lat, lon: e.d.lon },
    sheet: () => html`<div class="gohead gonone">${parts}${noWay(e, to, hubBay, also)}</div>`, mount: el => mount(el, null, true) };
}
function noBus(d, name, apart) {
  const miles = apart / 1609.344, far = miles >= 10 ? Math.round(miles) + ' miles' : miles.toFixed(1) + ' miles';
  const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1), android = /Android/.test(ua);
  const ll = `${d.lat.toFixed(5)},${d.lon.toFixed(5)}`;
  const maps = android ? `geo:${ll}?q=${ll}(${encodeURIComponent(name)})` : ios ? `https://maps.apple.com/?daddr=${ll}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`;
  const pool = POOL && inPool(d.lat, d.lon) ? html`<div class="callout nobus-pool">${icon('info', 20)}<div><b>POOL goes there</b>
      <div class="sub">${D.agency.brand}'s on-demand ride, zero fare: book it and a van picks you up within its zone. ${POOL.hours}.</div>
      <div class="nobus-acts"><a class="btn btn-primary blueprint" href="${ios ? POOL.ios : POOL.android}" target="_blank" rel="noopener">${corners()}Book in the On-Demand app</a><a class="btn btn-secondary" href="tel:${POOL.phone}">Call ${POOL.phone}</a></div></div></div>` : '';
  return html`<div class="empty"><h2>No bus goes there</h2><p>${name} is ${far} away, as the crow flies, and nothing in the timetable reaches within a walk of it.</p></div>
    ${pool}<p class="nobus-maps"><a href="${maps}" target="_blank" rel="noopener">Too far to walk. Open in your maps app</a></p>`;
}

/** A Connect stop in a leg by the name the bus announces (its landmark), with its address to go under it; a shuttle
 *  stop or the Transit Center has only the one name. */
const said = x => isU(x) || stop(x).hub ? null : heardName(x);
const addrLine = x => { const h = said(x); return h && h.addr ? html`<span class="sub addr">${h.addr}</span>` : ''; };
/** Each leg in order, for someone who doesn't know the system: the stops by the names the bus announces, each bus by
 *  its badge and where it's heading (its number on the badge, not in the words), the change as the walk it is. */
const CROSS = 45;   // metres: two stops this near, a change between them, are across the street from each other
function planLegs(p, J) {
  const rides = p.legs.filter(l => l.kind === 'ride');
  const legs = [];
  p.legs.forEach((l, k) => {
    const prev = p.legs[k - 1], next = p.legs[k + 1];
    if (l.kind === 'walk') {
      // Between two buses: the change, the walk to the other stop in it.
      if (prev && prev.kind === 'ride' && next && next.kind === 'ride') {
        const wait = next.on - prev.off, a = where(prev.to), b = where(next.from);
        const how = a.hub && b.hub && !next.u ? html`Walk ${metres(l.d)} to the bay for ${badge(next.r, 20)}` : l.d <= CROSS ? html`Cross the street to ${stopWords(next.from)}` : html`Walk ${metres(l.d)} to ${stopWords(next.from)}`;
        legs.push(html`<div class="leg change">${icon('swap', 20)}<div class="mid"><span class="name">${how}</span>${a.hub && b.hub ? '' : addrLine(next.from)}<span class="sub">${wait <= l.mins ? 'The next bus leaves as you get there' : `${wait} min until it leaves`}</span></div></div>`);
        return;
      }
      // To the first stop, or on from the last to where you're going.
      const target = l.to !== undefined ? l.to : null;
      const words = target !== null ? html`Walk to ${stopWords(target)}` : html`Walk to ${J ? J.destName : l.label || 'where you’re going'}`;
      legs.push(html`<div class="leg walk">${icon('walk', 22)}<div class="mid"><span class="name">${words}</span>${target !== null ? addrLine(target) : ''}<span class="sub">${metres(l.d)} · about ${l.mins} min</span></div></div>`);
      return;
    }
    if (prev && prev.kind === 'ride') {
      const wait = l.on - prev.off;
      legs.push(html`<div class="leg change">${icon('swap', 20)}<div class="mid"><span class="name">Stay at ${stopWords(l.from)} for ${l.u ? chip(l.r, 20) : badge(l.r, 20)}</span><span class="sub">${wait <= 0 ? 'The next bus is waiting' : `${wait} min until it leaves`}</span></div></div>`);
    }
    // The first bus, where it is: the proof the plan is real, in the bus card's own words. Later buses mostly
    // haven't started yet, and a loop's stop count means little, so those just say it's coming. A shuttle's times
    // are its buses' estimates, no timetable behind them, and say so.
    const on = !l.u && l === rides[0] && l.t.live ? whereabouts(l) : '';
    // An unannounced detour may take the bus round the stop to board or leave at: asked, with where it does stop.
    // A shuttle leg's stops aren't Connect's (looked up first, one threw, and every way with a shuttle ride was 'Something
    // went wrong'); nor are its detours.
    const q = si => {
      if (l.u || !stop(si)) return '';
      const id = stop(si).id, u = skipsAt(id).find(u => u.ri.includes(l.r));
      if (!u) return '';
      const s0 = stop(si), alt = u.on.map(x => stop(stopIndex(x))).filter(Boolean).sort((a, b) => distance(s0.lat, s0.lon, a.lat, a.lon) - distance(s0.lat, s0.lon, b.lat, b.lon))[0];
      return html`<span class="sub qnote">Skipped by the last ${u.n} of these buses<span class="qmark">?</span>${alt ? html` · they came past <a href="#/stop/${alt.id}">${alt.name}</a> instead` : ''}</span>`;
    };
    legs.push(html`<div class="leg ride">${l.u ? chip(l.r, 36) : badge(l.r, 36)}<div class="mid"><span class="name">${toward(l)}</span>
      <span class="sub">Get on at <a href="${stopHref(l.from)}">${stopWords(l.from)}</a>${said(l.from) && said(l.from).addr ? html` <span class="addr-in">${said(l.from).addr}</span>` : ''} · leaves <b>${clockText(l.on)}</b>${l.u ? liveMark('Estimated') : l.t.live ? liveMark(liveWord(l.t)) : ''}</span>${q(l.from)}${on ? html`<span class="sub">${on}</span>` : ''}
      <span class="sub">Get off at <a href="${stopHref(l.to)}">${stopWords(l.to)}</a>${said(l.to) && said(l.to).addr ? html` <span class="addr-in">${said(l.to).addr}</span>` : ''}, ${l.n} ${l.n === 1 ? 'stop' : 'stops'} on · <b>${clockText(l.off)}</b></span>${q(l.to)}</div></div>`);
  });
  return legs;
}
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
  const n = before + b - a, ns = stop(next);
  if (n === 0) return who + ' · at your stop';
  // Headed away from the stop and coming back to it (Route 2 out to the end of its line and round): its way there
  // much longer than the road across, and the words say so, not a stop count that reads as near.
  if (before) {
    const way = [...tripStops(D.trips.indexOf(bus.trip)).map(x => x[1]).slice(-before), ...seq.slice(0, b + 1)];
    let d = distance(bus.lat, bus.lon, stop(way[0]).lat, stop(way[0]).lon);
    for (let i = 1; i < way.length; i++) d += distance(stop(way[i - 1]).lat, stop(way[i - 1]).lon, stop(way[i]).lat, stop(way[i]).lon);
    const across = distance(bus.lat, bus.lon, stop(l.from).lat, stop(l.from).lon), mins = Math.max(1, l.on - now().min);
    if (d > 1.6 * across + 400) return `${who} · on its way out, back past here in ${mins} min`;
  }
  return `${who} · ${n} ${n === 1 ? 'stop' : 'stops'} away, next ${ns.hub ? D.hub.name : ns.name}`;
}

function mount(el, _app, inCard = false) {
  // Quickest or least walking: the same ways, re-sorted, the first drawn; kept for next time.
  for (const c of el.querySelectorAll('.gosort .chip')) c.onclick = () => {
    kept = null;
    const [path, query = ''] = location.hash.split('?'), q = new URLSearchParams(query);
    q.delete('plan'); if (c.dataset.sort === 'walk') q.set('sort', 'walk'); else q.delete('sort');   // the first of the new order is drawn; a time picked stays
    location.replace(location.href.split('#')[0] + path + (q.toString() ? '?' + q.toString() : ''));
  };
  const b = el.querySelector('#go-near');
  if (b) b.onclick = () => nearMe(() => window.dispatchEvent(new HashChangeEvent('hashchange')), true);
  // From a spot to where the rider is: their fix is the end.
  const h = el.querySelector('#go-home');
  if (h) h.onclick = () => nearMe(g => { if (g) location.hash = `#/go/${spotKey(g.lat, g.lon, 'where you are')}/${h.dataset.from}`; }, true);
  // Leave now, at a time, or arrive by one: the button opens the pickers; Set puts the time in the address (the ways
  // worked out afresh from it), Now takes it out. A way picked before goes: it was a way from another time.
  const fb = el.querySelector('#go-from'), fa = el.querySelector('.fromacts');
  const w = el.querySelector('#go-when'), pick = el.querySelector('.gowhen-pick');
  fitTrip(fb, w);
  // One open at a time: both open under the row, and two there at once didn't say which was whose.
  const setFrom = on => { fromOpen = on; if (fa) fa.hidden = !on; if (fb) fb.setAttribute('aria-expanded', String(on)); };
  const setPick = on => { pickOpen = on; if (pick) pick.hidden = !on; if (w) w.setAttribute('aria-expanded', String(on)); };
  if (fb && fa) fb.onclick = () => { const on = fa.hidden; setFrom(on); if (on) setPick(false); };
  if (w && pick) w.onclick = () => { const on = pick.hidden; setPick(on); if (on) setFrom(false); };
  for (const b of el.querySelectorAll('.gowhen-pick [data-by]')) b.onclick = () => { pickBy = b.dataset.by === '1'; for (const x of el.querySelectorAll('.gowhen-pick [data-by]')) x.setAttribute('aria-pressed', String(x === b)); };
  const set = el.querySelector('#go-set');
  if (set) set.onclick = () => {
    const d = el.querySelector('#go-date').value.replace(/-/g, ''), tm = el.querySelector('#go-time').value.replace(':', '');
    const by = pickBy ? 'a' : '';
    if (/^\d{8}$/.test(d) && /^\d{4}$/.test(tm)) location.replace(location.href.split('#')[0] + hashWith(by + d + '-' + tm));
  };
  const nw = el.querySelector('#go-now');
  if (nw) nw.onclick = () => location.replace(location.href.split('#')[0] + hashWith(null));
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
    if (location.hash !== c.dataset.go) location.replace(location.href.split('#')[0] + c.dataset.go);
  };
  for (const c of el.querySelectorAll('.jrow[data-go]')) {
    if (!inCard) c.onclick = () => open(c);
    c.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === c) { e.preventDefault(); open(c); } };
  }
}
