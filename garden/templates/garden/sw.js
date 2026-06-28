/* Square Foot Garden service worker — installable + offline-capable. */
const CACHE = 'sfg-cache-v1';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.add('/')).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : null))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // writes need a connection
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // Data: network-first, fall back to the last cached response when offline.
    e.respondWith(
      fetch(req).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return r;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // App shell / static: cache-first, fall back to the cached home page offline.
  e.respondWith(
    caches.match(req).then(r => r || fetch(req).then(rr => {
      if (rr && rr.status === 200) {
        const copy = rr.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return rr;
    }).catch(() => caches.match('/')))
  );
});
