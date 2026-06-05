# ALIEN OTP Rollout

## Phase 1: Shadow Audit

1. Keep `ALIEN_OTP_ENABLED=false` in production.
2. Enable in local or staging with:

```env
ALIEN_OTP_ENABLED=true
ALIEN_OTP_SENSITIVE_ACTIONS_ENABLED=true
ALIEN_OTP_STRICT_MODE=false
ALIEN_OTP_AUDIT_ENABLED=true
VITE_ALIEN_OTP_ENABLED=true
```

3. Exercise non-destructive sensitive actions first, such as security preview, auth factor management, and API-key creation in a test tenant.
4. Confirm `alien.challenge.created`, `alien.challenge.consumed`, `alien.authz.allowed`, and fallback events are present without raw nonce or assertion data.

## Phase 2: Passkey Readiness

1. Confirm MFA passkeys and trusted-device enrollment work on supported browsers.
2. Confirm browser fallback and explicit MFA fallback remain available where WebAuthn is unsupported.
3. Confirm challenge TTL is 30-90 seconds.

## Phase 3: Strict Staging

1. Enable strict only in staging:

```env
ALIEN_OTP_STRICT_MODE=true
```

2. Test protected actions with valid proof, missing proof, wrong resource, replayed challenge, and expired challenge.
3. Confirm old public/product/search/cart routes are unaffected.

## Phase 4: Production Canary

1. Keep strict off initially.
2. Enable audit-only for a small internal operator cohort.
3. Review fallback rate, passkey cancel rate, replay attempts, and strict-mode would-block events.
4. Enable strict only for the smallest safe action set.

## Rollback

Set:

```env
ALIEN_OTP_ENABLED=false
ALIEN_OTP_STRICT_MODE=false
VITE_ALIEN_OTP_ENABLED=false
```

Do not delete passkey, MFA, or trusted-device metadata during rollback.
