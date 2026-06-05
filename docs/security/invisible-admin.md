# Invisible Admin

Admin routes remain real routes for legitimate operators, but anonymous users should not learn whether the admin surface exists.

## Behavior

- Anonymous admin probes receive a generic not-found response when the fabric cloak is enabled.
- Authenticated non-admin failures are minimized by the production error cloak.
- Legitimate admins still receive actionable step-up responses for MFA, Duo, WebAuthn, passkey, or privileged JIT requirements.
- Dangerous admin actions continue to use existing `protect`, `admin`, `sensitiveActions`, Duo, WebAuthn, and JIT policies.

## Protected Areas

The `/api/admin/*` surface includes user management, payment refunds, data exports, status administration, catalog operations, email ops, fraud, abuse, emergency controls, and operational diagnostics.

## Rollback

Set `INVISIBLE_CLOAK_ADMIN=false` or `INVISIBLE_FABRIC_ENABLED=false`. This only disables the cloak. Existing admin authorization remains active.
