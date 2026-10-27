// Every flow in the app, one test a flow, at a phone's size and a desktop's (playwright.config.js). Each checks that
// its screens come up and that nothing on the way said 'Something went wrong' or threw. The data is the real feed's,
// whatever the hour, so a check that needs a bus out (a bus's card) is skipped when none is.
// Run: npm test (here), or tools/hooks/pre-push before every push. On this machine only, never on GitHub.
const { test: base, expect } = require('@playwright/test');

// Errors a page raised, and console errors that aren't a network miss (the relay or a tile now and then).
const test = base.extend({
  page: async ({ page }, use) => {
    // The ask to test the Android app atop home (an Android phone's browser, as the phone project's is) put away, so the
    // other tests' pages are as they were; its own test brings it back.
    await page.addInitScript(() => { try { localStorage.setItem('cr-test-shut', '1'); } catch { /* storage refused */ } });
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

test('a stop\'s row for a loop\'s next lap says where its bus is now, still on the lap before, and how many stops away', async ({ page }) => {
  // The user, at 995 South Main: 'my issue is also knowing which blue loop will get there at that time. so if the blue
  // is sitting at ITC, or if it's driving by north walmart'. Staged: a loop's lap today and the lap after it in the same
  // run, the clock a minute before the lap's third call, its bus between its second and third stops; a stop five calls
  // into the next lap.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  await open(page);
  const pick = await page.evaluate(async () => {
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
  });
  test.skip(!pick, 'no loop running two laps in a row today');
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

test('a route\'s page never says to stay on a bus that goes out of service for hours, as 16 AM\'s last run before 16 PM', async ({ page }) => {
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

test('home: the big stop\'s bus on its way as a line, here at its stop, gone with the feed; the Save hint till a stop is saved', async ({ page }) => {
  // The relay's answer made up, as the timetable has a trip run: the clock half a minute into the minute before its
  // second call, its bus between its first two stops, and the rider at its fifth. Its line: the bus, its next stop, the
  // two between folded, the rider's at the foot. Then the bus at its next stop (that ring filled, a stop fewer), the
  // route's page saying the same, and the feed without it: no line.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  await open(page);
  await expect(page.locator('.land-hint').filter({ visible: true })).toContainText('Tap Save on a stop\'s page to keep it here');   // a first visit, nothing saved
  const pick = await page.evaluate(async () => {
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
  });
  test.skip(!pick, 'no trip today to make the feed of');
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

test('home: trips saved on the directions page, under the big stop: the one from the end you\'re at whole, the rest a row each; tomorrow\'s after the last bus; three at most; one saved before kept', async ({ page }) => {
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
async function clickNothing(page, how = 'click') {
  const map = await page.locator('#map').boundingBox(), side = await page.locator('#side').boundingBox();
  const open = page.locator('#mapcard.open'), card = (await open.count()) ? await open.boundingBox() : null;
  const left = side && side.width < map.width * 0.6 && side.x <= map.x + 1 ? side.x + side.width : map.x;   // beside the panel
  const top = map.y + 80, bottom = card && card.width > map.width * 0.6 ? card.y - 10 : map.y + map.height - 60;
  const mid = (top + bottom) / 2;
  for (let i = 0; i < 6; i++) { await page.mouse.move((left + map.x + map.width) / 2, mid); await page.mouse.wheel(0, 600); await page.waitForTimeout(150); }
  await page.waitForTimeout(900);
  if (how === 'dblclick') await page.mouse.dblclick(left + 30, mid);   // a mouse's double click, the map's zoom in
  else if (how === 'right') await page.mouse.click((left + map.x + map.width) / 2, mid, { button: 'right' });   // a long press's spot, mid-map
  else await page.mouse.click(left + 30, mid);
  await page.waitForTimeout(900);
}
/** Where the tab is in its history, and whether a step was taken through it since this was first asked. */
async function stepAt(page) {
  return page.evaluate(() => {
    if (window.__pops === undefined) { window.__pops = 0; addEventListener('popstate', () => window.__pops++); }
    return { at: navigation.currentEntry.index, pops: window.__pops, forward: navigation.canGoForward };
  });
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
  const was = await stepAt(page);
  await clickNothing(page);
  await expect(page).toHaveURL(new RegExp('#/stop/' + id + '$'));
  expect(await stepAt(page)).toEqual(was);   // in place, not a step Back
});

test('a stop put down, then a bus clicked and clicked off: the stop stays down', async ({ page }, info) => {
  // The user: 'i clicked on a stop, clicked on the map to deselect. clicked on a bus, clicked on the map again and the
  // stop highlighted'. Beside a wide screen's panel a click off a stop puts its dot down, its page staying; a bus's
  // route, clicked off, goes back to that page, and the dot came back lit.
  test.skip(phone(info), 'a phone\'s click off a stop puts its page away too');
  await page.addInitScript(() => import('/vendor/maplibre-gl.mjs').then(m => { const g = m.Map.prototype.getSource; m.Map.prototype.getSource = function (id) { window.__map = this; return g.call(this, id); }; }));
  await open(page);
  const id = await someStop(page);
  await go(page, '#/stop/' + id);
  await mapReady(page);
  const lit = () => page.evaluate(() => JSON.stringify(window.__map.getFilter('stop-selected')));
  await expect.poll(lit).toContain(id);
  await clickNothing(page);
  await expect(page).toHaveURL(new RegExp('#/stop/' + id + '$'));
  await expect.poll(lit).not.toContain(id);
  const bus = await someBus(page);
  test.skip(!bus, 'no Connect bus out');
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
    await page.waitForTimeout(600);
    await go(page, h);
    await expect(page.locator('#mapcard.open, #side .routepage').filter({ visible: true }).first()).toBeVisible();
    await page.waitForTimeout(900);
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

test('a bus gone quiet: grey after three minutes without a report, off the map after ten', async ({ page }) => {
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

test('a stop by its number, as Connect writes it (0115) or as its feed has it (115): found either way, said with its zero', async ({ page }) => {
  await open(page);
  for (const q of ['0115', '115', 'stop 0115']) {
    await go(page, '#/search?q=' + encodeURIComponent(q));
    await expect(page.locator('a[href="#/stop/7569115"]').filter({ visible: true }).first(), q).toBeVisible();
  }
  await go(page, '#/stop/7569115');   // 1011 East 700 North, Richard's Hall
  await expect(page.getByText(/Stop 0115/).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/Stop 115\b/)).toHaveCount(0);
});

test('search: a bus by its number, its card on the map, Back; an address with the number in it still the address', async ({ page }, info) => {
  // '1168 N Main' is an address, whatever bus 1168 is doing: its heading first, no bus.
  await open(page, '#/search?q=' + encodeURIComponent('1168 N Main'));
  await expect(page.locator('#side .section').filter({ visible: true }).first()).toContainText(/1168 North Main/i);
  await expect(page.locator('#side a.busfound')).toHaveCount(0);
  // A bus out now, by the number painted on it, from the live feed (its first word a few seconds off).
  let label = null;
  for (let i = 0; i < 30 && label === null; i++) {
    label = await page.evaluate(async () => { const { rt } = await import('/app/rt.js'); return rt.at ? (rt.buses.find(b => /^\d{4}$/.test(b.label)) || {}).label || '' : null; });
    if (label === null) await page.waitForTimeout(500);
  }
  test.skip(!label, 'no Connect bus out');
  // On a phone the map's own box; on a wide screen the header's, its results in the panel. The bus first, above any
  // stop with the number in it.
  let first;
  if (phone(info)) {
    await go(page, '#/map');
    await mapReady(page);
    await page.locator('#mapsearch input').fill(label);
    first = page.locator('#mapresults a.row, #mapresults a.stoprow').first();
  } else {
    await go(page, '#/');
    await page.locator('#topsearch input').fill(label);
    first = page.locator('#side a.row, #side a.stoprow').first();
  }
  await expect(first).toHaveClass(/busfound/);
  await expect(first).toContainText('Bus ' + label);
  await first.click();
  await expect(page).toHaveURL(/#\/map\/bus\/.+\?find=1$/);
  await expect(page.locator('#mapcard.open .eyebrow').filter({ visible: true }).first()).toContainText('Bus ' + label);
  await page.goBack();
  await expect(page).toHaveURL(phone(info) ? /#\/map$/ : new RegExp('#/search\\?q=' + label + '$'));   // back to the map, or to the search
});

test('which of its route\'s buses a bus is: on its card (Bus 2 of 3 · B2), and found by it in the search (B2, Blue two, 12(1))', async ({ page }, info) => {
  // The relay's answer made up: a loop's second bus and a numbered route's first, each on a trip of its block today
  // with one after it (on duty, whatever the hour), and a bus on a trip the timetable doesn't know (no number).
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  await open(page, '#/');
  const p = await page.evaluate(async () => {
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
  });
  test.skip(!p.loop, 'no loop runs two buses today');
  const t = Math.floor(Date.now() / 1000), bus = (label, x, dlat = 0) => ({ id: label, label, trip: x.trip, lat: x.lat + dlat, lon: x.lon, bearing: 90, speed: 5, ts: t - 2 });
  const short = await page.evaluate(async () => (await import('/app/data.js')).D.routes.map(r => r.short).find(s => /^\d{1,2}$/.test(s)));
  feed = { t, trips: {}, buses: [bus('9101', p.loop), ...(p.num ? [bus('9102', p.num)] : []), bus('9103', { ...p.loop, trip: short + '_9999' }, 0.004)] };
  const loopLabel = `Bus 2 of ${p.loop.of} · ${p.loop.key}2`;
  // Its card: the vehicle's number above, which of its route's buses it is under the route's name.
  await go(page, '#/map');
  await mapReady(page);
  await go(page, '#/map/bus/c%3A9101');
  const card = page.locator('#mapcard.open').filter({ visible: true });
  await expect(card.locator('.eyebrow').first()).toContainText('Bus 9101');
  await expect(card.locator('.who .nth')).toHaveText(loopLabel);
  if (p.num) { await go(page, '#/map/bus/c%3A9102'); await expect(card.locator('.who .nth')).toHaveText(`Bus 1 of ${p.num.of} · ${p.num.key}(1)`); }
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
  await box.fill(p.loop.key + '2');
  await expect(first).toHaveClass(/busfound/);
  await first.click();
  await expect(page).toHaveURL(/#\/map\/bus\/c%3A9101\?find=1$/);
  await expect(card.locator('.who .nth')).toHaveText(loopLabel);
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

test('the Center: a group NOW in its minute; gone by with one late route still in, the next group\'s; most of it still in, up and counting how late', async ({ page }) => {
  // 8:03 AM, 16 Oct: Route 12's bus in late for the 8:00, the other nine gone at 8:00 and out on their runs. The board
  // stayed at 8:00, 0:00, every other bay's bus 20 min out (coming in for the 8:30), until 12 pulled out at 8:06; and a
  // group's clock sat at 0:00 for minutes. Made up from the timetable: a group with a group 30 min after it, the clock
  // half a minute past it, then 4 min 40, the relay's answer faked.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  await open(page);
  const pick = await page.evaluate(async () => {
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
  });
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
  await page.waitForTimeout(6000);   // a poll with it
  await page.clock.setFixedTime(new Date(pick.at + 250_000));
  feed = await feedOf(1);
  const lateRow = page.locator('.tcl-row').filter({ visible: true }).filter({ has: page.locator('.tcl-late', { hasText: 'Late · due ' + late.now }) });
  await expect(lateRow).toHaveCount(1, { timeout: 20_000 });
  await expect(lateRow.locator('.tcl-st')).toHaveText('Here');
  await expect(page.locator('.tcl-grp').filter({ visible: true }).filter({ has: lateRow }).locator('.tcl-grp-h b small')).toHaveText('about');
  await expect(grp(late.now)).toHaveCount(0);   // the group's minute gone by: none left at it
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

test('the panel on the right: a stop, directions and a route each framed in the map left of it, their pages in it', async ({ page }, info) => {
  // The user: 'we need a smoke test for those with right panel preferences set on'. The map frames what's picked in the
  // room the panel leaves (map.js room, the panel the map's padding): on the right, that room is left of it.
  test.skip(phone(info), 'a wide screen\'s panel');
  await page.addInitScript(() => {
    try { localStorage.setItem('cr-panel', 'right'); } catch { /* none */ }
    import('/vendor/maplibre-gl.mjs').then(m => { const g = m.Map.prototype.getSource; m.Map.prototype.getSource = function (id) { window.__map = this; return g.call(this, id); }; });
  });
  await open(page);
  await page.waitForFunction(() => document.documentElement.dataset.panel === 'right');
  await mapReady(page);
  const side = await page.locator('#side').boundingBox();
  expect(Math.round(side.x + side.width)).toBe(page.viewportSize().width);
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

test('an empty trip feed beside the buses: the last word stands for a minute and a half, then the buses\' places', async ({ page }) => {
  // 2:42:00 PM, 19 Oct: the agency's trip feed came back its header alone, 15 bytes, beside all 20 buses, and the relay
  // passed it on as no trips: for that poll some 600 rows went from Live to the timetable or to a guess from the bus's
  // place. A route's trip under way, its bus 5 min late at its third stop, the rider at its sixth; then the same bus
  // and no trips; then a minute and a half on, still none.
  const relay = { T: 0, feed: null, alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const pick = await page.evaluate(async src => {
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
  }, stopsOf.toString());
  test.skip(!pick, 'no trip today to make the feed of');
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

test('the Center: a late bus\'s next run leaves when its bus is in, at the stops past it too, whatever the feed has for the run', async ({ page }) => {
  // 19 Oct: the feed's word on a bus's next run is the timetable's (Route 1's 3:00 at 3:00:00, its bus not yet in). The
  // bay waited for the bus; the stops past it didn't: a run 8 min late out of the Center was 'Live · On time' a minute
  // out and the timetable's further on, and past its minute gone a minute out. A route's run from the Center, its bus
  // on the run before due in 8 min after its minute (not held for the next: rt.js holdOf), the clock 2½ min past it.
  const relay = { T: 0, feed: null, alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const pick = await page.evaluate(async src => {
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
  }, stopsOf.toString());
  test.skip(!pick, 'no run from the Center today with its bus\'s run before it');
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

test('the Center: a bus\'s next run timed by the feed from the run before is Estimated, at its bay and past it', async ({ page }) => {
  // 3:36 PM, 20 Oct: Route 7's 4:00 'Live · 2 min late', its bus 4004 still out on its 3:30. Connect's feed times a bus's
  // next run from the run before (its bay at the minute that run gets in, every stop on as late): a minute carried on,
  // not word from a bus on it. A route's run from the Center, its bus out on the run before and due in 2 min after the
  // run's minute, the feed's word on the run that run's 2 min; the clock 10 min before the run.
  const relay = { T: 0, feed: null, alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const pick = await page.evaluate(async src => {
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
  }, stopsOf.toString());
  test.skip(!pick, 'no run from the Center today with its bus\'s run before it');
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
  const run = await centreRun(page, 150);
  test.skip(!run, 'no run from the Center today');
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

test('the Center back from the background: a bus that left while the app was away has left, not \'leaving now\'', async ({ page }) => {
  // 3:36 PM, 20 Oct, back in the app: the 3:30s of five routes 'Live · 6 min late', leaving now, their buses gone while
  // it was away (hidden, it asks the feed nothing). Each bay gone from the feed since its last word was taken to have
  // just gone, and said 'now' for a minute more (rt.js LEFT_GRACE). A route's run, its bus in its bay 2½ min past its
  // minute; the app put away; back 2½ min later, the bus gone from the bay and out on its way.
  const relay = { T: 0, feed: null, alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const run = await centreRun(page, 150);
  test.skip(!run, 'no run from the Center today');
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

test('a loop bus in early at the Center: the stops past it on the timetable from its minute, not the feed\'s long wait there', async ({ page }) => {
  // 19 Oct, every loop trip of the day: the feed had the Blue Loop 13 minutes from its Center stop to 750 North Main, 2
  // by the timetable, and the Green 8 to the stop after its own, 1, every stop on as late. Bus 1174, in at 2:38 for its
  // 2:41, was 'Live 2:54' at 750 North Main; it left at 2:41 and was there at 2:45. A loop's trip, its bus in at its
  // Center stop 3 min early, the feed's stops past it 11 min on from there, as the Blue Loop's were.
  const relay = { T: 0, feed: null, alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const pick = await page.evaluate(async src => {
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
  }, stopsOf.toString());
  test.skip(!pick, 'no loop trip today');
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

test('a loop\'s next run with no word on it from the feed: as late at the Center as its bus is into the run\'s start', async ({ page }) => {
  // 2:42 PM, 19 Oct: the feed lost a Green Loop bus's trip and the one after it for a minute, the bus a minute late; the
  // Center's 3:35 was said to leave at 3:14, when the bus was due at the run's start, 750 North Main, 22 minutes before
  // the Center. A loop's run into its next, its bus 4 min late near the end of the first, the feed with nothing on the next.
  const relay = { T: 0, feed: null, alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const pick = await page.evaluate(async src => {
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
  }, stopsOf.toString());
  test.skip(!pick, 'no loop trip today with one after it');
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

test('a timed stop on the way: a bus ahead waits there, and it and the stops after it are on time, not the feed\'s minutes early', async ({ page }) => {
  // 2:41 PM, 19 Oct (the user: 'look into the route 15 3 min early thing'): Route 15's bus out of Richmond 30 s early,
  // the feed running it on faster than the timetable, had Richard's Hall 'Live · 3 min early' for its 3:14, with five
  // timed stops between where it would wait. A route's trip (Route 15's where there's one), its bus 3 min early at the
  // stop before its first timed stop on the way, the feed 3 min early at every stop on.
  const relay = { T: 0, feed: null, alerts: () => [] };
  await stageRelay(page, relay);
  await open(page);
  const pick = await page.evaluate(async src => {
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
  }, stopsOf.toString());
  test.skip(!pick, 'no route\'s trip today with a timed stop on the way');
  const [mj, , lat, lon] = pick.pts[pick.k - 1], T = relay.T = Math.floor(pick.at / 1000), base = T - 30 - (mj - 3) * 60;   // the day's minute 0
  relay.feed = { t: T, now: T, buses: [{ id: '9001', label: '9001', trip: pick.id, lat, lon, bearing: 0, speed: 0, ts: T }], trips: {
    [pick.id]: { v: '9001', ts: T, s: pick.pts.map(([m, sid], i) => [sid, i, base + (m - 3) * 60, 0]).slice(pick.k) } } };
  await page.clock.setFixedTime(new Date(pick.at));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await polled(page, T);
  for (const [m, stop] of pick.pts.slice(pick.k, pick.k + 2)) expect(await rowSays(page, pick.id, stop, m)).toEqual(['Scheduled · on time', m]);
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
  await still(card.locator('.grip'));   // slid back up to its next bus (a third of a second): the swipe starts where it rests
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

test('directions from out of a walk of any stop, on a phone: swiped down, the card goes down to its head and stays, then leaves', async ({ page }, info) => {
  // From north of Franklin, Idaho, to the Transit Center: the card lists the stops to drive to. A swipe down hid it,
  // and the next redraw (the feed's tick, the minute) put it back up; there was no way to see the map under it.
  test.skip(!phone(info), 'a phone\'s card over the map');
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

test('a season\'s route goes with its season: the Pumpkin Walk off the map, the routes and search after its last night', async ({ page }) => {
  // Its nights staged as one, a week from now, whatever the feed's are: that evening it's on the routes list, in search,
  // on the map and has its tab; the next noon none of them, its two stops gone from the map and search too. And a
  // timetable run out (every one of Connect's calendars ended that night, the next not in) isn't every route's season
  // over: the next noon the routes are all still there.
  const day = new Date(Date.now() + 7 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Denver' }).replace(/-/g, '');
  let runOut = false, staged = false;
  await page.route(/\/data\/cvtd\.json/, async r => {
    const j = await (await r.fetch()).json(), ri = j.routes.findIndex(x => /^pumpkin/i.test(x.short));
    const n = {};   // its rows by calendar: the fullest one's are its night
    for (const per of Object.values(j.times)) for (const [sid, rows] of Object.entries(per)) n[sid] = (n[sid] || 0) + rows.filter(t => t[1] === ri).length;
    const from = Object.keys(n).sort((x, y) => n[y] - n[x])[0];
    staged = ri >= 0 && n[from] > 0;
    if (staged) {
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
  test.skip(!staged, 'no Pumpkin Walk in the timetable');
  const s = await page.evaluate(async day => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), ri = d.D.routes.findIndex(r => /^pumpkin/i.test(r.short));
    const ms = (ymd, h) => new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6), h).getTime();   // the agency's clock (the browser's zone)
    return { ri, href: '#/map/route/' + encodeURIComponent(d.D.routes[ri].short), stops: [...new Set(Object.values(d.D.routes[ri].stops).flat())].map(si => d.D.stops[si].id),
      evening: ms(day, 19), after: ms(t.dayFrom(day, 1).ymd, 12) };
  }, day);
  const hook = () => page.evaluate(async () => { const m = await import('/vendor/maplibre-gl.mjs'), g = m.Map.prototype.getSource; m.Map.prototype.getSource = function (id) { window.__map = this; return g.call(this, id); }; });
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
    await open(page, '#/routes');
    await expect(page.locator(`a.row[href="${s.href}"]`)).toHaveCount(on ? 1 : 0);
    await expect(page.locator('a.row[href="#/map/route/1"]')).toHaveCount(1);
    if (!out) await expect(tab).toHaveCount(on ? 1 : 0);   // (a run-out timetable's has no night to come: no tab)
    expect(await found() > 0).toBe(on);
    await hook();
    await go(page, '#/map');
    await mapReady(page);
    await expect.poll(drawn, { timeout: 20_000 }).toEqual(on ? [true, s.stops.length, true] : [false, 0, true]);
  }
});

test('a route drawn as a line: its key stops, a fold kept open through a redraw, every stop', async ({ page }) => {
  // The Blue Loop: its stops on a rail, the stops between its key stops folded. A fold opened stays open as the feed
  // redraws the sheet; 'Every stop' unfolds the lot, 'Key stops' folds them again.
  await open(page, '#/map/route/B');
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

test('another operator\'s route, kept by hand (the Preston commuter): at its stops, its page, the planner; never live', async ({ page }) => {
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

test('Route 16 is one route: one badge at 2281 N Main with PRT\'s, the last full run the road\'s, search "16"', async ({ page }) => {
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

test('route: both ways, its sibling, a stop on it', async ({ page }) => {
  await open(page, '#/map/route/2');
  await mapReady(page);
  await expect(page.getByText(/stops, in order|stops left/i).filter({ visible: true }).first()).toBeVisible();
  const ways = page.locator('a[href^="#/map/route/2/"]');
  if (await ways.count()) { await ways.last().click(); await expect(page).toHaveURL(/#\/map\/route\/2\//); }
  await go(page, '#/map/route/16%20PM');   // a half's own address, as old links have it: the page says which half, and links the other
  await expect(page.locator('.routehead .sub').filter({ visible: true }).first()).toContainText(/^Evening runs/);
  await expect(page.getByText(/Also its morning runs/).filter({ visible: true }).first()).toBeVisible();
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

test('stop: the whole day an hour to a column, the gone ones too; a loop\'s time opens its run, saying which of its buses', async ({ page }) => {
  // The user: 'i'd like to be able to see the previous times in the day. i think the rest of today maybe should be the
  // whole day all the time', and of a time tapped there: 'i'd like to be able to tell if its green 1,2, or 3'.
  await open(page);
  const pick = await page.evaluate(async () => {
    const d = await import('/app/data.js'), t = await import('/app/time.js'), c = t.now(), loops = d.D.hub.loops || [];
    for (const ri of loops) for (const [si, s] of d.D.stops.entries()) {
      if (s.hub) continue;
      const rows = d.timesOn(si, c.ymd).filter(x => x.r === ri);
      if (rows.length < 4 || !rows.some(x => d.busOf(x.trip, c.ymd))) continue;
      const all = d.timesOn(si, c.ymd).map(x => x.min);
      return { id: s.id, first: Math.floor(Math.min(...all) / 60), letter: d.D.routes[ri].short };
    }
    return null;
  });
  test.skip(!pick, 'no loop with numbered buses today');
  await go(page, '#/stop/' + pick.id);
  const day = page.locator('.ws-day').filter({ visible: true }).first();
  await expect(day.locator('.ws-eye span').first()).toHaveText(/^Today$/i);
  const h0 = await day.locator('.hr-h').first().textContent();
  const want = pick.first % 12 === 0 ? 12 : pick.first % 12;
  expect(h0.trim()).toMatch(new RegExp('^' + want + '\\s*(AM|PM)$', 'i'));   // from the day's first bus, not this hour
  await expect(page.getByRole('link', { name: 'The whole day' })).toHaveCount(0);
  await day.locator('button.hr-dep', { has: page.locator('.badge', { hasText: new RegExp('^' + pick.letter + '$') }) }).first().click();
  await expect(page).toHaveURL(/\?run=/);
  await expect(page.locator('#runsheet .rs-bus').filter({ visible: true })).toHaveText(new RegExp('^Bus \\d of \\d · ' + pick.letter + '\\d'));
});

test('stop: a run opens on the Transit Center it left and ends at the Transit Center it gets in to', async ({ page }) => {
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

test('map: a picked bus is where it is, its card from the stop it reaches next and its way on from it', async ({ page }) => {
  // Bus 4014 on the Blue Loop's 6:05 (2026-10-16): the feed had 55 North Main, the stop the loop's trips end at, first
  // in its list, with the end's time, and the two stops just behind the bus still there, its word lagging. Its card led
  // with 55 North Main, its way on drawn from far ahead. Made up from the timetable: a loop's trip, the bus halfway
  // between two stops and moving, the clock a minute before the second; then its word minutes stale; then the bus on
  // its last leg, the end's stop alone in its list, first and last.
  let feed = null;
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => feed ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed) }) : r.abort());
  await open(page);
  const pick = await page.evaluate(async () => {
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
  });
  test.skip(!pick, 'no loop trip today to make the feed of');
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
  await page.locator('#mapcard.open .roadroute').filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/#\/map\/route\//);
  await go(page, '#/map');
  await mapReady(page);
  const map = await page.locator('#map').boundingBox();
  await page.mouse.click(map.x + map.width * 0.7, map.y + map.height * 0.3, { button: 'right' });
  await expect(page.getByRole('link', { name: 'Directions to here' })).toBeVisible();
});

test('Back on a phone\'s map: a long press\'s card, a stop\'s sheet swiped away, the Map tab lit for a stop of the map', async ({ page }, info) => {
  // A friend on the map: a card opened with no entry of its own, so Back left the map (twice, and the app was gone);
  // a stop's sheet swiped away added the map again, so Back opened it again; a stop off the map lit Stops.
  test.skip(!phone(info), 'a phone\'s map and its Back');
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

test('Transit Center: directions there from its board, to any of its bays', async ({ page }) => {
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
  // on a phone the map opens wide on the Center, its label on it (the bays come in zoomed in)
  if (phone(info)) await expect(page.locator('.hubtag').filter({ visible: true })).toContainText('Transit Center');
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
  const run = await centreRun(page, 30);
  test.skip(!run, 'no run from the Center today');
  relay.feed = bayFeed(run, 0); relay.T = relay.feed.t;
  await page.clock.setFixedTime(new Date(run.at));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#tabs a, #topnav a'), null, { polling: 500 });
  await go(page, '#/hub');
  await polled(page, relay.T);
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

test('Transit Center: the rest of the day, a line a route with its last bus, a tap to its every time; after the last, the next day\'s', async ({ page }) => {
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

test('Transit Center on a wide screen: the map left where it is, the bays on the tab again', async ({ page }, info) => {
  test.skip(phone(info), 'on a phone the Center is the map, flown to');
  await page.addInitScript(() => import('/vendor/maplibre-gl.mjs').then(m => { const g = m.Map.prototype.getSource; m.Map.prototype.getSource = function (id) { window.__map = this; return g.call(this, id); }; }));
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
  // The tab again: the ask to see the Center, framed then, its label on it.
  await page.locator('#topnav a[href="#/hub"]').click();
  await expect(page.locator('.hubtag').filter({ visible: true })).toBeVisible();
  // Left for the Map tab: the label gone with the board.
  await page.locator('#topnav a[href="#/map"]').click();
  await expect(page.locator('.hubtag')).toHaveCount(0);
  expect(await faint()).toBe(asDrawn);
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

test('a tablet turned: the phone\'s card goes as the page comes in beside the map', async ({ page }, info) => {
  test.skip(phone(info), 'a window that crosses into the wide layout');
  // Upright (under 840 px) the directions are the map with the ways as its card; turned, the page beside the map. The
  // same address, so the card was put away only by the layout's change counting as a page arrived at.
  await page.setViewportSize({ width: 800, height: 1000 });
  await open(page, '#/go/@41.75484,-111.81505:Aztec/at/41.74061,-111.83124/Center');
  await expect(page.locator('#mapcard.open')).toBeVisible({ timeout: 20_000 });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#side')).toBeVisible();
  await expect(page.locator('#mapcard')).not.toHaveClass(/\bopen\b/);
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

test('directions with no way by bus, on a phone: a long press\'s card stays through the feed\'s ticks', async ({ page }, info) => {
  // From far out of the valley's routes, a long press (a right click) on the map: 'Change directions' over the 'no bus
  // goes there' card. The feed's next tick drew the directions' card back over it: the guard compared the address the
  // press was made at with the no-way card's own key ('none:' and where to), never the same.
  test.skip(!phone(info), 'a phone\'s one card');
  await open(page, '#/go/@41.74321,-111.81488:Logan/at/41.90000,-112.00000/Far%20away');
  await mapReady(page);
  const card = page.locator('#mapcard');
  await expect(card.locator('.gonone .empty h2')).toBeVisible();
  const map = await page.locator('#map').boundingBox(), c = await card.boundingBox();
  await page.mouse.click(map.x + 40, (map.y + 80 + c.y - 10) / 2, { button: 'right' });
  const asked = page.locator('#mapcard.open .eyebrow', { hasText: 'Change directions' });
  await expect(asked).toBeVisible();
  // A tick, as the feed's word makes one, then the feed's own: the card stays, the address as it was
  await page.evaluate(async () => (await import('/app/main.js')).render(true));
  await page.waitForTimeout(7000);
  await expect(asked).toBeVisible();
  await expect(card.locator('.gonone')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/go\/@41\.74321,-111\.81488:Logan\/at\/41\.90000,-112\.00000\/Far%20away$/);
  await page.locator('#mapcard a', { hasText: 'Start from here' }).click();
  await expect(page).toHaveURL(/#\/go\/@41\.74321,-111\.81488:Logan\/at\/[-\d.]+,[-\d.]+\//);
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

test('directions arriving by a time: the shuttle among the ways, said as the shuttle is', async ({ page }) => {
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

test('walks by the one rule, the same before and after the paths load; steep ground red on the directions map only', async ({ page }) => {
  // The user: 'map routing. we should do it the stupid way, lots of options, fast and stupid', and 'show where there are
  // steep areas somehow. a red overlay on land showing on particularly steep slopes that's only visible in routing view'.
  await page.addInitScript(() => import('/vendor/maplibre-gl.mjs').then(m => { const g = m.Map.prototype.getSource; m.Map.prototype.getSource = function (id) { window.__map = this; return g.call(this, id); }; }));
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

test('directions: a ride no quicker than walking, sparing little of it, isn\'t offered (Logan\'s court to the Center)', async ({ page }) => {
  // From the Municipal Court, just after the 9 and the 6 had gone at 6:18, the Green Loop came first: on at 355 North
  // Main, south round its loop and back up to Zions, 22 minutes with 11 on foot, where the walk is 10. The 9 and the 6
  // from across the road are the ways; walking beats the Green on every count.
  await open(page);
  const d = new Date(); d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  await go(page, '#/go/@41.74061,-111.83124:Transit%20Center/at/41.73999,-111.83690/Logan%20Municipal%20Court?t=' + ymd + '-0618');
  await expect(page.locator('.jsum').filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('.jrow .badge[title="Green Loop"]').filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('.jsum .badge').filter({ visible: true }).first()).toHaveText('9');
  await expect(page.locator('a.walkall').filter({ visible: true }).first()).toContainText('Quicker on foot');
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

test('a route\'s first run the other way, turned round from this way, doesn\'t start there (15 south from Richmond)', async ({ page }) => {
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
  if (await onMap.count()) { await onMap.click(); await expect(page).toHaveURL(/#\/map\/alert\//); await mapReady(page); await expect(page.locator('#mapcard.open .eyebrow')).toBeVisible(); }   // its card on the map
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
  await page.route(/^https:\/\/live\.cacherider\.com\/$/, r => relay.feed ? r.fulfill(json(relay.feed)) : r.abort());
}
const stopClosure = (relay, id, routes, stops) => ({ id, title: 'Stop Closure', text: 'Due to construction the stop is closed.', url: '', cause: '', effect: '', start: relay.T - 86400, end: relay.T + 2 * 86400, routeIds: [], routes, stops, global: false });
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
  // The map's own, taken at its next look at a source: the strand drawn is its 'runs' source's.
  await page.evaluate(async () => { const m = await import('/vendor/maplibre-gl.mjs'), g = m.Map.prototype.getSource; m.Map.prototype.getSource = function (id) { window.__map = this; return g.call(this, id); }; });
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


test('a picked bus\'s way on through a stop closed with no way round known: left to the dots', async ({ page }) => {
  // Route 11's 760 South Gateway Drive closed by a notice alone, where only the 11 runs, and no way round seen: its
  // line dotted there (from the corner after 358 North Gateway Dr), and its bus's strand clear along the dots.
  const GW358 = '7565913', GW760 = '7565914', E690 = '7565915';
  const relay = { T: Math.floor(Date.now() / 1000), feed: null };
  relay.alerts = () => [stopClosure(relay, 'a990105', ['11'], [GW760])];
  await stageRelay(page, relay);
  await open(page);
  const p11 = await tripThrough(page, '11', [GW358, GW760, E690]);
  test.skip(!p11, 'no Route 11 trip today by 358 North, 760 South Gateway Drive and 690 South 100 East in a row');
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

const BLUE_STOPS = { SOUTH: '7547682', MACEYS: '7547683', STADIUM: '7547676', MAIN950: '7547677', RIVERWOODS: '7547688' };
/** Whether the Blue Loop still calls at South Walmart (Back), Macey's, 453 West 100 North, 950 South Main St and The
 *  Riverwoods in a row. */
const blueInRow = page => page.evaluate(ids => import('/app/data.js').then(m => { const B = m.D.routeByShort.B; return B !== undefined && Object.values(m.D.routes[B].stops).some(seq => seq.some((si, k) => ids.every((id, i) => seq[k + i] !== undefined && m.D.stops[seq[k + i]].id === id))); }), Object.values(BLUE_STOPS));



test('a holiday: no buses on Thanksgiving, said by its name; the evening before, the next bus is Friday\'s; Friday runs', async ({ page }) => {
  // Connect's feed has no holidays (tools/hints.json does). The next Thanksgiving, the fourth Thursday of November.
  const today = new Date();
  let tg = null;
  for (let y = today.getFullYear(); !tg; y++) { const d = new Date(y, 10, 1); d.setDate(1 + (4 - d.getDay() + 7) % 7 + 21); if (d > today) tg = d; }
  const at = (k, hm) => { const d = new Date(tg); d.setDate(d.getDate() + k); return new Date(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${hm}:00-07:00`); };
  await page.route(/^https:\/\/live\.cacherider\.com\//, r => r.abort());
  await page.clock.setFixedTime(at(0, '12:00'));
  await open(page, '#/stop/7543017');   // Island Market: Route 3, every weekday
  await expect(page.getByText('Connect doesn\'t run on Thanksgiving Day.').filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/Service resumes Friday/).filter({ visible: true }).first()).toBeVisible();
  await go(page, '#/hub');
  await expect(page.getByText(/^Tomorrow · Friday/i).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText('The rest of today')).toHaveCount(0);
  await page.clock.setFixedTime(at(-1, '21:30'));
  await go(page, '#/stop/7543017');
  await expect(page.getByText(/The next one is Friday at/).filter({ visible: true }).first()).toBeVisible();
  await page.clock.setFixedTime(at(1, '12:00'));
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

test('settings and about: the clock and units turned and back', async ({ page }) => {
  await open(page, '#/about');
  await expect(page.getByText(/Send feedback/)).toBeVisible();
  for (const name of [/12|24/, /miles|km/i]) {
    const b = page.getByRole('button', { name }).filter({ visible: true }).first();
    if (await b.count()) { await b.click(); await b.click(); }
  }
});
