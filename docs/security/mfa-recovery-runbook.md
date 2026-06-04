# MFA Recovery Runbook

Last updated: 2026-06-04

## User Self-Service

1. User signs in with the primary provider.
2. If MFA is required and the primary factor is unavailable, user selects recovery code.
3. Server verifies the one-time recovery code, consumes it, consumes the MFA challenge, and rotates the browser session.
4. User regenerates backup codes from Profile Settings after a fresh MFA checkpoint.

## Support Handling

- Confirm the account identity through existing support policy before advising on MFA.
- Never ask for a passkey private key, authenticator secret, TOTP code, or unused recovery code.
- If the user has no usable factor, escalate to account recovery policy. Do not bypass MFA from the database ad hoc.
- If recovery codes appear exhausted, ask the user to use another enrolled factor, then regenerate codes.

## Incident Indicators

- Multiple failed `mfa.recovery.used` events.
- Recovery-code regeneration from a new location immediately after password reset.
- Admin or seller accounts without active recovery codes after MFA enrollment.

## Safe Remediation

- Temporarily disable enforcement with `MFA_ENABLED=false` only during an approved incident window.
- Prefer factor rotation over account-level MFA deletion.
- Preserve audit logs and consumed-code records.
