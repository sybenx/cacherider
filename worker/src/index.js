// GTFS-realtime → JSON for Cache Rider. Two upstream feeds, one answer:
//   GET /  → { t, buses: [...], trips: {...} }
//   GET /?stops=id,id  → { t, trips: {...}, at: [[lat, lon, ts, trip], ...] }: the trips
//     cut to those stops, and where the feed's buses are, for small clients
//     (Headway's phone side, which tells a bus waiting at its bay by it). Open
//     to any origin: it is the public feed.
//   GET /alerts → { fetched, source, alerts: [...] }: the agency's service notices as the tracker site shows
//     them, minutes after they're posted (the GTFS-realtime alerts feed lags them, and misses some).
// Decoded here with a plain protobuf reader (the schema is small and fixed),
// so the app needs no protobuf library and gets a few kilobytes, not fifty.
// A bus off its scheduled trips (a detour) isn't in GTFS-realtime at all, so for
// a route the feed has no bus on, the tracker site's own API fills in positions.

const UPSTREAM = 'https://mycvtdbus.org/gtfs-rt/';
const RTPI = 'https://mycvtdbus.org/api/rtpi?path=';
const UA = { 'User-Agent': 'cacherider-live/1.0 (+https://cacherider.com)' };
const ORIGINS = ['https://cacherider.com', 'https://sybenx.github.io', 'http://localhost:8794'];
const PREVIEW = /^https:\/\/[a-z0-9-]+\.cacherider\.pages\.dev$/;   // Cloudflare's preview of each push
const TTL = 10;   // seconds at the edge; the feeds themselves update every few seconds
const ALERT_TTL = 300;   // a notice posted at the agency reaches riders within five minutes
const ANNOUNCEMENTS = 'https://mycvtdbus.org/announcements.data';

// ---- UTA, for Headway's phone side. UTA's predictions name no stop, only a place in the trip,
// and decoding its whole feed takes more CPU than the free plan gives a request, so the phone asks
// by trip and place (GET /uta?trips=5912862:12,5913774:30) and the feed is skimmed for just those.
// The answer has the shape of the few-stops one, a null where the stop id would be:
//   { t, trips: { "<trip_id>": { s: [[null, stop_sequence, predicted_epoch_s, schedule_relationship]] } } }
// A trip the feed says is cancelled comes back as { c: 1, s: [] }. t is the feed header's own
// timestamp, 0 when it has none, so a client that checks freshness treats it as stale.
const UTA_TRIPS = 'https://apps.rideuta.com/tms/gtfs/TripUpdate';
async function uta(url, cors) {
  const headers = { ...cors, 'Access-Control-Allow-Origin': '*' };
  delete headers['Vary'];
  const ask = url.searchParams.get('trips');
  if (!ask) return new Response('Not found', { status: 404, headers });
  const want = new Map();
  for (const pair of ask.split(',').slice(0, 40)) {
    const [id, seq] = pair.split(':');
    if (!id || !Number.isInteger(Number(seq)) || Number(seq) < 0) continue;
    if (!want.has(id)) want.set(id, new Set());
    want.get(id).add(Number(seq));
  }
  try {
    const r = await fetch(UTA_TRIPS, { headers: UA, cf: { cacheTtl: TTL, cacheEverything: true } });
    if (!r.ok) throw new Error('uta tripupdates ' + r.status);
    const body = JSON.stringify(skimTrips(new Uint8Array(await r.arrayBuffer()), want));
    return new Response(body, { headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + TTL } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
}

// A lean protobuf walk: no field is copied out unless it's wanted, and numbers stay numbers (the
// times and sequences fit well inside 2^53), so a big feed costs a fraction of a millisecond.
function uvarint(b, i) {
  let v = 0, m = 1, c;
  do { c = b[i++]; v += (c & 0x7f) * m; m *= 128; } while (c & 0x80);
  return [v, i];
}
function walk(b, from, to, fn) {   // fn(field, wireType, valueOrStart, end)
  let i = from;
  while (i < to) {
    let k; [k, i] = uvarint(b, i);
    const f = Math.floor(k / 8), wt = k & 7;
    if (wt === 0) { let v; [v, i] = uvarint(b, i); fn(f, 0, v); }
    else if (wt === 2) { let n; [n, i] = uvarint(b, i); fn(f, 2, i, i + n); i += n; }
    else if (wt === 5) i += 4;
    else if (wt === 1) i += 8;
    else return;
  }
}
const utf8 = new TextDecoder();
function skimTrips(b, want) {
  const out = { t: 0, trips: {} };
  walk(b, 0, b.length, (f, wt, s, e) => {
    if (f === 1 && wt === 2) walk(b, s, e, (g, w, v) => { if (g === 3 && w === 0) out.t = v; });   // the header's timestamp
    if (f !== 2 || wt !== 2) return;
    walk(b, s, e, (g, w, s2, e2) => {
      if (g !== 3 || w !== 2) return;   // the entity's trip_update
      let id = null, seqs = null, cancelled = false;
      const hits = [];
      walk(b, s2, e2, (h, w3, s3, e3) => {
        if (h === 1 && w3 === 2) walk(b, s3, e3, (k, w4, s4, e4) => {
          if (k === 1 && w4 === 2) { id = utf8.decode(b.subarray(s4, e4)); seqs = want.get(id) || null; }
          else if (k === 4 && w4 === 0 && s4 === 3) cancelled = true;   // the trip's schedule_relationship: CANCELED
        });
        else if (h === 2 && w3 === 2 && seqs) {
          let seq = null, arr = null, dep = null, rel = 0;
          walk(b, s3, e3, (k, w5, v5, e5) => {
            if (k === 1 && w5 === 0) seq = v5;
            else if ((k === 2 || k === 3) && w5 === 2) walk(b, v5, e5, (m, w6, v6) => {
              if (m === 2 && w6 === 0) { if (k === 3) dep = v6; else arr = v6; }
            });
            else if (k === 5 && w5 === 0) rel = v5;
          });
          const time = dep || arr;
          if (seq !== null && seqs.has(seq) && (time || rel === 1)) hits.push([null, seq, time || 0, rel]);
        }
      });
      if (id && seqs && cancelled) out.trips[id] = { c: 1, s: [] };
      else if (id && hits.length) out.trips[id] = { s: hits };
    });
  });
  return out;
}

export default {
  async fetch(req) {
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
    if (path === '/uta') return uta(url, cors);
    if (path !== '/' && path !== '/live') return new Response('Not found', { status: 404, headers: cors });
    const only = url.searchParams.has('stops') ? new Set(url.searchParams.get('stops').split(',').filter(Boolean).slice(0, 32)) : null;
    if (only) { cors['Access-Control-Allow-Origin'] = '*'; delete cors['Vary']; }
    try {
      const [vp, tu] = await Promise.all([feed('vehiclepositions'), feed('tripupdates')]);
      let out = decode(vp, tu);
      if (only) out = atStops(out, only);
      else try { await fillIn(out); } catch (e) { /* the feed's own buses still go out */ }
      const body = JSON.stringify(out);
      return new Response(body, { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + TTL } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
  },
};

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
    if (s.length) trips[id] = { v: trip.v, ts: trip.ts, s };
  }
  return { t: out.t, trips, at: out.buses.map(b => [b.lat, b.lon, b.ts, b.trip]) };
}

async function feed(name) {
  const r = await fetch(UPSTREAM + name, { headers: UA, cf: { cacheTtl: TTL, cacheEverything: true } });
  if (!r.ok) throw new Error(name + ' ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

// ---- the tracker site's API, for the routes GTFS-realtime has no bus on. Unofficial, so a fallback only:
// asked about those routes alone, and never when the feed has no buses at all (nothing is running).
async function rtpi(path, ttl) {
  const r = await fetch(RTPI + encodeURIComponent(path), { headers: UA, cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!r.ok) throw new Error('rtpi ' + r.status);
  return r.json();
}
const shortOf = trip => { const m = /^([A-Z]+|\d+)/.exec(trip || ''); return m ? m[1] : null; };   // 2_1400 → 2, B1_1329 → B
async function fillIn(out) {
  if (!out.buses.length) return;
  const covered = new Set(out.buses.map(b => shortOf(b.trip)));
  const labels = new Set(out.buses.map(b => b.label || b.id));
  const routes = (await rtpi('routes', 86400)).filter(r => r.shortName && !covered.has(r.shortName));
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

// ---- protobuf, just enough: fields as [number, value] pairs, nested messages as byte slices
function varint(b, i) {
  let r = 0n, s = 0n, c;
  do { c = b[i++]; r |= BigInt(c & 0x7f) << s; s += 7n; } while (c & 0x80);
  return [r, i];
}
function fields(b) {
  const out = [];
  let i = 0;
  while (i < b.length) {
    let key; [key, i] = varint(b, i);
    const f = Number(key >> 3n), wt = Number(key & 7n);
    if (wt === 0) { let v; [v, i] = varint(b, i); out.push([f, Number(v)]); }
    else if (wt === 1) { out.push([f, new DataView(b.buffer, b.byteOffset + i, 8).getFloat64(0, true)]); i += 8; }
    else if (wt === 5) { out.push([f, new DataView(b.buffer, b.byteOffset + i, 4).getFloat32(0, true)]); i += 4; }
    else if (wt === 2) { let n; [n, i] = varint(b, i); n = Number(n); out.push([f, b.subarray(i, i + n)]); i += n; }
    else break;
  }
  return out;
}
const str = b => new TextDecoder().decode(b);
const get = (fs, n) => { const f = fs.find(x => x[0] === n); return f ? f[1] : undefined; };
const all = (fs, n) => fs.filter(x => x[0] === n).map(x => x[1]);

function decode(vp, tu) {
  const out = { t: 0, buses: [], trips: {} };
  const vmsg = fields(vp), tmsg = fields(tu);
  const header = fields(get(vmsg, 1) || new Uint8Array());
  out.t = get(header, 3) || Math.floor(Date.now() / 1000);
  for (const ent of all(vmsg, 2)) {
    const v = get(fields(ent), 4); if (!v) continue;
    const vf = fields(v);
    const trip = fields(get(vf, 1) || new Uint8Array()), pos = fields(get(vf, 2) || new Uint8Array()), veh = fields(get(vf, 8) || new Uint8Array());
    const lat = get(pos, 1), lon = get(pos, 2);
    if (lat === undefined || lon === undefined) continue;
    out.buses.push({
      id: get(veh, 1) !== undefined ? str(get(veh, 1)) : str(get(fields(ent), 1) || new Uint8Array()),
      label: get(veh, 2) !== undefined ? str(get(veh, 2)) : '',
      trip: get(trip, 1) !== undefined ? str(get(trip, 1)) : '',
      lat: +lat.toFixed(5), lon: +lon.toFixed(5),
      bearing: get(pos, 3) !== undefined ? Math.round(get(pos, 3)) : null,
      speed: get(pos, 5) !== undefined ? +get(pos, 5).toFixed(1) : null,
      ts: get(vf, 5) || 0,
      seq: get(vf, 3), stop: get(vf, 7) !== undefined ? str(get(vf, 7)) : undefined,
      occ: get(vf, 9),
    });
  }
  for (const ent of all(tmsg, 2)) {
    const u = get(fields(ent), 3); if (!u) continue;
    const uf = fields(u);
    const trip = fields(get(uf, 1) || new Uint8Array()), veh = fields(get(uf, 3) || new Uint8Array());
    const id = get(trip, 1) !== undefined ? str(get(trip, 1)) : null;
    if (!id) continue;
    const stops = [];
    for (const s of all(uf, 2)) {
      const sf = fields(s);
      const arr = fields(get(sf, 2) || new Uint8Array()), dep = fields(get(sf, 3) || new Uint8Array());
      const time = get(dep, 2) || get(arr, 2);
      const sid = get(sf, 4) !== undefined ? str(get(sf, 4)) : null;
      if (!time || !sid) continue;
      stops.push([sid, get(sf, 1) ?? null, time, get(sf, 5) || 0]);   // stop id, sequence, predicted time, schedule relationship (1 = skipped)
    }
    out.trips[id] = { v: get(veh, 1) !== undefined ? str(get(veh, 1)) : '', ts: get(uf, 4) || 0, s: stops };
  }
  return out;
}
