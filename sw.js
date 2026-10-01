// Cache Rider's service worker: the app and the timetable kept on the phone,
// the map's tiles kept as they are seen, or all at once from the About page.
// The phone answers from what it keeps, never waiting on the network: the app
// as this version installed it (a deploy is a new version, and the page offers
// a reload), the data files as last fetched, each checked behind the page.
const VERSION = 'cr-v304';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './app/main.js', './app/wide.js', './app/data.js', './app/time.js', './app/ui.js',
  './app/views/home.js', './app/views/stop.js', './app/views/hub.js', './app/views/about.js', './app/views/map.js', './app/views/ustop.js', './app/views/uroute.js', './app/views/stopwide.js', './app/geo.js', './app/usu.js', './app/rt.js', './app/pointer.js', './app/plan.js', './app/views/go.js', './app/views/find.js', './app/share.js', './app/places.js', './app/ink.js', './app/roads.js',
  './vendor/qrcodegen.mjs', './vendor/maplibre-gl.mjs', './vendor/maplibre-gl-shared.mjs', './vendor/maplibre-gl-worker.mjs', './vendor/maplibre-gl.css', './vendor/basemaps.mjs',
  './fonts/barlow-400.woff2', './fonts/barlow-500.woff2', './fonts/barlow-700.woff2', './fonts/barlow-condensed-400.woff2', './fonts/barlow-condensed-600.woff2',
  './icons/icon.svg', './icons/icon-96.png', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './favicon.ico',
];
// The data, kept apart from the app, in a cache of its own that outlasts a version: a deploy brings new code, not
// a megabyte of timetable the phone already has (each file's checked behind the page, as ever).
const DATA = ['./data/cvtd.json', './data/cvtd-shapes.json', './data/crossings.json', './data/grid.json', './data/usu.json', './data/alerts.json', './data/places.json', './data/osm-places.json', './data/pool.json', './data/elevation.json'];
const DATA_CACHE = 'cr-data';
const scope = new URL('./', self.location).href;

self.addEventListener('install', e => {
  // Straight from the server, never the HTTP cache: a fresh worker means a fresh shell.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'no-cache' }))))
    // the data only where the phone hasn't it yet (a first install, or the old shared cache's from before)
    .then(() => caches.open(DATA_CACHE)).then(async d => { for (const u of DATA) if (!await d.match(u, { ignoreSearch: true })) { const res = await fetch(new Request(u, { cache: 'no-cache' })); if (res.ok) await d.put(u, res); } })
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'cr-map' && k !== 'cr-assets' && k !== DATA_CACHE).map(k => caches.delete(k))))
    // The index once kept among the tiles, where a map merely opened left it looking saved: the mark is its own now.
    .then(() => caches.open('cr-map')).then(c => c.delete(scope + 'tiles/tiles.json'))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || !url.href.startsWith(scope)) return;
  const path = url.href.slice(scope.length);
  if (path === 'tiles/tiles.json') return e.respondWith(tileIndex(e.request));
  if (path.startsWith('tiles/')) return e.respondWith(cacheFirst(e.request, 'cr-map'));
  if (path.startsWith('vendor/basemaps-assets/')) return e.respondWith(cacheFirst(e.request, 'cr-assets'));
  // The timetable is dated inside (the app picks each day's services), so the one kept is right today; a newer one
  // is fetched behind it for the next time the app opens.
  if (path.startsWith('data/')) return e.respondWith(keptThenChecked(e));
  e.respondWith(shell(e.request));
});

/** The app itself, as this version installed it: all its files from one deploy. */
async function shell(req) {
  const c = await caches.open(VERSION);
  const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('./index.html') : null);
  return hit || networkFirst(req);
}

/** A data file as last fetched, at once, and the network asked behind it; the network waited on only with nothing kept. */
async function keptThenChecked(e) {
  const c = await caches.open(DATA_CACHE);
  const hit = await c.match(e.request, { ignoreSearch: true });
  if (!hit) return networkFirst(e.request, DATA_CACHE);
  e.waitUntil(fetch(e.request, { cache: 'no-cache' }).then(res => res.ok ? c.put(e.request, res) : null).catch(() => {}));
  return hit;
}

async function cacheFirst(req, name) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) c.put(req, res.clone());
  return res;
}

async function networkFirst(req, name = VERSION) {
  const c = await caches.open(name);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch {
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('./index.html') : null);
    return hit || new Response('Offline', { status: 503 });
  }
}

/** The tiles' index, from the network when there is one: a new cut of the map (tools/tiles.py, a few times a year)
 *  puts away the tiles kept from the last, saved for offline or seen, or they'd be served as they were for good. */
async function tileIndex(req) {
  const res = await networkFirst(req);
  if (!res.ok) return res;
  try {
    const build = String((await res.clone().json()).build || ''), c = await caches.open('cr-map'), key = scope + 'tiles/.build';
    const kept = await c.match(key), was = kept ? await kept.text() : null;
    if (build && was !== build) {
      if (was !== null) for (const k of await c.keys()) await c.delete(k);
      await c.put(key, new Response(build));
    }
  } catch { /* the tiles kept as they are */ }
  return res;
}
