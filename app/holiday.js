// The holidays' dressing (the art is views/holiday-art.js): Thanksgiving's garland and Christmas's lights over the
// map in their seasons, and on the day itself, the buses off, a card in place of the plain 'No buses today'. A rule
// on the date, every year, in the agency's own local dates and by the app's own clock (time.js now(), which a test's
// staged clock moves): nothing to take down after. Not the Pumpkin Walk's rule, which is its route's in the feed.
import { D, holidayOn, agencyRuns } from './data.js';
import { now, dayFrom, dayDiff, dayName, fmtDay, clockText } from './time.js';
import { html } from './ui.js';
import { DECO, DAY_ART, FLAKES } from './views/holiday-art.js';

/** The fourth Thursday of November in a year, as 'yyyymmdd'. */
function thanksgiving(year) {
  const first = dayFrom(year + '1101').dow, thu = 1 + (4 - first + 7) % 7 + 21;
  return year + '11' + String(thu).padStart(2, '0');
}
/** The season on a day: 'thanksgiving' the week of Thanksgiving, its Monday to the Sunday after (Aaron: 'should we do
 *  the full week?'), 'christmas' from 1 to 26 December, both ends kept (Aaron: 'gradually add more and more christmas
 *  stuff throughout the month': xmasStage); else null. Thanksgiving's week first, where it runs into December. */
export function holidaySeason(clockNow = now()) {
  const ymd = clockNow.ymd, y = ymd.slice(0, 4), md = ymd.slice(4);
  const tg = thanksgiving(y);
  if (ymd >= dayFrom(tg, -3).ymd && ymd <= dayFrom(tg, 3).ymd) return 'thanksgiving';
  if (md >= '1201' && md <= '1226') return 'christmas';
  return null;
}
/** What Christmas has put up by a day, a week at a time, as a list for app.css's [data-xmas~="…"]: the lights over
 *  the map from the 1st, snow on the Center's roofs and bays from the 8th, its tree and the buses' wreaths from the
 *  15th, presents under the tree from the 22nd. '' out of the season. */
export function xmasStage(clockNow = now()) {
  if (holidaySeason(clockNow) !== 'christmas') return '';
  const d = +clockNow.ymd.slice(6);
  return ['lights', d >= 8 && 'snow', d >= 15 && 'tree', d >= 22 && 'gifts'].filter(Boolean).join(' ');
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

/** The season on the page: data-season on the root, and Christmas's week by week (data-xmas, xmasStage), for app.css
 *  (the bus's wreath, the bays' snow) and the map (the Center's roofs and tree: a 'seasonchange' on the window when
 *  either changes), and the map's dressing over it, put in once a season (#hol-deco: over the map, under its buttons,
 *  search and card, never taking a tap). And any day of the year, the snow that falls over the map when it's
 *  snowing in Logan (#snow-deco, its own, in the same box: over the garland, the lights, or a day with neither;
 *  watchSnow). Asked at every draw, so a season, and each of Christmas's weeks, starts and ends by itself at
 *  midnight. */
export function dress(clockNow = now()) {
  const k = holidaySeason(clockNow), x = xmasStage(clockNow), root = document.documentElement;
  let changed = false;
  if ((root.dataset.season || null) !== k) { if (k) root.dataset.season = k; else delete root.dataset.season; changed = true; }
  if ((root.dataset.xmas || '') !== x) { if (x) root.dataset.xmas = x; else delete root.dataset.xmas; changed = true; }
  if (changed) window.dispatchEvent(new Event('seasonchange'));
  watchSnow();
  const m = document.getElementById('map');
  if (!m) return;
  let f = document.getElementById('snow-deco');
  if (!f) { f = document.createElement('div'); f.id = 'snow-deco'; f.setAttribute('aria-hidden', 'true'); f.innerHTML = FLAKES; m.append(f); }
  let d = document.getElementById('hol-deco');
  if (!k) { if (d) d.remove(); return; }
  if (d && d.dataset.s === k) return;
  if (!d) { d = document.createElement('div'); d.id = 'hol-deco'; d.setAttribute('aria-hidden', 'true'); m.insertBefore(d, f); }   // under the snow
  d.dataset.s = k;
  d.innerHTML = DECO[k];
}

// ---- Real snow (Aaron: 'track real snow weather all of december just for fun', 'use my relay, or we could use nws';
// then, it snowing in Logan as it shipped, any day it snows, all year, a holiday or not): while it's snowing in Logan,
// flakes fall over the map (data-snowing on the root, app.css). Asked on load, then every 15 minutes while the page is in sight, nothing about the rider sent. First the
// National Weather Service's latest observation at the Logan-Cache airport, if it's under 90 minutes old: snow of any
// kind is snow; precipitation it can't name ('UP': an automated station's, and the airport's often is snow) is snow at
// 0 °C or colder, and none above 3 °C. Anything else it says (clear, rain) is no snow. Only where it can't say (no
// answer, an old one, 'UP' between 0 and 3 °C) is Aaron's Open-Meteo relay asked, never Open-Meteo itself: snow
// falling there now, or a snow code. Neither answering is no snow, said nowhere.
export const NWS_URL = 'https://api.weather.gov/stations/KLGU/observations/latest';
export const RELAY_URL = 'https://om.aarobh.net/v1/forecast?latitude=41.737&longitude=-111.834&current=snowfall,weather_code,temperature_2m';
const SNOWS = new Set(['snow', 'snow_showers', 'snow_grains', 'blowing_snow', 'ice_pellets']);
const SNOW_CODES = new Set([71, 72, 73, 74, 75, 76, 77, 85, 86]);
const EVERY = 15 * 60e3;
/** The weather service's word on an observation (its `properties`) at a time (ms): true snowing, false not, null
 *  it can't say (none, over 90 minutes old, or 'UP' between 0 and 3 °C), for the relay to say. */
export function nwsSnowing(p, at = Date.now()) {
  if (!p || !(at - Date.parse(p.timestamp) < 90 * 60e3)) return null;
  const w = (p.presentWeather || []).map(x => x && x.weather), t = p.temperature && p.temperature.value;
  if (w.some(x => SNOWS.has(x))) return true;
  if (!w.includes('unknown')) return false;
  return t == null ? null : t <= 0 ? true : t > 3 ? false : null;
}
/** The relay's word (Open-Meteo's answer, its `current`): snow falling, or a snow code (71 to 77, 85, 86). */
export const relaySnowing = c => !!c && (c.snowfall > 0 || SNOW_CODES.has(c.weather_code));
const ask = async url => {
  const r = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout ? AbortSignal.timeout(10_000) : undefined });
  if (!r.ok) throw new Error(r.status);
  return r.json();
};
let snowTimer = null, askedAt = 0;
async function askSnow() {
  askedAt = Date.now();
  let on = null;
  try { on = nwsSnowing((await ask(NWS_URL)).properties); } catch { /* the relay, then */ }
  if (on === null) try { on = relaySnowing((await ask(RELAY_URL)).current); } catch { /* no snow, then */ }
  const root = document.documentElement;
  if (on === true) root.dataset.snowing = ''; else delete root.dataset.snowing;
}
const looked = () => { if (!document.hidden && Date.now() - askedAt >= EVERY) askSnow(); };
/** The asking started once, at the first draw: asked then and every 15 minutes after, out of sight nothing asked, and
 *  back in sight after a quarter of an hour or more, asked again at once. */
function watchSnow() {
  if (snowTimer) return;
  snowTimer = setInterval(() => { if (!document.hidden) askSnow(); }, EVERY);
  document.addEventListener('visibilitychange', looked);
  if (!document.hidden) askSnow();
}
