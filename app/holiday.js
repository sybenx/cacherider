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
// then, it snowing in Logan as it shipped, any day it snows, all year, a holiday or not; then, the airport's reports
// missing snow falling in town, 'maybe we should just make it snow all day on days whenever there was snow that day'):
// from the first report of snow in Logan on a day until its midnight, flakes fall over the map (data-snowing on the
// root, app.css). Asked on load, then every 15 minutes while the page is in sight, nothing about the rider sent. First
// the National Weather Service's observations at the Logan-Cache airport since the day's midnight: snow of any kind is
// snow; precipitation it can't name ('UP': an automated station's, and the airport's often is snow) is snow at 0 °C or
// colder. Only where it can't say (no answer, nothing under 90 minutes old, 'UP' between 0 and 3 °C, and no snow yet
// that day) is Aaron's Open-Meteo relay asked, never Open-Meteo itself: snow falling there now, or a snow code; its
// snow, once said, kept for the rest of the day too. Neither answering is no snow, said nowhere.
export const NWS_URL = 'https://api.weather.gov/stations/KLGU/observations';
export const RELAY_URL = 'https://om.aarobh.net/v1/forecast?latitude=41.737&longitude=-111.834&current=snowfall,weather_code,temperature_2m';
const SNOWS = new Set(['snow', 'snow_showers', 'snow_grains', 'blowing_snow', 'ice_pellets']);
const SNOW_CODES = new Set([71, 72, 73, 74, 75, 76, 77, 85, 86]);
const EVERY = 15 * 60e3;
/** How hard it's snowing, in the weather service's words or the relay's: 'light', 'moderate' or 'heavy'. The app
 *  shows more flakes, falling further down the map, the harder it snows (Aaron: 'light moderate and heavy would be
 *  interesting'). */
const LEVELS = ['light', 'moderate', 'heavy'];
/** One observation's word (its `properties`): how hard it's snowing ('light', 'moderate', 'heavy': its intensity, none
 *  given being moderate; 'UP' at 0 °C or colder light, as it can't say), false not snowing, null it can't say ('UP'
 *  between 0 and 3 °C, or with no temperature). */
function says(p) {
  const ws = (p.presentWeather || []).filter(Boolean), t = p.temperature && p.temperature.value;
  const snow = ws.filter(x => SNOWS.has(x.weather));
  if (snow.length) return LEVELS[Math.max(...snow.map(x => x.intensity === 'light' ? 0 : x.intensity === 'heavy' ? 2 : 1))];
  if (!ws.some(x => x.weather === 'unknown')) return false;
  return t == null ? null : t <= 0 ? 'light' : t > 3 ? false : null;
}
/** The weather service's word on the day's observations so far (their `properties`, any order) at a time (ms): the
 *  newest's level while it says snow (if it's under 90 minutes old); else, any of the day's having said snow, light,
 *  till midnight (on 20 Nov 2026, snowing in town, the airport said 'Light Snow' till 12:24 and then nothing that
 *  named it); else the newest's word, false or null (none, old, or 'UP' between 0 and 3 °C) for the relay to say. */
export function nwsSnowing(list, at = Date.now()) {
  const ps = (Array.isArray(list) ? list : [list]).filter(p => p && p.timestamp).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const p = ps[0], fresh = !!p && at - Date.parse(p.timestamp) < 90 * 60e3;
  const now = fresh ? says(p) : null;
  if (LEVELS.includes(now)) return now;
  if (ps.some(q => LEVELS.includes(says(q)))) return 'light';
  return now;
}
/** The relay's word (Open-Meteo's answer, its `current`) at a time (ms): how hard by its snow code (71, 77 and 85
 *  light, 73 moderate, 75 and 86 heavy), or light where snow is falling under some other code; else false. An answer
 *  over 90 minutes old, or with no time, is no snow (on 20 Nov 2026 the relay served one 3 h 40 min old). */
export function relaySnowing(c, at = Date.now()) {
  if (!c || !c.time) return false;
  const t = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(c.time) ? c.time : c.time + 'Z');   // Open-Meteo's GMT, no zone
  if (!(at - t < 90 * 60e3)) return false;
  const k = c.weather_code;
  if (k === 75 || k === 86) return 'heavy';
  if (k === 73) return 'moderate';
  if (SNOW_CODES.has(k) || c.snowfall > 0) return 'light';
  return false;
}
const ask = async url => {
  const r = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout ? AbortSignal.timeout(10_000) : undefined });
  if (!r.ok) throw new Error(r.status);
  return r.json();
};
/** The day the relay last said snow ('yyyymmdd'), kept on the device so a page opened again that day still snows. */
const RELAY_DAY = 'cr-relay-snow-day';
const relayDay = () => { try { return localStorage.getItem(RELAY_DAY); } catch { return null; } };
let snowTimer = null, askedAt = 0;
async function askSnow() {
  askedAt = Date.now();
  const c = now(), day = c.ymd, midnight = new Date(Math.floor(Date.now() / 60e3) * 60e3 - c.min * 60e3).toISOString().replace(/\.\d+Z$/, 'Z');
  let on = null;
  try { on = nwsSnowing(((await ask(`${NWS_URL}?start=${midnight}`)).features || []).map(f => f && f.properties).filter(p => p && p.timestamp && now(new Date(p.timestamp)).ymd === day)); } catch { /* the relay, then */ }
  if (on === null || (on === false && relayDay() === day)) {
    let r = null;
    if (on === null) try { r = relaySnowing((await ask(RELAY_URL)).current); } catch { /* no snow, then */ }
    if (LEVELS.includes(r)) { try { localStorage.setItem(RELAY_DAY, day); } catch { /* this page only */ } on = r; }
    else on = relayDay() === day ? 'light' : false;
  }
  const root = document.documentElement;
  if (LEVELS.includes(on)) root.dataset.snowing = on; else delete root.dataset.snowing;
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
