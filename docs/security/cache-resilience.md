# Cache Resilience

Aura uses three cache behaviors:

- Static assets: `public, max-age=31536000, immutable`.
- Public catalog/status reads: short public caching with stale-while-revalidate where safe.
- Auth, admin, payment, upload, webhook, AI, health, and private/user data: `no-store`.

`server/middleware/cachePolicy.js` adds route-class-specific cache headers. Existing performance cache middleware remains the response cache layer.

Rollback:

- Purge provider/CDN cache for bad public data.
- Set private or sensitive routes to `no-store`.
- Disable public cache middleware if a correctness incident is detected.
