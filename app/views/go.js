// Directions to a stop or a spot: from where the rider is, or from a stop they name. Each way there is one card: the walk
// to the first stop, the bus, where to change, where to get off, in order, with when.
import { D, stop, stopIndex, distance, tripStops } from '../data.js';
import { rt, busOn, nextStopOf, isLoop } from '../rt.js';
import { clockText, relative, metres, fmtDay, dayName } from '../time.js';
import { routeName, html, icon, badge, time, headsign, liveMark, liveWord, sched, corners, stopTitle } from '../ui.js';
import { journeys } from '../plan.js';
import { walkHref } from '../pointer.js';
import { spotOf } from '../geo.js';
import { nearMe, app } from '../main.js';

export function render({ to, from, at }, clockNow) {
  // Where to: a stop by its id, or a spot (picked on the map, or a place found) by its key.
  const spot = spotOf(to), dest = spot || stopIndex(to);
  if (dest === undefined) return { html: html`<div class="backbar"><a class="btn btn-ghost" href="#/">${icon('back', 22)}Stops</a></div><div class="empty"><h2>No such stop</h2></div>`, title: 'Directions' };
  const d = spot || stop(dest), name = spot ? spot.label || 'the spot you picked' : d.hub ? D.hub.name : d.name;
  const key = encodeURIComponent(to);   // the destination in the search's address
  const fromSi = from ? stopIndex(from) : undefined;
  const geo = app.geo;
  const back = spot ? `#/map/at/${d.lat.toFixed(5)},${d.lon.toFixed(5)}/${encodeURIComponent(d.label)}` : `#/stop/${d.id}`;
  const parts = [html`<div class="backbar"><a class="btn btn-ghost" href="${back}" onclick="if(history.length>1){history.back();return false}">${icon('back', 22)}Back</a></div>`];
  parts.push(html`<div class="head tight"><span class="eyebrow">Directions by bus</span><h1>To ${name}</h1>${!spot && d.town && d.town !== 'Logan' && !d.hub ? html`<div class="muted">${d.town}</div>` : ''}</div>`);

  // Where from: a spot picked on the map or found as a place or address, the stop named, else where the phone
  // is. None yet: the choice.
  const chosen = !!at || fromSi !== undefined;
  const origin = at ? { lat: at.lat, lon: at.lon } : fromSi !== undefined ? { si: fromSi } : geo ? { lat: geo.lat, lon: geo.lon } : null;
  const fromName = at ? (at.label || 'the spot you picked') : fromSi !== undefined ? (stop(fromSi).hub ? D.hub.name : stopTitle(fromSi)) : 'where you are';
  const hubBay = D.hub.bays[0] ? stop(D.hub.bays[0].stop).id : null;
  parts.push(html`<div class="fromline">${icon(at ? 'pin' : 'near', 16)}<span>From <b>${fromName}</b></span>
    <span class="fromacts">${chosen && !geo ? html`<button class="btn btn-ghost" id="go-near" type="button">My location</button>` : ''}${chosen && geo ? html`<a class="btn btn-ghost" href="#/go/${to}">My location</a>` : ''}<a class="btn btn-ghost" href="#/search?for=${key}">Stop or address</a><a class="btn btn-ghost" href="#/map/from/${to}">Map</a></span></div>`);
  if (!origin) {
    parts.push(html`<div class="ask"><button class="btn btn-primary btn-lg blueprint" id="go-near" type="button">${corners()}${icon('near', 20)}From where I am</button>
      ${hubBay ? html`<a class="btn btn-secondary btn-lg btn-block" href="#/go/${to}/${hubBay}">From the ${D.hub.name}</a>` : ''}
      <a class="btn btn-secondary btn-lg btn-block" href="#/search?for=${key}">From a stop, place or address</a>
      <a class="btn btn-secondary btn-lg btn-block" href="#/map/from/${to}">From a spot on the map</a>
      <span class="ask-note">Location stays on this device. It picks the stops you can walk to.</span></div>`);
    return { html: parts.join(''), mount, title: 'Directions' };
  }

  const found = journeys(origin, dest, clockNow);
  if (found.walk !== undefined) {
    parts.push(html`<div class="callout">${icon('info', 20)}<div><b>${found.walk ? `It's a ${metres(found.walk)} walk` : "You're there"}</b><div class="sub">${found.walk ? html`No bus to catch. <a href="${walkHref(d.lat, d.lon, name)}" target="_blank" rel="noopener">Walk there</a>` : spot ? 'This is the spot.' : 'This is the stop.'}</div></div></div>`);
    return { html: parts.join(''), mount, title: 'Directions' };
  }
  if (!found.plans.length) {
    parts.push(html`<div class="empty"><h2>No way there by bus</h2><p>Nothing in the timetable joins these two in the next week${origin.si === undefined ? ', from the stops within a walk of you' : ''}.</p></div>`);
    if (hubBay && origin.si !== D.hub.bays[0].stop) parts.push(html`<div class="chips"><a class="chip" href="#/go/${to}/${hubBay}">Try from the ${D.hub.name}</a></div>`);
    return { html: parts.join(''), mount, title: 'Directions' };
  }
  const p0 = found.plans[0];
  if (p0.day > 0) parts.push(html`<div class="dayhead">${p0.day === 1 ? 'Tomorrow, ' + fmtDay(p0.ymd) : fmtDay(p0.ymd, true)} · nothing more today</div>`);
  parts.push(html`<div class="plans">${found.plans.map(p => planCard(p, dest, clockNow))}</div>`);
  parts.push(html`<div class="fine">Worked out on this phone from the timetable and the live feed: leave when it says, and the next bus is the answer if one is missed. Walks are as the crow flies.</div>`);
  return { html: parts.join(''), mount, title: 'Directions' };
}

/** A stop's name in a leg: a Transit Center bay by its route, since every bay has the one street address. */
function nameOf(si, ri) {
  const s = stop(si);
  if (!s.hub) return s.name;
  const r = ri !== undefined && D.hub.bays.some(b => b.stop === si && b.routes.includes(ri)) ? ri : (D.hub.bays.find(b => b.stop === si) || {}).routes?.[0];
  return r !== undefined ? `${D.hub.name} · ${routeName(r, false)} bay` : D.hub.name;
}
/** One way there: when you'll arrive, when to set off, then each leg in order. */
function planCard(p, dest, clockNow) {
  const rides = p.legs.filter(l => l.kind === 'ride');
  const live = rides.some(l => l.t.live);
  const total = p.arrive - p.leave;
  const rel = p.day === 0 ? relative({ min: p.leave, day: 0 }, clockNow) : p.day === 1 ? 'tomorrow' : dayName(p.ymd);
  const words = [`${total} min`, p.changes ? (p.changes === 1 ? '1 change' : p.changes + ' changes') : 'no change'].join(' · ');
  const legs = [];
  p.legs.forEach((l, k) => {
    if (l.kind === 'walk') {
      const prev = p.legs[k - 1], next = p.legs[k + 1];
      // Between two buses: the change, with the walk to the other stop (a bay across the Transit Center) in it.
      if (prev && prev.kind === 'ride' && next && next.kind === 'ride') {
        const at = stop(prev.to), wait = next.on - prev.off;
        legs.push(html`<div class="leg change">${icon('swap', 20)}<div class="mid"><span class="name">Change at ${at.hub ? D.hub.name : at.name}</span><span class="sub">Walk ${metres(l.d)} to ${at.hub ? `${routeName(next.r)}'s bay` : nameOf(next.from)} · ${wait <= l.mins ? 'the next bus leaves as you get there' : `${wait} min until it leaves`}</span></div></div>`);
        return;
      }
      const target = l.to !== undefined ? stop(l.to) : null;
      const nextRide = next && next.kind === 'ride' ? next.r : undefined;
      legs.push(html`<div class="leg walk">${icon('walk', 22)}<div class="mid"><span class="name">Walk ${metres(l.d)}${target ? ` to ${nameOf(l.to, nextRide)}` : l.label ? ` to ${l.label}` : ''}</span><span class="sub">About ${l.mins} min</span></div></div>`);
      return;
    }
    const prev = p.legs[k - 1];
    if (prev && prev.kind === 'ride') {
      const wait = l.on - prev.off, at = stop(l.from);
      legs.push(html`<div class="leg change">${icon('swap', 20)}<div class="mid"><span class="name">Change at ${at.hub ? D.hub.name : at.name}</span><span class="sub">Same stop · ${wait <= 0 ? 'the next bus is waiting' : `${wait} min until it leaves`}</span></div></div>`);
    }
    const from = stop(l.from), to = stop(l.to);
    // The first bus, where it is: the proof the plan is real, in the bus card's own words. Later buses mostly
    // haven't started yet, and a loop's stop count means little, so those just say it's coming.
    const where = l === rides[0] && l.t.live ? whereabouts(l) : '';
    legs.push(html`<div class="leg ride">${badge(l.r, 36)}<div class="mid"><span class="name">${headsign(l.t)}</span>
      <span class="sub"><a href="#/stop/${from.id}">${nameOf(l.from, l.r)}</a> · leaves <b>${clockText(l.on)}</b>${l.t.live ? liveMark(liveWord(l.t)) : ''}</span>${where ? html`<span class="sub">${where}</span>` : ''}
      <span class="sub">${l.n} ${l.n === 1 ? 'stop' : 'stops'} · off at <a href="#/stop/${to.id}">${to.hub ? D.hub.name : to.name}</a> · <b>${clockText(l.off)}</b></span></div></div>`);
  });
  // Two times, one weight: when to set off and when you're there. One big arrival read as the first bus's time.
  return html`<div class="plan"><div class="plan-top"><div class="col"><span class="eyebrow">Leave</span>${time(p.leave, 34, live)}<span class="rel">${rel}</span></div><div class="col mid"><span class="sub">${words}</span></div><div class="col end"><span class="eyebrow">Arrive</span>${time(p.arrive, 34, live)}<span class="sub">${p.legs[p.legs.length - 1].kind === 'walk' ? 'after the walk' : 'off the bus'}</span></div></div><div class="legs">${legs}</div></div>`;
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
}
