# Sensitive Action Registry

The canonical registry lives at `server/security/sensitiveActionRegistry.js`.

Each action defines:

- `sensitivity`
- `requiresAuth`
- `requiresFreshAuth`
- `requiresMfa`
- `requiresPasskeyForAdmin`
- `requiresTenantBoundary`
- `requiresOwnerCheck`
- `requiresAudit`
- `rateLimitPolicy`
- `maxRiskAllowed`
- `containmentPolicy`

Critical actions include admin role/permission changes, payment refunds, data exports, MFA/passkey/password/email changes, API key operations, tenant deletion, database maintenance, and webhook configuration.

Aliases map existing route action names, such as `payment.refund.create`, to the canonical registry policy.
