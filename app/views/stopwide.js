// A stop's day hour by hour, and a run from it: its stops from here on, in a sheet over the page, drawn on the big
// map beside the page where there is one, else on a small map of the sheet's own.
import { D, stop, tripStops, tripEnd, timesOn, nextTrip, prevTrip, tripRoute, closedRoutes, onRequest, timed, busOf } from '../data.js';
import { rt, busNth, callAt } from '../rt.js';
import { clock, clockText, clockShort, fmtDay, isGone, now } from '../time.js';
import { html, raw, esc, badge, lively, headsign, isLoop, icon, heard, heardName, timedMark, routeName, nthWords } from '../ui.js';
import { isWide } from '../wide.js';

// The run last laid out, for its map.
let shown = null;

/** Which of its route's buses that day runs a trip, as dispatch numbers them ('Bus 2 of 3 · G2'), and today the
 *  vehicle on that run now, by its number ('· bus 1182'), for a run still to come here (one gone may have been
 *  another bus: they swap at a shift's change). The user, of a time tapped in the day: 'i'd like to be able
 *  to tell if its green 1,2, or 3. maybe the bus number too if you can fit it.' Nothing for a route with one bus. */
function whichBus(t, ymd) {
  const x = t.trip !== undefined ? busOf(t.trip, ymd) : null;
  if (!x) return '';
  const c = now(), v = ymd === c.ymd && !t.gone && !isGone(t, c) ? rt.buses.find(b => { const y = busNth(b); return y && y.key === x.key && y.n === x.n; }) : null;
  return `<span class="muted rs-bus">${esc(nthWords(t.r, x))}${v ? ' · bus ' + esc(v.label) : ''}</span>`;
}
/** A trip's stops with its last, where it lets off, which the departures leave out. */
function wholeTrip(ti) {
  const seq = tripStops(ti), te = tripEnd(ti);
  return te && seq.length && te.si !== seq[seq.length - 1][1] ? [...seq, [te.min, te.si]] : seq;
}

/** One ride on from this stop on the bus that calls at it: every stop after it with its time, and on through the
 *  Transit Center (or wherever the timetable cuts a loop's runs) on the same bus's next run, until it's round to
 *  this stop again or its day is done. A wait between runs, or a change of route, is a row of its own. The feed's
 *  estimate in blue for the first run, where it has the bus; after a wait the timetable's times stand.
 *  The user: 'next clicking on any bus, the top of the list should have the transit center, and so should teh bottom.
 *  so i can see when it will get to the transit center'. So the list opens on when this bus left (or leaves) the
 *  Center, and ends where it next gets in there: the end of a route's way back, a loop's lap. The feed cuts runs
 *  where it likes (a Blue Loop run from 55 North Main itself, through the Center and round to 55 North Main; a Green
 *  Loop's at 750 North Main; Route 12's at 83 West Main, its way back the next trip), so both are found along the
 *  bus's runs of this route, not this trip's ends. A stop at the Center itself has no row above it: it is the Center. */
function runParts(t, si, ymd, clockNow) {
  const delay = t.live && !isLoop(t.r) ? t.live.delay || 0 : 0;
  const legs = [], rows = [], points = [];
  let ti = t.trip, ri = t.r, seq = wholeTrip(ti), from = callAt(seq, si, t.live ? t.min - (t.live.delay || 0) : t.min) + 1,   // a loop calling here twice (the Blue Loop at 55 North Main): the call at this time, not its first
    back = false, ended = false;
  const add = (m, s, legNo, r) => {
    const skip = closedRoutes(s, ymd).has(r), est = legNo === 0 && !!delay;
    rows.push({ m: m + (legNo === 0 ? delay : 0), s, skip, est, leg: legNo, r, req: onRequest(s, r, tripRoute(ti).dir) });
  };
  // Back along the bus's runs, this route's, to the Center it left: this trip's stops before this one, then the trips
  // the same bus ran before it, as long as it didn't sit (runOf's 45 min).
  let left = null;
  if (!stop(si).hub) {
    let bti = t.trip, bs = seq, upto = from - 1;
    for (let k = 0; k < 4 && !left; k++) {
      for (let i = upto - 1; i >= 0; i--) if (stop(bs[i][1]).hub) { left = { m: bs[i][0] + (k === 0 ? delay : 0), s: bs[i][1], est: k === 0 && !!delay }; break; }
      if (left) break;
      const p = prevTrip(bti, ymd), pr = p !== undefined && tripRoute(p), ps = pr ? wholeTrip(p) : [];
      if (!pr || pr.r !== t.r || !ps.length || bs[0][0] - ps[ps.length - 1][0] > 45) break;
      bti = p; bs = ps; upto = ps.length;
    }
  }
  let atHub = false;   // the ride got in at the Center: its last row, and the list ends there
  points.push({ si, t: 'You · ' + clockText(t.min + delay), rank: 0, leg: 0, r: t.r });
  legs.push({ ri, seq: [[t.min, si]] });
  for (let legNo = 0; legNo < 6; legNo++) {
    for (const [m, s] of seq.slice(from)) {
      if (legNo > 0 && s === si) { back = m; break; }   // round to this stop again: the ride ends where it began
      add(m, s, legNo, ri); legs[legNo].seq.push([m, s]);
      if (stop(s).hub) { atHub = true; break; }   // in at the Center: what the user asked the list to show, and its end
    }
    if (back !== false || atHub) break;
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
    if (x === lastStop && atHub) return `<a class="run-stop run-hub${x.leg ? ' later' : ''}" href="#/stop/${esc(stop(x.s).id)}" data-id="${esc(stop(x.s).id)}" data-si="${x.s}"><span class="run-t${x.est ? ' est' : ''}">${esc(clock(x.m).h)}<small>${esc(clock(x.m).ap)}</small></span><span class="run-n">${esc(D.hub.name)}<em>gets in</em></span></a>`;
    // A stop the detour skips: one quiet line in its place, the landmark alone, not a stop's row with a dash for a time.
    if (x.skip) return `<a class="run-stop skipped" href="#/stop/${esc(stop(x.s).id)}" data-id="${esc(stop(x.s).id)}" data-si="${x.s}"><span class="run-t"></span><span class="run-n">${esc(heardName(x.s).name)} <em>skipped · detour</em></span></a>`;
    const name = heard(x.s).s;   // the landmark the bus announces, the address under it
    return `<a class="run-stop${x.leg ? ' later' : ''}" href="#/stop/${esc(stop(x.s).id)}" data-id="${esc(stop(x.s).id)}" data-si="${x.s}"><span class="run-t${x.est ? ' est' : ''}">${esc(clock(x.m).h)}<small>${esc(clock(x.m).ap)}</small></span><span class="run-n">${name}${end ? '<em>ends here · drop-off only</em>' : x.req ? '<em>on request</em>' : timed(x.s, x.r) ? timedMark().s : ''}</span></a>`;
  }).join('');
  // The map's labels: a time by each stop, a stop's once (the Transit Center between runs says in and out).
  const seen = new Set([si]);
  rows.forEach((x, i) => {
    if (x.div) { const p = points.find(q => q.si === x.s); const lab = (x.inMin !== null ? clock(x.inMin).h + '–' : '') + clock(x.outMin).h; if (p) p.t = lab; else { points.push({ si: x.s, t: lab, rank: 1, leg: 0, r: x.from }); seen.add(x.s); } return; }
    if (seen.has(x.s)) return;
    seen.add(x.s);
    points.push({ si: x.s, t: x.skip ? '' : x === lastStop && ended ? clockText(x.m) + ' · end' : clock(x.m).h, rank: x === lastStop ? 1 : i + 2, leg: x.leg, r: x.r });
  });
  shown = { key: t.trip + ':' + si + ':' + delay + ':' + rows.length, trip: t.trip, ymd, legs: legs.filter(l => l.seq.length > 1 || legs.indexOf(l) === 0), points };
  // The Center it left, above this stop's rows: 'left' once the time's gone, else 'leaves' (a run picked ahead).
  const gone = left && (ymd < clockNow.ymd || (ymd === clockNow.ymd && isGone({ min: left.m, day: 0 }, clockNow)));
  const head = left ? `<a class="run-stop run-hub" href="#/stop/${esc(stop(left.s).id)}" data-id="${esc(stop(left.s).id)}" data-si="${left.s}"><span class="run-t${left.est ? ' est' : ''}">${esc(clock(left.m).h)}<small>${esc(clock(left.m).ap)}</small></span><span class="run-n">${esc(D.hub.name)}<em>${gone ? 'left' : 'leaves'}</em></span></a>` : '';
  const foot = back !== false ? `<p class="run-then">Back at this stop at ${esc(clockText(back))}.</p>` : '';
  return {
    top: (close, step = '') => `<div class="run-top">${badge(t.r, 26).s}<div class="col"><b>The ${esc(clockText(t.min))}<span class="rs-here"> from here</span></b><span class="muted">${esc(headsign(t))}${delay ? ` · running ${delay} min late` : ''}</span>${whichBus(t, ymd)}</div>${step}<button type="button" class="btn btn-ghost btn-icon" ${close} aria-label="Close">${icon('close', 20).s}</button></div>`,
    list: stopsRows.length ? `<div class="run-stops">${head}${html1}</div>` : '<p class="muted">This stop is the end of its run.</p>',
    foot,
  };
}

/** The day at a stop, an hour to a column, the whole of it, the ones gone muted (the user: 'i'd like to be able to see
 *  the previous times in the day. i think the rest of today maybe should be the whole day all the time'); the next day
 *  with buses once today's are done. A time is a button: its run, from here on, shows under the day. */
function dayOf(si, next, clockNow) {
  let rows = timesOn(si, clockNow.ymd).map(t => lively({ ...t, day: 0, ymd: clockNow.ymd }));
  let head = 'Today', from = 0, today = true, ymd = clockNow.ymd;
  if (!rows.some(t => t.min >= clockNow.min) && next[0]) {
    rows = timesOn(si, next[0].ymd); from = 0; today = false; ymd = next[0].ymd;
    head = next[0].day === 1 ? 'Tomorrow · ' + fmtDay(next[0].ymd, true) : fmtDay(next[0].ymd, true);
  }
  rows = rows.filter(t => Math.floor(t.min / 60) >= from).sort((a, b) => a.min - b.min);
  return rows.length ? { rows, head, from, today, ymd } : null;
}
const depBtn = (t, d, clockNow, on) => `<button type="button" class="hr-dep${d.today && (t.gone || isGone(t, clockNow)) ? ' past' : ''}${on ? ' on' : ''}" data-trip="${t.trip}" data-on="${d.ymd}" aria-pressed="${on ? 'true' : 'false'}">${badge(t.r, 20).s}<span class="${t.live ? 'est' : ''}">${esc(clock(t.min).h)}</span></button>`;

/** The day at a stop, an hour to a column, from the current hour; the next day with buses once today's are done.
 *  A time is a button for its run, which opens in a sheet over the page (`pick.trip` the one open). */
export function restOfDay(si, next, clockNow, pick) {
  const d = dayOf(si, next, clockNow);
  if (!d) return '';
  const { rows, head, today } = d;
  const hours = new Map();
  for (const t of [...rows].sort((a, b) => a.min - b.min)) { const h = Math.floor(t.min / 60); if (!hours.has(h)) hours.set(h, []); hours.get(h).push(t); }   // by when each leaves, a late bus in its place
  const last = rows.reduce((x, t) => t.min > x.min ? t : x, rows[0]);
  const nowH = Math.floor(clockNow.min / 60);
  const cols = [...hours].map(([h, list]) => `<div class="hr${today && h === nowH ? ' now' : ''}"><span class="hr-h">${esc(clockShort(h * 60))}</span>${list.map(t => depBtn(t, d, clockNow, pick.trip === t.trip)).join('')}</div>`).join('');
  const lastLine = `Last bus ${clockText(last.min)} · ${routeName(last.r, false)}`;
  return html`<section class="ws-sec ws-day phone-day"><div class="ws-eye"><span>${head}</span><span>${lastLine}</span></div><div class="hours">${raw(cols)}</div><p class="day-hint">Tap a time for its stops from here on.</p></section>`;
}

// ---- the run: a sheet over the stop page, with its own address (…?run=trip&on=day), so Back closes it
/** The sheet's markup for `trip` on day `on`: the run's title, with the run before and the one after a tap (or a swipe
 *  across) away, and the run's stops, over the map, which draws the run. Null when there's no such run here. The
 *  day's times were a row under the title to scroll: four of thirty in view, and the question is nearly always the
 *  next bus or the one before (the stop's page behind has the whole day). */
export function runSheet(si, next, clockNow, trip, on) {
  const d = dayOf(si, next, clockNow);
  const t = (d && d.ymd === on && d.rows.find(x => x.trip === trip)) || next.find(x => x.trip === trip && x.ymd === on);
  if (!t) return null;
  const p = runParts(t, si, on, clockNow);
  const row = d && d.ymd === on ? d.rows : next.filter(x => x.ymd === on);
  const i = row.findIndex(x => x.trip === trip), today = on === clockNow.ymd;
  const stepBtn = (x, dir) => x ? `<button type="button" class="rs-step${today && isGone(x, clockNow) ? ' past' : ''}" data-trip="${x.trip}" data-on="${on}" data-step="${dir}" aria-label="The ${esc(clockText(x.min))}">${dir < 0 ? icon('back', 18).s : ''}<span>${esc(clock(x.min).h)}</span>${dir > 0 ? icon('fwd', 18).s : ''}</button>`
    : `<span class="rs-step none"></span>`;
  const step = i < 0 ? '' : `<div class="rs-steps">${stepBtn(row[i - 1], -1)}${stepBtn(row[i + 1], 1)}</div>`;
  return `<div class="rs-scrim" data-rs-close></div>
    <div class="rs" role="dialog" aria-label="The ${esc(clockText(t.min))} from here">
      <div class="rs-grip"></div>${p.top('data-rs-close', step)}
      <div class="rs-list">${p.list}${p.foot}</div>
    </div>`;
}
/** Wire the sheet: the run before and after switch it in place, tapped or swiped across (Back still closes it in one
 *  go), its stops light theirs on the map and, tapped again, open, and × or the shade close it. */
export function wireSheet(sheet, { swap, close }) {
  if (!sheet) return;
  const map = () => import('./map.js');
  sheet.onclick = e => {
    const b = e.target.closest('[data-rs-close], .rs-steps [data-trip], .run-stop');
    if (!b) return;
    if (b.matches('[data-rs-close]')) return close();
    if (b.dataset.trip) return swap(+b.dataset.trip, b.dataset.on);
    // a stop in the list: lit and centred on the map first; tapped again, its page
    if (!b.classList.contains('hot')) { e.preventDefault(); sheet.querySelectorAll('.run-stop.hot').forEach(a => a.classList.remove('hot')); b.classList.add('hot'); map().then(m => m.runFocus(+b.dataset.si)); }
  };
  const top = sheet.querySelector('.rs-grip'), box = sheet.querySelector('.rs');
  // On a phone or a tablet, over the map: a swipe down folds it to its head (which run, and the day's times to switch
  // to), the map the finger's; up, or a tap on the grip, opens it again. Only × (or Back) closes it. Beside a wide
  // screen's map it's the panel, and a swipe down closes it, as ever.
  const fold = on => {
    if (on && !sheet.classList.contains('folded')) { const list = sheet.querySelector('.rs-list'); if (list) sheet.style.setProperty('--rs-fold', Math.round(list.getBoundingClientRect().top - box.getBoundingClientRect().top) + 'px'); }
    sheet.classList.toggle('folded', on);
  };
  if (top) top.onclick = () => { if (!isWide()) fold(!sheet.classList.contains('folded')); };
  let y0 = null;
  const start = e => { y0 = e.touches[0].clientY; box.style.transition = 'none'; };
  const move = e => { if (y0 === null) return; const dy = Math.max(0, e.touches[0].clientY - y0); box.style.transform = `translateY(${dy}px)`; };
  const end = e => {
    if (y0 === null) return;
    const dy = (e.changedTouches[0] ? e.changedTouches[0].clientY : y0) - y0;
    y0 = null; box.style.transition = ''; box.style.transform = '';
    if (isWide()) { if (dy > 90) close(); return; }
    if (dy > 60) fold(true); else if (dy < -40) fold(false);
  };
  // Set, not added: the sheet is redrawn in place as the feed comes in, its elements kept, and wired again each time.
  for (const el of [top, sheet.querySelector('.run-top')]) if (el) { el.ontouchstart = start; el.ontouchmove = move; el.ontouchend = end; }
  // Across, anywhere on it: the run after (to the left) or before (to the right), as directions step between ways.
  let sx = null, sy = 0;
  if (box) {
    box.ontouchstart = e => { if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } else sx = null; };
    box.ontouchend = e => {
      if (sx === null || !e.changedTouches[0]) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      sx = null;
      if (Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy)) return;
      const b = sheet.querySelector(`.rs-steps [data-step="${dx < 0 ? 1 : -1}"]`);
      if (b) swap(+b.dataset.trip, b.dataset.on);
    };
  }
}
/** The run the sheet shows, for the big map to draw beside a narrower page. */
export const sheetRun = () => shown;
