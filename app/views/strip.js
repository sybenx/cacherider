// The day at the Transit Center: every bus's day, a column each, as the user drew it (block-strip mockup,
// 2026-11-19). The user: 'that full block strip is my favorite part'. Not a page of its own (a block never is: cr-v531),
// the Center's second view, where every bar and step happens. A bus's day is one line down its column, by the clock:
// a stretch in the colour of the route it's running, a bar across where it's at the Center between runs of the same
// route, a step sideways where it leaves the Center as another, a dashed line where it's out of service, a small ring
// where its day starts or ends somewhere else (the 16's, the Preston commuter's: the user's own notes on the mockup).
// No key for the drawing itself: the hours, the route badges at the heads and the now line say it; only today's
// dots, Live or Scheduled, drawn once above it (a second opinion: 'ring' in words was his end caps too).
import { D, keptOn, servicesOn, tripStops, tripEnd, tripRoute, staysOn, familyKey, opOf, stop, liftHex, corridor, timed, agencyRuns, holidayOn } from '../data.js';
import { html, esc, badge, routeName, heardName } from '../ui.js';
import { clockShort, clockText, isDue, isGone, dayFrom, dayName, fmtDay } from '../time.js';
import { lightInks } from '../ink.js';
import { rt, rtStale, busDelay, lateWords, isLoop } from '../rt.js';
import { townsReady, loadTowns, stopTown, tripTowns, routeTownInks } from '../towns.js';

const PPM = 1.6;   // pixels a minute: an hour is 96, a day of buses a long scroll, a 30-minute run a stroke to tap
const CW = 46;     // a column: a bus, or a two-route bus's two lanes 14 apart
const AX = 56;     // the hours' width, room for the now line's '12:40 PM'
const TOP = 10;    // room above the first hour's line
const J = 5;       // a step's half height, taken off the runs either side of it

const dark = () => document.documentElement.dataset.theme === 'dark';
/** A route's colour as the map and the route page draw its line: lifted on dark, sunk where it's pale on light. */
let lightOf = null;
function ink(ri) {
  const r = D.routes[ri];
  if (dark()) return '#' + (r.dcolor || liftHex(r.color));
  lightOf ??= lightInks(D.routes.map(x => ({ color: x.color, second: x.gtfsText })));
  return lightOf.get(r.color.toUpperCase()) || '#' + r.color;
}
const isLoopR = ri => (D.hub.loops || []).includes(ri);
const startOf = ti => tripStops(ti)[0][0];
const endOf = ti => { const e = tripEnd(ti), s = tripStops(ti); return e ? e.min : s[s.length - 1][0]; };
const lastSi = ti => { const e = tripEnd(ti), s = tripStops(ti); return e ? e.si : s[s.length - 1][1]; };
const hubSi = si => si >= 0 && !!stop(si).hub;

/** A bus's trips as runs: one route's trips with no more than 45 minutes between, split at the Center. A loop's trips
 *  the feed cuts on Main Street (Blue at 55 North Main, Green at 750 North Main), the Center part way along: its laps
 *  are cut at its Center calls instead, each from the Center round to the Center, a way into its stops there. */
function runsOf(c) {
  const runs = [];
  for (const ti of c) {
    const r = tripRoute(ti).r, prev = runs[runs.length - 1], pt = prev && prev.trips[prev.trips.length - 1];
    if (prev && prev.r === r && staysOn(pt, ti) && (isLoopR(r) || !hubSi(lastSi(pt)))) prev.trips.push(ti);
    else runs.push({ r, trips: [ti] });
  }
  const out = [];
  for (const x of runs) {
    const last = x.trips[x.trips.length - 1];
    if (!isLoopR(x.r)) {
      const f = tripStops(x.trips[0])[0];
      out.push({ r: x.r, trips: x.trips, a: f[0], b: endOf(last), from: f[1], to: lastSi(last), link: { si: f[1], ti: x.trips[0] } });
      continue;
    }
    // Its calls in order, a call the next trip starts with once; cut at each Center call.
    const calls = [];
    for (const ti of x.trips) for (const [m, si] of tripStops(ti)) { const p = calls[calls.length - 1]; if (!p || p.si !== si || p.m !== m) calls.push({ m, si, ti }); }
    const e = tripEnd(last); if (e) calls.push({ m: e.min, si: e.si, ti: last });
    const cuts = calls.map((q, i) => hubSi(q.si) ? i : -1).filter(i => i > 0 && i < calls.length - 1);
    const bounds = [0, ...cuts, calls.length - 1];
    for (let k = 0; k + 1 < bounds.length; k++) {
      const p = calls[bounds[k]], q = calls[bounds[k + 1]];
      if (q.m <= p.m) continue;
      out.push({ r: x.r, trips: [...new Set(calls.slice(bounds[k], bounds[k + 1] + 1).map(z => z.ti))], a: p.m, b: q.m, from: p.si, to: q.si, link: { si: p.si, ti: p.ti }, loop: true });
    }
  }
  return out;
}

/** A day's buses, each its runs: from the timetable's blocks (a bus's trips, one after another). A trip in no block
 *  (the Blue Loop's the nightly puts back, tools/keeproute.py) goes on the end of a bus of its route that's in by
 *  then, as its buses do; a block that loops back on itself (a slip in the feed), each trip its own. Once a day. */
const daysOf = new Map();
export function busesOn(ymd) {
  if (daysOf.has(ymd)) return daysOf.get(ymd);
  if (daysOf.size > 7) daysOf.clear();
  const svs = servicesOn(ymd), trips = new Set();
  for (const per of Object.values(D.times)) for (const sv of svs) for (const row of per[sv] || []) if (tripStops(row[4]).length) trips.add(row[4]);
  const next = new Map();
  for (const sv of svs) for (const [a, b] of Object.entries((D.next && D.next[sv]) || {})) if (trips.has(+a) && trips.has(b)) next.set(+a, b);
  const after = new Set(next.values()), chains = [], loose = [], used = new Set();
  for (const ti of [...trips].sort((a, b) => startOf(a) - startOf(b))) {
    if (after.has(ti)) continue;
    if (!next.has(ti)) { loose.push(ti); used.add(ti); continue; }
    const c = [ti];
    while (next.has(c[c.length - 1]) && !used.has(next.get(c[c.length - 1])) && c.length < 300) c.push(next.get(c[c.length - 1]));
    c.forEach(x => used.add(x));
    chains.push(c);
  }
  for (const ti of trips) if (!used.has(ti)) loose.push(ti);
  for (const ti of loose.sort((a, b) => startOf(a) - startOf(b))) {
    const r = tripRoute(ti).r, s = startOf(ti);
    const c = chains.filter(c => tripRoute(c[c.length - 1]).r === r && endOf(c[c.length - 1]) <= s && s - endOf(c[c.length - 1]) <= 45).sort((p, q) => endOf(q[q.length - 1]) - endOf(p[p.length - 1]))[0];
    if (c) c.push(ti); else chains.push([ti]);
  }
  const buses = chains.map(c => {
    const runs = runsOf(c);
    const keys = [...new Set(runs.map(x => familyKey(x.r)))];
    return runs.length ? { runs, keys, ris: [...new Set(runs.map(x => x.r))], trips: new Set(c), a: runs[0].a, b: runs[runs.length - 1].b } : null;
  }).filter(Boolean);
  // The numbered routes in order, then the loops, then another operator's; a route's buses by when they start.
  const rank = b => { const ri = b.runs[0].r; return (opOf(ri) ? 2000 : isLoopR(ri) ? 1000 : 0) + (parseInt(b.keys[0]) || 999); };
  buses.sort((p, q) => rank(p) - rank(q) || p.keys[0].localeCompare(q.keys[0]) || p.a - q.a);
  daysOf.set(ymd, buses);
  return buses;
}

/** Today's buses in the feed, by the timetable trip each is on. None on another day, or with the feed gone quiet. */
const liveOn = today => !today || rtStale() ? new Map() : new Map(rt.buses.map(b => [D.trips.indexOf(b.trip), b]).filter(([ti]) => ti >= 0));
/** A column's bus now. Where the feed has it on time, or with no minute to be late by (a loop spaces its buses; a route
 *  on an old timetable can't say), one red dot at now. Off its schedule by 2 minutes or more (lateWords' line), the red
 *  dot is where the bus really is, at the minute its timetable has it there (6 min late: 6 minutes back up the line),
 *  and an empty dot at now is where it should be, a dotted red stroke between them (the user: 'red dots that show live
 *  position and the empty dots on the line show the scheduled time'). Where the feed hasn't it, the empty dot alone. */
function nowDot(b, live, nowMin, y, lx, on, past, r) {
  const seenOn = b.runs.find(x => x.trips.some(ti => live.has(ti))), cur = b.runs.find(x => on(x.a) && !past(x.b));
  const x = seenOn || cur;
  if (!x) return { svg: '', dl: null };
  const X = lx(x), ny = y(nowMin), dot = (cy, cls) => `<circle cx="${X}" cy="${cy}" r="${r}" class="ds-bus${cls}"/>`;
  const bus = seenOn ? live.get(x.trips.find(ti => live.has(ti))) : null;
  const dl = bus && !isLoop(bus.ri) && !keptOn(bus.ri) ? busDelay(bus) : null;
  if (dl === null || Math.abs(dl) < 2) return { svg: dot(ny, bus ? ' live' : ''), dl: null };
  const ly = y(nowMin - dl);
  return { svg: `<line x1="${X}" x2="${X}" y1="${ny}" y2="${ly}" class="ds-off"/>${dot(ny, '')}${dot(ly, ' live')}`, dl, X, ly };
}
/** The strip: the hours down the left, held there; the buses' heads along the top, held there as the day scrolls under
 *  them, each route's badge a way to that route's day (his mockup's 'tap a head'; `dayK`, the day picked); a column a bus. Each run a way into its stops
 *  (the run's sheet on its first stop's page, as the Center's own times are). `today`: its now and its live buses. */
export function strip(clockNow, today = true, dayK = '') {
  const ymd = clockNow.ymd, buses = busesOn(ymd);
  if (!buses.length) return '';
  const top0 = Math.floor(Math.min(...buses.map(b => b.a)) / 60) * 60, bot = Math.ceil(Math.max(...buses.map(b => b.b)) / 60) * 60;
  const y = m => (m - top0) * PPM + TOP, H = y(bot) + 12, W = buses.length * CW;
  const t = m => ({ min: m, day: 0 }), on = m => isDue(t(m), clockNow), past = m => isGone(t(m), clockNow);
  // The feed's buses by the trip they're on: a late one still on a run the timetable has done is out all the same.
  const live = liveOn(today);
  const nowY = clockNow.min >= top0 && clockNow.min <= bot ? y(clockNow.min) : null;
  let svg = '', axis = '';
  for (let m = top0; m <= bot; m += 60) {
    axis += `<span class="ds-hr" style="top:${y(m)}px">${clockShort(m)}</span>`;
    svg += `<line x1="0" x2="${W}" y1="${y(m)}" y2="${y(m)}" class="ds-grid"/>`;
  }
  const heads = buses.map((b, c) => `<span class="ds-head" style="left:${c * CW}px">${b.ris.filter((ri, i, a) => a.findIndex(x => familyKey(x) === familyKey(ri)) === i).slice(0, 2).map(ri => `<a href="#/map/route/${encodeURIComponent(familyKey(ri) === 'PRT' ? D.routes[ri].short : familyKey(ri))}?day=1&on=${dayK}" aria-label="${routeName(ri)} through the day">${badge(ri, 20).s}</a>`).join('')}</span>`).join('');
  buses.forEach((b, c) => {
    const lanes = b.keys.slice(0, 3), cx = c * CW + CW / 2, gap = lanes.length === 3 ? 12 : 14;
    const lx = x => cx + (Math.max(0, lanes.indexOf(familyKey(x.r))) - (lanes.length - 1) / 2) * gap;
    let g = '';
    b.runs.forEach((x, k) => {
      const prev = b.runs[k - 1], nx = b.runs[k + 1], X = lx(x), op = past(x.b) ? 0.4 : 1;
      const stepIn = prev && x.a - prev.b <= 45 && lx(prev) !== X, stepOut = nx && nx.a - x.b <= 45 && lx(nx) !== X;
      g += `<line x1="${X}" x2="${X}" y1="${y(x.a) + (stepIn ? J : 0)}" y2="${Math.max(y(x.a) + (stepIn ? J : 0) + 2, y(x.b) - (stepOut ? J : 0))}" stroke="${ink(x.r)}" stroke-width="5" stroke-linecap="round" opacity="${op}"/>`;
      if (prev) {
        const px = lx(prev), o = past(x.a) ? 0.4 : 1;
        if (x.a - prev.b > 45) g += `<line x1="${px}" x2="${X}" y1="${y(prev.b) + 6}" y2="${y(x.a) - 6}" class="ds-out"/>`;
        else if (stepIn) { const ya = y(prev.b) - J, yb = y(x.a) + J, ym = (ya + yb) / 2, d = Math.sign(X - px), rr = Math.min(4, (yb - ya) / 2);
          g += `<path d="M${px} ${ya}L${px} ${ym - rr}Q${px} ${ym} ${px + d * rr} ${ym}L${X - d * rr} ${ym}Q${X} ${ym} ${X} ${ym + rr}L${X} ${yb}" class="ds-step" opacity="${o}"/>`; }
        else { const ym = (y(prev.b) + y(x.a)) / 2; g += `<line x1="${X - 6}" x2="${X + 6}" y1="${ym}" y2="${ym}" class="ds-bar" opacity="${o}"/>`; }
      }
      // Where a day starts or ends, or a stretch out of service: a bar if it's the Center (a loop's always is: it
      // starts and ends its day there, the feed's cut on Main Street notwithstanding), a small ring if it's elsewhere.
      const cap = (si, m) => hubSi(si) || x.loop ? `<line x1="${X - 6}" x2="${X + 6}" y1="${y(m)}" y2="${y(m)}" class="ds-bar" opacity="${op}"/>` : `<circle cx="${X}" cy="${y(m)}" r="3.5" class="ds-ring" opacity="${op}"/>`;
      if (!prev || x.a - prev.b > 45) g += cap(x.from, x.a);
      if (!nx || nx.a - x.b > 45) g += cap(x.to, x.b);
      // Its route's number beside a run where the bus runs two (which lane is which), where there's room.
      const li = lanes.indexOf(familyKey(x.r));
      if (lanes.length > 1 && y(x.b) - y(x.a) > 26) g += `<text x="${li === 0 ? X - 6 : X + 6}" y="${y(x.a) + 13}" text-anchor="${li === 0 ? 'end' : 'start'}" fill="${ink(x.r)}" class="ds-num" opacity="${op}">${familyKey(x.r)}</text>`;
      g += `<a href="#/stop/${D.stops[x.link.si].id}?run=${x.link.ti}&amp;on=${ymd}" aria-label="${routeName(x.r)}, ${clockText(x.a)}"><rect x="${c * CW}" y="${y(x.a)}" width="${CW}" height="${Math.max(10, y(x.b) - y(x.a))}" fill="transparent"/></a>`;
    });
    // Out now: filled where the live feed has the bus, on whichever of its trips it's on; else a ring where the
    // timetable has a run of it on the road.
    if (nowY !== null) {
      const d = nowDot(b, live, clockNow.min, y, lx, on, past, 6);
      g += d.svg;
      if (d.dl !== null) g += `<text x="${d.X + 9}" y="${d.ly + 3}" class="ds-late">${d.dl > 0 ? '+' : '−'}${Math.abs(d.dl)}</text>`;
    }
    svg += `<g>${g}</g>`;
  });
  if (nowY !== null) { svg += `<line x1="0" x2="${W}" y1="${nowY}" y2="${nowY}" class="ds-now"/>`; axis += `<span class="ds-hr ds-nowt" style="top:${nowY}px">${clockShort(clockNow.min)}</span>`; }
  // Where it opens: at now; before the day's first bus, its start; after its last, its end.
  const at = nowY !== null ? nowY : clockNow.min > bot ? H : 0;
  // One box that scrolls both ways, the room under it high: its heads held at its top and its hours at its left by the
  // box itself (sticky), so the Center's name and its two views stay in sight above it.
  return html`<div class="daystrip" data-at="${at}">
    ${html.raw(keyLine(today))}
    <div class="ds-box"><div class="ds-in" style="width:${W + AX}px">
      <div class="ds-heads"><span class="ds-corner"></span><div class="ds-headrow" style="width:${W}px">${html.raw(heads)}</div></div>
      <div class="ds-body" style="height:${H}px"><div class="ds-axis">${html.raw(axis)}</div><svg width="${W}" height="${H}" aria-label="Every bus's day, a column a bus">${html.raw(svg)}</svg></div>
    </div></div></div>`;
}

/** Wired every draw: the box as tall as the room under it (a wide screen's panel, a phone's card as it rests); the
 *  day opened at now, a third of the way down, its place kept across the minute's redraws, and opened at now again
 *  when it's been a while (Back from a run's stops hours later). */
let kept = null;
export function mountStrip(el) {
  const s = el.querySelector('.daystrip');
  if (!s) return;
  // A route's day draws its towns once their outlines are here: fetched the first time one opens, then drawn again.
  if (s.classList.contains('routeday') && !townsReady()) loadTowns().then(ok => { if (ok) window.dispatchEvent(new Event('cr-towns')); });
  const box = s.querySelector('.ds-box');
  let sc = s.parentElement;
  while (sc && sc !== document.body && !(/auto|scroll/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement;
  const bottom = sc && sc !== document.body ? sc.getBoundingClientRect().bottom : innerHeight;
  box.style.height = Math.max(240, Math.round(bottom - box.getBoundingClientRect().top - 4)) + 'px';
  const keep = () => { kept = { key: location.hash, l: box.scrollLeft, t: box.scrollTop, at: Date.now() }; };
  if (!box._ds) { box._ds = true; box.addEventListener('scroll', keep, { passive: true }); }
  if (kept && kept.key === location.hash && Date.now() - kept.at < 90_000) { box.scrollLeft = kept.l; box.scrollTop = kept.t; keep(); return; }
  box.scrollLeft = 0;
  const hd = s.querySelector('.ds-heads'), headH = hd ? hd.offsetHeight : 0;
  box.scrollTop = Math.max(0, +s.dataset.at - (box.clientHeight - headH) / 3);
  keep();
}

// ---- Which day: to see ahead what a bus is going to do (the user: 'how can i go see what a bus is going to do
// saturday?'), a weekday or a Saturday as the timetable runs them, and each day in the next two weeks that runs
// otherwise, a case of its own ('weekday saturday. holidays/short days would be a special case'). Each its own address.
/** The days to pick from: a weekday and a Saturday (today, if it's one and runs as they do; else the next that does),
 *  then each day of the next 14 that doesn't run as its weekday does: by its holiday's name or its date. */
export function dayKinds(clockNow) {
  const ops = new Set(D.routes.filter(r => r.op).map(r => r.op.service));
  const regular = ymd => { const dow = (dayFrom(ymd).dow + 6) % 7; return [...D.services].filter(sv => sv.days[dow] && sv.start <= ymd && ymd <= sv.end).map(sv => sv.id).sort().join(); };
  const actual = ymd => [...servicesOn(ymd)].sort().join();
  const out = [], special = [];
  let wk = null, sat = null;
  for (let k = 0; k <= 14; k++) {
    const ymd = dayFrom(clockNow.ymd, k).ymd, dow = dayFrom(ymd).dow, reg = regular(ymd), act = actual(ymd);
    if (reg === act && !holidayOn(ymd)) {
      if (dow >= 1 && dow <= 5 && !wk) wk = ymd;
      if (dow === 6 && !sat) sat = ymd;
    } else if (reg) {
      const agencyOff = !agencyRuns(ymd), opsOff = !agencyOff && [...new Set(reg.split(','))].some(id => ops.has(id) && !act.split(',').includes(id));
      const name = holidayOn(ymd), date = fmtDay(ymd);
      special.push({ k: ymd, ymd, label: name || date, off: agencyOff,
        note: agencyOff ? '' : opsOff ? `${date}: no ${D.routes.filter(r => r.op && !act.split(',').includes(r.op.service)).map(r => routeName(D.routes.indexOf(r))).join(' or ')} that day.` : `${date} runs a different timetable from a usual ${dayName(ymd)}.` });
    }
  }
  if (wk) out.push({ k: 'wk', ymd: wk, label: 'Weekday' });
  if (sat) out.push({ k: 'sat', ymd: sat, label: 'Saturday' });
  return [...out, ...special];
}
/** The day asked for ('wk', 'sat' or a date), else today's kind: and the clock to draw it by, today's own, or another
 *  day's by the timetable alone (no now on it, nothing gone). */
export function dayPick(clockNow, on) {
  const days = dayKinds(clockNow), pick = days.find(d => d.k === on) || days.find(d => d.ymd === clockNow.ymd) || days[0] || { k: 'wk', ymd: clockNow.ymd, label: 'Weekday' };
  const today = pick.ymd === clockNow.ymd;
  return { days, pick, today, clk: today ? clockNow : { ...clockNow, ymd: pick.ymd, min: -1440 } };
}
export const dayRow = (days, pick, href) => html`<nav class="seg ds-days" aria-label="Day">${days.map(d => html`<a href="${href(d)}"${html.raw(d === pick ? ' aria-current="page"' : '')}>${d.label}</a>`)}</nav>`;
const keyLine = today => `<p class="ds-key">${today ? '<span class="ds-k"><i class="live"></i>Live</span><span class="ds-k"><i></i>Scheduled</span><span aria-hidden="true">·</span>' : ''}<span>Tap a run for its stops.</span></p>`;

// ---- A route's day: its buses down the day at 6 px a minute, the user's own scale ('i want route 1 to show 3 runs
// in a view'), the same on every route so a run's length never lies; the route page's second view. The road's plan:
// another operator's run on the route's road (the Preston commuter in the 16's midday) in its gap, in its column,
// in its colour, not joined to it (another bus). Runs of another route its bus runs between (a Saturday's 1, for the
// 9) thinner and faint, a step to them. Each run its route and start; its timed stops (where buses hold), by the
// place the route page names them, three at most; a route with three buses or more, its laps' Center departures and
// named timed stops only (a second opinion: bare times mid-lap said nothing), the names at an angle, whole (the user). A long gap with no bus on the road,
// one line. Opened at now, a third of the way down, as the user settled it.
const RPPM = 6, RGAP = 70;
// A key stop's name, the route page's own (heardName), short only as far as it stays one of a kind among the road's
// named stops (the user's rules, 2026-11-19, from GTFS and OSM alone): 'Across from' and the second of two names
// dropped; then the part in brackets ('LDS Tabernacle (Front)'); then the stop's own town at the front, and a 'City'
// after it ('Hyrum City Civic Center' to 'Civic Center'); last, for one still long, a sign's own abbreviations, never
// a made-up one. A stop and its other curb (its twin) are one place: no clash. With the towns drawn beside the line
// (the user's town highlighter, 2026-11-20), a name need only be one of a kind in its own town: 'LDS Church', 'Civic
// Center'.
const baseName = n => n.split(' / ')[0].replace(/^(Across from|Near)\s+/i, '').replace(/\((Across from|Near)\s+/gi, '(').trim();
const ABBR = [[/\bCenter\b/g, 'Ctr'], [/\bApartments\b/g, 'Apts'], [/\bDepartment\b/g, 'Dept'], [/\bMarketplace\b/g, 'Mkt']];
const abbr = n => n.length <= 18 ? n : ABBR.reduce((t, [re, w]) => t.replace(re, w), n);
const noBr = n => n.replace(/\s*\([^)]*\)/g, '').trim() || n.replace(/[()]/g, '');
const noTown = (n, town) => town && n.toLowerCase().startsWith(town.toLowerCase() + ' ') ? n.slice(town.length + 1).replace(/^City\s+/i, '') : n;
function shortNames(sis, inTown) {
  const all = [...new Set(sis)].filter(si => heardName(si).addr).map(si => ({ si, b: baseName(heardName(si).name), town: stop(si).town || '' }));
  const tw = si => parseInt(stop(si).twin), twin = (x, o) => tw(x.si) === o.si || tw(o.si) === x.si;
  const others = (x, f) => all.filter(o => o.b !== x.b && !twin(x, o) && (!inTown || o.town === x.town)).map(f);
  for (const x of all) { const c = noBr(x.b); x.c1 = others(x, o => noBr(o.b)).includes(c) || others(x, o => o.b).includes(c) ? x.b : c; }
  for (const x of all) { const c = noTown(x.c1, x.town); x.out = c !== x.c1 && (others(x, o => o.c1).includes(c) || others(x, o => noTown(o.c1, o.town)).includes(c) || others(x, o => o.b).includes(c)) ? x.c1 : c; }
  return new Map(all.map(x => [x.si, abbr(x.out)]));
}
const shortOf = new Map();   // a road's names, once
export function routeDay(ri0, clockNow, today = true) {
  const ymd = clockNow.ymd, nowMin = clockNow.min;
  const road = new Set([familyKey(ri0), ...corridor(ri0).map(familyKey)]), mineK = k => road.has(k);
  const towns = townsReady(), rk = [...road].sort().join() + (towns ? '/t' : '');
  if (!shortOf.has(rk)) shortOf.set(rk, shortNames(D.routes.flatMap((r, i) => road.has(familyKey(i)) ? Object.values(r.stops || {}).flat() : []), towns));
  const named = si => shortOf.get(rk).get(si) || heardName(si).name;
  const bs = busesOn(ymd).filter(b => b.keys.some(mineK));
  if (!bs.length) return '';
  const spans = b => b.runs.map(r => [r.a - 5, r.b + 5]);
  const clash = (p, q) => spans(p).some(([a, z]) => spans(q).some(([c, d]) => a < d && c < z));
  const slots = [];
  for (const b of bs.slice().sort((p, q) => (q.b - q.a) - (p.b - p.a))) { const s = slots.find(sl => sl.every(o => !clash(o, b))); if (s) s.push(b); else slots.push([b]); }
  slots.forEach(sl => sl.sort((p, q) => p.a - q.a)); slots.sort((p, q) => p[0].a - q[0].a);
  const many = slots.length >= 3;
  const top0 = Math.floor(Math.min(...bs.map(b => b.a)) / 60) * 60, bot = Math.ceil(Math.max(...bs.map(b => b.b)) / 60) * 60;
  const running = m => bs.some(b => b.runs.some(x => m >= x.a - 10 && m <= x.b + 10));
  const breaks = []; let s0 = null;
  for (let m = top0; m <= bot; m++) { const on = running(m); if (!on && s0 === null) s0 = m; if (on && s0 !== null) { if (m - s0 > 60) breaks.push([s0, m]); s0 = null; } }
  const y = m => { let v = (m - top0) * RPPM + 12; for (const [a, z] of breaks) { if (m >= z) v -= (z - a) * RPPM - RGAP; else if (m > a) v -= (m - a) * RPPM - (m - a) / (z - a) * RGAP; } return v; };
  const inBreak = m => breaks.some(([a, z]) => m > a + 15 && m < z - 15);
  const H = y(bot) + 16, t = m => ({ min: m, day: 0 }), past = m => isGone(t(m), clockNow), on = m => isDue(t(m), clockNow);
  const live = liveOn(today);
  const nowY = today && nowMin >= top0 && nowMin <= bot ? y(nowMin) : null;
  let axis = '';
  for (let m = top0; m <= bot; m += 60) if (!inBreak(m)) axis += `<span class="ds-hr" style="top:${y(m)}px">${clockShort(m)}</span><i class="rd-gl" style="top:${y(m)}px"></i>`;
  for (const [a, z] of breaks) axis += `<span class="rd-brk" style="top:${y(a) + RGAP / 2 - 10}px"><b>No bus ${clockShort(a)} to ${clockShort(z)}</b></span>`;
  if (nowY !== null) axis += `<span class="ds-hr ds-nowt" style="top:${nowY}px">${clockShort(nowMin)}</span><i class="rd-nl" style="top:${nowY}px"></i>`;
  const hub = si => si >= 0 && !!stop(si).hub;
  // A run's key stops: its timed stops (named ones, on a crowded route), spread across the whole run rather than its
  // first few, one for every 15 minutes of it (three at the least), kept 24px apart: a 16 run out to Preston names its
  // far towns, not three stops in its first 20 minutes (the town highlighter's mock, approved 2026-11-20).
  const keyStops = x => {
    const pts = x.trips.flatMap(ti => tripStops(ti)).filter(([mm, si]) => mm > x.a && mm < x.b && timed(si, x.r) && (!many || heardName(si).addr) && y(mm) >= y(x.a) + 44 && y(mm) <= y(x.b) - 16);
    const n = Math.max(3, Math.round((x.b - x.a) / 15)), out = [];
    for (let k = 0; k < n && pts.length; k++) {
      const want = x.a + (x.b - x.a) * (k + 0.5) / n;
      const q = pts.filter(p => out.every(o => o !== p && Math.abs(y(o[0]) - y(p[0])) >= 24)).sort((u, v) => Math.abs(u[0] - want) - Math.abs(v[0] - want))[0];
      if (q) out.push(q);
    }
    return out.sort((u, v) => u[0] - v[0]);
  };
  // The towns (the user's town highlighter, 2026-11-20): a soft stroke behind the line wherever the bus is in a town the
  // route serves (one where any of its named, timed stops is), out and back, from entering to leaving, its name
  // written up beside it; the Center's own town never. A pass under 2 minutes none (the 12 clipping Providence). Each
  // town named once a run, beside its own band where the name fits; where it doesn't, a town whose name tells two of
  // the run's stop names apart (Hyde Park's LDS Church on the 15) may run past its band and 12px into a neighbour's,
  // any other only into open road, 6px clear of every band.
  const marked = new Set(), needed = new Set(), mineRuns = bs.flatMap(b => b.runs).filter(x => mineK(familyKey(x.r)));
  if (towns) {
    for (const x of mineRuns) for (const ti of x.trips) for (const [, si] of tripStops(ti)) if (timed(si, x.r) && heardName(si).addr) { const tn = stopTown(si); if (tn && tn !== D.hub.town) marked.add(tn); }
    const byName = new Map();
    for (const [si, n] of shortOf.get(rk)) { const tn = stopTown(si); if (tn) (byName.get(n) || byName.set(n, new Set()).get(n)).add(tn); }
    for (const x of mineRuns) for (const [, si] of keyStops(x)) { const tn = stopTown(si); if (tn && (byName.get(named(si))?.size || 0) > 1) needed.add(tn); }
  }
  const townInk = routeTownInks(marked, '#' + D.routes[ri0].color);
  const bands = (x, X) => {
    const segs = [];
    // a town where one trip ends and the next begins (the 16 turning round in Preston) is one stay, the wait in it
    x.trips.forEach((ti, n) => { tripTowns(ti).forEach((g, i) => { const a = Math.max(g.a, x.a), b = Math.min(g.b, x.b); if (b < a) return; const l = segs[segs.length - 1]; if (l && l.t === g.t && (a - l.b <= 1 || (i === 0 && n > 0))) l.b = b; else segs.push({ t: g.t, a, b }); }); });
    const box = g => { const md = (y(g.a) + y(g.b)) / 2, hf = Math.max((y(g.b) - y(g.a)) / 2, 9); return { g, top: md - hf, bot: md + hf }; };
    const shown = segs.filter(g => marked.has(g.t) && g.b - g.a >= 2).map(box);
    let out = '', prevEnd = -1e9; const said = new Set();
    for (const { g, top, bot } of shown) {
      out += `<div class="rd-hl" style="top:${top}px;height:${bot - top}px;left:${X - 8}px;--town:${townInk.get(g.t)}"></div>`;
      if (said.has(g.t)) continue;
      const name = g.t.replace(/^N /, 'North ').replace(/,\s*[A-Z][a-z]+$/, ''), len = name.length * 6.2 + 4;
      let start = null;
      if (len <= bot - top + 6) { const st = Math.max((top + bot) / 2 - len / 2, prevEnd + 14); if (st + len <= bot + 6) start = st; }
      if (start === null) {
        const tol = needed.has(g.t) ? 12 : -6;
        const free = st => st >= prevEnd + 14 && shown.every(o => o.g === g || st + len <= o.top + tol || st >= o.bot - tol);
        for (const st of [(top + bot) / 2 - len / 2, bot - len, top]) if (free(st)) { start = st; break; }
      }
      if (start === null) continue;   // a short pass: its colour, no name
      said.add(g.t); prevEnd = start + len;
      out += `<span class="rd-town" style="top:${start}px;height:${len}px;left:${X - 21}px">${esc(name)}</span>`;
    }
    return out;
  };
  const cols = slots.map(sl => {
    const others = sl.some(b => b.keys.some(k => !mineK(k)));
    const LX = towns ? [24, 50] : [14, 40], lx = x => mineK(familyKey(x.r)) ? LX[0] : LX[1], left = (others ? LX[1] : LX[0]) + 16;
    let svg = '', lab = '';
    for (const b of sl) {
      b.runs.forEach((x, i) => {
        const p = b.runs[i - 1], nx = b.runs[i + 1], X = lx(x), m = mineK(familyKey(x.r)), op = (past(x.b) ? 0.45 : 1) * (m ? 1 : 0.35);
        const jIn = p && x.a - p.b <= 45 && lx(p) !== X, jOut = nx && nx.a - x.b <= 45 && lx(nx) !== X;
        svg += `<line x1="${X}" x2="${X}" y1="${y(x.a) + (jIn ? 6 : 0)}" y2="${Math.max(y(x.a) + 2, y(x.b) - (jOut ? 6 : 0))}" stroke="${ink(x.r)}" stroke-width="${m ? 6 : 4}" stroke-linecap="round" opacity="${op}"/>`;
        if (p) {
          const px = lx(p), o = past(x.a) ? 0.45 : 1;
          if (x.a - p.b > 45) {
            // out of service, dashed; broken where another bus has the road (its runs and its waits at the Center between)
            let a0 = p.b;
            const fills = sl.filter(q => q !== b).flatMap(q => q.runs.reduce((acc, r) => { const l = acc[acc.length - 1]; if (l && r.a - l.b <= 45) l.b = r.b; else acc.push({ a: r.a, b: r.b }); return acc; }, [])).filter(q => q.b > p.b && q.a < x.a).sort((u, v) => u.a - v.a);
            for (const q of [...fills, { a: x.a, b: x.a }]) { if (y(q.a) - 8 > y(a0) + 8) svg += `<line x1="${px}" x2="${X}" y1="${y(a0) + 8}" y2="${y(q.a) - 8}" class="ds-out"/>`; a0 = q.b; }
          } else if (jIn) { const ya = y(p.b) - 6, yb = y(x.a) + 6, ym = (ya + yb) / 2, d = Math.sign(X - px); svg += `<path d="M${px} ${ya}L${px} ${ym - 5}Q${px} ${ym} ${px + d * 5} ${ym}L${X - d * 5} ${ym}Q${X} ${ym} ${X} ${ym + 5}L${X} ${yb}" class="ds-step" opacity="${o}"/>`; }
          else { const yt = (y(p.b) + y(x.a)) / 2; svg += `<line x1="${X - 8}" x2="${X + 8}" y1="${yt}" y2="${yt}" class="ds-bar" opacity="${o}"/>`; }
        }
        // his round caps: a day that starts or ends away from the Center, and where
        const cap = (si, mm, w) => {
          if (hub(si) || x.loop) { svg += `<line x1="${X - 8}" x2="${X + 8}" y1="${y(mm)}" y2="${y(mm)}" class="ds-bar" opacity="${op}"/>`; return; }
          svg += `<circle cx="${X}" cy="${y(mm)}" r="5" class="ds-ring" opacity="${op}"/>`;
          lab += `<div class="rd-cap" style="top:${y(mm) + (w === 'from' ? -18 : 4)}px;left:${X + 12}px;opacity:${op}">${w} ${heardName(si).name}</div>`;
        };
        if (!p || x.a - p.b > 45) cap(x.from, x.a, 'from');
        if (!nx || nx.a - x.b > 45) cap(x.to, x.b, 'ends');
        const k = familyKey(x.r), name = opOf(x.r) ? D.routes[x.r].long.split(/\s/)[0] : k;
        lab += `<a class="rd-run${past(x.b) ? ' done' : ''}${m ? '' : ' other'}" href="#/stop/${D.stops[x.link.si].id}?run=${x.link.ti}&on=${ymd}" style="top:${y(x.a)}px;height:${Math.max(24, y(x.b) - y(x.a))}px;padding-left:${many ? LX[0] + 10 : left}px" aria-label="${routeName(x.r)}, ${clockText(x.a)}">${many ? '' : `<b style="color:${ink(x.r)}">${name}</b>`}<span>${clockShort(x.a)}</span></a>`;
        if (m && towns) lab += bands(x, X);
        if (m) {
          for (const [mm, si] of keyStops(x)) { svg += `<circle cx="${X}" cy="${y(mm)}" r="3" class="rd-dot" opacity="${op}"/>`; lab += `<div class="rd-ks${past(mm) ? ' past' : ''}" style="top:${y(mm) - 9}px;left:${many ? X + 4 : left}px">${many ? '' : `<span>${clockShort(mm)}</span> `}${named(si)}</div>`; }
        }
      });
      if (nowY !== null) {
        const d = nowDot(b, live, nowMin, y, lx, on, past, 8);
        svg += d.svg;
        if (d.dl !== null) lab += `<div class="rd-late" style="top:${d.ly - 9}px;left:${d.X + 12}px">${lateWords(d.dl)}</div>`;
      }
    }
    return `<div class="rd-col"><svg width="60" height="${H}">${svg}</svg>${lab}</div>`;
  }).join('');
  const at = nowY !== null ? nowY : today && nowMin > bot ? H : 0;
  return html`<div class="daystrip routeday" data-at="${at}">${html.raw(keyLine(today))}
    <div class="ds-box"><div class="rd-grid" style="height:${H}px"><div class="rd-axis">${html.raw(axis)}</div><div class="rd-cols${many ? ' many' : ''}">${html.raw(cols)}</div></div></div></div>`;
}
