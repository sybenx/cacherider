// GTFS-realtime → JSON for Cache Rider. Two upstream feeds, one answer:
//   GET /  → { t, buses: [...], trips: {...} }
// Decoded here with a plain protobuf reader (the schema is small and fixed),
// so the app needs no protobuf library and gets a few kilobytes, not fifty.

const UPSTREAM = 'https://mycvtdbus.org/gtfs-rt/';
const ORIGINS = ['https://cacherider.com', 'https://sybenx.github.io', 'http://localhost:8794'];
const TTL = 10;   // seconds at the edge; the feeds themselves update every few seconds

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET',
      'Vary': 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'GET') return new Response('GET only', { status: 405, headers: cors });
    const path = new URL(req.url).pathname;
    if (path !== '/' && path !== '/live') return new Response('Not found', { status: 404, headers: cors });
    try {
      const [vp, tu] = await Promise.all([feed('vehiclepositions'), feed('tripupdates')]);
      const body = JSON.stringify(decode(vp, tu));
      return new Response(body, { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + TTL } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
  },
};

async function feed(name) {
  const r = await fetch(UPSTREAM + name, {
    headers: { 'User-Agent': 'cacherider-live/1.0 (+https://cacherider.com)' },
    cf: { cacheTtl: TTL, cacheEverything: true },
  });
  if (!r.ok) throw new Error(name + ' ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
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
