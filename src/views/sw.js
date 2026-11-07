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

const STATIC_CACHE = 'safecater-kiosk-static-v3';
const RUNTIME_CACHE = 'safecater-kiosk-runtime-v2';
// Tutorial videos get their own cache: they're far bigger than everything else here, and
// js/tutorials.js manages which ones it holds (see the 'message' handler below).
const TUTORIAL_CACHE = 'safecater-kiosk-tutorials-v1';
const CURRENT_CACHES = [STATIC_CACHE, RUNTIME_CACHE, TUTORIAL_CACHE];

const PRECACHE_ASSETS = [
  '/style.css',
  '/script.js',
  '/translations.js',
  '/help_overlay.css',
  '/help_overlay.js',
  '/js/offline-store.js',
  '/js/sync-engine.js',
  '/js/status-badge.js',
  '/js/session-idle.js',
  '/js/tutorials.js',
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

// ---- Tutorial videos (/tutorials/*.mp4 + .jpg posters) ----
// <video> asks for byte ranges, and a 206 partial response can't be stored with cache.put().
// So the whole file is fetched (no Range header) and cached once, and every range request is
// answered by slicing the cached copy - which is also what makes seeking work offline.

function tutorialKey(request) {
  const url = new URL(request.url);
  return url.pathname + url.search;
}

async function rangeResponse(full, rangeHeader) {
  if (!rangeHeader) {
    return full;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  const body = await full.arrayBuffer();
  const size = body.byteLength;
  const type = full.headers.get('Content-Type') || 'video/mp4';
  if (!match || (match[1] === '' && match[2] === '')) {
    return new Response(body, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
  }

  let start;
  let end;
  if (match[1] === '') {
    // "bytes=-500" is the last 500 bytes
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }

  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  });
}

async function fetchAndCacheTutorial(cache, key) {
  const response = await fetch(key, { credentials: 'same-origin' });
  if (response.ok && response.status === 200) {
    await cache.put(key, response.clone());
  }
  return response;
}

async function tutorialResponse(request) {
  const key = tutorialKey(request);
  const cache = await caches.open(TUTORIAL_CACHE);
  let full = await cache.match(key);
  if (!full) {
    try {
      full = await fetchAndCacheTutorial(cache, key);
    } catch (err) {
      return new Response(null, { status: 504, statusText: 'Offline and not cached yet' });
    }
    if (full.status !== 200) {
      return full;
    }
  }
  return rangeResponse(full, request.headers.get('range'));
}

// js/tutorials.js posts the kitchen's series a few seconds after a page loads, so the videos
// are ready before anyone is offline. `keep` lists every current tutorial URL - anything else
// in this cache is an old version and is removed.
async function cacheTutorials(urls, keep) {
  const cache = await caches.open(TUTORIAL_CACHE);
  const wanted = new Set([...keep, ...urls]);
  const cached = await cache.keys();
  await Promise.all(cached
    .filter((request) => !wanted.has(tutorialKey(request)))
    .map((request) => cache.delete(request)));

  for (const url of urls) {
    if (typeof url !== 'string' || !url.startsWith('/tutorials/')) {
      continue;
    }
    if (await cache.match(url)) {
      continue;
    }
    try {
      await fetchAndCacheTutorial(cache, url);
    } catch (_err) {
      // offline right now - try again on the next page load
    }
  }
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'safecater-cache-tutorials' || !Array.isArray(data.urls)) {
    return;
  }
  event.waitUntil(cacheTutorials(data.urls, Array.isArray(data.keep) ? data.keep.filter((u) => typeof u === 'string') : []));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin === self.location.origin && url.pathname.startsWith('/tutorials/')) {
    event.respondWith(tutorialResponse(request));
    return;
  }

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
