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
  // A place on campus by 'USU' and a word: the Institute of Religion by campus (a church in the map's data).
  await go(page, '#/search?q=' + encodeURIComponent('USU Institute'));
  await expect(page.getByText(/Institute of Religion/).filter({ visible: true }).first()).toBeVisible();
  // Its stops by the walk there and back, the climb counted: up on the bench, not the Scotsman's at the hill's foot
  // (nearer on the flat map; first while the elevation grid was drawn over the wrong ground).
  await expect(page.locator('a.stoprow[href^="#/stop/"] .name').filter({ visible: true }).first()).not.toHaveText(/590 North 600 East/);
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
});

test('one clock rule: due from its minute\'s start, gone from the next', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const t = await import('/app/time.js'), c = { min: 600, sec: 59, ymd: '20261007' };
    return [t.isDue({ min: 600 }, c), t.isDue({ min: 601 }, c), t.isGone({ min: 599 }, c), t.isGone({ min: 600 }, c), t.isGone({ min: 605, gone: true }, c),
      t.relative({ min: 600, day: 0 }, c), t.relative({ min: 601, day: 0 }, c), t.minsTo({ min: 10, day: 1 }, c)];
  });
  expect(r).toEqual([true, false, true, false, true, 'now', 'in 1 min', 850]);
});

test('the map\'s lines: faded behind the last buses, every one in colour ten minutes after the night\'s last call', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), m = await import('/app/views/map.js'), u = await import('/app/usu.js');
    const c = t.now(), ends = d.D.routes.map((_, ri) => d.lastTripOn(ri, c.ymd)).filter(Boolean).map(l => l.end[0]);
    if (!ends.length) return null;   // no buses today: nothing to fade
    // the shuttle's last loop and POOL's end too, on a day they run (their listed hours): one reset for the whole map
    const svc = u.U && u.U.service, runs = svc && svc.days[(t.dayFrom(c.ymd).dow + 6) % 7], pool = d.POOL && d.POOL.week && d.POOL.week[(t.dayFrom(c.ymd).dow + 6) % 7];
    const E = Math.max(...ends, ...(runs ? [svc.end, ...Object.values(svc.late || {})] : []), ...(pool ? [pool[1]] : []));
    const at = min => m.doneToday({ ymd: c.ymd, min, sec: 0 }), during = at(E - 20), after = at(Math.min(1439, E + 30));
    return { during: [during.stretches.length, during.stops.size], after: [after.stretches.length, after.stops.size, after.loops.size, after.pool] };
  });
  if (r) { expect(r.during[0]).toBeGreaterThan(0); expect(r.during[1]).toBeGreaterThan(0); expect(r.after).toEqual([0, 0, 0, false]); }
});

test('search: where people live, an apartment complex and a dorm by name', async ({ page }) => {
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

test('the Center: a bus back in at the end of its trip isn\'t its departure still leaving', async ({ page }) => {
  // A fresh start at 8:51: a route's 8:30 bus back at the Center finishing its trip read as the 8:30 leaving now, 21 min
  // late, until it took up its next trip. Made up from the timetable: a run whose next is an hour on or more (21 min down
  // isn't held for it: rt.js holdOf), the clock 21 minutes after it.
  await open(page);
  const pick = await page.evaluate(async () => {
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
  });
  test.skip(!pick, 'no hourly run from the Center today');
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

test('the Center: a departure still listed past its minute, its bus on its trip before, by where the bus is', async ({ page }) => {
  // 3:06 PM, every 3:00 'leaving now, 6 min late': the feed still listed the Center on each 3:00 and had its bus on the
  // trip before, out on its run. Made up from the timetable: a route's half-hourly departure, the clock 6 minutes on.
  await open(page);
  const pick = await page.evaluate(async () => {
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
  });
  test.skip(!pick, 'no half-hourly run from the Center today');
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

test('the Center\'s compass: north up and south up, one to the other', async ({ page }) => {
  await open(page, '#/hub');
  await mapReady(page);
  const btn = page.locator('.northbtn').filter({ visible: true }).first();
  await expect(btn).toBeVisible();
  const said = [];
  for (let i = 0; i < 3; i++) { await btn.click(); await page.waitForTimeout(900); said.push(await btn.getAttribute('aria-label')); }
  // from whichever it opened on, it goes to the other and back: never east or west
  expect(said.every(x => /^(North up|South up)/.test(x))).toBe(true);
  expect(said[0]).not.toBe(said[1]);
  expect(said[0]).toBe(said[2]);
});

test('a spot picked on the map for where you are: from the home page, and kept after a reload', async ({ page }) => {
  // A desk with no location: the spot was dropped on the next visit (no permission, so the kept place 'wasn't where they
  // are'), and picking it was only in the sheet that asks for location.
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
  await page.waitForTimeout(3000);   // past the location check on opening
  await expect(page.getByText('Near the spot you picked').filter({ visible: true }).first()).toBeVisible();
});

test('the panel on the right, set in Settings: the map\'s buttons across from it', async ({ page }, info) => {
  test.skip(phone(info), 'a wide screen\'s panel');
  await open(page, '#/about');
  await page.locator('button[data-side="right"]').click();
  await expect(page.locator('button[data-side="right"]')).toHaveAttribute('aria-pressed', 'true');
  await go(page, '#/');
  await mapReady(page);
  const vw = page.viewportSize().width;
  const side = await page.locator('#side').boundingBox();
  expect(Math.round(side.x + side.width)).toBe(vw);   // flush right
  const ctrl = await page.locator('#map .maplibregl-ctrl-top-right').boundingBox();
  expect(ctrl.x).toBeLessThan(100);   // the buttons on the left, clear of it
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.panel === 'right');   // kept, set before the page draws
  await open(page, '#/about');
  await page.locator('button[data-side="left"]').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.panel || 'left')).toBe('left');
});

test('the Center: a bus two-thirds of a run down is held for its next run, which leaves on time', async ({ page }) => {
  // Route 8's 2:00, its bus in at 2:27: 'leaving any second', when it went out on the 2:30 (2026-10-09). Made up from
  // the timetable: a route's half-hourly departure from the Center, the clock set to 22 minutes after it.
  await open(page);
  const pick = await page.evaluate(async () => {
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
  });
  test.skip(!pick, 'no half-hourly run from the Center today');
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

test('a closed stop tapped on a phone: its closure in the card as it opens, not a swipe up away', async ({ page }, info) => {
  test.skip(!phone(info), 'a phone\'s card over the map');
  await open(page);
  const id = await page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js');
    await d.loadAlerts({ relay: false });
    const c = t.now(), i = d.D.stops.findIndex((s, i) => d.closedThrough(i, c.ymd) !== null);
    return i < 0 ? null : d.D.stops[i].id;
  });
  test.skip(!id, 'no stop closed by a notice today');
  await go(page, '#/map/' + id);
  const lead = page.locator('#mapcard .callout.alert b').first();
  await expect(lead).toBeVisible();
  await page.waitForTimeout(1200);   // the card's opening slide
  // what's at the headline's middle is the headline: in the card as it opens, above the tabs
  const hit = await lead.evaluate(b => { const r = b.getBoundingClientRect(), el = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 12)); return !!el && (b === el || b.contains(el)); });
  expect(hit).toBe(true);
});

test('a stop\'s card on a phone, as the Center\'s board: rests at its next bus, folds to its head, and goes', async ({ page }, info) => {
  test.skip(!phone(info), 'a phone\'s card over the map');
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
  await swipe(await grip(), (await grip()) + 150);
  await expect(card).toHaveClass(/hubfold/);
  await swipe(await grip(), (await grip()) + 150);   // folded, down again: put away
  await expect(card).not.toHaveClass(/\bopen\b/);
  await expect(page).toHaveURL(/#\/map$/);
});

test('a route\'s card on a phone, as the board: rests at its first stops, folds to its head, and goes; a POOL pickup\'s swipe up goes nowhere', async ({ page }, info) => {
  test.skip(!phone(info), 'a phone\'s card over the map');
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

test('a steep walk down is steep too: the bluff from 400 North down to Crocket Avenue', async ({ page }) => {
  // From the Center to the closed Crocket Avenue stop the Green Loop and a climb down the bluff came first, not called
  // steep (only up was), and Route 3 to Riverside Drive, flat, second or third (2026-10-09).
  await open(page);
  const r = await page.evaluate(async () => {
    const d = await import('/app/data.js'), g = await import('/app/geo.js');
    await g.loadElevation();
    const off = d.D.stops.find(s => s.name === '651 East 400 North'), crocket = { lat: 41.73621, lon: -111.81286 };
    if (!off) return null;
    const s = g.slope(off.lat, off.lon, crocket.lat, crocket.lon), flat = Math.ceil(d.distance(off.lat, off.lon, crocket.lat, crocket.lon) / g.PACE);
    return { down: Math.round(s.down), steep: g.isSteep(s), mins: g.walkMins(off.lat, off.lon, crocket.lat, crocket.lon), flat };
  });
  test.skip(!r, 'no stop at 651 East 400 North');
  expect(r.down).toBeGreaterThanOrEqual(8);
  expect(r.steep).toBe(true);
  expect(r.mins).toBeGreaterThan(r.flat);   // slower going down it than on the flat
});

test('walks along the ways: the real path, and over a busy road only at its light', async ({ page }) => {
  // data/walknet.json (tools/walknet.py): a walk found along the footways, paths, steps, sidewalks and streets, not as
  // the crow flies; US 91 crossed only at a light or a marked crossing, as walks.json has them, unless crosswalks are off.
  await open(page);
  const r = await page.evaluate(async () => {
    const d = await import('/app/data.js'), g = await import('/app/geo.js');
    if (!await g.loadWalkNet()) return null;
    const s651 = d.D.stops.find(x => x.name === '651 East 400 North'), crocket = { lat: 41.73621, lon: -111.81286 };
    const down = g.walkWay(s651.lat, s651.lon, crocket.lat, crocket.lon);
    const over = g.walkWay(41.78315, -111.83096, 41.78406, -111.83789), straight = g.crossingsOff(() => g.walkWay(41.78315, -111.83096, 41.78406, -111.83789));
    return {
      path: down.coords.length, longer: down.d > d.distance(s651.lat, s651.lon, crocket.lat, crocket.lon) * 1.2, steep: g.steepWalk(s651, crocket),
      light: over.via.some(v => !v.none), overD: over.d, straightD: straight.d, straightNone: straight.via.some(v => v.none),
    };
  });
  test.skip(!r, 'no walking network');
  expect(r.path).toBeGreaterThan(4);   // a path, not a line
  expect(r.longer).toBe(true);         // round by the trail, not straight down the bluff
  expect(r.steep).toBe(true);
  expect(r.light).toBe(true);          // over US 91 at a light
  expect(r.overD).toBeGreaterThan(r.straightD + 300);
  expect(r.straightNone).toBe(true);   // crosswalks off: straight over, said so
});

test('a stop every route of it skips by notice says Closed in its row, not the first bus after', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const d = await import('/app/data.js'), ui = await import('/app/ui.js'), t = await import('/app/time.js');
    await d.loadAlerts({ relay: false });
    const c = t.now(), shut = d.D.stops.map((s, i) => i).filter(i => d.closedThrough(i, c.ymd) !== null);
    // and one made so, whatever today's notices: every route of a stop named by a notice in force through Saturday next
    return { live: shut.map(i => ui.stopRow(i, d.nextAt(i, 1, c)[0], c).s.includes('Closed')), any: shut.length };
  });
  expect(r.live.every(Boolean)).toBe(true);   // each one closed today says so (none closed: nothing to say)
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
  await expect(page.getByText(/stops, in order|stops left/i).filter({ visible: true }).first()).toBeVisible();
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
  // The way to put the map right: OpenStreetMap's editor at the spot, and 'Improve this map' in the credits.
  await expect(page.getByRole('link', { name: 'Fix it on OpenStreetMap' }).filter({ visible: true }).first()).toHaveAttribute('href', /openstreetmap\.org\/edit#map=19\/41\.73790\/-111\.83457/);
  await expect(page.locator('a[href="https://www.openstreetmap.org/fixthemap"]')).toHaveCount(1);
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

test('directions up: a tap on the map changes nothing, a long press or right click asks which end', async ({ page }) => {
  await open(page);
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
  await page.waitForTimeout(7000);   // a feed tick or two: on a phone the directions' redraw took the card back
  await expect(start).toBeVisible();
  await expect(page.locator('#mapcard a', { hasText: 'Go here instead' })).toHaveAttribute('href', /^#\/go\/@[-\d.,]+.*\/at\/41\.75484,-111\.81505\/Aztec$/);
  await start.click();
  await expect(page).toHaveURL(/#\/go\/@41\.74335,-111\.81510:Institute\/at\/[-\d.]+,[-\d.]+\//);
});

test('directions from where you are: a right click asks which end, the destination kept', async ({ page }) => {
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
  await page.mouse.click(left + 30, (top + bottom) / 2, { button: 'right' });
  await expect(page.locator('#mapcard.open .eyebrow', { hasText: 'Change directions' })).toBeVisible();
  await expect(page.locator('#mapcard a', { hasText: 'Go here instead' })).toHaveAttribute('href', /^#\/go\/@[-\d.,]+:[^/]*$/);   // from where you are still
  await page.locator('#mapcard a', { hasText: 'Start from here' }).click();
  await expect(page).toHaveURL(/#\/go\/@41\.75484,-111\.81505:Aztec\/at\/[-\d.]+,[-\d.]+\//);
});

test('directions: a walk over a busy road goes by its crossing, said', async ({ page }) => {
  // The Transit Center to the Rush FunPlex: off Route 5 on the east side of US 91 (Main Street, 4 lanes, 50 mph),
  // the FunPlex on the west. The walk goes over at the lights, and says so; the map's walk bends there too.
  await open(page);
  await go(page, '#/go/@41.78406,-111.83789:Rush%20FunPlex/at/41.74061,-111.83124/Transit%20Center');
  await expect(page.locator('.sub.cross').filter({ visible: true }).first()).toContainText(/Cross .*Main Street.* at the (light|crosswalk)/);
  await expect(page.getByText(/(crow flies, but|sidewalks, paths and streets,) over a busy road/).filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('a.walkall')).toHaveCount(0);   // three miles: not a walk worth offering beside the bus
  // Straight over US 91 it's the stop across from the Eccles Ice Center instead, the same bus, sooner: said, and the
  // Crosswalks chip there to take it. (Only while Route 5 runs: no way, or tomorrow's on another route, nothing to compare.)
  if (await page.locator('.jsum').filter({ visible: true }).count() && !(await page.getByText(/nothing more today/).filter({ visible: true }).count())) {
    await expect(page.locator('.straightalt').filter({ visible: true }).first()).toContainText(/Straight across Main Street \(no crosswalk\).*min (sooner|later)/);
    await expect(page.locator('.chip[data-xing]').filter({ visible: true }).first()).toBeVisible();
  }
  // From the Wolf Pack Way stop itself: the light 480 m out of the way, so both said, and the Crosswalks chip turns it.
  await go(page, '#/go/@41.78406,-111.83789:Rush%20FunPlex/at/41.78315,-111.83096/Wolf%20Pack');
  const chip = page.locator('.chip[data-xing]').filter({ visible: true }).first();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sub.cross').filter({ visible: true }).first()).toContainText(/or straight across, \d+ min less/);
  await chip.click();
  await expect(page.locator('.sub.cross').filter({ visible: true }).first()).toContainText(/Straight across Main Street.*or at the light/);
  await page.locator('.chip[data-xing]').filter({ visible: true }).first().click();
  await expect(page.locator('.chip[data-xing]').filter({ visible: true }).first()).toHaveAttribute('aria-pressed', 'true');
});

test('directions, no stop a walk off: the nearest starts in view, one picked, and it stays put', async ({ page }, info) => {
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
  // No stop a walk off: the nearest stops a bus there leaves from, one picked giving the way from it.
  const start = card.locator('.farstarts a.row').first();
  if (await start.count()) {
    const href = await start.getAttribute('href');
    await start.click();
    await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
    await expect(page.getByText(/leaves|Leave/).filter({ visible: true }).first()).toBeVisible();
  }
});

test('directions, no stop a walk off the place: the nearest a bus gets you, one picked', async ({ page }) => {
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

test('directions arriving by a time: the shuttle the way picked, when it is the best', async ({ page }) => {
  // The Aztec Building's chapel to the Institute of Religion, by 7 PM on a weekday to come: the Evening Express (to
  // 10 PM), its longest wait counted, leaves later than any bus that makes it; the Stadium Express (to 5 PM) no way.
  await open(page);
  const d = new Date(); do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6);
  const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  await go(page, '#/go/@41.74335,-111.81510:Institute/at/41.75484,-111.81505/Aztec?t=a' + ymd + '-1900');
  const picked = page.locator('.jsum').filter({ visible: true }).first();
  await expect(picked).toContainText('Evening');
  await expect(picked).toContainText(/Leave by/);   // no timetable: a leave-by and a latest, not times it's due
  await expect(picked).toContainText(/at the latest/);
  await expect(page.getByText(/Be at the stop by/).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/A bus at least every \d+ min/).filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('.jrow').filter({ hasText: 'Stadium' })).toHaveCount(0);
  await expect(page.locator('.sa-row')).toHaveCount(0);   // said as the way, not beside it
  // Walking the whole way beside it: how long, how far, up the bench to campus.
  await expect(page.locator('a.walkall').filter({ visible: true }).first()).toContainText(/\d+ min · .* (ft|m) up/);
  await expect(page.locator('a.walkall b.hill').filter({ visible: true }).first()).toHaveText(/steep/i);   // the word first, not the feet alone
});

test('directions arriving by a time on a later day: that day said, no bus missed', async ({ page }) => {
  // Richmond to Utah Podiatry, by 8 AM on a weekday to come: the 15 at 6:40 was 'Today' and 'Missed it? The next 15
  // leaves at 8:10' (gone by the time picked, 8:00, not by the clock), as if the 15 ran hourly.
  await open(page);
  const d = new Date(); d.setDate(d.getDate() + 2); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  await go(page, '#/go/@41.73632,-111.83415:Utah%20Podiatry/at/41.92243,-111.80832/Richmond?t=a' + ymd + '-0800');
  const picked = page.locator('.jsum').filter({ visible: true }).first();
  await expect(picked).toBeVisible();
  await expect(picked.locator('.eyebrow')).toHaveText(new RegExp(d.toLocaleDateString('en-US', { weekday: 'long' }), 'i'));
  await expect(page.locator('.tl .missed')).toHaveCount(0);
});

test('directions: avoid steep walks, on and off, and in Settings', async ({ page }) => {
  // West of campus up to the Institute: the quickest way walks up the bench. Avoiding steep: a way without (or, with
  // none, the ways there are, said so); the chip kept as the rider's choice, Settings showing it.
  await open(page);
  await go(page, '#/go/@41.74335,-111.81510:Institute/at/41.74245,-111.83000/West%20of%20campus');
  // The quickest way walks up the bench at most hours (which way is quickest is the hour's): where it does, the chip.
  await expect(page.locator('.jsum').filter({ visible: true }).first()).toBeVisible();
  const chip = page.locator('.chip[data-steep]').filter({ visible: true }).first();
  const steepNow = await page.locator('.tl b.hill.steep').filter({ visible: true }).count() > 0;
  if (steepNow) {
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await chip.click();
    await expect(page.locator('.chip[data-steep]').filter({ visible: true }).first()).toHaveAttribute('aria-pressed', 'true');
    await expect(async () => {
      const steep = await page.locator('.tl b.hill.steep').filter({ visible: true }).count();
      const said = await page.getByText('Every way here has a steep walk').filter({ visible: true }).count();
      expect(steep === 0 || said > 0).toBe(true);
    }).toPass();
  }
  await go(page, '#/about');
  if (!steepNow) await page.locator('[data-steep="avoid"]').filter({ visible: true }).first().click();   // nothing steep this hour: chosen in Settings instead
  await expect(page.locator('[data-steep="avoid"]').filter({ visible: true }).first()).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-steep="allow"]').filter({ visible: true }).first().click();
  await expect(page.locator('[data-steep="allow"]').filter({ visible: true }).first()).toHaveAttribute('aria-pressed', 'true');
  // A place's stops: the shuttle's among them, marked as the shuttle's; one up the hill said STEEP.
  await go(page, '#/search?q=' + encodeURIComponent('USU Institute'));
  await expect(page.locator('a.stoprow[href^="#/usu/"]').filter({ visible: true }).first()).toContainText('Aggie Shuttle');
  await expect(page.locator('a.stoprow b.hill.steep').filter({ visible: true }).first()).toBeVisible();
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
