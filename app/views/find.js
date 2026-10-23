// Search: one list for a street, a stop, a place, an address, a route, the shuttle or a bus by its number (or which of
// its route's it is, B2), the same wherever it's asked
// (the Stops tab's page, the Map tab's box, the header's box on a wide screen). Only where a result leads differs:
// on the map it shows there (forMap), and while one end of a journey is being chosen it's that end (forPick).
import { D, stopNo as stopNoOf, nextAt, search, searchRoutes, nearest, stop, searchPlaces, streetish, townish, sayStreets, opOf, roadOf, familyKey, familyOf, family, isHalf, corridorKey, dayPart, nextRunOf, routeBuses, routeRunsOn } from '../data.js';
import { metres, clockText, now, dayName } from '../time.js';
import { routeName, html, icon, badge, badges, stopRow, esc, headsign, routeList, routeHref, isLoop, named, nthWords } from '../ui.js';
import { parseAddress, geocode, townState, spotKey, spotOf, atPath, byWalk } from '../geo.js';
import { U, searchUSU, stopRowU, chip, live, hasData, nearestUSU, isStale, lastSeen } from '../usu.js';
import { rt, rtStale, rtHasData, rtSeen, offDuty, busNth } from '../rt.js';
import { myPlaces } from '../places.js';

/** One end of a journey being asked for: `to`, a stop or spot being gone to (a result is the start), or `from`, a spot
 *  being set off from (a result is where to); each with its name. Null for a plain search. */
export function pickOf(to, from) {
  const name = k => { const sp = spotOf(k); if (sp) return sp.label || 'the spot you picked'; const si = D.stopById[k]; return si === undefined ? null : stop(si).hub ? D.hub.name : stop(si).name; };
  if (to && name(to) !== null) return { to, name: name(to) };
  if (from && spotOf(from)) return { from, name: name(from) };
  return null;
}
/** Where a result leads while an end is being picked: a stop by its id, or a spot { lat, lon, label }. */
export function endHref(pick, id, sp) {
  if (pick.to) return `#/go/${pick.to}/${sp ? atPath(sp) : id}`;
  return `#/go/${sp ? spotKey(sp.lat, sp.lon, sp.label) : id}/${atPath(spotOf(pick.from))}`;
}
export const endWord = pick => pick.to ? 'Start from here' : 'Go here';
/** `later`: the rows without their next buses, for the keystroke's own frame; fillLater puts them in just after. */
/** The rider's saved places as rows: directions there, or, picking an end of a journey, that end. With a query, those
 *  whose name it starts ('ho', Home), first in the results; without, all of them (a search box before a word). */
export function placeRows(q = '', pick = null) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = myPlaces().filter(p => words.every(w => p.name.toLowerCase().split(/\s+/).some(x => x.startsWith(w))));
  if (!list.length) return '';
  // All of them (no query): Edit, as the home page's saved stops have it; each row then renames (the Save as sheet)
  // or goes (✕). places.js does both in place.
  const mid = p => html`<div class="mid"><span class="name">${p.name}</span>${p.label && p.label !== p.name ? html`<span class="sub">${p.label}</span>` : ''}</div>`;
  return html`<div class="placelist"><div class="section between"><span>${icon('star', 16)}Your places</span>${words.length ? '' : html`<button type="button" class="btn btn-ghost edit" data-place-edit>Edit</button>`}</div>
    <div class="list">${list.map(p => html`<div class="placeitem" data-id="${p.id}"><a class="row placerow" href="${pick ? endHref(pick, null, { lat: p.lat, lon: p.lon, label: p.name }) : '#/go/' + spotKey(p.lat, p.lon, p.name)}">${mid(p)}${icon('fwd', 18)}</a>
      <div class="placeedit"><button type="button" class="row placerow" data-place-rename="${JSON.stringify({ lat: p.lat, lon: p.lon, label: p.label })}" aria-label="Rename ${p.name}">${mid(p)}<span class="note">Rename</span></button><button type="button" class="btn btn-ghost btn-icon" data-place-forget="${p.id}" aria-label="Remove ${p.name}">${icon('close', 20)}</button></div></div>`)}</div></div>`.s;
}
export function results(q, clockNow, pick = null, later = false) {
  return html.raw(placeRows(q, pick) + resultsOf(q, clockNow, pick, later));
}
function resultsOf(q, clockNow, pick, later) {
  const nx = i => later ? null : nextAt(i, 1, clockNow)[0];
  const st = sayStreets(q);   // '10th West': the stops and addresses on 1000 West, Logan
  let hits = search(st.q);
  const addr = parseAddress(st.q);
  const places = addr ? geocode(addr, 4) : [];
  // Choosing where to start from, the whole heading of a place or an address is the start: a small link beside
  // it was missed on a phone, the tap landing on the words.
  const addrHtml = places.map(pl => html`
    ${pick ? html`<a class="section between pick" href="${endHref(pick, null, { lat: pl.lat, lon: pl.lon, label: pl.label + ', ' + pl.town })}"><span>${pl.label} · ${pl.town}${townState(pl.town)}</span><span class="note">${endWord(pick)} ${icon('fwd', 16)}</span></a>`
    : html`<div class="section between"><span>${pl.label} · ${pl.town}${townState(pl.town)}${pl.near ? html.raw(`<span class="note"> · near ${esc(pl.near)}</span>`) : ''}</span><a class="note" href="#/map/at/${pl.lat.toFixed(5)},${pl.lon.toFixed(5)}/${encodeURIComponent(pl.label + ', ' + pl.town)}">Show on map</a></div>`}
    <div class="list">${pl.stops.length ? pl.stops.map(({ i, d }) => stopRow(i, nx(i), clockNow, { dist: metres(d) + ' away', later })) : html`<div class="empty"><p>No stops near there.</p></div>`}</div>`).join('');
  const found = searchPlaces(q), spots = found.list;
  const spotHtml = spots.map(p => placeBlock(p, clockNow, pick, later)).join('')
    + (found.more ? html`<div class="fine">${found.more} more ${found.more === 1 ? 'place matches' : 'places match'}: add a word, a town say, to narrow it.</div>`.s : '');
  const us = searchUSU(q);
  const campusHtml = (us.stops.length || us.routes.length) ? html`
    <div class="notice"><span>${us.stops.length ? us.stops.length + (us.stops.length === 1 ? ' campus stop' : ' campus stops') : ''}${us.stops.length && us.routes.length ? ' · ' : ''}${us.routes.length ? us.routes.length + (us.routes.length === 1 ? ' route' : ' routes') : ''}</span></div>
    ${us.stops.length ? html`<div class="section">${icon('stops', 16)}Campus stops</div><div class="list">${us.stops.map(i => stopRowU(i))}</div>` : ''}
    ${us.routes.length ? html`<div class="section">${icon('route', 16)}Shuttle routes</div><div class="list">${us.routes.map(ri => { const r = U.routes[ri]; const n = live.buses.filter(b => b.ri === ri).length; return html`<a class="row" href="#/usu/route/${r.id}">${chip(ri, 36)}<div class="mid"><span class="name">${r.name}</span><span class="sub">${r.stops.length} stops · ${hasData() ? (n ? n + (n === 1 ? ' bus' : ' buses') + ' on the road' : 'no bus on the road') : 'finding buses…'}</span></div><span class="muted">${icon('fwd', 20)}</span></a>`; })}</div>` : ''}`.s : '';
  // A route named ('12', 'blue'): its page first, above any stop with the number in its address. Not while an end of a
  // journey is being picked: a route is neither.
  // '16': Route 16 once (16 AM and PM, one route, its page the half on the road now or next), and another operator's
  // run on its road after it (the Preston commuter's, a midday 16), as the routes list has them.
  const named0 = pick ? [] : searchRoutes(q), { list, others } = routeList();
  // One half asked for by its name ('16 pm', as Google Maps has it): that half, its page its own.
  const half = ri => isHalf(ri) && family(ri).filter(x => named0.includes(x)).length === 1 ? family(ri).find(x => named0.includes(x)) : null;
  const ris = [...list, ...others].filter(ri => named0.some(x => x === ri || (!opOf(x) && !opOf(ri) && familyKey(x) === familyKey(ri)) || (!!opOf(ri) && corridorKey(x) === corridorKey(ri)))).map(ri => half(ri) ?? ri);
  let bus = pick ? { html: '' } : busRows(q);
  if (!pick && !bus.html) bus = nthRows(q, clockNow);
  if (bus.guess && (hits.length || places.length || campusHtml || spots.length || ris.length)) bus = { html: '' };   // a number guessed a bus's, and found as something else: that alone
  const routeSub = ri => opOf(ri) && roadOf(ri) !== null ? runWords(ri, clockNow, ris.some(x => x !== ri && corridorKey(x) === corridorKey(ri)))
    : [half(ri) === ri && dayPart(ri) ? dayPart(ri).replace(/^./, c => c.toUpperCase()) + ' runs' : '', D.routes[ri].desc.replace(/^.*? - /, '').replace(/,\s*/g, ' · ')].filter(Boolean).join(' · ');
  let routeHtml = ris.length ? html`<div class="list">${ris.map(ri => html`<a class="row" href="${half(ri) === ri ? '#/map/route/' + encodeURIComponent(D.routes[ri].short) : routeHref(ri)}">${badge(ri, 36)}<div class="mid"><span class="name">${routeName(ri, false)}</span><span class="sub">${routeSub(ri)}</span></div><span class="muted">${icon('fwd', 20)}</span></a>`)}</div>`.s : '';
  // A bus asked for by its number: it first, as a route asked for is; buses its first figures start, after the stops.
  if (bus.first) routeHtml = bus.html + routeHtml;
  const busAfter = bus.first ? '' : bus.html;
  if (!hits.length && !places.length && !campusHtml && !spots.length && !routeHtml && !busAfter) {
    return html`<div class="empty"><h2>No stops match “${q}”</h2><p>Stop names are street addresses. Try a street or a town, or any address in the valley, like “1400 N 500 E, Logan”, for the stops nearest it.</p></div>
      <div class="chips">${['Main St', '400 North', 'Hyrum', 'USU', 'Smithfield'].map(s => html`<a class="chip" href="#/search?q=${encodeURIComponent(s)}" data-q="${s}">${s}</a>`)}</div>`;
  }
  // The Transit Center asked for by name ('transit', 'transit center'): its row first, before any place that shares a
  // word with it, and not again among the stops.
  const words = q.toLowerCase().split(/\s+/).filter(Boolean), hubName = (D.hub.name + ' ' + (D.hub.short || '')).toLowerCase();
  if (words.length && words.every(w => hubName.split(/\s+/).some(x => x.startsWith(w))) && hits.some(i => stop(i).hub)) {
    routeHtml = html`<div class="list">${hubRow()}</div>`.s + routeHtml;
    hits = hits.filter(i => !stop(i).hub);
  }
  const towns = [...new Set(hits.map(i => stop(i).town))];
  const where = towns.length === 1 ? ' in ' + towns[0] : '';
  if (!hits.length) return html`${html.raw(routeHtml)}${html.raw(spotHtml)}${html.raw(campusHtml)}${html.raw(addrHtml)}${html.raw(busAfter)}${places.length ? html`<div class="fine">Any grid address in the valley works, with or without the town: the stops nearest it are listed, nearest first. Where the same address exists in more than one town, each is shown.</div>` : ''}`;
  // A street or a number is after stops: they come first, the places on that street after. A name is after a place.
  const street = streetish(st.q) || townish(q);
  const taken = st.said.map(s => `${s.said} is ${s.is}`).join(' · ');
  const stopsHtml = html`<div class="${street && !places.length ? 'notice' : 'section'}"><span>${places.length ? 'Stops named like that' : `${hits.length} ${hits.length === 1 ? 'stop' : 'stops'}${where} · sorted by street number`}${taken ? html`<span class="note"> · ${taken}</span>` : ''}</span></div>
    <div class="list">${hits.map(i => stop(i).hub ? hubRow() : stopRow(i, nx(i), clockNow, { later }))}</div>`.s;
  const blocks = street ? [addrHtml, stopsHtml, campusHtml, spotHtml] : [spotHtml, campusHtml, addrHtml, stopsHtml];
  return html`${html.raw(routeHtml)}${html.raw(blocks.join(''))}${html.raw(busAfter)}
    <div class="fine">Matches street, number and town: “500 north”, “main st, hyrum” and “hyrum main” all work. So does any address in the valley, like “1400 N 500 E, Logan”, for the stops nearest it.</div>`;
}

/** A bus by the number painted on it ('1168', 'bus 1168'), as a rider knows it: a bag left on it, the bus they just
 *  got off. Each of Connect's and the shuttle's buses in the live feeds with that number (`first`, above the rest;
 *  after the stops where it's a stop's number too and no bus was said, Stop 1124), or, three figures typed, starting
 *  with them while three buses or fewer do ('116': 1166, 1167 and 1169; after the stops, Stop 116 being a stop's
 *  number and 400 a street); its route, and where it's headed or that it's off duty, as its card says. A tap is its
 *  card, the map gone to where it is. Four figures said as a bus ('bus 1234'), or like the fleet's own (the first two
 *  of a bus's in the feed now, 11 or 40) and no stop's number (Stop 1116), and no bus with them on the map: said so,
 *  not left blank; guessed a bus's, only where nothing else is found (`guess`: the house at 1185 North Main is). Not
 *  'not in service', the card's word for a bus reporting with no trip: one heading in to the yard isn't on the map at
 *  all. '1168 North' and '1168 N Main' are addresses: more than a number isn't a bus. */
const BUS_Q = /^(?:(bus|#)\s*(?:no\.?|number|#)?\s*)?(\d{3,4})$/i;
function busRows(q) {
  const m = BUS_Q.exec(q.trim());
  if (!m) return { html: '' };
  const n = m[2];
  const cs = rtStale() ? [] : [...rt.buses, ...rt.parked];   // the map's own: a feed gone quiet has none drawn
  const us = U && live.at && Date.now() - live.at < 600e3 ? live.buses : [];   // the shuttle's, grey for ten minutes once its feed goes quiet
  const num = b => b.u ? String(b.name ?? '').replace(/\D/g, '') : String(b.label);
  const all = [...cs, ...us.map(b => ({ ...b, u: true }))];
  let hits = all.filter(b => num(b) === n);
  const exact = hits.length > 0, stopNo = D.stops.some(s => s.code && (s.code === n || stopNoOf(s) === n)), first = exact && (!!m[1] || !stopNo);   // 516 or 0516
  if (!exact && n.length === 3) { const part = all.filter(b => num(b).startsWith(n)); if (part.length <= 3) hits = part; }
  if (!hits.length) {
    const fleet = all.some(b => num(b).length === 4 && num(b).slice(0, 2) === n.slice(0, 2)) && !stopNo;
    if (n.length !== 4 || !(m[1] || fleet)) return { html: '' };
    const say = !rtHasData() ? `Finding buses…` : rtStale() ? `No word from the buses since ${rtSeen()}: bus ${n} can't be found now.` : `Bus ${n} isn't on the map now.`;
    return { html: html`<div class="notice">${icon('info', 16)}<span>${say}</span></div>`.s, first: true, guess: !m[1] };
  }
  hits.sort((a, b) => !!a.u - !!b.u || num(a).localeCompare(num(b)));
  const row = b => {
    let lead, sub;
    if (b.u) {
      lead = chip(b.ri, 36);
      sub = U.routes[b.ri].name + (isStale() ? ' · not reporting, last heard from at ' + lastSeen() : '');
    } else {
      const off = offDuty(b);
      lead = badge(b.ri, 36);
      sub = off === 'Not reporting' ? off + ' · last heard from at ' + clockText(now(new Date(b.quiet * 1000)).min)
        : off ? off + ' · its last run was ' + routeName(b.ri)
        : whither(b);
    }
    return html`<a class="row busfound" href="#/map/bus/${encodeURIComponent(b.id)}?find=1">${lead}<div class="mid"><span class="name">Bus ${b.u ? b.name : b.label}</span><span class="sub">${sub}</span></div><span class="muted">${icon('fwd', 20)}</span></a>`;
  };
  return { html: html`${first ? '' : html`<div class="section">${icon('hub', 16)}${exact ? 'Bus number ' + n : 'Buses numbered ' + n + '…'}</div>`}<div class="list">${hits.map(row)}</div>`.s, first };
}

/** Another operator's run on one of the agency's roads, said as a route found: under its road's route, 'Midday run by
 *  PRT · 12:00 PM from Preston'; found alone ('preston'), whose road it is, 'Route 16's midday run, by PRT · …'. When it
 *  next leaves from where its runs start, or that it's on the road now. */
function runWords(ri, clockNow, under) {
  const op = opOf(ri), part = dayPart(ri), who = op.short || op.name, road = familyOf(roadOf(ri))[0];
  const lead = under ? (part ? part[0].toUpperCase() + part.slice(1) + ' run' : 'A run') + ' by ' + who : `${routeName(road, false)}'s ${part ? part + ' ' : ''}run, by ${who}`;
  const n = nextRunOf(ri, clockNow), s = n && stop(n.si), town = s ? (s.town || '').replace(/,\s*[A-Z][a-z]+$/, '') : '';
  const from = !s ? '' : s.hub ? 'the ' + D.hub.name : town && town !== D.hub.town ? town : s.name;
  const when = !n ? '' : n.now ? 'running now, by its timetable' : clockText(n.min) + (n.day === 0 ? '' : n.day === 1 ? ' tomorrow' : ' ' + dayName(n.ymd)) + ' from ' + from;
  return [lead, when].filter(Boolean).join(' · ');
}

/** A Connect bus on duty: its route and where it's headed, 'Route 7 · Library · LHS · Willow Park', the loops' once
 *  ('Blue Loop'). A trip the timetable doesn't know (a detour's, from the tracker): its route, no more ('Route 07' is
 *  the feed's long name). */
const whither = b => b.h === null ? routeName(b.ri, false)
  : [routeName(b.ri, false), headsign({ h: b.h, r: b.ri, dir: b.dir === null ? undefined : b.dir })].filter((x, i, xs) => xs.indexOf(x) === i).join(' · ');

/** Which of its route's buses today a bus is, as Connect's dispatch writes or says it: 'B2', 'b 2', 'Blue 2', 'Blue
 *  two', 'Blue Loop 2', 'G3', 'B-2', 'Green 3'; a numbered route's in brackets, '12(1)', '12 (1)', '16(2)' (16 AM and PM
 *  one route), a bare '12' being the route; 'bus B2' too, as 'bus 1168' is. { key: its familyKey, ri: a route of it,
 *  n }, or null. */
const SAID = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
function nthAsked(q) {
  const s = q.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^bus /, '');
  const fams = D.routes.map((r, ri) => ri).filter(ri => !D.routes[ri].op);   // another operator's buses aren't in the feed
  let m = /^(?:route |rt )?(\d+) ?\( ?(\d) ?\)$/.exec(s);
  if (m) { const ri = fams.find(ri => familyKey(ri) === m[1]); return ri === undefined ? null : { key: m[1], ri, n: +m[2] }; }
  m = /^(?:the )?(.+?)(?: loop)?(?: bus| no\.?)? ?[-#]? ?(\d|one|two|three|four|five|six|seven|eight|nine)$/.exec(s);
  if (!m) return null;
  // A letter's ('b', the Blue Loop's B), or a loop's or a named route's name without 'Loop' ('blue', 'pumpkin walk').
  const ri = fams.find(ri => { const k = familyKey(ri); return !/^\d+$/.test(k) && (k.toLowerCase() === m[1] || ((isLoop(ri) || named(ri)) && D.routes[ri][isLoop(ri) ? 'long' : 'short'].toLowerCase().replace(/ loop$/, '') === m[1])); });
  return ri === undefined ? null : { key: familyKey(ri), ri, n: SAID[m[2]] || +m[2] };
}
/** The buses asked for by which of their route's they are (nthAsked), as their cards say it, first in the results as a
 *  bus asked for by its number is; none on the map, said so, or how many the route runs today. A tap is its card. */
function nthRows(q, clockNow) {
  const a = nthAsked(q);
  if (!a) return { html: '' };
  const say = t => ({ html: html`<div class="notice">${icon('info', 16)}<span>${t}</span></div>`.s, first: true });
  const of = routeBuses(a.key, clockNow.ymd), who = /^\d+$/.test(a.key) ? 'Route ' + a.key : routeName(a.ri);
  const Who = who.replace(/^./, c => c.toUpperCase()), whose = Who + "'s";
  if (!of) return say(D.routes.some((r, ri) => familyKey(ri) === a.key && routeRunsOn(ri, clockNow.ymd)) ? `${Who} runs one bus today.` : `No ${who.replace(/^the /, '')} buses today.`);
  if (a.n > of || a.n < 1) return say(`${Who} runs ${of} buses today.`);
  const hits = rtStale() ? [] : rt.buses.filter(b => familyKey(b.ri) === a.key && (busNth(b, clockNow) || {}).n === a.n);
  if (!hits.length) return say(!rtHasData() ? 'Finding buses…' : rtStale() ? `No word from the buses since ${rtSeen()}: ${whose} bus ${a.n} of ${of} can't be found now.` : `${whose} bus ${a.n} of ${of} isn't on the map now.`);
  const row = b => html`<a class="row busfound" href="#/map/bus/${encodeURIComponent(b.id)}?find=1">${badge(b.ri, 36)}<div class="mid"><span class="name">${nthWords(b.ri, busNth(b, clockNow))}</span><span class="sub">Bus ${b.label} · ${whither(b)}</span></div><span class="muted">${icon('fwd', 20)}</span></a>`;
  return { html: html`<div class="list">${hits.map(row)}</div>`.s, first: true };
}

/** The Transit Center as one row in a search, for its bays' one address: the Transit Center tab, every route. */
function hubRow() {
  const bay0 = D.hub.bays[0] ? stop(D.hub.bays[0].stop).id : '';
  return html`<a class="stoprow" href="#/hub" data-bay="${bay0}"><div class="mid"><span class="name">${D.hub.name}</span><span class="dist">${D.hub.address} · every route</span>${badges(D.routes.map((_, ri) => ri).filter(ri => D.hub.bays.some(b => b.routes.includes(ri))), 24)}</div><div class="end"><span class="muted">${icon('fwd', 20)}</span></div></a>`;
}

const CATS = { schools: 'School', medical: 'Medical', grocery: 'Grocery', entertainment: 'Entertainment', shopping: 'Shopping', community: 'Community services' };
const POOL = 'https://rideconnectutah.gov/pool/';
/** A place from the pamphlet: its nearest stops with their next buses; the Transit Center when it's a short walk from it;
 *  and Pool, where Connect's on-demand ride serves it. */
function placeBlock(p, clockNow, pick = null, later = false) {
  const near = byWalk(nearest(p.lat, p.lon, 8).filter(x => !stop(x.i).hub), p.lat, p.lon, true);   // walked to and from, the climb counted
  // The shuttle's stops a short walk off too, among Connect's by the same walk (on campus they're the nearer buses),
  // marked as the shuttle's: few of its stops are Connect's too.
  const nearU = !U || pick ? [] : byWalk(nearestUSU(p.lat, p.lon, 6).filter(x => x.d <= 400 && U.stops[x.i].routes.length && !U.shared[x.i]), p.lat, p.lon, true, x => U.stops[x.i]).slice(0, 2).map(x => ({ ...x, u: true }));
  const close = [...near.filter(x => x.d <= 600).slice(0, 3), ...nearU].sort((a, b) => a.cost - b.cost || a.d - b.d);
  const shown = close.length ? close : near.slice(0, 2);   // nothing close: the nearest two anyway, their distance says it
  const hub = p.hub ? html`<a class="stoprow" href="#/hub"><div class="mid"><span class="name">${D.hub.name}</span><span class="dist">A short walk · every route</span>${badges(D.routes.map((_, ri) => ri).filter(ri => D.hub.bays.some(b => b.routes.includes(ri))), 24)}</div><div class="end"><span class="muted">${icon('fwd', 20)}</span></div></a>` : '';
  const pool = p.pickup ? html`<div class="notice">${icon('info', 16)}<span>A <b>POOL</b> pickup point: Connect's on-demand ride, zero fare, booked in their app or by phone. <a href="${POOL}" target="_blank" rel="noopener">How POOL works</a></span></div>`
    : p.pool ? html`<div class="notice">${icon('info', 16)}<span>${close.length ? 'Also served by' : 'Served by'} POOL, Connect's on-demand ride: zero fare, booked in their app. <a href="${POOL}" target="_blank" rel="noopener">How POOL works</a></span></div>` : '';
  const what = [p.osm ? p.word : CATS[p.cat], p.osm ? p.area : ''].filter(Boolean).join(' · ');
  const head = pick ? html`<a class="section between pick" href="${endHref(pick, null, { lat: p.lat, lon: p.lon, label: p.name })}"><span>${p.name}${what ? html`<span class="note"> · ${what}</span>` : ''}</span><span class="note">${endWord(pick)} ${icon('fwd', 16)}</span></a>`
    : html`<div class="section between"><span>${p.name}${what ? html`<span class="note"> · ${what}</span>` : ''}</span><a class="note" href="#/map/at/${p.lat.toFixed(5)},${p.lon.toFixed(5)}/${encodeURIComponent(p.name)}">Show on map</a></div>`;
  return html`${head}
    ${pool}<div class="list">${hub}${shown.map(x => x.u ? stopRowU(x.i, { dist: 'Aggie Shuttle · ' + metres(x.d) + ' away', bare: later }) : stopRow(x.i, later ? null : nextAt(x.i, 1, clockNow)[0], clockNow, { dist: metres(x.d) + ' away', later }))}</div>`.s;
}

/** The results made the start or the end of a journey: each stop, the Transit Center and each place leads to it. */
export function forPick(el, pick) {
  el.querySelectorAll('a.stoprow[href^="#/stop/"]').forEach(a => { a.setAttribute('href', endHref(pick, a.getAttribute('href').slice(7))); });
  el.querySelectorAll('a.stoprow[data-bay]').forEach(a => { if (a.dataset.bay) a.setAttribute('href', endHref(pick, a.dataset.bay)); });
  // A place or an address found: its own spot is that end (the walk between it and the nearest stops is worked out).
  el.querySelectorAll('a.note[href^="#/map/at/"]').forEach(a => { const [ll, label] = a.getAttribute('href').slice(9).split('/'), [lat, lon] = ll.split(',').map(Number); a.setAttribute('href', endHref(pick, null, { lat, lon, label: decodeURIComponent(label || '') })); a.textContent = endWord(pick); });
}
/** The results on the map: a stop or a shuttle stop its page (the map with its sheet), a shuttle loop its own, a place or an address its spot
 *  with the stops nearest it (the whole heading, not just its note). Routes and the Transit Center already go there. */
export function forMap(el) {
  el.querySelectorAll('a[href^="#/usu/route/"]').forEach(a => a.setAttribute('href', '#/map/uroute/' + a.getAttribute('href').slice(12)));
  el.querySelectorAll('.section.between > a.note[href^="#/map/at/"]').forEach(a => {
    const head = a.parentElement, link = document.createElement('a'), note = document.createElement('span');
    link.className = head.className; link.href = a.getAttribute('href');
    note.className = 'note'; note.textContent = 'On the map'; a.replaceWith(note);   // no link inside the link
    link.innerHTML = head.innerHTML; head.replaceWith(link);
  });
}
