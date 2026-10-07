// Every flow in the app, one test a flow, at a phone's size and a desktop's (playwright.config.js). Each checks that
// its screens come up and that nothing on the way said 'Something went wrong' or threw. The data is the real feed's,
// whatever the hour, so a check that needs a bus out (a bus's card) is skipped when none is.
// Run: npm test (here), or tools/hooks/pre-push before every push. On this machine only, never on GitHub.
const { test: base, expect } = require('@playwright/test');

// Errors a page raised, and console errors that aren't a network miss (the relay or a tile now and then).
const test = base.extend({
  page: async ({ page }, use) => {
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_|status of [45]\d\d/.test(m.text())) errs.push('console: ' + m.text()); });
    page.errs = errs;
    await use(page);
    expect(errs, 'errors on the page').toEqual([]);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  },
});

const phone = info => info.project.name === 'phone';
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
  await page.waitForTimeout(800);
}
/** A Connect bus on the map, once the live feed has placed one (up to 15 s); null when none is out. */
async function someBus(page) {
  const bus = page.locator('.maplibregl-marker.bus:not(.shuttle)').first();
  try { await bus.waitFor({ state: 'attached', timeout: 15_000 }); return bus; } catch { return null; }
}
/** A real stop's id, from the home page's rows. */
async function someStop(page) {
  await go(page, '#/');
  const a = page.locator('a[href^="#/stop/"]').filter({ visible: true }).first();
  await expect(a).toBeVisible();
  return (await a.getAttribute('href')).replace('#/stop/', '').split('?')[0];
}

test('home: the Center line, the shuttle line, the routes', async ({ page }, info) => {
  await open(page);
  await expect(page.locator('a[href="#/hub"]').filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('a[href="#/map/usu"]')).toBeVisible();
  if (phone(info)) await expect(page.locator('a[href="#/routes"]')).toBeVisible();
  else await expect(page.locator('a[href^="#/map/route/"]').filter({ visible: true }).first()).toBeVisible();   // wide: the chips
  await expect(page.getByRole('link', { name: /Settings & about/ })).toBeVisible();
});

test('home: a detour at one of your stops, at the top', async ({ page }) => {
  await open(page);
  // A stop a notice in force names today, saved: whichever the agency has up (none, and there's nothing to show).
  const id = await page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js');
    const a = d.activeAlerts(t.now().ymd).find(a => (a.stops || []).some(id => d.D.stopById[id] !== undefined));
    const id = a && a.stops.find(id => d.D.stopById[id] !== undefined);
    if (id) localStorage.setItem('cr-saved', JSON.stringify([id]));
    return id || null;
  });
  test.skip(!id, 'no notice in force names a stop');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  const row = page.locator('.mine-row').filter({ visible: true }).first();
  await expect(row).toContainText('one of your stops');
  await row.click();
  await expect(page).toHaveURL(new RegExp('#/stop/' + id));
});

test('a stop out of the timetable: its page, saved, at the top of home', async ({ page }) => {
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

test('home: the Routes line opens every route', async ({ page }, info) => {
  test.skip(!phone(info), 'a phone\'s line; a wide screen has the chips');
  await open(page);
  await page.locator('a[href="#/routes"]').filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/#\/routes$/);
  await expect(page.locator('a.row[href^="#/map/route/"]').filter({ visible: true }).first()).toBeVisible();
});

/** A click on the map where nothing is: zoomed out to the valley (the routes drawn small, in town), then the fields at
 *  the edge of the map that shows: clear of a wide screen's panel, the search bar, and a phone's card over the map's
 *  foot (a click there was on the card). */
async function clickNothing(page) {
  const map = await page.locator('#map').boundingBox(), side = await page.locator('#side').boundingBox();
  const open = page.locator('#mapcard.open'), card = (await open.count()) ? await open.boundingBox() : null;
  const left = side && side.width < map.width * 0.6 && side.x <= map.x + 1 ? side.x + side.width : map.x;   // beside the panel
  const top = map.y + 80, bottom = card && card.width > map.width * 0.6 ? card.y - 10 : map.y + map.height - 60;
  const mid = (top + bottom) / 2;
  for (let i = 0; i < 6; i++) { await page.mouse.move((left + map.x + map.width) / 2, mid); await page.mouse.wheel(0, 600); await page.waitForTimeout(150); }
  await page.waitForTimeout(900);
  await page.mouse.click(left + 30, mid);
  await page.waitForTimeout(900);
}

test('bus click-off: back where the rider was', async ({ page }, info) => {
  if (phone(info)) {
    // The Map tab: a bus's card, and a click off it puts the card away, the Map tab still up.
    await open(page, '#/map');
    await mapReady(page);
    const bus = await someBus(page);
    test.skip(!bus, 'no Connect bus out');
    await bus.evaluate(el => el.click());
    await expect(page.getByText(/^Bus \d+/).filter({ visible: true }).first()).toBeVisible();
    await clickNothing(page);
    await expect(page).toHaveURL(/#\/map$/);
    await expect(page.getByText(/^Bus \d+/).filter({ visible: true })).toHaveCount(0);
    return;
  }
  // Beside a wide screen's panel: from a stop's page, a bus opens its route there; a click off it goes back to the stop.
  await open(page);
  const id = await someStop(page);
  await go(page, '#/stop/' + id);
  await mapReady(page);
  const bus = await someBus(page);
  test.skip(!bus, 'no Connect bus out');
  await bus.evaluate(el => el.click());
  await expect(page).toHaveURL(/#\/map\/route\/.+\?bus=/);
  await clickNothing(page);
  await expect(page).toHaveURL(new RegExp('#/stop/' + id + '$'));
});

test('search: a route, every route, a street, a place, an address', async ({ page }) => {
  await open(page);
  await go(page, '#/search?q=12');
  await expect(page.locator('a[href="#/map/route/12"]').filter({ visible: true }).first()).toBeVisible();
  await go(page, '#/search?q=routes');
  await expect(page.locator('a[href^="#/map/route/"]')).not.toHaveCount(0);
  await go(page, '#/search?q=Main%20St');
  await expect(page.locator('a[href^="#/stop/"]').filter({ visible: true }).first()).toBeVisible();
  await go(page, '#/search?q=USU');
  await expect(page.locator('#side a').filter({ visible: true }).first()).toBeVisible();
  await go(page, '#/search?q=' + encodeURIComponent('500 North 100 East'));
  await expect(page.getByText(/Show on map/).filter({ visible: true }).first()).toBeVisible();
});

test('routes list: every route, one opened', async ({ page }) => {
  await open(page, '#/routes');
  await expect(page.locator('a.row[href^="#/map/route/"]')).not.toHaveCount(0);
  await expect(page.locator('a.row[href^="#/usu/route/"]').filter({ visible: true }).first()).toBeVisible();
  await page.locator('a.row[href="#/map/route/5"]').click();
  await expect(page).toHaveURL(/#\/map\/route\/5/);
  await expect(page.getByText('Route 5').filter({ visible: true }).first()).toBeVisible();
});

test('route: both ways, its sibling, a stop on it', async ({ page }) => {
  await open(page, '#/map/route/2');
  await mapReady(page);
  await expect(page.getByText(/stops, in order/i).filter({ visible: true }).first()).toBeVisible();
  const ways = page.locator('a[href^="#/map/route/2/"]');
  if (await ways.count()) { await ways.last().click(); await expect(page).toHaveURL(/#\/map\/route\/2\//); }
  await go(page, '#/map/route/16%20PM');
  await expect(page.getByText(/Also Route 16 AM/).filter({ visible: true }).first()).toBeVisible();
  await page.locator('a[href^="#/stop/"]').filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/#\/stop\//);
});

test('stop: its page, a route badge, a run, the whole day, saved and unsaved', async ({ page }) => {
  await open(page);
  const id = await someStop(page);
  await go(page, '#/stop/' + id);
  await expect(page.getByRole('link', { name: 'How to get here' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'From here' })).toBeVisible();
  const time = page.locator('button.hr-dep').filter({ visible: true }).first();
  if (await time.count()) { await time.click(); await expect(page).toHaveURL(/\?run=/); await go(page, '#/stop/' + id); }
  const day = page.getByRole('link', { name: 'The whole day' });
  if (await day.count()) { await day.click(); await expect(page.getByText(/departures/).filter({ visible: true }).first()).toBeVisible(); await go(page, '#/stop/' + id); }
  await page.locator('a.badgelink').filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/#\/map\/route\//);
});

test('map: town view, a bus and its route', async ({ page }) => {
  await open(page, '#/map');
  await mapReady(page);
  const bus = await someBus(page);
  test.skip(!bus, 'no Connect bus out');
  await bus.evaluate(el => el.click());
  await expect(page.getByText(/^Bus \d+/).filter({ visible: true }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Open route' }).filter({ visible: true }).first().evaluate(a => a.click());
  await expect(page).toHaveURL(/#\/map\/route\/.+\?bus=/);
});

test('map: a spot and its card, a road and its routes, a right click', async ({ page }) => {
  // On Main Street downtown: several routes, and stops either side.
  await open(page, '#/map/at/41.73790,-111.83457/Main%20St');
  await mapReady(page);
  await expect(page.getByRole('link', { name: 'Directions to here' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'From here' })).toBeVisible();
  // A tap on the road just beside its marker (Main runs north and south): the road's card, its routes as rows.
  const box = await page.locator('.spot-marker').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + 12);
  const row = page.locator('#mapcard .roadroute').filter({ visible: true }).first();
  if (await row.count()) { await row.click(); await expect(page).toHaveURL(/#\/map\/route\//); }
  await go(page, '#/map');
  await mapReady(page);
  const map = await page.locator('#map').boundingBox();
  await page.mouse.click(map.x + map.width * 0.7, map.y + map.height * 0.3, { button: 'right' });
  await expect(page.getByRole('link', { name: 'Directions to here' })).toBeVisible();
});

test('Transit Center: the board, a route picked from the strip, the bays', async ({ page }, info) => {
  await open(page, '#/hub');
  await mapReady(page);
  await expect(page.getByText(/Next departure|No buses today|Next buses/i).filter({ visible: true }).first()).toBeVisible();
  const seg = page.locator('a.tc-seg').filter({ visible: true }).first();
  if (await seg.count()) {
    await seg.click();
    await expect(page).toHaveURL(/#\/hub\/.+/);
    await expect(page.locator('.tc-pick')).toBeVisible();
    await page.locator('.tc-pick a[aria-label="Close"]').click();
    await expect(page).toHaveURL(/#\/hub$/);
  }
  if (phone(info)) await expect(page.locator('.hbay').filter({ visible: true }).first()).toBeVisible();
});

test('Transit Center on a wide screen: the map left where it is, the bays on the tab again', async ({ page }, info) => {
  test.skip(phone(info), 'on a phone the Center is the map, flown to');
  // From the Stops page, its panel already beside the map: from the Map tab the panel comes in, and the map keeps the
  // place looked at in the middle of what's left, half the panel over, whichever page it is.
  await open(page, '#/');
  await mapReady(page);
  await someBus(page);   // markers on the map to measure it by, when buses are out
  // Where each bus marker sits on the screen: flown to the Center, every one would be hundreds of pixels off; a live
  // bus creeps a few. (No bus out: the bays not shown is the check.)
  const spots = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.maplibregl-marker.bus')].map(e => { const r = e.getBoundingClientRect(); return [e.title, [r.x, r.y]]; })));
  const moved = (a, b) => Math.max(0, ...Object.keys(a).filter(k => b[k]).map(k => Math.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1])));
  const before = await spots();
  await page.locator('#topnav a[href="#/hub"]').click();
  await expect(page.getByText(/Next departure|No buses today|Next buses/i).filter({ visible: true }).first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect(moved(before, await spots()), 'pixels the map moved').toBeLessThan(60);
  await expect(page.locator('.hbay')).toHaveCount(0);
  // The tab again: the ask to see the bays, framed then.
  await page.locator('#topnav a[href="#/hub"]').click();
  await expect(page.locator('.hbay').filter({ visible: true }).first()).toBeVisible();
  // Left for the Map tab: back where the map was, the bays gone.
  await page.locator('#topnav a[href="#/map"]').click();
  await expect(page.locator('.hbay')).toHaveCount(0);
});

test('directions: each way in, a plan, no way, from only', async ({ page }) => {
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

test('directions, no bus goes there: the answer in view, and it stays put', async ({ page }, info) => {
  test.skip(!phone(info), 'a phone\'s card over the map');
  // From far out of the valley's routes: no way by bus.
  await open(page, '#/go/@41.74321,-111.81488:Logan/at/41.90000,-112.00000/Far%20away');
  const card = page.locator('#mapcard');
  const answer = card.locator('.gonone .empty h2');
  await expect(answer).toBeVisible();
  const inCard = async () => { const a = await answer.boundingBox(), c = await card.boundingBox(); return a && c && a.y >= c.y && a.y + a.height <= c.y + c.height + 1; };
  expect(await inCard(), 'the answer inside the card as it opens').toBe(true);
  // Opened out, the feed's ticks leave it so (each shut it to its head: 66 px).
  await card.evaluate(c => c.classList.remove('peek'));
  const h = (await card.boundingBox()).height;
  await page.waitForTimeout(12_000);
  expect(Math.round((await card.boundingBox()).height), 'the card\'s height after the feed\'s ticks').toBe(Math.round(h));
});

test('directions: the planner over random trips throws on none', async ({ page }, info) => {
  test.skip(phone(info), 'the planner is the same at any size');
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

test('Aggie Shuttle: campus, a loop, a stop on it', async ({ page }) => {
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

test('alerts and detours: the list, one on the map', async ({ page }) => {
  await open(page, '#/about/alerts');
  await expect(page.getByText(/Nothing from|alert|detour|Detour/).filter({ visible: true }).first()).toBeVisible();
  const onMap = page.locator('a[href^="#/map/alert/"]').filter({ visible: true }).first();
  if (await onMap.count()) { await onMap.click(); await expect(page).toHaveURL(/#\/map\/alert\//); await mapReady(page); }
});

test('settings and about: the clock and units turned and back', async ({ page }) => {
  await open(page, '#/about');
  await expect(page.getByText(/Send feedback/)).toBeVisible();
  for (const name of [/12|24/, /miles|km/i]) {
    const b = page.getByRole('button', { name }).filter({ visible: true }).first();
    if (await b.count()) { await b.click(); await b.click(); }
  }
});
