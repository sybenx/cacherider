// The Pumpkin Walk: North Logan's October evenings of carved pumpkins, and Connect's seasonal shuttle to them, round
// from Greenville to the park every few minutes while it runs. A page of its own and a tab while the season lasts
// (main.js), every word of it from the timetable: the route (its short name 'Pumpkin Walk'), its two stops, its nights
// and their hours, so next October's, or a night added or dropped, needs nothing here. The art is drawn below, no
// image to fetch. A first cut, for Claude Design to take on.
import { D, nextAt, timesOn, distance } from '../data.js';
import { now, dayFrom, dayName, fmtDay, clockText, clockShort, minsTo } from '../time.js';
import { html, raw, icon, badge, depRow, liveMark, liveWord, sched, lively, when, time, corners } from '../ui.js';
import { rt, rtStale } from '../rt.js';

/** The Pumpkin Walk's route, or -1 when the timetable hasn't one. */
export const pumpkinRoute = () => D ? D.routes.findIndex(r => /^pumpkin/i.test(r.short)) : -1;
const stopsOf = ri => [...new Set(Object.values(D.routes[ri].stops || {}).flat())];
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

// ---- the art: dusk over the hills, a path, and pumpkins lit along it. Its colours are its own, the night's, in either
// theme: an evening is dark whatever the phone is set to.
function pumpkin(x, y, s, face) {
  const eyes = face === 1
    ? 'M-9 -19l3.5-6 3.5 6zM2 -19l3.5-6 3.5 6z'
    : face === 2 ? 'M-9 -21h6v5h-6zM3 -21h6v5h-6z' : 'M-8 -18l2.5-7 2.5 7zM3 -18l2.5-7 2.5 7z';
  const mouth = face === 2
    ? 'M-9 -11q9 7 18 0q-9 3-18 0z'
    : 'M-10 -12q10 8 20 0l-3 1-1.5 3-2-2.5-1.5 3-2-3-1.5 3-2-2.5-1.5 3-2-3z';
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <ellipse cx="0" cy="-12" rx="30" ry="22" fill="url(#pkHalo)"/>
    <ellipse cx="-11" cy="-13" rx="12" ry="13" fill="#c94a16"/><ellipse cx="11" cy="-13" rx="12" ry="13" fill="#c94a16"/>
    <ellipse cx="-5" cy="-13" rx="10" ry="14" fill="#e8611c"/><ellipse cx="5" cy="-13" rx="10" ry="14" fill="#e8611c"/>
    <ellipse cx="0" cy="-13" rx="7" ry="14.5" fill="#f57a24"/>
    <path d="M0-26c0-4 1.5-7 4.5-8.5" stroke="#4f6b2a" stroke-width="3.2" fill="none" stroke-linecap="round"/>
    <path d="${eyes}" fill="#ffd66b"/><path d="${mouth}" fill="#ffd66b"/>
  </g>`;
}
const STARS = [[24, 18], [61, 34], [96, 12], [140, 28], [182, 10], [231, 24], [258, 8], [297, 30], [338, 14], [372, 26], [120, 46], [210, 44]];
const art = raw(`<svg class="pk-art" viewBox="0 0 400 170" preserveAspectRatio="xMidYMax slice" role="img" aria-label="Pumpkins glowing along a path over the hills at dusk">
  <defs>
    <linearGradient id="pkSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1238"/><stop offset=".55" stop-color="#4a2a5e"/><stop offset=".85" stop-color="#b5532f"/><stop offset="1" stop-color="#e48a3a"/></linearGradient>
    <radialGradient id="pkHalo"><stop offset="0" stop-color="#ffb347" stop-opacity=".55"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
    <mask id="pkMoon"><rect width="400" height="170" fill="#fff"/><circle cx="331" cy="34" r="15" fill="#000"/></mask>
  </defs>
  <rect width="400" height="170" fill="url(#pkSky)"/>
  ${STARS.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 0.9 : 1.4}" fill="#fff6dc" opacity="${i % 2 ? 0.7 : 0.95}"/>`).join('')}
  <circle cx="340" cy="38" r="15" fill="#fff2c4" mask="url(#pkMoon)"/>
  <path d="M0 112C40 96 74 92 112 100s70 2 104-10 78-14 112-4 54 10 72 6V170H0z" fill="#2b1c47"/>
  <path d="M0 132c30-12 66-16 102-8s64 6 98-6 72-14 112-2 64 12 88 4V170H0z" fill="#1d1333"/>
  <g stroke="#140c24" stroke-width="2" stroke-linecap="round" fill="none">
    <path d="M38 126V96m0 12-9-9m9 3 8-10m-8 18 6-5"/><path d="M356 120V88m0 14 9-8m-9 0-8-9m8 20-6-4"/>
  </g>
  <path d="M60 170c26-14 62-22 104-24s88 6 120 0 50-10 66-14l6 6c-16 6-36 12-70 16s-78 0-118 4-66 12-86 12z" fill="#3a2856" opacity=".9"/>
  ${[[92, 151], [150, 145], [212, 147], [272, 143], [330, 135]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="#ffd66b"/>`).join('')}
  ${pumpkin(70, 160, 1.15, 0)}${pumpkin(128, 150, 0.8, 2)}${pumpkin(190, 162, 1.3, 1)}${pumpkin(258, 151, 0.85, 0)}${pumpkin(318, 160, 1.05, 2)}
</svg>`);

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
    html: html`${back}<div class="head pk-head"><div class="pk-hero blueprint"><div class="pk-clip">${art}</div>${corners()}</div>
        <span class="eyebrow">Seasonal · North Logan</span><h1>Pumpkin Walk</h1><div class="muted pk-sub">${D.agency.brand}'s shuttle${sub ? ' · ' + sub : ''}</div></div>
      ${now$}
      ${live}
      ${fromStop(home)}${other !== undefined ? fromStop(other) : ''}
      <div class="section">${icon('calendar', 16)}The shuttle's nights</div>${strip}
      <div class="pk-actions"><a class="btn btn-primary" href="#/go/${D.stops[home].id}">${icon('walk', 18)}How to get to ${placeOf(home)}</a></div>
      <div class="fine">The shuttle's times are ${D.agency.brand}'s published timetable for the Pumpkin Walk, refreshed nightly, and live where the feed has the bus. The Pumpkin Walk itself is North Logan's; its own hours and news are the city's to give.</div>`,
    title: 'Pumpkin Walk', live: true, keepScroll: true,
    mount: (el, app) => { if (app) window.__app = app; },   // the rider's fix, for the nearest stop, as the home page reads it
  };
}

/** The commonest gap, in minutes, between a night's departures from a stop. */
function cadenceOf(ri, si, ymd) {
  const mins = timesOn(si, ymd).filter(t => t.r === ri && !t.prov).map(t => t.min).sort((a, b) => a - b), count = {};
  for (let i = 1; i < mins.length; i++) { const g = mins[i] - mins[i - 1]; if (g > 0) count[g] = (count[g] || 0) + 1; }
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return best ? +best[0] : null;
}
