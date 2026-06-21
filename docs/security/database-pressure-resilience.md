# Database Pressure Resilience

Controls:

- `server/middleware/queryBudgetGuard.js` rejects unbounded page sizes and oversized search terms.
- Catalog service uses `maxTimeMS`, bounded limits, escaped regex patterns, and Atlas Search fallback handling.
- Listing and product routes use bounded query parameters and safe escaping.
- `scripts/db/check-index-coverage.mjs` checks model/index evidence and query guard presence.
- `npm --prefix server run mongo:storage:audit` is read-only and now reports collection footprint, high-index collections, redacted curated query-plan evidence, and `$indexStats` availability.

Production expectations:

- MongoDB pool sizes must be set by deployment configuration.
- Public routes must not expose unbounded scans.
- Search/listing queries need explicit max page sizes.
- Slow query logs should feed observability.
- Redis and MongoDB saturation should trigger load shedding for degradable routes.
- Do not drop live indexes from footprint alone. Require read-only `$indexStats` access plus representative query-plan evidence showing no protected route depends on the candidate index.
