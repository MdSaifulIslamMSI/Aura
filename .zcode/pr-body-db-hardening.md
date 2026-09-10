## Motivation

Deep research pass over the entire database design: engines, all ~60 Mongoose models, migrations, retention, data-access behavior (transactions, races, money, idempotency), and the test/ops tooling around them. Verdict: the core commerce paths are already unusually strong (transactional placement with fail-closed behavior, integer minor-unit money end-to-end, idempotency-key store, transactional outbox). This PR fixes the **nine highest-severity real-world gaps that remained**. The full audit — architecture map, findings, and 12 residual risks left open — lands in this PR as `docs/database-audit-2026-09-07.md`.

## What changed (12 commits)

| # | Commit | Fix | Level |
|---|---|---|---|
| 1 | `4910e126` | **Payment capture race (Critical):** `captureIntentNow` was check-then-act — the outbox worker, admin capture route, and listing-escrow route could capture the same authorized intent concurrently: double provider mutation, and the loser's Mongoose VersionError left a **paid order stuck AUTHORIZED/unpaid**. Now: TTL capture lock mirroring the refund-lock pattern, re-check under lock, conditional `authorized → captured` transition; already-captured is idempotent success | P0 |
| 2 | `42db518f` | **Loyalty lost updates (High):** read-modify-write `user.save()` on a shared user doc silently dropped awards under concurrent orders/logins (User has no optimistic concurrency). Now atomic `$inc`/`$push` (bounded ledger), and the daily-login IST-day boundary is re-checked inside the update filter so concurrent logins cannot double-award | P0 |
| 3 | `74f543e1` | **`products.id` integrity (High):** the numeric id drives atomic stock reservation, carts, price alerts, trade-ins — but had only a plain index, and the write-blocked fallback allocator (`max(id)+1`) could mint duplicates → inventory corruption. Now: unique index + probe-forward fallback allocator + create retry on id collision; `deleteManualProduct` now **archives** instead of hard-deleting when reviews reference the product (no more orphaned review history) | P0 |
| 4 | `597dba97` | **Coupon revenue leak (High):** coupons were static config with zero redemption tracking — any user could reuse AURA10/UPI50/FREESHIP on every order forever. New `CouponRedemption` collection with unique `{code, user}`, enforced **inside the placement transaction** (409 rolls the whole order back) | P0 |
| 5 | `9d60c4b0` | **Unbounded telemetry growth (High):** `SearchEvent`/`RecommendationEvent` grow one document per interaction, no TTL, no purge — the busiest write paths in the app. Now TTL indexes on `createdAt` (default 90 days, env-overridable, clamped 1..3650) | P1 |
| 6 | `db7b87c9` | **Three server-hygiene fixes (Medium):** webhook dedupe TOCTOU (concurrent duplicate delivery hit the unique `eventId` index and surfaced E11000 500s → pointless provider retries; loser now returns `deduped`); graceful shutdown never stopped the outbox `setInterval` or closed Redis (now does, on SIGTERM/SIGINT); commerce-intelligence/bundle regexes built from product text without escaping (metacharacters could throw or force pathological scans) | P1 |
| 7 | `3a678844` | Triage the six new suites into `server.regression` (manifest guard green) | — |
| 8 | `dff91bbd` | Audit report `docs/database-audit-2026-09-07.md` (architecture snapshot, fixed table, 12 residual risks, operating notes) | — |
| 9 | `18c77fdf` | Test-harness fix caught by the regression tier (see evidence below) | — |
| 10 | `47d6a2e9` | Partial-unique refinement caught by the regression tier (see evidence below) | — |
| 11 | `c10e117b` | CI fix: reword the audit backup-gap note that tripped the staging-prod fallback scanner in two workflows | — |
| 12 | `e2ff2bb9` | CI fix: pin the escrow provider flag in `listingService.test.js` — latent env-dependent failure (CI exports `PAYMENT_PROVIDER=mock`; escrow is razorpay-only) exposed by this PR's tier run, not caused by it | — |

**Level ratings (evidence-based):** #1 is P0 because the failure mode is money-vs-DB divergence (double provider capture + unpaid order) reachable by two ordinary concurrent triggers (outbox retry + admin action). #2–#4 are P0/P1 by direct-loss criteria: silent ledger corruption, inventory corruption, and unlimited discount reuse. #5–#6 are P1/P2: cost/latency/reliability, not correctness of money.

## Evidence the regression gate worked

Four full regression-tier runs during development caught **two real regressions in this very PR**, both fixed as separate commits:

1. **`4522d203`** — the new `CouponRedemption` import in `orderPlacementService` loaded the real model inside a test harness that replaces mongoose with a bare `startSession` stub → require-time crash in `orderPlacementService.test.js` (3 tests). Fix: mock the model in the harness.
2. **`3fcf0e5c`** — my initial plain `unique: true` on `products.id` collapsed every id-less catalog row onto the single `{ id: null }` key: `E11000 dup key: { id: null }` in `bundleService.integration.test.js`. Fix: **partial unique index** filtered on `id: { $type: 'number' }` (same pattern the repo already uses for `titleKey`/`imageKey`), with the migration script updated to create `id_1_partial_unique_numeric`.

Proving the guards are real (not passing vacuously):
- `tests/paymentCaptureRace.test.js` — gated provider call; concurrent second capture gets 409, provider hit **exactly once**, order transitions to paid, lock released on provider failure
- `tests/loyaltyAtomicAward.test.js` — 10 concurrent order awards all land (balance == sum); 5 concurrent daily logins award exactly once
- `tests/couponRedemption.test.js` — first redemption recorded (float + minor units + order ref), second rejected 409 with stock/order counts unchanged; other users unaffected; unique index backstop
- `tests/catalogProductIdIntegrity.test.js` — duplicate numeric id rejected; **id-less rows coexist** under the partial index; occupied-counter-id race → re-allocates; review-referenced delete archives instead of deleting
- `tests/webhookDuplicateDelivery.test.js` — concurrent duplicate deliveries: exactly one processed, one deduped, no 500; hostile regex themes no longer throw
- `tests/telemetryRetentionTtl.test.js` — 90-day TTL index specs present on both models; env override + clamping behavior

## Verification matrix

| Check | Command | Result |
|---|---|---|
| New suites | `npx jest tests/paymentCaptureRace loyaltyAtomicAward catalogProductIdIntegrity couponRedemption telemetryRetentionTtl webhookDuplicateDelivery` | 18/18 pass |
| Adjacent suites (payments/orders/loyalty/catalog/bundle/webhook) | targeted `--runTestsByPath` runs per commit | all pass |
| Tier manifest | `node scripts/check-test-tiers.cjs` | OK — 5 tiers, 438 suites reachable, 178 tiered |
| Full regression tier | `npm test` (174 suites) × 4 runs | final: 1461/1463 pass; 2 failures are 5s **timeout flakiness** in unrelated suites (`totpMfaService`, `rateLimitHitTelemetry`) under full parallel load — both pass in isolation, failing set rotated across runs while code was constant; pre-existing machine-load sensitivity, not regressions. On CI's sharded runners the full 174 suites passed 1463/1463 (security workflow regression step) |
| Fallback scanners | `node scripts/scan-prod-fallbacks.mjs && node scripts/smoke/assert-no-staging-prod-fallbacks.mjs` | both pass after `c10e117b` |
| Hermetic escrow test | `PAYMENT_PROVIDER=mock npx jest tests/listingService.test.js` | 15/15 after `e2ff2bb9` (was 14/15 before) |
| Syntax/lint-sensitive surfaces | `node --check` on every edited entry point | clean |

## Risks & rollout notes

- **Behavior change:** every coupon code is now once-per-account (`maxUsesPerUser: 1`). If a campaign needs reuse, raise the limit in `server/config/coupons.js` — the ledger already supports counting.
- **Index rollout:** production has `autoIndex` off — run `npm --prefix server run migrate:product-id-unique` **dry-run** first; it refuses `--execute` while duplicate numeric ids exist (resolve before creating the index). Dev/test build the index automatically; Product `syncIndexes()` covers it at boot.
- **TTL env vars** (`SEARCH_EVENT_RETENTION_DAYS`, `RECOMMENDATION_EVENT_RETENTION_DAYS`) are read at model load — changing them on a live deployment requires dropping and recreating the TTL index.
- **Base:** rebased directly onto `main` (which now contains the 700-suite regression baseline via #456).
- Not verified here (stated skips): no live Mongo/Redis/payment-provider runs; migration script exercised in dry-run mode only; no deploy.

## Residual risks (documented, deliberately out of scope)

12 items in `docs/database-audit-2026-09-07.md` §3 — float majors stored beside minor units, untyped `Mixed` blobs, string-typed cross-refs, per-process catalog/FX cache invalidation across instances, no migration framework, retention policy gaps beyond telemetry, unbounded embedded arrays, prod backup automation gap, Mongo version skew across four environments, no DB index doctor, 260 untriaged suites, legacy OTP fields on User.

🤖 Generated with ZCode
