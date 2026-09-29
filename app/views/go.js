// Directions to a stop or a spot: from where the rider is, or from a stop they name. Each way there is one card: the walk
// to the first stop, the bus, where to change, where to get off, in order, with when.
import { D, stop, stopIndex, distance, tripStops, POOL, inPool } from '../data.js';
import { rt, busOn, nextStopOf, isLoop } from '../rt.js';
import { clockText, relative, metres, fmtDay, dayName } from '../time.js';
import { routeName, html, icon, badge, time, headsign, liveMark, liveWord, sched, corners, stopTitle, heardName } from '../ui.js';
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

export function render({ to, from, at, plan }, clockNow) {
  if (to === '-' && at) return fromOnly(at);
  const e = ends({ to, from, at }), { spot, dest, d, name, fromSi, origin } = e;
  if (dest === undefined) return { html: html`<div class="backbar"><a class="btn btn-ghost" href="#/">${icon('back', 22)}Stops</a></div><div class="empty"><h2>No such stop</h2></div>`, title: 'Directions' };
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
  const p0 = found.plans[0];
  if (p0.day > 0) parts.push(html`<div class="dayhead">${p0.day === 1 ? 'Tomorrow, ' + fmtDay(p0.ymd) : fmtDay(p0.ymd, true)} · nothing more today</div>`);
  // Each way is a link to itself on the map. On a wide screen the page stays and the way picked is drawn beside it.
  const J = plan !== undefined ? pickPlan(found.plans, plan, e, clockNow) : null, base = location.hash.split('?')[0];
  parts.push(html`<div class="plans">${found.plans.map(p => planCard(p, dest, clockNow, { href: base + '?plan=' + encodeURIComponent(planKey(p)), picked: !!J && J.plans[J.i] === p }))}</div>`);
  parts.push(html`<div class="fine">Worked out on this phone from the timetable and the live feed: leave when it says, and the next bus is the answer if one is missed. Walks are as the crow flies. Tap a way to see it on the map.</div>`);
  return { html: parts.join(''), mount, title: 'Directions', keepScroll: true, journey: J };
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
    top: k => planTop(list[k], clockNow), legs: k => planLegs(list[k]) };
}
/** For the Map tab on a phone: the way the address names, worked out afresh, or null when there's none to draw. */
export function journey({ to, from, at }, key, clockNow) {
  const e = ends({ to, from, at });
  if (e.dest === undefined || !e.origin) return null;
  const found = journeys(e.origin, e.dest, clockNow, 8, planNet(clockNow));
  return pickPlan(found.plans || [], key, e, clockNow);
}

// A shuttle stop in a plan is 'u<index>' beside Connect's stop indices.
const isU = x => typeof x === 'string';
const where = x => isU(x) ? U.stops[+x.slice(1)] : stop(x);
const stopHref = x => isU(x) ? '#/usu/' + where(x).id : '#/stop/' + where(x).id;
/** A ride's bus as the rider looks for it: a shuttle loop by its name, a Connect route as ever. */
const rideName = l => l.u ? U.routes[l.r].name : routeName(l.r);
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
 *  stop or a Transit Center bay (nameOf) has only the one name. */
const said = x => isU(x) || stop(x).hub ? null : heardName(x);
const addrLine = x => { const h = said(x); return h && h.addr ? html`<span class="sub addr">${h.addr}</span>` : ''; };
/** A stop's name in a leg: a Transit Center bay by its route, since every bay has the one street address. */
function nameOf(si, ri) {
  if (isU(si)) return where(si).name;
  const s = stop(si);
  if (!s.hub) return said(si).name;
  const r = ri !== undefined && D.hub.bays.some(b => b.stop === si && b.routes.includes(ri)) ? ri : (D.hub.bays.find(b => b.stop === si) || {}).routes?.[0];
  return r !== undefined ? `${D.hub.name} · ${routeName(r, false)} bay` : D.hub.name;
}
/** One way there: when you'll arrive, when to set off, then each leg in order. A link to itself on the map. */
function planCard(p, dest, clockNow, { href, picked } = {}) {
  return html`<div class="plan${picked ? ' picked' : ''}" role="link" tabindex="0" data-href="${href}"${picked ? ' aria-current="true"' : ''}>${planTop(p, clockNow)}<div class="legs">${planLegs(p)}</div></div>`;
}
/** Two times, one weight: when to set off and when you're there. One big arrival read as the first bus's time. */
function planTop(p, clockNow) {
  const live = p.legs.some(l => l.kind === 'ride' && (l.t.live || l.u));
  const total = p.arrive - p.leave;
  const rel = p.day === 0 ? relative({ min: p.leave, day: 0 }, clockNow) : p.day === 1 ? 'tomorrow' : dayName(p.ymd);
  const words = [`${total} min`, p.changes ? (p.changes === 1 ? '1 change' : p.changes + ' changes') : 'no change'].join(' · ');
  return html`<div class="plan-top"><div class="col"><span class="eyebrow">Leave</span>${time(p.leave, 34, live)}<span class="rel">${rel}</span></div><div class="col mid"><span class="sub">${words}</span></div><div class="col end"><span class="eyebrow">Arrive</span>${time(p.arrive, 34, live)}<span class="sub">${p.legs[p.legs.length - 1].kind === 'walk' ? 'after the walk' : 'off the bus'}</span></div></div>`;
}
/** Each leg in order: the walks, the buses, where to change. */
function planLegs(p) {
  const rides = p.legs.filter(l => l.kind === 'ride');
  const legs = [];
  p.legs.forEach((l, k) => {
    if (l.kind === 'walk') {
      const prev = p.legs[k - 1], next = p.legs[k + 1];
      // Between two buses: the change, with the walk to the other stop (a bay across the Transit Center) in it.
      if (prev && prev.kind === 'ride' && next && next.kind === 'ride') {
        const at = where(prev.to), wait = next.on - prev.off;
        legs.push(html`<div class="leg change">${icon('swap', 20)}<div class="mid"><span class="name">Change at ${at.hub ? D.hub.name : nameOf(prev.to)}</span><span class="sub">Walk ${metres(l.d)} to ${at.hub && !next.u ? `${rideName(next)}'s bay` : nameOf(next.from)} · ${wait <= l.mins ? 'the next bus leaves as you get there' : `${wait} min until it leaves`}</span></div></div>`);
        return;
      }
      const target = l.to !== undefined ? where(l.to) : null;
      const nextRide = next && next.kind === 'ride' ? next.r : undefined;
      legs.push(html`<div class="leg walk">${icon('walk', 22)}<div class="mid"><span class="name">Walk ${metres(l.d)}${target ? ` to ${nameOf(l.to, nextRide)}` : l.label ? ` to ${l.label}` : ''}</span>${target ? addrLine(l.to) : ''}<span class="sub">About ${l.mins} min</span></div></div>`);
      return;
    }
    const prev = p.legs[k - 1];
    if (prev && prev.kind === 'ride') {
      const wait = l.on - prev.off, at = where(l.from);
      legs.push(html`<div class="leg change">${icon('swap', 20)}<div class="mid"><span class="name">Change at ${at.hub ? D.hub.name : nameOf(l.from)}</span><span class="sub">Same stop · ${wait <= 0 ? 'the next bus is waiting' : `${wait} min until it leaves`}</span></div></div>`);
    }
    const to = where(l.to);
    // The first bus, where it is: the proof the plan is real, in the bus card's own words. Later buses mostly
    // haven't started yet, and a loop's stop count means little, so those just say it's coming. A shuttle's times
    // are its buses' estimates, no timetable behind them, and say so.
    const on = !l.u && l === rides[0] && l.t.live ? whereabouts(l) : '';
    legs.push(html`<div class="leg ride">${l.u ? chip(l.r, 36) : badge(l.r, 36)}<div class="mid"><span class="name">${l.u ? U.routes[l.r].name : headsign(l.t)}</span>
      <span class="sub"><a href="${stopHref(l.from)}">${nameOf(l.from, l.r)}</a>${said(l.from) && said(l.from).addr ? html` <span class="addr-in">${said(l.from).addr}</span>` : ''} · leaves <b>${clockText(l.on)}</b>${l.u ? liveMark('Estimated') : l.t.live ? liveMark(liveWord(l.t)) : ''}</span>${on ? html`<span class="sub">${on}</span>` : ''}
      <span class="sub">${l.n} ${l.n === 1 ? 'stop' : 'stops'} · off at <a href="${stopHref(l.to)}">${to.hub ? D.hub.name : nameOf(l.to)}</a>${said(l.to) && said(l.to).addr ? html` <span class="addr-in">${said(l.to).addr}</span>` : ''} · <b>${clockText(l.off)}</b></span></div></div>`);
  });
  return legs;
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
  return `${who} · ${n} ${n === 1 ? 'stop' : 'stops'} away, next ${ns.hub ? D.hub.name : ns.name}`;
}

function mount(el) {
  const b = el.querySelector('#go-near');
  if (b) b.onclick = () => nearMe(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
  // From a spot to where the rider is: their fix is the end.
  const h = el.querySelector('#go-home');
  if (h) h.onclick = () => nearMe(g => { if (g) location.hash = `#/go/${spotKey(g.lat, g.lon, 'where you are')}/${h.dataset.from}`; });
  // A way tapped (not one of its stops' links): that way on the map.
  const open = c => { if (c && location.hash !== c.dataset.href) location.hash = c.dataset.href; };
  for (const c of el.querySelectorAll('.plan[data-href]')) {
    c.onclick = e => { if (!e.target.closest('a, button')) open(c); };
    c.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === c) { e.preventDefault(); open(c); } };
  }
}
