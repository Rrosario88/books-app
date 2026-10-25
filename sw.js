/* Books service worker: caches the app shell so it opens instantly and offline.
   API calls and audio streams always go to the network. Cover images are cached as they're seen. */
const VERSION = 'books-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];
const IMG_CACHE = 'books-img-v1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== IMG_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // stale-while-revalidate for the app shell
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit || c.match('index.html'));
      return hit || net;
    }));
    return;
  }
  // cache cover art (Open Library covers, Internet Archive thumbnails)
  if (url.hostname === 'covers.openlibrary.org' || url.pathname.startsWith('/services/img/')) {
    e.respondWith(caches.open(IMG_CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok || r.type === 'opaque') c.put(req, r.clone());
      return r;
    }).catch(() => fetch(req)));
  }
  // everything else (search APIs, mp3 streams with Range requests): straight to network
});
