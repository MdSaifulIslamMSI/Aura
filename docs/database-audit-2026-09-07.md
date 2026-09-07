# Database Design Audit — 2026-09-07

Deep audit of Aura's database design and data-access behavior, followed by a
hardening batch that fixes the highest-severity real-world problems found.
Research covered all of `server/` (models, services, controllers, scripts),
connection config, migrations, retention, tests, and infra.

## 1. Architecture snapshot

| Layer | Choice | Notes |
| --- | --- | --- |
| Primary datastore | MongoDB via Mongoose 9 (`server/models/`, ~60 models) | Replica-set enforced for transactions in production (`MONGO_REQUIRE_REPLICA_SET`) |
| Volatile layer | Redis 6 (optional, flag-gated) | Rate limits, CSRF, lockout, OTP/MFA challenges, abuse scoring, Socket.IO backplane |
| Identity | Firebase Auth (Admin SDK) | `authUid` mirrored onto `User`; no Firestore usage |
| Media/secrets | AWS S3 + SSM | No DynamoDB; no Postgres for app data |

Key design properties (verified, keep):

- **Transactional order placement** (`services/orderPlacementService.js`):
  quote → intent claim → stock decrement → order → intent link → loyalty →
  cart clear, with fail-closed behavior for digital payments when
  transactions are unavailable in production.
- **Money as integer minor units** with safe-integer validators
  (`services/payments/moneyStorage.js`); Decimal.js for quote math.
- **Idempotency-key store** (`IdempotencyRecord`, unique `{key,user,route}`,
  TTL 24h), one-time order claims on payment intents, atomic outbox claim
  with stale-lock reclamation, TTL refund locks.
- **Conditional inventory decrement** (`stock: { $gte: qty }` +
  `modifiedCount` check).
- **Webhook event log** with unique `eventId`, signature verification,
  status-transition state machine, emergency kill-switch.

Migration story: there is **no migration runner**; schema changes ship as
one-off npm-scripted files (`migrate:*`) plus Mongoose `autoIndex` in
non-production and `syncIndexes()` for Product/Status at boot. Heavyweight
migrations (account-center v2, trusted-device v2) are audit/apply gated with
backup evidence and run-book docs.

## 2. Problems fixed in this batch

| # | Severity | Problem | Fix |
| --- | --- | --- | --- |
| 1 | Critical | **Payment capture race** — `captureIntentNow` was check-then-act; outbox worker + admin route + listing escrow could capture concurrently → double provider capture and the order stuck `AUTHORIZED`/unpaid on a Mongoose VersionError | TTL capture lock (`metadata.captureLock`) mirroring the refund lock, re-check under lock, conditional `authorized → captured` transition; already-captured is idempotent (`paymentService.js`) |
| 2 | High | **Loyalty lost updates** — `awardLoyaltyPoints` used read-modify-write `user.save()` on a shared user doc; concurrent orders/logins silently dropped awards | Atomic `$inc`/`$push` update with bounded ledger; daily-login IST-day boundary re-checked in the update filter so concurrent logins cannot double-award (`loyaltyService.js`) |
| 3 | High | **`products.id` not unique** — the numeric id drives atomic stock reservation, carts, price alerts, trade-ins, but carried only a plain index; the write-blocked fallback allocator (`max(id)+1`) could mint duplicates → inventory corruption | Partial unique index on `products.id` over numeric ids (id-less rows exempt; a plain unique index would collapse them onto `{ id: null }`) + dry-run-default migration `migrate:product-id-unique` for production, probe-forward fallback allocator, create retries on id collision (`catalogService.js`, `models/Product.js`) |
| 4 | High | **Unlimited coupon reuse** — static `config/coupons.js` with no redemption tracking; any user could reuse every code forever | `CouponRedemption` collection with unique `{code,user}`, enforced inside the placement transaction (409 rolls the order back), `maxUsesPerUser: 1` per rule (`orderPlacementService.js`) |
| 5 | High | **Unbounded telemetry growth** — `SearchEvent` / `RecommendationEvent` grow one document per interaction with no TTL and no purge | TTL index on `createdAt`, default 90 days, env-overridable (`SEARCH_EVENT_RETENTION_DAYS`, `RECOMMENDATION_EVENT_RETENTION_DAYS`) |
| 6 | Medium | **Webhook dedupe TOCTOU** — concurrent duplicate deliveries lost the `PaymentEvent` insert race and surfaced E11000 500s, triggering pointless provider retries | `recordWebhookEvent` treats the losing insert as `deduped: true` (`paymentService.js`) |
| 7 | Medium | **Hard product delete orphaned reviews** — `deleteManualProduct` hard-deleted regardless of references | Archives (`isActive/isPublished=false`, drops out of checkout via the existing active filter) when `ProductReview` rows exist; hard-deletes otherwise |
| 8 | Medium | **Shutdown gaps** — graceful shutdown never stopped the payment outbox `setInterval` nor closed Redis | `stopPaymentOutboxWorker()` + `closeRedis()` called on SIGTERM/SIGINT (`index.js`, `config/redis.js`) |
| 9 | Low | **Unescaped regex from product text** — commerce-intelligence and bundle keyword regexes built from product/device-profile text could throw on metacharacters or force pathological scans | `escapeRegExp` applied before token-join (`commerceIntelligenceService.js`, `bundleService.js`) |

New tests (all triaged into `server.regression`): `paymentCaptureRace`,
`loyaltyAtomicAward`, `catalogProductIdIntegrity`, `couponRedemption`,
`telemetryRetentionTtl`, `webhookDuplicateDelivery`.

## 3. Residual risks (open, by design for now)

1. **Legacy float majors beside minor units.** Every order/intent stores both
   `totalPrice` (float) and `totalPriceMinor` (authoritative). Floats remain
   in read paths (e.g. `User.lifetimeSpent` increments float majors). A
   follow-up should route all reads through minor units and deprecate floats.
2. **Untyped `Mixed` blobs** (`priceBreakdown`, `riskSnapshot`,
   `routingInsights`, `metadata`, `assistantTurn`) — no schema validation or
   size caps. Cap or type the hot ones.
3. **String-typed cross references** (`Order.paymentIntentId` ↔
   `PaymentIntent.intentId`, `FraudDecision.subject.subjectId`,
   `SecurityEvent.userId`) — no ref, no uniqueness/cascade guarantees.
4. **Per-process catalog/FX caches** (15–30s TTLs) with no cross-instance
   invalidation — multi-instance deploys serve stale prices up to one TTL
   window after a product update. Redis pub/sub invalidation is the fix.
5. **No migration framework.** One-off `migrate:*` scripts, no
   `schema_migrations` ledger, no `migrate:status`; CI never runs migrations
   (only staging deploy runs account-center). Consider a minimal runner with
   an applied-migrations collection.
6. **Retention gaps beyond telemetry.** No TTL/purge for `SecurityEvent`,
   `EmailDeliveryLog`, `AdminNotification`, `UserNotification`,
   `AssistantThreadMessage`, `ProductGovernanceLog`, `UserGovernanceLog`,
   `StatusAuditLog` (policy decision needed per collection — audit/compliance
   sensitivity differs). `AuthSecurityEventOutbox` TTL only expires
   `published` rows — a stalled worker retains `failed` rows forever.
7. **Unbounded embedded arrays on hot docs** — `User.loyalty.ledger[]`
   (bounded at 200), `User.addresses[]`, `User.trustedDevices[]`,
   `Order.commandCenter.supportChats[]`, `SearchEvent.resultIds[]` (now
   expired by TTL), `StatusIncident.timeline[]`. Fine at current scale; watch
   document size before they approach growth pain.
8. **Test-tier drift surface** — 260 server suites remain `$untriaged`
   (never run in CI tiers), including some DB-index/concurrency suites; the
   `noDbFiles` list is basename-matched, so renames silently re-enable DB
   boot for a suite.
9. **Backup automation gap** — the staging stack has fsync-lock + mongodump
   to S3 with a restore drill; the live EC2 Mongo deployment has no automated
   backup sidecar (DR doc admits RPO 24h "until managed backups are
   formalized").
10. **Mongo version skew** — mongo:7 (dev compose), mongo:7.0.11 binary
    (tests), Mongo 6.0 (CI service), mongo:8.0 (split-runtime compose).
    Pin one version family across environments.
11. **No doctor checks indexes.** `ci:doctor` checks pipeline config only and
    `backend:doctor` is an HTTP probe; nothing validates index presence or
    schema contract against a live DB. A `db:doctor` should assert critical
    unique indexes (`products.id`, `users.email`, `coupon_code_user_unique`,
    TTL index existence) — the index-reconciliation logic in `config/db.js`
    and `tests/setup.js` is currently duplicated, not shared.
12. **`OtpSession` dual-unique smell and dead legacy OTP fields on `User`**
    (`otp`, `otpExpiry`, …) — leftover from the pre-OtpSession design; a
    cleanup migration could `$unset` them.

## 4. Operating notes for this batch

- Run `npm --prefix server run migrate:product-id-unique` (dry run) against a
  target DB before deploying; it refuses `--execute` while duplicate
  `products.id` values exist. Mongoose builds the partial unique index
  automatically in dev/test and via Product `syncIndexes()` at boot.
- Retention env vars are read at model load; changing them on a live
  deployment requires dropping and recreating the TTL index.
- Coupon behavior change: each code is once-per-account; redemption rows are
  written transactionally with the order and survive as the audit ledger.
