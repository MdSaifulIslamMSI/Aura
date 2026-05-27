# Performance Inventory

Generated for `codex/extreme-performance-free-stack` from package files, route files, workflow files, and targeted repository searches.

## Runtime And Package Baseline

- Frontend framework: React 19 with Vite 7 in `app/package.json`; entry/config in `app/src/main.jsx`, `app/src/App.jsx`, and `app/vite.config.js`.
- Backend framework: Express 5 in `server/package.json`; primary app entrypoint is `server/index.js`.
- Desktop shell: Electron in root `package.json`, with `desktop/main.cjs` as the desktop entrypoint.
- Package manager: npm, evidenced by root `package-lock.json`, `app/package-lock.json`, and `server/package-lock.json`.
- Database client/ORM: Mongoose 9 over MongoDB, evidenced by `server/config/db.js`, `server/package.json`, and `server/models/*.js`.
- PostgreSQL: no application PostgreSQL client/ORM was found. PgBouncer can only be added as optional future infrastructure and must not replace the current MongoDB data path.

## Server Entrypoints

- API runtime: `server/scripts/start_api_runtime.js` starts `server/index.js`.
- Worker runtime: `server/scripts/start_worker_runtime.js` starts `server/workerProcess.js`.
- Main server export: `server/index.js` exports the Express `app` for tests.
- Docker runtime: `server/Dockerfile` builds the backend image and includes a `/health/live` healthcheck.

## Existing Performance Features

- Existing Redis support: `server/config/redis.js` wraps `redis` and is used by distributed rate limits, upload nonces, trusted device challenges, socket backplane, and security controls.
- Existing caching:
  - `server/services/healthService.js` has an in-process cached health snapshot with `HEALTH_SNAPSHOT_TTL_MS`.
  - Frontend/Vite already has manual chunk splitting in `app/vite.config.js`.
  - Staging frontend NGINX config caches immutable frontend assets in `infra/staging/frontend-container-nginx.conf`.
- Existing compression: `server/index.js` uses `compression()`.
- Existing CDN/static headers:
  - `infra/staging/frontend-container-nginx.conf` sets long-lived immutable caching for static frontend assets and `no-store` for HTML.
  - `infra/aws/bootstrap-frontend-cloudfront.ps1` contains CloudFront cache behavior setup for static/frontend/backend paths.
  - `app/netlify.toml` and `app/vercel.json` configure frontend hosting/proxy behavior.
- Existing health endpoints:
  - `GET /health/live`, `GET /health`, and `GET /health/ready` in `server/index.js`.
  - `GET /api/health/*` in `server/routes/healthRoutes.js`.
  - Worker health server in `server/workerProcess.js`.
- Existing request timeout protection: `server/middleware/requestTimeout.js`, mounted from `server/index.js`.
- Existing metrics: `server/middleware/metrics.js` and `server/routes/metricsRoute.js` expose Prometheus metrics at `/metrics` with production auth via `METRICS_SECRET` or `CRON_SECRET`.
- Existing observability/logging: structured JSON logger in `server/utils/logger.js`; Prometheus configs under `infra/observability/prometheus`; Grafana login-security dashboard under `infra/observability/grafana`.

## CI, Docker, And Infra

- CI workflows: `.github/workflows/ci.yml`, `security.yml`, `security-gates.yml`, `free-security-scanners.yml`, `production-cicd.yml`, deploy/rollback workflows for AWS, Netlify, Vercel gateway, desktop, mobile, staging, and status watch.
- Docker/compose files:
  - Root `docker-compose.yml`, `docker-compose.status.yml`, `docker-compose.split-runtime.yml`, and `docker-compose.observability.yml`.
  - Backend `server/Dockerfile`.
  - AWS/staging compose files in `infra/aws/docker-compose.ec2.yml` and `infra/staging/docker-compose.yml`.
  - Existing observability compose files in `infra/observability/docker-compose.local.yml` and `infra/observability/docker-compose.ec2.yml`.
- Staging/prod env examples:
  - `config/environments/staging.example.env`
  - `app/.env.example`
  - `app/.env.production.example`
  - `server/.env.example`
  - `server/.env.aws-secrets.example`
- Local env files exist and are sensitive: `.env.local`, `.student-pack.local.env`, `app/.env`, `app/.env.local`, `server/.env`, `server/.env.aws-secrets`. These were not edited.

## Existing Test And Security Scripts

- Root test: `npm test`, currently mapped to a server regression set.
- Root lint/typecheck/build: `npm run lint`, `npm run typecheck`, `npm run build`.
- Frontend: `npm --prefix app test`, `npm --prefix app run lint`, `npm --prefix app run test:e2e`, `npm --prefix app run build`.
- Backend: `npm --prefix server test`, plus many targeted `--runTestsByPath` commands through root scripts.
- Existing load tests: `tests/load/auth-login.k6.js` and auth load scripts under `tests/auth/load`.
- Existing security scans: root scripts for gitleaks, semgrep, trivy, ZAP, hadolint, IaC, dependency audits, origin protection, auth, headers, CORS/CSRF, webhooks, payments, and upload malware runtime checks.

## Slow-Risk Areas

- Heavy DB queries:
  - Catalog/product search and import logic in `server/services/catalogService.js`, `server/controllers/productController.js`, and catalog scripts.
  - Status page aggregate render paths in `server/services/statusService.js`.
  - Recommendation and assistant paths in `server/services/productRecommendationService.js`, `server/services/ai/*`, and `server/controllers/recommendationController.js`.
- Unpaginated or high-cardinality endpoints:
  - Public catalog/product listings under `server/routes/productRoutes.js`.
  - Status history/incidents under `server/routes/statusRoutes.js`.
  - Admin analytics/export routes under `server/routes/adminAnalyticsRoutes.js`; these are protected and must never be cached.
- Upload/download routes:
  - Upload APIs under `server/routes/uploadRoutes.js`.
  - Review media reads under `/uploads/reviews/*` and static `/uploads` in `server/index.js`.
  - Upload security services under `server/services/uploadSecurityPipeline.js`, `server/services/uploadSignatureService.js`, and `server/services/reviewMediaStorageService.js`.
- Image/static asset handling:
  - Frontend assets in `app/public/assets`.
  - Product image proxy and catalog artwork routes in `server/routes/productRoutes.js`.
  - Vite manual chunking in `app/vite.config.js`.
- SSR/API routes:
  - No SSR framework was found. API routes are Express routers under `server/routes`.
- Auth/session routes:
  - Auth and OTP routes under `server/routes/authRoutes.js` and `server/routes/otpRoutes.js`.
  - User/session/security services under `server/services/auth*`, `server/middleware/authMiddleware.js`, and `server/middleware/csrfMiddleware.js`.
  - These must bypass every cache layer.
- Payments:
  - Payment routes under `server/routes/paymentRoutes.js` and admin payment routes under `server/routes/adminPaymentRoutes.js`.
  - Payment providers/services under `server/services/payments/*`.
  - These must bypass every cache layer.
- Admin routes:
  - All `/api/admin/*` routers are protected and must bypass every cache layer.
- Third-party API calls:
  - AI gateways under `server/services/ai/*`.
  - Payment providers under `server/services/payments/providers/*`.
  - Email providers under `server/services/email/providers/*`.
  - Firebase/Auth integrations in auth-related services and frontend Firebase dependencies.

## Pre-Change Tracer

- Command: `npm --prefix server test -- --runTestsByPath tests/healthRoutes.test.js tests/metricsAuth.test.js --forceExit`
- Result: passed, 2 suites and 11 tests.
