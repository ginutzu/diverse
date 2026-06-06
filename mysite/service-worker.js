const CACHE_NAME = 'oges-v6';
const urlsToCache = [
	'/',
	'/index.html',
	'/assets/css/main.min.css',
	'/assets/css/fontawesome-all.min.css',
	'/assets/webfonts/fa-solid-900.woff2',
	'/assets/webfonts/fa-brands-400.woff2',
	'/assets/css/images/bg.jpg',
	'/assets/css/images/overlay.svg',
	'/assets/css/images/qr.png',
	'/manifest.json'
];

// Install event - cache resources
self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then(cache => cache.addAll(urlsToCache))
			.then(() => self.skipWaiting())
	);
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
	event.waitUntil(
		caches.keys().then(cacheNames => {
			return Promise.all(
				cacheNames.map(cacheName => {
					if (cacheName !== CACHE_NAME) {
						return caches.delete(cacheName);
					}
				})
			);
		}).then(() => self.clients.claim())
	);
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
	event.respondWith(
		caches.match(event.request)
			.then(response => {
				if (response) {
					return response;
				}

				return fetch(event.request).then(response => {
					// Don't cache non-successful responses
					if (!response || response.status !== 200 || response.type !== 'basic') {
						return response;
					}

					// Clone the response
					const responseToCache = response.clone();
					caches.open(CACHE_NAME)
						.then(cache => {
							cache.put(event.request, responseToCache);
						});

					return response;
				});
			})
			.catch(() => {
				// Return offline page or cached response
				return caches.match('/index.html');
			})
	);
});
