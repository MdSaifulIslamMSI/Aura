# Security Verification Test Plan

## Current Security Coverage Found

- Backend tests use Jest and Supertest from `server/package.json`, with `mongodb-memory-server` setup in `server/tests/setup.js`.
- Frontend tests use Vitest from `app/package.json`.
- Existing auth coverage includes auth routes, CSRF middleware, browser sessions, trusted device challenges, recovery codes, admin middleware, telemetry, and a login attack smoke suite.
- Existing e-commerce/payment coverage includes order pricing, order placement, payment intent ownership, payment method enrollment, payment transition guards, Razorpay signature checks, Stripe provider behavior, refund state, and payment operations.
- Existing app hardening includes Helmet CSP in `server/index.js`, disabled `X-Powered-By`, explicit CORS allowlisting in `server/config/corsFlags.js`, body size limits, Mongo key sanitization, XSS sanitization, Redis-aware rate limiting, and production secret config checks.
- Existing CI runs backend regression tests, login security gates, frontend lint/tests/build, container smoke, and deployment contract checks.

## Missing Coverage

- No single production-grade security command groups all security categories and produces a local report.
- Secret scanning is not available as a deterministic local/CI command.
- Dependency audit output is not normalized into `security-reports/dependency-audit.json`.
- IDOR/BOLA tests exist in fragments but are not grouped by object type with explicit database no-change assertions.
- Payment webhook tests cover signatures, replay, and transition ordering, but need explicit amount, currency, and provider order binding checks.
- Admin privilege escalation and mass-assignment checks need clearer negative tests against route-level mutations.
- Business logic abuse tests need deterministic coverage for manipulated totals, invalid quantities, disabled products, and duplicate checkout/idempotency behavior.
- CORS/CSRF and header checks exist but need production security scripts and grouped test names.
- Logging tests should assert sensitive values are redacted from logs and queued security alert payloads.

## Threat Model

Primary assets:

- Customer accounts, sessions, profile data, addresses, wishlist, cart, orders, invoices/payment records, saved payment methods, refunds, admin control plane, product catalog, audit/security events, and payment webhook state.

Attackers:

- Anonymous internet users, authenticated customers, sellers, blocked/deleted users, compromised normal accounts, malicious admins below super-admin level, replay attackers with stale tokens/webhooks, and CI/supply-chain attackers attempting secret or dependency compromise.

Trust boundaries:

- Browser to Express API, Firebase bearer token to local user profile, cookie session to CSRF middleware, user body/query/params to Mongo/Mongoose, payment provider webhooks to payment state transitions, admin routes to privileged business mutations, CI to dependency/secret checks.

No-go zones:

- Do not use production databases, production secrets, production payment keys, production webhooks, or real third-party attack targets.
- Abort destructive/security commands when `NODE_ENV=production`.
- Keep tests deterministic, local, and seeded with fake users/products/orders/payments/webhooks.

## Test Matrix

| Category | Coverage To Add Or Group | Key Assertions |
| --- | --- | --- |
| Secrets | Custom tracked-file scanner; pinned Gitleaks install in CI; optional local Gitleaks report if installed | Real-looking secrets and committed `.env` files fail CI |
| Dependencies | `npm audit --audit-level=high --json` for root/app/server | High/critical advisories fail unless documented exception exists |
| Auth/tokens | Missing, malformed, rejected, blocked/deleted user, stale admin role | Safe status and no user/session privilege mutation |
| OTP/reset | Existing OTP/reset suites grouped under `security:otp-reset` | Invalid/replayed/expired attempts rejected and DB state safe |
| Rate limit | Spoofed IP headers and parallel/repeated attempts | 429 when limit exceeded; unrelated users not unfairly locked |
| CORS/CSRF | Allowed origin, evil origin, null origin, cookie write CSRF | Safe status and no credentialed wildcard CORS |
| IDOR/BOLA | Orders, command center, addresses, payment intents/methods, lists | 403/404/409 and victim DB documents unchanged |
| Function auth | User/admin/seller route boundaries | Non-privileged users cannot mutate admin resources |
| Mass assignment | Profile/order/payment/admin dangerous fields | Rejected/ignored and DB lacks attacker-controlled privileged values |
| Business logic | Quantity, stock, disabled products, manipulated totals, idempotency | Server recalculates and no incorrect order/payment/stock mutation |
| Webhooks | Missing/invalid signatures, replay, amount/currency/order mismatch | Rejected/deduped and payment/order DB state unchanged |
| Headers | CSP, frame protection, nosniff, referrer, no Express leak, no-store admin | Required headers present on API/admin responses |
| Logging | Password/OTP/token/API key/payment secret redaction | Logs and alert payloads do not contain raw sensitive values |
| Cloudflare | WAF/rate-limit/origin-protection/Turnstile deployment contract | CI-safe edge readiness gate passes without live Cloudflare secrets |
| Cisco Duo | Universal Prompt MFA runtime contract | CI-safe readiness gate passes without live Duo secrets |
| CI | Install, root/backend tests, security suite, audit, pinned Gitleaks-backed secret scan, artifact upload | No production services required |
| Harness Contract | Static audit of required security scripts, CI wiring, production gates, secret/dependency scanners, report ignores, container excludes, and desktop proxy TLS defaults | Pipeline fails when the security suite or release gates drift out of policy |
| Status Power | Public status page score across surface coverage, health signals, 90-day history, incident operations, and security posture | Status page strength is visible in the payload and UI, not inferred by copy |
| Reporting | Summary markdown and JSON results | Repro commands, changed files, limitations, failures recorded |

## Commands Added

- `npm test`
- `npm run test:server:regression`
- `npm run test:server:full`
- `npm run security:all`
- `npm run security:harness`
- `npm run security:secrets`
- `npm run security:deps`
- `npm run security:auth`
- `npm run security:access-control`
- `npm run security:idor`
- `npm run security:tokens`
- `npm run security:otp-reset`
- `npm run security:rate-limit`
- `npm run security:cors-csrf`
- `npm run security:admin`
- `npm run security:business-logic`
- `npm run security:webhooks`
- `npm run security:headers`
- `npm run security:cloudflare`
- `npm run security:duo`
- `npm run cloudflare:security:plan`
- `npm run cloudflare:security:activate -- --zone=<domain>`
- `npm run security:logging`
- `npm run security:report`

## Acceptance Criteria

- `npm test` still passes for the existing project scope.
- `npm run security:all` passes in CI with local test databases and fake fixtures only.
- `npm run security:harness` fails if required security scripts, CI security jobs, production security gates, pinned Gitleaks install, report ignores, Docker secret exclusions, or desktop proxy TLS defaults are removed.
- Public status payloads include a `statusPower` score and the UI renders its measured dimensions.
- Tests fail if a user can read or mutate another user private resource.
- Tests fail if a normal user can set privileged fields such as `isAdmin`, `adminRoles`, `paymentState`, or `orderStatus`.
- Tests fail if fake frontend payment success can mark an order paid without server/provider verification.
- Tests fail if invalid, replayed, amount-mismatched, currency-mismatched, or order-mismatched webhooks mutate payment/order state.
- Tests fail if real-looking secrets or committed `.env` files are found.
- Tests fail if high/critical dependency vulnerabilities exist without documented exceptions.
- Every new route/service security test asserts both safe response/error status and no incorrect database state change.

## Known Limitations

- The backend primarily uses Firebase ID tokens and browser sessions rather than locally signed JWT access/refresh tokens; JWT-specific checks are mapped to bearer-token/session behavior where applicable.
- Some requested resources, such as invoices, coupons as first-class persisted models, and super-admin-only routes, are not visible as dedicated route/model surfaces in the inspected repo.
- Rate limiting is intentionally bypassed in Jest when `NODE_ENV=test`; bypass tests use a focused local Express harness with non-production env settings.
- CORS, HSTS, and Secure cookie behavior may also be enforced at CDN/proxy layers; tests verify repo-visible app behavior and document edge-only assumptions.
- Cloudflare readiness is a local/CI contract and does not mutate live zones; staging activation still requires explicit Cloudflare credentials and manual WAF/rate-limit tuning.
- Backend Turnstile validation is wired for public OTP/recovery abuse endpoints, but the live browser challenge must be enabled only after a real Turnstile site key is configured and the UI supplies fresh tokens.
- Cisco Duo readiness verifies the local Universal Prompt configuration contract only; live MFA enforcement still requires Duo tenant credentials and staging callback verification.
- Dependency audit results depend on the npm advisory service at runtime.
- Local Gitleaks execution remains optional for developers; CI installs pinned Gitleaks `v8.30.1` with SHA-256 verification before `security:all`.
- Root `npm test` intentionally tracks the backend regression scope used by CI; `npm run test:server:full` remains available for the unscoped server Jest suite.
