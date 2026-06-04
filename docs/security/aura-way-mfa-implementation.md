# Aura Way MFA Implementation Note

Last updated: 2026-06-04

## Inventory

Current auth/session entry points:
- `server/routes/authRoutes.js` mounts the main auth API: session exchange, session read, sync, logout, trusted-device bootstrap, recovery code generation/verification, phone-factor completion, Duo, enterprise OIDC, desktop handoff, and OTP aliases.
- `server/controllers/authController.js` owns auth session responses, Firebase/legacy sync, phone-factor completion, Duo/enterprise callbacks, trusted-device verification, recovery-code flows, and the browser-session persistence call path.
- `server/middleware/authMiddleware.js` verifies bearer Firebase/legacy access tokens, authenticates opaque browser-session cookies, attaches matching browser-session context, enforces admin/seller posture, and applies continuous-access checks.
- `server/services/authSessionService.js` syncs/bootstraps user profiles, applies OTP login assurance, builds public session payloads, and computes session intelligence.
- `server/services/browserSessionService.js` creates, rotates, stores, revokes, and sets the opaque `aura_sid` browser-session cookie through Redis with non-production memory fallback.

Current MFA/step-up-adjacent surfaces:
- `server/services/trustedDeviceChallengeService.js` issues and verifies trusted-device challenges, including WebAuthn/passkey assertions through `server/services/webauthnTrustedDeviceService.js`.
- `server/config/authTrustedDeviceFlags.js` controls trusted-device challenge mode (`off`, `always`, `admin`, `seller`, `privileged`), passkey preference, RP origin/ID/name, and challenge secrets.
- `server/services/authRecoveryCodeService.js` generates hashed one-time recovery codes and consumes them for password reset.
- `server/controllers/otpController.js`, `server/utils/otpFlowToken.js`, and `server/services/otpFlowGrantService.js` implement OTP flow tokens/grants for login, signup, and recovery.
- `server/services/duoStepUpService.js` and Duo OIDC controller paths provide an existing external step-up option.

Privileged and dangerous-action enforcement:
- `server/security/sensitiveActionPolicy.js` classifies admin, payment/refund/payout, recovery, auth-factor, upload, data-delete, order, and AI mutation routes.
- `server/middleware/sensitiveActionMiddleware.js` denies sensitive actions when required assurance is missing.
- `server/middleware/routeSecurityGuards.js` provides reusable guards for admin mutations, payment changes, recovery/auth-factor changes, and related sensitive routes.
- Admin enforcement in `server/middleware/authMiddleware.js` can require verified email, second factor, passkey, allowlist membership, fresh login, WebAuthn step-up, and Duo step-up depending on flags.

Rate limiting and audit:
- `server/middleware/distributedRateLimit.js` is used by auth routes for sync, recovery code verification, trusted-device bootstrap, phone-factor completion, trusted-device verification, Duo/enterprise OIDC, desktop handoff, and session mutation.
- `server/services/authSecurityTelemetryService.js` records bounded security events to logs, metrics, and the auth security outbox.
- `server/services/securityAuditService.js` records sensitive-action decisions.

Frontend account/security surfaces:
- Login flow: `app/src/pages/Login/*`, `app/src/services/api/authApi.js`, `app/src/context/AuthContext.jsx`, `app/src/context/authSessionState.js`.
- Trusted device UI: `app/src/components/features/auth/AuraTrustedDeviceChallenge.jsx`.
- Profile/security-adjacent settings: `app/src/pages/Profile/components/SettingsSection.jsx`, `app/src/pages/Profile/index.jsx`.
- Admin/payment sensitive surfaces: `app/src/pages/Admin/*`, `app/src/services/api/adminApi.js`, `app/src/services/api/paymentApi.js`.

Existing focused verification:
- `npm --prefix server test -- --runTestsByPath tests/authRoutes.integration.test.js --forceExit`
- `npm run security:auth`
- `npm run security:admin`
- `npm run security:rate-limit`
- `npm run security:auth-tests`
- `npm run test`
- `npm run lint`
- `npm run build`

## Current Auth Flow

Primary frontend login is Firebase/legacy bearer-token based. The frontend calls `/api/auth/sync` with the bearer token. `protect` verifies the token and loads or bootstraps a `User`. `syncSession` then syncs profile state, evaluates login risk and trusted-device challenge policy, and returns a session payload.

Before this change, `POST /api/auth/sync` and `POST /api/auth/verify-device` both ran `establishSessionCookie` as route middleware before controller policy/verification completed. `syncSession` also persisted a browser session even when it returned `device_challenge_required`. That meant a browser session could be minted before the trusted-device/passkey challenge passed.

## Target MFA Flow

The safe baseline is:

1. Primary auth succeeds through Firebase/legacy bearer verification.
2. Server syncs or loads the user.
3. Login policy evaluates trusted-device/passkey/risk requirements.
4. If no MFA/step-up is required, the server creates the final browser session and returns `status: "authenticated"`.
5. If MFA/step-up is required, the server returns `status: "device_challenge_required"` plus the challenge payload and does not create or rotate the browser session.
6. The user verifies the allowed challenge method through `/api/auth/verify-device`.
7. Only after successful verification does the server create or rotate the final browser session.

This note covers the first safety slice of the larger Aura Way MFA request: preserving existing Firebase/legacy auth while closing the premature session issuance path for the existing passkey/trusted-device step-up flow.

## Feature Flags

Existing flags relevant to this slice:
- `AUTH_DEVICE_CHALLENGE_MODE=off|always|admin|seller|privileged`
- `AUTH_DEVICE_CHALLENGE_SECRET`
- `AUTH_DEVICE_CHALLENGE_SECRET_VERSION`
- `AUTH_DEVICE_CHALLENGE_PREVIOUS_SECRETS`
- `AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK`
- `AUTH_TRUSTED_DEVICE_PREFER_WEBAUTHN`
- `AUTH_WEBAUTHN_RP_NAME`
- `AUTH_WEBAUTHN_RP_ID`
- `AUTH_WEBAUTHN_ORIGIN`
- `AUTH_WEBAUTHN_USER_VERIFICATION`
- `AUTH_WEBAUTHN_AUTHENTICATOR_ATTACHMENT`
- `AUTH_WEBAUTHN_TIMEOUT_MS`
- `AUTH_RISK_ENGINE_MODE`
- `AUTH_REQUIRE_WEBAUTHN_FOR_ADMIN_STATE_CHANGES`
- `AUTH_REQUIRE_WEBAUTHN_FOR_ADMIN_SECURITY_CHANGES`
- `AUTH_SENSITIVE_ACTION_POLICY_ENABLED`
- `AUTH_SENSITIVE_ACTION_POLICY_ROLLBACK`

New broad MFA flags requested by the full program are not introduced in this safety slice because the repository already has live flags for the existing challenge path, and adding unused production config would increase ambiguity without changing behavior safely.

## Files Touched

- `docs/security/aura-way-mfa-implementation.md`
- `server/routes/authRoutes.js`
- `server/controllers/authController.js`
- `server/tests/authRoutes.integration.test.js`

## Rollback Plan

Rollback this slice by restoring the prior auth route middleware and `syncSession` persistence behavior. That is safe mechanically but not recommended because it reopens browser-session issuance before trusted-device/passkey verification.

Safer operational rollback is to keep this code and set challenge enforcement to `AUTH_DEVICE_CHALLENGE_MODE=off` while investigating any unexpected login issues.

## Test Commands

Baseline before change:

```sh
npm --prefix server test -- --runTestsByPath tests/authRoutes.integration.test.js --forceExit
```

Post-change verification:

```sh
npm --prefix server test -- --runTestsByPath tests/authRoutes.integration.test.js --forceExit
npm run security:auth
```
