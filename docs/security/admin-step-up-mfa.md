# Admin Step-Up MFA

Last updated: 2026-06-04

Admin and privileged routes keep their existing sensitive-action policy and now layer fresh MFA on top when `MFA_ENABLED=true`.

## Protected Actions

Sensitive actions classified by `server/config/sensitiveActionPolicy.js` can require fresh MFA through `server/middleware/requireFreshMfa.js`.

Examples include:

- Auth factor changes.
- Account recovery changes.
- Admin user state changes.
- Payment, refund, payout, and saved-method mutations.

## Freshness

`MFA_FRESH_WINDOW_SECONDS` controls how long a recent MFA proof remains fresh for sensitive actions. Default is 900 seconds.

## Operator Flow

1. Admin opens a protected action.
2. Server evaluates action policy and session freshness.
3. If fresh MFA is missing, server returns `requiresStepUpMfa=true` and an `mfaChallenge`.
4. Client verifies an allowed factor.
5. Server rotates or refreshes the browser session with MFA AMR metadata and retries the action.

## Rollback

Set `MFA_ENABLED=false` to remove MFA step-up while leaving existing trusted-device, Duo, and admin access policies in place.
