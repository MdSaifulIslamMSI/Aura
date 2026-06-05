# Aura Sensitive Actions

The registry lives in `server/security/actionSensitivityRegistry.js`.

## Sensitivity Levels

- `LOW`: routine events such as logout.
- `MEDIUM`: sensitive reads, uploads, AI chat, or tenant reads.
- `HIGH`: data export, trusted-device enrollment, checkout, and tenant writes.
- `CRITICAL`: MFA disable, admin role/user deletion, security config changes, refunds, payouts, data delete, AI tool execution, and signed payment webhooks.

## Required Fields

Each action includes:

- `action`
- `sensitivity`
- `requiresAuth`
- `requiresTenant`
- `requiresFreshMfa`
- `requiresTrustedDevice`
- `requiresAudit`
- `defaultDecision`
- `description`

## Critical Action Rule

Critical actions must require fresh MFA or include a documented exception. The current documented exception is `payment.webhook.process`, because webhooks are machine-authenticated by provider signature verification rather than user MFA.

## Route Coverage

Initial audit-only integration covers:

- Admin user update and delete routes.
- Admin status component and incident routes.
- Payment webhooks, checkout mutation, refunds, and payout mutations.
- Analytics data export.
- Review media upload paths.
- AI chat creation and sensitive AI tool execution.

Public product listing and normal browsing routes are intentionally excluded.
