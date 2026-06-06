/* OGES service worker — PWA / offline
 * Scope-relative paths so it works both at the domain root (NAS)
 * and under a subpath like /diverse/ (GitHub Pages).
 */
const CACHE_NAME = 'oges-v7';

// Pre-cached app shell. Relative URLs resolve against the SW location (its scope),
// so they are correct whether the site is served from "/" or from "/diverse/".
const PRECACHE = [
	'./',
	'./index.html',
	'./manifest.json',
	'./assets/css/dark-tech.min.css',
	'./assets/css/leaflet.min.css',
	'./assets/js/leaflet.min.js',
	'./assets/js/proj4.min.js',
	'./assets/css/images/bg.jpg',
	'./assets/css/images/qr.png'
];

// Install — pre-cache the shell. Individual failures don't abort the install.
self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then((cache) => Promise.all(
				PRECACHE.map((url) => cache.add(url).catch(() => null))
			))
			.then(() => self.skipWaiting())
	);
});

// Activate — drop old caches.
self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys()
			.then((keys) => Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;

	// Page navigations: network-first (always fresh when online),
	// fall back to the cached page when offline.
	if (req.mode === 'navigate') {
		event.respondWith(
			fetch(req)
				.then((res) => {
					const copy = res.clone();
					caches.open(CACHE_NAME).then((c) => c.put(req, copy));
					return res;
				})
				.catch(() => caches.match(req, { ignoreSearch: true })
					.then((r) => r || caches.match('./index.html')))
		);
		return;
	}

	// Other GET requests: cache-first, then network (cache same-origin successes).
	// ignoreSearch lets cached files match requests that carry a ?v= query.
	event.respondWith(
		caches.match(req, { ignoreSearch: true }).then((cached) => {
			if (cached) return cached;
			return fetch(req).then((res) => {
				if (res && res.status === 200 && res.type === 'basic') {
					const copy = res.clone();
					caches.open(CACHE_NAME).then((c) => c.put(req, copy));
				}
				return res;
			}).catch(() => cached);
		})
	);
});
