// The Pumpkin Walk: North Logan's October evenings of carved pumpkins, and Connect's seasonal shuttle to them, round
// from Greenville to the park every few minutes while it runs. A page of its own and a tab while the season lasts
// (main.js), every word of it from the timetable: the route (its short name 'Pumpkin Walk'), its two stops, its nights
// and their hours, so next October's, or a night added or dropped, needs nothing here. The art is drawn in
// pumpkin-art.js, no image to fetch. A first cut, for Claude Design to take on.
import { D, nextAt, timesOn, distance } from '../data.js';
import { now, dayFrom, dayName, fmtDay, clockText, clockShort, minsTo } from '../time.js';
import { html, raw, icon, badge, depRow, liveMark, liveWord, sched, lively, when, time, corners } from '../ui.js';
import { rt, rtStale } from '../rt.js';
import { ART, DECO, PERCH } from './pumpkin-art.js';

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

const art = raw(ART), perch = raw(PERCH);   // the dusk banner, and the vine along a phone's card (pumpkin-art.js)
/** The frame put into the map once (it shows while the view is up: #body.pk-on, main.js). */
function frameMap() {
  const m = document.getElementById('map');
  if (m && !document.getElementById('pk-deco')) m.insertAdjacentHTML('beforeend', DECO);
}

/** The page. */
export function render(_, clockNow) {
  const back = html`<div class="backbar pk-back"><a class="btn btn-ghost" href="#/" onclick="if(history.state&&history.state.prev){history.back();return false}">${icon('back', 22)}Stops</a></div>`;
  const ri = pumpkinRoute();
  if (ri < 0 || !stopsOf(ri).length) {
    return { html: html`${back}<div class="head pk-head"><div class="pk-hero blueprint"><div class="pk-clip">${art}</div>${corners()}</div><span class="eyebrow">Seasonal · North Logan</span><h1>Pumpkin Walk</h1></div>
      <div class="empty"><p>The Pumpkin Walk shuttle isn't in ${D.agency.brand}'s timetable right now. It comes back each October.</p></div>`, title: 'Pumpkin Walk' };
  }
  const r = D.routes[ri], stops = stopsOf(ri), ns = nights(ri, clockNow);
  // The stop the rider's nearest, with a fix; else the loop's first, where it starts from (Greenville).
  const g = window.__app && window.__app.geo;
  const home = g ? stops.reduce((a, b) => distance(g.lat, g.lon, D.stops[a].lat, D.stops[a].lon) <= distance(g.lat, g.lon, D.stops[b].lat, D.stops[b].lon) ? a : b) : stops[0];
  const other = stops.find(si => si !== home);
  const mine = t => t.r === ri;

  // How often it runs: the commonest gap between tonight's (or its next night's) departures from the first stop.
  const night = ns.find(n => n.n), every = night ? cadenceOf(ri, stops[0], night.ymd) : null;
  const lastNight = ns.length ? ns[ns.length - 1] : null;
  const sub = [every ? `Every ${every} min` : '', night ? `${clockShort(night.first)}–${clockShort(night.last)}` : '', lastNight ? `through ${fmtDay(lastNight.ymd)}` : ''].filter(Boolean).join(' · ');

  // The next shuttle from the rider's stop: tonight's, or the next night's, said with its day.
  const next = nextAt(home, 4, clockNow, LOOK, mine).map(lively);
  const first = next[0];
  // `.next` is where a phone's card rests (map.js openingHeight): the head, and this, the map of the walk above.
  let now$ = html`<div class="next pk-next"><p class="muted">No more shuttles in the timetable this season.</p></div>`;
  if (first) {
    const left = first.day === 0 ? minsTo(first, clockNow) : null;
    // Inside the half hour, the minutes large; further off, the clock time, with how long or which evening.
    const soon = left !== null && left <= 30;
    const big = soon
      ? html`<span class="pk-big${first.live ? ' est' : ''}">${left <= 0 ? 'NOW' : left}${left > 0 ? html`<small>MIN</small>` : ''}</span>`
      : html`<span class="pk-big pk-clock${first.live ? ' est' : ''}">${time(first.min, 34, !!first.live)}</span>`;
    // How long till tonight's first, in hours and minutes: 'later today' says nothing at two in the afternoon.
    const until = left === null ? '' : left < 60 ? `in ${left} min` : `in ${Math.floor(left / 60)} h${left % 60 ? ' ' + (left % 60) + ' min' : ''}`;
    const day = first.day === 0 ? (soon ? clockText(first.min) : 'Tonight · ' + until) : first.day === 1 ? 'Tomorrow evening' : dayName(first.ymd) + ' evening';
    const then = next.slice(1, 4).filter(t => t.day === first.day);
    now$ = html`<div class="next pk-next">
      <div class="top"><span class="eyebrow">${soon ? 'Next shuttle' : 'First shuttle'} from ${placeOf(home)}${g ? ' · nearest you' : ''}</span>${first.live ? liveMark(liveWord(first)) : sched(first)}</div>
      <a class="pk-nextrow" href="#/stop/${D.stops[home].id}">${big}<span class="mid"><span class="dest">To ${placeOf(other)}</span><span class="sub">${day}</span></span></a>
      ${then.length ? html`<div class="then"><span class="eyebrow muted">Then</span>${then.map(t => html`<span class="t t-22">${when(t, 22)}</span>`)}</div>` : ''}
    </div>`;
  }

  // Both stops' next few, tonight's, as rows.
  const fromStop = si => {
    const rows = nextAt(si, 3, clockNow, 1, mine);
    const dest = 'To ' + placeOf(stops.find(x => x !== si));
    return html`<div class="section between pk-from"><span class="pk-from-name">${icon('pin', 16)}From ${placeOf(si)}</span><a class="note" href="#/stop/${D.stops[si].id}">Stop ${D.stops[si].code || D.stops[si].id}</a></div>
      <div class="list">${rows.length ? rows.map(t => depRow(t, clockNow, { name: dest })) : html`<div class="row"><div class="mid"><span class="sub">No more tonight</span></div></div>`}</div>`;
  };

  // The shuttles on the road now, by the feed.
  const out = rtStale() ? null : rt.buses.filter(b => b.ri === ri).length;
  const live = out === null ? '' : html`<div class="notice pk-live">${icon('route', 16)}<span><b>${out ? out + (out === 1 ? ' shuttle' : ' shuttles') + ' on the road' : 'No shuttle on the road just now'}</b>${out ? ' · on the map' : ''}</span></div>`;

  // Its nights, each with its hours: tonight lit, a night without a shuttle said so.
  const strip = html`<div class="pk-nights">${ns.map((n, k) => html`<div class="pk-night${k === 0 ? ' tonight' : ''}${n.n ? '' : ' off'}"><span class="d">${k === 0 ? 'Tonight' : dayName(n.ymd, true)}</span><span class="dt">${fmtDay(n.ymd).replace(/^\w+,?\s*/, '')}</span><span class="h">${n.n ? clockShort(n.first) + '–' + clockShort(n.last) : 'No shuttle'}</span></div>`)}</div>`;

  return {
    html: html`${perch}${back}<div class="head pk-head"><div class="pk-hero blueprint"><div class="pk-clip">${art}</div>${corners()}</div>
        <span class="eyebrow">Seasonal · North Logan</span><h1>Pumpkin Walk</h1><div class="muted pk-sub">${D.agency.brand}'s shuttle${sub ? ' · ' + sub : ''}</div></div>
      ${now$}
      ${live}
      ${fromStop(home)}${other !== undefined ? fromStop(other) : ''}
      <div class="section">${icon('calendar', 16)}The shuttle's nights</div>${strip}
      <div class="pk-actions"><a class="btn btn-primary" href="#/go/${D.stops[home].id}">${icon('walk', 18)}How to get to ${placeOf(home)}</a></div>
      <div class="fine">The shuttle's times are ${D.agency.brand}'s published timetable for the Pumpkin Walk, refreshed nightly, and live where the feed has the bus. The Pumpkin Walk itself is North Logan's; its own hours and news are the city's to give.</div>`,
    title: 'Pumpkin Walk', live: true, keepScroll: true,
    // the rider's fix, for the nearest stop, as the home page reads it; and the map's frame of vines, put in once
    mount: (el, app) => { if (app) window.__app = app; frameMap(); },
  };
}

/** The commonest gap, in minutes, between a night's departures from a stop. */
function cadenceOf(ri, si, ymd) {
  const mins = timesOn(si, ymd).filter(t => t.r === ri && !t.prov).map(t => t.min).sort((a, b) => a - b), count = {};
  for (let i = 1; i < mins.length; i++) { const g = mins[i] - mins[i - 1]; if (g > 0) count[g] = (count[g] || 0) + 1; }
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return best ? +best[0] : null;
}
