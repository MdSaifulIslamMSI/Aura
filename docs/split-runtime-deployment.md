# Split Runtime Deployment

## Target Topology
- `app/` stays static and can be served by Vercel.
- `server/` is deployed as two long-lived Node processes that share MongoDB and Redis:
  - API process for HTTP, sockets, uploads, and health endpoints
  - Worker process for payment capture, order email, catalog sync, reconciliation, and maintenance jobs
- The shared backend runtime requires:
  - MongoDB replica set connectivity
  - Redis enabled and required
- The repo includes an AWS EC2 + S3 + Parameter Store deployment path under [`docs/aws-backend-deployment.md`](./aws-backend-deployment.md) and the scripts in [`infra/aws`](../infra/aws).

## Local Bootstrap
1. `cd server`
2. `npm run runtime:split:up`
3. Confirm:
   - `GET http://127.0.0.1:5000/health`
   - `GET http://127.0.0.1:5000/health/ready`

The compose stack lives in [`docker-compose.split-runtime.yml`](../docker-compose.split-runtime.yml) and provisions:
- a single-node Mongo replica set
- Redis
- the long-lived backend API container

## Environment Rules
- `SPLIT_RUNTIME_ENABLED=true`
- `REDIS_ENABLED=true`
- `REDIS_REQUIRED=true`
- `DISTRIBUTED_SECURITY_CONTROLS_ENABLED=true`
- `MONGO_URI` must point at a replica-set-capable Mongo deployment

The legacy `server/` Vercel serverless adapter has been removed. Production should always point at the long-lived backend service instead of a serverless fallback.

## Redis Requirement for Security Rate Limits
Production auth/OTP/abuse limiters are fail-closed and require Redis. Do not deploy production with `REDIS_ENABLED=false` when distributed security controls are enabled. Startup config validation will reject this configuration.


## Staging Validation
- Public-only smoke:
  - `cd server`
  - `SMOKE_BASE_URL=https://your-backend.example.com SMOKE_FLOW_MODE=public npm run smoke:staging`
- Full authenticated smoke:
  - `SMOKE_BASE_URL=https://your-backend.example.com`
  - `SMOKE_FLOW_MODE=full`
  - `SMOKE_USER_BEARER_TOKEN=...`
  - `SMOKE_USER_EMAIL=...`
  - `SMOKE_ADMIN_BEARER_TOKEN=...`
  - `npm run smoke:staging`
- Load validation:
  - `LOAD_BASE_URL=https://your-backend.example.com`
  - `LOAD_MODE=public|customer|full`
  - `LOAD_ITERATIONS=20`
  - `LOAD_CONCURRENCY=4`
  - `npm run load:validate`

## Performance Budgets
Budgets are machine-readable in [`performance-budgets.json`](./performance-budgets.json) and currently cover:
- browse/search latency
- checkout quote/create latency
- reconciliation and queue backlog ceilings
- bundle size limits
- mobile initial payload budget
