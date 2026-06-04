# Aura Way MFA

Last updated: 2026-06-04

Aura MFA is a feature-flagged second-factor layer for login and sensitive actions. It supports passkeys, authenticator app TOTP, and single-use recovery codes.

## Factors

- Passkey: WebAuthn platform credential verified through the existing trusted-device challenge service.
- TOTP: RFC 6238 six-digit authenticator app code. Secrets are encrypted at rest and hidden from default Mongo projections.
- Recovery code: one-time backup code stored only as an HMAC digest.

## Policy

- Buyers can enroll voluntarily when MFA is enabled.
- Admin and seller requirements are controlled by `MFA_REQUIRED_FOR_ADMINS` and `MFA_REQUIRED_FOR_SELLERS`.
- High-risk login policy can require MFA when the account has an enrolled factor.
- Sensitive actions call the fresh-MFA middleware and receive a step-up challenge when the current session is stale.

## Session Safety

MFA challenge responses do not create final browser sessions. A final browser session is issued only after a valid factor proof consumes the one-time challenge.

## Operations

Use the implementation note for rollout and verification: `docs/security/aura-way-mfa-implementation.md`.
