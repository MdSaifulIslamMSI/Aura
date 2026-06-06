# Extreme Attacker-Friction Inventory

## Current protections

- Auth provider: Firebase identity is the primary app identity provider, with optional OIDC/Keycloak documentation and adapter tests.
- Session system: backend browser/session services, trusted-device state, Firebase token verification, and role-bearing user records.
- CSRF protection: Redis-backed one-time CSRF tokens in `server/middleware/csrfMiddleware.js`, applied to cookie-backed auth writes and sensitive flows.
- CORS config: centralized origin checks in `server/config/corsFlags.js`, wired through Express `cors`.
- Rate limiting: global distributed limiter, auth/OTP limiters, route traffic budgets, abuse shield, load shedding, and attack-mode guard.
- Upload handling: `server/services/uploadSecurityPipeline.js` enforces MIME allowlists, extension checks, magic-byte validation, malware scan hooks, and rejection telemetry.
- Admin routes: protected by `protect`, admin middleware, `routeSecurityGuards`, auth shield, ALIEN OTP, and sensitive action middleware on critical routes.
- Payment/refund routes: payment provider signature checks, refund state tests, payment security guards, and critical route controls.
- Export routes: admin analytics export is route-protected and parameter bounded.
- Webhook routes: payment/email/status webhook tests verify signature and replay handling.
- API key routes: no broad public API key management route was found; new registry policies default-deny API key create/rotate/revoke actions.
- Password/email/MFA routes: auth routes include OTP, session, CSRF, trusted-device/WebAuthn, recovery code, and MFA rollout coverage.
- AI action routes: AI route security guards and tool-action policy hooks exist for privileged/mutation-like actions.
- Tenant/owner/resource checks: existing `authorizeResource`, authShield relationship authz, and route resolvers cover orders, listings, payments, users, and uploads.
- Existing security middleware: `authShieldMiddleware`, `sensitiveActionMiddleware`, `distributedRateLimit`, `csrfMiddleware`, `abuseShield`, `attackModeGuard`, `originProtectionMiddleware`, sanitizers, and traffic budget guards.
- Existing audit logging: `server/services/securityAuditService.js`, auth security telemetry, upload telemetry, authShield audit writer, and structured logger.
- Existing security tests: auth, CSRF, rate limit, admin, payment, webhook, upload, security policy, traffic resilience, and scanner tests are present.
- Existing CI/security scripts: `security:secrets`, `security:deps`, `security:auth`, free scanner workflows, security gates, route enforcement coverage, and npm audit gates.

## Missing protections

- The repo did not expose the requested top-level attacker-friction module names before this branch.
- Sensitive action registry coverage was split between authShield and route-specific policy, not one canonical decision registry.
- Canary/deception routes were not mounted as a safe generic signal source.
- A simple route scanner named `security:routes` and a fabric-level `security:friction` gate were missing.
- Containment state existed conceptually in adjacent security controls but not as a standalone attacker-friction service.

## Sensitive route list

- Admin: `/api/admin/users`, `/api/admin/payments`, `/api/admin/analytics`, `/api/admin/catalog`, `/api/admin/products`, `/api/admin/status`, `/api/admin/fraud`, `/api/admin/abuse`, `/api/admin/emergency-controls`, `/api/admin/email-ops`, `/api/admin/notifications`, `/api/admin/ops`.
- Payment/refund: `/api/payments`, `/api/admin/payments`.
- Export: `/api/admin/analytics/export`.
- Upload: `/api/uploads`, `/uploads/reviews/*`.
- Webhook: `/api/payments/webhooks/*`, `/api/email-webhooks/*`, `/api/status/webhooks/*`.
- Auth/password/email/MFA/passkey: `/api/auth`, `/api/otp`, `/api/security/alien-otp/challenge`.
- AI privileged actions: `/api/ai`.
- Internal/observability: `/api/internal`, `/api/observability`, metrics path.
- Canary: `/.env`, `/config/secrets`, `/admin-super-secret`, `/internal/debug`, `/api/v1/export-all-users`, `/api/v1/admin/token-dump`.

## Existing test coverage

- Pre-change root regression: `npm test -- --runInBand` passed with 33 suites and 363 tests.
- Pre-change lint: `npm run lint` passed with existing React hook warnings.
- Pre-change build: `npm run build` passed.
- Existing focused tests include auth middleware, MFA rollout, profile security, OTP, payment integrity, admin integrations, webhook security, upload pipeline, CSRF, distributed rate limits, auth sessions, and traffic resilience.

## Risks found

- Existing lint warnings remain in frontend hook dependency checks; they predate this branch.
- `git checkout main` could not run in this checkout because `main` is already used by another local worktree, so this branch was created from the freshly fetched `origin/main`.
- Root `npm install` updated `package-lock.json` before edits; review the lockfile diff before merging.
- The new scanner treats several existing middleware names as approved equivalents to avoid breaking current routes. It catches naked sensitive routes, but deep semantic route proof still requires code review.

## Implementation choices

- Added a central top-level security decision engine that composes a sensitive action registry, risk scoring, fresh-auth checks, audit logging, and containment decisions.
- Kept current route protections intact and additive to avoid disrupting auth, checkout, admin, upload, webhooks, mobile, desktop, or SEO.
- Added canary routes with generic 404/403 responses, no data disclosure, no callbacks, and no secrets.
- Added route scanner and friction check scripts without paid dependencies.
- Feature flags default to safe enabled behavior for the new fabric while preserving rollout controls:
  - `SECURITY_FRICTION_ENABLED=true`
  - `SECURITY_CANARY_ROUTES_ENABLED=true`
  - `SECURITY_ADAPTIVE_RATE_LIMIT_ENABLED=true`
  - `SECURITY_CONTAINMENT_ENABLED=true`
  - `SECURITY_STRICT_SENSITIVE_ROUTES=true`
  - `SECURITY_REQUIRE_ADMIN_PASSKEY=false`

## Rollback plan

- Disable `SECURITY_FRICTION_ENABLED=false` for emergency compatibility issues in middleware consumers.
- Disable `SECURITY_CANARY_ROUTES_ENABLED=false` if canary false positives appear.
- Disable `SECURITY_ADAPTIVE_RATE_LIMIT_ENABLED=false` if adaptive throttling is too aggressive.
- Disable `SECURITY_CONTAINMENT_ENABLED=false` if containment behavior is too aggressive.
- Revert this PR if the additive router, scanners, or package scripts cause CI or runtime regressions.
