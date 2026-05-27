# DevOps Readiness Inventory

## Current Architecture

- Root workspace: Node/npm orchestrator for frontend, backend, desktop, mobile, security, staging, and release workflows.
- Frontend: React 19 and Vite under `app/`, with Vitest, Playwright, Capacitor, and Vercel/Netlify routing contracts.
- Backend: Node.js CommonJS Express API under `server/`, with MongoDB via Mongoose, Redis, Socket.IO, Prometheus metrics, and health routes.
- Desktop: Electron shell under `desktop/`.
- Infrastructure: existing AWS, staging, edge security, performance, and observability scripts under `infra/`.
- Deployment surfaces: GitHub Actions, Vercel, Netlify, AWS scripts, Docker Compose, and now Kubernetes/Helm/GitOps/OpenTofu validation assets.

## Package Managers And Manifests

- Root: `package.json`, `package-lock.json`.
- Frontend: `app/package.json`, `app/package-lock.json`.
- Backend: `server/package.json`, `server/package-lock.json`.
- No pnpm, yarn, Python, Maven, Gradle, Go, or Rust manifests are required for the primary app runtime.

## Current Build, Test, And Lint Commands

- Install: `npm install` or `npm ci`.
- Root regression tracer: `npm test`.
- Root lint: `npm run lint`.
- Root typecheck alias: `npm run typecheck`.
- Frontend build: `npm run build` or `npm --prefix app run build`.
- Frontend tests: `npm --prefix app test`.
- Backend tests: `npm --prefix server test`.
- Health contract tests: `npm --prefix server test -- --runTestsByPath tests/healthRoutes.test.js tests/healthReadinessService.test.js`.
- Environment validation: `npm run env:validate`, `npm run env:validate:staging`, `npm run env:validate:production`.
- DevOps validation: `make devops-check` when local tools are installed.

## Existing Health And Readiness

- Public health: `GET /health`.
- Liveness: `GET /health/live`.
- Token-gated production readiness: `GET /health/ready`.
- API dependency health: `GET /api/health` and `GET /api/health/deep`.
- Kubernetes readiness uses `/api/health` by default because `/health/ready` is intentionally protected by `HEALTH_READY_TOKEN` in production.

## Docker Support

- Existing: `server/Dockerfile`, root `.dockerignore`, and Docker Compose files.
- Added: root `Dockerfile` for `docker build .`, non-root runtime, healthcheck, and reproducible `npm ci`.
- Added: Compose healthchecks, local bridge network, and named volumes for local-only state.
- Added scripts: `docker:build`, `docker:run`, `docker:compose:up`, `docker:compose:down`.

## CI/CD

- Existing CI already covers app/backend checks, health tests, security gates, and staging workflows.
- Added DevOps validation in CI for environment examples, observability assets, Kustomize, Helm, kubeconform, and OpenTofu fmt/validate.
- Added Docker workflow for image build, Compose config, and container liveness smoke.
- Staging smoke now skips only when `STAGING_HEALTH_URL` is unset and fails closed if staging points at production.

## Infrastructure And GitOps

- Existing AWS scripts support staging bootstrap and production deployment guardrails.
- Added OpenTofu validation-first AWS-compatible examples under `infra/opentofu`.
- Added Kubernetes manifests under `k8s/base`.
- Added Helm chart under `charts/app`.
- Added Argo CD application manifests under `gitops/argocd`.

## Observability

- Existing Prometheus/Grafana assets live under `infra/observability` for login/security.
- Added top-level `observability/` starter assets for Prometheus, Grafana, Loki, Promtail, and OpenTelemetry Collector.
- Added optional Node OpenTelemetry bootstrap at `server/observability/otel.js`.
- Existing structured request logs include request ids. Trace id correlation is documented for OTEL-enabled runtimes.

## Risks And Blockers

- Real Kubernetes clusters, Argo CD, DNS, TLS, and cloud credentials are not stored in Git and remain manual setup steps.
- Production files are example-only until real production configuration exists outside Git.
- HPA requires metrics-server and valid CPU/memory requests. Both are documented and included.
- NetworkPolicy defaults allow common outbound dependency ports for compatibility. Tighten CIDRs after target infrastructure is known.
- `/health/ready` remains token-gated in production; Kubernetes defaults to `/api/health`.
- CI can validate OpenTofu syntax but must not run `apply`.

## Gap Inventory

- Missing health checks before this change: `/health` did not consistently expose service name, version, and environment metadata. Added metadata while preserving dependency checks.
- Missing env vars before this change: no complete development/staging/production example set for the required DevOps variables. Added example env files and strict validation.
- Missing Docker support before this change: `docker build .` had no root Dockerfile and Compose lacked service healthchecks. Added both.
- Missing CI checks before this change: OpenTofu, Helm, Kustomize, kubeconform, Docker image smoke, and expanded env validation were not wired as first-class checks. Added validation workflows.
- Missing deployment infra before this change: Kubernetes base manifests, Helm chart, Argo CD applications, and OpenTofu examples were absent. Added validation-first assets.
- Missing observability before this change: top-level OTEL, Prometheus, Grafana, and Loki starter configs were absent. Added vendor-neutral examples and optional Node bootstrap.
