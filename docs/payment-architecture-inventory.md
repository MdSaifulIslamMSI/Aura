# Payment Architecture Inventory

Date: 2026-05-27  
Branch: `codex/payment-architecture-foundation`

## Phase 0 Discovery Snapshot

### Repository Shape

- Package manager: npm with root, `app/`, and `server/` package-lock files.
- Monorepo shape: single repository with root orchestration scripts plus separate frontend and backend packages.
- Root runtime: Electron/desktop orchestration and repository-wide scripts.
- Frontend: React 19, Vite 7, Vitest, Playwright, Tailwind, Capacitor shell under `app/`.
- Backend: Node.js, Express 5, CommonJS modules, Mongoose/MongoDB models under `server/`.
- Test frameworks: Jest for `server/`, Vitest for `app/`, Playwright E2E under `app/`.
- CI: GitHub Actions workflows in `.github/workflows/`.
- Deployment/config surfaces: Dockerfiles, docker-compose files, Netlify, Vercel, AWS, Kubernetes/Helm/OpenTofu-style infra files.
- Module format: backend CommonJS, frontend ESM/Vite.

### Discovered Package And Build Files

- `package.json`
- `package-lock.json`
- `app/package.json`
- `app/package-lock.json`
- `server/package.json`
- `server/package-lock.json`
- `Dockerfile`
- `server/Dockerfile`
- `docker-compose.yml`
- `docker-compose.status.yml`
- `docker-compose.split-runtime.yml`
- `docker-compose.observability.yml`
- `infra/observability/docker-compose.local.yml`
- `infra/observability/docker-compose.ec2.yml`
- `infra/staging/docker-compose.yml`
- `infra/aws/docker-compose.ec2.yml`
- `infra/performance/docker-compose.performance.yml`

### Environment Examples And Secret Surfaces

Environment examples found:

- `app/.env.example`
- `app/.env.production.example`
- `server/.env.example`
- `server/.env.aws-secrets.example`

Sensitive local-only surfaces already present and not to be edited without explicit approval:

- `.env.local`
- `app/.env`
- `app/.env.local`
- `server/.env*`
- `server/.env.aws-secrets`

### Existing Payment, Billing, Order, And Auth State

The repository already has a substantial payment implementation. The safe migration path is to add architecture contracts beside it first, then integrate behind flags after tests prove behavior.

Current payment runtime:

- Payment controllers and routes:
  - `server/controllers/paymentController.js`
  - `server/routes/paymentRoutes.js`
  - `server/routes/adminPaymentRoutes.js`
- Payment service layer:
  - `server/services/payments/paymentService.js`
  - `server/services/payments/paymentOperationsService.js`
  - `server/services/payments/providerFactory.js`
  - `server/services/payments/idempotencyService.js`
  - `server/services/payments/securityGuards.js`
  - `server/services/payments/refundState.js`
  - `server/services/payments/outboxState.js`
  - `server/services/payments/paymentRouter.js`
- Current providers:
  - `server/services/payments/providers/razorpayProvider.js`
  - `server/services/payments/providers/stripeProvider.js`
- Current persistence:
  - `server/models/PaymentIntent.js`
  - `server/models/PaymentMethod.js`
  - `server/models/PaymentEvent.js`
  - `server/models/PaymentOutboxTask.js`
  - `server/models/IdempotencyRecord.js`
  - `server/models/Order.js`
- Validation:
  - `server/validators/paymentValidators.js`
  - `server/validators/orderValidators.js`

Current payment behavior documented in `docs/payment-architecture.md`:

- Razorpay is the default active payment provider.
- Stripe card support exists as an optional provider.
- Payment methods include COD, UPI, card, wallet, and netbanking.
- Payment amount is calculated server-side through order quote/cart pricing flows.
- Idempotency support exists for mutating payment actions.
- Webhook routes use raw body handling and provider signature verification.
- Payment event and outbox models already exist.

Current billing state:

- No dedicated Lago/Kill Bill integration was found.
- Billing concepts are currently represented mostly through orders, payment intents, refunds, and frontend order/payment views.
- No dedicated invoice/subscription/usage-event persistence layer was found.

Current ledger state:

- Admin refund/payment views exist, including `app/src/pages/Admin/RefundLedger.jsx`.
- No Formance-compatible double-entry ledger service was found.
- Runtime payment/order models preserve legacy JavaScript number fields for backward compatibility and add integer minor-unit mirror fields for new Order and PaymentIntent writes. New ledger code should continue to treat integer minor units as canonical.

Current auth/security state:

- Backend auth middleware and risk services exist:
  - `server/middleware/authMiddleware.js`
  - `server/middleware/csrfMiddleware.js`
  - `server/services/authAssurancePolicyService.js`
  - `server/services/authRiskEngineService.js`
  - `server/services/authRiskSignalService.js`
- Auth tests are extensive under `server/tests/` and `tests/auth/`.
- Existing payment endpoints already require auth where appropriate and have webhook signature handling.
- Existing CSRF and CORS tests are present.

### Existing CI And Local Commands

Detected root commands:

- Install: `npm install`
- Root regression tracer: `npm test`
- Lint: `npm run lint`
- Typecheck placeholder: `npm run typecheck`
- Build: `npm run build`
- Secret scan: `npm run security:secrets`
- Doctor: `npm run ci:doctor`

Detected frontend commands:

- `npm --prefix app run dev`
- `npm --prefix app run build`
- `npm --prefix app test`
- `npm --prefix app run lint`
- `npm --prefix app run test:e2e`

Detected backend commands:

- `npm --prefix server test`
- `npm --prefix server test -- --runTestsByPath <test-file>`

### Baseline Check Record

Baseline checks are intentionally recorded separately from migration-caused failures.

Status: completed before payment foundation code was added.

Results:

- `npm install`: passed; dependencies were already up to date and npm reported 0 vulnerabilities.
- `npm run lint`: passed; delegates to `npm --prefix app run lint`.
- `npm run typecheck`: passed; currently delegates to `npm --prefix app run lint`, so this is not a `tsc` typecheck yet.
- `npm run security:secrets`: passed across 1644 repository files.
- `npm run build`: passed; frontend Vite build completed with the existing large chunk warning for `vendor-livekit`.
- `npm test`: initially hit a pre-existing local infrastructure failure. The root Jest regression suite started, but `mongodb-memory-server` could not start reliably on this Windows host, fallback MongoDB at `mongodb://127.0.0.1:27017/aura_test` was not reachable, and one pure CORS contract test failed during global DB setup. This was recorded as baseline/environmental, not migration-caused.

Representative baseline failure:

```text
In-memory Mongo unavailable (...); fallback DB connection failed (mongodb://127.0.0.1:27017/aura_test): connect ECONNREFUSED 127.0.0.1:27017.
Set TEST_MONGO_URI to a reachable test MongoDB, or fix mongodb-memory-server.
FATAL ERROR: NewSpace::EnsureCurrentCapacity Allocation failed - JavaScript heap out of memory
```

The local blocker was later removed with a surgical no-DB allowlist in `server/tests/setup.js` for pure contract tests that do not touch MongoDB. After that fix, `npm test` passed with 32 suites and 348 tests.

## Risk Areas

- Existing live payment behavior depends on Razorpay/Stripe provider contracts; replacing provider defaults would be risky.
- Webhook security depends on raw request body behavior in `server/index.js`; this must not be regressed.
- Payment and order models currently use Mongoose/MongoDB, while the target architecture mentions PostgreSQL. This foundation should add PostgreSQL-ready contracts/docs first, not replace storage in one step.
- Existing legacy decimal money fields remain in runtime models for API/data compatibility. New writes add integer minor-unit mirrors, but historical records still require a separate audited backfill before decimals can be deprecated.
- Auth, CSRF, CORS, refund, and order pricing behavior are security-sensitive and should only be integrated behind tests and flags.
- Existing CI/deployment workflows are broad. Payment CI must not require real Hyperswitch, Lago, Kill Bill, Formance, OpenBao, Kafka, Temporal, or production secrets.
- Docker profiles should be optional and config-valid without forcing local developers to run heavyweight infrastructure.

## Proposed Safe Implementation Plan

This first foundation increment will:

- Preserve existing Razorpay/Stripe runtime behavior.
- Add pure domain/state machine modules for payment, refund, invoice, and subscription states.
- Add provider contracts for Hyperswitch and a default-safe mock provider without enabling real money movement.
- Add billing provider contracts for Lago and Kill Bill plus a mock billing provider.
- Add a Formance-compatible internal double-entry ledger abstraction using integer minor units.
- Add Temporal-compatible workflow interfaces with local/mock durable execution primitives.
- Add local/Kafka event bus and outbox event contracts without requiring Kafka in local tests.
- Add env validation that fails closed for live mode while allowing mock/test mode.
- Add policy helpers compatible with Keycloak roles and OPA-style decisions.
- Add observability names/contracts for OpenTelemetry, Prometheus alerts, and Grafana dashboards.
- Add tests for the foundation modules without changing existing checkout behavior.
- Add docs and CI that validate the payment foundation using safe mock values.

## Exact Files Changed In This Increment

New docs:

- `docs/payment-architecture-inventory.md`
- `docs/payment-provider-contract.md`
- `docs/payment-local-dev.md`
- `docs/payment-env-vars.md`
- `docs/payment-security.md`
- `docs/payment-webhooks.md`
- `docs/ledger-model.md`
- `docs/billing-architecture.md`
- `docs/eventing-outbox.md`
- `docs/payment-auth-policy.md`
- `docs/payment-observability.md`
- `docs/payment-runbook.md`
- `docs/payment-production-readiness-checklist.md`
- `docs/secrets-management.md`

Updated docs:

- `docs/payment-architecture.md`

New backend foundation modules:

- `server/services/payments/foundation/domainErrors.js`
- `server/services/payments/foundation/stateMachines.js`
- `server/services/payments/foundation/providerContract.js`
- `server/services/payments/foundation/mockPaymentProvider.js`
- `server/services/payments/foundation/hyperswitchProvider.js`
- `server/services/payments/foundation/billingProvider.js`
- `server/services/payments/foundation/ledgerService.js`
- `server/services/payments/foundation/eventBus.js`
- `server/services/payments/foundation/workflows.js`
- `server/services/payments/foundation/paymentPolicy.js`
- `server/services/payments/foundation/observability.js`
- `server/services/payments/foundation/env.js`

New validation, schema contracts, and tests:

- `server/scripts/validate_payment_env.js`
- `server/tests/paymentArchitectureFoundation.test.js`
- `config/payment.example.env`
- `infra/payment/postgres/001_payment_foundation.sql`

New config/CI/observability files:

- `docker-compose.payment.yml`
- `.github/workflows/payment-architecture.yml`
- `observability/prometheus/payment-rules.yml`
- `observability/grafana/dashboards/payment-architecture.json`

Updated config files:

- `.gitignore`
- `package.json`
- `server/package.json`
- `observability/prometheus/prometheus.yml`

Files intentionally not changed in the first foundation increment unless tests require a tiny additive hook:

- `server/services/payments/paymentService.js`
- `server/controllers/paymentController.js`
- `server/routes/paymentRoutes.js`
- `server/index.js`
- `server/models/Order.js`
- `server/models/PaymentIntent.js`

## Acceptance Commands For This Increment

Minimum local acceptance:

- `npm run payment:env:validate`
- `npm run payment:test`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run security:secrets`
- `docker compose -f docker-compose.payment.yml config`

If Docker is unavailable locally, compose validation will be recorded as skipped with the exact reason.

Current foundation verification:

- `npm run payment:env:validate`: passed.
- `npm run payment:test`: passed; 10 focused no-DB tests.
- `npm run payment:smoke`: passed.
- `npm run payment:compose:config`: passed for no-profile and all optional-profile compose configs.
- `npm run security:secrets`: passed after adding payment docs/config.
- `npm run security:audit`: passed for root, app, and server production dependencies.
- `npm test`: passed after the no-DB test setup fix; 32 suites and 348 tests.
- `npm run lint`: passed.
- `npm run typecheck`: passed; still delegates to frontend lint.
- `npm run build`: passed with the existing Vite large chunk warning.
