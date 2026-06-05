# ALIEN OTP Inventory

Date: 2026-06-05

## Current Login Flow

- `server/routes/authRoutes.js` handles Firebase-backed session exchange, sync, logout, desktop handoff, Duo/enterprise OIDC, recovery codes, phone factor completion, trusted-device verification, and MFA/passkey routes.
- `server/middleware/authMiddleware.js` attaches `req.user`, `req.authUid`, `req.authToken`, and `req.authSession` for protected routes.
- `server/services/browserSessionService.js` issues and refreshes backend browser sessions and step-up freshness.

## Current OTP Flow

- `server/routes/otpRoutes.js` and `server/controllers/otpController.js` cover email/phone OTP flows.
- `server/models/OtpSession.js` and `server/models/OtpFlowGrant.js` hold OTP lifecycle state.
- ALIEN OTP does not replace these explicit OTP flows. It adds action-bound cryptographic proof for sensitive actions.

## Current Passkey And WebAuthn Flow

- `server/controllers/mfaController.js` exposes passkey MFA options and verify endpoints.
- `server/services/trustedDeviceChallengeService.js` issues trusted-device challenges, seals trusted-device sessions, and consumes challenge IDs once.
- `server/services/webauthnTrustedDeviceService.js` verifies WebAuthn registration/assertion data, origin, RP ID, credential ID, authenticator data, and signature counters.
- `app/src/services/deviceTrustClient.js` serializes browser WebAuthn registration/assertion payloads.

## Current Admin Authorization Flow

- Admin routes use `protect`, admin-specific middleware, and `server/middleware/routeSecurityGuards.js`.
- `routeSecurityGuards` composes centralized `authShieldMiddleware` with `requireSensitiveAction`.
- Existing sensitive action categories live in `server/config/sensitiveActionPolicy.js`.

## Current RBAC, ABAC, Tenant Checks

- `server/security/authShield/identityVerifier.js` normalizes roles, seller/admin state, account status, MFA level, tenant/session identifiers.
- `server/security/authShield/relationshipAuthz.js` applies owner/admin/seller and tenant relationship checks.
- `server/security/authShield/resourceResolver.js` resolves resources for payments, listings, orders, users, reviews, uploads, and admin config.

## Redis And Rate Limit Usage

- `server/config/redis.js` exposes Redis health, optional runtime initialization, and production-required guardrails.
- Distributed rate limits use `server/middleware/distributedRateLimit.js`.
- Existing trusted-device and auth-shield replay controls use Redis first and in-memory fallback outside production.
- ALIEN OTP challenge storage follows the same Redis-first pattern and rejects production use when the challenge store is unavailable.

## Audit Logging

- Existing auth telemetry uses `server/services/authSecurityTelemetryService.js`.
- Auth Shield audit uses `server/security/authShield/auditWriter.js`.
- ALIEN OTP adds redacted events through `server/services/alienOtpAuditService.js`; raw nonces, WebAuthn assertions, and full identifiers are never logged.

## Sensitive Action Enforcement

- `server/middleware/routeSecurityGuards.js` is the safe integration point because it already protects state-changing admin, payment, listing, auth-factor, AI tool, upload, and moderation actions.
- ALIEN OTP is inserted there behind default-off flags. Public browse, search, cart view, product view, status, and SEO routes are not protected.

## Safe Integration Points

- Server flags: `server/config/alienOtpConfig.js`.
- Challenge service: `server/services/alienOtpChallengeService.js`.
- WebAuthn adapter: `server/services/alienOtpWebAuthnService.js`.
- Device binding groundwork: `server/services/alienDeviceBindingService.js`.
- Risk engine: `server/services/alienOtpRiskEngine.js`.
- Middleware: `server/middleware/alienOtpRequired.js`.
- Route: `POST /api/security/alien-otp/challenge`.
- Client helper: `app/src/security/alienOtpClient.js`.

## Rollback Plan

1. Set `ALIEN_OTP_ENABLED=false`.
2. Keep `ALIEN_OTP_STRICT_MODE=false`.
3. Redeploy or reload runtime config.
4. Confirm existing auth, MFA, checkout, admin, mobile, desktop, and SEO paths remain active.
5. Keep passkey and trusted-device records intact; do not delete MFA or trusted-device metadata during rollback.
