const CACHE_NAME = 'aura-runtime-v4';
const ASSET_PATH_PREFIXES = ['/assets/'];
const STATIC_PATHS = ['/manifest.json', '/favicon.ico'];
const BYPASS_PATH_PREFIXES = ['/api/', '/socket.io/', '/uploads/'];

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
            await self.clients.claim();
        })()
    );
});

const isSameOriginGet = (request) => {
    if (request.method !== 'GET') {
        return false;
    }

    const url = new URL(request.url);
    return url.origin === self.location.origin;
};

const shouldBypass = (request) => {
    const url = new URL(request.url);
    return BYPASS_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
};

const networkFirstNavigation = async (request) => {
    const cache = await caches.open(CACHE_NAME);

    try {
        const response = await fetch(request);
        if (response.ok) {
            await cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        const cached = await cache.match(request);
        if (cached) {
            return cached;
        }

        const shell = await cache.match('/');
        if (shell) {
            return shell;
        }

        throw error;
    }
};

const cacheFirstStatic = async (request) => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    if (cached) {
        return cached;
    }

    const response = await fetch(request);
    if (response.ok) {
        await cache.put(request, response.clone());
    }
    return response;
};

const staleWhileRevalidate = async (request) => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const refresh = fetch(request).then((response) => {
        if (response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    });

    return cached || refresh;
};

self.addEventListener('fetch', (event) => {
    const { request } = event;

    if (!isSameOriginGet(request) || shouldBypass(request)) {
        return;
    }

    const url = new URL(request.url);

    if (request.mode === 'navigate') {
        event.respondWith(networkFirstNavigation(request));
        return;
    }

    if (ASSET_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
        event.respondWith(cacheFirstStatic(request));
        return;
    }

    if (STATIC_PATHS.includes(url.pathname)) {
        event.respondWith(staleWhileRevalidate(request));
    }
});
