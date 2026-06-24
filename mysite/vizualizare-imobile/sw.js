/* Vizualizare Imobile — service worker (app shell + CDN cache) */
const CACHE = "vizimobile-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png"];
const CDN = ["cdnjs.cloudflare.com","unpkg.com","cdn.jsdelivr.net","fonts.googleapis.com","fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    // app shell: cache-first, fall back to network
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      const cp = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return resp;
    }).catch(() => r)));
  } else if (CDN.some(h => url.hostname.indexOf(h) >= 0)) {
    // libraries/fonts: stale-while-revalidate
    e.respondWith(caches.match(e.request).then(r => {
      const net = fetch(e.request).then(resp => { const cp = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return resp; }).catch(() => r);
      return r || net;
    }));
  }
  // ANCPI tiles/queries and everything else: default network (no SW handling)
});
