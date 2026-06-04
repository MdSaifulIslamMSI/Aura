# Aura Way MFA Implementation Note

Last updated: 2026-06-04

## Scope

This implementation adds feature-flagged MFA to the existing Aura auth stack without replacing Firebase, legacy bearer auth, trusted-device challenges, Duo, or enterprise OIDC. The default rollout state is rollback-safe: MFA is disabled unless `MFA_ENABLED=true`.

## Server Architecture

- `server/config/mfaConfig.js` resolves and validates MFA flags, challenge TTLs, freshness windows, and the TOTP encryption key.
- `server/models/User.js` now stores public MFA state, TOTP enrollment metadata, passkey metadata, and recovery-code readiness while marking encrypted TOTP secrets and passkey secret material `select: false`.
- `server/services/mfaPolicyService.js` decides login and sensitive-action MFA requirements by role, risk, available methods, and freshness.
- `server/services/mfaChallengeService.js` issues one-time opaque MFA challenges with Redis storage and non-production memory fallback.
- `server/services/totpMfaService.js` implements RFC 6238 TOTP locally, encrypts secrets with AES-256-GCM, returns QR/manual setup payloads, and only enables TOTP after a valid code.
- `server/services/recoveryCodeService.js` and `server/services/authRecoveryCodeService.js` support single-use recovery codes for MFA login and backup regeneration after either passkey or TOTP enrollment.
- `server/controllers/mfaController.js` owns security-center state, TOTP setup/verify/disable, passkey register/login/remove, step-up challenges, and MFA recovery-code verify/regenerate.
- `server/middleware/requireFreshMfa.js` plugs MFA freshness into sensitive actions through `server/middleware/sensitiveActionMiddleware.js`.

## Auth Flow

1. Primary auth succeeds through Firebase or legacy bearer verification.
2. `/api/auth/sync` loads or creates the user profile.
3. MFA login policy evaluates the user, role, risk state, enabled flags, and enrolled factors.
4. If MFA is not required, Aura creates the final browser session and returns `status: "authenticated"`.
5. If MFA is required, Aura returns `status: "mfa_challenge_required"` with `mfaChallenge` and `mfaPolicy`; no final browser session is minted.
6. The client verifies one allowed factor through `/api/auth/mfa/totp/verify-login`, `/api/auth/mfa/passkey/login/verify`, or `/api/auth/mfa/recovery/verify`.
7. Only after a valid MFA proof does Aura consume the challenge and create or rotate the browser session.

Existing trusted-device challenges still work independently. The previous premature session issuance path remains closed: challenge responses do not create final sessions before proof.

## Client Architecture

- `app/src/context/authSessionState.js` now preserves `mfaChallenge` and `mfaPolicy` and treats `mfa_challenge_required` as unauthenticated.
- `app/src/services/api/authApi.js` exposes MFA security-center, TOTP, passkey, step-up, and recovery-code endpoints.
- `app/src/context/AuthContext.jsx` exposes MFA operations and applies successful MFA session payloads.
- `app/src/components/shared/ProtectedRoute.jsx` blocks protected routes while an MFA challenge is pending.
- `app/src/pages/Profile/index.jsx` fetches MFA security-center state for the settings tab.
- `app/src/pages/Profile/components/SettingsSection.jsx` adds passkey registration, TOTP QR/manual setup, and MFA recovery-code controls.

## Feature Flags

Rollback-safe defaults:

```sh
MFA_ENABLED=false
MFA_TOTP_ENABLED=false
MFA_PASSKEY_ENABLED=false
MFA_RECOVERY_CODES_ENABLED=true
MFA_REQUIRED_FOR_ADMINS=false
MFA_REQUIRED_FOR_SELLERS=false
MFA_EMAIL_OTP_FALLBACK_ENABLED=false
MFA_CHALLENGE_TTL_SECONDS=300
MFA_FRESH_WINDOW_SECONDS=900
MFA_SECRET_ENCRYPTION_KEY=
```

`MFA_SECRET_ENCRYPTION_KEY` is required only when TOTP is enabled. Use a high-entropy 32-byte base64/hex value or a strong 32-plus character secret managed by the secret manager.

## API Surface

- `GET /api/auth/mfa`
- `POST /api/auth/mfa/step-up`
- `POST /api/auth/mfa/totp/setup`
- `GET /api/auth/mfa/totp/qr`
- `POST /api/auth/mfa/totp/verify-setup`
- `POST /api/auth/mfa/totp/verify-login`
- `POST /api/auth/mfa/totp/disable`
- `POST /api/auth/mfa/passkey/register/options`
- `POST /api/auth/mfa/passkey/register/verify`
- `POST /api/auth/mfa/passkey/login/options`
- `POST /api/auth/mfa/passkey/login/verify`
- `POST /api/auth/mfa/passkey/remove`
- `POST /api/auth/mfa/recovery/regenerate`
- `POST /api/auth/mfa/recovery/verify`

## Rollout

1. Ship with all MFA flags off.
2. Enable `MFA_ENABLED=true` and `MFA_TOTP_ENABLED=true` in development with a local encryption key.
3. Validate TOTP setup, login challenge, recovery-code verify, and sensitive-action step-up.
4. Enable passkeys where WebAuthn RP ID/origin are configured correctly.
5. Turn on `MFA_REQUIRED_FOR_ADMINS=true` for staging admins.
6. Roll to production admin accounts first, then sellers, then optional buyer enrollment.

Use `docs/security/aura-mfa-staging-rollout-verification.md` for the staging secret, manual device matrix, rollback command, and admin lockout recovery procedure.

## Rollback

- Disable enforcement with `MFA_ENABLED=false`.
- Disable one factor with `MFA_TOTP_ENABLED=false` or `MFA_PASSKEY_ENABLED=false`.
- Keep recovery codes enabled unless incident response requires a temporary freeze.
- Do not delete stored MFA metadata during rollback; keeping it allows re-enable without forcing re-enrollment.

## Verification

Focused server:

```sh
npm --prefix server test -- --runTestsByPath tests/mfaPolicyService.test.js tests/mfaChallengeService.test.js tests/totpMfaService.test.js tests/authRecoveryCodeService.test.js tests/authEnvironment.test.js tests/sensitiveActionMiddleware.test.js tests/authRoutes.integration.test.js --forceExit
```

Staging rollout smoke:

```sh
npm --prefix server test -- --runTestsByPath tests/mfaRolloutSmoke.test.js --forceExit
```

Focused app:

```sh
npm --prefix app test -- authSessionState.test.js authApi.test.js SettingsSection.test.jsx
```

Broad checks:

```sh
npm run security:auth
npm test
npm run lint
npm run build
```
