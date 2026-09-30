// Search: one list for a street, a stop, a place, an address, a route or the shuttle, the same wherever it's asked
// (the Stops tab's page, the Map tab's box, the header's box on a wide screen). Only where a result leads differs:
// on the map it shows there (forMap), and while one end of a journey is being chosen it's that end (forPick).
import { D, nextAt, search, searchRoutes, nearest, stop, searchPlaces, streetish, townish } from '../data.js';
import { metres } from '../time.js';
import { routeName, html, icon, badge, badges, stopRow, esc } from '../ui.js';
import { parseAddress, geocode, townState, spotKey, spotOf, atPath } from '../geo.js';
import { U, searchUSU, stopRowU, chip, live, hasData } from '../usu.js';
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
  let hits = search(q);
  const addr = parseAddress(q);
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
  const ris = pick ? [] : searchRoutes(q);
  let routeHtml = ris.length ? html`<div class="list">${ris.map(ri => html`<a class="row" href="#/map/route/${encodeURIComponent(D.routes[ri].short)}">${badge(ri, 36)}<div class="mid"><span class="name">${routeName(ri, false)}</span><span class="sub">${D.routes[ri].desc.replace(/^.*? - /, '').replace(/,\s*/g, ' · ')}</span></div><span class="muted">${icon('fwd', 20)}</span></a>`)}</div>`.s : '';
  if (!hits.length && !places.length && !campusHtml && !spots.length && !routeHtml) {
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
  if (!hits.length) return html`${html.raw(routeHtml)}${html.raw(spotHtml)}${html.raw(campusHtml)}${html.raw(addrHtml)}${places.length ? html`<div class="fine">Any grid address in the valley works, with or without the town: the stops nearest it are listed, nearest first. Where the same address exists in more than one town, each is shown.</div>` : ''}`;
  // A street or a number is after stops: they come first, the places on that street after. A name is after a place.
  const street = streetish(q) || townish(q);
  const stopsHtml = html`<div class="${street && !places.length ? 'notice' : 'section'}"><span>${places.length ? 'Stops named like that' : `${hits.length} ${hits.length === 1 ? 'stop' : 'stops'}${where} · sorted by street number`}</span></div>
    <div class="list">${hits.map(i => stop(i).hub ? hubRow() : stopRow(i, nx(i), clockNow, { later }))}</div>`.s;
  const blocks = street ? [addrHtml, stopsHtml, campusHtml, spotHtml] : [spotHtml, campusHtml, addrHtml, stopsHtml];
  return html`${html.raw(routeHtml)}${html.raw(blocks.join(''))}
    <div class="fine">Matches street, number and town: “500 north”, “main st, hyrum” and “hyrum main” all work. So does any address in the valley, like “1400 N 500 E, Logan”, for the stops nearest it.</div>`;
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
  const near = nearest(p.lat, p.lon, 8).filter(x => !stop(x.i).hub);
  const close = near.filter(x => x.d <= 600).slice(0, 3);
  const shown = close.length ? close : near.slice(0, 2);   // nothing close: the nearest two anyway, their distance says it
  const hub = p.hub ? html`<a class="stoprow" href="#/hub"><div class="mid"><span class="name">${D.hub.name}</span><span class="dist">A short walk · every route</span>${badges(D.routes.map((_, ri) => ri).filter(ri => D.hub.bays.some(b => b.routes.includes(ri))), 24)}</div><div class="end"><span class="muted">${icon('fwd', 20)}</span></div></a>` : '';
  const pool = p.pickup ? html`<div class="notice">${icon('info', 16)}<span>A <b>POOL</b> pickup point: Connect's on-demand ride, zero fare, booked in their app or by phone. <a href="${POOL}" target="_blank" rel="noopener">How POOL works</a></span></div>`
    : p.pool ? html`<div class="notice">${icon('info', 16)}<span>${close.length ? 'Also served by' : 'Served by'} POOL, Connect's on-demand ride: zero fare, booked in their app. <a href="${POOL}" target="_blank" rel="noopener">How POOL works</a></span></div>` : '';
  const what = [p.osm ? p.word : CATS[p.cat], p.osm ? p.area : ''].filter(Boolean).join(' · ');
  const head = pick ? html`<a class="section between pick" href="${endHref(pick, null, { lat: p.lat, lon: p.lon, label: p.name })}"><span>${p.name}${what ? html`<span class="note"> · ${what}</span>` : ''}</span><span class="note">${endWord(pick)} ${icon('fwd', 16)}</span></a>`
    : html`<div class="section between"><span>${p.name}${what ? html`<span class="note"> · ${what}</span>` : ''}</span><a class="note" href="#/map/at/${p.lat.toFixed(5)},${p.lon.toFixed(5)}/${encodeURIComponent(p.name)}">Show on map</a></div>`;
  return html`${head}
    ${pool}<div class="list">${hub}${shown.map(({ i, d }) => stopRow(i, later ? null : nextAt(i, 1, clockNow)[0], clockNow, { dist: metres(d) + ' away', later }))}</div>`.s;
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
