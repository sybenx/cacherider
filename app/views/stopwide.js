// A stop's day hour by hour, and a run from it: its stops from here on, in a sheet over the page, drawn on the big
// map beside the page where there is one, else on a small map of the sheet's own.
import { D, stop, tripStops, tripEnd, timesOn, nextTrip, tripRoute, closedRoutes, onRequest } from '../data.js';
import { clock, clockText, clockShort, fmtDay } from '../time.js';
import { html, raw, esc, badge, lively, headsign, isLoop, icon } from '../ui.js';

// The run last laid out, for its map.
let shown = null;

/** A trip's stops with its last, where it lets off, which the departures leave out. */
function wholeTrip(ti) {
  const seq = tripStops(ti), te = tripEnd(ti);
  return te && seq.length && te.si !== seq[seq.length - 1][1] ? [...seq, [te.min, te.si]] : seq;
}

/** One ride on from this stop on the bus that calls at it: every stop after it with its time, and on through the
 *  Transit Center (or wherever the timetable cuts a loop's runs) on the same bus's next run, until it's round to
 *  this stop again or its day is done. A wait between runs, or a change of route, is a row of its own. The feed's
 *  estimate in blue for the first run, where it has the bus; after a wait the timetable's times stand. */
function runParts(t, si, ymd) {
  const delay = t.live && !isLoop(t.r) ? t.live.delay || 0 : 0;
  const legs = [], rows = [], points = [];
  let ti = t.trip, ri = t.r, seq = wholeTrip(ti), from = seq.findIndex(([, s]) => s === si) + 1, back = false, ended = false;
  const add = (m, s, legNo, r) => {
    const skip = closedRoutes(s, ymd).has(r), est = legNo === 0 && !!delay;
    rows.push({ m: m + (legNo === 0 ? delay : 0), s, skip, est, leg: legNo, r, req: onRequest(s, r, tripRoute(ti).dir) });
  };
  points.push({ si, t: 'You · ' + clockText(t.min + delay), rank: 0, leg: 0, r: t.r });
  legs.push({ ri, seq: [[t.min, si]] });
  for (let legNo = 0; legNo < 6; legNo++) {
    for (const [m, s] of seq.slice(from)) {
      if (legNo > 0 && s === si) { back = m; break; }   // round to this stop again: the ride ends where it began
      add(m, s, legNo, ri); legs[legNo].seq.push([m, s]);
    }
    if (back !== false) break;
    const n = nextTrip(ti, ymd);
    if (n === undefined) { ended = true; break; }
    const nr = tripRoute(n), ns = wholeTrip(n);
    if (!nr || !ns.length) { ended = true; break; }
    const last = rows[rows.length - 1], inMin = last ? last.m : t.min, outMin = ns[0][0];
    // A bus that sits for hours (16's morning runs, then its afternoon ones) is done for now: the ride ends there.
    if (outMin - (last ? last.m - (last.leg === 0 ? delay : 0) : t.min) > 45) { ended = true; break; }
    // Where the runs meet: a row saying so when the bus waits there or becomes another route; else the seam is seamless.
    const seam = last && last.s === ns[0][1];
    if (nr.r !== ri || outMin - (last ? last.m - (last.leg === 0 ? delay : 0) : t.min) >= 2 || (last && stop(last.s).hub)) {
      if (seam) rows.pop();   // the stop where it waits is the row that says so
      rows.push({ div: true, s: ns[0][1], inMin: last ? last.m : null, outMin, from: ri, to: nr.r });
    }
    ti = n; ri = nr.r; seq = ns; from = seam ? 1 : 0;
    legs.push({ ri, seq: seam ? [[ns[0][0], ns[0][1]]] : [] });
  }
  const stopsRows = rows.filter(x => !x.div);
  const lastStop = stopsRows[stopsRows.length - 1];
  const html1 = rows.map((x, i) => {
    if (x.div) {
      const name = stop(x.s).hub ? D.hub.name : stop(x.s).name;
      const what = x.to !== x.from ? `becomes ${badge(x.to, 20).s}` : 'stay on';
      return `<div class="run-div"><span class="run-t">${x.inMin !== null ? esc(clock(x.inMin).h) : ''}<small>${x.inMin !== null ? esc(clock(x.inMin).ap) : ''}</small></span><span class="run-n"><b>${esc(name)}</b><em>${x.inMin !== null ? 'in ' + esc(clockText(x.inMin)) + ' · ' : ''}out ${esc(clockText(x.outMin))} · ${what}</em></span></div>`;
    }
    const end = x === lastStop && ended;
    const name = stop(x.s).hub ? D.hub.name : stop(x.s).name;
    return `<a class="run-stop${x.skip ? ' skipped' : ''}${x.leg ? ' later' : ''}" href="#/stop/${esc(stop(x.s).id)}" data-id="${esc(stop(x.s).id)}" data-si="${x.s}"><span class="run-t${x.est ? ' est' : ''}">${x.skip ? '–' : `${esc(clock(x.m).h)}<small>${esc(clock(x.m).ap)}</small>`}</span><span class="run-n">${esc(name)}${x.skip ? '<em class="warnmark">Skipped · detour</em>' : end ? '<em>ends here · drop-off only</em>' : x.req ? '<em>on request</em>' : ''}</span></a>`;
  }).join('');
  // The map's labels: a time by each stop, a stop's once (the Transit Center between runs says in and out).
  const seen = new Set([si]);
  rows.forEach((x, i) => {
    if (x.div) { const p = points.find(q => q.si === x.s); const lab = (x.inMin !== null ? clock(x.inMin).h + '–' : '') + clock(x.outMin).h; if (p) p.t = lab; else { points.push({ si: x.s, t: lab, rank: 1, leg: 0, r: x.from }); seen.add(x.s); } return; }
    if (seen.has(x.s)) return;
    seen.add(x.s);
    points.push({ si: x.s, t: x.skip ? '' : x === lastStop && ended ? clockText(x.m) + ' · end' : clock(x.m).h, rank: x === lastStop ? 1 : i + 2, leg: x.leg, r: x.r });
  });
  shown = { key: t.trip + ':' + si + ':' + delay + ':' + rows.length, legs: legs.filter(l => l.seq.length > 1 || legs.indexOf(l) === 0), points };
  const foot = back !== false ? `<p class="run-then">Back at this stop at ${esc(clockText(back))}.</p>` : '';
  return {
    top: close => `<div class="run-top">${badge(t.r, 26).s}<div class="col"><b>The ${esc(clockText(t.min))} from here</b><span class="muted">${esc(headsign(t))}${delay ? ` · running ${delay} min late` : ''}</span></div><button type="button" class="btn btn-ghost btn-icon" ${close} aria-label="Close">${icon('close', 20).s}</button></div>`,
    list: stopsRows.length ? `<div class="run-stops">${html1}</div>` : '<p class="muted">This stop is the end of its run.</p>',
    foot, has: stopsRows.length > 0,
  };
}

/** The picked time in the middle of the day's row, if the row is wider than its room. */
function centreStrip(el) {
  const s = el.querySelector('.day-strip'), on = s && s.querySelector('.on');
  if (on) s.scrollLeft = on.offsetLeft - (s.clientWidth - on.offsetWidth) / 2;
}

/** The day at a stop, an hour to a column, from the current hour; the next day with buses once today's are done.
 *  A time is a button: its run, from here on, shows under the day. */
function dayOf(si, next, clockNow) {
  let rows = timesOn(si, clockNow.ymd).map(t => lively({ ...t, day: 0, ymd: clockNow.ymd })).filter(t => !t.gone);
  let head = 'The rest of today', from = Math.floor(clockNow.min / 60), today = true, ymd = clockNow.ymd;
  if (!rows.some(t => t.min >= clockNow.min) && next[0]) {
    rows = timesOn(si, next[0].ymd); from = 0; today = false; ymd = next[0].ymd;
    head = next[0].day === 1 ? 'Tomorrow · ' + fmtDay(next[0].ymd, true) : fmtDay(next[0].ymd, true);
  }
  rows = rows.filter(t => Math.floor(t.min / 60) >= from).sort((a, b) => a.min - b.min);
  return rows.length ? { rows, head, from, today, ymd } : null;
}
const depBtn = (t, d, clockNow, on) => `<button type="button" class="hr-dep${d.today && t.min < clockNow.min ? ' past' : ''}${on ? ' on' : ''}" data-trip="${t.trip}" data-on="${d.ymd}" aria-pressed="${on ? 'true' : 'false'}">${badge(t.r, 20).s}<span class="${t.live ? 'est' : ''}">${esc(clock(t.min).h)}</span></button>`;

/** The day at a stop, an hour to a column, from the current hour; the next day with buses once today's are done.
 *  A time is a button for its run, which opens in a sheet over the page (`pick.trip` the one open). */
export function restOfDay(si, next, clockNow, pick) {
  const d = dayOf(si, next, clockNow);
  if (!d) return '';
  const { rows, head, from, today } = d;
  const hours = new Map();
  for (const t of [...rows].sort((a, b) => a.min - b.min)) { const h = Math.floor(t.min / 60); if (!hours.has(h)) hours.set(h, []); hours.get(h).push(t); }   // by when each leaves, a late bus in its place
  const last = rows.reduce((x, t) => t.min > x.min ? t : x, rows[0]);
  const cols = [...hours].map(([h, list]) => `<div class="hr${today && h === from ? ' now' : ''}"><span class="hr-h">${esc(clockShort(h * 60))}</span>${list.map(t => depBtn(t, d, clockNow, pick.trip === t.trip)).join('')}</div>`).join('');
  const lastLine = `Last bus ${clockText(last.min)} · ${isLoop(last.r) ? D.routes[last.r].long : 'Route ' + D.routes[last.r].short}`;
  return html`<section class="ws-sec ws-day phone-day"><div class="ws-eye"><span>${head}</span><span>${lastLine}</span></div><div class="hours">${raw(cols)}</div><p class="day-hint">Tap a time for its stops from here on.</p></section>`;
}

// ---- the run: a sheet over the stop page, with its own address (…?run=trip&on=day), so Back closes it
let mapOnly = false;
/** The sheet's markup for `trip` on day `on`: the run's title, the day's times in a row to switch runs, the map, and
 *  the run's stops under it; 'Whole map' gives the map the sheet. Null when there's no such run here. */
export function runSheet(si, next, clockNow, trip, on, bigMap = false) {
  const d = dayOf(si, next, clockNow);
  const t = (d && d.ymd === on && d.rows.find(x => x.trip === trip)) || next.find(x => x.trip === trip && x.ymd === on);
  if (!t) return null;
  const p = runParts(t, si, on);
  const row = d && d.ymd === on ? d.rows : next.filter(x => x.ymd === on);
  const strip = row.map(x => depBtn(x, { today: on === clockNow.ymd, ymd: on }, clockNow, x.trip === trip)).join('');
  return `<div class="rs-scrim" data-rs-close></div>
    <div class="rs${mapOnly ? ' map-only' : ''}" role="dialog" aria-label="The ${esc(clockText(t.min))} from here">
      <div class="rs-grip"></div>${p.top('data-rs-close')}
      <div class="day-strip rs-strip">${strip}</div>
      ${p.has && !bigMap ? `<div class="rs-map"><div class="run-map" id="runmap"></div><button type="button" class="btn btn-secondary rs-whole" data-rs-whole>${icon(mapOnly ? 'list' : 'map', 16).s}${mapOnly ? 'Stops' : 'Whole map'}</button></div>` : ''}
      <div class="rs-list">${p.list}${p.foot}</div>
    </div>`;
}
/** Wire the sheet: its times switch the run in place (Back still closes it in one go), its stops light theirs on the
 *  map and, tapped again, open, 'Whole map' swaps map and list, and × , the shade or a drag down on its top close it. */
export function wireSheet(sheet, { open, swap, close }) {
  if (!sheet) return;
  centreStrip(sheet);
  const map = () => import('./map.js');
  sheet.onclick = e => {
    const b = e.target.closest('[data-rs-close], [data-rs-whole], .rs-strip [data-trip], .run-stop');
    if (!b) return;
    if (b.matches('[data-rs-close]')) return close();
    if (b.matches('[data-rs-whole]')) {
      mapOnly = !mapOnly;
      sheet.querySelector('.rs').classList.toggle('map-only', mapOnly);
      b.innerHTML = icon(mapOnly ? 'list' : 'map', 16).s + (mapOnly ? 'Stops' : 'Whole map');
      map().then(m => m.runResize());
      return;
    }
    if (b.dataset.trip) return swap(+b.dataset.trip, b.dataset.on);
    // a stop in the list: lit and centred on the map first; tapped again, its page
    if (!b.classList.contains('hot')) { e.preventDefault(); sheet.querySelectorAll('.run-stop.hot').forEach(a => a.classList.remove('hot')); b.classList.add('hot'); map().then(m => m.runFocus(+b.dataset.si)); }
  };
  const top = sheet.querySelector('.rs-grip'), box = sheet.querySelector('.rs');
  let y0 = null;
  const start = e => { y0 = e.touches[0].clientY; box.style.transition = 'none'; };
  const move = e => { if (y0 === null) return; const dy = Math.max(0, e.touches[0].clientY - y0); box.style.transform = `translateY(${dy}px)`; };
  const end = e => { if (y0 === null) return; const dy = (e.changedTouches[0] ? e.changedTouches[0].clientY : y0) - y0; y0 = null; box.style.transition = ''; if (dy > 90) close(); else box.style.transform = ''; };
  for (const el of [top, sheet.querySelector('.run-top')]) if (el) { el.addEventListener('touchstart', start, { passive: true }); el.addEventListener('touchmove', move, { passive: true }); el.addEventListener('touchend', end); }
}
/** The run the sheet shows, for the big map to draw beside a narrower page. */
export const sheetRun = () => shown;
