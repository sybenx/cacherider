// New service alerts as notifications on this phone (About → Service alerts). The phone's browser makes a push address;
// the relay keeps it (worker/src/push.js) and, each time the agency posts a new alert, sends it there, and the service
// worker shows it (sw.js). Off: the address unsubscribed here and deleted at the relay.
import { LIVE_URL } from './data.js';

// The relay's public key (VAPID); its private half is the relay's secret VAPID_JWK.
const KEY = 'BDzehCdHIMTORKfQUmJqkaSFwtRWYyVlPcY-7l3xpqTDNPPD19_LUoAniL-p7clm5aD8srmT9jvKC3xowPTWPwg';

const key = () => Uint8Array.from(atob(KEY.replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0));
const post = (path, body) => fetch(LIVE_URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });

/** Whether this browser can take them: an iPhone only once Cache Rider is on its home screen. */
export const canPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// The service worker that shows them: the app's, once it's running (a first visit's may still be installing).
const worker = () => Promise.race([navigator.serviceWorker.ready, new Promise(ok => setTimeout(ok, 5000, null))]);

/** This phone's push address, if it has one. */
export async function pushSub() {
  if (!canPush()) return null;
  const reg = await worker();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** On: the phone's say-so, its push address, the relay told. Answers '' or why not. */
export async function pushOn() {
  const ok = await Notification.requestPermission();
  if (ok === 'denied') return 'Notifications are blocked for Cache Rider in this browser’s settings.';
  if (ok !== 'granted') return 'Notifications weren’t allowed.';
  const reg = await worker();
  if (!reg) return 'Cache Rider is still setting up on this device. Try again in a minute.';
  let sub;
  try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key() }); }
  catch { return 'This browser couldn’t set up notifications.'; }
  try { const r = await post('push', sub.toJSON()); if (!r.ok) throw 0; }
  catch { await sub.unsubscribe().catch(() => {}); return 'Couldn’t reach Cache Rider’s server. Try again in a minute.'; }
  return '';
}

/** Off: the address dropped here and at the relay. */
export async function pushOff() {
  const sub = await pushSub();
  if (!sub) return;
  await post('push/off', { endpoint: sub.endpoint }).catch(() => {});   // unreachable: the relay forgets it at its next send anyway (410)
  await sub.unsubscribe().catch(() => {});
}
