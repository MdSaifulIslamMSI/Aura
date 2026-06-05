# Aura ALIEN OTP Shield

ALIEN OTP means Adaptive, Latent, Invisible, Ephemeral, Non-Replayable OTP.

It is not an SMS or email OTP replacement. It is a feature-flagged sensitive-action shield that issues a short-lived action challenge, asks the browser to sign it with an enrolled passkey/WebAuthn credential, binds the proof to the current user/session/device/action/resource/tenant context, evaluates risk, then consumes the challenge once.

## Flow

```txt
authenticated user
-> one-time action challenge
-> passkey/WebAuthn proof
-> optional device-bound session proof
-> risk engine
-> existing RBAC/ABAC/tenant policy
-> consume challenge once
-> allow or deny
```

## Feature Flags

```env
ALIEN_OTP_ENABLED=false
ALIEN_OTP_LOGIN_ENABLED=false
ALIEN_OTP_SENSITIVE_ACTIONS_ENABLED=false
ALIEN_OTP_DEVICE_BOUND_ENABLED=false
ALIEN_OTP_DPOP_COMPAT_ENABLED=false
ALIEN_OTP_RISK_ENGINE_ENABLED=false
ALIEN_OTP_STRICT_MODE=false
ALIEN_OTP_AUDIT_ENABLED=true
ALIEN_OTP_CHALLENGE_TTL_SECONDS=60
ALIEN_OTP_MAX_FAILURES_PER_WINDOW=5
VITE_ALIEN_OTP_ENABLED=false
```

- Disabled: old behavior continues.
- Enabled, non-strict: proofs are verified and audited when present; missing or invalid proof does not block existing production behavior.
- Strict mode: missing, invalid, expired, wrong-context, or replayed proof blocks protected actions.

## Challenge Contract

Challenges include a random nonce, user ID, tenant ID, session ID, device ID, action, resource ID, risk level, request ID, issued time, expiry time, and one-time use state.

The server returns only public challenge material:

```json
{
  "challengeId": "alien_ch_x",
  "publicChallenge": "...",
  "expiresAt": "...",
  "webauthnOptions": {}
}
```

## Protected Surface

ALIEN OTP is composed into `server/middleware/routeSecurityGuards.js`, so it starts with routes already classified as sensitive. Examples include admin user changes, payment refunds/payouts, auth factor changes, data export, upload writes, moderation actions, API-key style actions, and secret rotation.

## Known Limitations

This does not make the app unhackable.
This does not replace secure coding.
This does not protect compromised backend secrets.
This does not protect a fully compromised user device.
This reduces phishing, replay, stolen-session, and unauthorized sensitive-action risk.
