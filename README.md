# Aura Marketplace Engineering Guide

## Overview
This repository contains:
- `app/`: React + Vite frontend
- `server/`: Express + MongoDB backend

Core capabilities:
- Firebase-authenticated user flows
- Checkout, orders, payment intents, capture/refunds
- OTP verification with fail-closed email delivery
- Durable order email queue with retry and admin APIs
- Split-runtime backend support with Redis-backed workers and reconciliation
- Market-aware browse FX with real-time provider support plus ECB fallback

## Live Links
- General gateway: [https://aura-gateway.vercel.app](https://aura-gateway.vercel.app)
- Legacy launch route: [https://aurapilot.vercel.app/launch](https://aurapilot.vercel.app/launch)
- Vercel frontend: [https://aurapilot.vercel.app](https://aurapilot.vercel.app)
- Netlify frontend: [https://aurapilot.netlify.app](https://aurapilot.netlify.app)
- Netlify note: production builds now target the same proxied backend routes through `/api`, `/health`, `/socket.io`, and `/uploads`.

## Run Locally
1. Backend:
   - `cd server`
   - Copy `.env.example` to `.env` and fill secrets
   - `npm install`
   - `npm start`
2. Frontend:
   - `cd app`
   - Copy `.env.example` to `.env`
   - `npm install`
   - `npm run dev`

## Local Dev Toggle
- Start the local database stack: `npm run dev:on`
- Stop it and leave it on Manual startup: `npm run dev:off`
- If MySQL hangs during shutdown, use `npm run dev:off:force`
- These scripts manage `MongoDB`, `MySQL80`, and `MySQL84`, and they self-elevate when Windows needs admin rights.

## Split Runtime
- Production backend is now intended to run as a long-lived Node service, not Vercel serverless.
- Frontend can remain static/Vercel; backend should run with Mongo replica set support and Redis enabled.
- The default hosted split-runtime target in this repo is now `Vercel frontend + AWS EC2 backend`.
- Local split-runtime bootstrap:
  - `cd server`
  - `npm run runtime:split:up`
- Deployment details and validation commands:
  - [`docs/split-runtime-deployment.md`](docs/split-runtime-deployment.md)
  - [`docs/aws-backend-deployment.md`](docs/aws-backend-deployment.md)
  - [`docs/performance-budgets.json`](docs/performance-budgets.json)

## AWS Runtime Automation
- Canonical AWS deploy scripts now live in:
  - [`infra/aws/bootstrap-free-tier.ps1`](infra/aws/bootstrap-free-tier.ps1)
  - [`infra/aws/bootstrap-github-oidc.ps1`](infra/aws/bootstrap-github-oidc.ps1)
  - [`infra/aws/sync-parameter-store-env.ps1`](infra/aws/sync-parameter-store-env.ps1)
  - [`infra/aws/docker-compose.ec2.yml`](infra/aws/docker-compose.ec2.yml)
- Local env to AWS Parameter Store sync:
  - `cd server && npm run aws:ssm:sync`
- Repo-level shortcut for the same sync:
  - `npm run aws:ssm:sync`
- CI/CD now builds the backend image once, uploads the release bundle to S3, and rolls EC2 forward through SSM Run Command.
- Frontend routing now prefers `AURA_BACKEND_ORIGIN` or `AWS_BACKEND_BASE_URL` in Vercel, and falls back to the tracked hosted backend origin instead of localhost so hosted deploys do not fail closed.

## Frontend CI/CD
- GitHub Actions now deploys the frontend to both Netlify and Vercel through [`deploy-netlify.yml`](.github/workflows/deploy-netlify.yml).
- The workflow builds `app/dist` once, uploads that artifact to Netlify, and prepares a Vercel-compatible artifact bundle from the same built files so both domains publish the same frontend release inputs.
- Required GitHub setup:
  - Repository secret: `NETLIFY_AUTH_TOKEN`
  - Repository variable or secret: `NETLIFY_SITE_ID`
  - Optional repository variable: `NETLIFY_SITE_NAME`
  - Repository secret: `VERCEL_TOKEN`
  - Repository variable or secret: `VERCEL_ORG_ID`
  - Repository variable or secret: `VERCEL_PROJECT_ID`
  - Optional repository variable: `VERCEL_PROJECT_NAME`
- Pull requests targeting `main` publish preview deploys to both Netlify and Vercel.
- Pushes to `main` publish production deploys to both Netlify and Vercel from the same frontend release flow.
- If Netlify Git auto-publishing is still enabled for the same site, disable it in the Netlify UI to avoid duplicate deploys from both Netlify and GitHub Actions.
- If Vercel Git auto-deploy is still enabled for the same project, disconnect or disable it once the GitHub Actions path is verified so the shared-artifact workflow remains the single production release source.

## Production Catalog + Search Gates
- Snapshot imports now require both `sourceRef` and `manifestRef`.
- Validate a licensed provider snapshot before import:
  - `cd server`
  - `npm run catalog:validate-snapshot`
- Prepare a strict Kaggle-backed snapshot with unique products only:
  - `cd server`
  - `npm run catalog:kaggle:prepare -- --dataset owner/dataset`
- Import a strict Kaggle-backed snapshot into Mongo:
  - `cd server`
  - `npm run catalog:kaggle:import -- --dataset owner/dataset`
- Kaggle imports are strict by design: rows missing brand, category, price, description, or a usable real image are skipped, and duplicate title/image/product identities are removed before import.
- Generate a local 100k synthetic demo catalog snapshot:
  - `cd server`
  - `npm run catalog:generate-demo-100k`
- Import and activate that demo catalog for non-production only:
  - `cd server`
  - `npm run catalog:seed-demo-100k`
- The demo catalog is synthetic inventory for local/staging demos. It is intentionally marked `dev_only` and must not be presented as genuine production merchandise.
- Remove all demo catalog rows from the real database:
  - `cd server`
  - `npm run catalog:purge-demo`
- Generate the seeded prelaunch relevance report:
  - `cd server`
  - `npm run search:report`
- Latest seeded search report is written to [`docs/reports/search-relevance.latest.json`](docs/reports/search-relevance.latest.json) after a successful run.

## Staging Validation
- Bootstrap dedicated Firebase + backend smoke identities:
  - `cd server`
  - `npm run smoke:bootstrap-accounts`
- Authenticated smoke and load scripts can use Firebase email/password credentials at runtime instead of static bearer tokens.
- Full smoke mode now exercises auth sync/session, COD order flow, digital payment intent flow, refund/replacement handling, and admin ops gates.

## Security Implementation ✅ COMPLETE

### March 2026 Security Hardening
All 10 identified login architecture vulnerabilities have been fixed and are production-ready:

**Critical Fixes**:
- ✅ **Hardcoded secrets** → Now parameterized via environment variables
- ✅ **Weak password policy** → Enforced: 12+ chars + uppercase + lowercase + digit + special character
- ✅ **CSRF vulnerability** → Token-based middleware (server + frontend integration)
- ✅ **OTP race conditions** → Atomic database operations

**Quick Start**:
- Deploy guide: [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md)
- Secrets management: [`DEPLOYMENT_SECRETS.md`](DEPLOYMENT_SECRETS.md)
- Technical details: [`SECURITY_FIXES.md`](SECURITY_FIXES.md)
- Quick reference: [`SECURITY_QUICK_REFERENCE.md`](SECURITY_QUICK_REFERENCE.md)
- Test suite: [`server/tests/security.integration.test.js`](server/tests/security.integration.test.js)

**New Security Modules**:
- `server/middleware/csrfMiddleware.js` - CSRF token generation & validation
- `server/utils/passwordValidator.js` - Password policy enforcement
- `app/src/services/csrfTokenManager.js` - Frontend CSRF token lifecycle
- `server/services/trustedDeviceChallengeService.js` - Session-bound trusted-device challenge + verification
- `app/src/services/deviceTrustClient.js` - Browser-held signing key + trusted-device session token handling

## Trusted Device Gate
- The legacy "LWE" challenge path has been removed.
- Privileged device verification now uses a real browser-held `RSA-PSS` signing key stored locally in IndexedDB.
- Successful verification returns a session-bound trusted-device token which is enforced on privileged server routes.
- Architecture notes and the postmortem live in [`docs/trusted-device-architecture.md`](docs/trusted-device-architecture.md).

---

## Security Model (High Level)
- All private/admin APIs require Firebase bearer token (`Authorization: Bearer ...`)
- Admin routes require backend `admin` middleware check
- Checkout totals are server-authoritative
- OTP routes are fail-closed when email delivery fails
- Login OTP requires fresh password credential proof token (`OTP_LOGIN_REQUIRE_CREDENTIAL_PROOF=true`)
- Login identity snapshots are mirrored to local auth vault for wipe-recovery (`AUTH_VAULT_ENABLED=true`, `AUTH_VAULT_SECRET` required outside tests, optional rotation via `AUTH_VAULT_SECRET_VERSION` + `AUTH_VAULT_PREVIOUS_SECRETS`)
- Chat is split into:
  - `POST /api/chat/public` (no paid LLM providers)
  - `POST /api/chat` (authenticated, quota-limited)
- **NEW**: CSRF protection on all state-changing auth endpoints (POST/PUT/DELETE)
- **NEW**: Enhanced password validation (12+ chars + complexity requirements)
- **NEW**: Atomic OTP operations (no race conditions)

## Critical Invariants
- Client cannot elevate privilege through profile update payload
- OTP expiry must never delete user documents
- Digital order placement requires valid authorized/captured payment intent
- Authorized payment capture task is transaction-coupled with order commit
- Webhook and idempotent mutation paths are replay-safe

## Operational Endpoints
- `GET /health`: app/db/queue status snapshot
- `GET /health/ready`: readiness gate for orchestrators

## Maintenance Notes
- Run `npm test` in `server/` and `app/` before merging
- Run `npm test -- security.integration.test.js` in `server/` to validate all security fixes
- Run `npm run build:budget` in `app/` before merging frontend bundle-heavy changes
- Run `npm run smoke:staging` and `npm run load:validate` in `server/` against staging before backend rollout
- Run `npm run search:report` in `server/` before promoting catalog/search tuning
- Before production deployment:
  - Set all environment variables (see [`DEPLOYMENT_SECRETS.md`](DEPLOYMENT_SECRETS.md)); ensure `AUTH_VAULT_SECRET` is set to a strong 32+ char value in production
  - Verify CSRF tokens are working (check `/api/auth/session` response headers)
  - Verify password policy enforced (reject passwords < 12 chars)
  - Verify admin middleware blocks non-admin access to admin routes
- Keep `.env` secrets out of source control
- For legacy OTP TTL cleanup, run:
  - `npm run migrate:drop-user-otp-ttl` (in `server/`)

## FX Rate Providers
- The backend now supports `PAYMENT_FX_PROVIDER=auto|openexchangerates|ecb`.
- `auto` prefers Open Exchange Rates when `OPEN_EXCHANGE_RATES_APP_ID` is configured and falls back to ECB reference rates if the real-time provider is unavailable.
- `PAYMENT_FX_RATES_TTL_MS` overrides the backend FX cache TTL. Leave it blank to use provider-aware defaults.
- The production FX pipeline is scheduler-driven: `node-cron` refreshes rates every hour, stores the last successful snapshot in MongoDB, and serves all client reads from cache instead of from the provider.
- Hourly refreshes retry up to 3 times, respect `PAYMENT_FX_MAX_CALLS_PER_DAY`, and fall back to the last successful snapshot when the upstream provider is unavailable.
- Run a one-shot refresh manually with `cd server && npm run fx:refresh`.
- Use the protected internal endpoint `GET /api/internal/cron/fx-rates` with `Authorization: Bearer $CRON_SECRET` when wiring Vercel Cron, GCP Scheduler, or another external scheduler.
- Full setup and deployment notes live in [`docs/fx-rate-pipeline.md`](docs/fx-rate-pipeline.md).
