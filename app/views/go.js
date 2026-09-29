// Directions to a stop or a spot: from where the rider is, or from a stop they name. Each way there is one card: the walk
// to the first stop, the bus, where to change, where to get off, in order, with when.
import { D, stop, stopIndex, distance, tripStops, POOL, inPool } from '../data.js';
import { rt, busOn, nextStopOf, isLoop } from '../rt.js';
import { clockText, relative, metres, fmtDay, dayName, now } from '../time.js';
import { html, icon, badge, time, headsign, liveMark, liveWord, corners, stopTitle, heardName } from '../ui.js';
import { journeys } from '../plan.js';
import { walkHref } from '../pointer.js';
import { spotOf, spotKey, atPath } from '../geo.js';
import { U, planNet, chip } from '../usu.js';
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
function headOf(to, e, at) {
  const { spot, d, name, fromSi, origin } = e;
  const key = encodeURIComponent(to);   // the destination in the search's address
  const geo = app.geo;
  const back = spot ? `#/map/at/${d.lat.toFixed(5)},${d.lon.toFixed(5)}/${encodeURIComponent(d.label)}` : `#/stop/${d.id}`;
  const parts = [html`<div class="backbar"><a class="btn btn-ghost" href="${back}" onclick="if(history.length>1){history.back();return false}">${icon('back', 22)}Back</a></div>`];
  parts.push(html`<div class="head tight"><span class="eyebrow">Directions by bus</span><h1>To ${name}</h1>${!spot && d.town && d.town !== 'Logan' && !d.hub ? html`<div class="muted">${d.town}</div>` : ''}</div>`);

  // None chosen yet, and no location: the choice.
  const chosen = !!at || fromSi !== undefined;
  const fromName = at ? (at.label || 'the spot you picked') : fromSi !== undefined ? (stop(fromSi).hub ? D.hub.name : stopTitle(fromSi)) : 'where you are';
  const hubBay = D.hub.bays[0] ? stop(D.hub.bays[0].stop).id : null;
  // The start's line, with its ways to change it, once there is one; before that the ask is the whole choice.
  if (origin) parts.push(html`<div class="fromline">${icon(at ? 'pin' : 'near', 16)}<span>From <b>${fromName}</b></span>
    <span class="fromacts">${chosen && !geo ? html`<button class="btn btn-ghost" id="go-near" type="button">My location</button>` : ''}${chosen && geo ? html`<a class="btn btn-ghost" href="#/go/${to}">My location</a>` : ''}<a class="btn btn-ghost" href="#/search?for=${key}">Stop or address</a><a class="btn btn-ghost" href="#/map/from/${to}">Map</a></span></div>`);
  return { parts, key, hubBay };
}

export function render({ to, from, at, plan }, clockNow) {
  if (to === '-' && at) return fromOnly(at);
  const e = ends({ to, from, at }), { spot, dest, d, name, origin } = e;
  if (dest === undefined) return { html: html`<div class="backbar"><a class="btn btn-ghost" href="#/">${icon('back', 22)}Stops</a></div><div class="empty"><h2>No such stop</h2></div>`, title: 'Directions' };
  const { parts, key, hubBay } = headOf(to, e, at);
  if (!origin) {
    parts.push(html`<div class="ask"><button class="btn btn-primary btn-lg blueprint" id="go-near" type="button">${corners()}${icon('near', 20)}From where I am</button>
      <a class="btn btn-secondary btn-lg btn-block" href="#/map/from/${to}">${icon('map', 20)}From a spot on the map</a>
      <a class="btn btn-secondary btn-lg btn-block" href="#/search?for=${key}">From a stop, place or address</a>
      ${hubBay ? html`<a class="btn btn-secondary btn-lg btn-block" href="#/go/${to}/${hubBay}">From the ${D.hub.name}</a>` : ''}
      <span class="ask-note">Location stays on this device. It picks the stops you can walk to.</span></div>`);
    return { html: parts.join(''), mount, title: 'Directions' };
  }

  const found = journeys(origin, dest, clockNow, 8, planNet(clockNow));   // the shuttle too, while it runs
  if (found.walk !== undefined) {
    parts.push(html`<div class="callout">${icon('info', 20)}<div><b>${found.walk ? `It's a ${metres(found.walk)} walk` : "You're there"}</b><div class="sub">${found.walk ? html`No bus to catch. <a href="${walkHref(d.lat, d.lon, name)}" target="_blank" rel="noopener">Walk there</a>` : spot ? 'This is the spot.' : 'This is the stop.'}</div></div></div>`);
    return { html: parts.join(''), mount, title: 'Directions' };
  }
  if (!found.plans.length) {
    const o = origin.si !== undefined ? stop(origin.si) : origin, apart = distance(o.lat, o.lon, d.lat, d.lon);
    if (apart > 1000) return { html: parts.concat(noBus(d, name, apart)).join(''), mount, title: 'Directions' };
    parts.push(html`<div class="empty"><h2>No way there by bus</h2><p>Nothing in the timetable joins these two in the next week${origin.si === undefined ? ', from the stops within a walk of you' : ''}.</p></div>`);
    if (hubBay && origin.si !== D.hub.bays[0].stop) parts.push(html`<div class="chips"><a class="chip" href="#/go/${to}/${hubBay}">Try from the ${D.hub.name}</a></div>`);
    return { html: parts.join(''), mount, title: 'Directions' };
  }
  // Directions are the map: the first way (or the one the address names) drawn, and this, the sheet under it (beside
  // it on a wide screen), with the ways as rows to draw another.
  const J = pickPlan(found.plans, plan, e, clockNow);
  return { html: sheet(J, parts, clockNow), mount, title: 'Directions', keepScroll: true, journey: J };
}
/** The sheet: the head, the ways as rows (the drawn one marked), then the drawn way told leg by leg. */
function sheet(J, head, clockNow) {
  const p0 = J.plans[0];
  const day = p0.day > 0 ? html`<div class="dayhead">${p0.day === 1 ? 'Tomorrow, ' + fmtDay(p0.ymd) : fmtDay(p0.ymd, true)} · nothing more today</div>` : '';
  return html`<div class="gohead">${head}${day}<div class="jrows" role="list">${J.plans.map((p, k) => planRow(p, J.hrefs[k], k === J.i, clockNow))}</div></div>
    <div class="journeysheet legs">${planLegs(J.plans[J.i], J)}</div>
    <div class="fine">Worked out on this phone from the timetable and the live feed: leave when it says, and the next bus is the answer if one is missed. Walks are as the crow flies.</div>`.s;
}
/** A way as a row: leave and arrive, then its legs, each a badge (or the walker) with a word. */
function planRow(p, href, picked, clockNow) {
  const live = p.legs.some(l => l.kind === 'ride' && (l.t.live || l.u));
  const rel = p.day === 0 ? relative({ min: p.leave, day: 0 }, clockNow) : p.day === 1 ? 'tomorrow' : dayName(p.ymd);
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
function pickPlan(plans, key, e, clockNow) {
  const base = location.hash.split('?')[0];
  let list = plans, i = findPlan(plans, key);
  if (i < 0 && kept && kept.base === base && kept.key === key) { list = [kept.plan, ...plans]; i = 0; }
  if (i < 0) { if (!plans.length) return null; i = 0; }
  kept = { base, key, plan: list[i] };
  const o = e.origin.si !== undefined ? stop(e.origin.si) : e.origin;
  return { plans: list, i, from: { lat: o.lat, lon: o.lon }, to: { lat: e.d.lat, lon: e.d.lon }, name: e.name, base,
    hrefs: list.map(p => base + '?plan=' + encodeURIComponent(planKey(p))),
    dest: e.dest, destName: e.name };
}
/** For the Map tab on a phone: the way the address names, worked out afresh, or null when there's none to draw. */
export function journey({ to, from, at }, key, clockNow) {
  const e = ends({ to, from, at });
  if (e.dest === undefined || !e.origin) return null;
  const found = journeys(e.origin, e.dest, clockNow, 8, planNet(clockNow));
  const J = pickPlan(found.plans || [], key, e, clockNow);
  if (J) { const { parts } = headOf(to, e, at); J.sheet = () => sheet(J, parts, clockNow); J.mount = el => mount(el, null, true); }
  return J;
}

// A shuttle stop in a plan is 'u<index>' beside Connect's stop indices.
const isU = x => typeof x === 'string';
const where = x => isU(x) ? U.stops[+x.slice(1)] : stop(x);
const stopHref = x => isU(x) ? '#/usu/' + where(x).id : '#/stop/' + where(x).id;
/** No bus goes there, and it's beyond a walk: said plainly, with what does go. How far; POOL, Connect's own
 *  on-demand ride, where the place is in its zone; and the phone's own maps for the rest. No driving worked out here. */
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
    legs.push(html`<div class="leg ride">${l.u ? chip(l.r, 36) : badge(l.r, 36)}<div class="mid"><span class="name">${toward(l)}</span>
      <span class="sub">Get on at <a href="${stopHref(l.from)}">${stopWords(l.from)}</a>${said(l.from) && said(l.from).addr ? html` <span class="addr-in">${said(l.from).addr}</span>` : ''} · leaves <b>${clockText(l.on)}</b>${l.u ? liveMark('Estimated') : l.t.live ? liveMark(liveWord(l.t)) : ''}</span>${on ? html`<span class="sub">${on}</span>` : ''}
      <span class="sub">Get off at <a href="${stopHref(l.to)}">${stopWords(l.to)}</a>${said(l.to) && said(l.to).addr ? html` <span class="addr-in">${said(l.to).addr}</span>` : ''}, ${l.n} ${l.n === 1 ? 'stop' : 'stops'} on · <b>${clockText(l.off)}</b></span></div></div>`);
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
  const b = el.querySelector('#go-near');
  if (b) b.onclick = () => nearMe(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
  // From a spot to where the rider is: their fix is the end.
  const h = el.querySelector('#go-home');
  if (h) h.onclick = () => nearMe(g => { if (g) location.hash = `#/go/${spotKey(g.lat, g.lon, 'where you are')}/${h.dataset.from}`; });
  // A way's row: that way drawn, in place (Back still leaves the directions). On a phone the map's card handles the tap.
  const open = c => { if (c && location.hash !== c.dataset.go) location.replace(location.href.split('#')[0] + c.dataset.go); };
  for (const c of el.querySelectorAll('.jrow[data-go]')) {
    if (!inCard) c.onclick = () => open(c);
    c.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === c) { e.preventDefault(); open(c); } };
  }
}
