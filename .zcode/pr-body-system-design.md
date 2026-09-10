## Summary

Follow-on to the merged database-hardening PR (#457). A full system-design review of the backend runtime, database, deployment, and delivery surface produced this batch: **14 real-world problems fixed in 16 commits**, three research findings corrected as stale, and ten residual risks recorded. Full findings and evidence: `docs/system-design-audit-2026-09-08.md`.

### Runtime safety (memory + process)

- **`adaptiveRateLimit` bounded** — the in-process limiter kept every bucket forever in a module Map keyed on the full URL *including query string*, mounted on payment routes; a bot storm minted a permanent entry per unique URL (OOM vector on the middleware meant to absorb attacks). Query stripped from the key, Map capped at `SECURITY_ADAPTIVE_RATE_LIMIT_MAX_KEYS` (20k) with expired-first sweep + oldest-insert eviction (mirrors `chatQuotaService`).
- **Bounded in-process caches** — `catalogService.productIdentifierCache` (cloned product docs × alias keys) and the public response cache's memory provider (one body per unique URL) get entry caps + the same sweep pattern (`CATALOG_IDENTIFIER_CACHE_MAX_KEYS`, `CACHE_MEMORY_MAX_ENTRIES`).
- **Prometheus cardinality** — unrouted requests (404 probes, pre-routing aborts) no longer become raw-path label series on six high-frequency metrics; fixed `unmatched` label.
- **`rawBody` scoping** — the global JSON parser captured every body's raw string (uploads/listings/ai up to 10 MB, held twice). Only webhook signature verification consumes it; capture is now scoped to payment/status/email webhooks + auth/otp.
- **Crash on `unhandledRejection`** — was logged-and-swallowed, letting a failed background worker serve with half-mutated state; now exits after a log-flush delay (Node 15+ default restored).
- **Gmail SMTP timeouts** — nodemailer's unbounded socket defaults let one wedged connection hold the claimed order-email slot for the full 5-minute stale-lock window; 15s/15s/20s pinned.

### Multi-instance correctness

- **Status-email outbox atomic claim** — was find-then-save; `api` + `worker` replicas both poll the outbox, so both sent the same downtime/maintenance email. Now `findOneAndUpdate` claim with lock fields, ownership-filtered release, stale-lock reclaim — mirroring the order-email worker.
- **Admin alert dedupe** — monitors race on findOne-then-create with random ids; `notificationId` is now deterministic (actionKey + dedupe window) so the unique index decides the winner. DB-backed race test.
- **Fallback observability** — Redis-outage in-memory limiter fallback (effective limit × replicas) is now a counter: `aura_rate_limit_fallback_total{limiter}`.
- **Atlas search probe recovery** — a failed probe latched the process into regex full-scan fallback until restart; failed probes now retry every 5 minutes.

### Money correctness (DB audit risk #1)

- `User.lifetimeSpentMinor` (integer paise) is the authoritative gross lifetime-spend accumulator: atomically incremented from `quote.pricing` minor units inside placement, dashboard reads prefer minor/100 with float fallback, `backfill-lifetime-spent.js` sums `totalPriceMinor` (run the money minor-units backfill first). Legacy float major still incremented until all readers migrate.

### Operations / infra

- **Production Mongo backups** (DB audit risk #9) — previously *nothing existed*. `production-db-backup.yml` runs daily 21:13 UTC + manual dispatch: SSM dispatch of `scripts/production/backup-production-mongo.sh` (hot `mongodump --archive --gzip --oplog` at host level, SHA-256 checksums, manifest, local cleanup), S3 upload, bucket versioning + merged lifecycle expiry (default 35 days), and object verification. Requires repo variables `AURA_BACKUP_BUCKET` (and optionally `AURA_BACKUP_RETENTION_DAYS`).
- **Docker log rotation** — EC2 compose stacks had no logging config on a 20 GB root volume (disk-fill outage waiting to happen); 10m × 5-file pinned per service + `daemon.json` defaults in bootstrap.
- **Migration runner** (DB audit risk #5) — `SchemaMigration` ledger + singleton lock with stale reclaim + append-only registry + `npm run migrate:run` / `migrate:status`. Registry starts empty; the nine one-off scripts stay documented legacy. Operator-invoked only; CI never runs migrations.
- **Uptime probe** — scheduled external probe of `/api/health/live` via `AURA_UPTIME_BACKEND_URL` var (no-op skip while unset); zero-cost downtime signal.

### Docs

- `docs/system-design-audit-2026-09-08.md` — full findings, fixes, corrected stale findings, residual risks.
- `docs/database-audit-2026-09-07.md` risks #1/#5/#9 updated; DR runbook documents the new backup mechanism + tightened remaining work.

### Investigated, deliberately unchanged

- "SPA deep links break on CloudFront" — stale: the bootstrap already attaches a viewer-request SPA rewrite function.
- "Uploads default to local disk in prod" — stale: `bootstrap-instance-user-data.sh` sets `UPLOAD_STORAGE_DRIVER=s3`.
- "Capacitor allowNavigation overly broad" — every host maps to a configured Firebase Auth provider; narrowing risks unverifiable mobile OAuth breakage.

## Verification matrix

| Area | Check | Status |
|---|---|---|
| New/updated suites (13 files touched) | Focused `--runTestsByPath` runs | pass |
| Tier manifest | `node scripts/check-test-tiers.cjs` | OK — 442 suites, 182 tiered, 42 workflows drift-free |
| Full backend regression tier | `run-test-tier.cjs server regression --runInBand` (CI parity) | see CI |
| Frontend | No `app/` code changes; capacitor config untouched | n/a |
| Infra scripts | YAML parse + `bash -n` only — **not executed against AWS** | structural |

## Risks / follow-ups

- Infra changes are written-but-unverified-live: first scheduled backup run + restore drill against the uploaded archive are the acceptance steps (DR runbook "Remaining Work").
- `unhandledRejection` crash policy could surface pre-existing swallowed background failures — that is the intent, but watch the first deploys.
- Backups are hot oplog snapshots (no write quiesce on prod); cross-collection application consistency differs from the quiesced approach used in lower environments — documented.
- `AURA_BACKUP_BUCKET` / `AURA_UPTIME_BACKEND_URL` repo variables must be set to activate the new automation.
