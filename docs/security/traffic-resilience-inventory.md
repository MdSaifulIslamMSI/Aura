# Traffic Resilience Inventory

## Public And Sensitive Surfaces

| Surface | Route or Path | Class | Attack Behavior |
| --- | --- | --- | --- |
| Frontend/static | `/`, `/assets/*`, static extensions | `STATIC_PUBLIC` | Serve from CDN/cache; origin should be cheap. |
| Public catalog | `/api/products`, `/api/listings`, `/api/recommendations` | `PUBLIC_SEARCH` | Budget query size, cache safe reads, shed before DB pressure. |
| Auth/session | `/api/auth/*` | `AUTH_LOGIN` | Strict rate limit, Turnstile where present, fail closed for critical paths. |
| OTP | `/api/otp/*`, `/api/auth/otp/*` | `OTP` | Strict limiter plus Turnstile; can be disabled with emergency flag. |
| Admin | `/api/admin/*` | `ADMIN_READ` or `ADMIN_WRITE` | Admin auth, sensitive actions, strict budgets. |
| Payments | `/api/payments/*`, `/api/checkout/*` | `PAYMENT` | OTP assurance, idempotency, replay checks, strict budgets. |
| Webhooks | `/api/payments/webhooks/*`, `/api/email-webhooks/*` | `WEBHOOK` | Provider signature/replay/idempotency evidence, not user throttling. |
| Upload/media | `/api/uploads/*`, `/uploads/*` | `UPLOAD` | Body caps, scan pipeline, upload attack-mode block. |
| AI/LLM | `/api/ai/*`, `/api/intelligence/*`, visual search | `AI_EXPENSIVE` | Strict budgets, attack-mode block first, provider fallback. |
| Status/health | `/api/status`, `/health`, `/api/health` | `STATUS_PUBLIC` or `HEALTH` | Minimal, cached or no-store as appropriate, kept online during attacks. |
| Workers | payment outbox, order email, catalog, status monitor | background | Queue/backoff/dead-letter posture documented. |
| MongoDB | products, listings, orders, users, payments | data | Query caps, indexes, maxTimeMS, pagination limits. |
| Redis | rate limit, auth cache, queues, denylist | cache/state | Distributed budgets, sensitive routes fail closed in production. |

## Classification Rules

`server/config/trafficBudgets.js` is the source of truth for route classes, body caps, timeout budgets, rate budgets, challenge eligibility, emergency flags, and degradation behavior.
