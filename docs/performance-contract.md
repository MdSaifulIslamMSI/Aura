# Performance Contract

This contract defines the safe boundaries for the optional performance stack.

## Feature Flags

- `PERFORMANCE_STACK_ENABLED=false` by default in code. It must be enabled before performance middleware, cache headers, static asset cache headers, or OTEL export activate.
- `CACHE_ENABLED=false` by default in code. It must be enabled before public response caching activates.
- `CACHE_PROVIDER=redis` uses Redis when `REDIS_URL` is present and reachable.
- `CACHE_PROVIDER=memory` is only intended for tests or local smoke checks.
- Missing Redis, OTEL, k6, Lighthouse, Cloudflare, PgBouncer, or staging URLs must not break local tests.

## Cache Safety Model

The server cache is deny-first and only stores public `GET` or `HEAD` responses.

Never cache:

- `POST`, `PUT`, `PATCH`, or `DELETE`
- Requests with `Authorization`
- Requests with `Cookie`
- Responses with `Set-Cookie`
- `4xx` or `5xx` responses
- Responses with `Cache-Control: private`, `no-store`, or `no-cache`
- Auth, admin, user, payment, upload, uploads, and webhook routes

Default denied prefixes:

- `/api/auth`
- `/api/admin`
- `/api/user`
- `/api/users`
- `/api/me`
- `/api/payment`
- `/api/payments`
- `/api/upload`
- `/api/uploads`
- `/api/webhooks`
- `/api/email-webhooks`
- `/uploads`

Default example allowed prefixes are intentionally conservative:

- `/api/public`
- `/health`
- `/status`

Production teams may add known-public routes, such as selected catalog/status endpoints, only after verifying no user-specific response content, no cookies, and no auth-dependent variants.

## Headers

- `X-Cache: HIT` means the response was served from cache.
- `X-Cache: MISS` means the request was eligible and the backend generated the response.
- `X-Cache: BYPASS` means the request or response failed a safety gate.
- `X-Cache: ERROR` means cache lookup failed and the app fell back to the backend.
- `Server-Timing` is emitted when `PERFORMANCE_STACK_ENABLED=true`.

## Observability

Metrics exposed through `/metrics` include existing `aura_*` metrics plus:

- `http_requests_total`
- `http_request_duration_seconds`
- `cache_hits_total`
- `cache_misses_total`
- `cache_bypass_total`
- `cache_errors_total`
- `db_query_duration_seconds`

Production `/metrics` remains protected by the existing `METRICS_SECRET` or `CRON_SECRET` pattern.

## Backward Compatibility

- No existing auth, admin, payment, upload, webhook, or mutation behavior is changed.
- No production env file is edited.
- PgBouncer is documentation/config only because the app currently uses MongoDB/Mongoose, not PostgreSQL.
- Cloudflare changes are plan-only unless `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` are provided.
