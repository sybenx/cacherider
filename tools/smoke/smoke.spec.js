// Every flow in the app, one test a flow, at a phone's size and a desktop's, or at the one size where the two draw it
// the same (PHONE, WIDE; playwright.config.js). Each checks that its screens come up and that nothing on the way said
// 'Something went wrong' or threw. The timetable is the real feed's, whatever the day; a check that needs a bus out or a
// notice up stages one (the relay's answer made up), so it runs whatever the hour.
// Run: npm test (here), or tools/hooks/pre-push before every push. On this machine only, never on GitHub.
const { test: base, expect } = require('@playwright/test');

// Errors a page raised, and console errors that aren't a network miss (the relay or a tile now and then).
const test = base.extend({
  page: async ({ page }, use) => {
    // The ask to test the Android app atop home (an Android phone's browser, as the phone project's is) put away, so the
    // other tests' pages are as they were; its own test brings it back.
    await page.addInitScript(() => { try { localStorage.setItem('cr-test-shut', '1'); } catch { /* storage refused */ } });
    // The map's own object as window.__map, taken at its first look at a source (the app keeps it to itself): what it
    // shows, and whether it's still moving, for a test to read. MapLibre's the app's own copy, loaded early.
    await page.addInitScript(() => { if (/^http/.test(location.protocol)) import('/vendor/maplibre-gl.mjs').then(m => { const g = m.Map.prototype.getSource; m.Map.prototype.getSource = function (id) { window.__map = this; return g.call(this, id); }; }).catch(() => {}); });
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_|status of [45]\d\d/.test(m.text())) errs.push('console: ' + m.text()); });
    page.errs = errs;
    // The real snow (holiday.js) asks the weather service, and where it can't say, the relay: never the real
    // ones from a test. Turned away unless a test answers them itself (its own route, made later, is asked first).
    await page.route(/^https:\/\/(api\.weather\.gov|om\.aarobh\.net)\//, r => r.abort());
    await use(page);
    expect(errs, 'errors on the page').toEqual([]);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  },
});

const phone = info => info.project.name === 'phone';
// A test whose screens are the same at either size runs at one (playwright.config.js: each project leaves out the
// other's tag): a phone's, where riders are, or a desktop's, where a page beside the map draws quicker; or where only
// one size has what it checks (a phone's card over the map, a wide screen's panel). Untagged, both.
const PHONE = { tag: '@phone' }, WIDE = { tag: '@desktop' };
/** The app opened at an address, its data in. */
async function open(page, hash = '#/') {
  await page.goto('/' + hash);
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
}
/** An address within the open app, as a link would take it. */
async function go(page, hash) { await page.evaluate(h => { location.hash = h; }, hash); }
/** The map drawn and settled. */
async function mapReady(page) {
  await page.waitForSelector('#map canvas');
  await page.waitForFunction(() => document.querySelectorAll('.maplibregl-marker').length > 0 || document.querySelector('#mapcard.open'), null, { timeout: 20_000, polling: 500 }).catch(() => {});
  await settled(page);
}
/** The map still: no flight, zoom or pan under way, four looks in a row a tenth of a second apart (a page that starts
 *  a flight a moment after it draws, as the directions' frame does a third of a second on, has started it by then).
 *  It was a flat 800 ms, too long on an idle machine and on a busy one now and then too short. */
async function settled(page) {
  await page.evaluate(() => { window.__still = 0; });
  await page.waitForFunction(() => { const m = window.__map; window.__still = m && !m.isMoving() ? window.__still + 1 : 0; return window.__still >= 4; }, null, { polling: 100, timeout: 10_000 }).catch(() => {});
}
/** Once the feed's next `n` ticks have come (every five seconds, answered or not) and the page been drawn again with
 *  each: rt.js's listeners, main.js's redraw the first of them and this one's after it, then a frame for it to show.
 *  Waited for by the clock, a tick or two was seven seconds, or twelve. */
/** The clock staged at noon on the next day the agency's buses run (today's, if they do), the app opened again on it:
 *  for a test that waits on the feed's ticks. Out of hours the feed's asked every two minutes, not every five seconds
 *  (rt.js busesDue), and a push after midnight timed out waiting for two. */
async function inBusHours(page) {
  const at = await page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now();
    for (let k = 0; k < 8; k++) if (d.agencyRuns(t.dayFrom(c.ymd, k).ymd)) return Date.now() + ((k * 1440 + 720 - c.min) * 60 - c.sec) * 1000;
    return null;
  });
  if (!at) return;
  await page.clock.setFixedTime(new Date(at));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
}
async function nextTick(page, n = 1) {
  const at = await page.evaluate(async () => { if (window.__ticks === undefined) { window.__ticks = 0; (await import('/app/rt.js')).onRt(() => { window.__ticks++; }); } return window.__ticks; });
  await page.waitForFunction(k => window.__ticks >= k, at + n, { polling: 100, timeout: 20_000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
/** Where an element on the map is once the map has stopped moving under it (a flight to it ended): its box, read
 *  again until two reads a quarter second apart agree. */
async function still(loc) {
  let a = await loc.boundingBox();
  for (let i = 0; i < 20; i++) {
    await loc.page().waitForTimeout(250);
    const b = await loc.boundingBox();
    if (a && b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1) return b;
    a = b;
  }
  return a;
}
/** A Connect bus on the map, once the live feed has placed one (up to 15 s); null when none is out. One alone at its
 *  spot: a tap on buses at one spot (+N, the others hidden under it) zooms in till they part, no card. */
async function someBus(page) {
  const bus = page.locator('.maplibregl-marker.bus:not(.shuttle):not(.stacked):not(:has(> .bus-n))').first();
  try { await bus.waitFor({ state: 'attached', timeout: 15_000 }); return bus; } catch { return null; }
}
/** A real stop's id, from the home page's rows. */
async function someStop(page) {
  await go(page, '#/');
  const a = page.locator('a[href^="#/stop/"]').filter({ visible: true }).first();
  await expect(a).toBeVisible();
  return (await a.getAttribute('href')).replace('#/stop/', '').split('?')[0];
}
/** A test's pick of a trip today (`pick()`, by the app's clock, time.js now()), or where today has none to make it of
 *  (a Sunday, a holiday, a Saturday without that route), of the next day that has, in the week ahead: the clock staged
 *  then, this time of day, and the app opened again on it. A push on a Sunday checked none of them. Null when no day
 *  in the week has one. */
async function onBusDay(page, pick) {
  const at = await page.evaluate(() => Date.now());
  for (let k = 0; k < 8; k++) {
    if (k) await page.clock.setFixedTime(new Date(at + k * 864e5));
    const p = await pick();
    if (!p) continue;
    if (k) { await page.reload(); await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 }); }
    return p;
  }
  return null;
}

test('home: the Center line, the shuttle line, the routes', async ({ page }, info) => {
  await open(page);
  await expect(page.locator('a[href="#/hub"]').filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('a[href="#/map/usu"]')).toBeVisible();
  if (phone(info)) await expect(page.locator('a[href="#/routes"]')).toBeVisible();
  else await expect(page.locator('a[href^="#/map/route/"]').filter({ visible: true }).first()).toBeVisible();   // wide: the chips
  await expect(page.getByRole('link', { name: /Settings & about/ })).toBeVisible();
});

test('home: a detour at one of your stops, at the top', PHONE, async ({ page }) => {
  // A stop a notice in force names, saved: the notice staged (Connect's come and go, and with none up this checked
  // nothing).
  const id = await stageClosure(page);
  await page.evaluate(id => localStorage.setItem('cr-saved', JSON.stringify([id])), id);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  const row = page.locator('.mine-row').filter({ visible: true }).first();
  await expect(row).toContainText('one of your stops');
  await row.click();
  await expect(page).toHaveURL(new RegExp('#/stop/' + id));
});

test('a stop out of the timetable: its page, saved, at the top of home', PHONE, async ({ page }) => {
  await open(page);
  // One kept out (tools/gone.py: a detour's, while a notice names it and a week after), if any are.
  const id = await page.evaluate(async () => { const d = await import('/app/data.js'); const s = d.D.stops.find(s => s.out); return s ? s.id : null; });
  test.skip(!id, 'no stop is out of the timetable');
  await go(page, '#/stop/' + id);
  await expect(page.getByText(/No buses stop here/).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/out of .+ timetable for now/).filter({ visible: true }).first()).toBeVisible();
  const nearest = page.locator('.callout.alert a[href^="#/stop/"]').filter({ visible: true }).first();
  if (await nearest.count()) { await nearest.click(); await expect(page).not.toHaveURL(new RegExp('#/stop/' + id + '$')); }
  await page.evaluate(i => localStorage.setItem('cr-saved', JSON.stringify([i])), id);
  await go(page, '#/');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await expect(page.locator('.mine-row').filter({ visible: true }).first()).toContainText(/No buses stop at .+ one of your stops/);
});

test('a stop\'s row for a loop\'s next lap says where its bus is now, still on the lap before, and how many stops away', WIDE, async ({ page }) => {
  // The user, at 995 South Main: 'my issue is also knowing which blue loop will get there at that time. so if the blue
  // is sitting at ITC, or if it's driving by north walmart'. Staged: a loop's lap today and the lap after it in the same
  // run, the clock a minute before the lap's third call, its bus between its second and third stops; a stop five calls
  // into the next lap.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  await open(page);
  const pick = await onBusDay(page, () => page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), loops = d.D.hub.loops || [];
    for (const ri of loops) for (const [si] of d.D.stops.entries()) for (const row of d.timesOn(si, c.ymd).filter(x => x.r === ri)) {
      const nx = d.nextTrip(row.trip, c.ymd);
      if (nx === undefined || !d.runOf(row.trip, c.ymd).includes(nx)) continue;
      const st = d.tripStops(row.trip), sn = d.tripStops(nx);
      if (st.length < 8 || sn.length < 8 || st[0][0] < 360 || sn[sn.length - 1][0] > 1300) continue;
      const k = sn[5][1], mine = d.D.stops[k];
      if (mine.hub || sn.slice(0, 5).some(x => x[1] === k) || st.some(x => x[1] === k)) continue;
      const a = d.D.stops[st[1][1]], b = d.D.stops[st[2][1]];
      if (d.distance(a.lat, a.lon, b.lat, b.lon) < 200) continue;
      return { id: d.D.trips[row.trip], nid: d.D.trips[nx], sn: sn.map(([m, x]) => [m, d.D.stops[x].id]), st: st.map(([m, x]) => [m, d.D.stops[x].id]), stop: mine.id, next: b.name, by: b.by || '', hub: !!b.hub,
        mid: [(a.lat + b.lat) / 2, (a.lon + b.lon) / 2], at: Date.now() + ((st[2][0] - 1 - c.min) * 60 + 30 - c.sec) * 1000, ahead: st.length - 2 + 5 };
    }
    return null;
  }));
  test.skip(!pick, 'no loop running two laps in a row this week');
  await page.clock.setFixedTime(new Date(pick.at));
  const T = Math.floor(pick.at / 1000), base = T - 30 - (pick.st[2][0] - 1) * 60;
  // the feed's word on the lap after too, its bus still on this one (as Connect's feed has it)
  feed = { t: T, trips: { [pick.id]: { v: '9002', ts: T, s: pick.st.slice(2).map(([m, sid], i) => [sid, i + 2, base + m * 60, 0]) },
    [pick.nid]: { v: '9002', ts: T, s: pick.sn.map(([m, sid], i) => [sid, i, base + m * 60, 0]) } },
    buses: [{ id: '9002', label: '9002', trip: pick.id, lat: pick.mid[0], lon: pick.mid[1], bearing: 0, speed: 5, ts: T }] };
  await page.reload();
  await go(page, '#/stop/' + pick.stop);
  const tag = page.locator('.row .livetag, .row .sched').filter({ hasText: 'stops away' }).filter({ visible: true }).first();
  await expect(tag).toBeVisible({ timeout: 20_000 });
  const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await expect(tag).toContainText(new RegExp(' · by ' + esc(pick.hub ? 'the Transit Center' : pick.by || pick.next) + ' · \\d+ stops away'));
  const n = +(await tag.textContent()).match(/(\d+) stops away/)[1];
  expect(n).toBeGreaterThan(pick.ahead - 4);   // its lap's stops still to come and this lap's up to here (a stop a notice closes not counted)
  expect(n).toBeLessThanOrEqual(pick.ahead + 1);
});

test('a stop\'s row says where its bus is while it\'s still out as the route it runs just before (a Saturday\'s 3, then the 8)', WIDE, async ({ page }) => {
  // The user's block: 'the uninterrupted string of travel where a rider can remain on the bus'. On a Saturday a bus
  // swaps routes at the Transit Center every run, and a stop's row lost its bus while it ran the other route. Staged:
  // the next Saturday, a trip that carries on as another route, the clock a minute before its third call, its bus
  // between its second and third stops; a stop five calls into the trip after.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  const sat = new Date(); sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7)); sat.setHours(12, 0, 0, 0);
  await page.clock.setFixedTime(sat);
  await open(page);
  const pick = await page.evaluate(async () => {
    const d = await import('/app/data.js'), u = await import('/app/ui.js'), t = await import('/app/time.js'), c = t.now();
    for (const [si] of d.D.stops.entries()) for (const row of d.timesOn(si, c.ymd)) {
      const nx = d.nextTrip(row.trip, c.ymd), nr = nx !== undefined ? d.tripRoute(nx) : null;
      if (!nr || nr.r === row.r || !d.staysOn(row.trip, nx)) continue;
      const st = d.tripStops(row.trip), sn = d.tripStops(nx);
      if (st.length < 8 || sn.length < 8 || st[0][0] < 360 || sn[sn.length - 1][0] > 1300) continue;
      const k = sn[5][1], mine = d.D.stops[k];
      if (mine.hub || sn.slice(0, 5).some(x => x[1] === k) || st.some(x => x[1] === k)) continue;
      const a = d.D.stops[st[1][1]], b = d.D.stops[st[2][1]];
      if (d.distance(a.lat, a.lon, b.lat, b.lon) < 200) continue;
      return { id: d.D.trips[row.trip], nid: d.D.trips[nx], sn: sn.map(([m, x]) => [m, d.D.stops[x].id]), st: st.map(([m, x]) => [m, d.D.stops[x].id]), stop: mine.id, next: b.name, by: b.by || '', hub: !!b.hub,
        on: u.routeName(row.r), head: d.bearing(a.lat, a.lon, b.lat, b.lon), mid: [(a.lat + b.lat) / 2, (a.lon + b.lon) / 2], at: Date.now() + ((st[2][0] - 1 - c.min) * 60 + 30 - c.sec) * 1000, ahead: st.length - 2 + 5 };
    }
    return null;
  });
  test.skip(!pick, 'no bus swaps routes that Saturday');
  await page.clock.setFixedTime(new Date(pick.at));
  const T = Math.floor(pick.at / 1000), base = T - 30 - (pick.st[2][0] - 1) * 60;
  feed = { t: T, trips: { [pick.id]: { v: '9003', ts: T, s: pick.st.slice(2).map(([m, sid], i) => [sid, i + 2, base + m * 60, 0]) },
    [pick.nid]: { v: '9003', ts: T, s: pick.sn.map(([m, sid], i) => [sid, i, base + m * 60, 0]) } },
    buses: [{ id: '9003', label: '9003', trip: pick.id, lat: pick.mid[0], lon: pick.mid[1], bearing: pick.head, speed: 5, ts: T }] };   // headed along its leg, or its place and the feed's word disagree (rt.js agrees)
  await page.reload();
  await go(page, '#/stop/' + pick.stop);
  const tag = page.locator('.row .livetag, .row .sched').filter({ hasText: 'stops away' }).filter({ visible: true }).first();
  await expect(tag).toBeVisible({ timeout: 20_000 });
  const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await expect(tag).toContainText(new RegExp(' · still on ' + esc(pick.on) + ' · by ' + esc(pick.hub ? 'the Transit Center' : pick.by || pick.next) + ' · \\d+ stops away'));
  const n = +(await tag.textContent()).match(/(\d+) stops away/)[1];
  expect(n).toBeGreaterThan(pick.ahead - 4);
  expect(n).toBeLessThanOrEqual(pick.ahead + 1);
});

test('a Saturday route whose bus is another route\'s too carries its line on into that route at the foot, from the timetable alone', WIDE, async ({ page }) => {
  // The user: 'why not base it more on our route page, with like the continue into the next route at the bottom?'. Said
  // once, there (it was at the top, the foot, a list under it and a page of its own: 'saying the same thing twice in
  // multiple places for no reason'). No bus out (the feed refused): the timetable's blocks say it. A weekday's route,
  // its bus its own all day, has none.
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => r.abort());
  const sat = new Date(); sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7)); sat.setHours(12, 0, 0, 0);
  await page.clock.setFixedTime(sat);
  await open(page);
  const pick = await page.evaluate(async () => {
    const d = await import('/app/data.js'), u = await import('/app/ui.js'), t = await import('/app/time.js'), c = t.now();
    for (const [ri, r] of d.D.routes.entries()) { const sw = d.swapsOn(ri, c.ymd); if (sw.to !== null && sw.from !== null) return { short: r.short, to: u.routeName(sw.to), toShort: d.D.routes[sw.to].short }; }
    return null;
  });
  test.skip(!pick, 'no bus swaps routes that Saturday');
  await go(page, '#/map/route/' + encodeURIComponent(pick.short) + '?day=0');
  const on = page.locator('.section.onward').filter({ visible: true });
  await expect(on).toHaveCount(1);
  await expect(on).toContainText('This bus becomes ' + pick.to + ' at ');
  const carry = page.locator('.rs-carry').filter({ visible: true });
  expect(await carry.locator('.croute').count()).toBeGreaterThan(3);   // the next route's stops, after this one's
  // The seam drawn, not an icon: this route's rail on through the line that says it, a step over, the carry's rail
  // a step to the right of this one's.
  await expect(on).toHaveClass(/\bjog\b/);
  await expect(on.locator('svg')).toHaveCount(0);
  const rails = await page.evaluate(() => {
    const on = [...document.querySelectorAll('.section.onward.jog')].find(e => e.offsetParent), up = on.previousElementSibling, down = on.nextElementSibling;
    const rail = e => parseFloat(getComputedStyle(e).backgroundPositionX) + e.getBoundingClientRect().left;
    return { into: up.classList.contains('into'), up: rail(up.lastElementChild), down: rail(down.firstElementChild) };
  });
  expect(rails.into).toBe(true);
  expect(rails.down - rails.up).toBeCloseTo(12, 0);
  await expect(page.locator('a.rs-swap, .rs-buses')).toHaveCount(0);   // and nowhere else on the page
  const mon = new Date(sat); mon.setDate(mon.getDate() + 2);
  await page.clock.setFixedTime(mon);
  await page.reload();
  await go(page, '#/map/route/' + encodeURIComponent(pick.short));
  await expect(page.locator('.rs-list').filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('.section.onward, .rs-carry')).toHaveCount(0);
});

test('the Transit Center\'s day: every bus a column, opened at now, a run a tap into its stops, a head a way to its route\'s day', async ({ page }) => {
  // The user's block-strip mockup, 'my favorite part': the Center's second view, not a page of its own. A Saturday at
  // 12:40, the feed refused: the timetable's alone.
  await page.route(/^https:\/\/live\.cacherider\.com\//, r => r.abort());
  const sat = new Date(); sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7)); sat.setHours(12, 40, 0, 0);
  await page.clock.setFixedTime(sat);
  await open(page, '#/hub');
  const n = await page.evaluate(async () => { const s = await import('/app/views/strip.js'), t = await import('/app/time.js'); return s.busesOn(t.now().ymd).length; });
  test.skip(!n, 'no buses that Saturday');
  const day = page.locator('.tcl-views a', { hasText: 'All day' }).filter({ visible: true }).first();
  await day.click();
  await expect(page).toHaveURL(/#\/hub\?day=1$/);
  const strip = page.locator('.daystrip').filter({ visible: true });
  await expect(strip).toHaveCount(1);
  await expect(strip.locator('.ds-head')).toHaveCount(n);
  await expect(strip.locator('.ds-now')).toHaveCount(1);
  await expect(strip.locator('.ds-nowt')).toHaveText(/12:40/);
  await expect(page.locator('.tcl-views a[aria-current="page"]').filter({ visible: true })).toHaveText('All day');
  expect(await strip.locator('.ds-box').evaluate(b => b.scrollTop)).toBeGreaterThan(0);   // opened at now, not the morning
  const hrefs = await strip.locator('svg a').evaluateAll(as => as.map(a => a.getAttribute('href')));
  expect(hrefs.length).toBeGreaterThan(n);
  expect(hrefs.every(h => /^#\/stop\/[^?]+\?run=\d+&on=\d{8}$/.test(h))).toBe(true);
  // Ahead: a weekday as the timetable runs it, by the timetable alone (no now on it, nothing live), from its first bus.
  await expect(page.locator('.ds-days a[aria-current="page"]').filter({ visible: true })).toHaveText('Saturday');
  await page.locator('.ds-days a', { hasText: 'Weekday' }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/#\/hub\?day=1&on=wk$/);
  const wk = page.locator('.daystrip').filter({ visible: true });
  await expect(wk.locator('.ds-head').first()).toBeVisible();
  await expect(wk.locator('.ds-now, .ds-bus')).toHaveCount(0);
  expect(await wk.locator('.ds-box').evaluate(b => b.scrollTop)).toBe(0);
  // Each column's route badge a way to that route's page (his mockup's 'tap a head').
  await go(page, '#/hub?day=1');
  const head = page.locator('.daystrip .ds-head a').filter({ visible: true }).first();
  await expect(head).toHaveAttribute('href', /^#\/map\/route\/[^/?]+\?day=1&on=sat$/);   // that route's day, on the day picked
  // The key: today's two dots drawn, once.
  await expect(page.locator('.ds-key .ds-k').filter({ visible: true })).toHaveCount(2);
  await expect(page.locator('.ds-key').filter({ visible: true })).toContainText('Tap a run for its stops.');
  await page.locator('.tcl-views a', { hasText: 'Board' }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/#\/hub$/);
  await expect(page.locator('.daystrip').filter({ visible: true })).toHaveCount(0);
});

test('a bus off its timetable: the day view\'s red dot where it is and an empty one where it should be, its number at the foot; its row says which of the route\'s buses it is', async ({ page }) => {
  // The user: 'the new day view needs to show when buses are off their schedule ... red dots that show live position
  // and the empty dots on the line show the scheduled time', and of the route page: 'clicking different buses i'd like
  // to be able to see 15 1, 2, or 3'. A Route 15 bus staged 6 minutes late at noon on a weekday, when it runs three.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed && feed.buses ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  const d = new Date(); do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); d.setHours(12, 0, 0, 0);   // a weekday: on a Saturday the 15's one bus, and no number to give
  await page.clock.setFixedTime(d);
  await open(page, '#/map/route/15');
  feed = {};
  const pick = await onBusDay(page, () => stageBus(page, feed, { route: '15', late: 6 }));
  expect(pick, 'a Route 15 bus out at noon').not.toBeNull();
  await page.reload();   // the feed's first look taken with the bus in it
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  // The route page's row: dispatch's name first, then the vehicle and how late.
  const row = page.locator('.busrow').filter({ visible: true }).first();
  await expect(row).toContainText(/15\([123]\) · Bus 9005 · 6 min late/, { timeout: 20_000 });
  // Its day: the red dot six minutes up the line from now, the empty one on the now line, a dotted stroke between.
  await go(page, '#/map/route/15?day=1');
  const day = page.locator('.routeday').filter({ visible: true });
  // Which bus, in the bar at the foot under its column (the user: the number by the dot 'too busy, let's put it at the
  // bottom'); the 15 runs three, so how late goes under it there, and nothing by the dot.
  const foot = day.locator('.rd-feet .rd-vn');
  await expect(foot).toHaveCount(1);
  await expect(foot).toHaveAttribute('aria-label', 'Bus 9005 · 6 min late');
  await expect(foot).toHaveAttribute('href', '#/map/bus/c%3A9005');
  await expect(foot.locator('small')).toHaveText('6 min late');
  await expect(day.locator('.rd-late')).toHaveCount(0);
  await expect(day.locator('.ds-off')).toHaveCount(1);
  const ys = await day.locator('.ds-off').evaluate(l => [...l.parentNode.querySelectorAll('.ds-bus')].map(c => ({ live: c.classList.contains('live'), y: +c.getAttribute('cy') })));
  const live = ys.find(c => c.live), ring = ys.find(c => !c.live && c.y > live.y);
  expect(ring, 'the scheduled dot below the live one').toBeTruthy();
  expect(ring.y - live.y).toBeGreaterThan(20);   // 6 min at 6 px a minute, less any gap squeezed between
  // The Center's day: the same bus, '−6' by its dot (behind: minus).
  await go(page, '#/hub?day=1');
  await expect(page.locator('.daystrip:not(.routeday) .ds-late').filter({ visible: true })).toHaveText(['−6']);
  // And its number in the bar at the foot, under its column, a way to it on the map; its dot's hover says it all.
  const vn = page.locator('.daystrip:not(.routeday) .ds-foot .ds-vn').filter({ visible: true });
  await expect(vn).toHaveText(['9005']);
  await expect(vn).toHaveAttribute('href', '#/map/bus/c%3A9005');
  await expect(page.locator('.daystrip:not(.routeday) .ds-busl title')).toHaveText(['Bus 9005 · 6 min late']);
  // A loop too, on the All day views only ('Yes, All day only'): a Blue Loop bus 4 minutes early at the Center's, '+4'.
  expect(await stageBus(page, feed, { route: 'B', late: -4 }), 'a Blue Loop bus out at noon').not.toBeNull();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await go(page, '#/hub?day=1');
  await expect(page.locator('.daystrip:not(.routeday) .ds-late').filter({ visible: true })).toHaveText(['+4']);
  // The loop's own day draws no now line across it, its time at the left kept (Aaron, 25 Nov); its bus still there.
  await go(page, '#/map/route/B?day=1');
  const bday = page.locator('.routeday').filter({ visible: true });
  await expect(bday.locator('.ds-bus.live')).toHaveCount(1);
  await expect(bday.locator('.rd-nl')).toHaveCount(0);
  await expect(bday.locator('.ds-nowt')).toHaveCount(1);
});

test('a route\'s day: its buses down the day at 6 px a minute, its timed stops by name, opened at now; the 16 with the Preston commuter in its gap', async ({ page }) => {
  // The user's by-route view: 'i want route 1 to show 3 runs in a view'. The route page's second view, Stops | All day.
  await page.route(/^https:\/\/live\.cacherider\.com\//, r => r.abort());
  const sat = new Date(); sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7)); sat.setHours(12, 40, 0, 0);
  await page.clock.setFixedTime(sat);
  await open(page, '#/map/route/9');
  await page.locator('.rs-views a', { hasText: 'All day' }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/#\/map\/route\/9\?day=1$/);
  const day = page.locator('.routeday').filter({ visible: true });
  await expect(day).toHaveCount(1);
  await expect(page.locator('.rs-views a[aria-current="page"]').filter({ visible: true })).toHaveText('All day');
  await expect(page.locator('.ds-days a[aria-current="page"]').filter({ visible: true })).toHaveText('Saturday');
  await expect(day.locator('.ds-nowt')).toHaveText(/12:40/);
  expect(await day.locator('.ds-box').evaluate(b => b.scrollTop)).toBeGreaterThan(0);   // opened at now
  const hrefs = await day.locator('a.rd-run').evaluateAll(as => as.map(a => a.getAttribute('href')));
  expect(hrefs.length).toBeGreaterThan(5);
  expect(hrefs.every(h => /^#\/stop\/[^?]+\?run=\d+&on=\d{8}$/.test(h))).toBe(true);
  const names = await day.locator('.rd-ks').evaluateAll(es => es.map(e => e.textContent));
  expect(names.length).toBeGreaterThan(0);
  expect(names.some(n => /[A-Za-z]{4,}/.test(n.replace(/\d+:\d+\s*[AP]M/, '').replace(/\b(North|South|East|West)\b/g, '')))).toBe(true);   // places, not only addresses
  // Back to its stops.
  await page.locator('.rs-views a', { hasText: 'Stops' }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/#\/map\/route\/9\?day=0$/);
  await expect(page.locator('.routeday').filter({ visible: true })).toHaveCount(0);
  // A weekday's 16 at 12:20: no 16 out, the Preston commuter on its road, in its column; the gap without a bus is the
  // road's (8 AM to noon, then 2 to 4:30), never the 16's own (8 AM to 4:30).
  const mon = new Date(sat); mon.setDate(mon.getDate() + 2); mon.setHours(12, 20, 0, 0);
  await page.clock.setFixedTime(mon);
  await page.reload();
  await go(page, '#/map/route/16?day=1');
  const d16 = page.locator('.routeday').filter({ visible: true });
  await expect(d16).toHaveCount(1);
  const runs = await d16.locator('a.rd-run').evaluateAll(as => as.map(a => a.getAttribute('aria-label')));
  test.skip(!runs.some(r => /Preston/.test(r)), 'no Preston commuter that Monday');
  expect(runs.some(r => /16/.test(r))).toBe(true);
  const brk = await d16.locator('.rd-brk').allTextContents();
  expect(brk.every(t => !/AM to 4:\d\d PM/.test(t))).toBe(true);   // never the morning to 4:30: noon to 2 is the commuter's
});

test('a route\'s day marks the towns its bus is in, each named, the Center\'s town never', async ({ page }) => {
  // The user's town highlighter (2026-11-20): towns from OpenStreetMap's limits (data/towns.json), fetched when a route's
  // day first opens, then drawn. The 15 runs to Hyde Park, Smithfield and Richmond from Logan.
  await page.route(/^https:\/\/live\.cacherider\.com\//, r => r.abort());
  const mon = new Date(); mon.setDate(mon.getDate() + ((1 - mon.getDay() + 7) % 7 || 7)); mon.setHours(10, 15, 0, 0);
  await page.clock.setFixedTime(mon);
  await open(page, '#/map/route/15?day=1');
  const day = page.locator('.routeday').filter({ visible: true });
  await expect(day.locator('.rd-hl').first()).toBeAttached({ timeout: 15000 });
  const towns = [...new Set(await day.locator('.rd-town').allTextContents())];
  expect(towns.length).toBeGreaterThan(1);
  expect(towns).not.toContain('Logan');
  expect(await day.locator('.rd-hl').evaluateAll(es => es.every(e => /^#[0-9A-F]{6}$/i.test(e.style.getPropertyValue('--town').trim())))).toBe(true);
});

test('a route whose bus is out as another route between its runs says so, from the timetable or the feed, and opens on All day; not while its own run is on', WIDE, async ({ page }) => {
  // The user's block-strip mockup: 'On Route 1 now ... Back on the 9 at 1:00 PM', the answer with no 9 on the map. No
  // feed first, so the timetable's, said so; no stop named, the timetable's place not a sighting. Then the feed's bus on
  // that run (the user: 'i just want hints at where the bus is and why it's not on a route when people check'): where
  // it is, live, a tap to it. Opened plain it's the route's day (All day, 'why is it so buried?'), the hint at its top.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  const sat = new Date(); sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7)); sat.setHours(4, 0, 0, 0);
  await page.clock.setFixedTime(sat);
  await open(page);
  const pick = await page.evaluate(async () => {
    const d = await import('/app/data.js'), u = await import('/app/ui.js'), t = await import('/app/time.js'), c = t.now();
    const endOf = ti => { const e = d.tripEnd(ti), s = d.tripStops(ti); return e ? e.min : s[s.length - 1][0]; };
    for (const [ri, r] of d.D.routes.entries()) {
      if (d.swapsOn(ri, c.ymd).from === null) continue;
      const own = new Set();
      for (const si of new Set(Object.values(r.stops || {}).flat())) for (const x of d.timesOn(si, c.ymd)) if (x.r === ri) own.add(x.trip);
      const runs = [...own].sort((a, b) => d.tripStops(a)[0][0] - d.tripStops(b)[0][0]);
      for (const ti of runs.slice(1)) {
        const p = d.prevTrip(ti, c.ymd), pr = p !== undefined && d.tripRoute(p);
        if (!pr || pr.r === ri || !d.staysOn(p, ti)) continue;
        const a = d.tripStops(p)[0][0] + 1;
        if (a >= endOf(p) || runs.some(x => d.tripStops(x)[0][0] <= a && endOf(x) >= a)) continue;
        const on = runs.find(x => d.tripStops(x)[0][0] + 1 < endOf(x)), ps = d.tripStops(p);
        return { short: r.short, other: u.routeName(pr.r), otherShort: d.D.routes[pr.r].short, at: a, on: d.tripStops(on)[0][0] + 1, back: d.tripStops(ti)[0][0], self: u.routeName(ri),
          p: d.D.trips[p], ps: ps.map(([m, x]) => [m, d.D.stops[x].id, d.D.stops[x].lat, d.D.stops[x].lon, !!d.D.stops[x].hub]) };
      }
    }
    return null;
  });
  test.skip(!pick, 'no bus runs another route between its own runs that Saturday');
  const at = min => { const x = new Date(sat); x.setHours(Math.floor(min / 60), min % 60, 0, 0); return x; };
  await page.clock.setFixedTime(at(pick.at));
  await page.reload();
  await go(page, '#/map/route/' + encodeURIComponent(pick.short) + '?day=0');
  const busy = page.locator('.rs-busy').filter({ visible: true });
  await expect(busy).toHaveCount(1);
  await expect(busy.locator(":scope > span")).toHaveText(`Its next bus is on ${pick.other} now, by the timetable.`);   // no 'back at': the list's first row says it
  await expect(busy.locator('a.badgelink')).toHaveCount(1);
  // Opened plain: its day, the hint at the top with when it's back; Stops a tap away and kept.
  const backAt = await page.evaluate(async m => (await import('/app/time.js')).clockText(m), pick.back);
  await go(page, '#/map/route/' + encodeURIComponent(pick.short));
  await expect(page.locator('.routeday').filter({ visible: true })).toHaveCount(1);
  await expect(page.locator('.rs-views a[aria-current="page"]').filter({ visible: true })).toHaveText('All day');
  await expect(busy.locator(":scope > span")).toHaveText(`Its next bus is on ${pick.other} now, by the timetable · ${pick.self} again at ${backAt}.`);
  // The feed's bus on that run, between two of its stops: where it is, live, the bus's number last, a tap to it.
  const k = pick.ps.findIndex(x => x[0] > pick.at && !x[4]);
  test.skip(k < 1, 'no stop of that run to place the bus by');
  const T = Math.floor(at(pick.at).getTime() / 1000), base = T - pick.at * 60, A = pick.ps[k - 1], B = pick.ps[k];
  feed = { t: T, trips: { [pick.p]: { v: '9005', ts: T, s: pick.ps.slice(k).map(([m, sid], j) => [sid, k + j, base + m * 60, 0]) } },
    buses: [{ id: '9005', label: '9005', trip: pick.p, lat: (A[2] + B[2]) / 2, lon: (A[3] + B[3]) / 2, bearing: 0, speed: 5, ts: T }] };
  await page.reload();
  // On its day (on the stops, a bus that ran this route just before says it itself: 'Bus 9005 ran this route and is now').
  await go(page, '#/map/route/' + encodeURIComponent(pick.short) + '?day=1');
  const live = page.locator('a.rs-busy.live').filter({ visible: true });
  await expect(live).toHaveCount(1, { timeout: 20_000 });
  await expect(live.locator('.rs-busy-t')).toHaveText(new RegExp(`^Its next bus is on ${pick.other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} now · (by|at) .+ · ${pick.self.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} again at ${backAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · bus 9005$`));
  await expect(live.locator('.livetag')).toHaveText('Live');
  await expect(live).toHaveAttribute('href', '#/map/route/' + encodeURIComponent(pick.otherShort) + '?bus=c%3A9005');
  // On its stops: the jog in at the top, the route it's still on and the bus, no more ('smaller, just saying which route
  // it's on'), in place of 'ran this route'; the line on down from it.
  await go(page, '#/map/route/' + encodeURIComponent(pick.short) + '?day=0');
  const jog = page.locator('a.jog-in').filter({ visible: true });
  await expect(jog).toHaveCount(1, { timeout: 20_000 });
  await expect(jog.locator(':scope > span').first()).toHaveText(`On ${pick.other} now · bus 9005`);
  await expect(jog).toHaveAttribute('href', '#/map/route/' + encodeURIComponent(pick.otherShort) + '?bus=c%3A9005');
  await expect(page.locator('.section.onward', { hasText: 'ran this route' }).filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('.rs-list.line.from').filter({ visible: true })).toHaveCount(1);
  if (process.env.JOG_SHOT) await page.locator('.routesheet').filter({ visible: true }).first().screenshot({ path: process.env.JOG_SHOT });
  feed = null;
  await page.clock.setFixedTime(at(pick.on));   // its own run under way: nothing to explain
  await page.reload();
  await go(page, '#/map/route/' + encodeURIComponent(pick.short));
  await expect(page.locator('.rs-list').filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('.rs-busy')).toHaveCount(0);
});

test('days without buses: a line on a stop\'s page, a route\'s and the Center\'s the week before, and the year\'s list in Settings', WIDE, async ({ page }) => {
  // The user: 'it would be nice to answer the holiday question in the app'. It was said on the day itself only. Staged:
  // three running days before the timetable's next day off (a holiday, or a day it takes off unnamed), then well before.
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => r.abort());
  await open(page);
  const pick = await page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now();
    const off = d.daysOff(c.ymd, 365);
    if (!off.length) return null;
    let k = 3; while (k < 7 && !d.agencyRuns(t.dayFrom(off[0].ymd, -k).ymd)) k++;
    // Well before one, on a day the timetable covers (today or later): the next day off may be nearer than that.
    const later = off.find((o, i) => t.dayFrom(o.ymd, -12).ymd >= c.ymd && !(i && t.dayFrom(o.ymd, -12).ymd <= off[i - 1].ymd && t.dayFrom(o.ymd, -5).ymd <= off[i - 1].ymd));
    const near = t.dayFrom(off[0].ymd, -k).ymd, far = later ? t.dayFrom(later.ymd, -12).ymd : null;
    const s = d.D.stops.find(s => !s.hub && s.routes.length && d.timesOn(d.D.stopById[s.id], near).length);
    return { day: t.fmtDay(off[0].ymd), name: off[0].name, near, far, stop: s.id, route: d.D.routes[s.routes[0]].short, count: d.daysOff(near, 365).length };
  });
  test.skip(!pick, 'the timetable has no day off in the year ahead');
  const at = ymd => new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), 12, 0, 0);
  await page.clock.setFixedTime(at(pick.near));
  await page.reload();
  const note = page.locator('.notice.daysoff').filter({ visible: true });
  for (const where of ['#/stop/' + pick.stop, '#/map/route/' + encodeURIComponent(pick.route), '#/hub']) {
    await go(page, where);
    await expect(note.first(), where).toContainText(pick.name ? 'No buses on ' + pick.name + ', ' + pick.day : 'No buses ' + pick.day);
  }
  await go(page, '#/about');
  const list = page.locator('.daysoff-list .row');
  await expect(list).toHaveCount(pick.count);
  await expect(list.first()).toContainText(pick.name || 'No buses');
  // More than a week off: nothing said yet.
  if (!pick.far) return;
  await page.clock.setFixedTime(at(pick.far));
  await page.reload();
  await go(page, '#/stop/' + pick.stop);
  await expect(page.locator('.row, .callout').filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('.notice.daysoff')).toHaveCount(0);
});

test('a route\'s page never says to stay on a bus that goes out of service for hours, as 16 AM\'s last run before 16 PM', WIDE, async ({ page }) => {
  // The user: 'i noticed there's an option to "stay on bus 16 from the am and it will become the pm bus. this is
  // nonsense. there's hours gaps between. and the bus goes out of service'. Staged: a bus partway through a 16 AM run
  // whose next run in the timetable is a 16 PM one hours on, the feed listing both for the same bus, as it does.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  await open(page);
  const pick = await page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js');
    let c = t.now();
    for (let k = 0; k < 8; k++, c = t.dayFrom(t.now().ymd, k)) {
      const ymd = c.ymd;
      for (const [ri, r] of d.D.routes.entries()) {
        if (d.familyKey(ri) !== '16') continue;
        for (const [si] of d.D.stops.entries()) for (const row of d.timesOn(si, ymd).filter(x => x.r === ri)) {
          const nx = d.nextTrip(row.trip, ymd);
          if (nx === undefined) continue;
          const tr = d.tripRoute(nx), st = d.tripStops(row.trip), sn = d.tripStops(nx), te = d.tripEnd(row.trip);
          if (!tr || tr.r === ri || d.familyKey(tr.r) !== '16' || !te || sn[0][0] - te.min < 120 || st.length < 4) continue;
          const a = d.D.stops[st[1][1]], b = d.D.stops[st[2][1]];
          return { ymd, short: r.short, id: d.D.trips[row.trip], nid: d.D.trips[nx], st: st.map(([m, x]) => [m, d.D.stops[x].id]), sn: sn.map(([m, x]) => [m, d.D.stops[x].id]),
            mid: [(a.lat + b.lat) / 2, (a.lon + b.lon) / 2], min: st[2][0] - 1 };
        }
      }
    }
    return null;
  });
  test.skip(!pick, 'no 16 AM run followed by a 16 PM one hours on, this week');
  const [y, mo, dd] = [pick.ymd.slice(0, 4), pick.ymd.slice(4, 6), pick.ymd.slice(6)];
  const at = new Date(`${y}-${mo}-${dd}T${String(Math.floor(pick.min / 60)).padStart(2, '0')}:${String(pick.min % 60).padStart(2, '0')}:30-06:00`);
  await page.clock.setFixedTime(at);
  const T = Math.floor(at.getTime() / 1000), base = T - 30 - pick.min * 60;
  feed = { t: T, trips: { [pick.id]: { v: '9003', ts: T, s: pick.st.slice(2).map(([m, sid], i) => [sid, i + 2, base + m * 60, 0]) },
    [pick.nid]: { v: '9003', ts: T, s: pick.sn.map(([m, sid], i) => [sid, i, base + m * 60, 0]) } },
    buses: [{ id: '9003', label: '9003', trip: pick.id, lat: pick.mid[0], lon: pick.mid[1], bearing: 0, speed: 5, ts: T }] };
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await go(page, '#/map/route/' + encodeURIComponent(pick.short));
  await expect.poll(() => page.evaluate(async () => !!(await import('/app/rt.js')).findBus('c:9003')), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(1500);
  await expect(page.locator('.section.onward')).toHaveCount(0);
  await expect(page.getByText(/Stay on bus 9003/)).toHaveCount(0);
});

test('home: the big stop\'s bus on its way as a line, here at its stop, gone with the feed; the Save hint till a stop is saved', PHONE, async ({ page }) => {
  // The relay's answer made up, as the timetable has a trip run: the clock half a minute into the minute before its
  // second call, its bus between its first two stops, and the rider at its fifth. Its line: the bus, its next stop, the
  // two between folded, the rider's at the foot. Then the bus at its next stop (that ring filled, a stop fewer), the
  // route's page saying the same, and the feed without it: no line.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  await open(page);
  await expect(page.locator('.land-hint').filter({ visible: true })).toContainText('Tap Save on a stop\'s page to keep it here');   // a first visit, nothing saved
  const pick = await onBusDay(page, () => page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), loops = d.D.hub.loops || [], seen = new Set();
    for (const [si, s] of d.D.stops.entries()) for (const row of d.timesOn(si, c.ymd)) {
      if (seen.has(row.trip) || loops.includes(row.r)) continue;
      seen.add(row.trip);
      const st = d.tripStops(row.trip);
      if (st.length < 7 || st[0][0] < 300 || st[st.length - 1][0] > 1400 || st[1][0] - st[0][0] < 2) continue;
      const a = d.D.stops[st[0][1]], b = d.D.stops[st[1][1]], k = st[4][1], mine = d.D.stops[k];
      if (mine.hub || d.distance(mine.lat, mine.lon, d.D.hub.lat, d.D.hub.lon) < 300 || d.distance(a.lat, a.lon, b.lat, b.lon) < 200 || new Set(st.slice(0, 5).map(x => x[1])).size < 5) continue;
      // the route page counts by the route's order: the same four calls in a row there, so the two say the same
      const order = d.routeOrder(row.r, String(row.dir)), i1 = order.indexOf(st[1][1]);
      if (i1 < 0 || order.slice(i1, i1 + 4).join() !== st.slice(1, 5).map(x => x[1]).join()) continue;
      // the rider's stop's next bus then is this one, and no other stop is as near the spot
      const min = st[1][0] - 1, at = { ymd: c.ymd, dow: c.dow, min, sec: 30 }, n = d.nextAt(k, 1, at)[0];
      if (!n || n.trip !== row.trip || d.nearest(mine.lat, mine.lon, 2).some(x => x.i !== k && x.d < 25)) continue;
      return { id: d.D.trips[row.trip], st: st.map(([m, x]) => [m, d.D.stops[x].id, d.D.stops[x].lat, d.D.stops[x].lon]), stop: mine.id, name: mine.name, lat: mine.lat, lon: mine.lon,
        mid: [(a.lat + b.lat) / 2, (a.lon + b.lon) / 2], at: Date.now() + ((min - c.min) * 60 + 30 - c.sec) * 1000, short: d.D.routes[row.r].short };
    }
    return null;
  }));
  test.skip(!pick, 'no trip this week to make the feed of');
  await page.clock.setFixedTime(new Date(pick.at));
  const T = Math.floor(pick.at / 1000), base = T - 30 - (pick.st[1][0] - 1) * 60;   // the epoch second of the day's minute 0
  const feedOf = (lat, lon) => ({ t: T, trips: { [pick.id]: { v: '9001', ts: T, s: pick.st.slice(1).map(([m, sid], i) => [sid, i + 2, base + m * 60, 0]) } },
    buses: lat === undefined ? [] : [{ id: '9001', label: '9001', trip: pick.id, lat, lon, bearing: 0, speed: 0, ts: T }] });
  feed = feedOf(...pick.mid);
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: pick.lat, longitude: pick.lon, accuracy: 10 });
  await page.evaluate(p => { localStorage.setItem('cr-near', 'on'); localStorage.setItem('cr-lastgeo', JSON.stringify({ lat: p.lat, lon: p.lon, at: p.at, acc: 10 })); localStorage.removeItem('cr-saved'); }, pick);
  await page.reload();
  const line = page.locator('.hero .homeline').filter({ visible: true });
  await expect(line).toBeVisible({ timeout: 20_000 });
  await expect(line.locator(':scope > *')).toHaveCount(4);
  await expect(line.locator('.busrow')).toHaveText('Bus 9001 · 4 stops away');
  await expect(line.locator('.busrow.at')).toHaveCount(0);
  await expect(line.locator('.rs-foldsum')).toHaveText('2 stops');
  await expect(line.locator('.croute.here')).toContainText(pick.name);
  await expect(line).toHaveAttribute('href', new RegExp('^#/map/route/' + encodeURIComponent(pick.short) + '/\\d+/' + pick.stop + '$'));
  await expect(page.locator('.land-hint').filter({ visible: true })).toBeVisible();   // nothing saved: under the big stop
  // At its next stop: that stop's ring is its dot, and that stop's done
  feed = feedOf(pick.st[1][2], pick.st[1][3]);
  await expect(line.locator('.busrow.at')).toHaveText('Bus 9001 · 3 stops away', { timeout: 15_000 });
  await expect(line.locator('.croute').first().locator('.c-ring.on')).toHaveCount(1);
  await line.click();
  await expect(page).toHaveURL(new RegExp('#/map/route/.+/' + pick.stop + '$'));
  await expect(page.locator('.yourstop').filter({ visible: true }).first()).toContainText('Bus 9001 · 3 stops away');
  // The stop's own page says it on the bus's row, on its Live line, as the big stop does
  await go(page, '#/stop/' + pick.stop);
  await expect(page.locator('.row.next .livetag').filter({ visible: true }).first()).toContainText(/ · at .+ · 3 stops away/);   // where it is, and how far
  // The feed without it: the big stop as it was
  feed = feedOf();
  await go(page, '#/');
  await expect(page.locator('.hero').filter({ visible: true })).toBeVisible();
  await expect(page.locator('.homeline')).toHaveCount(0, { timeout: 15_000 });
  // Saved: the hint goes
  await page.evaluate(id => { localStorage.setItem('cr-saved', JSON.stringify([id])); window.dispatchEvent(new HashChangeEvent('hashchange')); }, pick.stop);
  await expect(page.locator('.hero .savedmark').filter({ visible: true })).toBeVisible();
  await expect(page.locator('.land-hint')).toHaveCount(0);
});

test('home: trips saved on the directions page, under the big stop: the one from the end you\'re at whole, the rest a row each; tomorrow\'s after the last bus; three at most; one saved before kept', PHONE, async ({ page }) => {
  // The timetable's alone (the feed off), the clock at 4:10 PM on the next weekday followed by another (a holiday
  // neither), the rider at 1011 East 700 North (Richard's Hall). The trips: to 430 East Center St (Island Market: Route
  // 3); from Island Market to 2041 North 1200 East (North Logan's fire station); to 465 East 1400 North (the hospital);
  // from 180 North Main, Smithfield, to 45 West 1200 South (South Walmart).
  await page.route(/^https:\/\/live\.cacherider\.com\//, r => r.abort());
  await open(page);
  const day = await page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js');
    for (let k = 1; k < 21; k++) { const x = t.dayFrom(t.now().ymd, k), y = t.dayFrom(t.now().ymd, k + 1); if (x.dow >= 1 && x.dow <= 4 && d.agencyRuns(x.ymd) && d.agencyRuns(y.ymd)) return x.ymd; }
    return null;
  });
  test.skip(!day, 'no two weekdays running in a row in three weeks');
  const at = hm => page.evaluate(([ymd, hm]) => new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6), +hm.slice(0, 2), +hm.slice(3)).getTime(), [day, hm]);   // the agency's clock (the browser's zone)
  const RH = { latitude: 41.74445, longitude: -111.8083 }, IM = { latitude: 41.7312, longitude: -111.82395 }, COURT = { latitude: 41.73999, longitude: -111.8369 };
  await page.context().grantPermissions(['geolocation']);
  /** The rider somewhere (null: location off) at a time: a fix taken then, kept, so the browser's own doesn't replace it. */
  const be = async (g, when) => {
    await page.clock.setFixedTime(new Date(when));
    if (g) await page.context().setGeolocation({ ...g, accuracy: 10 });
    await page.evaluate(([g, t]) => { if (g) { localStorage.setItem('cr-near', 'on'); localStorage.setItem('cr-lastgeo', JSON.stringify({ lat: g.latitude, lon: g.longitude, at: t, acc: 10 })); } else localStorage.removeItem('cr-near'); }, [g, when]);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  };
  const kept = () => page.evaluate(() => [localStorage.getItem('cr-trip'), JSON.parse(localStorage.getItem('cr-trips'))]);
  const save = page.locator('#trip-save').filter({ visible: true });
  const saveOn = async hash => { await go(page, hash); await expect(save).toHaveText(/^Save trip/); await save.click(); await expect(save).toContainText('Saved trip'); };
  const four = await at('16:10');
  // One trip saved by the first version (cr-trip): still there, read as the list's, nothing written till a save
  await page.evaluate(() => { localStorage.removeItem('cr-trips'); localStorage.setItem('cr-trip', JSON.stringify({ to: '7543017', from: '7569115' })); });
  await be(RH, four);
  const card = page.locator('.trip').filter({ visible: true });
  const way = card.locator('.tripway'), rows = card.locator('.triprow');
  await expect(way.locator('.tw-to')).toHaveText('To 430 East Center St');
  await expect(card.locator('.land-eye')).toHaveText('Saved trip');
  await expect(rows).toHaveCount(0);
  expect(await kept()).toEqual([JSON.stringify({ to: '7543017', from: '7569115' }), null]);
  // Unsaved on the directions page (the way back's, the same trip): none left, and the old one doesn't come back
  await go(page, '#/go/7569115/7543017');
  await expect(save).toContainText('Saved trip');
  await save.click();
  await expect(save).toHaveText('Save trip');
  expect(await kept()).toEqual([null, []]);
  await go(page, '#/');
  await expect(page.locator('.hero').filter({ visible: true })).toBeVisible();
  await expect(page.locator('.trip')).toHaveCount(0);
  // Two saved, the second after the first, nothing replaced
  await saveOn('#/go/7543017/7569115');
  await saveOn('#/go/7599831/7543017');
  await expect(save.locator('small')).toHaveCount(0);
  // Home: the one from the end you're at whole, from Richard's Hall, as the directions open with it; the other a row
  await go(page, '#/');
  await expect(card.locator('.land-eye')).toHaveText('Saved trips');
  await expect(way.locator('.tw-to')).toHaveText('To 430 East Center St');
  await expect(way.locator('.tw-from')).toHaveText('from 1011 East 700 North');
  await expect(way.locator('.eyebrow')).toHaveText(/^(Leave in \d+ min|Leave in a minute|Leaving now)$/);
  await expect(way.locator('.tw-last')).toHaveText(/^(Last way today: leave by \d+:\d\d PM|This is the last way today)$/);
  await expect(card.locator('.tripback')).toContainText(/The way back\s*Last way today: leave by \d+:\d\d PM/);
  await expect(way).toHaveAttribute('href', '#/go/7543017/7569115');
  await expect(card.locator('.tripback')).toHaveAttribute('href', '#/go/7569115/7543017');
  await expect(rows).toHaveCount(1);
  await expect(rows.locator('.name')).toHaveText('To 2041 North 1200 East');
  await expect(rows).toContainText('from 430 East Center St');
  await expect(rows.locator('.end .t')).toHaveText(/^\d+:\d\d(AM|PM)$/);
  await expect(rows.locator('.end .rel')).toHaveText(/^(Leave in \d+ min|Leave in a minute|Leaving now|Leave in \d+ h \d+ min)$/);   // a time to leave, not a bus's
  await expect(rows.locator('.tr-last')).toHaveText(/^(Last: leave by \d+:\d\d PM|Last way today)$/);
  await expect(rows).toHaveAttribute('href', '#/go/7599831/7543017');
  await way.click();
  await expect(page).toHaveURL(/#\/go\/7543017\/7569115$/);
  // At Island Market both have an end where you are: the order saved, the first turned round
  await be(IM, four);
  await go(page, '#/');
  await expect(way.locator('.tw-to')).toHaveText('To 1011 East 700 North');
  await expect(way.locator('.tw-from')).toHaveText('from 430 East Center St');
  await expect(rows.locator('.name')).toHaveText('To 2041 North 1200 East');
  // Location off: as they were saved
  await be(null, four);
  await expect(way.locator('.tw-to')).toHaveText('To 430 East Center St');
  await expect(rows).toHaveCount(1);
  // After the last bus: tomorrow's first ways, nothing more today
  await be(RH, await at('23:30'));
  await expect(way.locator('.eyebrow')).toHaveText('Tomorrow');
  await expect(way.locator('.tw-last')).toHaveText('Nothing more today');
  await expect(card.locator('.tripback')).toContainText('Nothing more today');
  await expect(rows.locator('.end .rel')).toHaveText('Tomorrow');
  await expect(rows.locator('.tr-last')).toHaveText('Nothing more today');
  // Three at most: a fourth says first which it replaces, the last saved, and takes its place
  await be(RH, four);
  await saveOn('#/go/7569954/7569115');
  await go(page, '#/go/7565655/7569944');
  await expect(save.locator('small')).toHaveText('instead of the one to 465 East 1400 North');
  await save.click();
  await expect(save).toContainText('Saved trip');
  expect((await kept())[1]).toEqual([{ to: '7543017', from: '7569115' }, { to: '7599831', from: '7543017' }, { to: '7565655', from: '7569944' }]);
  await go(page, '#/');
  await expect(rows).toHaveCount(2);
  // Take me home: away while a trip to Home starts where you are; back when you're at neither end (it's from here)
  await page.evaluate(() => localStorage.setItem('cr-places', JSON.stringify([{ id: '41.7312,-111.8240', name: 'Home', lat: 41.7312, lon: -111.82395, label: '430 East Center St' }])));
  await be(RH, four);
  await expect(card).toBeVisible();
  await expect(page.locator('.land-home')).toHaveCount(0);
  await be(COURT, four);
  await expect(page.locator('.land-home').filter({ visible: true })).toBeVisible();
  // The first unsaved: the rest, in the order saved
  await go(page, '#/go/7543017/7569115');
  await save.click();
  await expect(save).toHaveText('Save trip');
  await go(page, '#/');
  await expect(way.locator('.tw-to')).toHaveText('To 2041 North 1200 East');
  await expect(rows).toHaveCount(1);
  await expect(rows.locator('.name')).toHaveText('To 45 West 1200 South');
});

/** A click on the map where nothing is: zoomed out to the valley (the routes drawn small, in town), then the fields at
 *  the edge of the map that shows: clear of a wide screen's panel, the search bar, and a phone's card over the map's
 *  foot (a click there was on the card). */
async function clickNothing(page, how = 'click') {
  // the card measured once it's done sliding in (a third of a second), or a click meant beside it lands on it
  await page.waitForFunction(() => { const c = document.querySelector('#mapcard'); return !c || c.getAnimations().every(a => a.playState !== 'running'); }, null, { polling: 100, timeout: 5000 }).catch(() => {});
  const map = await page.locator('#map').boundingBox(), side = await page.locator('#side').boundingBox();
  const open = page.locator('#mapcard.open'), card = (await open.count()) ? await open.boundingBox() : null;
  const left = side && side.width < map.width * 0.6 && side.x <= map.x + 1 ? side.x + side.width : map.x;   // beside the panel
  const top = map.y + 80, bottom = card && card.width > map.width * 0.6 ? card.y - 10 : map.y + map.height - 60;
  const mid = (top + bottom) / 2;
  // Six turns of the wheel out, a beat apart, as the map's own wheel events (the browser's took a quarter second each,
  // and the waits round them, three seconds a click), then the map still.
  await page.evaluate(async ([x, y]) => { const c = window.__map.getCanvas(); for (let i = 0; i < 6; i++) { c.dispatchEvent(new WheelEvent('wheel', { deltaY: 600, clientX: x, clientY: y, bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 60)); } }, [(left + map.x + map.width) / 2, mid]);
  await settled(page);
  // The click, and once the map has answered it: a finger's tap is picked 300 ms on (map.js, waiting out a double tap),
  // and the map's own handlers run before this one's, set after them.
  await page.evaluate(how => { window.__answered = new Promise(r => window.__map.once({ dblclick: 'dblclick', right: 'contextmenu' }[how] || 'click', () => setTimeout(r, 350))); }, how);
  if (how === 'dblclick') await page.mouse.dblclick(left + 30, mid);   // a mouse's double click, the map's zoom in
  else if (how === 'right') await page.mouse.click((left + map.x + map.width) / 2, mid, { button: 'right' });   // a long press's spot, mid-map
  else await page.mouse.click(left + 30, mid);
  await page.evaluate(() => window.__answered);
  await settled(page);   // (a double click's zoom in)
}
/** Where the tab is in its history, and whether a step was taken through it since this was first asked. */
async function stepAt(page) {
  return page.evaluate(() => {
    if (window.__pops === undefined) { window.__pops = 0; addEventListener('popstate', () => window.__pops++); }
    return { at: navigation.currentEntry.index, pops: window.__pops, forward: navigation.canGoForward };
  });
}

/** A Connect bus staged on the map (the relay's answer made up; with none out, at night or on a Sunday, the tests that
 *  need one were skipped): bus 9007 of a numbered route, on a trip the timetable doesn't know (its route the id's
 *  prefix, rt.js), so on duty whatever the day, a block north of a spot. The feed's route set before `open`; its marker. */
async function loneBus(page, feed, [lat, lon]) {
  const short = await page.evaluate(async () => (await import('/app/data.js')).D.routes.map(r => r.short).find(s => /^\d{1,2}$/.test(s)));
  const t = Math.floor(Date.now() / 1000);
  Object.assign(feed, { t, trips: {}, buses: [{ id: '9007', label: '9007', trip: short + '_9999', lat: lat + 0.001, lon, bearing: 90, speed: 5, ts: t - 2 }] });
  return page.locator('.maplibregl-marker.bus[title*="bus 9007"]');
}
const feedOn = (page, feed) => page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed.buses ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());

test('bus click-off: back where the rider was; its card opens its route', async ({ page }, info) => {
  const feed = {};
  await feedOn(page, feed);
  await open(page);
  if (phone(info)) {
    // The Map tab: a bus's card, and a click off it puts the card away, the Map tab still up.
    const bus = await loneBus(page, feed, [41.7355, -111.8335]);
    await go(page, '#/map');
    await mapReady(page);
    await expect(bus).toBeAttached({ timeout: 20_000 });
    await bus.evaluate(el => el.click());
    await expect(page.getByText(/^Bus 9007/).filter({ visible: true }).first()).toBeVisible();
    await clickNothing(page);
    await expect(page).toHaveURL(/#\/map$/);
    await expect(page.getByText(/^Bus \d+/).filter({ visible: true })).toHaveCount(0);
    // Again, and its card's Open route: the route's page, the bus on it.
    await bus.evaluate(el => el.click());
    await expect(page.getByText(/^Bus 9007/).filter({ visible: true }).first()).toBeVisible();
    await page.getByRole('link', { name: 'Open route' }).filter({ visible: true }).first().evaluate(a => a.click());
    await expect(page).toHaveURL(/#\/map\/route\/.+\?bus=/);
    return;
  }
  // Beside a wide screen's panel: from a stop's page, a bus opens its route there; a click off it goes back to the stop.
  const id = await someStop(page);
  const bus = await loneBus(page, feed, await stopAt(page, id));
  await go(page, '#/stop/' + id);
  await mapReady(page);
  await expect(bus).toBeAttached({ timeout: 20_000 });
  await bus.evaluate(el => el.click());
  await expect(page).toHaveURL(/#\/map\/route\/.+\?bus=/);
  const was = await stepAt(page);
  await clickNothing(page);
  await expect(page).toHaveURL(new RegExp('#/stop/' + id + '$'));
  expect(await stepAt(page)).toEqual(was);   // in place, not a step Back
});

test('a stop put down, then a bus clicked and clicked off: the stop stays down', WIDE, async ({ page }) => {
  // The user: 'i clicked on a stop, clicked on the map to deselect. clicked on a bus, clicked on the map again and the
  // stop highlighted'. Beside a wide screen's panel a click off a stop puts its dot down, its page staying; a bus's
  // route, clicked off, goes back to that page, and the dot came back lit.
  const feed = {};
  await feedOn(page, feed);
  await open(page);
  const id = await someStop(page);
  const bus = await loneBus(page, feed, await stopAt(page, id));
  await go(page, '#/stop/' + id);
  await mapReady(page);
  const lit = () => page.evaluate(() => JSON.stringify(window.__map.getFilter('stop-selected')));
  await expect.poll(lit).toContain(id);
  await clickNothing(page);
  await expect(page).toHaveURL(new RegExp('#/stop/' + id + '$'));
  await expect.poll(lit).not.toContain(id);
  await expect(bus).toBeAttached({ timeout: 20_000 });
  await bus.evaluate(el => el.click());
  await expect(page).toHaveURL(/#\/map\/route\/.+\?bus=/);
  await clickNothing(page);
  await expect(page).toHaveURL(new RegExp('#/stop/' + id + '$'));
  await page.waitForTimeout(600);
  expect(await lit()).not.toContain(id);
});

test('a tap off a card, a sheet, a route puts it away in place: never a step Back, not even a double click', async ({ page }, info) => {
  // A tap on nothing stepped Back where the address before was the one put away to, and the card put away was a
  // Forward away. With a mouse, a double click (the map's zoom in) went Back twice: off the map to Stops, and the next
  // Back out of the app. (A finger's double tap picks nothing: the map's tap waits it out, map.js.)
  await open(page, '#/map');
  await mapReady(page);
  const { id, short } = await page.evaluate(async () => { const { D } = await import('/app/data.js'); return { id: D.stops.find(s => !s.hub && s.routes.length && !s.out).id, short: D.routes.find(r => /^\d+$/.test(r.short)).short }; });
  // Each opened from the map, a step of its own (Back puts it away): a route, a phone's stop sheet, and a spot's card
  // (in the fields west of the routes, where a tap off falls on no road)
  const opened = ['#/map/route/' + short, ...(phone(info) ? ['#/stop/' + id] : []), '#/map/at/41.74000,-112.02000/Here'];
  for (const h of opened) {
    await go(page, '#/map');
    await expect(page).toHaveURL(/#\/map$/);
    await go(page, h);
    await expect(page.locator('#mapcard.open, #side .routepage').filter({ visible: true }).first()).toBeVisible();
    const was = await stepAt(page);
    // (a phone's route: the first tap puts its card away, the route still lit; the next, the route)
    for (let k = phone(info) && /route/.test(h) ? 2 : 1; k > 0; k--) await clickNothing(page, phone(info) ? 'click' : 'dblclick');
    await expect(page, h).toHaveURL(/#\/map$/);
    expect(await stepAt(page), h).toEqual({ ...was, forward: false });
    await expect(page.locator('#mapcard')).not.toHaveClass(/\bopen\b/);
  }
  // The map where the last was put away is the address before it again (the first Back shows no change), but the
  // next opened from the map takes that step (ui.js openTo): spots picked and tapped off, over and over, don't pile up
  // the map in the history, Back doing nothing once for each.
  const steps = () => page.evaluate(() => navigation.entries().length);
  const n = await steps();
  for (let k = 0; k < 2; k++) {
    await clickNothing(page, 'right');
    await expect(page).toHaveURL(/#\/map\/at\//);
    await clickNothing(page);
    await expect(page).toHaveURL(/#\/map$/);
  }
  expect(await steps()).toBe(n);
});

test('a bus gone quiet: grey after three minutes without a report, off the map after ten', WIDE, async ({ page }) => {
  // The relay's answer made up: three buses on one trip, heard from now, five minutes ago, twenty minutes ago.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  await open(page, '#/');
  const trip = await page.evaluate(async () => (await import('/app/data.js')).D.trips[0]);
  const t = Math.floor(Date.now() / 1000), bus = (label, ago, lon) => ({ id: label, label, trip, lat: 41.735, lon, bearing: 0, speed: 0, ts: t - ago });
  feed = { t, trips: {}, buses: [bus('9001', 2, -111.835), bus('9002', 300, -111.83), bus('9003', 1200, -111.825)] };
  await go(page, '#/map');
  await mapReady(page);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.maplibregl-marker.bus')].map(m => m.title).filter(x => / 900\d/.test(x)).sort())).toEqual([
    expect.stringMatching(/bus 9001(?! · not reporting)/), expect.stringMatching(/bus 9002 · not reporting$/)]);
  const r = await page.evaluate(async () => { const { rt } = await import('/app/rt.js'); return { buses: rt.buses.map(b => b.label), parked: rt.parked.map(b => b.label) }; });
  expect(r).toEqual({ buses: ['9001'], parked: ['9002'] });
  await page.evaluate(() => [...document.querySelectorAll('.maplibregl-marker.bus')].find(m => / 9002/.test(m.title)).click());
  await expect(page.getByText('Not reporting').filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/last heard from at/).filter({ visible: true }).first()).toBeVisible();
});

test('a run whose bus should be out and isn\'t in the feed: its time stands, \'Scheduled · bus not seen\', a ? on it', async ({ page }) => {
  // The relay's answer made up: one bus out on another route's trip (a feed with buses in it), none on the run picked,
  // a trip under way by the timetable with a stop still to come; then a bus put on the run, and the doubt goes.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  // A weekday mid-morning, buses out: on the real clock a Sunday has none, and the test skipped.
  const when = new Date(); do when.setDate(when.getDate() + 1); while (when.getDay() === 0 || when.getDay() === 6); when.setHours(10, 40, 30, 0);
  await page.clock.setFixedTime(when);
  await open(page, '#/');
  const pick = await page.evaluate(async () => {
    const { D, timesOn, tripStops, tripRoute } = await import('/app/data.js'), { now } = await import('/app/time.js'), n = now();
    for (let ti = 0; ti < D.trips.length; ti++) {
      const st = tripStops(ti), r = tripRoute(ti);
      if (!r || D.routes[r.r].op || st.length < 2 || st[0][0] > n.min - 5) continue;
      const ahead = st.find(([m]) => m >= n.min + 3 && m <= n.min + 30);
      if (!ahead || !timesOn(ahead[1], n.ymd).some(t => t.trip === ti && t.min === ahead[0])) continue;
      const other = D.trips.findIndex((_, k) => k !== ti && tripRoute(k) && tripRoute(k).r !== r.r);
      return { trip: D.trips[ti], other: D.trips[other], stop: D.stops[ahead[1]].id, min: ahead[0], lat: D.stops[ahead[1]].lat, lon: D.stops[ahead[1]].lon };
    }
    return null;
  });
  test.skip(!pick, 'no trip under way right now');
  const t = Math.floor(when.getTime() / 1000), bus = trip => ({ id: '9201', label: '9201', trip, lat: pick.lat + 0.01, lon: pick.lon, bearing: 0, speed: 5, ts: t });
  feed = { t, trips: {}, buses: [bus(pick.other)] };
  await go(page, '#/stop/' + pick.stop);
  await expect(page.locator('.sched.unseen').filter({ visible: true }).first()).toContainText('bus not seen');
  await expect(page.locator('.unseen-q').filter({ visible: true }).first()).toBeVisible();
  feed = { t: t + 1, trips: {}, buses: [{ ...bus(pick.trip), ts: t + 1 }] };
  await page.reload();   // the clock held, the app's next ask of the relay is on opening
  await expect.poll(() => page.evaluate(async p => { const { unseen } = await import('/app/rt.js'), { D } = await import('/app/data.js'), { now } = await import('/app/time.js');
    const { rt } = await import('/app/rt.js'); return rt.buses.some(b => b.trip === p.trip) ? unseen({ trip: D.trips.indexOf(p.trip), r: 0, min: p.min, day: 0 }, now()) : null; }, pick), { timeout: 30000 }).toBe(false);
});

test('map: a bus wears its route\'s number, a grey one its arrow, two at one spot a +1', async ({ page }) => {
  // The relay's answer made up, by the Center: two buses of one route at one spot (one picked, by its address), a third
  // up the street, a fourth not heard from in five minutes (grey). Their trip one the timetable doesn't know, its route
  // the id's prefix (rt.js), so they're on duty whatever the day.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  await open(page, '#/');
  const short = await page.evaluate(async () => (await import('/app/data.js')).D.routes.map(r => r.short).find(s => /^\d{1,2}$/.test(s)));
  const t = Math.floor(Date.now() / 1000), bus = (label, ago, lat, lon) => ({ id: label, label, trip: short + '_9999', lat, lon, bearing: 90, speed: 5, ts: t - ago });
  feed = { t, trips: {}, buses: [bus('9001', 2, 41.738, -111.833), bus('9002', 2, 41.738, -111.833), bus('9003', 2, 41.7395, -111.8318), bus('9004', 300, 41.738, -111.830)] };
  // The map up first, then the bus's address: beside a wide screen's pages the first page's map, drawn once the
  // relay's alerts are in, could land after the address had moved on, and the bus's was taken for done.
  await go(page, '#/map');
  await mapReady(page);
  await go(page, '#/map/bus/c%3A9001');
  const marker = label => page.locator(`.maplibregl-marker.bus[title*="bus ${label}"]`);
  await expect(marker('9003').locator('.bus-num')).toBeVisible();   // close in: its number in its ring, not an arrow
  await expect(marker('9003').locator('.bus-num')).toHaveText(short);
  await expect(marker('9001').locator('.bus-num')).toHaveText(short);
  await expect(marker('9001').locator('.bus-n')).toHaveText('+1');   // how many more, never a bare 2 that reads as a route
  await expect(marker('9004')).toHaveAttribute('title', /not reporting/);
  await expect(marker('9004')).not.toHaveClass(/\bnum\b/);   // grey: the arrow, not a number that reads as in service
});

test('map: a tap on a +1 zooms in till its buses part, no card', async ({ page }) => {
  // Two buses of one route 8 m apart: one spot from the town's view, a +1; tapped, the map comes in till each has its
  // own ring, and no bus's card opens for whichever was on top.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  await open(page, '#/');
  const short = await page.evaluate(async () => (await import('/app/data.js')).D.routes.map(r => r.short).find(s => /^\d{1,2}$/.test(s)));
  const t = Math.floor(Date.now() / 1000), bus = (label, lat, lon) => ({ id: label, label, trip: short + '_9999', lat, lon, bearing: 90, speed: 5, ts: t - 2 });
  feed = { t, trips: {}, buses: [bus('9005', 41.7365, -111.8335), bus('9006', 41.73657, -111.8335)] };
  await go(page, '#/map');
  await mapReady(page);
  const marker = label => page.locator(`.maplibregl-marker.bus[title*="bus ${label}"]`);
  const top = page.locator('.maplibregl-marker.bus:not(.stacked)[title*="bus 900"]').filter({ has: page.locator('.bus-n') });
  await expect(top).toHaveCount(1);
  await expect(top.locator('.bus-n')).toHaveText('+1');
  await top.evaluate(el => el.click());
  await expect(marker('9005').locator('.bus-n')).toHaveCount(0);
  await expect(marker('9006')).not.toHaveClass(/\bstacked\b/);
  await expect(marker('9005')).not.toHaveClass(/\bstacked\b/);
  expect(await page.evaluate(() => location.hash)).toBe('#/map');
  await expect(page.locator('#mapcard.open')).toHaveCount(0);
});

test('search: a route, every route, a street, a place, an address, and one with a bus\'s number in it still the address', PHONE, async ({ page }) => {
  const feed = {};
  await feedOn(page, feed);
  await open(page);
  await go(page, '#/search?q=12');
  await expect(page.locator('a[href="#/map/route/12"]').filter({ visible: true }).first()).toBeVisible();
  await go(page, '#/search?q=routes');
  await expect(page.locator('a[href^="#/map/route/"]')).not.toHaveCount(0);
  await go(page, '#/search?q=Main%20St');
  await expect(page.locator('a[href^="#/stop/"]').filter({ visible: true }).first()).toBeVisible();
  await go(page, '#/search?q=USU');
  await expect(page.locator('#side a').filter({ visible: true }).first()).toBeVisible();
  // A place on campus by 'USU' and a word: the Institute of Religion by campus (a church in the map's data).
  await go(page, '#/search?q=' + encodeURIComponent('USU Institute'));
  await expect(page.getByText(/Institute of Religion/).filter({ visible: true }).first()).toBeVisible();
  // A street by what the town calls it: 10th West is 1000 West's stops; the Dugway a place.
  await go(page, '#/search?q=' + encodeURIComponent('10th west'));
  await expect(page.getByText(/10th West is 1000 West/).filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('a[href^="#/stop/"]').filter({ visible: true }).first()).toContainText('1000 West');
  await go(page, '#/search?q=dugway');
  await expect(page.getByText(/600 East/).filter({ visible: true }).first()).toBeVisible();
  // A chapel by what the town calls it (OSM's loc_name), 'chapel' for 'church'; an area named with a kind in it.
  await go(page, '#/search?q=' + encodeURIComponent('Middle Earth Chapel'));
  await expect(page.getByText(/Middle Earth Building/).filter({ visible: true }).first()).toBeVisible();
  // A building's places, said to be in it, by the building's names ('tsc', 'taggart'), and USU by what its places are
  // called ('Aggie'): the Campus Store as a bookstore.
  await go(page, '#/search?q=' + encodeURIComponent('tsc subway'));
  await expect(page.getByText(/in Taggart Student Center/).filter({ visible: true }).first()).toBeVisible();
  await go(page, '#/search?q=' + encodeURIComponent('aggie bookstore'));
  await expect(page.getByText(/USU Campus Store/).filter({ visible: true }).first()).toBeVisible();
  await go(page, '#/search?q=' + encodeURIComponent('logan regional pharmacy'));
  await expect(page.getByText(/Pharmacy/i).filter({ visible: true }).first()).toBeVisible();
  await go(page, '#/search?q=' + encodeURIComponent('500 North 100 East'));
  await expect(page.getByText(/Show on map/).filter({ visible: true }).first()).toBeVisible();
  // '1168 N Main' is an address, whatever bus 1168 is doing: bus 1168 staged out (found by its number alone), and the
  // address's heading first, no bus.
  await loneBus(page, feed, [41.735, -111.83]);
  feed.buses[0].id = feed.buses[0].label = '1168';
  await go(page, '#/search?q=1168');
  await expect(page.locator('#side a.busfound').filter({ visible: true }).first()).toContainText('Bus 1168', { timeout: 20_000 });
  await go(page, '#/search?q=' + encodeURIComponent('1168 N Main'));
  await expect(page.locator('#side .section').filter({ visible: true }).first()).toContainText(/1168 North Main/i);
  await expect(page.locator('#side a.busfound')).toHaveCount(0);
});

test('a stop by its number, as Connect writes it (0115) or as its feed has it (115): found either way, said with its zero', PHONE, async ({ page }) => {
  await open(page);
  for (const q of ['0115', '115', 'stop 0115']) {
    await go(page, '#/search?q=' + encodeURIComponent(q));
    await expect(page.locator('a[href="#/stop/7569115"]').filter({ visible: true }).first(), q).toBeVisible();
  }
  await go(page, '#/stop/7569115');   // 1011 East 700 North, Richard's Hall
  await expect(page.getByText(/Stop 0115/).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/Stop 115\b/)).toHaveCount(0);
});

test('which of its route\'s buses a bus is: on its card (Blue 2), and found by it in the search (B2, Blue two, 12(1)), and by its number', async ({ page }, info) => {
  // The relay's answer made up: a loop's second bus and a numbered route's first, each on a trip of its block today
  // with one after it (on duty, whatever the hour), and a bus on a trip the timetable doesn't know (no number).
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  await open(page, '#/');
  const p = await onBusDay(page, () => page.evaluate(async () => {
    const { D, servicesOn, tripStops, nextTrip } = await import('/app/data.js');
    const { now } = await import('/app/time.js');
    const ymd = now().ymd, out = {};
    for (const sv of servicesOn(ymd)) for (const [key, bl] of Object.entries(D.buses[sv] || {})) {
      const ri = D.routes.findIndex(r => r.short.replace(/\s+(AM|PM)$/i, '') === key), want = /^\d+$/.test(key) ? 0 : 1;
      if (ri < 0 || D.routes[ri].op || key.length > 2 || out[/^\d+$/.test(key) ? 'num' : 'loop']) continue;
      const ti = bl[want].find(t => nextTrip(t, ymd) !== undefined), si = tripStops(ti)[1][1];
      out[/^\d+$/.test(key) ? 'num' : 'loop'] = { key, n: want + 1, of: bl.length, trip: D.trips[ti], lat: D.stops[si].lat, lon: D.stops[si].lon, spoken: D.routes[ri].long.replace(/ Loop$/, '') };
    }
    return out;
  }).then(p => p.loop ? p : null));
  test.skip(!p, 'no loop runs two buses this week');
  const t = Math.floor(Date.now() / 1000), bus = (label, x, dlat = 0) => ({ id: label, label, trip: x.trip, lat: x.lat + dlat, lon: x.lon, bearing: 90, speed: 5, ts: t - 2 });
  const short = await page.evaluate(async () => (await import('/app/data.js')).D.routes.map(r => r.short).find(s => /^\d{1,2}$/.test(s)));
  feed = { t, trips: {}, buses: [bus('9101', p.loop), ...(p.num ? [bus('9102', p.num)] : []), bus('9103', { ...p.loop, trip: short + '_9999' }, 0.004)] };
  const loopLabel = p.loop.spoken + ' 2';   // 'Blue 2', as dispatch says it: one name for it, the card's and the search's
  // Its card: the vehicle's number above, which of its route's buses it is under the route's name.
  await go(page, '#/map');
  await mapReady(page);
  await go(page, '#/map/bus/c%3A9101');
  const card = page.locator('#mapcard.open').filter({ visible: true });
  await expect(card.locator('.eyebrow').first()).toContainText('Bus 9101');
  await expect(card.locator('.who .nth')).toHaveText(loopLabel);
  if (p.num) { await go(page, '#/map/bus/c%3A9102'); await expect(card.locator('.who .nth')).toHaveText(`${p.num.key}(1)`); }
  await go(page, '#/map/bus/c%3A9103');
  await expect(card.locator('.eyebrow').first()).toContainText('Bus 9103');
  await expect(card.locator('.who .nth')).toHaveCount(0);   // a trip the timetable doesn't know: no number
  // Not on its ring: there 'B2' would read as a route of that name.
  expect(await page.locator('.maplibregl-marker.bus[title*="bus 9101"]').textContent()).not.toMatch(/2 of|\(\d\)|[A-Z]\d/);
  // The search: as dispatch writes it and says it, first in the results; a bare number still the route.
  await go(page, phone(info) ? '#/map' : '#/');
  const box = page.locator(phone(info) ? '#mapsearch input' : '#topsearch input');
  const first = page.locator(phone(info) ? '#mapresults a.row, #mapresults a.stoprow, #mapresults .notice' : '#side a.row, #side a.stoprow, #side .notice').first();
  for (const q of [p.loop.key + '2', p.loop.key.toLowerCase() + ' 2', p.loop.key + '-2', 'bus ' + p.loop.key + '2', p.loop.spoken + ' two', p.loop.spoken + ' Loop 2']) {
    await box.fill(q);
    await expect(first, q).toHaveClass(/busfound/);
    await expect(first, q).toContainText(loopLabel);
    await expect(first, q).toContainText('Bus 9101');
  }
  await box.fill(p.loop.key + (p.loop.of + 1));
  await expect(first).toContainText(`runs ${p.loop.of} buses today`);
  if (p.num) {
    for (const q of [p.num.key + '(1)', p.num.key + ' (1)']) { await box.fill(q); await expect(first, q).toContainText('Bus 9102'); }
    await box.fill(p.num.key);
    await expect(first).toHaveAttribute('href', '#/map/route/' + p.num.key);
  }
  // By the number painted on it: the bus first, above any stop with the number in it; its card; Back to the map, or
  // to the search.
  await box.fill('9101');
  await expect(first).toHaveClass(/busfound/);
  await expect(first).toContainText('Bus 9101');
  await first.click();
  await expect(page).toHaveURL(/#\/map\/bus\/c%3A9101\?find=1$/);
  await expect(card.locator('.eyebrow').first()).toContainText('Bus 9101');
  await page.goBack();
  await expect(page).toHaveURL(phone(info) ? /#\/map$/ : /#\/search\?q=9101$/);
  await box.fill(p.loop.key + '2');
  await expect(first).toHaveClass(/busfound/);
  await first.click();
  await expect(page).toHaveURL(/#\/map\/bus\/c%3A9101\?find=1$/);
  await expect(card.locator('.who .nth')).toHaveText(loopLabel);
});

test('one clock rule: due from its minute\'s start, gone from the next', PHONE, async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const t = await import('/app/time.js'), c = { min: 600, sec: 59, ymd: '20261007' };
    return [t.isDue({ min: 600 }, c), t.isDue({ min: 601 }, c), t.isGone({ min: 599 }, c), t.isGone({ min: 600 }, c), t.isGone({ min: 605, gone: true }, c),
      t.relative({ min: 600, day: 0 }, c), t.relative({ min: 601, day: 0 }, c), t.minsTo({ min: 10, day: 1 }, c)];
  });
  expect(r).toEqual([true, false, true, false, true, 'now', 'in 1 min', 850]);
});

test('the map\'s lines: faded behind the last buses, every one in colour ten minutes after the night\'s last call', PHONE, async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), m = await import('/app/views/map.js'), u = await import('/app/usu.js');
    // today, or the next day with buses (a Sunday or a holiday has nothing to fade, and was checked as nothing)
    const lasts = ymd => d.D.routes.map((_, ri) => d.lastTripOn(ri, ymd)).filter(Boolean).map(l => l.end[0]);
    let c = t.now();
    for (let k = 1; k < 14 && !lasts(c.ymd).length; k++) c = t.dayFrom(t.now().ymd, k);
    const ends = lasts(c.ymd);
    if (!ends.length) return null;
    // the shuttle's last loop and POOL's end too, on a day they run (their listed hours): one reset for the whole map
    const svc = u.U && u.U.service, runs = svc && svc.days[(t.dayFrom(c.ymd).dow + 6) % 7], pool = d.POOL && d.POOL.week && d.POOL.week[(t.dayFrom(c.ymd).dow + 6) % 7];
    const E = Math.max(...ends, ...(runs ? [svc.end, ...Object.values(svc.late || {})] : []), ...(pool ? [pool[1]] : []));
    const at = min => m.doneToday({ ymd: c.ymd, min, sec: 0 }), during = at(E - 20), after = at(Math.min(1439, E + 30));
    return { during: [during.stretches.length, during.stops.size], after: [after.stretches.length, after.stops.size, after.loops.size, after.pool] };
  });
  expect(r, 'a day with buses in the next two weeks').not.toBeNull();
  expect(r.during[0]).toBeGreaterThan(0);
  expect(r.during[1]).toBeGreaterThan(0);
  expect(r.after).toEqual([0, 0, 0, false]);
});

test('search: where people live, an apartment complex and a dorm by name', WIDE, async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const d = await import('/app/data.js');
    return ['pine view apartments', 'aggie village', 'snow hall', 'apartments logan'].map(q => d.searchPlaces(q).list.slice(0, 3).map(p => p.name).join(' | '));
  });
  expect(r[0]).toMatch(/Pine View/);
  expect(r[1]).toMatch(/Aggie Village/);
  expect(r[2]).toMatch(/Snow Hall/);
  expect(r[3]).not.toBe('');   // by its kind
});

test('the Center: a bus back in at the end of its trip isn\'t its departure still leaving', PHONE, async ({ page }) => {
  // A fresh start at 8:51: a route's 8:30 bus back at the Center finishing its trip read as the 8:30 leaving now, 21 min
  // late, until it took up its next trip. Made up from the timetable: a run whose next is an hour on or more (21 min down
  // isn't held for it: rt.js holdOf), the clock 21 minutes after it.
  await open(page);
  const pick = await onBusDay(page, () => page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js');
    const c = t.now(), loops = d.D.hub.loops || [];
    for (const [si, s] of d.D.stops.entries()) {
      if (!s.hub) continue;
      for (const row of d.timesOn(si, c.ymd)) {
        if (loops.includes(row.r)) continue;
        const st = d.tripStops(row.trip), f = st[0], nx = d.nextTrip(row.trip, c.ymd), ns = nx !== undefined ? d.tripStops(nx)[0] : null;
        const seq = (d.D.routes[row.r].stops || {})[String(row.dir)] || [];
        if (!f || f[0] !== row.min || f[1] !== si || seq.length < 7 || seq[0] !== si || (ns && ns[0] - f[0] < 60)) continue;
        return { ti: row.trip, f, ri: row.r, dir: row.dir, seq, at: Date.now() + ((f[0] + 21 - c.min) * 60 - c.sec) * 1000 };
      }
    }
    return null;
  }));
  test.skip(!pick, 'no hourly run from the Center this week');
  await page.clock.setFixedTime(new Date(pick.at));
  const r = await page.evaluate(async ({ ti, f, ri, dir, seq }) => {
    const d = await import('/app/data.js'), rtm = await import('/app/rt.js');
    const id = d.D.trips[ti], near = seq[seq.length - 2], hub = d.D.stops[f[1]], nowS = Math.floor(Date.now() / 1000);
    rtm.tripOf(id);
    // its next stop the one before the Center, the bus at the bay: in, finishing the trip
    rtm.rt.trips = { [id]: { v: 'X1', ts: nowS, at: new Map([[d.D.stops[near].id, { seq: seq.length - 2, time: nowS + 30, skipped: false }]]), first: { sid: d.D.stops[near].id, seq: seq.length - 2, time: nowS + 30 }, last: { sid: d.D.stops[near].id, seq: seq.length - 2, time: nowS + 30 }, lastDelay: 0, ti, stops: [[d.D.stops[near].id, seq.length - 2, nowS + 30, 0]], end: seq.length - 1 } };
    rtm.rt.buses = [{ id: 'c:X1', label: 'X1', trip: id, ri, lat: hub.lat, lon: hub.lon, course: 0, speed: 0, ts: nowS, h: null, dir }];
    rtm.rt.at = Date.now(); rtm.rt.t = nowS;
    const p = rtm.predict({ min: f[0], r: ri, dir, si: f[1], trip: ti, day: 0 });
    return p === null || (p.gone && !p.held) || p.min === f[0] ? 'gone' : 'leaving ' + p.min + (p.held ? ' held' : '');
  }, pick);
  expect(r).toBe('gone');
});

test('the Center: a departure still listed past its minute, its bus on its trip before, by where the bus is', PHONE, async ({ page }) => {
  // 3:06 PM, every 3:00 'leaving now, 6 min late': the feed still listed the Center on each 3:00 and had its bus on the
  // trip before, out on its run. Made up from the timetable: a route's half-hourly departure, the clock 6 minutes on.
  await open(page);
  const pick = await onBusDay(page, () => page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js');
    const c = t.now(), loops = d.D.hub.loops || [];
    for (const [si, s] of d.D.stops.entries()) {
      if (!s.hub) continue;
      for (const row of d.timesOn(si, c.ymd)) {
        if (loops.includes(row.r)) continue;
        const f = d.tripStops(row.trip)[0], nx = d.nextTrip(row.trip, c.ymd), ns = nx !== undefined ? d.tripStops(nx)[0] : null;
        if (!f || f[0] !== row.min || f[1] !== si || !ns || ns[0] - f[0] !== 30) continue;
        return { ti: row.trip, f, ri: row.r, dir: row.dir, at: Date.now() + ((f[0] + 6 - c.min) * 60 - c.sec) * 1000 };
      }
    }
    return null;
  }));
  test.skip(!pick, 'no half-hourly run from the Center this week');
  await page.clock.setFixedTime(new Date(pick.at));
  const r = await page.evaluate(async ({ ti, f, ri, dir }) => {
    const d = await import('/app/data.js'), rtm = await import('/app/rt.js');
    const id = d.D.trips[ti], hub = d.D.stops[f[1]], nowS = Math.floor(Date.now() / 1000), dep = { min: f[0], r: ri, dir, si: f[1], trip: ti, day: 0 };
    rtm.tripOf(id);
    const trip = { v: 'X2', ts: nowS, at: new Map([[hub.id, { seq: 0, time: nowS - 360, skipped: false }]]), first: { sid: hub.id, seq: 0, time: nowS - 360 }, last: { sid: hub.id, seq: 0, time: nowS - 360 }, lastDelay: 0, ti, stops: [[hub.id, 0, nowS - 360, 0]], end: 99 };
    const at = (lat, lon, speed) => { rtm.rt.trips = { [id]: trip }; rtm.rt.buses = [{ id: 'c:X2', label: 'X2', trip: 'the_one_before', ri, lat, lon, course: 0, speed, ts: nowS, h: null, dir }]; rtm.rt.at = Date.now(); rtm.rt.t = nowS; const p = rtm.predict(dep); return p && p.gone ? 'gone' : 'leaving'; };
    // out on its run; standing at the bay; at the bay but moving, pulling out
    return [at(hub.lat + 0.03, hub.lon, 8), at(hub.lat, hub.lon, 0), at(hub.lat, hub.lon, 6)];
  }, pick);
  expect(r).toEqual(['gone', 'leaving', 'gone']);
});

test('the Center: a group NOW in its minute; gone by with one late route still in, the next group\'s; most of it still in, up and counting how late', WIDE, async ({ page }) => {
  // 8:03 AM, 16 Oct: Route 12's bus in late for the 8:00, the other nine gone at 8:00 and out on their runs. The board
  // stayed at 8:00, 0:00, every other bay's bus 20 min out (coming in for the 8:30), until 12 pulled out at 8:06; and a
  // group's clock sat at 0:00 for minutes. Made up from the timetable: a group with a group 30 min after it, the clock
  // half a minute past it, then 4 min 40, the relay's answer faked.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  await open(page);
  const pick = await onBusDay(page, () => page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now();
    const ps = d.nextPulse(80, c);
    for (const q of ps) {
      if (q.min < 360 || !ps.some(x => x.ymd === q.ymd && x.min === q.min + 30)) continue;
      // each route's run at that minute from its bay, a trip out of the Center with a stop more than 4 min on
      const runs = d.pulseGroup(q).map(ri => {
        const bay = d.D.hub.bays.find(b => b.routes.includes(ri)), row = bay && d.timesOn(bay.stop, q.ymd).find(x => x.r === ri && x.min === q.min);
        const st = row ? d.tripStops(row.trip) : [];
        return st.length > 3 && st[0][1] === bay.stop && st.some(([m]) => m > q.min + 4) ? { ri, ti: row.trip } : null;
      });
      if (runs.length < 4 || runs.some(x => !x)) continue;
      const day = t.dayDiff(c.ymd, q.ymd);
      return { q, runs, at: Date.now() + ((day * 1440 + q.min - c.min) * 60 + 30 - c.sec) * 1000 };
    }
    return null;
  }));
  test.skip(!pick, 'no group of four routes or more with one 30 min after it this week');
  await page.clock.setFixedTime(new Date(pick.at));
  // `inbay` of the group's routes standing in their bays, late, the Center listed at their minute; the rest out on their
  // runs at their first stop more than 3 min on, listed from there.
  const feedOf = inbay => page.evaluate(async ({ q, runs, inbay }) => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), T = Math.floor(Date.now() / 1000), base = T - c.min * 60 - c.sec;
    const trips = {}, buses = [];
    runs.forEach(({ ri, ti }, i) => {
      const id = d.D.trips[ti], st = d.tripStops(ti).slice(), te = d.tripEnd(ti), v = String(9300 + i);
      if (te) st.push([te.min, te.si]);
      const k = i < inbay ? 0 : st.findIndex(([m]) => m > c.min);
      const s = st.map(([m, si], n) => [d.D.stops[si].id, n, base + m * 60 + (i < inbay && n > 0 ? 240 : 0), 0]).slice(k);
      const at = d.D.stops[st[k][1]], from = k ? d.D.stops[st[k - 1][1]] : at;
      trips[id] = { v, ts: T - 5, s };
      buses.push({ id: v, label: v, trip: id, lat: at.lat, lon: at.lon, bearing: k ? Math.round(d.bearing(from.lat, from.lon, at.lat, at.lon)) : 0, speed: i < inbay ? 0 : 8, ts: T - 3 });
    });
    return { t: T - 2, now: T, buses, trips };
  }, { ...pick, inbay });
  const late = await page.evaluate(async ({ q, runs }) => {
    const t = await import('/app/time.js'), ui = await import('/app/ui.js');
    return { name: ui.routeNames([runs[0].ri]), then: t.clock(q.min + 30).h, now: t.clock(q.min).h };
  }, pick);
  // Its own minute, every bus in: the group one row of their badges, All here, leaving now
  feed = await feedOf(pick.runs.length);
  await go(page, '#/hub');
  const grp = h => page.locator('.tcl-grp').filter({ visible: true }).filter({ has: page.locator('.tcl-grp-h b', { hasText: new RegExp('^' + h + '$') }) }).first();
  const all = grp(late.now).locator('.tcl-all');
  await expect(all).toBeVisible({ timeout: 20_000 });
  await expect(all.locator('.badge')).toHaveCount(pick.runs.length);   // the feed's word in
  await expect(grp(late.now).locator('.tcl-grp-h span')).toHaveText('leaving now');
  // a tap opens it, a row each, every one Here; and it folds again
  await all.click();
  await expect(grp(late.now).locator('.tcl-row .tcl-st.here')).toHaveCount(pick.runs.length);
  await grp(late.now).locator('.tcl-fold').click();
  await expect(grp(late.now).locator('.tcl-all')).toBeVisible();
  // 3½ min on, one route still in, late; the rest gone, their bays dropped from the feed (each still 'leaving now' for
  // the minute after: rt.js LEFT_GRACE, by the clock, so it's moved on past that). The late one is a group of its own,
  // at when it'll go, said as an estimate, its row Here and due at the group's minute; not folded, being one.
  await page.clock.setFixedTime(new Date(pick.at + 180_000));
  feed = await feedOf(1);
  await polled(page, feed.t);   // a poll with it
  await page.clock.setFixedTime(new Date(pick.at + 250_000));
  feed = await feedOf(1);
  const lateRow = page.locator('.tcl-row').filter({ visible: true }).filter({ has: page.locator('.tcl-late', { hasText: 'Late · due ' + late.now }) });
  await expect(lateRow).toHaveCount(1, { timeout: 20_000 });
  await expect(lateRow.locator('.tcl-st')).toHaveText('Here');
  await expect(page.locator('.tcl-grp').filter({ visible: true }).filter({ has: lateRow }).locator('.tcl-grp-h b small')).toHaveText('about');
  await expect(grp(late.now)).toHaveCount(0);   // the group's minute gone by: none left at it
});

test('the Center\'s compass: north up and south up, one to the other', PHONE, async ({ page }) => {
  await open(page, '#/hub');
  await mapReady(page);
  const btn = page.locator('.northbtn').filter({ visible: true }).first();
  await expect(btn).toBeVisible();
  const said = [];
  for (let i = 0; i < 3; i++) { await btn.click(); await settled(page); said.push(await btn.getAttribute('aria-label')); }   // turned round before the next
  // from whichever it opened on, it goes to the other and back: never east or west
  expect(said.every(x => /^(North up|South up)/.test(x))).toBe(true);
  expect(said[0]).not.toBe(said[1]);
  expect(said[0]).toBe(said[2]);
});

test('a spot picked on the map for where you are: from the home page, and kept after a reload', async ({ page }) => {
  // A desk with no location: the spot was dropped on the next visit (no permission, so the kept place 'wasn't where they
  // are'), and picking it was only in the sheet that asks for location. No feed: a live bus where the test taps the map
  // took the tap (a Saturday's, 21 Nov 2026).
  await page.route(/^https:\/\/live\.cacherider\.com\//, r => r.abort());
  await open(page);
  await page.evaluate(() => { localStorage.removeItem('cr-near'); localStorage.removeItem('cr-lastgeo'); });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  const pick = page.locator('a[href="#/map/me"]').filter({ visible: true }).first();
  await expect(pick).toBeVisible();
  await pick.click();
  await expect(page).toHaveURL(/#\/map\/me/);
  await mapReady(page);
  const box = await page.locator('#map canvas').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByText('Near the spot you picked').filter({ visible: true }).first()).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  // past the location check on opening (main.js autoLocate, asked of the browser just after the first draw): this
  // page's own question answered after it, and the redraw it would make
  await page.evaluate(async () => { await navigator.permissions.query({ name: 'geolocation' }); await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); });
  await expect(page.getByText('Near the spot you picked').filter({ visible: true }).first()).toBeVisible();
});

test('the panel on the right, set in Settings and kept: the map\'s buttons across from it, a stop, directions and a route each framed in the map left of it, their pages in it; and back', WIDE, async ({ page }) => {
  // The user: 'we need a smoke test for those with right panel preferences set on'. The map frames what's picked in the
  // room the panel leaves (map.js room, the panel the map's padding): on the right, that room is left of it.
  await open(page, '#/about');
  await page.locator('button[data-side="right"]').click();
  await expect(page.locator('button[data-side="right"]')).toHaveAttribute('aria-pressed', 'true');
  await go(page, '#/');
  await mapReady(page);
  const vw = page.viewportSize().width;
  expect(Math.round(await page.locator('#side').boundingBox().then(b => b.x + b.width))).toBe(vw);   // flush right
  expect((await page.locator('#map .maplibregl-ctrl-top-right').boundingBox()).x).toBeLessThan(100);   // the map's buttons on the left, clear of it
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.panel === 'right');   // kept, set before the page draws
  await mapReady(page);
  const side = await page.locator('#side').boundingBox();
  expect(Math.round(side.x + side.width)).toBe(vw);
  // Each point on screen: left of the panel, under the search bar, on the map (settled: read till two reads agree).
  const onScreen = pts => page.evaluate(pts => { const m = window.__map, r = m.getContainer().getBoundingClientRect(); return pts.map(([la, lo]) => { const q = m.project([lo, la]); return [Math.round(r.left + q.x), Math.round(r.top + q.y)]; }); }, pts);
  const settled = async pts => { let a = await onScreen(pts); for (let k = 0; k < 20; k++) { await page.waitForTimeout(300); const b = await onScreen(pts); if (JSON.stringify(a) === JSON.stringify(b)) return b; a = b; } return a; };
  const clear = async (pts, from = 0) => { for (const [x, y] of await settled(pts)) { expect(x).toBeGreaterThan(from); expect(x).toBeLessThan(side.x); expect(y).toBeGreaterThan(60); expect(y).toBeLessThan(page.viewportSize().height); } };
  // A stop: its page in the panel, its two buttons there, the stop on the map left of it.
  const s = await page.evaluate(async () => { const d = await import('/app/data.js'); const x = d.D.stops.find(s => !s.hub && s.routes.length >= 2 && !s.out); return { id: x.id, lat: x.lat, lon: x.lon }; });
  await go(page, '#/stop/' + s.id);
  const btns = page.locator('#side .gobtns a').filter({ visible: true });
  await expect(btns).toHaveCount(2);
  for (const b of await btns.all()) { const bb = await b.boundingBox(); expect(bb.x).toBeGreaterThanOrEqual(side.x); }
  await clear([[s.lat, s.lon]]);
  // A run of it opened from its rows: its sheet over the panel, not over the map (it opened on the left, the map a strip).
  const run = page.locator('#side .runopen, #side .next[data-trip]').filter({ visible: true }).first();
  if (await run.count()) {
    await run.click();
    const sheet = page.locator('#runsheet .rs').filter({ visible: true });
    await expect(sheet).toBeVisible();
    const rb = await still(sheet);
    expect(rb.x).toBeGreaterThanOrEqual(side.x - 1);
    await page.goBack();
    await expect(page.locator('#runsheet .rs')).toHaveCount(0);
  }
  // Directions: both ends on the map left of the panel.
  await go(page, '#/go/@41.74180,-111.80900:Old%20Main/at/41.73632,-111.83415/Utah%20Podiatry');
  await expect(page.locator('#side .jsum').filter({ visible: true }).first()).toBeVisible();
  await clear([[41.73632, -111.83415], [41.74180, -111.80900]]);
  // A route: its page in the panel, its line framed left of it (its stops' extremes).
  const r = await page.evaluate(async () => { const d = await import('/app/data.js'); const ri = d.D.routes.findIndex(r => r.short === '3'); const ids = [...new Set(Object.values(d.D.routes[ri].stops || {}).flat())].map(i => d.D.stops[i]);
    const by = f => ids.reduce((a, b) => f(b) < f(a) ? b : a); return { short: d.D.routes[ri].short, pts: [by(s => s.lat), by(s => -s.lat), by(s => s.lon), by(s => -s.lon)].map(s => [s.lat, s.lon]) }; });
  await go(page, '#/map/route/' + encodeURIComponent(r.short));
  const rh = page.locator('#side .routehead').filter({ visible: true }).first();
  await expect(rh).toBeVisible();
  expect((await rh.boundingBox()).x).toBeGreaterThanOrEqual(side.x);
  await clear(r.pts);
  // Set back in Settings: on the left.
  await go(page, '#/about');
  await page.locator('button[data-side="left"]').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.panel || 'left')).toBe('left');
});

test('the Center: a bus two-thirds of a run down is held for its next run, which leaves on time', PHONE, async ({ page }) => {
  // Route 8's 2:00, its bus in at 2:27: 'leaving any second', when it went out on the 2:30 (2026-10-09). Made up from
  // the timetable: a route's half-hourly departure from the Center, the clock set to 22 minutes after it.
  await open(page);
  const pick = await onBusDay(page, () => page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js');
    const c = t.now(), loops = d.D.hub.loops || [];
    for (const [si, s] of d.D.stops.entries()) {
      if (!s.hub) continue;
      for (const row of d.timesOn(si, c.ymd)) {
        if (loops.includes(row.r)) continue;
        const f = d.tripStops(row.trip)[0], nx = d.nextTrip(row.trip, c.ymd), ns = nx !== undefined ? d.tripStops(nx)[0] : null;
        if (!f || f[0] !== row.min || f[1] !== si || !ns || !d.D.stops[ns[1]].hub || ns[0] - f[0] !== 30) continue;
        return { ti: row.trip, nx, f, ns, ri: row.r, dir: row.dir, at: Date.now() + ((f[0] + 22 - c.min) * 60 - c.sec) * 1000 };
      }
    }
    return null;
  }));
  test.skip(!pick, 'no half-hourly run from the Center this week');
  await page.clock.setFixedTime(new Date(pick.at));
  const r = await page.evaluate(async ({ ti, nx, f, ns, ri, dir }) => {
    const d = await import('/app/data.js'), rtm = await import('/app/rt.js');
    const id = d.D.trips[ti], hub = d.D.stops[f[1]], nowS = Math.floor(Date.now() / 1000);
    rtm.tripOf(id);
    // its bus standing at its bay, the feed's listing of the Center 22 minutes old: 'leaving now', 22 down
    rtm.rt.trips = { [id]: { v: 'X3', ts: nowS, at: new Map([[hub.id, { seq: 0, time: nowS - 22 * 60, skipped: false }]]), first: { sid: hub.id, seq: 0, time: nowS - 22 * 60 }, last: { sid: hub.id, seq: 0, time: nowS - 22 * 60 }, lastDelay: 0, ti, stops: [[hub.id, 0, nowS - 22 * 60, 0]], end: 99 } };
    rtm.rt.buses = [{ id: 'c:X3', label: 'X3', trip: id, ri, lat: hub.lat, lon: hub.lon, course: 0, speed: 0, ts: nowS, h: null, dir }];
    rtm.rt.at = Date.now(); rtm.rt.t = nowS;
    const p = rtm.predict({ min: f[0], si: f[1], trip: ti, r: ri, dir, day: 0 }), q = rtm.predict({ min: ns[0], si: ns[1], trip: nx, r: ri, dir, day: 0 });
    return [p && p.gone && p.held === ns[0] ? 'held' : JSON.stringify(p), q && q.keeps ? 'on time' : JSON.stringify(q)];
  }, pick);
  expect(r).toEqual(['held', 'on time']);
});

// The feed as it was seen misbehaving on 19 Oct, each made up from the timetable and staged on the relay (stageRelay).
/** What a stop's row of a trip at its timetable minute says, in the rows' own words (ui.js lively, liveWord): its word
 *  and its minute, ['Live · 5 min late', 920], ['Scheduled', 915]; ['gone'] or ['held'] for one that isn't coming. */
const rowSays = (page, trip, stop, min) => page.evaluate(async ([trip, stop, min]) => {
  const d = await import('/app/data.js'), t = await import('/app/time.js'), ui = await import('/app/ui.js');
  const ti = d.D.trips.indexOf(trip), row = d.timesOn(d.D.stopById[stop], t.now().ymd).find(x => x.trip === ti && x.min === min);
  const r = row && ui.lively({ ...row, day: 0 });
  return !r ? ['no row'] : r.gone ? [r.held !== undefined ? 'held' : 'gone'] : [r.live ? ui.liveWord(r) : 'Scheduled' + (r.onTime ? ' · on time' : ''), r.min];
}, [trip, stop, min]);
/** The relay's answer at its clock T in hand: once the app has polled it. */
const polled = (page, T) => expect.poll(() => page.evaluate(async () => (await import('/app/rt.js')).rt.t), { timeout: 20_000 }).toBe(T);
/** A trip's stops with its end, each [minute, id, lat, lon]. */
const stopsOf = (d, ti) => { const te = d.tripEnd(ti); return [...d.tripStops(ti), ...(te ? [[te.min, te.si]] : [])].map(([m, x]) => [m, d.D.stops[x].id, d.D.stops[x].lat, d.D.stops[x].lon]); };

test('an empty trip feed beside the buses: the last word stands for a minute and a half, then the buses\' places', WIDE, async ({ page }) => {
  // 2:42:00 PM, 19 Oct: the agency's trip feed came back its header alone, 15 bytes, beside all 20 buses, and the relay
  // passed it on as no trips: for that poll some 600 rows went from Live to the timetable or to a guess from the bus's
  // place. A route's trip under way, its bus 5 min late at its third stop, the rider at its sixth; then the same bus
  // and no trips; then a minute and a half on, still none.
  const relay = { T: 0, feed: null, alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const pick = await onBusDay(page, () => page.evaluate(async src => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), D = d.D, loops = D.hub.loops || [], seen = new Set();
    const stopsOf = new Function('return ' + src)();
    for (const [si] of D.stops.entries()) for (const row of d.timesOn(si, c.ymd)) {
      if (seen.has(row.trip) || loops.includes(row.r) || D.routes[row.r].op) continue;
      seen.add(row.trip);
      const st = d.tripStops(row.trip);
      if (!d.tripEnd(row.trip) || st.length < 7 || st[0][0] < 360 || st[st.length - 1][0] > 1380 || st[3][0] - st[2][0] < 1 || st[5][0] - st[2][0] < 3
        || D.stops[st[5][1]].hub || new Set(st.slice(0, 6).map(x => x[1])).size < 6) continue;
      return { id: D.trips[row.trip], pts: stopsOf(d, row.trip), at: Date.now() + ((st[2][0] + 5 - c.min) * 60 + 30 - c.sec) * 1000 };
    }
    return null;
  }, stopsOf.toString()));
  test.skip(!pick, 'no trip this week to make the feed of');
  const [m2, , lat, lon] = pick.pts[2], [m5, stop] = pick.pts[5], base = Math.floor(pick.at / 1000) - 30 - (m2 + 5) * 60;   // the day's minute 0
  const at = async (s, said) => {
    const T = relay.T = Math.floor(pick.at / 1000) + s;
    relay.feed = { t: T, now: T, buses: [{ id: '9001', label: '9001', trip: pick.id, lat, lon, bearing: 0, speed: 0, ts: T }],
      trips: said ? { [pick.id]: { v: '9001', ts: T, s: pick.pts.slice(3).map(([m, sid], i) => [sid, i + 3, base + (m + 5) * 60, 0]) } } : {} };
    await page.clock.setFixedTime(new Date(pick.at + s * 1000));
  };
  await at(0, true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await go(page, '#/stop/' + stop);
  await polled(page, relay.T);
  expect(await rowSays(page, pick.id, stop, m5)).toEqual(['Live · 5 min late', m5 + 5]);
  // The trip feed empty, the bus on its trip: the last word stands
  await at(6, false);
  await polled(page, relay.T);
  expect(await rowSays(page, pick.id, stop, m5)).toEqual(['Live · 5 min late', m5 + 5]);
  // Still empty a minute and a half after the last word: the feed is taken at it, the bus's place the word
  await at(96, false);
  await polled(page, relay.T);
  expect((await rowSays(page, pick.id, stop, m5))[0]).toMatch(/^Estimated · /);
});

test('the Center: a late bus\'s next run leaves when its bus is in, at the stops past it too, whatever the feed has for the run', WIDE, async ({ page }) => {
  // 19 Oct: the feed's word on a bus's next run is the timetable's (Route 1's 3:00 at 3:00:00, its bus not yet in). The
  // bay waited for the bus; the stops past it didn't: a run 8 min late out of the Center was 'Live · On time' a minute
  // out and the timetable's further on, and past its minute gone a minute out. A route's run from the Center, its bus
  // on the run before due in 8 min after its minute (not held for the next: rt.js holdOf), the clock 2½ min past it.
  const relay = { T: 0, feed: null, alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const pick = await onBusDay(page, () => page.evaluate(async src => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), D = d.D, loops = D.hub.loops || [];
    const stopsOf = new Function('return ' + src)();
    for (const [si, s] of D.stops.entries()) {
      if (!s.hub) continue;
      for (const row of d.timesOn(si, c.ymd)) {
        if (loops.includes(row.r) || D.routes[row.r].op) continue;
        const st = d.tripStops(row.trip), pv = d.prevTrip(row.trip, c.ymd), nx = d.nextTrip(row.trip, c.ymd);
        if (st[0][1] !== si || st[0][0] !== row.min || row.min < 420 || st.length < 5 || pv === undefined) continue;
        const pe = d.tripEnd(pv), pr = d.tripRoute(pv), ns = nx !== undefined ? d.tripStops(nx)[0] : null;
        if (!pe || !D.stops[pe.si].hub || !pr || pr.r !== row.r || d.tripStops(pv).length < 5 || row.min - pe.min < 0 || row.min - pe.min > 10 || (ns && ns[0] - row.min < 20)) continue;
        const k = st.findIndex(([m, x], i) => i > 0 && m >= row.min + 3 && !D.stops[x].hub);
        if (k < 0) continue;
        return { id: D.trips[row.trip], prev: D.trips[pv], start: row.min, pts: stopsOf(d, row.trip), was: stopsOf(d, pv), k, at: Date.now() + ((row.min + 2 - c.min) * 60 + 30 - c.sec) * 1000 };
      }
    }
    return null;
  }, stopsOf.toString()));
  test.skip(!pick, 'no run from the Center this week with its bus\'s run before it');
  const T = relay.T = Math.floor(pick.at / 1000), base = T - 30 - (pick.start + 2) * 60, late = pick.start + 8 - pick.was[pick.was.length - 1][0];
  // its bus on the run before, as late as that has it in 8 min after the run's minute, at the last stop it's been by
  const by = pick.was.filter(([m]) => base + (m + late) * 60 <= T), [, , lat, lon] = by[by.length - 1] || pick.was[0];
  relay.feed = { t: T, now: T, buses: [{ id: '9001', label: '9001', trip: pick.prev, lat, lon, bearing: 0, speed: 0, ts: T }], trips: {
    [pick.prev]: { v: '9001', ts: T, s: pick.was.map(([m, sid], i) => [sid, i, base + (m + late) * 60, 0]).filter(x => x[2] > T) },
    [pick.id]: { v: '9001', ts: T, s: pick.pts.map(([m, sid], i) => [sid, i, base + m * 60, 0]) },   // the timetable's, as the feed has a next run
  } };
  await page.clock.setFixedTime(new Date(pick.at));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await polled(page, T);
  const [m, stop] = pick.pts[pick.k];
  // its bay: when the bus gets in off the run before, worked out (rt.js inbound), so Estimated as the stops past it are
  expect(await rowSays(page, pick.id, pick.pts[0][1], pick.start)).toEqual(['Estimated · 8 min late', pick.start + 8]);
  expect(await rowSays(page, pick.id, stop, m)).toEqual(['Estimated · 8 min late', m + 8]);
});

test('the Center: a bus\'s next run timed by the feed from the run before is Estimated, at its bay and past it', WIDE, async ({ page }) => {
  // 3:36 PM, 20 Oct: Route 7's 4:00 'Live · 2 min late', its bus 4004 still out on its 3:30. Connect's feed times a bus's
  // next run from the run before (its bay at the minute that run gets in, every stop on as late): a minute carried on,
  // not word from a bus on it. A route's run from the Center, its bus out on the run before and due in 2 min after the
  // run's minute, the feed's word on the run that run's 2 min; the clock 10 min before the run.
  const relay = { T: 0, feed: null, alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const pick = await onBusDay(page, () => page.evaluate(async src => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), D = d.D, loops = D.hub.loops || [];
    const stopsOf = new Function('return ' + src)();
    for (const [si, s] of D.stops.entries()) {
      if (!s.hub) continue;
      for (const row of d.timesOn(si, c.ymd)) {
        if (loops.includes(row.r) || D.routes[row.r].op) continue;
        const st = d.tripStops(row.trip), pv = d.prevTrip(row.trip, c.ymd);
        if (st[0][1] !== si || st[0][0] !== row.min || row.min < 420 || st.length < 5 || pv === undefined) continue;
        const pe = d.tripEnd(pv), pr = d.tripRoute(pv), was = stopsOf(d, pv);
        if (!pe || !D.stops[pe.si].hub || !pr || pr.r !== row.r || was.length < 5 || row.min - pe.min < 0 || row.min - pe.min > 10) continue;
        // out on the run before by then, a stop or more past the Center
        const late = row.min + 2 - pe.min, by = was.filter(([m]) => m + late <= row.min - 10);
        if (by.length < 2 || by.length >= was.length - 1) continue;
        const k = st.findIndex(([, x], i) => i > 0 && !D.stops[x].hub);
        if (k < 0) continue;
        return { id: D.trips[row.trip], prev: D.trips[pv], start: row.min, pts: stopsOf(d, row.trip), was, late, by: by[by.length - 1], k, at: Date.now() + ((row.min - 10 - c.min) * 60 + 30 - c.sec) * 1000 };
      }
    }
    return null;
  }, stopsOf.toString()));
  test.skip(!pick, 'no run from the Center this week with its bus\'s run before it');
  const T = relay.T = Math.floor(pick.at / 1000), base = T - 30 - (pick.start - 10) * 60, [, , lat, lon] = pick.by;
  relay.feed = { t: T, now: T, buses: [{ id: '9001', label: '9001', trip: pick.prev, lat, lon, bearing: 0, speed: 0, ts: T }], trips: {
    [pick.prev]: { v: '9001', ts: T, s: pick.was.map(([m, sid], i) => [sid, i, base + (m + pick.late) * 60, 0]).filter(x => x[2] > T) },
    [pick.id]: { v: '9001', ts: T, s: pick.pts.map(([m, sid], i) => [sid, i, base + (m + 2) * 60, 0]) },   // the run before's 2 min, carried on
  } };
  await page.clock.setFixedTime(new Date(pick.at));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await polled(page, T);
  const [m, stop] = pick.pts[pick.k];
  expect(await rowSays(page, pick.id, pick.pts[0][1], pick.start)).toEqual(['Estimated · 2 min late', pick.start + 2]);   // its bay
  expect(await rowSays(page, pick.id, stop, m)).toEqual(['Estimated · 2 min late', m + 2]);
});

/** A numbered route's run out of the Center today, from 7 AM, its first two stops past the Center not at it, and no run
 *  of its after it for 20 min (nothing held for it: rt.js holdOf); the clock `after` seconds past its minute. */
const centreRun = (page, after) => page.evaluate(async ([src, after]) => {
  const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), D = d.D, loops = D.hub.loops || [];
  const stopsOf = new Function('return ' + src)();
  for (const [si, s] of D.stops.entries()) {
    if (!s.hub) continue;
    for (const row of d.timesOn(si, c.ymd)) {
      if (loops.includes(row.r) || D.routes[row.r].op) continue;
      const st = d.tripStops(row.trip), nx = d.nextTrip(row.trip, c.ymd), ns = nx !== undefined ? d.tripStops(nx)[0] : null;
      if (st[0][1] !== si || st[0][0] !== row.min || row.min < 420 || st.length < 5 || D.stops[st[1][1]].hub || D.stops[st[2][1]].hub || (ns && ns[0] - row.min < 20)) continue;
      return { id: D.trips[row.trip], start: row.min, pts: stopsOf(d, row.trip), at: Date.now() + ((row.min - c.min) * 60 + after - c.sec) * 1000 };
    }
  }
  return null;
}, [stopsOf.toString(), after]);
/** The relay's answer for that run `s` seconds past its minute: bus 9001 standing at its bay, the bay listed at its
 *  minute (so late by the clock: rt.js feedSays); or (`out`) pulled out, at its first stop past the Center and on its
 *  way, the bay gone from the feed's list and the stops on 3 min late. */
function bayFeed(run, s, out = false) {
  const T = Math.floor(run.at / 1000) + s, base = Math.floor(run.at / 1000) - run.start * 60;   // the day's minute 0, to the second
  const [, , lat, lon] = run.pts[out ? 1 : 0], [, , lat2, lon2] = run.pts[2];
  const bearing = Math.round(Math.atan2((lon2 - lon) * Math.cos(lat * Math.PI / 180), lat2 - lat) * 180 / Math.PI + 360) % 360;
  return { t: T, now: T, buses: [{ id: '9001', label: '9001', trip: run.id, lat, lon, bearing: out ? bearing : 0, speed: out ? 8 : 0, ts: T }],
    trips: { [run.id]: { v: '9001', ts: T, s: run.pts.map(([m, sid], i) => [sid, i, base + (m + (out && i ? 3 : 0)) * 60, 0]).slice(out ? 2 : 0) } } };
}

test('the Center\'s board follows the feed with the search box focused, its focus kept', async ({ page }, info) => {
  // 3:32 to 3:38 PM, 20 Oct: the board had Route 7's 3:30 'Live · 2 min late', in its bay, while the map took its bus
  // 4004 away down 100 East. With the focus in a box (the map's search on a phone, its keyboard put away with Back),
  // neither the feed nor the minute redrew the page: only the map's buses moved. A route's run, its bus in its bay 2½
  // min past its minute; the search box focused; then two minutes on, the bus still in.
  const relay = { T: 0, feed: null, alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const run = await onBusDay(page, () => centreRun(page, 150));
  test.skip(!run, 'no run from the Center this week');
  relay.feed = bayFeed(run, 0); relay.T = relay.feed.t;
  await page.clock.setFixedTime(new Date(run.at));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await go(page, '#/hub');
  await polled(page, relay.T);
  // its row's group at when it'll leave, by the feed: 2 min late, then 4
  const at = await page.evaluate(async m => { const t = await import('/app/time.js'); return [t.clock(m + 2).h, t.clock(m + 4).h]; }, run.start);
  const late = n => page.locator('.tcl-grp').filter({ visible: true }).filter({ has: page.locator('.tcl-late') }).locator('.tcl-grp-h b', { hasText: new RegExp('^about ' + at[n === 2 ? 0 : 1] + '$') });
  await expect(late(2)).toHaveCount(1);
  const box = page.locator(phone(info) ? '#mapsearch input' : '#topsearch input');
  await box.focus();
  relay.feed = bayFeed(run, 120); relay.T = relay.feed.t;
  await page.clock.setFixedTime(new Date(run.at + 120_000));
  await polled(page, relay.T);
  await expect(late(4)).toHaveCount(1);
  await expect(late(2)).toHaveCount(0);
  expect(await box.evaluate(b => document.activeElement === b)).toBe(true);   // and the rider still in the box
});

test('the Center back from the background: a bus that left while the app was away has left, not \'leaving now\'', WIDE, async ({ page }) => {
  // 3:36 PM, 20 Oct, back in the app: the 3:30s of five routes 'Live · 6 min late', leaving now, their buses gone while
  // it was away (hidden, it asks the feed nothing). Each bay gone from the feed since its last word was taken to have
  // just gone, and said 'now' for a minute more (rt.js LEFT_GRACE). A route's run, its bus in its bay 2½ min past its
  // minute; the app put away; back 2½ min later, the bus gone from the bay and out on its way.
  const relay = { T: 0, feed: null, alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const run = await onBusDay(page, () => centreRun(page, 150));
  test.skip(!run, 'no run from the Center this week');
  relay.feed = bayFeed(run, 0); relay.T = relay.feed.t;
  await page.clock.setFixedTime(new Date(run.at));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await go(page, '#/hub');
  await polled(page, relay.T);
  const late = page.locator('.tcl-late').filter({ visible: true });
  await expect(late).toHaveCount(1);
  const shown = v => page.evaluate(v => {
    for (const [k, get] of [['visibilityState', () => v], ['hidden', () => v === 'hidden']]) Object.defineProperty(document, k, { configurable: true, get });
    document.dispatchEvent(new Event('visibilitychange'));
  }, v);
  await shown('hidden');
  relay.feed = bayFeed(run, 150, true); relay.T = relay.feed.t;
  await page.clock.setFixedTime(new Date(run.at + 150_000));
  await page.waitForTimeout(1000);
  await shown('visible');
  await polled(page, relay.T);
  await expect(late).toHaveCount(0);
  // its row gone, as every list has it (time.js isGone), not leaving now 5 min late
  expect(await page.evaluate(async ([trip, stop, min]) => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), ui = await import('/app/ui.js'), ti = d.D.trips.indexOf(trip);
    const row = d.timesOn(d.D.stopById[stop], t.now().ymd).find(x => x.trip === ti && x.min === min);
    return t.isGone(ui.lively({ ...row, day: 0 }), t.now());
  }, [run.id, run.pts[0][1], run.start])).toBe(true);
});

test('a loop bus in early at the Center: the stops past it on the timetable from its minute, not the feed\'s long wait there', WIDE, async ({ page }) => {
  // 19 Oct, every loop trip of the day: the feed had the Blue Loop 13 minutes from its Center stop to 750 North Main, 2
  // by the timetable, and the Green 8 to the stop after its own, 1, every stop on as late. Bus 1174, in at 2:38 for its
  // 2:41, was 'Live 2:54' at 750 North Main; it left at 2:41 and was there at 2:45. A loop's trip, its bus in at its
  // Center stop 3 min early, the feed's stops past it 11 min on from there, as the Blue Loop's were.
  const relay = { T: 0, feed: null, alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const pick = await onBusDay(page, () => page.evaluate(async src => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), D = d.D, seen = new Set();
    const stopsOf = new Function('return ' + src)();
    for (const ri of D.hub.loops || []) for (const si of new Set(Object.values(D.routes[ri].stops || {}).flat())) for (const row of d.timesOn(si, c.ymd)) {
      if (row.r !== ri || seen.has(row.trip)) continue;
      seen.add(row.trip);
      const st = d.tripStops(row.trip), k = st.findIndex(([, x]) => D.stops[x].hub);
      if (k < 2 || k + 2 >= st.length || D.stops[st[k + 1][1]].hub || st[k][0] < 420 || st[k + 1][0] - st[k][0] > 3) continue;
      return { id: D.trips[row.trip], pts: stopsOf(d, row.trip), k, at: Date.now() + ((st[k][0] - 3 - c.min) * 60 + 30 - c.sec) * 1000 };
    }
    return null;
  }, stopsOf.toString()));
  test.skip(!pick, 'no loop trip this week');
  const T = relay.T = Math.floor(pick.at / 1000), [mk, , lat, lon] = pick.pts[pick.k];
  relay.feed = { t: T, now: T, buses: [{ id: '9001', label: '9001', trip: pick.id, lat, lon, bearing: 0, speed: 0, ts: T }], trips: {
    [pick.id]: { v: '9001', ts: T, s: pick.pts.map(([m, sid], i) => [sid, i, i === pick.k ? T - 10 : T - 10 + 680 + (m - mk) * 60, 0]).slice(pick.k) } } };
  await page.clock.setFixedTime(new Date(pick.at));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await polled(page, T);
  const [m, stop] = pick.pts[pick.k + 1];
  expect(await rowSays(page, pick.id, stop, m)).toEqual(['Scheduled', m]);
});

test('a loop\'s next run with no word on it from the feed: as late at the Center as its bus is into the run\'s start', WIDE, async ({ page }) => {
  // 2:42 PM, 19 Oct: the feed lost a Green Loop bus's trip and the one after it for a minute, the bus a minute late; the
  // Center's 3:35 was said to leave at 3:14, when the bus was due at the run's start, 750 North Main, 22 minutes before
  // the Center. A loop's run into its next, its bus 4 min late near the end of the first, the feed with nothing on the next.
  const relay = { T: 0, feed: null, alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const pick = await onBusDay(page, () => page.evaluate(async src => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), D = d.D, seen = new Set();
    const stopsOf = new Function('return ' + src)();
    for (const ri of D.hub.loops || []) for (const si of new Set(Object.values(D.routes[ri].stops || {}).flat())) for (const row of d.timesOn(si, c.ymd)) {
      if (row.r !== ri || seen.has(row.trip)) continue;
      seen.add(row.trip);
      const st = d.tripStops(row.trip), te = d.tripEnd(row.trip), nx = d.nextTrip(row.trip, c.ymd), nr = nx !== undefined ? d.tripRoute(nx) : null;
      if (!te || !nr || nr.r !== ri || st.length < 5 || st[0][0] < 420) continue;
      const ns = d.tripStops(nx), k = ns.findIndex(([, x]) => D.stops[x].hub);
      if (!ns.length || ns[0][1] !== te.si || ns[0][0] - te.min > 2 || k < 2 || ns[k][0] - ns[0][0] < 10) continue;
      const j = st.length - 2;
      return { id: D.trips[row.trip], next: D.trips[nx], pts: stopsOf(d, row.trip), j, hub: [ns[k][0], D.stops[ns[k][1]].id], at: Date.now() + ((st[j][0] + 4 - c.min) * 60 + 30 - c.sec) * 1000 };
    }
    return null;
  }, stopsOf.toString()));
  test.skip(!pick, 'no loop trip this week with one after it');
  const T = relay.T = Math.floor(pick.at / 1000), [mj, , lat, lon] = pick.pts[pick.j], base = T - 30 - (mj + 4) * 60;
  relay.feed = { t: T, now: T, buses: [{ id: '9001', label: '9001', trip: pick.id, lat, lon, bearing: 0, speed: 0, ts: T }], trips: {
    [pick.id]: { v: '9001', ts: T, s: pick.pts.map(([m, sid], i) => [sid, i, base + (m + 4) * 60, 0]).slice(pick.j + 1) } } };
  await page.clock.setFixedTime(new Date(pick.at));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await polled(page, T);
  const [m, stop] = pick.hub;
  expect(await rowSays(page, pick.next, stop, m)).toEqual(['Estimated', m + 4]);
});

test('a timed stop on the way: a bus ahead waits there, and it and the stops after it are on time, not the feed\'s minutes early', WIDE, async ({ page }) => {
  // 2:41 PM, 19 Oct (the user: 'look into the route 15 3 min early thing'): Route 15's bus out of Richmond 30 s early,
  // the feed running it on faster than the timetable, had Richard's Hall 'Live · 3 min early' for its 3:14, with five
  // timed stops between where it would wait. A route's trip (Route 15's where there's one), its bus 3 min early at the
  // stop before its first timed stop on the way, the feed 3 min early at every stop on.
  const relay = { T: 0, feed: null, alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const pick = await onBusDay(page, () => page.evaluate(async src => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), D = d.D, loops = D.hub.loops || [], seen = new Set();
    const stopsOf = new Function('return ' + src)();
    const routes = D.routes.map((r, ri) => ri).filter(ri => !loops.includes(ri) && !D.routes[ri].op).sort((a, b) => (D.routes[b].short === '15') - (D.routes[a].short === '15'));
    for (const ri of routes) for (const si of new Set(Object.values(D.routes[ri].stops || {}).flat())) for (const row of d.timesOn(si, c.ymd)) {
      if (row.r !== ri || seen.has(row.trip)) continue;
      seen.add(row.trip);
      const st = d.tripStops(row.trip), k = st.findIndex(([, x], i) => i >= 2 && d.timed(x, ri) && !D.stops[x].hub);
      if (k < 0 || k + 2 >= st.length || D.stops[st[k + 1][1]].hub || st[k][0] - st[k - 1][0] < 1 || st[k - 1][0] < 420) continue;
      return { id: D.trips[row.trip], pts: stopsOf(d, row.trip), k, at: Date.now() + ((st[k - 1][0] - 3 - c.min) * 60 + 30 - c.sec) * 1000 };
    }
    return null;
  }, stopsOf.toString()));
  test.skip(!pick, 'no route\'s trip this week with a timed stop on the way');
  const [mj, , lat, lon] = pick.pts[pick.k - 1], T = relay.T = Math.floor(pick.at / 1000), base = T - 30 - (mj - 3) * 60;   // the day's minute 0
  relay.feed = { t: T, now: T, buses: [{ id: '9001', label: '9001', trip: pick.id, lat, lon, bearing: 0, speed: 0, ts: T }], trips: {
    [pick.id]: { v: '9001', ts: T, s: pick.pts.map(([m, sid], i) => [sid, i, base + (m - 3) * 60, 0]).slice(pick.k) } } };
  await page.clock.setFixedTime(new Date(pick.at));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await polled(page, T);
  for (const [m, stop] of pick.pts.slice(pick.k, pick.k + 2)) expect(await rowSays(page, pick.id, stop, m)).toEqual(['Scheduled · on time', m]);
});

/** A route's trip (Route 15's where there's one) with a timed stop on the way, 300 m or more from the stop after it,
 *  and another timed stop after that: the bus 60% of the way on, 2½ min before the first's minute. */
const earlyPick = page => page.evaluate(async src => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), D = d.D, loops = D.hub.loops || [], seen = new Set();
    const stopsOf = new Function('return ' + src)();
    const routes = D.routes.map((r, ri) => ri).filter(ri => !loops.includes(ri) && !D.routes[ri].op).sort((a, b) => (D.routes[b].short === '15') - (D.routes[a].short === '15'));
    for (const ri of routes) for (const si of new Set(Object.values(D.routes[ri].stops || {}).flat())) for (const row of d.timesOn(si, c.ymd)) {
      if (row.r !== ri || seen.has(row.trip)) continue;
      seen.add(row.trip);
      const st = d.tripStops(row.trip), k = st.findIndex(([, x], i) => i >= 2 && d.timed(x, ri) && !D.stops[x].hub);
      if (k < 0 || k + 3 >= st.length || D.stops[st[k + 1][1]].hub || st[k + 1][0] - st[k][0] < 1 || st[k][0] < 420) continue;
      const a = D.stops[st[k][1]], b = D.stops[st[k + 1][1]];
      if (d.distance(a.lat, a.lon, b.lat, b.lon) < 300) continue;
      const k2 = st.findIndex(([, x], i) => i > k && d.timed(x, ri) && !D.stops[x].hub);   // the next timed stop, where it would have been held
      if (k2 < 0) continue;
      return { id: D.trips[row.trip], pts: stopsOf(d, row.trip), k, k2, at: Date.now() + ((st[k][0] - 3 - c.min) * 60 + 30 - c.sec) * 1000,
        spot: [a.lat + (b.lat - a.lat) * 0.6, a.lon + (b.lon - a.lon) * 0.6, d.bearing(a.lat, a.lon, b.lat, b.lon)] };
    }
    return null;
}, stopsOf.toString());

/** A bus gone by a timed stop early, seen twice (two tests below): `kept`, the feed lists the stops it has passed, stamped
 *  with when, as on the Blue Loop's trips (from where the timetable has the bus: the timed stop it went by); otherwise
 *  it has dropped them. */
async function goneEarly(page, kept) {
  // 7:23 PM, 30 Oct: Route 15's bus 1175 went by 781 S Main at 65 km/h for its 7:28, and by the timed stops after it
  // as early; of the trips that left one 2 min early or more over two weeks, most left the next as early (rt.js
  // watchEarly). Told the timetable's minute there, a rider found the bus gone. A route's trip (Route 15's where there's
  // one), its bus past its first timed stop on the way, 60% to the stop after, 2½ min before the timed stop's minute;
  // the feed 3 min early at every stop on.
  const relay = { T: 0, feed: null, alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const pick = await onBusDay(page, () => earlyPick(page));
  test.skip(!pick, 'no route\'s trip this week with a timed stop on the way');
  const [mk] = pick.pts[pick.k], T = relay.T = Math.floor(pick.at / 1000), base = T - 30 - (mk - 3) * 60;   // the day's minute 0
  const [lat, lon, bearing] = pick.spot;
  relay.feed = { t: T, now: T, buses: [{ id: '9001', label: '9001', trip: pick.id, lat, lon, bearing: Math.round(bearing), speed: 9, ts: T }], trips: {
    [pick.id]: { v: '9001', ts: T, s: pick.pts.map(([m, sid], i) => [sid, i, base + (m - 3) * 60 - (i <= pick.k ? 60 : 0), 0]).slice(kept ? pick.k : pick.k + 1) } } };
  await page.clock.setFixedTime(new Date(pick.at));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await polled(page, T);
  expect(await rowSays(page, pick.id, pick.pts[pick.k2][1], pick.pts[pick.k2][0])).toEqual(['Scheduled · on time', pick.pts[pick.k2][0]]);   // one look: nothing said yet
  // a second look, five seconds on, the bus further along: one look past a stop could be a bus waiting beyond its pole
  const [a, b] = [pick.pts[pick.k], pick.pts[pick.k + 1]], T2 = relay.T = T + 5;
  relay.feed = { ...relay.feed, t: T2, now: T2, buses: [{ ...relay.feed.buses[0], lat: a[2] + (b[2] - a[2]) * 0.75, lon: a[3] + (b[3] - a[3]) * 0.75, ts: T2 }] };
  await page.clock.setFixedTime(new Date(pick.at + 5000));
  await polled(page, T2);
  // the next stop and the next timed stop: the feed's minutes, 3 early, live; not held to the timetable's, on time
  for (const [m, stop] of [pick.pts[pick.k + 1], pick.pts[pick.k2]]) {
    const [word, min] = await rowSays(page, pick.id, stop, m);
    expect(word).toMatch(/early/);
    expect(min).toBeLessThan(m);
  }
  // its card: running early, gone by the timed stop at least 2 min early
  await go(page, '#/map');
  await mapReady(page);
  await go(page, '#/map/bus/c:9001?tap=1');
  await expect(page.locator('#mapcard .buscard')).toContainText(/Left .+ at least 2 min early, so it may be early at the stops ahead/);
}
test('a bus gone by a timed stop early: the stops after it the feed\'s, early, not held to their minutes, and its card says so', WIDE, ({ page }) => goneEarly(page, false));
test('a bus gone by a timed stop early, the feed still listing it as on the Blue Loop: the same', WIDE, ({ page }) => {
  // 4:28 PM, 2 Nov: bus 1171 went by 50 North Main for its 4:41; the feed stamped it 4:28:31 and kept it listed, stepping
  // on by the timetable, and nothing was said (the relay's rule and the app's waited for the feed to drop the stop).
  return goneEarly(page, true);
});

test('a route on an old timetable: no bus called early by it, and its card, route and timed stop say its times are old', PHONE, async ({ page }) => {
  // 2 Nov: CVTD's feed listed the Blue Loop with no trips (on a detour), and the nightly put its 21 Oct timetable back
  // (tools/keeproute.py, the route's 'kept'). Its buses went by 50 North Main 12 min before that timetable's minute. The
  // user, who dispatches: 'our times are old, so we don't know actually whether the bus is departing early on purpose
  // or not ... We should not word it in a way that blames the driver.' Every route marked so here, the bus as in the
  // test of a bus gone by a timed stop early, and the relay with it gone by early twice today.
  const relay = { T: 0, feed: null, early: [], alerts: () => [] };
  await stageRelay(page, relay);
  await page.route(/\/data\/cvtd\.json/, async r => { const res = await r.fetch(), j = await res.json(); for (const x of j.routes) x.kept = '2026-10-21'; await r.fulfill({ response: res, json: j }); });
  await open(page);
  const pick = await onBusDay(page, () => earlyPick(page));
  test.skip(!pick, 'no route\'s trip this week with a timed stop on the way');
  const [mk, sk] = pick.pts[pick.k], T = relay.T = Math.floor(pick.at / 1000), base = T - 30 - (mk - 3) * 60;
  const [lat, lon, bearing] = pick.spot;
  relay.feed = { t: T, now: T, buses: [{ id: '9001', label: '9001', trip: pick.id, lat, lon, bearing: Math.round(bearing), speed: 9, ts: T }], trips: {
    [pick.id]: { v: '9001', ts: T, s: pick.pts.map(([m, sid], i) => [sid, i, base + (m - 3) * 60, 0]).slice(pick.k + 1) } } };
  relay.early = [['9001', pick.id, '15', sk, mk, T - 20, 2]];
  await page.clock.setFixedTime(new Date(pick.at));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await polled(page, T);
  const [a, b] = [pick.pts[pick.k], pick.pts[pick.k + 1]], T2 = relay.T = T + 5;
  relay.feed = { ...relay.feed, t: T2, now: T2, buses: [{ ...relay.feed.buses[0], lat: a[2] + (b[2] - a[2]) * 0.75, lon: a[3] + (b[3] - a[3]) * 0.75, ts: T2 }] };
  await page.clock.setFixedTime(new Date(pick.at + 5000));
  await polled(page, T2);
  // its rows: Live, the feed's minute, and no word on early or late; nothing kept as left early
  const [word] = await rowSays(page, pick.id, pick.pts[pick.k2][1], pick.pts[pick.k2][0]);
  expect(word).toBe('Live');
  expect(await page.evaluate(async id => (await import('/app/rt.js')).leftEarly(id), pick.id)).toBeNull();
  await go(page, '#/map');
  await mapReady(page);
  await go(page, '#/map/bus/c:9001?tap=1');
  const card = page.locator('#mapcard .buscard');
  await expect(card).toContainText('Its times are from an old timetable (21 Oct), so we can\'t tell if this bus is early or on time.');
  await expect(card).not.toContainText(/min early|min late|Left /);
  const short = await page.evaluate(async id => { const d = await import('/app/data.js'); return d.D.routes[d.tripRoute(d.D.trips.indexOf(id)).r].short; }, pick.id);
  await go(page, '#/map/route/' + encodeURIComponent(short));
  await expect(page.locator('.rs-op').first()).toContainText('These times are from an old timetable (21 Oct) and may be off.');
  await go(page, '#/stop/' + pick.pts[pick.k2][1]);
  await expect(page.locator('.tpline').first()).toContainText('but its times here are from an old timetable (21 Oct) and may be off.');
});

test('a bus the relay saw go by a timed stop early: its stops ahead early from one look, and its card says how often today', WIDE, async ({ page }) => {
  // The relay keeps what it sees all day (worker/src/early.js): a phone opened after the bus went by knows, and the
  // card says how often today, as the user, who dispatches, asked: 'this bus missed this timepoint N times today'.
  const relay = { T: 0, feed: null, early: [], alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const pick = await onBusDay(page, () => earlyPick(page));
  test.skip(!pick, 'no route\'s trip this week with a timed stop on the way');
  const [mk, sk] = pick.pts[pick.k], T = relay.T = Math.floor(pick.at / 1000), base = T - 30 - (mk - 3) * 60;
  const [lat, lon, bearing] = pick.spot;
  relay.feed = { t: T, now: T, buses: [{ id: '9001', label: '9001', trip: pick.id, lat, lon, bearing: Math.round(bearing), speed: 9, ts: T }], trips: {
    [pick.id]: { v: '9001', ts: T, s: pick.pts.map(([m, sid], i) => [sid, i, base + (m - 3) * 60, 0]).slice(pick.k + 1) } } };
  relay.early = [['9001', 'an-earlier-run', '15', sk, mk - 60, T - 3600, 3], ['9001', pick.id, '15', sk, mk, T - 20, 2]];
  await page.clock.setFixedTime(new Date(pick.at));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await polled(page, T);
  // one look of its own: the relay's word does, the next timed stop the feed's early minute
  await expect.poll(async () => (await rowSays(page, pick.id, pick.pts[pick.k2][1], pick.pts[pick.k2][0]))[0], { timeout: 10_000 }).toMatch(/early/);
  await go(page, '#/map');
  await mapReady(page);
  await go(page, '#/map/bus/c:9001?tap=1');
  const card = page.locator('#mapcard .buscard');
  await expect(card).toContainText(/Left .+ at least 2 min early/);
  await expect(card).toContainText(/Left .+ early twice today/);
});

test('a closed stop tapped on a phone: its closure in the card as it opens, not a swipe up away', PHONE, async ({ page }) => {
  // A closure of its own, every route of a stop: the day's notices come and go (520 West 100 North's, 2-6 Nov, taken
  // down from Connect on the 2nd while the file still had it, and the card, by the relay's, showed none).
  const id = await stageClosure(page);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await go(page, '#/map/' + id);
  const lead = page.locator('#mapcard .callout.alert b').first();
  await expect(lead).toBeVisible();
  await page.waitForTimeout(1200);   // the card's opening slide
  // what's at the headline's middle is the headline: in the card as it opens, above the tabs
  const hit = await lead.evaluate(b => { const r = b.getBoundingClientRect(), el = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 12)); return !!el && (b === el || b.contains(el)); });
  expect(hit).toBe(true);
});

test('a stop\'s card on a phone, as the Center\'s board: rests at its next bus, folds to its head, and goes', PHONE, async ({ page }) => {
  await open(page);
  const id = await page.evaluate(async () => { const d = await import('/app/data.js'); return d.D.stops.find(s => !s.hub && s.routes.length && !s.out).id; });
  await go(page, '#/map/' + id);
  await mapReady(page);
  const card = page.locator('#mapcard');
  await expect(card).toHaveClass(/open/);
  await page.waitForTimeout(800);
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (y0, y1) => {
    const x = 200, steps = 8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * i / steps }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(500);
  };
  const room = () => card.evaluate(c => parseFloat(c.style.getPropertyValue('--hub-room')));
  const grip = async () => (await card.locator('.grip').boundingBox()).y + 30;
  const rest = await room();
  expect(rest).toBeGreaterThan(0);   // resting partway up, the map above it
  await swipe(await grip(), (await grip()) + 150);   // down at its top: folded to its head
  await expect(card).toHaveClass(/hubfold/);
  expect(await room()).toBeGreaterThanOrEqual(rest);   // (a stop with no bus to come rests at its head already)
  await page.mouse.click(200, (await grip()) + 40);   // a tap on it: open again
  await expect(card).not.toHaveClass(/hubfold/);
  await still(card.locator('.grip'));   // slid back up to its next bus (a third of a second): the swipe starts where it rests
  await swipe(await grip(), (await grip()) + 150);
  await expect(card).toHaveClass(/hubfold/);
  await swipe(await grip(), (await grip()) + 150);   // folded, down again: put away
  await expect(card).not.toHaveClass(/\bopen\b/);
  await expect(page).toHaveURL(/#\/map$/);
});

test('a route\'s card on a phone, as the board: rests at its first stops, folds to its head, and goes; a POOL pickup\'s swipe up goes nowhere', PHONE, async ({ page }) => {
  await open(page, '#/map/route/2');
  await mapReady(page);
  const card = page.locator('#mapcard');
  await expect(card.locator('.routesheet')).toBeVisible();
  await page.waitForTimeout(800);
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (y0, y1) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: y0 }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: y0 + (y1 - y0) * i / 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(500);
  };
  const grip = async () => (await card.locator('.grip').boundingBox()).y + 30;
  const rest = await card.evaluate(c => parseFloat(c.style.getPropertyValue('--hub-room')));
  expect(rest).toBeGreaterThan(0);
  await swipe(await grip(), (await grip()) + 150);
  await expect(card).toHaveClass(/hubfold/);
  expect(await card.evaluate(c => parseFloat(c.style.getPropertyValue('--hub-room')))).toBeGreaterThan(rest);
  await swipe(await grip(), (await grip()) + 150);
  await expect(card).not.toHaveClass(/\bopen\b/);
  await expect(page).toHaveURL(/#\/map$/);
  // POOL's card: its first button is the booking app, and a swipe up went off to the app store
  const pool = await page.evaluate(async () => {
    const d = await import('/app/data.js'), m = await import('/app/views/map.js');
    const s = d.POOL && d.POOL.stops.find(x => x.stop === null || x.stop === undefined || x.stop < 0);
    if (!s) return null;
    m.selectPool(s.id, window.__app);   // as a tap on its badge on the map
    return s.id;
  });
  test.skip(!pool, 'no POOL pickups of their own');
  await expect(card.locator('.open a').first()).toBeVisible();
  const before = page.url();
  const g = await grip();
  await swipe(g + 80, g - 120);
  expect(page.url()).toBe(before);
});

test('the map\'s search over its card: the Center\'s board raised on a phone, a spot\'s card on a narrow wide screen', async ({ page }, info) => {
  // Both at the same height, the card after the results in the page: a raised board, reaching up under the search
  // bar, covered every row, and a tap on one landed on the board. A wide screen's card in its corner did the same to
  // the rows across it, the window narrow enough for the two to meet.
  if (!phone(info)) await page.setViewportSize({ width: 900, height: 700 });
  await open(page, phone(info) ? '#/hub' : '#/map/at/41.73450,-111.83457');
  await mapReady(page);
  const card = page.locator('#mapcard.open');
  await expect(card).toBeVisible();
  if (phone(info)) await card.evaluate(c => { c.scrollTop = c.scrollHeight; });   // the board up as far as it goes
  const input = page.locator(phone(info) ? '#mapsearch input' : '#topsearch input');
  await input.click();
  await input.fill('main');
  await expect(page.locator('#mapresults a.stoprow').filter({ visible: true }).first()).toBeVisible();
  await page.waitForTimeout(500);   // (their next buses filled in after)
  // A row over the card, its middle where the two meet, in the list's own scroll and not past its foot
  const c = await card.boundingBox(), res = await page.locator('#mapresults').boundingBox();
  const at = await page.locator('#mapresults a.stoprow').evaluateAll((rows, [c, res]) => {
    for (const [i, r] of rows.map(a => a.getBoundingClientRect()).entries()) {
      const x = (Math.max(r.left, c.x) + Math.min(r.right, c.x + c.width)) / 2, y = (r.top + r.bottom) / 2;
      if (r.width && y > c.y + 10 && y < res.y + res.height - 10 && x > c.x + 10) return { i, x, y };
    }
    return null;
  }, [c, res]);
  expect(at, 'a row over the card').not.toBeNull();
  const on = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('#mapresults'), at);
  expect(on, 'the row, not the card, under a tap').toBe(true);
  const row = page.locator('#mapresults a.stoprow').nth(at.i), id = (await row.getAttribute('href')).split('/').pop();
  await page.mouse.click(at.x, at.y);
  await expect(page).toHaveURL(new RegExp(id));
});

test('a stop every route of it skips by notice says Closed in its row, not the first bus after', PHONE, async ({ page }) => {
  // One made so, whatever Connect has up: every route of a stop named by a notice in force through the day after
  // tomorrow (with none of Connect's up, it checked nothing). Its row, and any other closed today, says so.
  const id = await stageClosure(page);
  const r = await page.evaluate(async id => {
    const d = await import('/app/data.js'), ui = await import('/app/ui.js'), t = await import('/app/time.js');
    await d.loadAlerts({ relay: false });
    const c = t.now(), shut = d.D.stops.map((s, i) => i).filter(i => d.closedThrough(i, c.ymd) !== null);
    return { staged: ui.stopRow(d.D.stopById[id], d.nextAt(d.D.stopById[id], 1, c)[0], c).s, all: shut.map(i => ui.stopRow(i, d.nextAt(i, 1, c)[0], c).s.includes('Closed')) };
  }, id);
  expect(r.staged).toMatch(/class="end closedend"><span class="t t-22">Closed<\/span><span class="rel">through \w+<\/span><\/div>/);   // in the time's place, none after it
  expect(r.all.length).toBeGreaterThan(0);
  expect(r.all.every(Boolean)).toBe(true);
});

test('routes list: from the home page\'s Routes line, every route, one opened', PHONE, async ({ page }) => {
  await open(page);
  await page.locator('a[href="#/routes"]').filter({ visible: true }).first().click();   // a phone's line (a wide screen has the chips)
  await expect(page).toHaveURL(/#\/routes$/);
  await expect(page.locator('a.row[href^="#/map/route/"]')).not.toHaveCount(0);
  await expect(page.locator('a.row[href^="#/usu/route/"]').filter({ visible: true }).first()).toBeVisible();
  await page.locator('a.row[href="#/map/route/5"]').click();
  await expect(page).toHaveURL(/#\/map\/route\/5/);
  await expect(page.getByText('Route 5').filter({ visible: true }).first()).toBeVisible();
});

test('directions from out of a walk of any stop, on a phone: swiped down, the card goes down to its head and stays, then leaves', PHONE, async ({ page }) => {
  // From north of Franklin, Idaho, to the Transit Center: the card lists the stops to drive to. A swipe down hid it,
  // and the next redraw (the feed's tick, the minute) put it back up; there was no way to see the map under it.
  // A weekday morning, no feed: on the clock it ran on, a Saturday's evening had no runs left to drive to (21 Nov 2026).
  await page.route(/^https:\/\/live\.cacherider\.com\//, r => r.abort());
  const d = new Date(); do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); d.setHours(9, 0, 0, 0);
  await page.clock.setFixedTime(d);
  await open(page, '#/');
  await go(page, '#/go/10628498/at/42.03000,-111.87400/North%20of%20Franklin');
  await mapReady(page);
  const card = page.locator('#mapcard');
  await expect(card.locator('.gonone .farstarts .row').first()).toBeVisible({ timeout: 20_000 });
  await expect(card.locator('.farstarts .row .sub').first()).toContainText(/-min drive · leaves/);
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (y0, y1) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: y0 }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: y0 + (y1 - y0) * i / 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(600);
  };
  const grip = async () => (await card.locator('.grip').boundingBox()).y + 20;
  const tall = (await card.boundingBox()).height;
  await swipe(await grip(), (await grip()) + 150);
  await expect(card).toHaveClass(/\bopen\b/);
  expect(await card.evaluate(c => c.dataset.min)).toBe('1');
  expect((await card.boundingBox()).height).toBeLessThan(tall / 2);
  // A redraw, as the feed's tick makes: still down to its head, not back up
  await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
  await page.waitForTimeout(1500);
  await expect(card).toHaveClass(/\bopen\b/);
  expect(await card.evaluate(c => c.dataset.min)).toBe('1');
  await swipe(await grip(), (await grip()) + 150);
  await expect(page).toHaveURL(/#\/$/);
});

test('the Pumpkin Walk: its page, its nights, and its tab while the season lasts', async ({ page }) => {
  // The real feed's, whatever the date: the page stands with a season or without (a route gone from the timetable says
  // so); while one is on, its tab is there and lit on its page, its line's two stops each with their next, its nights
  // listed, and a stop of it opens. On a phone it opens raised, its title at the top and the countdowns it rests at
  // scrolled off; 'See the route on the map' lowers it to them, and a tap on them raises it again. The link sits below
  // the far stop's next times, not over them (the line was a fixed 300 px, its far stop's kicker on two lines).
  await open(page, '#/pumpkin');
  await expect(page.getByRole('heading', { name: 'Pumpkin Walk' })).toBeAttached();
  const tab = page.locator('#tabs a[href="#/pumpkin"], #topnav a[href="#/pumpkin"]').filter({ visible: true });
  if (await tab.count()) {
    await expect(tab.first()).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.pk-line .pk-lstop')).toHaveCount(2);
    const link = page.locator('.pk-maplink').filter({ visible: true }), then = page.locator('.pk-lstop.foot .pk-lthen').filter({ visible: true });
    if (await link.count() && await then.count())
      expect((await link.boundingBox()).y).toBeGreaterThanOrEqual((await then.boundingBox()).y + (await then.boundingBox()).height - 1);
    const fold = page.locator('#mapcard .pk-fold');
    if (await fold.count() && await fold.evaluate(f => getComputedStyle(f).display !== 'none')) {
      await expect(page.locator('#mapcard .pk-title')).toBeInViewport();
      await expect(fold).not.toBeInViewport({ ratio: 0.1 });   // (its last pixel or two under the search bar)
      await link.click();
      await expect(fold).toBeInViewport();
      await expect(fold.locator('.pk-fcol')).toHaveCount(2);
      await fold.click();
      await expect(page.locator('#mapcard .pk-title')).toBeInViewport();
    }
    await expect(page.locator('.pk-day').first()).toBeAttached();
    await page.locator('.pk-lplace').filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/#\/stop\//);
  }
});

test('a season\'s route goes with its season: the Pumpkin Walk off the home page\'s routes, the map, the routes list and search after its last night', WIDE, async ({ page }) => {
  // The routes at the foot of a wide screen's home page kept the Walk after its season (the bug this was written for).
  // Its nights staged as one, a week from now, whatever the feed's are: that evening it's on the home page's routes, the
  // routes list, in search, on the map and has its tab; the next noon none of them, its two stops gone from the map and
  // search too. And a timetable run out (every one of Connect's calendars ended that night, the next not in) isn't every
  // route's season over: the next noon the routes are all still there. Out of its season the feed hasn't the Walk at
  // all: a weeknight of it as Connect's feed had it (pumpkin-walk.json) is put in, so this runs all year.
  const day = new Date(Date.now() + 7 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Denver' }).replace(/-/g, '');
  const pk = require('./pumpkin-walk.json'), real = await (await page.request.get('/data/cvtd.json')).json();
  const walkIn = real.routes.some(x => /^pumpkin/i.test(x.short)) ? null : real.routes.length;   // where it's put in, when it is
  let runOut = false;
  await page.route(/\/data\/cvtd-shapes\.json/, async r => {
    const j = await (await r.fetch()).json();
    if (walkIn !== null) j.lines.push({ ...pk.line, route: walkIn });
    await r.fulfill({ json: j });
  });
  await page.route(/\/data\/cvtd\.json/, async r => {
    const j = await (await r.fetch()).json();
    if (walkIn !== null) {   // its route, its two stops, its runs (on a calendar of its own, the night), their ends
      const si = Object.fromEntries(pk.stops.map((x, k) => [x.id, j.stops.length + k])), h = j.headsigns.length;
      j.routes.push({ ...pk.route, stops: Object.fromEntries(Object.entries(pk.route.stops).map(([dir, ids]) => [dir, ids.map(id => si[id])])) });
      j.stops.push(...pk.stops.map(x => ({ ...x, routes: [walkIn] })));
      j.headsigns.push(pk.rows[pk.stops[0].id][0][1]);
      const ti = {};
      for (const [id, [sid, min]] of Object.entries(pk.ends)) { ti[id] = j.trips.length; j.trips.push(id); j.ends.push(si[sid], min); }
      for (const [sid, rows] of Object.entries(pk.rows)) j.times[si[sid]] = { WALK: rows.map(([min, , dir, id]) => [min, walkIn, h, dir, ti[id]]) };
    }
    const ri = j.routes.findIndex(x => /^pumpkin/i.test(x.short));
    const n = {};   // its rows by calendar: the fullest one's are its night
    for (const per of Object.values(j.times)) for (const [sid, rows] of Object.entries(per)) n[sid] = (n[sid] || 0) + rows.filter(t => t[1] === ri).length;
    const from = Object.keys(n).sort((x, y) => n[y] - n[x])[0];
    if (ri >= 0 && n[from] > 0) {
      j.services.push({ id: 'SEASON', days: [1, 1, 1, 1, 1, 1, 1], start: day, end: day, desc: 'Season' });
      for (const per of Object.values(j.times)) {
        const night = (per[from] || []).filter(t => t[1] === ri);
        for (const sid in per) per[sid] = per[sid].filter(t => t[1] !== ri);
        if (night.length) per.SEASON = night;
      }
    }
    const ops = new Set(j.routes.filter(x => x.op).map(x => x.op.service));
    if (runOut) for (const sv of j.services) if (!ops.has(sv.id) && sv.end > day) sv.end = day;
    await r.fulfill({ json: j });
  });
  await page.route(/^https:\/\/live\.cacherider\.com\//, r => r.abort());
  await open(page);
  const s = await page.evaluate(async day => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), ri = d.D.routes.findIndex(r => /^pumpkin/i.test(r.short));
    const ms = (ymd, h) => new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6), h).getTime();   // the agency's clock (the browser's zone)
    return { ri, href: '#/map/route/' + encodeURIComponent(d.D.routes[ri].short), stops: [...new Set(Object.values(d.D.routes[ri].stops).flat())].map(si => d.D.stops[si].id),
      evening: ms(day, 19), after: ms(t.dayFrom(day, 1).ymd, 12) };
  }, day);
  /** On the map: its lines, its stops drawn, and Route 1's lines. */
  const drawn = () => page.evaluate(s => import('/app/data.js').then(d => { const m = window.__map, l = m && m.getSource('lines'), st = m && m.getSource('stops');
    if (!l || !st || !l.serialize().data.features.length) return null;
    const fs = l.serialize().data.features;
    return [fs.some(f => f.properties.route === s.ri), st.serialize().data.features.filter(f => s.stops.includes(f.properties.id)).length, fs.some(f => f.properties.route === d.D.routeByShort['1'])]; }), s);
  const found = () => page.evaluate(async () => (await import('/app/data.js')).search('pumpkin walk').length);
  const tab = page.locator('#tabs a[href="#/pumpkin"], #topnav a[href="#/pumpkin"]').filter({ visible: true });
  for (const [when, on, out] of [[s.evening, true, false], [s.after, false, false], [s.after, true, true]]) {
    runOut = out;
    await page.clock.setFixedTime(new Date(when));
    await page.goto('about:blank');   // a load of its own, the timetable fetched again (a hash alone keeps the page)
    await open(page, '#/');
    await expect(page.locator('#side .routes a[href="#/map/route/1"]')).toHaveCount(1);   // the home page's routes
    await expect(page.locator('#side .routes a[href="#/pumpkin"]')).toHaveCount(on ? 1 : 0);   // the Walk's opens its page
    await go(page, '#/routes');
    await expect(page.locator('a.row[href="#/map/route/1"]')).toHaveCount(1);
    await expect(page.locator(`a.row[href="${s.href}"]`)).toHaveCount(on ? 1 : 0);
    if (!out) await expect(tab).toHaveCount(on ? 1 : 0);   // (a run-out timetable's has no night to come: no tab)
    expect(await found() > 0).toBe(on);
    await go(page, '#/map');
    await mapReady(page);
    await expect.poll(drawn, { timeout: 20_000 }).toEqual(on ? [true, s.stops.length, true] : [false, 0, true]);
  }
});

// ---- The holidays (app/holiday.js): their dressing by the date, every year, in the agency's local dates; the day's
// card in place of 'No buses today' on the day itself. Staged by the clock alone: the timetable is the real one.
/** The agency's noon on a day ('2026-11-25'), in its winter time. */
const noon = ymd => new Date(ymd + 'T12:00:00-07:00');
/** A day k days on from another, each 'yyyy-mm-dd'. */
const dayOn = (ymd, k) => new Date(Date.parse(ymd + 'T12:00:00Z') + k * 864e5).toISOString().slice(0, 10);
/** The holidays to stage, worked out from today, so the tests hold every year: the next Thanksgiving (the fourth
 *  Thursday of November, 'yyyy-mm-dd') and the next Christmas season (1 to 26 December: its year) whose first day
 *  staged (the Monday of its week; 30 November) is after today and one the timetable covers (Connect now and then
 *  publishes a timetable ahead, starting after today: a day staged before it has no buses to be back by). `xmas1`:
 *  Christmas's first day that year, the 1st, or the day after Thanksgiving's week where that runs into December. */
async function holidays(page) {
  const j = await (await page.request.get('/data/cvtd.json')).json(), ops = new Set(j.routes.filter(r => r.op).map(r => r.op.service));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  const first = j.services.filter(x => !ops.has(x.id)).map(x => x.start.replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3')).sort()[0];
  const from = [dayOn(today, 1), first].sort()[1];
  const tg = y => { const nov = new Date(Date.UTC(y, 10, 1)).getUTCDay(); return dayOn(y + '-11-01', (4 - nov + 7) % 7 + 21); };
  let y = +today.slice(0, 4), x = y;
  while (dayOn(tg(y), -3) < from) y++;
  while (x + '-11-30' < from) x++;
  const xmas1 = [x + '-12-01', dayOn(tg(x), 4)].sort()[1];
  return { thanksgiving: tg(y), christmas: x, xmas1 };
}
/** A stop with buses after today, and its first after today as a stop's card says it ('Back Saturday · first bus',
 *  '10:15 AM'), by the timetable; and the Center's first pulse after today, as its card says it. `hubRuns`: a bus leaves
 *  the Center today all the same, another operator's (tools/prt.json keeps PRT's holidays by hand, a year at a time:
 *  its 2027 ones weren't posted yet in November 2026), so its board has that bus, not the card. */
async function backTimes(page) {
  return page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now();
    const say = (b, what) => ({ words: 'Back ' + t.dayName(b.ymd) + ' · ' + what, time: t.clockText(b.min) });
    const si = d.D.stops.findIndex((s, i) => !s.hub && !s.out && s.routes.length && d.nextAt(i, 7, c).some(x => x.day > 0));
    return { stop: d.D.stops[si].id, atStop: say(d.nextAt(si, 7, c).find(x => x.day > 0), 'first bus'), atHub: say(d.nextPulse(1, c)[0], 'first pulse'),
      hubRuns: d.D.hub.bays.some(b => d.timesOn(b.stop, c.ymd).length > 0) };
  });
}
/** The Center's board on a day without the agency's buses where another operator's still leaves it (backTimes hubRuns):
 *  that bus's line, no day's card. */
async function hubOthers(page) {
  await expect(page.locator('a.tcl-row').filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('.holcard')).toHaveCount(0);
}
/** The season's dressing over the map: which one is up, and whether it's drawn. */
const deco = page => page.evaluate(() => { const d = document.getElementById('hol-deco'), s = d && d.querySelector('.hol-swag'); return { season: document.documentElement.dataset.season || null, on: d ? d.dataset.s : null, shown: !!s && s.getBoundingClientRect().height > 0 }; });
/** A tap anywhere along the dressing is the map's: what's under each point of it is never the dressing. */
async function tapsThrough(page, swag) {
  const box = await swag.boundingBox();
  const hits = await page.evaluate(({ x, y, width: w, height: h }) => [0.1, 0.3, 0.5, 0.7, 0.9].flatMap(f => [0.3, 0.6, 0.9].map(g => { const e = document.elementFromPoint(x + w * f, y + h * g); return !!e && !!e.closest('#hol-deco'); })), box);
  expect(hits.every(h => !h)).toBe(true);
  expect(await swag.evaluate(e => getComputedStyle(e.closest('#hol-deco')).pointerEvents)).toBe('none');
  expect(await page.evaluate(() => +getComputedStyle(document.getElementById('hol-deco')).zIndex)).toBeLessThan(450);   // under the map's buttons and search
}
/** The dressing hung where it goes: from the bottom of a phone's search box (its line `drop` down its box), along the
 *  top of a wide screen's map, the map's width either way. */
async function hungRight(page, swag, info, drop) {
  const box = await swag.boundingBox(), map = await page.locator('#map').boundingBox();
  if (phone(info)) {
    const bar = await page.locator('.mapbar').filter({ visible: true }).first().boundingBox();
    expect(Math.abs(box.y + drop - (bar.y + bar.height))).toBeLessThan(4);
  } else expect(Math.abs(box.y + drop - map.y)).toBeLessThan(4);
  expect(box.width).toBeGreaterThanOrEqual(map.width - (phone(info) ? 0 : 420) - 1);   // a wide screen's beside the page
}

test('Thanksgiving: the garland on the map from the Monday of its week, never in the way of a tap, and no card while the buses run', async ({ page }, info) => {
  // Aaron's sketch: a twine swag of leaves, wheat and two gourds hung from the bottom of a phone's search box (along the
  // top of a wide screen's map). The Monday of Thanksgiving week ('should we do the full week?'), noon: up on the map,
  // and still beside a stop and the Center; its taps go through to the map; a stop's page and the Center's board run
  // as ever, no card.
  const { thanksgiving: tg } = await holidays(page);
  await page.clock.setFixedTime(noon(dayOn(tg, -3)));
  await open(page, '#/map');
  await mapReady(page);
  expect(await deco(page)).toEqual({ season: 'thanksgiving', on: 'thanksgiving', shown: true });
  const swag = page.locator('#hol-deco .hol-garland');
  await hungRight(page, swag, info, 16);   // its twine 16 down its stretch
  await tapsThrough(page, swag);
  const t = await backTimes(page);
  await go(page, '#/stop/' + t.stop);
  await expect(page.locator('.stop-page').filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('.holcard')).toHaveCount(0);
  expect((await deco(page)).shown).toBe(true);
  await go(page, '#/hub');
  await expect(page.locator('.tcl, .tc-together').filter({ visible: true }).first()).toBeAttached();
  await expect(page.locator('.holcard')).toHaveCount(0);
});

/** Thanksgiving's card at a stop and at the Center (or, where another operator's bus leaves the Center that day, its
 *  board): 'No buses today', why and the greeting (`said`), and when they're back, from the timetable. */
async function tgCard(page, t, said) {
  for (const [hash, back] of [['#/stop/' + t.stop, t.atStop], ['#/hub', t.atHub]]) {
    await go(page, hash);
    if (hash === '#/hub' && t.hubRuns) { await hubOthers(page); continue; }
    const card = page.locator('.holcard.hol-thanksgiving').first();
    await expect(card).toBeAttached();
    await expect(card.locator('svg.hol-art')).toHaveAttribute('role', 'img');
    await expect(card.locator('svg.hol-art')).toHaveAttribute('aria-label', /^Golden hour over the Wellsvilles/);
    await expect(card.locator('.holcard-h')).toHaveText('No buses today');
    await expect(card.locator('p')).toHaveText(said);
    await expect(card.locator('.holcard-back span')).toHaveText(back.words);
    await expect(card.locator('.holcard-back b')).toHaveText(back.time);
    await expect(page.locator('.holcard')).toHaveCount(1);
    await expect(page.locator('.callout, .tcl-note').filter({ hasText: 'No buses today' })).toHaveCount(0);
  }
}

test('Thanksgiving Day: its card at a stop and at the Center, back at the timetable\'s first bus and first pulse', PHONE, async ({ page }) => {
  // Thanksgiving Day: 'No buses today', 'Connect doesn't run on Thanksgiving Day. Happy Thanksgiving!', and when
  // they're back, from the timetable, never written in: at a stop its first bus after today, at the Center the first
  // pulse (the feed of 2026 took that Friday off too, so it was Saturday's). In the plain callout's place.
  const { thanksgiving: tg } = await holidays(page);
  await page.clock.setFixedTime(noon(tg));
  await open(page);
  await tgCard(page, await backTimes(page), "Connect doesn't run on Thanksgiving Day. Happy Thanksgiving!");
  expect((await deco(page)).season).toBe('thanksgiving');
  expect(await page.evaluate(() => document.body.innerText.includes('—'))).toBe(false);   // no em dash
});

test('Thanksgiving goes by itself: the Friday after, its card where the buses are off; the Sunday, the garland; the Monday, none of it', PHONE, async ({ page }) => {
  // Aaron: 'yes do it' (the day after's card) 'and should we do the full week?'. The season is Thanksgiving's week, its
  // Monday to the Sunday after. The Friday after, the buses off (the feed of 2026 took it off), is Thanksgiving's card,
  // said as the day after; a Friday they run, no card. The Sunday, the season's last day: the garland's up. The Monday
  // after, noon: no garland, no season.
  const { thanksgiving: tg } = await holidays(page);
  await page.clock.setFixedTime(noon(dayOn(tg, 1)));
  await open(page, '#/map');
  await mapReady(page);
  expect(await deco(page)).toEqual({ season: 'thanksgiving', on: 'thanksgiving', shown: true });
  // the season's edges, by the rule: the Sunday before and the Monday after out, the Monday and the Sunday in
  expect(await page.evaluate(async ds => { const h = await import('/app/holiday.js'); return ds.map(ymd => h.holidaySeason({ ymd: ymd.replace(/-/g, '') })); },
    [-4, -3, 3, 4].map(k => dayOn(tg, k)))).toEqual([null, 'thanksgiving', 'thanksgiving', null]);
  const t = await backTimes(page);
  const off = await page.evaluate(async () => !(await import('/app/data.js')).agencyRuns((await import('/app/time.js')).now().ymd));
  if (off) await tgCard(page, t, "Connect doesn't run on the day after Thanksgiving. Happy Thanksgiving!");
  else {
    await go(page, '#/stop/' + t.stop);
    await expect(page.locator('.stop-page').filter({ visible: true }).first()).toBeVisible();
    await expect(page.locator('.holcard')).toHaveCount(0);
  }
  await page.clock.setFixedTime(noon(dayOn(tg, 3)));
  await page.goto('about:blank');
  await open(page, '#/map');
  await mapReady(page);
  expect(await deco(page)).toEqual({ season: 'thanksgiving', on: 'thanksgiving', shown: true });
  await page.clock.setFixedTime(noon(dayOn(tg, 4)));
  await page.goto('about:blank');
  await open(page, '#/map');
  await mapReady(page);
  expect(await deco(page)).toEqual({ season: null, on: null, shown: false });
  await go(page, '#/stop/' + t.stop);
  await expect(page.locator('.stop-page').filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('.holcard')).toHaveCount(0);
});

/** A Connect bus staged on a trip running at the clock's time, between two of its stops (the feed's word on it as
 *  well): its id, and the stop it's coming to. Null where nothing's running then. The feed route set before `open`. */
async function stageBus(page, feed, { route = null, late = 0 } = {}) {
  // `late`: minutes behind its timetable, and placed where the timetable had it that long ago (the app doubts a feed
  // whose minutes don't fit the bus's place, rt.js agrees).
  const pick = await page.evaluate(async ([route, late]) => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), m0 = c.min - late;
    for (const [si] of d.D.stops.entries()) for (const row of d.timesOn(si, c.ymd)) {
      if (route && d.D.routes[d.tripRoute(row.trip)?.r]?.short !== route) continue;
      const st = d.tripStops(row.trip), k = st.findIndex(x => x[0] > m0);
      if (k < 2 || st[0][0] > m0 || d.D.stops[st[k][1]].hub) continue;
      const a = d.D.stops[st[k - 1][1]], b = d.D.stops[st[k][1]];
      if (d.distance(a.lat, a.lon, b.lat, b.lon) < 150) continue;
      return { id: d.D.trips[row.trip], st: st.map(([m, x]) => [m, d.D.stops[x].id]), k, next: b.id, mid: [(a.lat + b.lat) / 2, (a.lon + b.lon) / 2], head: d.bearing(a.lat, a.lon, b.lat, b.lon), at: Date.now(), day: c.min * 60 + c.sec };
    }
    return null;
  }, [route, late]);
  if (!pick) return null;
  const T = Math.floor(pick.at / 1000), base = T - pick.day;
  feed.t = T;
  feed.trips = { [pick.id]: { v: '9005', ts: T, s: pick.st.slice(pick.k).map(([m, sid], j) => [sid, pick.k + j, base + (m + late) * 60, 0]) } };
  feed.buses = [{ id: '9005', label: '9005', trip: pick.id, lat: pick.mid[0], lon: pick.mid[1], bearing: pick.head, speed: 5, ts: T }];
  return pick;
}

test('Christmas: the lights from the 1st, a glow in the light theme and halos in the dark, a twinkle but not with reduced motion, never in the way of a tap', async ({ page }, info) => {
  // Aaron's sketch: old C9 bulbs in red, gold, green and blue swagged where Thanksgiving's garland hung, each with a
  // glow and a slow twinkle; 'is christmas dark mode only?': both, the light theme's glow soft. 30 November: not
  // Christmas (nothing, or Thanksgiving's week's garland). The 1st, noon (Aaron: 'gradually add more and more
  // christmas stuff throughout the month', the lights first): the lights, hung where they go, the map's width, every
  // point along them the map's.
  const { xmas1 } = await holidays(page);
  await page.clock.setFixedTime(noon(dayOn(xmas1, -1)));
  await open(page, '#/map');
  await mapReady(page);
  expect((await deco(page)).season).not.toBe('christmas');
  await page.clock.setFixedTime(noon(xmas1));
  await page.goto('about:blank');
  await open(page, '#/map');
  await mapReady(page);
  expect(await deco(page)).toEqual({ season: 'christmas', on: 'christmas', shown: true });
  const swag = page.locator('#hol-deco .hol-lights');
  await hungRight(page, swag, info, 4);   // where it's hung 10 down its stretch, 6 under the box as sketched
  await tapsThrough(page, swag);
  expect(await swag.locator('.hol-bulb').count()).toBeGreaterThan(30);
  // (Read again till it holds: just after a load the page is now and then still putting itself up.)
  const look = () => page.evaluate(() => { const b = document.querySelector('#hol-deco .hol-bulb'); return b && { halo: +getComputedStyle(b.querySelector('.hol-halo')).opacity, twinkle: getComputedStyle(b).animationName }; });
  await expect.poll(look).toEqual({ halo: 0.35, twinkle: 'holTwinkle' });
  await page.evaluate(() => { localStorage.setItem('cr-theme', 'dark'); });
  await page.reload();
  await expect.poll(look).toEqual({ halo: 1, twinkle: 'holTwinkle' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => look().then(l => l && l.twinkle)).toBe('none');
});

test('Christmas at the Center and on the map: snow on the bays\' badges and roofs, banked at their feet, a tree in its mound; a wreath on a bus, the dark theme\'s in the dark', PHONE, async ({ page }) => {
  // The tree's week's first day with buses (the 15th, or the 16th after a Sunday), a minute past noon. At the Center (a
  // phone's: its bays are the map) each bay's badge wears a cap of snow, the hall and its canopies are whited over and
  // banked with snow at their feet, a tree in its mound by the doors. A Connect bus on the map, staged on its trip,
  // wears a wreath at its top right, upright, the light theme's; in the dark theme, the dark one. The 27th: none of it.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed && feed.buses ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  const { christmas: y } = await holidays(page), at = k => new Date(dayOn(y + '-12-15', k) + 'T12:01:00-07:00');
  await page.clock.setFixedTime(at(0));
  await open(page);
  feed = {};
  let pick = null;
  for (let k = 0; k < 10 && !pick; k++) { await page.clock.setFixedTime(at(k)); pick = await stageBus(page, feed); }
  expect(pick, 'a bus out at noon in the season').not.toBeNull();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await go(page, '#/hub');
  await mapReady(page);
  await expect(page.locator('.hbay').first()).toBeAttached();
  const caps = page.locator('.hbay .hol-cap');
  await expect.poll(() => caps.evaluateAll(cs => cs.filter(c => getComputedStyle(c).display === 'block').length)).toBe(await page.locator('.hbay').count());
  await expect(page.locator('.hol-treemark')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => { const m = window.__map; return !!m && !!m.getLayer('hol-roof') && m.getLayoutProperty('hol-roof', 'visibility') !== 'none' && m.getSource('hol-roof').serialize().data.features.length; }), { timeout: 20_000 }).toBeGreaterThan(0);
  // and the snow banked along the roofs' feet, under them: no drifts floating free in the plan's corners
  expect(await page.evaluate(() => { const m = window.__map, ids = m.getStyle().layers.map(l => l.id); return m.getLayoutProperty('hol-bank', 'visibility') !== 'none' && ids.indexOf('hol-bank') < ids.indexOf('hol-roof'); })).toBe(true);
  await expect(page.locator('.hol-drifts, .hol-drift')).toHaveCount(0);
  // Under the badges and never a tap's.
  expect(await page.locator('.maplibregl-marker.hol-treemark').first().evaluate(e => getComputedStyle(e).pointerEvents)).toBe('none');
  await go(page, '#/stop/' + pick.next);
  const bus = page.locator('.maplibregl-marker.bus:not(.shuttle)').first();
  await expect(bus).toBeAttached({ timeout: 40_000 });   // a staged bus is placed once the map and the feed have settled: on a busy machine, past twenty seconds
  await expect.poll(() => bus.locator('.hol-wreath').evaluate(w => getComputedStyle(w).display), { timeout: 20_000 }).toBe('block');
  await expect(bus.locator('.hol-wl')).toBeVisible();
  await expect(bus.locator('.hol-wd')).toBeHidden();
  const box = await bus.locator('.hol-wl').boundingBox(), ring = await bus.locator('.bus-marker').boundingBox();
  expect(box.x + box.width / 2).toBeGreaterThan(ring.x + ring.width / 2 - 2);   // at its top right whichever way it's headed
  expect(box.y + box.height / 2).toBeLessThan(ring.y + ring.height / 2 + 2);
  await page.evaluate(() => { localStorage.setItem('cr-theme', 'dark'); });
  await page.reload();
  await go(page, '#/stop/' + pick.next);
  await expect(page.locator('.maplibregl-marker.bus:not(.shuttle) .hol-wd').first()).toBeVisible({ timeout: 40_000 });
  await expect(page.locator('.maplibregl-marker.bus:not(.shuttle) .hol-wl').first()).toBeHidden();
  await page.clock.setFixedTime(new Date(y + '-12-27T12:01:00-07:00'));
  await page.goto('about:blank');
  await open(page, '#/stop/' + pick.next);
  expect((await deco(page)).season).toBe(null);
  await expect(page.locator('.hol-wreath').filter({ visible: true })).toHaveCount(0);
});

/** What Christmas has up at the Center on the page as it is: the root's week (data-xmas), the bays' caps shown, the
 *  roofs' snow shown, the tree and whether it has its presents, and whether a Connect bus would wear its wreath (a
 *  bus's wreath as app.css shows it, on a stand-in bus put on the map for the look and taken off). */
const xmasLook = page => page.evaluate(() => {
  const m = window.__map, t = document.querySelector('.hol-treemark'), caps = [...document.querySelectorAll('.hbay .hol-cap')];
  const bus = document.createElement('div');
  bus.className = 'bus'; bus.innerHTML = '<i class="hol-wreath"></i>';
  document.getElementById('map').append(bus);
  const wreath = getComputedStyle(bus.firstChild).display === 'block';
  bus.remove();
  return { xmas: document.documentElement.dataset.xmas || '', caps: caps.length > 0 && caps.every(c => getComputedStyle(c).display === 'block'),
    roof: !!m && !!m.getLayer('hol-roof') && m.getLayoutProperty('hol-roof', 'visibility') !== 'none' && m.getLayoutProperty('hol-bank', 'visibility') !== 'none',
    tree: !!t, gifts: !!t && !!t.querySelector('svg.hol-gifts'), wreath };
});
/** The bays' badges the tree's box is on: none, as it stands. */
const treeOn = page => page.evaluate(() => {
  const t = document.querySelector('.hol-treemark').getBoundingClientRect();
  return [...document.querySelectorAll('.hbay')].map(e => [e.textContent, e.getBoundingClientRect()]).filter(([, b]) => b.width && !(b.right <= t.left || b.left >= t.right || b.bottom <= t.top || b.top >= t.bottom)).map(([k]) => k);
});

test('Christmas builds up through December, a week at a time: the lights, then snow at the Center, then its tree and the buses\' wreaths, then presents under the tree', PHONE, async ({ page }) => {
  // Aaron: 'gradually add more and more christmas stuff throughout the month'. The 1st, the lights alone (no snow on
  // the Center's roofs or bays, no tree, no wreath); the 8th, snow on its roofs and bays' badges; the 15th, its tree
  // and a wreath on a bus; the 22nd, presents under the tree. A page left open from the 21st into the 22nd puts them
  // there by itself (holiday.js's 'seasonchange').
  const { christmas: y, xmas1 } = await holidays(page);
  const at = async (ymd, fresh = true) => {
    await page.clock.setFixedTime(noon(ymd));
    if (fresh) { await page.goto('about:blank'); await open(page, '#/hub'); }
    else { await go(page, '#/'); await go(page, '#/hub'); }
    await mapReady(page);
    await expect(page.locator('.hbay').first()).toBeAttached();
  };
  await at(xmas1);
  await page.waitForTimeout(1500);   // time for the roofs' snow to go on, were it to
  expect(await xmasLook(page)).toEqual({ xmas: 'lights', caps: false, roof: false, tree: false, gifts: false, wreath: false });
  expect((await deco(page)).shown).toBe(true);
  await at(y + '-12-08');
  await expect.poll(() => xmasLook(page), { timeout: 20_000 }).toEqual({ xmas: 'lights snow', caps: true, roof: true, tree: false, gifts: false, wreath: false });
  await at(y + '-12-15');
  await expect.poll(() => xmasLook(page), { timeout: 20_000 }).toEqual({ xmas: 'lights snow tree', caps: true, roof: true, tree: true, gifts: false, wreath: true });
  await at(y + '-12-21');
  await expect.poll(() => xmasLook(page).then(l => l.gifts), { timeout: 20_000 }).toBe(false);
  await at(y + '-12-22', false);   // the same page, the next day
  await expect.poll(() => xmasLook(page), { timeout: 20_000 }).toEqual({ xmas: 'lights snow tree gifts', caps: true, roof: true, tree: true, gifts: true, wreath: true });
  await expect(page.locator('.hol-treemark')).toHaveCount(1);
  expect(await page.locator('.maplibregl-marker.hol-treemark').evaluate(e => getComputedStyle(e).pointerEvents)).toBe('none');
});

test('Christmas\'s tree at the Center stands clear of every bay\'s badge, between the 7\'s and the 9\'s', async ({ page }, info) => {
  // It stood on the 9's badge, its snow run into the badge's cap. At the Center on a phone, and on a wide screen at
  // the Center's zooms, its box is on no badge's, west of the 9's and east of the 7's.
  const { christmas: y } = await holidays(page);
  await page.clock.setFixedTime(noon(y + '-12-22'));
  await open(page, '#/hub');
  await mapReady(page);
  for (const z of phone(info) ? [null] : [17.5, 18, 19]) {
    if (z) { await page.evaluate(([z, c]) => window.__map.jumpTo({ center: c, zoom: z }), [z, [-111.8309, 41.7406]]); await settled(page); }
    await expect(page.locator('.hol-treemark')).toHaveCount(1);
    await expect(page.locator('.hbay').first()).toBeAttached();
    await expect.poll(() => treeOn(page)).toEqual([]);
    const [t, b7, b9] = await page.evaluate(() => [document.querySelector('.hol-treemark'), ...['7', '9'].map(k => [...document.querySelectorAll('.hbay')].find(e => e.querySelector('.b').textContent === k))].map(e => { const r = e.getBoundingClientRect(); return r.x + r.width / 2; }));
    expect(t).toBeGreaterThan(b7);
    expect(t).toBeLessThan(b9);
  }
});

/** Real snow staged (holiday.js) at a time: the weather service's answer (`nws`: an observation's `properties`, a list
 *  of them, or 'fail') and the relay's (`relay`: its `current`, stamped 10 minutes before `at` unless it says its own
 *  `time`, or 'fail'), each ask of either counted. */
async function stageWeather(page, nws, relay, at) {
  const asked = { nws: 0, relay: 0 };
  const answer = (r, body) => body === 'fail' ? r.fulfill({ status: 503, body: '' }) : r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  const omTime = ms => new Date(ms).toISOString().slice(0, 16);   // Open-Meteo's GMT, no zone
  await page.route(/^https:\/\/api\.weather\.gov\/stations\/KLGU\/observations\?start=/, r => { asked.nws++; return answer(r, nws === 'fail' ? 'fail' : { features: [].concat(nws).map(p => ({ properties: p })) }); });
  await page.route(/^https:\/\/om\.aarobh\.net\/v1\/forecast\?/, r => { asked.relay++; return answer(r, relay === 'fail' ? 'fail' : { current: { time: omTime(at.getTime() - 10 * 60e3), ...relay } }); });
  return asked;
}
/** An observation at the airport `ago` minutes before a time: its weather (the service's words, 'snow', 'unknown') and
 *  temperature (°C). */
const obs = (at, ago, weather, temp, intensity = null) => ({ timestamp: new Date(at.getTime() - ago * 60e3).toISOString(), temperature: { unitCode: 'wmoUnit:degC', value: temp }, presentWeather: weather ? [{ intensity, modifier: null, weather, rawString: weather === 'unknown' ? 'UP' : 'SN' }] : [] });
/** The snow on the page: snowing said on the root, and its flakes shown. */
const snowing = page => page.evaluate(() => { const f = document.getElementById('snow-deco'); return { on: 'snowing' in document.documentElement.dataset, shown: !!f && getComputedStyle(f).display === 'block' }; });
/** A day's noon staged, the weather as given, the map opened and its asks waited for; the day the relay last said
 *  snow forgotten first, unless `keep`. */
async function snowDay(page, at, nws, relay, keep = false) {
  if (!keep) await page.evaluate(() => { try { localStorage.removeItem('cr-relay-snow-day'); } catch {} }).catch(() => {});
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.route(/^https:\/\/(api\.weather\.gov|om\.aarobh\.net)\//, r => r.abort());
  const asked = await stageWeather(page, nws, relay, at);
  await page.clock.setFixedTime(at);
  await page.goto('about:blank');
  await open(page, '#/map');
  await page.waitForSelector('#snow-deco', { state: 'attached' });
  await expect.poll(() => asked.nws).toBe(1);
  return asked;
}

test('Real snow: flakes fall over the map while it snows in Logan, by the weather service, by the relay where it can\'t say, else none', PHONE, async ({ page }) => {
  // Aaron: 'track real snow weather all of december just for fun', 'use my relay, or we could use nws'; then any day
  // it snows. The airport's latest observation, under 90 minutes old: snow is snow; 'UP' (precipitation it can't
  // name) at 0 °C or colder is snow, above 3 °C none; clear is none. Only where it can't say (down, old, 'UP' between
  // 0 and 3 °C) the relay; neither answering, none.
  const { christmas: y } = await holidays(page), at = noon(y + '-12-10');
  const cases = [
    ['fresh snow, no intensity given', obs(at, 20, 'snow', -3), null, 'moderate', 0],
    ['light snow', obs(at, 20, 'snow', -3, 'light'), null, 'light', 0],
    ['heavy snow', obs(at, 20, 'snow', -3, 'heavy'), null, 'heavy', 0],
    ['UP at -1 °C', obs(at, 20, 'unknown', -1), null, 'light', 0],
    ['clear', obs(at, 20, null, -2), { snowfall: 0.5, weather_code: 73 }, false, 0],   // the relay never asked, whatever it'd say
    ['UP at 4 °C', obs(at, 20, 'unknown', 4), { snowfall: 0.5, weather_code: 73 }, false, 0],
    ['UP at 1.5 °C, the relay snowing moderately', obs(at, 20, 'unknown', 1.5), { snowfall: 0, weather_code: 73 }, 'moderate', 1],
    ['UP at 1.5 °C, the relay snowing heavily', obs(at, 20, 'unknown', 1.5), { snowfall: 1, weather_code: 75 }, 'heavy', 1],
    ['UP at 1.5 °C, the relay clear', obs(at, 20, 'unknown', 1.5), { snowfall: 0, weather_code: 3 }, false, 1],
    ['an old observation, no snow in it, the relay clear', obs(at, 120, null, -3), { snowfall: 0, weather_code: 3 }, false, 1],
    ['the service down, snow falling at the relay under another code', 'fail', { snowfall: 0.2, weather_code: 3 }, 'light', 1],
    ['both down', 'fail', 'fail', false, 1],
  ];
  for (const [what, nws, relay, snows, relayAsks] of cases) {
    const asked = await snowDay(page, at, nws, relay);
    if (relayAsks) await expect.poll(() => asked.relay, what).toBe(1);
    if (snows) { await expect.poll(() => snowing(page), what).toEqual({ on: true, shown: true }); expect(await page.evaluate(() => document.documentElement.dataset.snowing), what).toBe(snows); }
    else { await page.waitForTimeout(500); expect(await snowing(page), what).toEqual({ on: false, shown: false }); }
    expect(asked.relay, what + ': the relay asked').toBe(relayAsks);
  }
});

test('Real snow all day: from the day\'s first report of snow to midnight, light between, yesterday\'s not counted; the relay\'s snow kept for the day; a stale relay no snow', PHONE, async ({ page }) => {
  // Aaron, snowing in Logan on 20 Nov 2026 with the app showing none: 'maybe we should just make it snow all day on
  // days whenever there was snow that day'. The airport said 'Light Snow' till 12:24 and then an hour of reports with
  // no weather (the last no temperature either); the relay served Open-Meteo's answer from 3 h 40 min before.
  const { christmas: y } = await holidays(page), at = noon(y + '-12-10');
  const blanks = [obs(at, 73, null, 1.7), obs(at, 59, null, 1.7), obs(at, 31, null, 1.7), obs(at, 24, null, null)];
  const july = noon((+y + 1) + '-07-15');
  const cases = [
    ['20 Nov at 1:55: snow 91 min ago, empty reports since', at, [obs(at, 91, 'snow', 1.7, 'light'), ...blanks], 'light'],
    ['snow at dawn, clear and 5 °C since', at, [obs(at, 300, 'snow', -1), obs(at, 200, 'rain', 2), obs(at, 20, null, 5)], 'light'],
    ['snowing hard now, after a light morning', at, [obs(at, 200, 'snow', -1, 'light'), obs(at, 10, 'snow', -2, 'heavy')], 'heavy'],
    ['yesterday\'s snow only (11 pm), clear today', at, [obs(at, 13 * 60, 'snow', -4), obs(at, 20, null, -2)], false],
    ['a July morning\'s snow, clear now', july, [obs(july, 180, 'snow', 0), obs(july, 20, null, 12)], 'light'],
  ];
  for (const [what, when, nws, snows] of cases) {
    const asked = await snowDay(page, when, nws, { snowfall: 1, weather_code: 75 });
    if (snows) { await expect.poll(() => snowing(page), what).toEqual({ on: true, shown: true }); expect(await page.evaluate(() => document.documentElement.dataset.snowing), what).toBe(snows); }
    else { await page.waitForTimeout(500); expect(await snowing(page), what).toEqual({ on: false, shown: false }); }
    expect(asked.relay, what + ': the relay not asked').toBe(0);
  }
  // the relay's snow, where the airport can't say, kept the rest of the day: opened again, the relay clear, still light
  let asked = await snowDay(page, at, obs(at, 20, 'unknown', 1.5), { snowfall: 0, weather_code: 73 });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.snowing)).toBe('moderate');
  const later = new Date(at.getTime() + 3 * 3600e3);
  asked = await snowDay(page, later, obs(later, 20, 'unknown', 1.5), { snowfall: 0, weather_code: 3 }, true);
  await expect.poll(() => asked.relay).toBe(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.snowing), 'the relay\'s snow kept').toBe('light');
  // a relay answer 3 h 40 min old is no snow
  const old = new Date(at.getTime() - 220 * 60e3).toISOString().slice(0, 16);
  asked = await snowDay(page, at, obs(at, 20, 'unknown', 1.5), { time: old, snowfall: 1, weather_code: 75 });
  await expect.poll(() => asked.relay).toBe(1);
  await page.waitForTimeout(500);
  expect(await snowing(page), 'the relay\'s answer 3 h 40 min old').toEqual({ on: false, shown: false });
});

test('Real snow on a wide screen: across the whole map on the Map tab, its panel put away; beside the panel elsewhere', WIDE, async ({ page }) => {
  // Aaron, of the desktop's Map tab: the snow 'NOT properly wide'. It began 420 px in, where the panel is on every
  // other view, though the Map tab puts the panel away.
  const { christmas: y } = await holidays(page), at = noon(y + '-12-10');
  await snowDay(page, at, obs(at, 10, 'snow', -4, 'heavy'), 'fail');
  await expect.poll(() => snowing(page)).toEqual({ on: true, shown: true });
  const span = () => page.evaluate(() => { const r = e => { const b = document.getElementById(e).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; }; return { snow: r('snow-deco'), map: r('map') }; });
  const onMap = await span();
  expect(onMap.snow, 'the Map tab').toEqual(onMap.map);
  await page.evaluate(() => { location.hash = '#/'; });
  await expect.poll(() => page.evaluate(() => document.getElementById('body').classList.contains('map-open'))).toBe(false);
  const side = await page.evaluate(() => { const b = document.getElementById('side').getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; });
  const home = await span();
  expect(home.snow[0] >= side[1] || home.snow[1] <= side[0], 'beside the panel, not under it').toBe(true);
});

test('Real snow by how hard it snows: light a few flakes, moderate more, heavy all of them, each over the map\'s top and faded alike', PHONE, async ({ page }) => {
  // Aaron: 'is the snow too much? it is top to bottom', then of light, moderate and heavy: 'try it'. The flakes shown
  // and how far down the map they fall before fading out, by the weather service's intensity.
  const { christmas: y } = await holidays(page), at = noon(y + '-12-10');
  const look = () => page.evaluate(() => { const f = document.getElementById('snow-deco'), b = f.querySelector('.hol-flakes'), cs = getComputedStyle(b); return { shown: [...f.querySelectorAll('.hol-flake')].filter(e => getComputedStyle(e).display !== 'none').length, mask: cs.maskImage || cs.webkitMaskImage, reach: Math.round(100 * b.getBoundingClientRect().height / f.getBoundingClientRect().height) }; });
  const seen = {};
  for (const level of ['light', 'moderate', 'heavy']) {
    await snowDay(page, at, obs(at, 10, 'snow', -4, level === 'moderate' ? null : level), 'fail');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.snowing)).toBe(level);
    seen[level] = await look();
    expect(seen[level].mask, level + ': faded, not cut').toMatch(/linear-gradient/);
  }
  expect(seen.light.shown).toBe(14);
  expect(seen.moderate.shown).toBe(26);
  expect(seen.heavy.shown).toBe(44);
  // and the same way down the map whatever the snow: its top 40%, faded alike ('the fading is about visibility and usability')
  expect([seen.light.reach, seen.moderate.reach, seen.heavy.reach]).toEqual([40, 40, 40]);
  expect(new Set([seen.light.mask, seen.moderate.mask, seen.heavy.mask]).size).toBe(1);
});

test('Real snow any day of the year: a plain November day, over Thanksgiving\'s garland; a July day clear, the relay never asked', PHONE, async ({ page }) => {
  // The user, it snowing in Logan as it shipped: not Christmas's alone. A November day with no season, snowing: the
  // flakes, no holiday's dressing. Thanksgiving's Monday, snowing: the flakes over the garland. A July day, the service
  // saying clear: none, and the relay never asked.
  const { thanksgiving: tg } = await holidays(page);
  const plain = noon(dayOn(tg, -10));
  await snowDay(page, plain, obs(plain, 15, 'snow', -2), 'fail');
  await expect.poll(() => snowing(page)).toEqual({ on: true, shown: true });
  expect(await deco(page)).toEqual({ season: null, on: null, shown: false });
  const mon = noon(dayOn(tg, -3));
  await snowDay(page, mon, obs(mon, 15, 'snow_showers', -1), 'fail');
  await mapReady(page);
  await expect.poll(() => snowing(page)).toEqual({ on: true, shown: true });
  expect(await deco(page)).toEqual({ season: 'thanksgiving', on: 'thanksgiving', shown: true });
  expect(await page.evaluate(() => { const s = document.getElementById('snow-deco'), h = document.getElementById('hol-deco'); return !!(h.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) && getComputedStyle(s).zIndex === getComputedStyle(h).zIndex; })).toBe(true);   // over the garland
  const july = noon((+tg.slice(0, 4) + 1) + '-07-15');
  const asked = await snowDay(page, july, obs(july, 15, null, 31), { snowfall: 1, weather_code: 75 });
  await page.waitForTimeout(500);
  expect(await snowing(page)).toEqual({ on: false, shown: false });
  expect(asked.relay).toBe(0);
});

test('Real snow: under the map\'s buttons, never a tap\'s, falling, and none with reduced motion', PHONE, async ({ page }) => {
  // Snowing, the flakes fall over the map, under its buttons, search and card: every point of the map under them still
  // the map's. With reduced motion they're not there.
  const { christmas: y } = await holidays(page), at = noon(y + '-12-10');
  await snowDay(page, at, obs(at, 10, 'snow', -4), 'fail');
  await mapReady(page);
  await expect.poll(() => snowing(page)).toEqual({ on: true, shown: true });
  const flakes = page.locator('#snow-deco .hol-flake');
  expect(await flakes.count()).toBeGreaterThanOrEqual(30);
  expect(await flakes.first().evaluate(e => getComputedStyle(e).pointerEvents)).toBe('none');
  expect(await flakes.first().evaluate(e => getComputedStyle(e).animationName)).toBe('holFlake');
  const box = page.locator('#snow-deco');
  const b = await box.boundingBox();
  const hits = await page.evaluate(({ x, y, width: w, height: h }) => [0.1, 0.3, 0.5, 0.7, 0.9].flatMap(f => [0.1, 0.3, 0.5, 0.7].map(g => { const e = document.elementFromPoint(x + w * f, y + h * g); return !!e && !!e.closest('#snow-deco'); })), b);
  expect(hits.every(h => !h)).toBe(true);
  expect(await box.evaluate(e => getComputedStyle(e).pointerEvents)).toBe('none');
  expect(await box.evaluate(e => +getComputedStyle(e).zIndex)).toBeLessThan(450);   // under the map's buttons and search
  // flakes in sight on the map
  expect(await page.evaluate(() => { const m = document.getElementById('map').getBoundingClientRect(); return [...document.querySelectorAll('#snow-deco .hol-flake')].filter(f => { const r = f.getBoundingClientRect(); return r.width > 0 && r.top > m.top && r.bottom < m.bottom; }).length; })).toBeGreaterThan(5);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => snowing(page)).toEqual({ on: true, shown: false });
});

test('Christmas Day: its card at a stop and at the Center, back at the timetable\'s first bus and first pulse; the 26th the lights and no card, the 27th none', PHONE, async ({ page }) => {
  // Christmas Day: the sketch's snowy night and two buses asleep under the Center's roof, 'No buses today', 'Connect
  // doesn't run on Christmas Day. Merry Christmas!', and when they're back from the timetable (in 2026, Saturday's
  // first pulse). The 26th, the season's last day: the lights, no card (the buses running, or the plain 'No buses
  // today' on a Sunday). The 27th: none.
  const { christmas: y } = await holidays(page);
  await page.clock.setFixedTime(noon(y + '-12-25'));
  await open(page);
  const t = await backTimes(page);
  for (const [hash, back] of [['#/stop/' + t.stop, t.atStop], ['#/hub', t.atHub]]) {
    await go(page, hash);
    if (hash === '#/hub' && t.hubRuns) { await hubOthers(page); continue; }
    const card = page.locator('.holcard.hol-christmas').first();
    await expect(card).toBeAttached();
    await expect(card.locator('svg.hol-art')).toHaveAttribute('role', 'img');
    await expect(card.locator('svg.hol-art')).toHaveAttribute('aria-label', /^A snowy night over the Wellsvilles, two buses asleep/);
    await expect(card.locator('.holcard-h')).toHaveText('No buses today');
    await expect(card.locator('p')).toHaveText("Connect doesn't run on Christmas Day. Merry Christmas!");
    await expect(card.locator('.holcard-back span')).toHaveText(back.words);
    await expect(card.locator('.holcard-back b')).toHaveText(back.time);
    await expect(page.locator('.holcard')).toHaveCount(1);
    await expect(page.locator('.callout, .tcl-note').filter({ hasText: 'No buses today' })).toHaveCount(0);
  }
  // the day it's back the timetable's next day with buses, by its calendars (as the Center's first pulse is found)
  const back = await page.evaluate(async () => { const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(); let k = 1; while (k < 14 && !d.agencyRuns(t.dayFrom(c.ymd, k).ymd)) k++; return t.dayName(t.dayFrom(c.ymd, k).ymd); });
  if (!t.hubRuns) expect(t.atHub.words).toBe('Back ' + back + ' · first pulse');
  expect((await deco(page)).season).toBe('christmas');
  for (const [ymd, season] of [[y + '-12-26', 'christmas'], [y + '-12-27', null]]) {
    await page.clock.setFixedTime(noon(ymd));
    await page.goto('about:blank');
    await open(page, '#/stop/' + t.stop);
    await expect(page.locator('.stop-page').filter({ visible: true }).first()).toBeVisible();
    await expect(page.locator('.holcard')).toHaveCount(0);
    expect((await deco(page)).season).toBe(season);
  }
});

test('a route drawn as a line: its key stops, a fold kept open through a redraw, every stop', PHONE, async ({ page }) => {
  // The Blue Loop: its stops on a rail, the stops between its key stops folded. A fold opened stays open as the feed
  // redraws the sheet; 'Every stop' unfolds the lot, 'Key stops' folds them again.
  await open(page, '#/map/route/B');
  await inBusHours(page);   // out of hours a quiet route opens on All day (cr-v557), not its line
  await expect(page.locator('.rs-list.line').filter({ visible: true }).first()).toBeAttached();
  const fold = page.locator('.rs-fold').filter({ visible: true }).first();
  if (await fold.count()) {
    await fold.locator('summary').click();
    await expect(fold).toHaveAttribute('open', '');
    await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    await page.waitForTimeout(1500);
    await expect(page.locator('.rs-fold[open]').filter({ visible: true })).not.toHaveCount(0);   // (a bus come into it may split it in two, both open)
  }
  await page.locator('.rs-every').filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/[?&]every=1/);
  await expect(page.locator('.rs-fold').filter({ visible: true })).toHaveCount(0);
  await page.locator('.rs-every').filter({ visible: true }).first().click();
  await expect(page).not.toHaveURL(/every=1/);
});

test('a two-way route as one line: out to its far end and back, both ways\' buses on it, a way\'s old address on its half', async ({ page }) => {
  // Route 15 out to Richmond and back is one list, no way to pick: the far end once, marked where it turns round, the
  // last stop the drop-off. A bus each way, drawn at a weekday's 2:12 PM (every stop to come, the line in order), sits
  // before the stop it calls at next, the way out's before the turn and the way back's after it. (The whole route asked
  // for: late in the day the far end's last run back is gone before the line's last stop is.)
  await open(page, '#/map/route/15?all=1');
  await expect(page.locator('.rs-list.line').filter({ visible: true }).first()).toBeAttached();
  await expect(page.locator('.rs-ways .chip').filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('.c-turn').filter({ visible: true })).toHaveCount(1);
  await expect(page.locator('.rs-count').filter({ visible: true }).first()).toContainText(/out and back|stops left|tonight/i);
  const r = await page.evaluate(async () => {
    const d = await import('/app/data.js'), rtm = await import('/app/rt.js'), m = await import('/app/views/map.js'), t = await import('/app/time.js');
    const ri = d.D.routeByShort['15'], nowS = Math.floor(Date.now() / 1000);
    let c = null;
    for (let i = 0; i < 9 && !c; i++) { const x = new Date(Date.now() + i * 864e5); x.setHours(14, 12, 0, 0); const k = t.now(x); if (k.dow > 0 && k.dow < 6 && d.timesOn(d.routeOrder(ri, '0')[0], k.ymd).some(y => y.r === ri)) c = k; }
    if (!c) return null;
    // a bus on a trip each way, its next stop the trip's sixth
    const placed = {};
    rtm.rt.trips = {}; rtm.rt.buses = [];
    for (const k of ['0', '1']) {
      const s0 = d.routeOrder(ri, k)[0], row = d.timesOn(s0, c.ymd).find(y => y.r === ri && String(y.dir) === k && d.tripStops(y.trip).length > 8);
      const st = d.tripStops(row.trip), [, prev] = st[4], [, next] = st[5], id = d.D.trips[row.trip], P = d.D.stops[prev];
      rtm.tripOf(id);
      rtm.rt.trips[id] = { v: 'T' + k, ts: nowS, at: new Map([[d.D.stops[next].id, { seq: 5, time: nowS + 60, skipped: false }]]), first: null, last: null, lastDelay: 0, ti: row.trip, stops: [[d.D.stops[next].id, 5, nowS + 60, 0]], end: st.length - 1 };
      rtm.rt.buses.push({ id: 'c:T' + k, label: 'T' + k, trip: id, ri, lat: P.lat + 0.002, lon: P.lon, course: 0, speed: 8, ts: nowS, h: null, dir: +k });
      placed[k] = d.D.stops[next].id;
    }
    rtm.rt.at = Date.now();
    const div = document.createElement('div');
    div.innerHTML = String(m.routePage({ short: '15', every: true }, c).html);
    const list = [...div.querySelector('.rs-list.line').children], at = el => list.indexOf(el);
    const bus = k => div.querySelector('#bus-cT' + k), turn = div.querySelector('.c-turn').closest('.croute');
    return {
      chips: div.querySelectorAll('.rs-ways .chip').length, last: list[list.length - 1].textContent,
      out: bus('0') && bus('0').nextElementSibling.getAttribute('href') === '#/stop/' + placed['0'] && at(bus('0')) < at(turn),
      back: bus('1') && bus('1').nextElementSibling.getAttribute('href') === '#/stop/' + placed['1'] && at(bus('1')) > at(turn),
      // a stop of the way back, from its badge (the way given): its row in that half
      badge: (await import('/app/ui.js')).routeBadgeLink(ri, d.routeOrder(ri, '1').slice(-4)[0], 20).match(/href="([^"]+)"/)[1],
    };
  });
  test.skip(!r, 'no weekday of Route 15 in the timetable this week');
  expect(r.chips).toBe(0);
  expect(r.last).toContain('Ends here');
  expect(r.out).toBe(true);
  expect(r.back).toBe(true);
  // An old address with a way lands on its half: the way back, its first row the far end
  await go(page, '#/map/route/15/1?all=1');
  await expect(page.locator('#rs-way').filter({ visible: true })).toBeInViewport();
  await expect(page.locator('#rs-way').filter({ visible: true })).toContainText('Turns round here');
  // A stop badge's link to a stop on the way back: that stop's row, and the rider's stop above the list
  await go(page, r.badge);
  await expect(page.locator('#here').filter({ visible: true })).toHaveCount(1);
  await expect(page.locator('.yourstop').filter({ visible: true }).first()).toBeVisible();
});

test('another operator\'s route, kept by hand (the Preston commuter): at its stops, its page, the planner; never live', WIDE, async ({ page }) => {
  // The clock half an hour before its next run, and the relay's answer made up as if the feed had its bus out on that
  // run, 3 minutes late: no feed has it, so every screen still says Scheduled, at the timetable's minute.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  await open(page);
  const pick = await page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now();
    const ri = d.D.routes.findIndex(r => r.op);
    if (ri < 0) return null;   // no hand-kept route (tools/prt.json): nothing to check
    for (let k = 0; k < 14; k++) {
      const ymd = t.dayFrom(c.ymd, k).ymd;
      const rows = d.D.stops.flatMap((s, si) => d.timesOn(si, ymd).filter(x => x.r === ri)).sort((a, b) => a.min - b.min);
      if (!rows.length || rows[0].min - 30 < (k ? 0 : c.min)) continue;
      const first = rows[0], st = d.tripStops(first.trip), end = d.tripEnd(first.trip), min = first.min - 30;
      const at = Date.now() + ((t.dayDiff(c.ymd, ymd) * 1440 + min - c.min) * 60 - c.sec) * 1000;
      return { ri, short: d.D.routes[ri].short, brand: d.D.agency.brand, trip: d.D.trips[first.trip], at, min: first.min,
        from: d.D.stops[first.si].id, to: d.D.stops[end.si].id, st: st.map(([m, si]) => [m, d.D.stops[si].id, d.D.stops[si].lat, d.D.stops[si].lon]) };
    }
    return null;
  });
  test.skip(!pick, 'no route of another operator\'s in the timetable');
  await page.clock.setFixedTime(new Date(pick.at));
  const T = Math.floor(pick.at / 1000), base = T + 30 * 60 - pick.min * 60;   // the epoch second of its day's minute 0
  feed = { t: T, now: T, trips: { [pick.trip]: { v: '9003', ts: T, s: pick.st.map(([m, sid], i) => [sid, i + 1, base + (m + 3) * 60, 0]) } },
    buses: [{ id: '9003', label: '9003', trip: pick.trip, lat: pick.st[0][2], lon: pick.st[0][3], bearing: 0, speed: 0, ts: T }] };
  const clock = m => { const h = Math.floor(m / 60) % 24; return (h % 12 || 12) + ':' + String(m % 60).padStart(2, '0'); };
  // Its first stop: its run there, Scheduled, at the timetable's minute
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await go(page, '#/stop/' + pick.from);
  const row = page.locator('.row').filter({ has: page.locator(`.badge[data-r="${pick.ri}"]`) }).filter({ visible: true }).first();
  await expect(row).toContainText('Scheduled', { timeout: 15_000 });
  await expect(row).toContainText(clock(pick.min));
  await expect(page.locator('.livetag').filter({ visible: true })).toHaveCount(0);
  // Its page: not the agency's, its timetable, the line from where its runs start; nothing live
  await go(page, '#/map/route/' + encodeURIComponent(pick.short));
  const sheet = page.locator('.routesheet').filter({ visible: true }).first();
  await expect(sheet.locator('.rs-op')).toContainText('Not a ' + pick.brand + ' bus');
  await expect(sheet.locator('.rs-op a[href$=".pdf"], .rs-op a[target]').first()).toBeVisible();
  await expect(sheet.locator('.rs-list .croute').first()).toHaveAttribute('href', '#/stop/' + pick.from);
  await expect(sheet.locator('.livetag')).toHaveCount(0);
  await expect(page.locator('.routehead').filter({ visible: true }).first()).not.toContainText('Route ' + pick.short);
  // The planner: from its first stop to its last, its bus
  await go(page, '#/go/' + pick.to + '/' + pick.from);
  await expect(page.locator(`.jrow .badge[data-r="${pick.ri}"]`).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
});

test('Route 16 is one route: one badge at 2281 N Main with PRT\'s, the last full run the road\'s, search "16"', PHONE, async ({ page }) => {
  // 16 AM and 16 PM (GTFS's halves of Route 16) are one route to a rider; PRT's Preston commuter is its midday run. At
  // 2281 N Main all three call: the header had three badges, and 16 AM's 7:43 was marked the last full run with PRT's
  // 12:38 and 16 PM's 7:23 PM still to come.
  await open(page);
  const k = await page.evaluate(async () => {
    const d = await import('/app/data.js'), si = d.D.stopById['7607775'];
    if (si === undefined) return null;
    const ri = d.D.stops[si].routes.find(r => d.isHalf(r)), op = d.D.stops[si].routes.find(r => d.opOf(r) && d.roadOf(r) !== null);
    return ri === undefined ? null : { key: d.familyKey(ri), op: op === undefined ? null : d.D.routes[op].short };
  });
  test.skip(!k, '2281 N Main, or a route split in halves there, not in the timetable');
  await go(page, '#/stop/7607775');
  const head = page.locator('.head').filter({ has: page.locator('h1') }).filter({ visible: true }).first();
  await expect(head.locator('h1')).toHaveText('2281 N Main');
  expect(await head.locator('.badges .badge').allInnerTexts()).toEqual([k.key, ...(k.op ? [k.op] : [])]);
  const tp = page.locator('.stop-page .tpline').filter({ visible: true }).first();   // under the times, no longer in the head
  if (await tp.count()) { await expect(tp).toContainText('A timed stop for Route ' + k.key + ':'); await expect(tp).not.toContainText(/\b(AM|PM)\b/); }
  // The whole day here (today's, or the next day with buses): the last full run is the day's last bus alone.
  await go(page, '#/stop/7607775/all');
  const rows = page.locator('.list .row').filter({ visible: true });
  await expect(rows.first()).toBeVisible();
  await expect(page.locator('.list .lastrun').filter({ visible: true })).toHaveCount(1);
  await expect(rows.last().locator('.lastrun')).toHaveCount(1);
  for (const t of await page.locator('.list .row .badge').filter({ visible: true }).allInnerTexts()) expect([k.key, k.op]).toContain(t.trim());
  // Search '16': the route once, to its own address (the half on the road now or next), and PRT's midday run after it.
  await go(page, '#/search?q=' + encodeURIComponent(k.key));
  const r16 = page.locator(`a.row[href="#/map/route/${encodeURIComponent(k.key)}"]`).filter({ visible: true });
  await expect(r16).toHaveCount(1);
  await expect(r16).toContainText('Route ' + k.key);
  await expect(page.locator(`a.row[href^="#/map/route/${encodeURIComponent(k.key + ' ')}"]`)).toHaveCount(0);
  if (k.op) await expect(page.locator(`a.row[href="#/map/route/${encodeURIComponent(k.op)}"]`).filter({ visible: true })).toContainText(new RegExp('run by ' + k.op));
  // Its address opens a half, named in words; its badge the number alone.
  await r16.click();
  await expect(page).toHaveURL(new RegExp('#/map/route/' + k.key + '$'));
  const rh = page.locator('.routehead').filter({ visible: true }).first();
  await expect(rh.locator('.rs-name .name')).toHaveText('Route ' + k.key);
  await expect(rh.locator('.rs-name .sub')).toContainText(/^(Morning|Midday|Afternoon|Evening) runs · /);
  await expect(rh.locator('.rs-name .badge')).toHaveText(k.key);
  // At noon on a day both halves run, the morning's done and the evening's to come: neither half's line is done for the
  // day on the map (it was 16 AM's, drawn faded beside 16 PM's along Main).
  const at = await page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), fam = d.familyOf(d.familyKey(d.D.stops[d.D.stopById['7607775']].routes.find(r => d.isHalf(r))));
    for (let k = 0; k < 8; k++) {
      const ymd = t.dayFrom(c.ymd, k).ymd;
      if (fam.every(r => d.runsOf(r, ymd).length)) return Date.now() + ((t.dayDiff(c.ymd, ymd) * 1440 + 720 - c.min) * 60 - c.sec) * 1000;
    }
    return null;
  });
  if (at) {
    await page.clock.setFixedTime(new Date(at));
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
    const done = await page.evaluate(async () => {
      const d = await import('/app/data.js'), m = await import('/app/views/map.js'), r = m.doneToday();
      return d.familyOf(d.familyKey(d.D.stops[d.D.stopById['7607775']].routes.find(x => d.isHalf(x)))).filter(x => r.routes && r.routes.has(x)).map(x => d.D.routes[x].short);
    });
    expect(done, 'a half done at noon with the other still to run').toEqual([]);
  }
});

test('route: both ways, its sibling, a stop on it', PHONE, async ({ page }) => {
  await open(page, '#/map/route/2?day=0');
  await inBusHours(page);   // out of hours a quiet route opens on All day (cr-v557): 16 PM's half named on its line
  await mapReady(page);
  await expect(page.getByText(/stops, in order|stops left/i).filter({ visible: true }).first()).toBeVisible();
  const ways = page.locator('a[href^="#/map/route/2/"]');
  if (await ways.count()) { await ways.last().click(); await expect(page).toHaveURL(/#\/map\/route\/2\//); }
  await go(page, '#/map/route/16%20PM');   // a half's own address, as old links have it: the page says which half, and links the other
  await expect(page.locator('.routehead .sub').filter({ visible: true }).first()).toContainText(/^Evening runs/);
  await go(page, '#/map/route/16%20PM?day=0');   // quiet, it may open on All day: the other half is linked on its Stops view
  await expect(page.getByText(/Also its morning runs/).filter({ visible: true }).first()).toBeVisible();
  await page.locator('a[href^="#/stop/"]').filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/#\/stop\//);
});

test('stop: its page, a route badge, a run, saved and unsaved', PHONE, async ({ page }) => {
  await open(page);
  // A service day's noon (inBusHours): on a Sunday with no location or saved stop the home page lists no stops
  // (22 Nov 2026).
  await inBusHours(page);
  const id = await someStop(page);
  await go(page, '#/stop/' + id);
  await expect(page.getByRole('link', { name: 'How to get here' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'From here' })).toBeVisible();
  const time = page.locator('button.hr-dep').filter({ visible: true }).first();
  if (await time.count()) { await time.click(); await expect(page).toHaveURL(/\?run=/); await go(page, '#/stop/' + id); }
  // Saved: the button says so, the stop kept, and home leads with it (no location: the first saved stop is the big
  // one); its page again still Saved. Unsaved: none of it, home's hint to save one back.
  const save = page.locator('#save').filter({ visible: true }), kept = () => page.evaluate(() => JSON.parse(localStorage.getItem('cr-saved') || '[]'));
  for (const on of [true, false]) {
    await expect(save).toHaveAttribute('aria-pressed', String(!on));
    await save.click();
    await expect(save).toHaveAttribute('aria-pressed', String(on));
    await expect(save).toHaveText(on ? 'Saved' : 'Save');
    expect(await kept()).toEqual(on ? [id] : []);
    await go(page, '#/');
    await expect(page.locator(on ? '.hero .savedmark' : '.land-hint').filter({ visible: true })).toBeVisible();
    await expect(page.locator('.hero .savedmark')).toHaveCount(on ? 1 : 0);
    await go(page, '#/stop/' + id);
  }
  await page.locator('a.badgelink').filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/#\/map\/route\//);
});

test('stop: the whole day an hour to a column, the gone ones too; a loop\'s time opens its run, saying which of its buses', WIDE, async ({ page }) => {
  // The user: 'i'd like to be able to see the previous times in the day. i think the rest of today maybe should be the
  // whole day all the time', and of a time tapped there: 'i'd like to be able to tell if its green 1,2, or 3'.
  // Noon on a weekday, so 'Today' holds whenever it runs (at 11 PM the stop's day was already tomorrow's).
  const wk = new Date(); wk.setDate(wk.getDate() + ([0, 6].includes(wk.getDay()) ? (8 - wk.getDay()) % 7 : 0)); wk.setHours(12, 0, 0, 0);
  await page.clock.setFixedTime(wk);
  await open(page);
  const pick = await onBusDay(page, () => page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), loops = d.D.hub.loops || [];
    for (const ri of loops) for (const [si, s] of d.D.stops.entries()) {
      if (s.hub) continue;
      const rows = d.timesOn(si, c.ymd).filter(x => x.r === ri);
      if (rows.length < 4 || !rows.some(x => d.busOf(x.trip, c.ymd))) continue;
      const all = d.timesOn(si, c.ymd).map(x => x.min);
      return { id: s.id, first: Math.floor(Math.min(...all) / 60), letter: d.D.routes[ri].short, spoken: d.D.routes[ri].long.replace(/ Loop$/, ''), noon: Date.now() + ((720 - c.min) * 60 - c.sec) * 1000 };
    }
    return null;
  }));
  test.skip(!pick, 'no loop with numbered buses this week');
  // at noon that day: after a stop's last bus its page has the next day's, and at night this failed
  await page.clock.setFixedTime(new Date(pick.noon));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await go(page, '#/stop/' + pick.id);
  const day = page.locator('.ws-day').filter({ visible: true }).first();
  await expect(day.locator('.ws-eye span').first()).toHaveText(/^Today$/i);
  const h0 = await day.locator('.hr-h').first().textContent();
  const want = pick.first % 12 === 0 ? 12 : pick.first % 12;
  expect(h0.trim()).toMatch(new RegExp('^' + want + '\\s*(AM|PM)$', 'i'));   // from the day's first bus, not this hour
  await expect(page.getByRole('link', { name: 'The whole day' })).toHaveCount(0);
  await day.locator('button.hr-dep', { has: page.locator('.badge', { hasText: new RegExp('^' + pick.letter + '$') }) }).first().click();
  await expect(page).toHaveURL(/\?run=/);
  await expect(page.locator('#runsheet .rs-bus').filter({ visible: true })).toHaveText(new RegExp('^' + pick.spoken + ' \\d'));
});

test('stop: a run opens on the Transit Center it left and ends at the Transit Center it gets in to', PHONE, async ({ page }) => {
  // The user: 'next clicking on any bus, the top of the list should have the transit center, and so should teh bottom.
  // so i can see when it will get to the transit center'. 55 North Main at midday on a day with buses: a loop's run
  // (the feed cuts the Blue Loop's there, the Center mid-trip) and a numbered route's (12, out and back as two trips).
  await open(page);
  const pick = await page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), si = d.D.stopById['7547679'], loops = d.D.hub.loops || [];
    for (let k = 0; k < 8; k++) {
      const ymd = t.dayFrom(c.ymd, k).ymd, rows = d.timesOn(si, ymd).filter(r => r.min >= 660 && r.min <= 900);
      const loop = rows.find(r => loops.includes(r.r)), route = rows.find(r => !loops.includes(r.r) && d.D.routes[r.r].short === '12') || rows.find(r => !loops.includes(r.r));
      if (loop && route) return { trips: [loop.trip, route.trip], at: Date.now() + ((t.dayDiff(c.ymd, ymd) * 1440 + 600 - c.min) * 60 - c.sec) * 1000 };
    }
    return null;
  });
  test.skip(!pick, 'no midday loop and route at 55 North Main this week');
  await page.clock.setFixedTime(new Date(pick.at));   // 10 AM that day: its midday times in the stop's day
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  for (const trip of pick.trips) {
    await go(page, '#/stop/7547679');
    await page.locator(`button.hr-dep[data-trip="${trip}"]`).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\?run=/);
    const rows = page.locator('#runsheet .run-stop').filter({ visible: true });
    await expect(rows.first()).toContainText('Transit Center');
    await expect(rows.first().locator('em')).toHaveText(/^(left|leaves)$/);
    await expect(rows.last()).toContainText('Transit Center');
    await expect(rows.last().locator('em')).toHaveText('gets in');
    expect(await rows.count()).toBeGreaterThan(3);   // this stop's run between them, not the Center twice
  }
});

test('stop: this side and across the road, two buttons under the name and the map labelled to match', async ({ page }) => {
  // Richard's Hall (1011 East 700 North) and Industrial Science across 700 North, or any stop with one across the road.
  await open(page);
  const pair = await page.evaluate(async () => {
    const d = await import('/app/data.js');
    const s = d.D.stops[d.D.stopById['7569115']]?.twin ? d.D.stops[d.D.stopById['7569115']] : d.D.stops.find(s => s.twin && !s.out);
    return s ? { id: s.id, twin: d.D.stops[s.twin[0]].id } : null;
  });
  test.skip(!pair, 'no stop with one across the road');
  await go(page, '#/stop/' + pair.id);
  const sides = page.locator('.stop-page .sides').filter({ visible: true }).first();
  await expect(sides.locator('.side.on')).toHaveAttribute('aria-current', 'true');
  await expect(sides.locator('.side.on b')).toHaveText('This side');
  const across = sides.locator('a.side');
  await expect(across.locator('b')).toHaveText('Across the road');
  await expect(across).toHaveAttribute('href', '#/stop/' + pair.twin);
  await expect(page.locator('.acrossrow')).toHaveCount(0);   // the card it replaces
  // the map, beside the page or above its sheet: the two sides labelled, the stop's on this side
  await mapReady(page);
  await expect(page.locator('.sidemark .sidelabel.here')).toHaveText(/^This side/);
  await expect(page.locator('.sidemark .sidelabel.there')).toHaveText(/^Across the road/);
  // across: the other stop's page, where it's this side, and the way back across
  await across.click();
  await expect(page).toHaveURL(new RegExp('#/stop/' + pair.twin + '$'));
  const back = page.locator('.stop-page .sides').filter({ visible: true }).first();
  await expect(back.locator('.side.on b')).toHaveText('This side');
  await expect(back.locator('a.side')).toHaveAttribute('href', '#/stop/' + pair.id);
  await expect(page.locator('.sidemark')).toHaveCount(2);
  // off the stop's page, the labels go with it
  await go(page, '#/map');
  await mapReady(page);
  await expect(page.locator('.sidemark')).toHaveCount(0);
});

test('map: a picked bus is where it is, its card from the stop it reaches next and its way on from it', PHONE, async ({ page }) => {
  // Bus 4014 on the Blue Loop's 6:05 (2026-10-16): the feed had 55 North Main, the stop the loop's trips end at, first
  // in its list, with the end's time, and the two stops just behind the bus still there, its word lagging. Its card led
  // with 55 North Main, its way on drawn from far ahead. Made up from the timetable: a loop's trip, the bus halfway
  // between two stops and moving, the clock a minute before the second; then its word minutes stale; then the bus on
  // its last leg, the end's stop alone in its list, first and last.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  await open(page);
  const pick = await onBusDay(page, () => page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), seen = new Set();
    for (const ri of d.D.hub.loops || []) for (const si of new Set(Object.values(d.D.routes[ri].stops || {}).flat())) for (const row of d.timesOn(si, c.ymd)) {
      if (row.r !== ri || seen.has(row.trip)) continue;
      seen.add(row.trip);
      const st = d.tripStops(row.trip), te = d.tripEnd(row.trip);
      if (!te || st.length < 9 || st[0][0] < 300 || te.min > 1380) continue;
      const pts = [...st, [te.min, te.si]], S = i => d.D.stops[pts[i][1]];
      // stops 3 to 8 apart, a block or more between each (the bus halfway is no stop's), a minute or more apart there
      const K = [3, 4, 5].find(K => [K - 1, K, K + 1, K + 2].every(i => d.distance(S(i).lat, S(i).lon, S(i + 1).lat, S(i + 1).lon) > 180) && pts[K + 1][0] - pts[K][0] >= 1 && pts[K + 1][0] - pts[K - 1][0] <= 4 && new Set(pts.slice(0, K + 6).map(x => x[1])).size === K + 6);
      if (K === undefined) continue;
      const a = S(K), b = S(K + 1), min = pts[K + 1][0] - 1, y = S(pts.length - 2), z = S(pts.length - 1);
      return { id: d.D.trips[row.trip], ti: row.trip, K, pts: pts.map(([m, x]) => [m, d.D.stops[x].id]), lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2,
        course: d.bearing(a.lat, a.lon, b.lat, b.lon), at: Date.now() + ((min - c.min) * 60 + 30 - c.sec) * 1000, min,
        last: [(y.lat + z.lat) / 2, (y.lon + z.lon) / 2], lastCourse: d.bearing(y.lat, y.lon, z.lat, z.lon) };
    }
    return null;
  }));
  test.skip(!pick, 'no loop trip this week to make the feed of');
  await page.clock.setFixedTime(new Date(pick.at));
  const T = Math.floor(pick.at / 1000), base = T - 30 - pick.min * 60, L = pick.pts.length - 1, end = pick.pts[L];
  const bus = { id: '9001', label: '9001', trip: pick.id, lat: pick.lat, lon: pick.lon, bearing: pick.course, speed: 8, ts: T };
  // first, the end's stop with the end's time; the two stops behind the bus, just gone by; the rest to come; the end
  const word = [[end[1], 0, base + end[0] * 60, 0], [pick.pts[pick.K - 1][1], pick.K - 1, T - 40, 0], [pick.pts[pick.K][1], pick.K, T - 20, 0],
    ...pick.pts.slice(pick.K + 1).map(([m, sid], i) => [sid, pick.K + 1 + i, base + m * 60, 0])];
  feed = { t: T, now: T, trips: { [pick.id]: { v: '9001', ts: T, s: word } }, buses: [bus] };
  await go(page, '#/map');
  await mapReady(page);
  await expect.poll(() => page.evaluate(async () => !!(await import('/app/rt.js')).findBus('c:9001')), { timeout: 20_000 }).toBe(true);
  await go(page, '#/map/bus/c:9001?tap=1');
  const rows = page.locator('#mapcard .nextstops a.ns');
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  const ahead = pick.pts.slice(pick.K + 1, pick.K + 6).map(([, sid]) => '#/stop/' + sid);
  await expect.poll(() => rows.evaluateAll(as => as.map(a => a.getAttribute('href')))).toEqual(ahead);
  const place = () => page.evaluate(async () => { const r = await import('/app/rt.js'), p = r.busPlace(r.findBus('c:9001')); return p && [p.ti, p.k]; });
  expect(await place()).toEqual([pick.ti, pick.K + 1]);   // where its way on is drawn from (map.js busPath)
  // The feed's word on its trip minutes stale, its end long gone by: still where it is, by its place.
  feed = { t: T, now: T, trips: { [pick.id]: { v: '9001', ts: T - 360, s: [[end[1], L, T - 360, 0]] } }, buses: [bus] };
  await expect.poll(() => rows.count(), { timeout: 15_000 }).toBe(0);   // the stale word in: nothing listed ahead
  expect(await place()).toEqual([pick.ti, pick.K + 1]);
  // On its last leg, the end's stop listed first and last with the one time: its next is the end, the card's one row.
  const [ya, xa] = pick.last;
  feed = { t: T, now: T, trips: { [pick.id]: { v: '9001', ts: T, s: [[end[1], 0, T + 60, 0], [end[1], L, T + 60, 0]] } }, buses: [{ ...bus, lat: ya, lon: xa, bearing: pick.lastCourse }] };
  await expect.poll(place, { timeout: 15_000 }).toEqual([pick.ti, L]);
  await expect.poll(() => rows.evaluateAll(as => as.map(a => a.getAttribute('href')))).toEqual(['#/stop/' + end[1]]);
});

test('map: a spot and its card, a road and its routes, a right click', async ({ page }) => {
  // On Main Street downtown, just south of Center Street: several routes, the nearest stops a block off either way.
  await open(page, '#/map/at/41.73450,-111.83457/Main%20St');
  await mapReady(page);
  await expect(page.getByRole('link', { name: 'Directions to here' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'From here' })).toBeVisible();
  // The way to put the map right: OpenStreetMap's editor at the spot, and 'Improve this map' in the credits.
  await expect(page.getByRole('link', { name: 'Fix it on OpenStreetMap' }).filter({ visible: true }).first()).toHaveAttribute('href', /openstreetmap\.org\/edit#map=19\/41\.73450\/-111\.83457/);
  await expect(page.locator('a[href="https://www.openstreetmap.org/fixthemap"]')).toHaveCount(1);
  // A tap on the road just beside its marker (Main runs north and south): the road's card, its routes as rows. The
  // spot was at 355 North Main, its stop 6 px off at the spot's zoom: a tap 12 px from it was in a thumb's reach of
  // the stop (a phone's 18 px; a mouse's 8, and the stop's dot), and opened it a moment later, the road's card never
  // up. Here the stops are 60 px off and more. The spot's marker read once the map has stopped (flown to the spot),
  // the tap beside it not on a bus going by, and the road's card waited for by its address: the spot's own card has
  // routes as rows too, and the test had clicked one of those.
  const box = await still(page.locator('.spot-marker'));
  const tap = await page.evaluate(({ x, y }) => [12, -12, 24, -24].map(d => [x, y + d]).find(([x, y]) => (document.elementFromPoint(x, y) || {}).classList?.contains('maplibregl-canvas')) || [x, y + 12], { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.mouse.click(tap[0], tap[1]);
  await expect(page).toHaveURL(/#\/map\/at\/.*\?road=/);
  // Each route a button that says it opens the whole route (cr-v565: a bare chevron was missed).
  const row = page.locator('#mapcard.open .roadroute').filter({ visible: true }).first();
  await expect(row).toContainText(/Whole (route|loop)/);
  await row.click();
  await expect(page).toHaveURL(/#\/map\/route\//);
  await go(page, '#/map');
  await mapReady(page);
  const map = await page.locator('#map').boundingBox();
  await page.mouse.click(map.x + map.width * 0.7, map.y + map.height * 0.3, { button: 'right' });
  await expect(page.getByRole('link', { name: 'Directions to here' })).toBeVisible();
});

test('Back on a phone\'s map: a long press\'s card, a stop\'s sheet swiped away, the Map tab lit for a stop of the map', PHONE, async ({ page }) => {
  // A friend on the map: a card opened with no entry of its own, so Back left the map (twice, and the app was gone);
  // a stop's sheet swiped away added the map again, so Back opened it again; a stop off the map lit Stops.
  const id = await (async () => { await open(page); return someStop(page); })();
  await go(page, '#/map');
  await mapReady(page);
  const map = await page.locator('#map').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const x = map.x + map.width * 0.5, y = map.y + map.height * 0.35;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(800);
  await expect(page.locator('#mapcard')).not.toHaveClass(/\bopen\b/);   // held: the spot marked, its card on the lift
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page).toHaveURL(/#\/map\/at\//);
  await expect(page.locator('#mapcard')).toHaveClass(/\bopen\b/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/map$/);
  await expect(page.locator('#mapcard')).not.toHaveClass(/\bopen\b/);
  // Held, then moved: a pan, no card.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(800);
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + i * 10 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(600);
  await expect(page).toHaveURL(/#\/map$/);
  await expect(page.locator('#mapcard')).not.toHaveClass(/\bopen\b/);
  // A stop from the map: the Map tab lit, its sheet swiped away, and Back past it, not into it again.
  await go(page, '#/stop/' + id);
  await expect(page.locator('#mapcard .pagesheet')).toBeVisible();
  await expect(page.locator('#tabs a[href="#/map"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#mapcard .backbar a').first()).toContainText('Back');
  await page.waitForTimeout(600);
  const grip = async () => (await page.locator('#mapcard .grip').boundingBox()).y + 20;
  const swipe = async (y0, y1) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: y0 }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: y0 + (y1 - y0) * i / 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(500);
  };
  for (let i = 0; i < 3 && /#\/stop\//.test(page.url()); i++) await swipe(await grip(), (await grip()) + 220);
  await expect(page).toHaveURL(/#\/map$/);
  await page.goBack();
  await expect(page).not.toHaveURL(/#\/stop\//);
});

test('Transit Center: directions there from its board, to any of its bays', PHONE, async ({ page }) => {
  await open(page, '#/hub');
  await mapReady(page);
  const link = page.getByRole('link', { name: 'How to get here' }).filter({ visible: true }).first();
  await expect(link).toHaveAttribute('href', /^#\/go\/[^/]+$/);
  // From Logan's court, to its first bay and to the Center as a place: the same first way.
  const bay = (await link.getAttribute('href')).replace('#/go/', '');
  const d = new Date(); d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  const t = '?t=' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-0900';
  const first = async h => { await go(page, h); const j = page.locator('.jsum').filter({ visible: true }).first(); await expect(j).toBeVisible(); return j.locator('.badge').first().getAttribute('title'); };
  const a = await first('#/go/' + bay + '/at/41.73999,-111.83690/Logan%20Municipal%20Court' + t);
  const b = await first('#/go/@41.74061,-111.83124:Transit%20Center/at/41.73999,-111.83690/Logan%20Municipal%20Court' + t);
  expect(a).toBe(b);
});

test('Transit Center: the board, a row to its bus or its route, the Center on the map', async ({ page }, info) => {
  await open(page, '#/hub');
  await mapReady(page);
  await expect(page.locator('.tcl-head h1').filter({ visible: true })).toHaveText('Transit Center');
  await expect(page.locator('.tcl-grp, .tcl-note').filter({ visible: true }).first()).toBeVisible();
  // on a phone the map opens on the bays, every route's badge at its stop (grey while its bus isn't in); the tab
  // again, out to the streets about it, the Center's label on it; again, the bays
  if (phone(info)) {
    await expect(page.locator('.hbay').first()).toBeVisible();
    expect(await page.locator('.hbay').count()).toBeGreaterThan(8);
    const tab = page.locator('#tabs a[href="#/hub"]');
    await tab.click();
    await expect(page.locator('.hubtag').filter({ visible: true })).toContainText('Transit Center');
    await expect(page.locator('.hbay')).toHaveCount(0);
    await tab.click();
    await expect(page.locator('.hbay').first()).toBeVisible();
  }
  // a row: its bus on the map where there's one out, else its route picked, its next few and its day from here
  const row = page.locator('a.tcl-row').filter({ visible: true }).first();
  if (await row.count()) {
    // (which it is can change with the feed between a look and a tap: a bus come into it)
    await row.click();
    await expect(page).toHaveURL(/#\/(map\/bus|hub)\/.+/);
    if (/#\/hub\//.test(page.url())) {
      await expect(page.locator('.tc-pick')).toBeVisible();
      await page.locator('.tc-pick a[aria-label="Close"]').click();
      await expect(page).toHaveURL(/#\/hub$/);
    }
  }
  // A bay stands at its pole (OSM's, tools/reduce.py) with its stop: the badge, the stop's dot and the walks to it one place.
  expect(await page.evaluate(async () => { const d = await import('/app/data.js'); return d.D.hub.bays.filter(b => b.lat !== d.D.stops[b.stop].lat || b.lon !== d.D.stops[b.stop].lon).length; })).toBe(0);
});

test('Transit Center: a bus standing in it is a badge in its label, its own marker put away, a tap to it', async ({ page }) => {
  // The half hour's buses in were one bus drawn and '+9' on the map (2026-10-27): each now a badge in the Center's label.
  const relay = { T: 0, feed: null, alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const run = await onBusDay(page, () => centreRun(page, 30));
  test.skip(!run, 'no run from the Center this week');
  relay.feed = bayFeed(run, 0); relay.T = relay.feed.t;
  await page.clock.setFixedTime(new Date(run.at));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await go(page, '#/hub');
  await polled(page, relay.T);
  // a phone opens on the bays: its tab again, out to the streets about it, where the label is
  if (await page.locator('#tabs').isVisible()) { await page.waitForTimeout(800); await page.locator('#tabs a[href="#/hub"]').click(); }
  const badge = page.locator('.hubtag .in a[href="#/map/bus/c%3A9001"]');
  await expect(badge).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.maplibregl-marker.bus.athub')).toHaveCount(1);
  // pulled out and on its way: out of the label, drawn as itself
  relay.feed = bayFeed(run, 150, true); relay.T = relay.feed.t;
  await page.clock.setFixedTime(new Date(run.at + 150_000));
  await polled(page, relay.T);
  await expect(badge).toHaveCount(0);
  await expect(page.locator('.maplibregl-marker.bus.athub')).toHaveCount(0);
});

test('Transit Center: the rest of the day, a line a route with its last bus, a tap to its every time; after the last, the next day\'s', PHONE, async ({ page }) => {
  // A rider at the Center coming back later: when's the last 3, is there a 16 this afternoon. Under the next hour, each
  // route's line says its last departure today, the day's last bus beside the heading; a line opens its route's card,
  // with every time it leaves today. After the day's last bus, the next day with buses, from its first. The clock set
  // from the timetable (three hours into the first day with buses from here, then a minute past its last), the feed
  // down so every time is the timetable's.
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => r.abort());
  await open(page);
  const pick = await page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now();
    const key = ri => d.D.routes[ri].short.replace(/\s+(AM|PM)$/i, '');
    for (let day = 0; day < 8; day++) {
      const ymd = t.dayFrom(c.ymd, day).ymd, per = {};
      for (const b of d.D.hub.bays) for (const x of d.timesOn(b.stop, ymd)) if (b.routes.includes(x.r)) (per[key(x.r)] ||= []).push(x);
      for (const ms of Object.values(per)) ms.sort((a, b) => a.min - b.min);
      const all = Object.values(per).flat().map(x => x.min);
      if (!all.length) continue;
      const last = Math.max(...all), at = Math.min(Math.min(...all) + 180, last - 60), start = Date.now() - (c.min * 60 + c.sec) * 1000 + day * 864e5;
      // each route still to leave then, and its last time: the line it's on says it, and when that run goes only part
      // of the way (the night's 8:30s), says so
      const lasts = Object.entries(per).filter(([, ms]) => ms.some(x => x.min >= at)).map(([k, ms]) => { const x = ms[ms.length - 1]; return [k, t.clockText(x.min), /^Last run \(partial/.test(d.lastRun({ ...x, ymd }) || '')]; });
      return { lasts, last: t.clockText(last), at: start + (at * 60 + 30) * 1000, after: start + ((last + 1) * 60 + 30) * 1000 };
    }
    return null;
  });
  test.skip(!pick, 'no buses from the Center this week');
  const board = async when => {
    await page.clock.setFixedTime(new Date(when));
    await page.evaluate(() => history.replaceState(null, '', '#/hub'));   // the board afresh at that time, nothing picked
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
    const more = page.locator('.tcl-more').filter({ visible: true }).first();   // today's, behind a tap; another day's, out
    await expect(page.locator('.tcd').first()).toBeAttached({ timeout: 20_000 });
    if (await more.count()) await more.click();
    const sec = page.locator('.tcd').filter({ visible: true }).first();
    await expect(sec).toBeVisible();
    return sec;
  };
  let sec = await board(pick.at);
  await expect(sec.locator('.section > span').first()).toHaveText(/^The rest of today$/i);
  await expect(sec.locator('.section .note')).toHaveText('Last bus ' + pick.last);
  for (const [k, last, part] of pick.lasts) {
    const href = '#/hub/' + encodeURIComponent(k), row = sec.locator(`a.tcd-row[href="${href}"], .tcd-row:not(.tcd-none):has(a[href="${href}"])`);
    await expect(row, `Route ${k}'s line`).toContainText(last.replace(' ', '\u00a0'));
    if (part) await expect(row, `Route ${k}'s last run, part way`).toContainText(last.replace(' ', '\u00a0') + ' part way');
  }
  // a line of one route: its card, every time it leaves today
  const one = sec.locator('a.tcd-row').first();
  const href = await one.getAttribute('href');
  await one.click();
  await expect(page).toHaveURL(new RegExp(href.replace(/[/#]/g, '\\$&') + '$'));
  await expect(page.locator('.tc-pick').filter({ visible: true })).toBeVisible();
  await expect(page.locator('.tc-day').filter({ visible: true })).toContainText('today from here');
  // a minute past the day's last bus: the next day's, each route from its first (its first bus the next hour's heading)
  sec = await board(pick.after);
  await expect(sec.locator('.section > span').first()).not.toHaveText(/^The rest of today$/i);
  await expect(sec.locator('.section .note')).toHaveCount(0);
  await expect(sec.locator('.tcd-row:not(.tcd-none)', { hasText: ' from ' }).first()).toBeVisible();
});

test('Transit Center on a wide screen: the map left where it is, no view buttons', WIDE, async ({ page }) => {
  // From the Stops page, its panel already beside the map: from the Map tab the panel comes in, and the map keeps the
  // place looked at in the middle of what's left, half the panel over, whichever page it is.
  await open(page, '#/');
  await mapReady(page);
  await someBus(page);   // markers on the map to measure it by, when buses are out
  // Where each bus marker sits on the screen: flown to the Center, every one would be hundreds of pixels off; a live
  // bus creeps a few. (No bus out: the bays not shown is the check.)
  // (Not a bus put in the Center's label, nor one held off its edge: the label comes with the board.)
  const spots = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.maplibregl-marker.bus:not(.athub):not(.heldoff)')].map(e => { const r = e.getBoundingClientRect(); return [e.title, [r.x, r.y]]; })));
  const moved = (a, b) => Math.max(0, ...Object.keys(a).filter(k => b[k]).map(k => Math.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1])));
  const before = await spots();
  const faint = () => page.evaluate(() => JSON.stringify(window.__map.getPaintProperty('stops', 'circle-opacity')));
  const asDrawn = await faint();
  await page.locator('#topnav a[href="#/hub"]').click();
  await expect(page.locator('.tcl-head h1').filter({ visible: true })).toHaveText('Transit Center');
  await page.waitForTimeout(1500);
  expect(moved(before, await spots()), 'pixels the map moved').toBeLessThan(60);
  // The route lines still drawn (every line went, 2026-10-27); the stops faint, back as drawn on the Map tab.
  expect(await page.evaluate(() => window.__map.getLayoutProperty('route-lines', 'visibility'))).not.toBe('none');
  expect(await faint()).not.toBe(asDrawn);
  // The link again is only the link: the map still where it was, and no Bays or Streets buttons (gone 2026-11-18).
  await page.locator('#topnav a[href="#/hub"]').click();
  await page.waitForTimeout(1000);
  expect(moved(before, await spots()), 'pixels the map moved').toBeLessThan(60);
  await expect(page.locator('.hubviews')).toHaveCount(0);
  // Whole town: Logan's stops in view, the board still beside it.
  await page.locator('.townbtn').click();
  await expect.poll(() => page.evaluate(() => window.__map.getZoom()), { timeout: 3000 }).toBeLessThanOrEqual(14.01);
  await expect(page.locator('.tcl-head h1').filter({ visible: true })).toHaveText('Transit Center');
  // Left for the Map tab: the stops as drawn again.
  await page.locator('#topnav a[href="#/map"]').click();
  await expect(page.locator('.hubtag')).toHaveCount(0);
  expect(await faint()).toBe(asDrawn);
});

test('directions: each way in, a plan, no way, from only', PHONE, async ({ page }) => {
  await open(page);
  const id = await someStop(page);
  await go(page, '#/go/' + id);
  await expect(page.getByText(/A spot on the map/).first()).toBeVisible();
  await go(page, '#/go/-/at/41.73790,-111.83457/Main%20St');
  await expect(page.getByText(/To a spot on the map/)).toBeVisible();
  await go(page, '#/map/to/@41.73790,-111.83457:Main%20St');
  await expect(page.getByText(/Tap where you're going/)).toBeVisible();
  await go(page, '#/map/from/' + id);
  await expect(page.getByText(/Tap where you'll start from/)).toBeVisible();
  // USU to downtown, and out to Providence: a ride (or a change), the page or the map's card.
  for (const h of ['#/go/@41.73790,-111.83457:Main/at/41.74520,-111.81300/USU', '#/go/@41.69000,-111.81500:Providence/at/41.74100,-111.83080/Center']) {
    await go(page, h);
    await expect(page.getByText(/Leave now|Leave at|No bus|walk/i).filter({ visible: true }).first()).toBeVisible();
  }
});

test('directions up: a tap on the map changes nothing, a long press or right click asks which end', async ({ page }) => {
  await open(page);
  await inBusHours(page);   // the feed's tick waited for below
  const h = '#/go/@41.74335,-111.81510:Institute/at/41.75484,-111.81505/Aztec';
  await go(page, h);
  await mapReady(page);
  await expect(page.getByText(/Leave|walk/i).filter({ visible: true }).first()).toBeVisible();
  await clickNothing(page);   // zoomed out off the stops, a click on the map
  expect(decodeURIComponent(await page.evaluate(() => location.hash))).toBe(decodeURIComponent(h));
  // The same spot, a right click (a long press on a phone): this spot as either end, asked.
  const map = await page.locator('#map').boundingBox(), side = await page.locator('#side').boundingBox();
  const open_ = page.locator('#mapcard.open'), card = (await open_.count()) ? await open_.boundingBox() : null;
  const left = side && side.width < map.width * 0.6 && side.x <= map.x + 1 ? side.x + side.width : map.x;
  const top = map.y + 80, bottom = card && card.width > map.width * 0.6 ? card.y - 10 : map.y + map.height - 60;
  await page.mouse.click(left + 30, (top + bottom) / 2, { button: 'right' });
  await expect(page.locator('#mapcard.open .eyebrow', { hasText: 'Change directions' })).toBeVisible();
  const start = page.locator('#mapcard a', { hasText: 'Start from here' });
  await expect(start).toBeVisible();
  await nextTick(page);   // the feed's redraw: on a phone the directions' took the card back
  await expect(start).toBeVisible();
  await expect(page.locator('#mapcard a', { hasText: 'Go here instead' })).toHaveAttribute('href', /^#\/go\/@[-\d.,]+.*\/at\/41\.75484,-111\.81505\/Aztec$/);
  await start.click();
  await expect(page).toHaveURL(/#\/go\/@41\.74335,-111\.81510:Institute\/at\/[-\d.]+,[-\d.]+\//);
});

test('directions from where you are: a right click asks which end, the destination kept', async ({ page }, info) => {
  // Directions to a spot, from where the phone is (no start in the address): a right click went to the bare spot, the
  // destination dropped, so its From here started over.
  await page.addInitScript(() => { localStorage.setItem('cr-near', 'on'); localStorage.setItem('cr-lastgeo', JSON.stringify({ lat: 41.74061, lon: -111.83124, at: Date.now(), acc: 0, picked: true })); });
  await open(page);
  await go(page, '#/go/@41.75484,-111.81505:Aztec');
  await mapReady(page);
  await expect(page.getByText(/Leave|walk/i).filter({ visible: true }).first()).toBeVisible();
  const map = await page.locator('#map').boundingBox(), side = await page.locator('#side').boundingBox();
  const open_ = page.locator('#mapcard.open'), card = (await open_.count()) ? await open_.boundingBox() : null;
  const left = side && side.width < map.width * 0.6 && side.x <= map.x + 1 ? side.x + side.width : map.x;
  const top = map.y + 80, bottom = card && card.width > map.width * 0.6 ? card.y - 10 : map.y + map.height - 60;
  const asked = page.locator('#mapcard.open .eyebrow', { hasText: 'Change directions' });
  await page.mouse.click(left + 30, (top + bottom) / 2, { button: 'right' });
  await expect(asked).toBeVisible();
  // On a phone, swiped away: the directions' own card again, the one it was put over (the card stayed away till a
  // redraw that wasn't the feed's), the address as it was. Then asked again.
  if (phone(info)) {
    const cdp = await page.context().newCDPSession(page);
    for (let i = 0; i < 3 && await asked.count(); i++) {
      const y0 = (await page.locator('#mapcard .grip').boundingBox()).y + 20;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: y0 }] });
      for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: y0 + 220 * k / 8 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(600);
    }
    await expect(page.locator('#mapcard.open > .gohead')).toBeVisible();
    await expect(page).toHaveURL(/#\/go\/@41\.75484,-111\.81505:Aztec$/);
    await page.mouse.click(left + 30, (top + bottom) / 2, { button: 'right' });
    await expect(asked).toBeVisible();
  }
  // A redraw that isn't the feed's, the same address (the relay's alerts coming in, a detour traced, a location fix):
  // the card stays. It went with the alerts a second after it came up, on a phone and beside a wide screen's page.
  await page.evaluate(() => window.dispatchEvent(new Event('seenchange')));
  await page.waitForTimeout(500);
  await expect(asked).toBeVisible();
  await expect(page.locator('#mapcard a', { hasText: 'Go here instead' })).toHaveAttribute('href', /^#\/go\/@[-\d.,]+:[^/]*$/);   // from where you are still
  await page.locator('#mapcard a', { hasText: 'Start from here' }).click();
  await expect(page).toHaveURL(/#\/go\/@41\.75484,-111\.81505:Aztec\/at\/[-\d.]+,[-\d.]+\//);
});

test('a tablet turned: the phone\'s card goes as the page comes in beside the map', WIDE, async ({ page }) => {
  // Upright (under 840 px) the directions are the map with the ways as its card; turned, the page beside the map. The
  // same address, so the card was put away only by the layout's change counting as a page arrived at.
  await page.setViewportSize({ width: 800, height: 1000 });
  await open(page, '#/go/@41.75484,-111.81505:Aztec/at/41.74061,-111.83124/Center');
  await expect(page.locator('#mapcard.open')).toBeVisible({ timeout: 20_000 });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#side')).toBeVisible();
  await expect(page.locator('#mapcard')).not.toHaveClass(/\bopen\b/);
});

test('directions, no stop a walk off: the nearest starts in view, one picked, and it stays put', PHONE, async ({ page }) => {
  // From far out of the valley's routes: no way by bus.
  await open(page, '#/go/@41.74321,-111.81488:Logan/at/41.90000,-112.00000/Far%20away');
  await inBusHours(page);   // the feed's ticks waited for below
  const card = page.locator('#mapcard');
  const answer = card.locator('.gonone .empty h2');
  await expect(answer).toBeVisible();
  const inCard = async () => { const a = await answer.boundingBox(), c = await card.boundingBox(); return a && c && a.y >= c.y && a.y + a.height <= c.y + c.height + 1; };
  expect(await inCard(), 'the answer inside the card as it opens').toBe(true);
  // Opened out, the feed's ticks leave it so (each shut it to its head: 66 px).
  await card.evaluate(c => c.classList.remove('peek'));
  const h = (await card.boundingBox()).height;
  await nextTick(page, 2);
  expect(Math.round((await card.boundingBox()).height), 'the card\'s height after the feed\'s ticks').toBe(Math.round(h));
  // No stop a walk off: the nearest stops a bus there leaves from, one picked giving the way from it.
  const start = card.locator('.farstarts a.row').first();
  if (await start.count()) {
    const href = await start.getAttribute('href');
    await start.click();
    await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
    await expect(page.getByText(/leaves|Leave/).filter({ visible: true }).first()).toBeVisible();
  }
});

test('directions with no way by bus, on a phone: a long press\'s card stays through the feed\'s ticks', PHONE, async ({ page }) => {
  // From far out of the valley's routes, a long press (a right click) on the map: 'Change directions' over the 'no bus
  // goes there' card. The feed's next tick drew the directions' card back over it: the guard compared the address the
  // press was made at with the no-way card's own key ('none:' and where to), never the same.
  await open(page, '#/go/@41.74321,-111.81488:Logan/at/41.90000,-112.00000/Far%20away');
  await inBusHours(page);   // the feed's tick waited for below
  await mapReady(page);
  const card = page.locator('#mapcard');
  await expect(card.locator('.gonone .empty h2')).toBeVisible();
  const map = await page.locator('#map').boundingBox(), c = await card.boundingBox();
  await page.mouse.click(map.x + 40, (map.y + 80 + c.y - 10) / 2, { button: 'right' });
  const asked = page.locator('#mapcard.open .eyebrow', { hasText: 'Change directions' });
  await expect(asked).toBeVisible();
  // A tick, as the feed's word makes one, then the feed's own: the card stays, the address as it was
  await page.evaluate(async () => (await import('/app/main.js')).render(true));
  await nextTick(page);
  await expect(asked).toBeVisible();
  await expect(card.locator('.gonone')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/go\/@41\.74321,-111\.81488:Logan\/at\/41\.90000,-112\.00000\/Far%20away$/);
  await page.locator('#mapcard a', { hasText: 'Start from here' }).click();
  await expect(page).toHaveURL(/#\/go\/@41\.74321,-111\.81488:Logan\/at\/[-\d.]+,[-\d.]+\//);
});

test('directions, no stop a walk off the place: the nearest a bus gets you, one picked', PHONE, async ({ page }) => {
  // From a stop downtown to the fields west of Logan, out of a walk of any stop.
  await open(page);
  const id = await someStop(page);
  await go(page, '#/go/@41.73000,-111.95000:West%20of%20Logan/' + id);
  const row = page.locator('.farstarts a.row').filter({ visible: true }).first();
  await expect(row).toBeVisible();
  await expect(page.getByText(/No stop within a walk of West of Logan/).filter({ visible: true }).first()).toBeVisible();
  const href = await row.getAttribute('href');
  expect(href, 'a way to that stop, from the same start').toMatch(new RegExp('^#/go/\\d+/' + id + '$'));
  await row.click();
  await expect(page).toHaveURL(new RegExp(href + '$'));
});

test('directions arriving by a time: the shuttle among the ways, said as the shuttle is', PHONE, async ({ page }) => {
  // The Aztec Building's chapel to the Institute of Religion, by 7 PM on a weekday to come: the Evening Express (to
  // 10 PM), its longest wait counted, one of the ways (walks timed flat, the Blue Loop and a walk up the bench leaves
  // later, first); the Stadium Express (to 5 PM) no way.
  await open(page);
  const d = new Date(); do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6);
  const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  await go(page, '#/go/@41.74335,-111.81510:Institute/at/41.75484,-111.81505/Aztec?t=a' + ymd + '-1900');
  const picked = page.locator('.jsum').filter({ visible: true }).first();
  await expect(picked).toBeVisible();
  if (!/Evening/.test(await picked.innerText())) await page.locator('.jrow[data-go]:not(.jsum)').filter({ hasText: 'Evening' }).filter({ visible: true }).first().click();
  await expect(picked).toContainText('Evening');
  await expect(picked).toContainText(/Leave by/);   // no timetable: a leave-by and a latest, not times it's due
  await expect(picked).toContainText(/at the latest/);
  await expect(page.getByText(/Be at the stop by/).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/A bus at least every \d+ min/).filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('.jrow').filter({ hasText: 'Stadium' })).toHaveCount(0);
  await expect(page.locator('.sa-row')).toHaveCount(0);   // said as the way, not beside it
  // Walking the whole way beside it: how long, how far.
  await expect(page.locator('a.walkall').filter({ visible: true }).first()).toContainText(/\d+ min · [\d.,]+ (ft|mi|m|km)\b/);
});

test('walks by the one rule, the same before and after the paths load; steep ground red on the directions map only', PHONE, async ({ page }) => {
  // The user: 'map routing. we should do it the stupid way, lots of options, fast and stupid', and 'show where there are
  // steep areas somehow. a red overlay on land showing on particularly steep slopes that's only visible in routing view'.
  await open(page);
  // A walk's minutes: the crow's line and a third again, at 75 m a minute; the paths' file in or not.
  const rule = () => page.evaluate(async () => { const g = await import('/app/geo.js'), d = await import('/app/data.js'); const p = [41.73999, -111.83690, 41.74061, -111.83124];
    return [g.walkMins(...p), Math.max(1, Math.ceil(d.distance(...p) * 1.3 / 75))]; });
  const [a, b] = await rule();
  expect(a).toBe(b);
  await page.evaluate(() => import('/app/geo.js').then(g => g.loadWalkNet()));
  expect((await rule())[0]).toBe(a);
  // Old Main from Utah Podiatry: up the bench, the way drawn; the steep layer shown, then gone on the plain map.
  await go(page, '#/go/@41.74180,-111.80900:Old%20Main/at/41.73632,-111.83415/Utah%20Podiatry');
  await expect(page.locator('.jsum').filter({ visible: true }).first()).toBeVisible();
  const vis = () => page.evaluate(() => { const m = window.__map; return m && m.getLayer('jr-steep') ? m.getLayoutProperty('jr-steep', 'visibility') : 'none'; });
  await expect.poll(vis, { timeout: 20_000 }).toBe('visible');
  await expect(page.locator('[data-steep], [data-xing]')).toHaveCount(0);   // no Avoid steep, no Crosswalks: the map shows the hills
  await go(page, '#/map');
  await expect.poll(vis, { timeout: 10_000 }).toBe('none');
});

test('directions: a ride no quicker than walking, sparing little of it, isn\'t offered (Logan\'s court to the Center)', PHONE, async ({ page }) => {
  // From the Municipal Court, just after the 9 and the 6 had gone at 6:18, the Green Loop came first: on at 355 North
  // Main, south round its loop and back up to Zions, 22 minutes with 11 on foot, where the walk is 10. The 9 and the 6
  // from across the road are the ways; walking beats the Green on every count. At 6:21 since CVTD's feed of 2 Nov 2026
  // moved the 6's stop at 400 North 13 m nearer, and its 6:20 could be caught from 6:18.
  await open(page);
  const d = new Date(); d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  await go(page, '#/go/@41.74061,-111.83124:Transit%20Center/at/41.73999,-111.83690/Logan%20Municipal%20Court?t=' + ymd + '-0621');
  await expect(page.locator('.jsum').filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('.jrow .badge[title="Green Loop"]').filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('.jsum .badge').filter({ visible: true }).first()).toHaveText('9');
  await expect(page.locator('a.walkall').filter({ visible: true }).first()).toContainText('Quicker on foot');
});

test('directions arriving by a time on a later day: that day said, no bus missed', PHONE, async ({ page }) => {
  // Richmond to Utah Podiatry, by 8 AM on a weekday to come: the 15 at 6:40 was 'Today' and 'Missed it? The next 15
  // leaves at 8:10' (gone by the time picked, 8:00, not by the clock), as if the 15 ran hourly.
  await open(page);
  // A service day: not a weekend, not a holiday (Thanksgiving was two days out on 24 Nov 2026).
  const ymdOf = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const d = new Date(); d.setDate(d.getDate() + 2);
  while (d.getDay() === 0 || d.getDay() === 6 || !(await page.evaluate(async y => !!(await import('/app/data.js')).agencyRuns(y), ymdOf(d)))) d.setDate(d.getDate() + 1);
  const ymd = ymdOf(d);
  await go(page, '#/go/@41.73632,-111.83415:Utah%20Podiatry/at/41.92243,-111.80832/Richmond?t=a' + ymd + '-0800');
  const picked = page.locator('.jsum').filter({ visible: true }).first();
  await expect(picked).toBeVisible();
  await expect(picked.locator('.eyebrow')).toHaveText(new RegExp(d.toLocaleDateString('en-US', { weekday: 'long' }), 'i'));
  await expect(page.locator('.tl .missed')).toHaveCount(0);
});

test('a route\'s first run the other way, turned round from this way, doesn\'t start there (15 south from Richmond)', PHONE, async ({ page }) => {
  // The map's 'starts here' marks a way's first run where it starts partway along. 15 south's first leaves Richmond,
  // but its bus is 15 north's first turned round there: one run, started at the Center, so nothing starts in Richmond.
  await open(page);
  const r = await page.evaluate(async () => {
    const d = await import('/app/data.js');
    const t = new Date(); do t.setDate(t.getDate() + 1); while (t.getDay() === 0 || t.getDay() === 6);
    const ymd = t.getFullYear() + String(t.getMonth() + 1).padStart(2, '0') + String(t.getDate()).padStart(2, '0');
    const ri = d.D.routes.findIndex(x => x.short === '15');
    const firsts = [0, 1].map(dir => { let f = null;
      for (const si of new Set(Object.values(d.D.routes[ri].stops).flat())) for (const x of d.timesOn(si, ymd)) {
        if (x.r !== ri || x.dir !== dir) continue;
        const st = d.tripStops(x.trip); if (!f || st[0][0] < f.min) f = { trip: x.trip, min: st[0][0], si: st[0][1] }; }
      return f; });
    return firsts.map(f => { const run = d.runOf(f.trip, ymd), s0 = d.tripStops(run[0])[0][1];
      return { hub: !!d.stop(f.si).hub, own: run[0] === f.trip, startHub: !!d.stop(s0).hub }; });
  });
  const partway = r.filter(x => !x.hub);
  expect(partway.length, 'one way of the 15 leaves from partway along').toBeGreaterThan(0);
  for (const x of partway) { expect(x.own, 'its run began before it').toBe(false); expect(x.startHub, 'at the Center').toBe(true); }
});

test('directions: the planner over random trips throws on none', WIDE, async ({ page }) => {
  test.setTimeout(240_000);   // 160 trips planned and drawn in the page, with the hub's own way worked out for each start picker: minutes on a loaded machine
  await open(page);
  const out = await page.evaluate(async () => {
    const go = await import('/app/views/go.js'), t = await import('/app/time.js'), geo = await import('/app/geo.js'), { D } = await import('/app/data.js');
    // The shuttle's buses in first: the planner offers a shuttle ride only once it knows where they are, and a shuttle
    // leg is where directions broke (2026-10-06); planned before its feed came in, no trip had one, and it passed.
    const usu = await import('/app/usu.js');
    for (let i = 0; i < 40 && !usu.hasData(); i++) await new Promise(r => setTimeout(r, 500));
    const shuttleOut = usu.hasData() && usu.live.buses.length > 0;
    // Seeded, so a failure comes back the same trip next run.
    let s = 12345; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const spot = () => ({ lat: 41.69 + r() * 0.10, lon: -111.87 + r() * 0.07, label: 'X' });
    const stopId = () => D.stops[Math.floor(r() * D.stops.length)].id;
    const errs = []; const now = t.now(); let n = 0, withShuttle = 0;
    for (let i = 0; i < 40; i++) {
      const a = spot(), b = spot(), to = geo.spotKey(b.lat, b.lon, 'B');
      for (const c of [{ to, at: a }, { to: stopId(), at: a }, { to, from: stopId(), at: null }, { to: stopId(), from: stopId() }]) {
        n++;
        try { if (/class="(u)?chip/.test(String(go.render({ ...c }, now).html))) withShuttle++; go.journey({ ...c }, undefined, now); } catch (e) { errs.push(JSON.stringify(c) + ': ' + e.message); }
      }
    }
    return { n, errs, withShuttle, shuttleOut };
  });
  expect(out.errs, `${out.n} trips`).toEqual([]);
  // With the shuttle out, some of the trips are by it: if none are, the shuttle's part of the planner went untried.
  if (out.shuttleOut) expect(out.withShuttle, 'trips with a shuttle ride').toBeGreaterThan(0);
});

test('Aggie Shuttle: campus, a loop, a stop on it', PHONE, async ({ page }) => {
  await open(page, '#/map/usu');
  await mapReady(page);
  await go(page, '#/routes');
  const loop = page.locator('a.row[href^="#/usu/route/"]').filter({ visible: true }).first();
  await expect(loop).toBeVisible();
  await loop.click();
  await expect(page).toHaveURL(/#\/usu\/route\//);
  const stopRow = page.locator('a[href^="#/usu/"]:not([href^="#/usu/route/"])').filter({ visible: true }).first();
  if (await stopRow.count()) { await stopRow.click(); await expect(page).toHaveURL(/#\/usu\/(?!route)/); }
});

test('alerts and detours: the list, one on the map', PHONE, async ({ page }) => {
  // A notice staged (with none of Connect's up, the list said so and nothing was opened): in the list, and its card on
  // the map.
  const id = await stageClosure(page);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await go(page, '#/about/alerts');
  const row = page.locator('.alertrow').filter({ visible: true }).filter({ has: page.locator('a[href="#/map/alert/' + CLOSURE + '"]') });
  await expect(row).toContainText('Stop Closure');
  await expect(row.locator(`a[href="#/stop/${id}"]`)).toBeVisible();   // the stop it names
  await row.locator('a.alerthead').click();
  await expect(page).toHaveURL(new RegExp('#/map/alert/' + CLOSURE));
  await mapReady(page);
  await expect(page.locator('#mapcard.open .eyebrow')).toBeVisible();
});

test('alerts: notifications on and off', PHONE, async ({ page }) => {
  // The browser's push made up (a headless browser has none): its say-so, a push address; the relay's answers staged.
  await page.addInitScript(() => {
    let sub = null;
    const fake = { endpoint: 'https://fcm.googleapis.com/fcm/send/smoke', toJSON: () => ({ endpoint: fake.endpoint, keys: { p256dh: 'x', auth: 'y' } }), unsubscribe: async () => { sub = null; return true; } };
    Notification.requestPermission = async () => 'granted';
    const reg = { pushManager: { subscribe: async () => (sub = fake), getSubscription: async () => sub } };
    Object.defineProperty(navigator.serviceWorker, 'ready', { value: Promise.resolve(reg) });   // the worker's blocked here
  });
  const sent = [];
  await page.route(/^https:\/\/live\.cacherider\.com\/push/, r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type', 'access-control-allow-methods': 'GET, POST' } });
    sent.push([new URL(r.request().url()).pathname, JSON.parse(r.request().postData() || '{}').endpoint]);
    return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  });
  await open(page, '#/about/alerts');
  const on = page.locator('#notify [data-push="on"]'), off = page.locator('#notify [data-push="off"]');
  await expect(off).toHaveAttribute('aria-pressed', 'true');
  await on.click();
  await expect(on).toHaveAttribute('aria-pressed', 'true');
  await off.click();
  await expect(off).toHaveAttribute('aria-pressed', 'true');
  expect(sent).toEqual([['/push', 'https://fcm.googleapis.com/fcm/send/smoke'], ['/push/off', 'https://fcm.googleapis.com/fcm/send/smoke']]);
});

test('a detour\'s dots tapped: a notice\'s card, its words a tap away; Back puts it away', async ({ page }, info) => {
  // Staged, the notices made up: a route's stop closed by a notice (its stretch dotted), tapped where it's drawn, found by a
  // spot's marker put there first (the map's own sum, not the test's), the markers let through to the map for it.
  let alerts = [];
  await page.route(/^https:\/\/live\.cacherider\.com\/alerts/, r => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ fetched: new Date().toISOString(), alerts }) }));
  await page.route(/\/data\/alerts\.json/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ fetched: new Date().toISOString(), alerts }) }));
  await open(page, '#/map');
  // A stop in the middle of a route, the next a long block on: the point halfway along the line between them is on the
  // dots, no stop near it to take the tap and no other route's line near it to vouch for the road (closedSegments).
  const pick = await page.evaluate(async () => {
    const d = await import('/app/data.js'), D = d.D, j = await (await fetch('/data/cvtd-shapes.json')).json();
    const m = (p, q) => d.distance(p[1], p[0], q[1], q[0]), keyOf = ri => D.routes[ri].short.split(' ')[0];
    const lineKey = l => l.key !== undefined ? l.key : D.routes[l.route] && keyOf(l.route);
    const offLine = (p, c) => { let best = Infinity; for (let k = 0; k + 1 < c.length; k += 1) { const a = c[k], b = c[k + 1], kx = 111320 * Math.cos(p[1] * Math.PI / 180), ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * 110540, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * 110540, vx = bx - ax, vy = by - ay, n = vx * vx + vy * vy, t = n ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / n)) : 0; best = Math.min(best, Math.hypot(ax + t * vx, ay + t * vy)); } return best; };
    const clear = (p, own) => D.stops.every(s => d.distance(p[1], p[0], s.lat, s.lon) > 200) && j.lines.every(l => lineKey(l) === own || offLine(p, l.coords) > 100);
    for (const [ri, r] of D.routes.entries()) {
      if (/\s/.test(r.short) || (D.hub.loops || []).includes(ri)) continue;
      const own = keyOf(ri), mine = j.lines.filter(l => lineKey(l) === own);
      for (const seq of Object.values(r.stops || {})) for (let k = 1; k + 1 < seq.length; k++) {
        const [a, b, c] = [seq[k - 1], seq[k], seq[k + 1]].map(si => D.stops[si]);
        if (a.hub || b.hub || c.hub || d.distance(b.lat, b.lon, c.lat, c.lon) < 450 || d.distance(a.lat, a.lon, b.lat, b.lon) < 200) continue;
        for (const l of mine) {
          const near = s => l.coords.map((p, i) => ({ i, d: m(p, [s.lon, s.lat]) })).filter(x => x.d < 30).map(x => x.i);
          const ib = near(b), ic = near(c), pair = ib.flatMap(x => ic.filter(y => y > x).map(y => [x, y])).sort((p, q) => (p[1] - p[0]) - (q[1] - q[0]))[0];
          if (!pair) continue;
          const run = l.coords.slice(pair[0], pair[1] + 1), lens = run.slice(1).map((p, i) => m(run[i], p)), half = lens.reduce((x, y) => x + y, 0) / 2;
          let at = run[0];
          for (let i = 0, gone = 0; i < lens.length; gone += lens[i++]) if (gone + lens[i] >= half) { const t = (half - gone) / lens[i]; at = [run[i][0] + (run[i + 1][0] - run[i][0]) * t, run[i][1] + (run[i + 1][1] - run[i][1]) * t]; break; }
          if (!clear(at, own)) continue;
          // the way round: from stop a to stop c, out 250 m to one side of the line between them, and back
          const kx = 111320 * Math.cos(a.lat * Math.PI / 180), ex = (c.lon - a.lon) * kx, ey = (c.lat - a.lat) * 110540, el = Math.hypot(ex, ey);
          for (const side of [1, -1]) {
            const off = f => [a.lon + (c.lon - a.lon) * f - side * ey / el * 250 / kx, a.lat + (c.lat - a.lat) * f + side * ex / el * 250 / 110540];
            const P = off(0.2), Q = off(0.8), tap = [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2];
            if (!clear(tap, null) || offLine([b.lon, b.lat], [[a.lon, a.lat], P, Q, [c.lon, c.lat]]) < 120) continue;
            return { short: r.short, own, name: r.long, stop: { id: b.id, name: b.name }, at: { lat: at[1], lon: at[0] }, tap: { lat: tap[1], lon: tap[0] }, way: [[a.lat, a.lon], [P[1], P[0]], [Q[1], Q[0]], [c.lat, c.lon]] };
          }
        }
      }
    }
    return null;
  });
  test.skip(!pick, 'no stop with a long clear block after it');
  const tapAt = async (lat, lon) => {
    await go(page, '#/map');
    await page.waitForTimeout(600);
    await go(page, `#/map/at/${lat.toFixed(5)},${lon.toFixed(5)}/Here`);
    const box = await still(page.locator('.spot-marker'));
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  const now = Math.floor(Date.now() / 1000);
  // The notice's dots: its card, the route as a row to its page, the notice's title, its words unfolded, its stop.
  alerts = [{ id: 'a990001', title: `Route ${pick.own} Detour: smoke test`, text: `Due to construction, the stop at ${pick.stop.name} is closed. Please use the stops either side.`, url: '', start: now - 3600, end: now + 7 * 86400, routeIds: [], routes: [pick.short], stops: [pick.stop.id] }];
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await mapReady(page);
  await page.addStyleTag({ content: '.maplibregl-marker { pointer-events: none !important; }' });   // a bus going by, or the spot's own pin, not in the way
  await tapAt(pick.at.lat, pick.at.lon);
  await expect(page).toHaveURL(/#\/map\/alert\/a990001\?tap=1$/);
  const card = page.locator('#mapcard.open');
  if (phone(info)) await expect(card).toHaveClass(/\bpeek\b/);   // low, as a road's card: the dots tapped still in view
  await expect(card.locator('.eyebrow')).toHaveText(/Detour/i);
  await expect(card.locator(`a.roadroute[href="#/map/route/${encodeURIComponent(pick.short)}"]`)).toBeVisible();
  await expect(card.locator('summary')).toContainText('smoke test');
  await expect(card.getByText('Please use the stops either side')).toBeHidden();
  await card.locator('summary').click();
  await expect(card.getByText('Please use the stops either side')).toBeVisible();
  await expect(card.locator('p', { hasText: 'Closed:' }).locator(`a[href="#/stop/${pick.stop.id}"]`)).toBeVisible();   // a notice closes its stops
  await page.goBack();
  await expect(page).toHaveURL(/#\/map$/);
  await expect(page.locator('#mapcard')).not.toHaveClass(/\bopen\b/);
});

// A picked bus's way on (its strand), staged on the relay: `relay.alerts()` Connect's notices,
// `relay.feed` the buses, `relay.T` its clock.
async function stageRelay(page, relay) {
  const json = body => ({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  await page.route(/^https:\/\/live\.cacherider\.com\/alerts/, r => r.fulfill(json({ alerts: relay.alerts() })));
  await page.route(/\/data\/alerts\.json/, r => r.fulfill(json({ alerts: relay.alerts() })));
  await page.route(/^https:\/\/live\.cacherider\.com\/early/, r => r.fulfill(json({ t: relay.T, early: relay.early || [] })));
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => relay.feed ? r.fulfill(json(relay.feed)) : r.abort());
}
const stopClosure = (relay, id, routes, stops) => ({ id, title: 'Stop Closure', text: 'Due to construction the stop is closed.', url: '', cause: '', effect: '', start: relay.T - 86400, end: relay.T + 2 * 86400, routeIds: [], routes, stops, global: false });
const CLOSURE = 'a990200';
/** A notice in force from yesterday to the day after tomorrow closing a stop to every route of it (CLOSURE), staged on
 *  the relay and its file, and the app opened: the stop's id. In once the app's opened again. */
async function stageClosure(page) {
  let shut = null;
  const relay = { T: Math.floor(Date.now() / 1000), feed: null, alerts: () => shut ? [shut] : [] };
  await stageRelay(page, relay);
  await open(page);
  const [id, routes] = await page.evaluate(async () => {
    const d = await import('/app/data.js'), s = d.D.stops.find(s => !s.hub && s.routes.length && !s.out);
    return [s.id, s.routes.map(ri => d.D.routes[ri].short)];
  });
  shut = stopClosure(relay, CLOSURE, routes, [id]);
  return id;
}
/** A trip today of a route calling at the stops in a row: where the first is in it, its stops' minutes, when it's 40 s
 *  short of the first, and a spot a block short of it, heading there. Null when none runs today. */
const tripThrough = (page, short, ids) => page.evaluate(async ([short, ids]) => {
  const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), R = d.D.routeByShort[short], si = d.D.stopById[ids[0]];
  if (R === undefined || si === undefined) return null;
  for (const row of d.timesOn(si, c.ymd).filter(x => x.r === R)) {
    const st = d.tripStops(row.trip), te = d.tripEnd(row.trip), k = st.findIndex(x => x[1] === si && x[0] === row.min);
    if (k < 1 || !te || ids.some((id, i) => !st[k + i] || d.D.stops[st[k + i][1]].id !== id)) continue;
    const a = d.D.stops[st[k - 1][1]], s = d.D.stops[si];
    return { id: d.D.trips[row.trip], k, min: row.min, pts: [...st, [te.min, te.si]].map(([m, x]) => [m, d.D.stops[x].id]), at: Date.now() + ((row.min - c.min) * 60 - 40 - c.sec) * 1000,
      short: [a.lat + (s.lat - a.lat) * 0.75, a.lon + (s.lon - a.lon) * 0.75, d.bearing(a.lat, a.lon, s.lat, s.lon)] };
  }
  return null;
}, [short, ids]);
/** Bus 9001 on the trip at a spot [lat, lon, heading], its next stop by the feed the trip's K-th, the stops after a
 *  minute or so apart; the app opened again with it and its card up on the map. */
async function busOnTrip(page, relay, p, K, [lat, lon, bearing]) {
  await page.clock.setFixedTime(new Date(p.at));
  relay.T = Math.floor(p.at / 1000);
  const T = relay.T, base = T + 40 - p.min * 60;
  relay.feed = { t: T, now: T, buses: [{ id: '9001', label: '9001', trip: p.id, lat, lon, bearing, speed: 8, ts: T }],
    trips: { [p.id]: { v: '9001', ts: T, s: p.pts.slice(K).map(([m, sid], i) => [sid, K + i, base + m * 60 + 60, 0]) } } };
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await go(page, '#/map');
  await mapReady(page);
  await expect.poll(() => page.evaluate(async () => !!(await import('/app/rt.js')).findBus('c:9001')), { timeout: 20_000 }).toBe(true);
  await go(page, '#/map/bus/c:9001?tap=1');
}
/** The picked bus's strand as the map drew it, [lon, lat] each, and its fade. */
const strandDrawn = page => page.evaluate(() => {
  const m = window.__map, s = m && m.getSource('runs'), f = s && (s.serialize().data.features || []).find(f => f.properties.strand === 0);
  return f ? { line: f.geometry.coordinates, ramp: m.getPaintProperty('runs', 'line-gradient') } : null;
});
const KXY = [Math.cos(41.74 * Math.PI / 180) * 111320, 110540];   // degrees to metres in the valley, as the map's
/** Metres from a point [lat, lon] to a line of [lon, lat]. */
function offLine(line, [lat, lon]) {
  const [KX, KY] = KXY;
  return Math.min(...line.slice(1).map(([bx, by], k) => {
    const [ax, ay] = line[k], vx = (bx - ax) * KX, vy = (by - ay) * KY, px = (lon - ax) * KX, py = (lat - ay) * KY, L2 = vx * vx + vy * vy;
    const t = L2 ? Math.max(0, Math.min(1, (px * vx + py * vy) / L2)) : 0;
    return Math.hypot(px - t * vx, py - t * vy);
  }));
}
const stopAt = (page, id) => page.evaluate(id => import('/app/data.js').then(m => { const s = m.D.stops[m.D.stopById[id]]; return [s.lat, s.lon]; }), id);

test('a picked bus\'s way on through a stop closed with no way round known: left to the dots', PHONE, async ({ page }) => {
  // Route 11's 760 South Gateway Drive closed by a notice alone, where only the 11 runs, and no way round seen: its
  // line dotted there (from the corner after 358 North Gateway Dr), and its bus's strand clear along the dots.
  const GW358 = '7565913', GW760 = '7565914', E690 = '7565915';
  const relay = { T: Math.floor(Date.now() / 1000), feed: null };
  relay.alerts = () => [stopClosure(relay, 'a990105', ['11'], [GW760])];
  await stageRelay(page, relay);
  await open(page);
  const p11 = await onBusDay(page, () => tripThrough(page, '11', [GW358, GW760, E690]));
  test.skip(!p11, 'no Route 11 trip this week by 358 North, 760 South Gateway Drive and 690 South 100 East in a row');
  await busOnTrip(page, relay, p11, p11.k, p11.short);
  const gw760 = await stopAt(page, GW760), [KX, KY] = KXY;
  const clear = async () => {
    const s = await strandDrawn(page);
    if (!s) return null;
    const r = s.ramp.slice(3), z = r.findIndex((x, i) => i % 2 && /,0\)$/.test(x));   // [share, colour, …]: the first clear
    if (z < 0) return 'none clear';
    const L = [0];
    for (let k = 1; k < s.line.length; k++) L.push(L[k - 1] + Math.hypot((s.line[k][0] - s.line[k - 1][0]) * KX, (s.line[k][1] - s.line[k - 1][1]) * KY));
    const d = (r[z - 1] + r[z + 1]) / 2 * L[L.length - 1], k = Math.max(1, L.findIndex(x => x >= d)), t = (d - L[k - 1]) / (L[k] - L[k - 1] || 1);   // halfway along the clear stretch
    const [ax, ay] = s.line[k - 1], [bx, by] = s.line[k];
    return Math.hypot((ax + (bx - ax) * t - gw760[1]) * KX, (ay + (by - ay) * t - gw760[0]) * KY) < 200;
  };
  await expect.poll(clear, { timeout: 20_000 }).toBe(true);
});

test('the Center\'s All day on a wide screen: the panel shows every bus, PRT beside the 16s, a day with no buses a line not a button', WIDE, async ({ page }) => {
  // The user: 'make the all day board for transit center wide enough on desktop to see the whole thing', 'prt on the
  // all day board isn't next to the 16s and it should be', and of the day buttons: 'a day with no service doesn't have
  // to be clickable'. Noon on the Monday of Thanksgiving week: Thanksgiving inside the next two weeks, the feed refused.
  const { thanksgiving: tg } = await holidays(page);
  await page.route(/^https:\/\/live\.cacherider\.com\//, r => r.abort());
  await page.clock.setFixedTime(new Date(`${dayOn(tg, -3)}T12:00:00-07:00`));
  await open(page, '#/hub?day=1');
  const strip = page.locator('.daystrip').filter({ visible: true });
  await expect(strip).toHaveCount(1);
  // Wide enough for every column, the box not scrolling sideways (1280 px: 23 buses fit with room for the map).
  const box = strip.locator('.ds-box');
  expect(await box.evaluate(b => b.scrollWidth - b.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.locator('#side').evaluate(e => e.offsetWidth)).toBeGreaterThan(420);
  // PRT's column straight after the last 16's.
  const heads = await strip.locator('.ds-head').evaluateAll(hs => hs.map(h => h.textContent.trim()));
  const prt = heads.findIndex(h => h.includes('PRT'));
  if (prt >= 0) expect(heads[prt - 1]).toContain('16');
  // The 16 calls at the Center twice a run (out to Preston and back through it): a bar at each, not only where the run
  // starts or ends there (the user: '16 is missing its second bar for its second visit to the ITC').
  const via = await page.evaluate(async () => { const s = await import('/app/views/strip.js'), t = await import('/app/time.js');
    return s.busesOn(t.now().ymd).filter(b => b.keys.includes('16')).map(b => b.runs.reduce((n, x) => n + (x.via || []).length, 0)); });
  if (via.length) {
    expect(Math.min(...via)).toBeGreaterThan(0);
    const cols = strip.locator('.ds-body svg > g');
    for (const [i, h] of heads.entries()) if (h === '16') expect(await cols.nth(i).locator('.ds-bar').count()).toBeGreaterThanOrEqual(4);
  }
  // Thanksgiving: not a button, a line under them.
  await expect(page.locator('.ds-days a', { hasText: 'Thanksgiving' })).toHaveCount(0);
  await expect(page.locator('.ds-offdays').filter({ visible: true })).toContainText('No buses Thanksgiving Day');
  // The Board view: the panel back to its own width.
  await go(page, '#/hub');
  await expect.poll(() => page.locator('#side').evaluate(e => e.offsetWidth)).toBe(420);
});

test('a holiday: no buses on Thanksgiving, said by its name; the evening before, the next bus is the next day with buses; that day runs', PHONE, async ({ page }) => {
  // Connect's feed has no holidays (tools/hints.json does). The next Thanksgiving, the fourth Thursday of November. The
  // day after is the feed's to give or take off (the feed of 2026-11-19 took the Friday off): the next day with buses
  // is worked out from the timetable, and a day taken off unnamed is said by its date, not 'on Fridays'.
  // On the day itself Thanksgiving's card says when they're back (holiday.js), where 'Service resumes …' was.
  const { thanksgiving: tg } = await holidays(page);
  const at = (k, hm) => new Date(`${dayOn(tg, k)}T${hm}:00-07:00`);
  await page.route(/^https:\/\/live\.cacherider\.com\//, r => r.abort());
  await page.clock.setFixedTime(at(0, '12:00'));
  await open(page, '#/stop/7543017');   // Island Market: Route 3, every weekday
  const plan = await page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now();
    let k = 1;
    while (k < 10 && !d.agencyRuns(t.dayFrom(c.ymd, k).ymd)) k++;
    const off = [];
    for (let j = 1; j < k; j++) { const y = t.dayFrom(c.ymd, j).ymd; if (!d.holidayOn(y)) off.push({ k: j, words: d.offDayWords(y), date: t.fmtDay(y) }); }
    return { k, day: t.dayName(t.dayFrom(c.ymd, k).ymd), off };
  });
  expect(plan.k).toBeLessThan(10);
  await expect(page.getByText('Connect doesn\'t run on Thanksgiving Day.').filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('.holcard-back span').filter({ visible: true }).first()).toHaveText(new RegExp('^Back ' + plan.day + ' · first bus'));
  await go(page, '#/hub');
  const t = await backTimes(page);
  if (t.hubRuns) await hubOthers(page);
  else {
    await expect(page.getByText(new RegExp('^(Tomorrow · )?' + plan.day, 'i')).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('The rest of today')).toHaveCount(0);
  }
  // Its day at the Center: the holiday picked, a case of its own beside a weekday and a Saturday, no buses said by name.
  await go(page, '#/hub?day=1');
  await expect(page.locator('.ds-days a[aria-current="page"]').filter({ visible: true })).toHaveText('Thanksgiving Day');
  await expect(page.locator('.ds-days a', { hasText: 'Weekday' }).filter({ visible: true })).toHaveCount(1);
  await expect(page.getByText('Connect doesn\'t run on Thanksgiving Day.').filter({ visible: true }).first()).toBeVisible();
  if (!t.hubRuns) await expect(page.locator('.daystrip').filter({ visible: true })).toHaveCount(0);
  await go(page, '#/hub');
  for (const o of plan.off) expect(o.words).toBe(`Connect doesn't run on ${o.date}.`);   // never 'on Fridays'
  await page.clock.setFixedTime(at(-1, '21:30'));
  await go(page, '#/stop/7543017');
  await expect(page.getByText(new RegExp('The next one is ' + plan.day + ' at')).filter({ visible: true }).first()).toBeVisible();
  await page.clock.setFixedTime(at(plan.k, '12:00'));
  await open(page, '#/stop/7543017');
  await expect(page.getByText('No buses today')).toHaveCount(0);
  await go(page, '#/hub');
  await expect(page.getByText(/The rest of today/i).filter({ visible: true }).first()).toBeVisible();
});

test('the ask to test the Android app: in an Android phone\'s browser, a line atop home to its three steps, put away for good; elsewhere never', async ({ page }, info) => {
  // Not put away yet on this phone (the other tests' pages have it put away).
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('cr-shut-once')) { sessionStorage.setItem('cr-shut-once', '1'); localStorage.removeItem('cr-test-shut'); } } catch { /* storage refused */ } });
  await open(page);
  const line = page.locator('.testline');
  if (!phone(info)) { await expect(line).toHaveCount(0); return; }   // the desktop project's browser isn't Android
  await expect(line).toBeVisible();
  await line.locator('a').click();
  await expect(page).toHaveURL(/#\/test$/);
  await expect(page.getByRole('link', { name: 'Join the group' })).toHaveAttribute('href', 'https://groups.google.com/g/cacherider-testers');
  await expect(page.getByRole('link', { name: 'Become a tester' })).toHaveAttribute('href', 'https://play.google.com/apps/testing/com.cacherider.android');
  await expect(page.getByRole('link', { name: 'Open on Google Play' })).toHaveAttribute('href', /id=com\.cacherider\.android/);
  await go(page, '#/');
  await page.locator('.testline [data-act=test-shut]').click();
  await expect(line).toHaveCount(0);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await expect(page.locator('.land')).toBeVisible();
  await expect(line).toHaveCount(0);
});

test('settings and about: the clock to 24-hour and the distances to kilometres, every time and distance on screen with them, and back', PHONE, async ({ page }) => {
  // It clicked a button and clicked it again, the one already pressed, and checked nothing. Now each is turned, and a
  // page of times (a stop's, Island Market's) and one of distances (the walk beside a way, the Aztec Building to the
  // Institute) say it the new way; then back.
  await open(page, '#/about');
  await expect(page.getByText(/Send feedback/)).toBeVisible();
  const set = async sel => { await go(page, '#/about'); const b = page.locator(sel); await b.click(); await expect(b).toHaveAttribute('aria-pressed', 'true'); };
  // (read till it says so: a stop's next buses are put in once its page is up)
  const said = (hash, sel) => async () => { await go(page, hash); const el = page.locator(sel).filter({ visible: true }).first(); await expect(el).toBeVisible(); return el.innerText(); };
  const times = said('#/stop/7543017', '.stop-page'), walk = said('#/go/@41.74335,-111.81510:Institute/at/41.75484,-111.81505/Aztec', 'a.walkall');
  const ampm = /\d:\d\d\s*(AM|PM)\b/, h24 = /\b([01]\d|2[0-3]):[0-5]\d\b/, miles = / · [\d.,]+ (ft|mi)\b/, km = / · [\d.,]+ (m|km)\b/;
  await expect.poll(times).toMatch(ampm);   // as it opens, in this browser: 12-hour, miles
  await expect.poll(walk).toMatch(miles);
  await set('button[data-clock="24"]');
  await expect.poll(async () => { const x = await times(); return h24.test(x) && !ampm.test(x); }).toBe(true);
  await set('button[data-units="km"]');
  await expect.poll(walk).toMatch(km);
  await set('button[data-clock="12"]');
  await set('button[data-units="mi"]');
  await expect.poll(times).toMatch(ampm);
  await expect.poll(walk).toMatch(miles);
});
