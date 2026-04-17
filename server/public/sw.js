// Aura service worker cleanup stub.
// This intentionally removes legacy app-shell caching so Vercel deploys do not serve stale HTML/asset references.

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(keys.map((key) => caches.delete(key)));
            await self.registration.unregister();

            const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            clients.forEach((client) => client.navigate(client.url));
        })()
    );
});
