# Phase 6 — Public Exposure Minimization (admin bundles + health metadata)

Implements the P0/P1 items from the Aug 3 external audit of
aurapilot.vercel.app that remained open after Phase 5.

## 1. Admin chunk isolation (CI-enforced)

Admin pages are already code-split (`lazyWithRetry` + `ADMIN_CHUNK_MATCHERS`)
and excluded from module preload (`DEFERRED_ROUTE_PRELOAD_PATTERNS`), and
`AdminRoute` renders a pending state — never the lazy children — while the
session resolves, so unauthenticated navigation does not download admin
bundles.

What was missing was an enforced guarantee. New
`scripts/security/check-admin-chunk-isolation.mjs`:

- parses `app/dist/index.html` and asserts no `admin-*` chunk reference;
- walks the build manifest import graph from the entry chunks and asserts no
  `admin-*` chunk is transitively reachable from the public shell;
- wired into the Quality workflow (builds the app, then runs
  `npm run security:admin-chunk-isolation`) so any import chain that drags
  admin code into the public shell fails CI.

Known accepted residue: the bundler duplicates a chunk-name registry into
every chunk, so internal chunk *filenames* remain visible inside public JS.
Route paths (`/admin/*`) are also present in the SPA router. Eliminating
that entirely requires a separate admin build/origin — tracked as a future
architecture item.

## 2. Minimal public health payload

`server/routes/healthRoutes.js` (`/api/health`, `/ready`, `/deep`, and the
per-dependency endpoints) previously returned service identity, environment,
and per-dependency check details to unauthenticated callers. `sendHealth` now
applies the same disclosure gate as the root `/health` endpoint
(`shouldExposeDetailedHealth`): unauthenticated production callers receive
only `{status, timestamp, correlationId}`; the `x-health-token` holder (and
non-production runtimes) still receive the full payload. HTTP status codes
(200/503) are unchanged, so monitors keep working.

## Verification

- Isolation guard passes against a real production build
  (`node scripts/security/check-admin-chunk-isolation.mjs`).
- `server/tests/publicProductDto.test.js`, `healthRoutes.test.js`,
  `healthDisclosureService.test.js` — 19/19 pass.
