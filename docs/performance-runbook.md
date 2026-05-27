# Performance Runbook

## Local Start

1. Copy values from `config/environments/performance.example.env` into your local non-secret env setup.
2. Start optional local services with Docker when needed:

```sh
docker compose -f infra/performance/docker-compose.performance.yml up redis nginx prometheus grafana jaeger otel-collector
```

3. Start the app through the existing project commands:

```sh
npm --prefix server start
npm --prefix app run dev
```

4. Run performance checks:

```sh
npm run perf:smoke
npm run perf:load
npm run perf:lighthouse
npm run perf:all
```

If a local app URL is not reachable, the smoke/load/Lighthouse wrappers skip optional live checks and exit 0. Unit tests still validate cache safety.

## Environment Variables

Use `config/environments/performance.example.env` as the source of truth for performance flags. Keep secrets in the platform secret manager, not in git.

Key rollout flags:

- `PERFORMANCE_STACK_ENABLED`
- `CACHE_ENABLED`
- `CACHE_PROVIDER`
- `REDIS_URL`
- `METRICS_ENABLED`
- `OTEL_ENABLED`
- `PGBOUNCER_ENABLED`

## Cache Safety Model

The application cache only stores safe public `GET` or `HEAD` responses. It bypasses:

- private/authenticated/admin/payment/user/upload/webhook routes
- any request with `Authorization`
- any request with `Cookie`
- any mutating method
- any response with `Set-Cookie`
- any `4xx` or `5xx`
- any private/no-store/no-cache response

Use `CACHE_ALLOWED_PATH_PREFIXES` to add known-public routes and `CACHE_DENIED_PATH_PREFIXES` to keep sensitive paths blocked.

## Redis Setup

Local:

```sh
docker run --rm -p 6379:6379 redis:7-alpine
```

App env:

```sh
PERFORMANCE_STACK_ENABLED=true
CACHE_ENABLED=true
CACHE_PROVIDER=redis
REDIS_URL=redis://localhost:6379
```

If Redis is down or `REDIS_URL` is missing, the app serves backend responses without crashing.

## NGINX Setup

Use `infra/performance/nginx/nginx.conf.template` as the reverse proxy cache layer. It:

- compresses responses
- caches static hashed assets aggressively
- caches only safe public GET/HEAD proxy responses
- bypasses cache on auth headers, cookies, and mutating methods
- preserves `X-Forwarded-*`
- supports WebSocket upgrade

Bypass NGINX cache during rollback by disabling the NGINX proxy cache config or routing traffic directly to the app.

## PgBouncer Setup

PgBouncer is optional and disabled by default. This repository currently uses MongoDB/Mongoose, so PgBouncer only applies if a future PostgreSQL path is added.

Do not replace `DATABASE_URL` automatically. To test PostgreSQL pooling in a future service:

```sh
PGBOUNCER_ENABLED=true
PGBOUNCER_DATABASE_URL=postgres://app:password@pgbouncer:6432/app
```

Warning: transaction pooling can break prepared statements, session variables, advisory locks, and ORM features that expect session affinity.

## Cloudflare Setup

Run the plan script:

```sh
npm run cloudflare:performance:plan
```

If `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` are missing, the script prints dashboard steps and exits 0. Safe rules:

- cache hashed JS/CSS/images/fonts aggressively
- do not cache private HTML by default
- do not cache authenticated API responses
- optionally cache short-TTL public API GET routes
- purge after deploy when a token is available

## k6 Testing

Smoke:

```sh
npm run perf:load
```

Stress:

```sh
npm run perf:stress
```

Spike:

```sh
k6 run tests/performance/k6/spike.js
```

The wrappers skip when `k6` is not installed or the target base URL is unavailable.

## Lighthouse Testing

```sh
npm run perf:lighthouse
```

The Lighthouse CI config reads:

- `PERF_BASE_URL`
- `LIGHTHOUSE_MIN_PERFORMANCE`

It skips if the frontend URL is unavailable.

## Prometheus And Grafana

Prometheus config:

- `infra/performance/prometheus/prometheus.yml`

Grafana dashboard:

- `infra/performance/grafana/dashboards/app-performance.json`

The server exposes `/metrics`; production requires the existing metrics secret.

## Rollback Plan

1. Set `PERFORMANCE_STACK_ENABLED=false`.
2. Set `CACHE_ENABLED=false`.
3. Bypass or disable NGINX proxy cache.
4. Point `DATABASE_URL` back to the direct database if PgBouncer was used by a future PostgreSQL service.
5. Remove or disable Cloudflare API cache rules.
6. Redeploy the previous version if symptoms continue.

## Troubleshooting

- `X-Cache: BYPASS`: check method, auth header, cookie header, denied path prefix, response status, `Set-Cookie`, and `Cache-Control`.
- `X-Cache: ERROR`: Redis lookup failed. Check `REDIS_URL`, network reachability, and Redis logs.
- Missing `/metrics`: confirm `METRICS_ENABLED`, `METRICS_SECRET`, and scrape headers.
- k6 skipped: install k6 or set a reachable `PERF_API_BASE_URL`.
- Lighthouse skipped: start the frontend and set `PERF_BASE_URL`.
- High p95: inspect `Server-Timing`, Prometheus `http_request_duration_seconds`, and application slow request logs.
