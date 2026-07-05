# Traffic Budget Current Inventory

Generated for branch `codex/traffic-budget-rate-limit-calibration`.

## Phase 0 Baseline

Read-only baseline commands were run in an isolated worktree created from `origin/main` so the existing dirty checkout was not touched.

| Command | Result | Notes |
| --- | --- | --- |
| `git status --short --branch` | Pass | Clean branch worktree on `codex/traffic-budget-rate-limit-calibration...origin/main`. |
| `gh pr status` | Pass | No PR exists for this branch yet. |
| `npm run scan:prod-fallbacks` | Pass | Existing production-fallback scanners passed. |
| `npm run security:secrets` | Pass | Secret scan passed across repository files. |
| `npm run traffic:fortress:test` | Pass after server deps install | 16 suites, 38 tests. Initial failure was missing `server/node_modules` in the new worktree. |
| `npm run security:traffic:matrix` | Pass | Existing traffic matrix report passed. |
| `npm run security:traffic:rate-limits` | Pass | Existing rate-limit coverage report passed. |
| `npm run security:traffic:backpressure` | Pass | Existing backpressure readiness report passed. |
| `npm run security:traffic:database` | Pass | Existing database-pressure report passed. |
| `npm run security:traffic:cache` | Pass | Existing cache resilience report passed. |
| `npm run security:traffic:provider-breakers` | Pass | Existing provider circuit breaker report passed. |
| `npm run security:traffic:observability` | Pass | Existing traffic observability report passed. |
| `npm run smoke:staging` | Blocked | Required staging variables are not configured locally. |
| `npm run smoke:staging:frontend` | Blocked | `STAGING_FRONTEND_URL` and `STAGING_API_BASE_URL` are missing. |
| `npm run smoke:env-contract` | Blocked | Staging environment contract variables are missing. |
| `npm run aws:cost-guard` | Blocked | AWS CLI returned `NoCredentials`; no paid resources were created. |
| `npm run aws:observability:guard` | Blocked | AWS CLI returned `NoCredentials`; no cloud state was mutated. |
| `npm run release:rollback-ready` | Blocked | Missing rollback target/artifact evidence and production health URL. |
| `npm run github:main-protection` | Pass | Main branch protection matches release checklist. |

## Existing Traffic-Budget Files

| Surface | File |
| --- | --- |
| Central component policy registry | `server/config/trafficPolicyRegistry.js` |
| Route-class budgets | `server/config/trafficBudgets.js` |
| Runtime resilience policy loader | `server/config/trafficResiliencePolicy.js` |
| Source resilience JSON | `config/security/traffic-resilience-policy.json` |
| Packaged server resilience JSON | `server/config/security/traffic-resilience-policy.json` |
| Traffic budget middleware | `server/middleware/trafficBudgetPolicy.js` |
| Route classifier | `server/middleware/routeCostClassifier.js` |
| Distributed limiter | `server/middleware/distributedRateLimit.js` |
| Body-size guard | `server/middleware/bodySizeGuards.js` |
| Request timeout budget | `server/middleware/requestTimeouts.js` |
| Load shedding | `server/middleware/loadShedding.js` |
| Query budget guard | `server/middleware/queryBudgetGuard.js` |
| Cache policy | `server/middleware/cachePolicy.js` |
| Traffic metrics | `server/metrics/trafficResilienceMetrics.js` |

## Existing Rate-Limit Files

Route-level limiters remain in route modules and continue to complement the global traffic budget policy:

| Route family | Evidence |
| --- | --- |
| Auth/login/MFA/passkey/Duo | `server/routes/authRoutes.js` |
| OTP/password reset | `server/routes/otpRoutes.js` |
| Payments/refunds/methods | `server/routes/paymentRoutes.js` |
| Listings/live-call/session tokens | `server/routes/listingRoutes.js` |
| AI/chat/voice/session | `server/routes/aiRoutes.js` |
| i18n translation | `server/routes/i18nRoutes.js` |
| Email webhooks | `server/routes/emailWebhookRoutes.js` |
| Observability diagnostics | `server/routes/observabilityRoutes.js` |
| Status subscriptions/webhooks | `server/routes/statusRoutes.js` |
| Internal jobs/workers | `server/routes/internalOpsRoutes.js` |
| User/account notifications | `server/routes/userNotificationRoutes.js`, `server/routes/userRoutes.js` |

## Route Classes

Current route classes from `server/config/trafficBudgets.js`:

`STATIC_PUBLIC`, `PUBLIC_READ`, `PUBLIC_SEARCH`, `AUTH_LOGIN`, `AUTH_WEBAUTHN`, `OTP`, `OTP_RESET`, `AUTHENTICATED_READ`, `AUTHENTICATED_WRITE`, `UPLOAD`, `AI_EXPENSIVE`, `PAYMENT`, `WEBHOOK`, `ADMIN_READ`, `ADMIN_WRITE`, `STATUS_PUBLIC`, `HEALTH`.

## Sensitive Route Inventory

| Area | Policy source | Notes |
| --- | --- | --- |
| Auth/login/session | `auth-login-session`, `trusted-device-webauthn`, `mfa-passkey-duo-step-up` | Strict auth budgets, flow/challenge posture, no enumeration in throttling responses. |
| OTP/password reset | `otp-send-verify`, `password-reset` | Low per-IP/per-flow budgets, Turnstile/flow-token evidence, fail closed. |
| Payment/checkout/order | `payment-checkout`, `cart-order-mutations` | Payment mutations require idempotency/state-machine posture and no automatic mutation retry. |
| Admin | `admin-read`, `admin-write` | Privileged route class, admin guard evidence, strict fail-closed mutations. |
| Upload/media | `upload-review-media` | Body budget, file validation, malware/quarantine evidence. |
| Search/product/listing | `product-search-browsing`, `marketplace-mutations` | Public reads stay cache-friendly; mutations have explicit write budget. |
| AI/chat/assistant | `ai-chat-model-gateway` | Quota, concurrency, provider timeout/circuit-breaker posture. |
| Socket/live-call | `live-socket-video` | Server-side session proof and token mint limiter evidence. |
| Webhooks | `provider-webhooks` | Signature/replay/idempotency posture instead of generic public treatment. |
| Static/frontend | `static-frontend-assets`, `static-fallback` | Immutable cache policy; no body accepted. |
| Observability/health | `observability-health`, `public-status`, `observability-ingest`, `observability-admin-read` | Cheap health, no-store private diagnostics, public status short cache. |
| Internal jobs/workers | `internal-jobs-workers` | Auth/signature posture and bounded worker retry. |

## Body-Size Limits

Body-size budgets are enforced before JSON body parsing by `server/middleware/bodySizeGuards.js` using the route budget attached by the classifier. Auth/OTP routes also use smaller Express parser limits through `AUTH_BODY_LIMIT`.

## Request Timeout Budgets

`server/middleware/requestTimeouts.js` reads each route budget's `timeoutMs`. Health routes are kept cheap and exempt from the budget timeout wrapper where appropriate. The broader `server/middleware/requestTimeout.js` remains the connection-level safety net.

## Load-Shedding Policy

`server/middleware/loadShedding.js` sheds only degradable route classes under overload. It does not shed `HEALTH`, `STATUS_PUBLIC`, `WEBHOOK`, or `ADMIN_WRITE`. Shed responses use 503 with a requestId and no internal load details.

## Distributed Limiter Fallback Behavior

`server/middleware/distributedRateLimit.js` uses Redis when available and bounded in-memory fallback only when allowed by the caller. `trafficBudgetPolicy` treats fail-closed or critical budgets as security critical; in production those budgets do not allow in-memory fallback.

## Production And Staging Behavior

- Production-sensitive budgets fail closed for auth, OTP, payment, admin, upload, and AI classes.
- Public browsing retains cache-friendly smoothness and bounded fallback behavior.
- Staging smoke and AWS guards failed closed locally because required environment variables and AWS credentials were absent.
- No production origin, cloud state, or paid AWS resource was mutated during inventory.

## Known Strictness Risks

- Auth/OTP/password reset budgets are intentionally low; frontend UX must respect cooldown and avoid retry loops.
- WebAuthn/trusted-device verification has its own bucket; repeated retries can burn the 5-minute window.
- Admin write budgets are intentionally strict and should not be raised without security review.

## Known Bypass Risks

- New top-level API mounts can fall to runtime fallback if the registry is not updated. `traffic:audit:regressions` blocks this.
- Route-level limiters must remain in sensitive modules even with global budgets.
- Webhook safety depends on signature/replay/idempotency checks, not user-facing throttling alone.

## Regression Risks

- Weakening auth/OTP/admin/payment route budgets can hide as a smoothness change.
- Moving private routes to cacheable policies can leak data.
- Allowing production limiter fallback for critical routes can create horizontal bypass under Redis outage.
- Staging variables must not fall back to production. Existing fallback scanners remain required gates.
