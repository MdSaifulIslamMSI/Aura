# Database Resilience

This document is the operator-facing companion to `docs/security/database-pressure-resilience.md`.

Controls:

- Query budget guard for public/search-heavy routes.
- Pagination caps.
- Escaped regex usage.
- `maxTimeMS` in high-traffic catalog queries.
- Index coverage script.
- Slow query and DB pressure metrics.

Production work still required:

- Confirm MongoDB pool limits and indexes in the hosted provider.
- Attach slow query dashboards.
- Re-run evidence after catalog/index changes.
