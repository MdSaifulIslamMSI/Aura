// Aura Service Worker - Caches app shell + API responses for offline support
const CACHE_NAME = 'aura-v1';
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json'];
const IS_LOCALHOST = ['localhost', '127.0.0.1', '::1'].includes(self.location.hostname);

if (IS_LOCALHOST) {
    self.addEventListener('install', () => {
        self.skipWaiting();
    });

    self.addEventListener('activate', (event) => {
        event.waitUntil(
            (async () => {
                const keys = await caches.keys();
                await Promise.all(keys.map((key) => caches.delete(key)));
                await self.registration.unregister();
                const clients = await self.clients.matchAll({ type: 'window' });
                clients.forEach((client) => client.navigate(client.url));
            })()
        );
    });
} else {
    // Install: pre-cache app shell
    self.addEventListener('install', (event) => {
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
        self.skipWaiting();
    });

    // Activate: clean old caches
    self.addEventListener('activate', (event) => {
        event.waitUntil(
            caches.keys().then((keys) =>
                Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
            )
        );
        self.clients.claim();
    });

    // Fetch: network-first for API, cache-first for static assets
    self.addEventListener('fetch', (event) => {
        const { request } = event;
        const url = new URL(request.url);

        // Skip non-GET
        if (request.method !== 'GET') return;

        // API calls: network-first with cache fallback
        if (url.pathname.startsWith('/api/')) {
            event.respondWith(
                fetch(request)
                    .then((response) => {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                        return response;
                    })
                    .catch(() => caches.match(request))
            );
            return;
        }

        // Static assets: cache-first
        event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
    });
}
