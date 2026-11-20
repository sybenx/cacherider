// The holidays' dressing (the art is views/holiday-art.js): Thanksgiving's garland and Christmas's lights over the
// map in their seasons, and on the day itself, the buses off, a card in place of the plain 'No buses today'. A rule
// on the date, every year, in the agency's own local dates and by the app's own clock (time.js now(), which a test's
// staged clock moves): nothing to take down after. Not the Pumpkin Walk's rule, which is its route's in the feed.
import { D, holidayOn, agencyRuns } from './data.js';
import { now, dayFrom, dayDiff, dayName, fmtDay, clockText } from './time.js';
import { html } from './ui.js';
import { DECO, DAY_ART } from './views/holiday-art.js';

/** The fourth Thursday of November in a year, as 'yyyymmdd'. */
function thanksgiving(year) {
  const first = dayFrom(year + '1101').dow, thu = 1 + (4 - first + 7) % 7 + 21;
  return year + '11' + String(thu).padStart(2, '0');
}
/** The season on a day: 'thanksgiving' the week of Thanksgiving, its Monday to the Sunday after (Aaron: 'should we do
 *  the full week?'), 'christmas' from 14 to 26 December, both ends kept; else null. */
export function holidaySeason(clockNow = now()) {
  const ymd = clockNow.ymd, y = ymd.slice(0, 4), md = ymd.slice(4);
  const tg = thanksgiving(y);
  if (ymd >= dayFrom(tg, -3).ymd && ymd <= dayFrom(tg, 3).ymd) return 'thanksgiving';
  if (md >= '1214' && md <= '1226') return 'christmas';
  return null;
}

/** The day itself, the agency's buses off and its timetable naming the day: 'thanksgiving' or 'christmas', else null.
 *  The day after Thanksgiving too, when the buses are off that day as well (the feed of 2026 took it off). */
export function holidayDay(ymd) {
  if (agencyRuns(ymd)) return null;
  const name = holidayOn(ymd);
  return name === 'Thanksgiving Day' || dayAfter(ymd) ? 'thanksgiving' : name === 'Christmas Day' ? 'christmas' : null;
}
const dayAfter = ymd => holidayOn(dayFrom(ymd, -1).ymd) === 'Thanksgiving Day';
const GREETING = { thanksgiving: 'Happy Thanksgiving!', christmas: 'Merry Christmas!' };

/** The day's card, or '' on any other day: its drawing, 'No buses today', why ('Connect doesn't run on Thanksgiving
 *  Day.', offDayWords) and the greeting, then when the buses are back, from the timetable: `back` the first departure
 *  after today ({ ymd, min }: the Center's first pulse, a stop's first bus), `what` its words ('first pulse'), `more`
 *  anything else to say under it. */
export function dayCard(clockNow, why, back, what, more = '') {
  const k = holidayDay(clockNow.ymd);
  if (!k) return '';
  if (dayAfter(clockNow.ymd)) why = `${D.agency.brand} doesn't run on the day after Thanksgiving.`;   // not 'on Friday, November 27'
  const day = back ? (dayDiff(clockNow.ymd, back.ymd) < 7 ? dayName(back.ymd) : fmtDay(back.ymd, true)) : '';   // 'Back Friday'; a week or more off, its date
  return html`<div class="holcard hol-${k}">${html.raw(DAY_ART[k])}<div class="holcard-text"><b class="holcard-h">No buses today</b><p>${why} ${GREETING[k]}</p>${back ? html`<div class="holcard-back"><span>Back ${day} · ${what}</span><b>${clockText(back.min)}</b></div>` : ''}${more}</div></div>`;
}

/** The season on the page: data-season on the root, for app.css (the bus's wreath, the bays' snow), and the map's
 *  dressing over it, put in once a season (#hol-deco: over the map, under its buttons, search and card, never taking
 *  a tap). Asked at every draw, so a season starts and ends by itself at midnight. */
export function dress(clockNow = now()) {
  const k = holidaySeason(clockNow), root = document.documentElement;
  if ((root.dataset.season || null) !== k) { if (k) root.dataset.season = k; else delete root.dataset.season; }
  const m = document.getElementById('map');
  if (!m) return;
  let d = document.getElementById('hol-deco');
  if (!k) { if (d) d.remove(); return; }
  if (d && d.dataset.s === k) return;
  if (!d) { d = document.createElement('div'); d.id = 'hol-deco'; d.setAttribute('aria-hidden', 'true'); m.append(d); }
  d.dataset.s = k;
  d.innerHTML = DECO[k];
}
