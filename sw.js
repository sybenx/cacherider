// Cache Rider's service worker: the app and the timetable kept on the phone,
// the map's tiles kept as they are seen, or all at once from the About page.
const VERSION = 'cr-v3';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './app/main.js', './app/data.js', './app/time.js', './app/ui.js',
  './app/views/home.js', './app/views/stop.js', './app/views/hub.js', './app/views/route.js', './app/views/about.js', './app/views/map.js', './app/views/ustop.js', './app/views/uroute.js', './app/views/mini.js', './app/geo.js', './app/usu.js',
  './vendor/maplibre-gl.mjs', './vendor/maplibre-gl-shared.mjs', './vendor/maplibre-gl-worker.mjs', './vendor/maplibre-gl.css', './vendor/basemaps.mjs',
  './fonts/barlow-400.woff2', './fonts/barlow-500.woff2', './fonts/barlow-700.woff2', './fonts/barlow-condensed-400.woff2', './fonts/barlow-condensed-600.woff2',
  './icons/icon.svg', './icons/icon-96.png', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './favicon.ico',
  './data/cvtd.json', './data/cvtd-shapes.json', './data/grid.json', './data/usu.json', './data/alerts.json',
];
const scope = new URL('./', self.location).href;

self.addEventListener('install', e => {
  // Straight from the server, never the HTTP cache: a fresh worker means a fresh shell.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'no-cache' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'cr-map' && k !== 'cr-assets').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || !url.href.startsWith(scope)) return;
  const path = url.href.slice(scope.length);
  if (path.startsWith('tiles/')) return e.respondWith(cacheFirst(e.request, 'cr-map'));
  if (path.startsWith('vendor/basemaps-assets/')) return e.respondWith(cacheFirst(e.request, 'cr-assets'));
  if (path.startsWith('data/')) return e.respondWith(networkFirst(e.request));
  if (path.startsWith('fonts/') || path.startsWith('vendor/')) return e.respondWith(cacheFirst(e.request, VERSION));
  e.respondWith(networkFirst(e.request));
});

async function cacheFirst(req, name) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) c.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const c = await caches.open(VERSION);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch {
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('./index.html') : null);
    return hit || new Response('Offline', { status: 503 });
  }
}
