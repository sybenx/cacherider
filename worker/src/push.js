// New service notices sent to the phones that asked (About → Service alerts → Notify me), as Web Push: the browser's
// own push service carries them, so the app needn't be open. Every five minutes (the cron) the notices are read as /alerts
// serves them; one not seen before starts a new round, and each phone behind on rounds is sent what it hasn't had.
// The message is encrypted to the phone's keys (RFC 8291) and signed with Cache Rider's key (VAPID, RFC 8292):
// VAPID_JWK is a Worker secret, the private key as a JWK; its public half is in the app (app/push.js).
// Kept: each phone's push address and keys, and the round it's had (migrations/0004_push.sql). Nothing else.

const SUB = 'mailto:feedback@cacherider.com';
const PER_RUN = 40;   // phones sent to a run (every five minutes): inside the free plan's 50 requests out of one
const KEEP = 60 * 86400;   // a notice no longer up is forgotten after this
// Only the browsers' push services: a push address is a URL the relay will post to, so never anyone else's.
const HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;

const b64u = {
  dec: s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0)),
  enc: b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
};
const cat = (...xs) => { const o = new Uint8Array(xs.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of xs) { o.set(x, i); i += x.length; } return o; };
const utf8 = s => new TextEncoder().encode(s);

/** A phone's subscription as its browser gives it ({ endpoint, keys: { p256dh, auth } }), checked; null if not one. */
export function subscription(j) {
  try {
    const u = new URL(j.endpoint);
    if (u.protocol !== 'https:' || !HOSTS.test(u.hostname) || j.endpoint.length > 1024) return null;
    const p = b64u.dec(j.keys.p256dh), a = b64u.dec(j.keys.auth);
    if (p.length !== 65 || p[0] !== 4 || a.length !== 16) return null;
    return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth };
  } catch { return null; }
}

export async function subscribe(env, s) {
  const r = await env.TRACKS.prepare('SELECT COALESCE(MAX(round), 0) AS r FROM push_alerts').first();
  // From now on: what's up already isn't news to a phone that's just asked.
  await env.TRACKS.prepare('INSERT INTO push_subs (endpoint, p256dh, auth, sent, made) VALUES (?, ?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth')
    .bind(s.endpoint, s.p256dh, s.auth, r.r, Math.floor(Date.now() / 1000)).run();
}
export async function unsubscribe(env, endpoint) {
  await env.TRACKS.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(String(endpoint || '')).run();
}

/** The minute's run: notices as /alerts reads them (a list of { id, title, text, routes }). */
export async function pushRun(env, list) {
  if (!env.VAPID_JWK || !Array.isArray(list)) return;
  const db = env.TRACKS, now = Math.floor(Date.now() / 1000);
  const known = new Map((await db.prepare('SELECT id, round FROM push_alerts').all()).results.map(r => [r.id, r.round]));
  let round = Math.max(0, ...known.values());
  const fresh = list.filter(a => a.id && !known.has(a.id));
  // The first run takes what's up as round 0, sent to nobody (a marker row, should nothing be up); after that, the
  // new ones are a round of their own.
  if (!known.size) await db.prepare("INSERT OR IGNORE INTO push_alerts (id, round, title, body, seen) VALUES ('_start', 0, '', '', ?)").bind(now).run();
  if (fresh.length) {
    if (known.size) round++;
    const body = a => [a.routes && a.routes.length ? (a.routes.length > 1 ? 'Routes ' : 'Route ') + a.routes.join(', ') + ': ' : '', a.text || ''].join('').slice(0, 300);
    await db.batch(fresh.map(a => db.prepare('INSERT OR IGNORE INTO push_alerts (id, round, title, body, seen) VALUES (?, ?, ?, ?, ?)').bind(a.id, round, (a.title || 'Service alert').slice(0, 120), body(a), now)));
  }
  const up = new Set(list.map(a => a.id));
  // Once an hour: the ones still up marked so, and those gone two months forgotten (never the newest round's).
  if (new Date().getUTCMinutes() < 5) {
    if (up.size) await db.batch([...up].map(id => db.prepare('UPDATE push_alerts SET seen = ? WHERE id = ?').bind(now, id)));
    await db.prepare('DELETE FROM push_alerts WHERE seen < ? AND round < ?').bind(now - KEEP, round).run();
  }
  if (!round) return;
  const subs = (await db.prepare('SELECT * FROM push_subs WHERE sent < ? ORDER BY made LIMIT ?').bind(round, PER_RUN).all()).results;
  if (!subs.length) return;
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const pub = (() => { const j = JSON.parse(env.VAPID_JWK); return b64u.enc(cat(new Uint8Array([4]), b64u.dec(j.x), b64u.dec(j.y))); })();
  const all = (await db.prepare('SELECT id, title, body, round FROM push_alerts WHERE round > ? ORDER BY round DESC, rowid DESC').bind(Math.min(...subs.map(s => s.sent))).all()).results;
  const done = [];
  await Promise.all(subs.map(async s => {
    // Only what's still up: a notice taken down while a phone waited isn't news.
    const due = all.filter(a => a.round > s.sent && up.has(a.id)).slice(0, 3).map(({ id, title, body }) => ({ id, title, body }));
    let status = 0;
    try { status = due.length ? await send(s, JSON.stringify({ alerts: due }), key, pub) : 201; }
    catch (e) { console.log('push: ' + e.message); }
    // Gone (the phone unsubscribed, or the app was removed): forgotten. Refused outright: skipped, not retried.
    // Busy or down (429, 5xx, no answer): tried again next run.
    if (status === 404 || status === 410) done.push(db.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(s.endpoint));
    else if (status >= 200 && status < 500 && status !== 429) done.push(db.prepare('UPDATE push_subs SET sent = ? WHERE endpoint = ?').bind(round, s.endpoint));
    if (status >= 300 || !status) console.log(`push ${new URL(s.endpoint).hostname}: ${status}`);
  }));
  if (done.length) await db.batch(done);
}

async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8));
}

/** One message to one phone: aes128gcm (RFC 8188/8291), one record. Answers the push service's status. */
export async function send(s, text, vapidKey, vapidPub) {
  const ua = b64u.dec(s.p256dh), auth = b64u.dec(s.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const as = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(utf8('WebPush: info\0'), ua, as), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, cat(utf8(text), new Uint8Array([2]))));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  const body = cat(salt, rs, new Uint8Array([as.length]), as, sealed);
  // VAPID: a JWT for the push service's origin, signed ES256 (WebCrypto's signature is already JOSE's r || s).
  const aud = new URL(s.endpoint).origin, exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const unsigned = b64u.enc(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))) + '.' + b64u.enc(utf8(JSON.stringify({ aud, exp, sub: SUB })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapidKey, utf8(unsigned));
  const r = await fetch(s.endpoint, {
    method: 'POST', body,
    headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(24 * 3600), Urgency: 'normal', Authorization: `vapid t=${unsigned}.${b64u.enc(sig)}, k=${vapidPub}` },
    signal: AbortSignal.timeout(5000),
  });
  return r.status;
}
