/*
 * Every request for the chain's image service, sent through the API's
 * disk cache instead (`/api/images`, see `cachedImage` in @incitio/decor).
 *
 * A service worker because the photographs are asked for from everywhere
 * — <img>, CSS backgrounds, `new Image()`, `fetch` — and from URLs saved
 * in the avis, which must stay the service's own. Nothing else is touched.
 */
const CACHED = /^https:\/\/imageservice\d*\.republica\.dk\//;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !CACHED.test(request.url)) return;
  event.respondWith(fetch(`/api/images?u=${encodeURIComponent(request.url)}`));
});
