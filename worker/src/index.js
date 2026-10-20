// GTFS-realtime → JSON for Cache Rider. Two upstream feeds, one answer:
//   GET /  → { t, buses: [...], trips: {...} }
//   GET /?stops=id,id  → { t, trips: {...}, at: [[lat, lon, ts, trip], ...] }: the trips
//     cut to those stops, and where the feed's buses are, for small clients
//     (Headway's phone side, which tells a bus waiting at its bay by it). Open
//     to any origin: it is the public feed.
//   GET /detours → { t, detours: [...] }: the ways round the buses have been seen to take (src/detours.js).
//   GET /alerts → { fetched, source, alerts: [...] }: the agency's service notices as the tracker site shows
//     them, minutes after they're posted (the GTFS-realtime alerts feed lags them, and misses some).
// Decoded here with a plain protobuf reader (the schema is small and fixed),
// so the app needs no protobuf library and gets a few kilobytes, not fifty.
// A detoured trip comes in the feed twice (see decode()), and a bus the feed
// has on no trip at all is filled in from the tracker site's own API, for a
// route the feed has no bus on.
// Every answer carries `now`, the relay's clock, beside `t`, the feed's: a feed
// that has stopped moving shows its age to a client without trusting its clock.

import { watchStart, watchStep, watchEnd, detoursJSON, inService } from './detours.js';

const UPSTREAM = 'https://mycvtdbus.org/gtfs-rt/';
const RTPI = 'https://mycvtdbus.org/api/rtpi?path=';
const UA = { 'User-Agent': 'cacherider-live/1.0 (+https://cacherider.com)' };
const ORIGINS = ['https://cacherider.com', 'https://sybenx.github.io', 'http://localhost:8794', 'http://localhost:8795'];   // 8795: the smoke test (tools/smoke)
const PREVIEW = /^https:\/\/[a-z0-9-]+\.cacherider\.pages\.dev$/;   // Cloudflare's preview of each push
const TTL = 5;   // seconds at the edge, the agency's feed asked no oftener than this; each bus reports every 3 to 8 seconds
const ALERT_TTL = 300;   // a notice posted at the agency reaches riders within five minutes
const ANNOUNCEMENTS = 'https://mycvtdbus.org/announcements.data';

// GitHub runs scheduled workflows as it gets to them: the alerts' quarter hour and the timetable's night came hours
// late. Asked for from here instead, on the minute, by their own on-demand trigger (workflow_dispatch), which GitHub
// starts at once. GH_DISPATCH is a Worker secret: a token for this repository's Actions alone. GitHub's own schedules
// stay as they were, the fallback; the workflows share one queue (data-push) and commit only what changed, so a late
// run of GitHub's own after one of these does nothing.
const REPO = 'sybenx/cacherider';
const DISPATCH = [
  { file: 'alerts.yml', due: d => d.getUTCMinutes() % 15 === 0 },   // as its cron, '*/15 * * * *'
  { file: 'data.yml', due: d => d.getUTCHours() === 9 && d.getUTCMinutes() === 23 },   // '23 9 * * *', 03:23 Mountain
];
async function dispatch(env, at) {
  if (!env.GH_DISPATCH) return;
  const d = new Date(at);
  for (const w of DISPATCH) {
    if (!w.due(d)) continue;
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${w.file}/dispatches`, {
      method: 'POST', body: JSON.stringify({ ref: 'main' }),
      headers: { ...UA, Authorization: 'Bearer ' + env.GH_DISPATCH, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    }).catch(e => ({ status: 0, text: async () => String(e) }));
    if (r.status !== 204) console.log(`dispatch ${w.file}: ${r.status} ${(await r.text()).slice(0, 200)}`);   // a lapsed token (401): GitHub's own schedule carries on
  }
}

export default {
  // Every minute: where the buses are, for spotting detours from the tracks (tools/detours.py reads them); and on
  // their minutes, the data workflows asked for (dispatch).
  async scheduled(ev, env, ctx) { ctx.waitUntil(Promise.all([track(env), dispatch(env, ev.scheduledTime)])); },
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ORIGINS.includes(origin) || PREVIEW.test(origin) ? origin : ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET',
      'Vary': 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'GET') return new Response('GET only', { status: 405, headers: cors });
    const url = new URL(req.url), path = url.pathname;
    if (path === '/alerts') return alerts(cors);
    if (path === '/detours') {
      try { return new Response(JSON.stringify(await detoursJSON(env)), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } }); }
      catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
    }
    if (path !== '/' && path !== '/live') return new Response('Not found', { status: 404, headers: cors });
    const only = url.searchParams.has('stops') ? new Set(url.searchParams.get('stops').split(',').filter(Boolean).slice(0, 32)) : null;
    if (only) { cors['Access-Control-Allow-Origin'] = '*'; delete cors['Vary']; }
    // The answer made once a TTL at each edge, however many riders ask for it (a Worker's own answers aren't cached
    // in front of it): decoding the feeds is most of a run's CPU, and the free plan's is 10 ms. A few stops' answer
    // is cut from the same one: each list of stops its own, Headway's (nearest first, so a step along the street
    // made a new one) missed every time, the feeds decoded and the tracker site waited on for each, and 15 of 23
    // came after three seconds, Headway's wait (16 Oct).
    const hit = await caches.default.match(new Request(url.origin + '/'));
    if (hit && !only) return new Response(hit.body, { headers: { ...cors, ...JSON_TTL } });
    try {
      if (!only) return new Response(await (await whole(ctx, url.origin)).body, { headers: { ...cors, ...JSON_TTL } });
      let out;
      if (hit) out = await hit.json();
      else {
        // None at this edge: made here, the whole answer, cached once the tracker site has filled in, as the
        // root's; this asker waits on the tracker a second at most. The agency's feeds take 2 to 8 seconds some
        // minutes (16 Oct): slower than FEED_SLOW, or failing, the last answer made at this edge does, while the
        // feed's own clock has it inside Headway's 90 seconds, and this one is made on for the next asker.
        const making = whole(ctx, url.origin);
        let made = await Promise.race([making, wait(FEED_SLOW)]).catch(e => null);
        if (!made) {
          const last = await caches.default.match(new Request(url.origin + '/?last'));
          const kept = last && await last.json();
          if (kept && Date.now() / 1000 - kept.t < LAST) out = kept;
          else made = await making;
        }
        if (made) { await Promise.race([made.body, wait(STOPS_WAIT)]); out = made.out; }
      }
      if (!out.buses.length) out = await night(ctx, url.origin, out);
      if (!out) return new Response(JSON.stringify({ error: 'tracker slow' }), { status: 504, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      return new Response(JSON.stringify(atStops(out, only)), { headers: { ...cors, ...JSON_TTL } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
  },
};

const JSON_TTL = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + TTL };
const wait = ms => new Promise(r => setTimeout(r, ms));
// The whole answer from the feeds, { out, body }: out as soon as they're decoded, body (and the edge's cache) once
// the tracker site has filled in. Kept twice: for the TTL, everyone's answer, and for LAST, the one a few stops'
// answer falls back on while the feeds are slow. Made on past an asker that doesn't wait for it.
function whole(ctx, origin) {
  const made = (async () => {
    const [vp, tu] = await Promise.all([feed('vehiclepositions'), feed('tripupdates')]);
    const out = decode(vp, tu);
    if (!Object.keys(out.trips).length && out.buses.some(b => b.trip)) await keepTrips(out, origin);
    // Detoured buses aren't in the feed, so the tracker site fills them in for every answer.
    const body = fillIn(out, false).catch(e => { /* the feed's own buses still go out */ }).then(() => {
      const s = JSON.stringify(out);
      ctx.waitUntil(caches.default.put(new Request(origin + '/'), new Response(s, { headers: JSON_TTL })));
      ctx.waitUntil(caches.default.put(new Request(origin + '/?last'), new Response(s, { headers: { ...JSON_TTL, 'Cache-Control': 'public, max-age=' + LAST } })));
      return s;
    });
    return { out, body };
  })();
  ctx.waitUntil(made.then(m => m.body, e => { /* the asker has the error, or the last answer */ }));
  return made;
}
// The agency's trip feed comes back empty now and then while its buses are out on their trips (19 Oct, 2:42 PM: a
// bare header, every bus live): passed on, every time read as the timetable's for the poll, and Headway, which keeps
// no answer of its own, had each bus between trips. The last answer's trips stand in while their own times are
// inside LAST, as the app keeps its own (rt.js); by their times, not the answer's, so a run of empty ones can't keep
// them on.
async function keepTrips(out, origin) {
  const last = await caches.default.match(new Request(origin + '/?last')).catch(() => null);
  const kept = last && await last.json().catch(() => null);
  if (!kept || !kept.trips) return;
  const newest = Math.max(0, ...Object.values(kept.trips).map(t => t.ts || 0));
  if (Date.now() / 1000 - newest < LAST) out.trips = kept.trips;
}
// A few stops' answer when the feed has no bus at all asks the tracker site anyway: Headway counts buses out from its
// yard, and one deadheading home is only on the tracker, if anywhere. Made once a TTL at each edge too, under a key
// of its own. Null when the tracker hasn't answered inside NIGHT_WAIT: its buses are all of `at` then, and an
// answer without them would read as every bus in (Headway keeps its last word on an error).
async function night(ctx, origin, out) {
  const key = new Request(origin + '/?stops');
  const hit = await caches.default.match(key);
  if (hit) return hit.json();
  const all = { ...out, buses: [] };
  let done = false;
  const filled = fillIn(all, true).catch(e => { /* none, as the feed has */ }).then(() => {
    done = true;
    ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(all), { headers: JSON_TTL })));
  });
  ctx.waitUntil(filled);
  await Promise.race([filled, wait(NIGHT_WAIT)]);
  return done ? all : null;
}

// ---- bus tracks: three samples a minute, twenty seconds apart (a short detour, a block or two, is gone in a
// minute), each the feed's buses and the tracker's (a detoured bus is only on the tracker), as one row. Nothing
// written while no bus is out; rows older than fourteen days put away once an hour.
const SAMPLES = 3, EVERY = 20000, KEEP = 14 * 86400;
// A run's last sample is skipped past this, so a slow feed can't run it into the next minute's: two runs at once
// would each read the watch's state and write it back, and the later would undo the earlier.
const RUN_FOR = 50000;
async function track(env) {
  const began = Date.now();
  let W = null;
  try { W = await watchStart(env); } catch (e) { /* the samples still go in */ }
  // Nothing running by the timetable (every route out of its hours): the feed not asked, nothing written.
  if (W && !W.L.anyInHours(Date.now())) return;
  for (let i = 0; i < SAMPLES; i++) {
    if (i) await new Promise(r => setTimeout(r, EVERY));
    if (Date.now() - began > RUN_FOR) break;
    try {
      const [vp, tu] = await Promise.all([feed('vehiclepositions'), feed('tripupdates')]);
      const out = decode(vp, tu, true);
      try { await fillIn(out, false); } catch (e) { /* the feed's own buses */ }
      if (!out.buses.length) continue;
      const t = Math.floor(Date.now() / 1000);
      const keyOfTrip = trip => { const p = shortOf(trip); return (W && p && W.L.prefix[p]) || p; };   // PW 1800 → Pumpkin
      const rows = out.buses.map(b => { const key = keyOf(b.route) || keyOfTrip(b.trip) || ''; return [b.label || b.id, b.trip || '', key, b.lat, b.lon, b.bearing, b.speed, b.ts, W ? +inService(W, out, b, key, t) : 1]; });
      await env.TRACKS.prepare('INSERT OR REPLACE INTO samples (t, buses) VALUES (?, ?)').bind(t, JSON.stringify(rows)).run();
      if (W) watchStep(W, t, rows);
    } catch (e) { /* a sample missed */ }
  }
  if (W) await watchEnd(env, W, Math.floor(Date.now() / 1000));
  if (new Date().getUTCMinutes() === 0) await env.TRACKS.prepare('DELETE FROM samples WHERE t < ?').bind(Math.floor(Date.now() / 1000) - KEEP).run();
}

// ---- service notices: the tracker site's announcements, posted by the agency and on the site at once, where
// the GTFS-realtime alerts feed lags and misses some (a stop closure assigned to routes alone). The site is a
// React Router app, and its data endpoint answers in turbo-stream: one array, in which each object's keys and
// values, and each array's items, are indexes into the array. Read out into the same shape as data/alerts.json.
async function alerts(cors) {
  try {
    const r = await fetch(ANNOUNCEMENTS, { headers: UA, cf: { cacheTtl: ALERT_TTL, cacheEverything: true } });
    if (!r.ok) throw new Error('announcements ' + r.status);
    const raw = await r.json(), memo = new Map();
    const dec = i => {
      if (typeof i !== 'number' || i < 0) return null;
      if (memo.has(i)) return memo.get(i);
      const v = raw[i];
      if (Array.isArray(v)) { const l = []; memo.set(i, l); for (const x of v) l.push(dec(x)); return l; }
      if (v && typeof v === 'object') { const o = {}; memo.set(i, o); for (const [k, x] of Object.entries(v)) o[dec(+k.slice(1))] = dec(x); return o; }
      return v;
    };
    const msgs = dec(0)?.['routes/transit']?.data?.messages;
    if (!Array.isArray(msgs)) throw new Error('announcements: no messages');
    const epoch = s => typeof s === 'string' && !isNaN(Date.parse(s)) ? Math.floor(Date.parse(s) / 1000) : null;
    const list = msgs.filter(m => m && typeof m === 'object').map(m => ({
      id: 'a' + m.id, title: String(m.name || '').trim(), text: String(m.text || '').trim(), url: '', cause: '', effect: '',
      start: epoch(m.start), end: epoch(m.end), routeIds: [],
      routes: (m.assignments?.routes || []).map(r => r && r.shortName).filter(Boolean),
      stops: (m.assignments?.stops || []).map(s => s && String(s.id)).filter(Boolean),
      global: !!m.assignments?.global,
    }));
    const body = JSON.stringify({ fetched: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), source: ANNOUNCEMENTS, alerts: list });
    return new Response(body, { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + ALERT_TTL } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
}

// Only the trips that call at the asked stops, each cut to those stops, and
// the buses as bare positions with their trips: enough to see which route's
// bus is sitting at a stop.
function atStops(out, only) {
  const trips = {};
  for (const [id, trip] of Object.entries(out.trips)) {
    const s = trip.s.filter(x => only.has(x[0]));
    if (s.length || trip.c) trips[id] = trip.c ? { v: trip.v, ts: trip.ts, s, c: 1 } : { v: trip.v, ts: trip.ts, s };
  }
  // A bus the tracker site fills in (a detour, off the feed's trips) carries its route as a fifth field: it's on
  // the road for that route, not between trips. One off both is logged in and off a trip: pulling in, at night.
  return { t: out.t, now: out.now, trips, at: out.buses.map(b => b.src === 'rtpi' ? [b.lat, b.lon, b.ts, b.trip, b.route] : [b.lat, b.lon, b.ts, b.trip]) };
}

// Upstream asked with a limit: a feed that hangs would hold a rider's poll past the app's own eight seconds, and
// stretch a minute's tracking run into the next one's.
const FEED_WAIT = 7000, RTPI_WAIT = 4000;   // under the app's own eight-second wait
// A few stops' answer waits on the tracker site no longer than this, inside Headway's three seconds: by day for the
// buses on a detour alone, at night for all of them (the feeds, small then, asked first).
const STOPS_WAIT = 1000, NIGHT_WAIT = 2000;
// A few stops' answer waits on the feeds this long before the last answer made at its edge does instead, if the
// feed's own time has it no more than LAST seconds old: Headway's own limit (LIVE_FRESH). Only a few stops' answer:
// Cache Rider keeps its last answer itself while a poll is slow, and counts its age from when the poll came back.
const FEED_SLOW = 1500, LAST = 90;
async function feed(name) {
  const r = await fetch(UPSTREAM + name, { headers: UA, cf: { cacheTtl: TTL, cacheEverything: true }, signal: AbortSignal.timeout(FEED_WAIT) });
  if (!r.ok) throw new Error(name + ' ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

// ---- the tracker site's API, for the routes GTFS-realtime has no bus on. Unofficial, so a fallback only:
// asked about those routes alone, and when the feed has no buses at all (nothing is running) only if
// evenEmpty, for a few-stops answer.
async function rtpi(path, ttl) {
  const r = await fetch(RTPI + encodeURIComponent(path), { headers: UA, cf: { cacheTtl: ttl, cacheEverything: true }, signal: AbortSignal.timeout(RTPI_WAIT) });
  if (!r.ok) throw new Error('rtpi ' + r.status);
  return r.json();
}
const shortOf = trip => { const m = /^([A-Z]+|\d+)/.exec(trip || ''); return m ? m[1] : null; };   // 2_1400 → 2, B1_1329 → B
// A route as the trip ids and the route lines name it: the tracker site's '16 AM' and '16 PM' are 16 and 16, and
// 'Pumpkin Walk' Pumpkin (tools/reduce.py's keys for cvtd-shapes.json, which the detour watch reads).
const keyOf = short => (short || '').split(' ')[0];
// The tracker site's route list, kept an hour in the isolate (as the detour watch keeps the route lines): asked for and
// read again for each of a tracking run's three samples, it changes once a season.
let routeList = null, routeListAt = 0;
async function trackerRoutes() {
  if (!routeList || Date.now() - routeListAt > 3600e3) {
    const l = await rtpi('routes', 86400);
    if (!Array.isArray(l)) throw new Error('rtpi routes: no list');
    routeList = l; routeListAt = Date.now();
  }
  return routeList;
}
async function fillIn(out, evenEmpty) {
  if (!out.buses.length && !evenEmpty) return;
  const covered = new Set(out.buses.map(b => shortOf(b.trip)));
  const labels = new Set(out.buses.map(b => b.label || b.id));
  const routes = (await trackerRoutes()).filter(r => r.shortName && !covered.has(keyOf(r.shortName)));
  const lists = await Promise.allSettled(routes.map(r => rtpi('routes/' + r.id + '/vehicles', 30)));
  const now = Date.now();
  lists.forEach((l, i) => {
    if (l.status !== 'fulfilled' || !Array.isArray(l.value)) return;
    for (const v of l.value) {
      const seen = /Z$/.test(v.lastUpdated || '') ? Date.parse(v.lastUpdated) : NaN;   // stale ones come without the zone
      if (!(now - seen < 180000) || labels.has(v.name) || typeof v.lat !== 'number') continue;
      labels.add(v.name);
      out.buses.push({
        id: 'rtpi' + v.id, label: v.name, trip: '', route: routes[i].shortName, src: 'rtpi',
        lat: +v.lat.toFixed(5), lon: +v.lon.toFixed(5),
        bearing: typeof v.headingDegrees === 'number' ? Math.round(v.headingDegrees) : null,
        speed: null, ts: Math.floor(seen / 1000),   // the site's speed isn't in GTFS's m/s
      });
    }
  });
}

// ---- protobuf, just enough: each message read once, front to back, the first of each of its fields kept (as numbers,
// or for bytes where they start and end in the feed) and its one repeated field's listed. Numbers stay plain numbers:
// every value here is well under 2^53, and BigInt was most of the decode's time. So, after it, were a list of fields
// made for every message and a TextDecoder for every string: 6 ms a decode in workerd, three to a minute's tracking
// run, against the free plan's 10 ms a run.
let at = 0;   // where the last varint read ended
function varint(b, i) {
  let r = 0, m = 1, c;
  do { c = b[i++]; r += (c & 0x7f) * m; m *= 128; } while (c & 0x80);
  at = i;
  return r;
}
const F = 16;   // field numbers read: none wanted here is above 9
const msg = () => ({ w: new Uint8Array(F), a: new Float64Array(F), z: new Float64Array(F) });   // wire type + 1 (0: absent), value or start, end
// The message in b from s to e into m; each field rep (a repeated message) as its start and end onto list. A wire type
// not read here ends the message, as before.
function read(b, dv, s, e, m, rep, list) {
  m.w.fill(0);
  let i = s;
  while (i < e) {
    const key = varint(b, i); i = at;
    const f = Math.floor(key / 8), wt = key % 8;
    let a, z = 0;
    if (wt === 0) { a = varint(b, i); i = at; }
    else if (wt === 1) { a = dv.getFloat64(i, true); i += 8; }
    else if (wt === 5) { a = dv.getFloat32(i, true); i += 4; }
    else if (wt === 2) { const n = varint(b, i); i = at; a = i; z = Math.min(i + n, e); i += n; }
    else break;
    if (f === rep) { if (wt === 2) list.push(a, z); }
    else if (f < F && !m.w[f]) { m.w[f] = wt + 1; m.a[f] = a; m.z[f] = z; }
  }
}
// Field f of m, itself a message, into into (absent, or not bytes: an empty one).
const sub = (b, dv, m, f, into) => m.w[f] === 3 ? read(b, dv, m.a[f], m.z[f], into) : into.w.fill(0);
const num = (m, f) => m.w[f] ? m.a[f] : undefined;
const TD = new TextDecoder();
// A string field: ASCII (every id in these feeds) read as it is, anything else by the one TextDecoder.
function str(b, m, f) {
  const s = m.a[f], e = m.z[f];
  let r = '';
  for (let i = s; i < e; i++) { if (b[i] > 127) return TD.decode(b.subarray(s, e)); r += String.fromCharCode(b[i]); }
  return r;
}
const TOP = msg(), HEAD = msg(), ENT = msg(), VP = msg(), POS = msg(), VEH = msg(), TRIP = msg(), MOD = msg(), TU = msg(), STU = msg(), ARR = msg(), DEP = msg();
// A feed's entities, each as its start and end, and its header's time.
function feedOf(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), ents = [];
  read(b, dv, 0, b.length, TOP, 2, ents);
  sub(b, dv, TOP, 1, HEAD);
  return { dv, ents, t: num(HEAD, 3) };
}

// busesOnly: the trips of the buses in the feed alone (the tracking run's, which asks only whether each bus is on its
// trip), the rest of the trip feed passed over unread.
function decode(vp, tu, busesOnly) {
  const out = { t: 0, buses: [], trips: {} };
  const V = feedOf(vp), T = feedOf(tu);
  // The answer's time is the feeds' own: the older of their two headers, so a
  // feed that has stopped moving shows its age to a client that checks. With
  // neither, the freshest bus report; only with no clock at all, now.
  const vpT = V.t, tuT = T.t;
  out.t = vpT && tuT ? Math.min(vpT, tuT) : vpT || tuT || 0;
  for (let k = 0; k < V.ents.length; k += 2) {
    read(vp, V.dv, V.ents[k], V.ents[k + 1], ENT);
    if (ENT.w[4] !== 3) continue;
    read(vp, V.dv, ENT.a[4], ENT.z[4], VP);
    sub(vp, V.dv, VP, 1, TRIP); sub(vp, V.dv, VP, 2, POS); sub(vp, V.dv, VP, 8, VEH);
    const lat = num(POS, 1), lon = num(POS, 2);
    if (lat === undefined || lon === undefined) continue;
    out.buses.push({
      id: VEH.w[1] ? str(vp, VEH, 1) : ENT.w[1] ? str(vp, ENT, 1) : '',
      label: VEH.w[2] ? str(vp, VEH, 2) : '',
      trip: TRIP.w[1] ? str(vp, TRIP, 1) : '',
      lat: +lat.toFixed(5), lon: +lon.toFixed(5),
      bearing: POS.w[3] ? Math.round(POS.a[3]) : null,
      speed: POS.w[5] ? +POS.a[5].toFixed(1) : null,
      ts: num(VP, 5) || 0,
      seq: num(VP, 3), stop: VP.w[7] ? str(vp, VP, 7) : undefined,
      occ: num(VP, 9),
    });
  }
  // A detoured trip comes twice. As itself, by its trip_id, it holds only the stops after the way round rejoins its
  // route, numbered again from nought; as the detour's replacement (GTFS-realtime TripModifications), with no trip_id
  // but modified_trip (TripDescriptor 7) naming it in affected_trip_id (7.2), it holds every stop still to come, the
  // way round's own included, numbered through. The replacement is the one kept: with only the first, the stops
  // before the rejoin read as passed, a Blue Loop bus three minutes off its next stop 'gone' (2026-10-15).
  const replaced = new Set(), stus = [], want = busesOnly ? new Set(out.buses.map(b => b.trip)) : null;
  for (let k = 0; k < T.ents.length; k += 2) {
    read(tu, T.dv, T.ents[k], T.ents[k + 1], ENT);
    if (ENT.w[3] !== 3) continue;
    stus.length = 0;
    read(tu, T.dv, ENT.a[3], ENT.z[3], TU, 2, stus);
    sub(tu, T.dv, TU, 1, TRIP); sub(tu, T.dv, TU, 3, VEH);
    const own = TRIP.w[1] ? str(tu, TRIP, 1) : null;
    let id = own, mod = false;
    if (!own) { mod = true; sub(tu, T.dv, TRIP, 7, MOD); id = MOD.w[2] ? str(tu, MOD, 2) : null; }
    if (!id || (want && !want.has(id)) || (own && replaced.has(id))) continue;
    if (mod) replaced.add(id);
    const cancelled = num(TRIP, 4) === 3;   // the trip's schedule_relationship: CANCELED
    const v = VEH.w[1] ? str(tu, VEH, 1) : '', ts = num(TU, 4) || 0;
    const stops = [];
    for (let j = 0; j < stus.length; j += 2) {
      read(tu, T.dv, stus[j], stus[j + 1], STU);
      sub(tu, T.dv, STU, 2, ARR); sub(tu, T.dv, STU, 3, DEP);
      const time = num(DEP, 2) || num(ARR, 2);
      const sid = STU.w[4] ? str(tu, STU, 4) : null;
      const rel = num(STU, 5) || 0;
      // A stop the bus will skip is news even without a time (0 then).
      if (!sid || (!time && rel !== 1)) continue;
      stops.push([sid, num(STU, 1) ?? null, time || 0, rel]);   // stop id, sequence, predicted time, schedule relationship (1 = skipped)
    }
    out.trips[id] = { v, ts, s: stops };
    if (cancelled) out.trips[id].c = 1;   // a run that isn't coming: no stops to cut it to
  }
  out.now = Math.floor(Date.now() / 1000);
  if (!out.t) out.t = out.buses.reduce((m, b) => Math.max(m, b.ts || 0), 0) || out.now;
  return out;
}
