# Backend Reliability Inventory

Branch: `codex/backend-sre-low-latency-hardening`

Baseline date: 2026-07-05

Production touched: NO

## Draft PR Summary

What changed:

- Added shared backend timeout and retry helpers with safe timeout errors, capped attempts, jittered backoff, and non-idempotent retry protection.
- Updated payment provider retry backoff to use jitter while preserving the existing rule that mutations are not retried without idempotency protection.
- Added focused reliability tests for timeout, retry, jitter, and payment-provider retry posture.
- Added read-only SRE staging gates for synthetic health/frontend/socket checks and backend latency probes.
- Added CI jobs for `test:reliability`, `sre:synthetic:staging`, and `sre:latency:staging`.
- Updated `github:main-protection` to require the new SRE checks.
- Added SRE inventories, latency budgets, query-safety notes, logging/redaction guidance, and incident/rollback runbooks.

Latency budget:

- Health p95 under 250ms.
- Normal API p95 under 800ms.
- Normal API p99 under 2000ms.
- Auth/security-sensitive API p95 under 1000ms.
- Hard request timeout target 10s to 15s unless explicitly exempted.
- DB operation timeout target 2s to 5s.
- Redis/cache timeout target under 500ms.
- External provider timeout target 3s to 8s.
- Frontend first API response under 1s from staging when warm.

Reliability gates:

- Existing gates retained: staging smoke, frontend staging smoke, env contract, AWS cost guard, AWS observability guard, rollback readiness, security, and tests.
- New gates added: `test:reliability`, `sre:synthetic:staging`, and `sre:latency:staging`.

Tests run:

- `npm ci` - passed.
- `npm --prefix server ci` - passed.
- `npm run test:reliability` - passed, 2 suites / 8 tests.
- `npm run scan:prod-fallbacks` - passed.
- `npm run security:secrets` - passed across 2330 files.
- `npm test` - passed, 33 suites / 379 tests.
- `git diff --check` - passed.
- `node --check scripts/sre/synthetic-staging-check.mjs` - passed.
- `node --check scripts/sre/backend-latency-probe.mjs` - passed.

Staging result:

- `npm run smoke:staging` failed closed locally because required staging/prod smoke env vars are unavailable.
- `npm run smoke:staging:frontend` failed closed locally because staging frontend/API env vars are unavailable.
- `npm run smoke:env-contract` failed closed locally because staging contract env vars are unavailable.
- `npm run sre:synthetic:staging` failed closed locally because staging frontend/API/health URLs are unavailable.
- `npm run sre:latency:staging` failed closed locally because `STAGING_API_BASE_URL` and `SMOKE_TARGET_ENV=staging` are unavailable.

Cost/observability status:

- `npm run aws:cost-guard` failed closed locally because AWS credentials are unavailable.
- `npm run aws:observability:guard` failed closed locally because AWS credentials are unavailable.
- Remote PR #302 evidence showed these checks green after PR #302 was merged, but this branch still requires its own CI proof.

Rollback status:

- `npm run release:rollback-ready` failed closed locally because rollback target artifact evidence and production health URL env are unavailable.

Merge blockers:

- Main branch protection must be updated to require `sre:synthetic:staging`, `sre:latency:staging`, and `test:reliability`.
- Staging smoke, SRE synthetic, SRE latency, AWS cost, AWS observability, rollback readiness, security, and test checks must be green on the draft PR before marking ready.

## Phase 0 Baseline

Read-only commands run from the clean SRE worktree:

- `git status --short --branch`: clean branch on `codex/backend-sre-low-latency-hardening...origin/main`.
- `gh pr status`: PR #301 is merged; several Dependabot PRs are open.
- `gh pr checks 302`: remote PR #302 checks were observed green, including `aws:cost-guard`, `aws:observability:guard`, `smoke:staging`, `smoke:staging:frontend`, `smoke:env-contract`, and `release:rollback-ready`.
- `npm run staging:state:check`: failed closed locally because AWS credentials were unavailable.
- `npm run smoke:staging`: failed closed locally because required staging/prod smoke env vars were unavailable.
- `npm run smoke:staging:frontend`: failed closed locally because `STAGING_FRONTEND_URL` and `STAGING_API_BASE_URL` were unavailable.
- `npm run smoke:env-contract`: failed closed locally because staging contract env vars were unavailable.
- `npm run aws:cost-guard`: failed closed locally because AWS credentials were unavailable.
- `npm run aws:observability:guard`: failed closed locally because AWS credentials were unavailable.
- `npm run release:rollback-ready`: failed closed locally because rollback artifact evidence and production health URL env were unavailable.
- `npm run security:secrets`: passed across 2315 files.
- `npm run github:main-protection`: passed before this branch added new required SRE gates.
- `npm test`: could not run in this new worktree before dependency install; `cross-env` was not present.

Known release blockers for this branch are environment or repository policy blockers unless proven otherwise:

- Local AWS read-only inventory cannot run without credentials.
- Local staging smoke cannot run without staging contract env.
- Local rollback readiness cannot run without rollback artifact/health evidence.
- Main protection must be updated to require the new SRE checks added by this branch.

## Backend Entrypoint

- Main API entrypoint: `server/index.js`.
- Express application with `http.createServer(app)`.
- Socket.IO is initialized against the same HTTP server.
- Runtime loads local env files through `server/config/runtimeConfig.js`.
- Production startup asserts security, payment, email, Redis, auth, CORS, invisible-fabric, and signing-secret contracts before binding.

## Health Endpoints

Liveness and readiness surfaces currently present:

- `GET /health/live`: cheap process liveness, registered before the heavy middleware stack.
- `GET /health`: cached public/detailed health snapshot with `Cache-Control: no-store`.
- `GET /health/ready`: readiness gate protected by readiness access policy and rate limit.
- `GET /api/health`: dependency health from `server/routes/healthRoutes.js`.
- `GET /api/health/live`: cheap process liveness.
- `GET /api/health/ready`: DB/Redis readiness.
- `GET /api/health/deep`: DB, Redis, email, payments, AI, and uploads dependency view.
- `GET /api/health/db`, `/redis`, `/email`, `/payments`, `/ai`, `/uploads`: component health.

No `/api/ready` route was found; current readiness is `/health/ready` and `/api/health/ready`.

## Timeout Behavior

Request-level controls:

- `server/middleware/requestTimeout.js` applies a default `REQUEST_TIMEOUT_MS` of 30000ms, excluding health, metrics, observability, and uploads.
- `server/middleware/requestTimeouts.js` applies traffic-budget-specific timeouts.
- `server/config/trafficBudgets.js` defines class budgets, including health 1500ms, public search 4500ms, auth/OTP 7000ms, authenticated writes/admin 10000ms, payments 12000ms, OTP reset 15000ms, uploads 20000ms, and AI expensive 25000ms.

Dependency controls:

- Mongo connection options set server selection, socket, pool, idle, connection, wait queue, and write concern timeouts in `server/config/db.js`.
- Redis connection timeout defaults to 3000ms in `server/config/redis.js`.
- Payment provider calls use timeout/retry/circuit behavior in `server/services/payments/foundation/providerContract.js`.
- AI providers and status monitors have per-provider timeout handling.
- New shared utilities in `server/utils/timeout.js` and `server/utils/retry.js` provide safe timeout errors and jittered retries for future dependency work.

## Rate Limits And Overload

- Global rate limit uses `createDistributedRateLimit`.
- Production security-critical distributed rate limit dependencies fail closed.
- Route-specific traffic budgets provide per-IP, per-account, and per-session limits.
- Auth, OTP, admin, uploads, payments, search, and AI routes have distinct route classes.
- `server/middleware/loadShedding.js` sheds degradable routes during active request or event loop lag overload.
- `server/middleware/bodySizeGuards.js` rejects oversized payloads before route handlers.

## Cache And Network Efficiency

- `compression()` is enabled globally.
- `cachePolicy()` sets `no-store` for private/auth/payment/admin/upload/AI/health classes.
- Static asset cache policy is `public, max-age=31536000, immutable` when the performance stack is enabled.
- Public status/product routes can receive short public cache headers when safe.
- CORS is allowlist based and exposes only `X-CSRF-Token`, `X-Request-Id`, `X-Cache`, and `Server-Timing`.
- Socket.IO max HTTP buffer size is bounded.

## Error Handling

- `server/middleware/errorMiddleware.js` returns safe public envelopes with `requestId`.
- Production 500s hide stacks unless minimized invisible-fabric responses apply.
- Payload-too-large and JSON syntax errors get explicit safe responses.
- Errors are logged as structured JSON through the redacting logger.

## Logging Fields

Request logs include:

- `method`
- `url`
- `status`
- `durationMs`
- `requestId`
- `clientSessionId`
- `clientRoute`
- `ip`

The logger redacts tokens, passwords, OTPs, cookies, authorization values, private keys, URLs with query strings, and selected identifiers.

## Database Query Safety

Current controls include:

- Global query budget guard for unsafe page sizes and search length.
- Many list endpoints clamp limits between route-specific minimums and maximums.
- Catalog hot paths use `maxTimeMS`.
- Mongo connection has bounded wait queue and server selection timeouts.

Remaining work should focus on adding `maxTimeMS` and indexed-sort evidence for hot endpoints as they are touched, not broad rewrites.

## Deployment And Rollback

Release discipline from PR #302 is present in `.github/workflows/giant-release-gates.yml`:

- staging smoke
- frontend staging smoke
- environment contract
- AWS cost guard
- AWS observability guard
- rollback readiness
- security and tests

This branch adds:

- `test:reliability`
- `sre:synthetic:staging`
- `sre:latency:staging`

Rollback path:

- `docs/runbooks/aws-production-rollback.md`
- `scripts/release/assert-rollback-ready.mjs`
- production rollback hook expected by the release gate
- rollback target artifact evidence required before merge

## Staging/Production Separation

- Staging SSM prefix must be `/aura/staging`.
- Production SSM prefix must be `/aura/prod`.
- Smoke scripts reject known production origins and production-like staging URLs.
- Health staging fingerprint must not claim production resources.
- New SRE probes inherit the same staging env discipline and fail closed on production-like staging targets.

## PR #302 Context

The mission said PR #302 was blocked by AWS cost guard, observability guard, and main protection. Current remote evidence from `gh pr checks 302` showed those checks green after PR #302 was merged into `origin/main`.

This branch does not bypass that history. It keeps those gates and adds stricter SRE gates. The current new blocker is that main branch protection must be updated to require the newly added SRE checks before this branch can be marked ready or merged.
