# Invisible Auth Shield Inventory

Date: 2026-06-05

## Current Auth Provider

- Primary request auth is `server/middleware/authMiddleware.js`.
- It verifies Firebase/Auth-provider access tokens through `services/auth/authProviderAdapter.js`.
- It also supports browser sessions through `services/browserSessionService.js`.
- Existing request identity is attached as `req.user`, `req.authUid`, `req.authToken`, `req.authIdentity`, and `req.authSession`.

## Current Role Checks

- Admin and seller checks live in `server/middleware/authMiddleware.js`.
- `admin` re-checks the user from Mongo when needed, uses `authorizationService`, and applies admin posture gates.
- `seller` requires a seller role through server-side `req.user`, not request body roles.
- Resource ownership checks live in `server/middleware/authorizeResource.js` and `server/middleware/routeSecurityGuards.js`.

## Current Admin Checks

- Admin routes use `protect, admin`.
- Existing admin checks include email verification, allowlist support, fresh login, second factor, passkey/WebAuthn posture, trusted device enforcement, and Duo step-up for state-changing admin actions when configured.
- Admin sensitive route classification already exists through `sensitiveActions.*`.

## Current Payment Sensitive Routes

- `server/routes/paymentRoutes.js`
  - `POST /api/payments/intents`
  - `POST /api/payments/intents/:intentId/challenge/complete`
  - `POST /api/payments/intents/:intentId/confirm`
  - `POST /api/payments/intents/:intentId/refunds`
  - Payment method create/update/delete routes.
- `server/routes/adminPaymentRoutes.js`
  - Admin stale intent expiry.
  - Refund ledger reference updates.
  - Capture and retry-capture operations.
- `server/routes/orderRoutes.js`
  - Customer refund requests.
  - Admin refund decisions.
  - Order cancel and admin cancel flows.

## MFA, Passkey, And Fresh Auth Support

- MFA controllers live in `server/controllers/mfaController.js`.
- Fresh MFA middleware lives in `server/middleware/requireFreshMfa.js`.
- Trusted device/passkey support lives in `server/services/trustedDeviceChallengeService.js` and `server/services/webauthnTrustedDeviceService.js`.
- Duo step-up support lives in `server/services/duoStepUpService.js`.
- Existing sensitive action policy can already call fresh MFA enforcement.

## Current Audit Logging

- Security audit logging lives in `server/services/securityAuditService.js`.
- It hashes/truncates selected metadata and avoids logging raw auth headers, cookies, tokens, OTPs, passwords, and card secrets.
- Auth Shield adds `authshield.decision` audit events with hashed actor/resource/tenant identifiers.

## Redis Availability

- Redis config lives in `server/config/redis.js`.
- Redis is optional by default and required only when configured for production/split runtime/distributed controls.
- Auth Shield replay and step-up state use Redis when available and in-memory storage for tests/local fallback.

## Selected First Routes To Protect

Auth Shield is composed into `server/middleware/routeSecurityGuards.js`, so it wraps routes already classified as sensitive:

- Admin user mutation routes.
- Admin config/status/ops/abuse/payment state mutations.
- Payment refund and payment method/payout-like mutations.
- Auth recovery and MFA factor changes.
- Order refund/cancel/status mutations.
- Listing update/delete/escrow mutations.
- Upload/review media sensitive writes.
- Moderation and admin fraud/support actions already using `sensitiveActions`.

Public listing reads, health checks, webhooks without existing sensitive route middleware, SEO/static/mobile/desktop entry points, and normal read routes are not wrapped by this first slice.
