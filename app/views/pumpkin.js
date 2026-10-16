// The Pumpkin Walk: North Logan's October evenings of carved pumpkins, and Connect's seasonal shuttle to them, round
// from Greenville to the park every few minutes while it runs. A page of its own and a tab while the season lasts
// (main.js), every word of it from the timetable: the route (its short name 'Pumpkin Walk'), its two stops, its nights
// and their hours, so next October's, or a night added or dropped, needs nothing here. The art is drawn in
// pumpkin-art.js, no image to fetch. Its look is Claude Design's, the walk at night (the project's
// templates/pumpkin-walk-explore).
import { D, nextAt, timesOn, distance, tripEnd } from '../data.js';
import { now, dayFrom, dayName, fmtDay, clock, clockText, clockShort, minsTo } from '../time.js';
import { html, icon, liveMark, liveWord, sched, lively } from '../ui.js';
import { rt, rtStale } from '../rt.js';
import { DECO } from './pumpkin-art.js';

/** The Pumpkin Walk's route, or -1 when the timetable hasn't one. */
export const pumpkinRoute = () => D ? D.routes.findIndex(r => /^pumpkin/i.test(r.short)) : -1;
const stopsOf = ri => [...new Set(Object.values(D.routes[ri].stops || {}).flat())];
/** Directions to one of its stops (#/go/<stop>, its 'How to get to'): the season's tab's as much as the page is. */
export function directionsTo(h) {
  const m = /^#\/go\/([^/?]+)/.exec(h), ri = m ? pumpkinRoute() : -1;
  return ri >= 0 && stopsOf(ri).some(si => D.stops[si].id === decodeURIComponent(m[1]));
}
/** 'Greenville', 'Park': a stop's name without the route's own, which every one of its stops carries. */
const placeOf = si => D.stops[si].name.replace(/^pumpkin walk\s*[-–·:]\s*/i, '').trim() || D.stops[si].name;

// Its nights from today, three weeks out at most: [{ ymd, n, first, last }], n 0 on a night between two with a
// shuttle (a Sunday), none after its last. Worked out once a day: the tab asks on every redraw.
const LOOK = 21;
let nightsFor = '', nightsList = [];
function nights(ri, clockNow) {
  const key = clockNow.ymd + '|' + D.feed.built + '|' + ri;
  if (key === nightsFor) return nightsList;
  const si = stopsOf(ri)[0], out = [];
  for (let k = 0; k < LOOK; k++) {
    const ymd = dayFrom(clockNow.ymd, k).ymd;
    // The timetable's own rows: a day before the feed's first calendar is filled from the next (timesOn's 'prov'), not run
    const mins = timesOn(si, ymd).filter(t => t.r === ri && !t.prov).map(t => t.min);
    out.push({ ymd, n: mins.length, first: mins.length ? Math.min(...mins) : null, last: mins.length ? Math.max(...mins) : null });
  }
  while (out.length && !out[out.length - 1].n) out.pop();
  nightsFor = key; nightsList = out;
  return out;
}

/** Whether the season is on: a night with a shuttle still to come, tonight's till a quarter hour after its last. The
 *  tab is there while it is, and goes by itself after the last night. */
export function pumpkinOn(clockNow = now()) {
  const ri = pumpkinRoute();
  if (ri < 0 || !stopsOf(ri).length) return false;
  const ns = nights(ri, clockNow);
  return ns.some((n, k) => n.n && (k > 0 || clockNow.min <= n.last + 15));
}

/** The frame put into the map once (it shows while the view is up: #body.pk-on, main.js). */
function frameMap() {
  const m = document.getElementById('map');
  if (m && !document.getElementById('pk-deco')) m.insertAdjacentHTML('beforeend', DECO);
}

// ---- the page: the walk at night (Claude Design's 'Pumpkin Walk, reimagined: the line'). On a phone the map of the
// walk in its vines, and the card resting at both stops' next shuttles side by side; raised, the line: the two stops
// at its ends, each with its next shuttle large and the ones after, and the shuttles on the road along it, which way
// each is headed and when it's there; then the night (how much of it is left, the last shuttle back) and the nights
// after. Its own colours in either theme, the night's (css: .pk-page).

/** 'the Park', not 'Park': the stop's place as said in a sentence, a common noun with its article. */
const said = name => /^(park|school|library|church|center|centre|square|hall)$/i.test(name) ? 'the ' + name : name;
/** The minute now to the second, for a shuttle's place on the line between redraws. */
const nowExact = clockNow => clockNow.min + (clockNow.sec || 0) / 60;
/** 'in 3 h 55 min', 'in 40 min'. */
const inHM = m => m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;
/** '1 h 19 min', '58 min'. */
const hm = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;

/** A stop's next shuttle and the ones after it: { first, left (minutes, tonight's), soon, big (markup), sub, then
 *  (clock times), live }, or null when the season has no more from it. */
function stopNext(si, to, ri, clockNow) {
  const list = nextAt(si, 4, clockNow, LOOK, t => t.r === ri).map(lively);
  const first = list[0];
  if (!first) return null;
  const left = first.day === 0 ? minsTo(first, clockNow) : null;
  // Inside the half hour the minutes, large; further off the clock time, with how long or which evening.
  const soon = left !== null && left <= 30, live = !!first.live;
  const c = clock(first.min);
  const big = soon ? html`${left <= 0 ? 'NOW' : left}${left > 0 ? html`<small>MIN</small>` : ''}` : html`${c.h}<small>${c.ap}</small>`;
  const when = first.day === 0 ? (soon ? clockText(first.min) : 'tonight, ' + inHM(left)) : first.day === 1 ? 'tomorrow evening' : dayName(first.ymd) + ' evening';
  const then = list.slice(1, 4).filter(t => t.day === first.day).map(t => clock(t.min).h);
  return { first, left, soon, big, sub: `to ${said(to)} · ${when}`, then, live };
}

/** The shuttles on the road, along the line: 0 at its top stop (the loop's first, where it starts from), 1 at its foot
 *  (the other), heading down to it, back up, or waiting at one; `there`, when it gets where it's headed. From each
 *  bus's trip, the timetable's minutes at the two stops and its end, moved by the feed's word on it, not from its dot:
 *  the loop goes out along one street and back by three others, and its minutes are what's read. Null when the feed
 *  is quiet. */
let tripAt = null;
function onTheLine(ri, A, B, clockNow) {
  if (rtStale()) return null;
  if (!tripAt || tripAt.built !== D.feed.built) tripAt = { built: D.feed.built, idx: new Map(D.trips.map((id, i) => [id, i])) };
  const t = nowExact(clockNow), out = [];
  const atA = new Map(timesOn(A, clockNow.ymd).filter(x => x.r === ri).map(x => [x.trip, x]));
  const atB = new Map(timesOn(B, clockNow.ymd).filter(x => x.r === ri).map(x => [x.trip, x]));
  for (const b of rt.buses) {
    if (b.ri !== ri || !b.trip) continue;
    const ti = tripAt.idx.get(b.trip), a = atA.get(ti), z = atB.get(ti);
    if (ti === undefined || !a || !z) continue;
    const zl = lively(z), delay = zl.live ? zl.min - z.min : 0;   // the feed's word at the foot, carried to the trip
    const tA = a.min + delay, tB = zl.min, end = tripEnd(ti), tEnd = (end ? end.min : z.min + (z.min - a.min)) + delay;
    let p, kind, there = null;
    if (t < tA) { p = 0; kind = 'wait'; there = tA; }   // at the top, its trip yet to leave
    else if (t < tB) { p = (t - tA) / Math.max(1, tB - tA); kind = 'down'; there = tB; }
    else if (t < tB + 0.5) { p = 1; kind = 'wait'; }
    else if (t < tEnd) { p = 1 - (t - tB) / Math.max(1, tEnd - tB); kind = 'up'; there = tEnd; }
    else { p = 0; kind = 'wait'; }   // back at the top, in
    out.push({ p: Math.min(1, Math.max(0, p)), kind, there });
  }
  return out;
}

// What North Logan says of the year's walk, which no timetable has (pumpkinwalk.org, its 'Getting Here', read
// 2026-10-15), kept by its year: next October's gets none until it's read again, rather than this one's, wrong.
const CITY = {
  2026: { open: '10 AM to 10 PM', park: 'Greenville Elementary or Cache Valley Hospital, both on 400 East', closed: '2500 North closes from 800 to 1200 East at 5 PM, one way east after' },
};
const CITY_SITE = 'https://www.pumpkinwalk.org/';

/** The page. */
export function render(_, clockNow) {
  const back = html`<div class="backbar pk-back"><a class="btn btn-ghost" href="#/" onclick="if(history.state&&history.state.prev){history.back();return false}">${icon('back', 22)}Stops</a></div>`;
  const ri = pumpkinRoute();
  if (ri < 0 || !stopsOf(ri).length) {
    return { html: html`<div class="pk-page">${back}<div class="pk-headx"><div class="pk-eyes"><span class="pk-season">Seasonal · North Logan</span></div><h1 class="pk-title">Pumpkin Walk</h1></div>
      <div class="empty"><p>The Pumpkin Walk shuttle isn't in ${D.agency.brand}'s timetable right now. It comes back each October.</p></div></div>`, title: 'Pumpkin Walk' };
  }
  const stops = stopsOf(ri), ns = nights(ri, clockNow);
  // The line: the loop's first stop at its top (Greenville, where it starts from), the other at its foot.
  const A = stops[0], B = stops.find(si => si !== A);
  // The stop the rider's nearest, with a fix; else the top one.
  const g = window.__app && window.__app.geo;
  const home = g && B !== undefined ? (distance(g.lat, g.lon, D.stops[A].lat, D.stops[A].lon) <= distance(g.lat, g.lon, D.stops[B].lat, D.stops[B].lon) ? A : B) : A;
  const other = home === A ? B : A;

  // How often, and its hours: tonight's, or its next night's.
  const night = ns.find(n => n.n), every = night ? cadenceOf(ri, A, night.ymd) : null;
  const k0 = night ? ns.indexOf(night) : -1;
  const hours = n => `${clockShort(n.first)}–${clockShort(n.last)}`;
  // (the shuttle's hours: the walk itself is open all day, CITY)
  const whenRight = night ? `Shuttle ${k0 === 0 ? 'tonight' : k0 === 1 ? 'tomorrow' : dayName(night.ymd, true)} ${hours(night)}` : '';
  const sub = `${D.agency.brand}'s free shuttle${every ? `, every ${every} min` : ''}${B !== undefined ? ', both ways' : ''}`;   // Connect is fare-free

  const nx = { [A]: stopNext(A, placeOf(B ?? A), ri, clockNow), [B]: B !== undefined ? stopNext(B, placeOf(A), ri, clockNow) : null };
  const mark = n => n ? (n.live ? liveMark(liveWord(n.first)) : sched(n.first)) : '';

  // On a phone, where the card rests (map.js openingHeight: `.next`, and `.head` its head): both stops' next, side by
  // side, the rider's first. A tap raises the card to the line.
  const col = si => { const n = nx[si]; return html`<div class="pk-fcol${si === home ? ' home' : ''}"><span class="pk-fk">${placeOf(si)}${si === home && g ? ' · nearest' : ''}</span>
      <span class="pk-fn${n && n.live ? ' est' : ''}">${n ? n.big : '–'}</span><span class="pk-fsub">${n ? n.sub : 'None this season'}</span></div>`; };
  const fold = html`<div class="next head pk-fold" role="button" tabindex="0" aria-label="The walk's next shuttles: raise for the line">${col(home)}${other !== undefined ? col(other) : ''}</div>`;

  // The line: each stop with its next shuttle large; the shuttles on the road between.
  const stopAt = (si, top) => { const n = nx[si], s = D.stops[si]; return html`<div class="pk-lstop ${top ? 'top' : 'foot'}"><i class="pk-ring"></i>
      <div class="pk-lrow"><div class="pk-lname"><span class="pk-lk${si === home && g ? ' near' : ''}">${si === home && g ? 'Nearest you · ' : top ? '' : "The walk's far end · "}Stop ${s.code || s.id}</span>
        <a class="pk-lplace" href="#/stop/${s.id}">${placeOf(si)}</a><span class="pk-lsub">${n ? n.sub : 'No more this season'}</span></div>
        <span class="pk-ln${n && n.live ? ' est' : ''}">${n ? n.big : ''}</span></div>
      <div class="pk-lthen">${n && n.then.length ? html`<span class="w">then</span>${n.then.map(x => html`<span>${x}</span>`)}` : ''}${mark(n)}</div></div>`; };
  const buses = B !== undefined ? onTheLine(ri, A, B, clockNow) : null;
  const busAt = b => html`<div class="pk-bus ${b.kind}" style="top:${Math.round(b.p * 200)}px"><i></i>${b.kind !== 'wait' && b.p > 0.3 && b.p < 0.82 && b.there !== null
    ? html`<span class="pk-blab"><b>To ${said(placeOf(b.kind === 'down' ? B : A))}</b>there ${clock(Math.round(b.there)).h}</span>` : ''}</div>`;
  const line = B !== undefined ? html`<div class="pk-line"><i class="pk-rail"></i>${stopAt(A, true)}${stopAt(B, false)}${(buses || []).map(busAt)}</div>
      ${buses && !buses.length && night && k0 === 0 && clockNow.min >= night.first - 10 && clockNow.min <= night.last + 15 ? html`<p class="pk-quiet">No shuttle in the feed just now: the times are the timetable's.</p>` : ''}` : '';

  // The night: how much of it is left, now on it, and the last shuttle back from the far end.
  let tonight = '';
  if (night && k0 === 0) {
    const firstAll = Math.min(...stops.map(si => Math.min(...timesOn(si, clockNow.ymd).filter(t => t.r === ri && !t.prov).map(t => t.min)))),
      lastAll = Math.max(...stops.map(si => Math.max(...timesOn(si, clockNow.ymd).filter(t => t.r === ri && !t.prov).map(t => t.min))));
    const backs = other !== undefined ? timesOn(other, clockNow.ymd).filter(t => t.r === ri && !t.prov).map(t => t.min) : [];
    const lastBack = backs.length ? Math.max(...backs) : null, span = Math.max(1, lastAll - firstAll);
    const at = m => Math.min(100, Math.max(0, (m - firstAll) / span * 100)).toFixed(1);
    const on = clockNow.min >= firstAll && clockNow.min <= lastAll;
    if (clockNow.min <= lastAll) tonight = html`<div class="pk-tonight">
      <div class="pk-tn"><span class="k">Tonight</span><span class="v">${on ? hm(lastAll - clockNow.min) + ' left' : 'starts ' + inHM(firstAll - clockNow.min)}</span></div>
      <div class="pk-bar"><i style="width:${on ? at(clockNow.min) : 0}%"></i>${on ? html`<b class="now" style="left:${at(clockNow.min)}%"></b>` : ''}${lastBack !== null ? html`<b class="last" style="left:${at(lastBack)}%"></b>` : ''}</div>
      <div class="pk-ends"><span>${clockShort(firstAll)}</span>${on ? html`<span class="now">Now ${clock(clockNow.min).h}</span>` : ''}<span>${clockShort(lastAll)}</span></div>
      ${lastBack !== null ? html`<p class="pk-last">Last shuttle back leaves ${said(placeOf(other))} at <b>${clockText(lastBack)}</b></p>` : ''}</div>`;
  }

  // Its nights, each with its hours: tonight lit, a night without a shuttle said so.
  const strip = html`<div class="pk-nights">${ns.slice(0, 3).map((n, k) => html`<div class="pk-night${k === 0 ? ' tonight' : ''}${n.n ? '' : ' off'}"><span class="d">${k === 0 ? 'Tonight' : dayName(n.ymd, true)}</span><span class="dt">${fmtDay(n.ymd).replace(/^\w+,?\s*/, '')}</span><span class="h">${n.n ? hours(n) : 'No shuttle'}</span></div>`)}</div>`;
  const lastNight = ns.length ? ns[ns.length - 1] : null;
  // The city's word on the walk and getting there, for this year's season only.
  const city = night ? CITY[night.ymd.slice(0, 4)] : null;
  const cityNote = city ? html`<div class="pk-city"><p>The walk is open <b>${city.open}</b>, free, at the park. For the shuttle, park at ${city.park}. ${city.closed}.</p><p><a href="${CITY_SITE}" target="_blank" rel="noopener">North Logan's Pumpkin Walk site</a> has the rest: parking, closures, access.</p></div>` : '';

  return {
    html: html`<div class="pk-page">${back}${fold}
      <div class="pk-headx"><div class="pk-eyes"><span class="pk-season">Seasonal · North Logan</span>${whenRight ? html`<span class="pk-when">${whenRight}</span>` : ''}</div>
        <h1 class="pk-title">Pumpkin Walk</h1><div class="pk-sub">${sub}</div></div>
      ${line}
      <a class="pk-maplink" href="#/pumpkin" data-pk-map>${icon('map', 18)}See the route on the map</a>
      ${tonight}
      ${strip}${lastNight && ns.length > 3 ? html`<p class="pk-through">Its last night this season: ${fmtDay(lastNight.ymd)}.</p>` : ''}
      ${cityNote}
      <div class="pk-actions"><a class="btn btn-secondary" href="#/go/${D.stops[home].id}">${icon('walk', 18)}How to get to ${placeOf(home)}</a></div>
      <div class="fine">The shuttle's times are ${D.agency.brand}'s published timetable for the Pumpkin Walk, refreshed nightly, and live where the feed has the bus. The Pumpkin Walk itself is North Logan's; its own hours and news are <a href="${CITY_SITE}" target="_blank" rel="noopener">the city's</a> to give.</div></div>`,
    title: 'Pumpkin Walk', live: true, keepScroll: true,
    // the rider's fix, for the nearest stop, as the home page reads it; the map's frame of vines, put in once; and on a
    // phone, the card's resting countdowns raise it to the line, and 'See the route on the map' lowers it again
    mount: (el, app) => { if (app) window.__app = app; frameMap(); wire(el); },
    // On a phone it opens raised (map.js pageSheet), the walk, its stops and their times first, the map a swipe down:
    // the user's choice, 2026-10-15, at its resting height the map most of the screen and the page a strip of two times
    raise: '.pk-headx',
  };
}

/** A phone's card: raised to the line from where it rests (a tap on the countdowns), lowered to the map again. The
 *  card is a board (map.js), one scroll over the map: raised is its head at the top, lowered its scroll's start. */
function wire(el) {
  if (!el || el._pk) return;
  el._pk = true;
  const card = () => el.closest('#mapcard') || (el.id === 'mapcard' ? el : null);
  const raise = () => {
    const c = card(), h = c && c.querySelector('.pk-headx');
    if (!c || !h) return;
    c.scrollTo({ top: c.scrollTop + h.getBoundingClientRect().top - c.getBoundingClientRect().top, behavior: 'smooth' });   // (the card's own top is under the search bar)
  };
  el.addEventListener('click', e => {
    if (e.target.closest('.pk-fold')) { raise(); return; }
    if (e.target.closest('[data-pk-map]')) { const c = card(); if (c) { e.preventDefault(); c.scrollTo({ top: 0, behavior: 'smooth' }); } }
  });
  el.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.pk-fold')) { e.preventDefault(); raise(); } });
}

/** The commonest gap, in minutes, between a night's departures from a stop. */
function cadenceOf(ri, si, ymd) {
  const mins = timesOn(si, ymd).filter(t => t.r === ri && !t.prov).map(t => t.min).sort((a, b) => a - b), count = {};
  for (let i = 1; i < mins.length; i++) { const g = mins[i] - mins[i - 1]; if (g > 0) count[g] = (count[g] || 0) + 1; }
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return best ? +best[0] : null;
}
