// Served at /sw.js (the actual static root - see server.js's express.static(src/views)) so
// its default scope covers the whole app, not just a subdirectory.
//
// Strategy:
//  - Static assets (css/js/images/fonts): Cache-First - instant load, rarely change.
//  - Authenticated HTML pages + API GETs: Network-First with cache fallback. Deliberately
//    NOT Cache-First: these pages are gated by a server-side login check
//    (auth.middleware.js), and Cache-First would let a logged-out/expired-session kiosk
//    keep showing a stale cached form instead of being sent to /login whenever the network
//    is actually reachable. Cache fallback only kicks in when the network request itself
//    fails (i.e. genuinely offline).
//  - Non-GET requests (form submissions) are NOT intercepted here - the page's own code
//    (see the saveOrQueue helper wired into each form) catches a failed POST and queues it
//    in IndexedDB via offline-store.js. The `sync` event below only relays a wake-up signal
//    to any open page so sync-engine.js can replay the queue from there, since that's where
//    offlineStore/IndexedDB access already lives.

const STATIC_CACHE = 'safecater-kiosk-static-v1';
const RUNTIME_CACHE = 'safecater-kiosk-runtime-v1';
const CURRENT_CACHES = [STATIC_CACHE, RUNTIME_CACHE];

const PRECACHE_ASSETS = [
  '/style.css',
  '/script.js',
  '/translations.js',
  '/help_overlay.css',
  '/help_overlay.js',
  '/js/offline-store.js',
  '/js/sync-engine.js',
  '/js/status-badge.js',
  '/asset1.png',
  '/asset2.png',
  '/asset3.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => !CURRENT_CACHES.includes(key)).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  if (PRECACHE_ASSETS.includes(url.pathname)) {
    return true;
  }
  return /\.(css|js|png|jpe?g|svg|gif|webp|woff2?|ico)$/i.test(url.pathname);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    // Don't cache a redirected response (e.g. an expired-session navigation that landed on
    // /login) under the original request's key - that would serve the login page next time
    // this URL is requested offline, instead of the real form.
    if (response.ok && !response.redirected) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === 'navigate' || url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
  }
});

// Background Sync API (unavailable on iOS/WebKit entirely - sync-engine.js's polling
// fallback is the primary replay path there, not a rare edge case).
self.addEventListener('sync', (event) => {
  if (event.tag !== 'sync-checklists') {
    return;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: 'safecater-sync-wakeup' }));
    })
  );
});
