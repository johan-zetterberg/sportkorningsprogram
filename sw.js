const SW_VERSION = 'v1.0.0';
const RUNTIME_CACHE = 'runtime-' + SW_VERSION;

self.addEventListener('install', (evt) => {
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== RUNTIME_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evt) => {
  const req = evt.request;

  // Bypass icke-GET & externa (t ex Firestore gRPC/websocket)
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

  // HTML: Network-first (så du får nya sidor när nätet finns)
  if (req.headers.get('accept')?.includes('text/html')) {
    evt.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);
        return cached || new Response('<h1>Offline</h1>', { headers: { 'Content-Type':'text/html' }});
      }
    })());
    return;
  }

  // Övrigt (JS/CSS/IMG): Stale-While-Revalidate
  evt.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then(resp => { cache.put(req, resp.clone()); return resp; }).catch(() => null);
    return cached || network || new Response('', { status: 504 });
  })());
});
