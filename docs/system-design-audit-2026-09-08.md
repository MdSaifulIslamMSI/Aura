# System Design Audit — 2026-09-08

Deep design review of the whole surface (backend runtime, database, deployment,
delivery) following the database audit of 2026-09-07. Companion branch:
`fix/system-design-real-world-hardening`, stacked on the DB-hardening PR.

## 1. Architecture as found

- One Express app (`server/index.js`) behind a long middleware chain (request
  id → route-cost classes → per-class timeouts → Prometheus → JSON logging →
  helmet/CORS → body guards → distributed rate limits → emergency/attack
  mode). ~45 route files under `/api/*`, thin controllers, ~150 services.
- State: MongoDB (Mongoose 9, ~60 models; prod is self-hosted on EC2, outside
  the compose stack), Redis (distributed limits, auth cache, socket backplane).
- Runtime split: `api` and `worker` containers both run in-process workers;
  DB-claimed workers (payment outbox, order email, catalog) are safe with
  replicas; timers and monitors are per-instance.
- Order/payment core is hardened: atomic stock decrement, capture lock,
  webhook eventId dedupe, DB-backed idempotency, Mongo transactions for
  digital checkout with fail-closed on non-replica-set.
- Delivery: S3+CloudFront, Netlify, and Vercel all proxy to the backend
  CloudFront distribution (hardcoded). Backend deploys are manual
  `workflow_dispatch` with an SSM Run Command; production Mongo is not
  covered by IaC.

## 2. Findings and fixes shipped in this batch

| # | Finding | Real-world consequence | Fix |
|---|---------|------------------------|-----|
| 1 | `adaptiveRateLimit` kept every bucket in an unbounded Map keyed on full URL incl. query string (mounted on payment routes) | Bot storm mints a permanent Map entry per unique URL → heap exhaustion on the middleware meant to absorb attacks | Query stripped from the key; Map capped (`SECURITY_ADAPTIVE_RATE_LIMIT_MAX_KEYS`, default 20000) with expired-first sweep + oldest-insert eviction |
| 2 | Status-email outbox was find-then-save | `api` + `worker` replicas both poll the outbox → duplicate downtime/maintenance emails; crashed sends stuck in `sending` forever | Atomic `findOneAndUpdate` claim with lock fields + stale reclaim (`STATUS_NOTIFICATION_STALE_LOCK_MS`), ownership-filtered release |
| 3 | Monitor alerts deduped with findOne-then-create, random ids | Racing replicas create duplicate `AdminNotification` docs → alert noise | Deterministic `notificationId` (actionKey + dedupe-window bucket) + existing unique index decides the winner; E11000 treated as skipped; race covered by DB-backed test |
| 4 | Metrics labelled histograms/counters with raw `req.path` for unrouted requests | prom-client never GCs series → scanner traffic minted a new series per random path on 6+ metrics; heap bloat, slow scrapes | Fixed `unmatched` label for requests without string route metadata |
| 5 | `User.lifetimeSpent` accumulated float major-unit `$inc`s | Binary-fraction drift in a user-level money counter (DB audit risk #1) | `User.lifetimeSpentMinor` (integer paise) incremented atomically from `totalPriceMinor`; dashboard reads prefer minor/100; backfill script sums minor units; float major kept for legacy readers |
| 6 | Global JSON parser captured `req.rawBody` for every request; uploads/listings/ai parser did the same for up to 10 MB bodies | Every large request held its payload twice (buffer + string) → tripled peak memory exactly where bodies are largest | Capture scoped to signature-verified routes (payment/status/email webhooks) + auth/otp |
| 7 | `catalogService.productIdentifierCache` and the memory response cache were unbounded | Cloned product docs per alias key / one response body per unique query string held until re-read → catalog-sized or crawler-shaped memory growth | Entry caps + expired-first sweep + oldest-insert eviction (`CATALOG_IDENTIFIER_CACHE_MAX_KEYS`, `CACHE_MEMORY_MAX_ENTRIES`) |
| 8 | Gmail SMTP transporter had no socket timeouts | One wedged connection held the claimed order-email slot until the 5-minute stale-lock release, serializing order confirmations | 15s/15s/20s connection/greeting/socket timeouts |
| 9 | `unhandledRejection` was logged and swallowed | A failed background worker kept serving with half-mutated state | Exit(1) after a short log-flush delay (restores Node 15+ default); supervisor restarts |
| 10 | Atlas search availability latched failure for process lifetime | After one Atlas outage the instance served unanchored regex full-scans until restarted | Failed probe retried after `CATALOG_SEARCH_PROBE_RETRY_MS` (5 min); success stays latched |
| 11 | Docker json-file logs unbounded on a 20 GB root volume | Disk-fill outage from API logs, Caddy logs, scrape noise | 10m × 5-file rotation per service (compose anchors) + `daemon.json` defaults in bootstrap |
| 12 | No production Mongo backup at all (DB audit risk #9) | RPO 24h was aspirational; nothing existed | Scheduled `production-db-backup.yml` → host-level hot `mongodump --oplog` to S3 with checksums/manifest, versioned bucket, lifecycle expiry, object verification |
| 13 | No external uptime check; self-hosted Prometheus shares fate with the host | Downtime discovered by humans | Scheduled `uptime-probe.yml` against `/api/health/live` via `AURA_UPTIME_BACKEND_URL` var; failure emails are the alert path |
| 14 | No migration framework (DB audit risk #5) | Nine one-off scripts, no ledger, nothing preventing concurrent runs | `SchemaMigration` ledger + singleton lock (stale reclaim) + append-only registry + `migrate:run` / `migrate:status` |

## 3. Findings investigated and corrected (no change needed)

- **"SPA deep links break on the AWS surface"** — stale. The CloudFront
  bootstrap already attaches a viewer-request function
  (`$StackPrefix-frontend-spa-rewrite`) that rewrites extension-less,
  non-`/assets/` URIs to `/index.html`; raw S3 403/404 XML is only reachable
  for stale hashed asset names, which should fail. Error-response mapping
  remains a hardening nicety, not a deep-link breakage.
- **"Uploads default to local disk in production"** — stale for this
  deployment: `bootstrap-instance-user-data.sh` sets
  `UPLOAD_STORAGE_DRIVER=s3` in `base.env`. The code-level default of `local`
  in `avatarMediaStorageService.js` remains a footgun for non-EC2 deploys.
- **"Capacitor `allowNavigation` is overly broad"** — every listed host maps
  to a configured Firebase Authentication provider
  (`google.com`, `facebook.com`, `github.com`, `twitter.com`) or the Firebase
  auth domains. Narrowing further risks breaking mobile OAuth and cannot be
  verified without a device build; left as is deliberately.

## 4. Residual risks (documented, open)

1. **Hardcoded CloudFront distribution** (`dbtrhsolhec1s.cloudfront.net`)
   appears in ~50 files (CSPs, proxies, desktop runtime, tests). A stable
   custom domain (e.g. the planned teamaura.tech) plus one env-var indirection
   is the durable fix; deferred until the domain decision.
2. **Exposed historical Firebase API key** — rotation checklist in
   `ROTATE_SECRETS_REQUIRED.md` remains owner action.
3. **Single-host production** — one EC2 instance, no ASG/ALB, ephemeral
   `sslip.io` DNS (stop/start changes the IP; no Elastic IP), Redis single
   container. Documented rebuild procedure is the current mitigation.
4. **Mongo version skew** — 7 dev / 7.0.11 test / 6.0 CI / 8.0 split-runtime.
5. **Float majors on `Order`/`PaymentIntent` documents** still required in
   schemas; full deprecation continues after all readers migrate to minors.
6. **Retention gaps beyond telemetry** (DB audit risk #6) unchanged.
7. **Search regex fallback** still full-scans when Atlas Search is degraded;
   the probe retry bounds the stuck-degraded window, not the per-query cost.
   Precomputed anchored search keys remain the real fix.
8. **Backups are hot snapshots** — application-level cross-collection
   consistency requires the quiesced approach used elsewhere; restore drill on
   the first uploaded archive is the open verification step (DR runbook).
9. **Rate limiter fail-open posture** — non-critical limiters fall back to
   per-instance memory when Redis is down (limits multiply by replica count).
   Now measurable via `aura_rate_limit_fallback_total`; flipping to
   fail-closed trades availability for strictness and is a deliberate future
   decision.
10. **Malware scanning disabled by default in the prod compose** profile;
    enabling ClamAV is a capacity/cost tradeoff left to the operator.

## 5. Verification

- Focused suites for every code change (see commits), tiered into
  `config/test-tiers.json` (5 new suites; manifest check green).
- Full `server` regression run on the branch before PR.
- Infra changes (compose, bootstrap, workflows, backup script) are
  structurally validated (YAML parse, `bash -n`) but not executed against AWS;
  first scheduled backup run and restore drill are the acceptance steps.
