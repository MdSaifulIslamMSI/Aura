# Zero-Trust Sensitive Actions

This document describes the current sensitive-action foundation. It is a real enforcement layer, not a claim that Aura is fully secure.

## Enforced Now

- `server/config/sensitiveActionPolicy.js` classifies high-risk admin, payment, upload, recovery, data, and AI routes into bounded action categories.
- `server/security/sensitiveActionPolicy.js` returns structured allow/deny decisions:

```json
{
  "allowed": false,
  "reason": "webauthn_step_up_required",
  "requiredAssurance": ["authenticated", "admin", "recent_auth", "webauthn_registered", "fresh_webauthn_step_up"],
  "action": "admin.users.mutate",
  "riskLevel": "critical",
  "telemetryCode": "security.policy.denied.webauthn_step_up_required"
}
```

- `server/middleware/authMiddleware.js` now routes critical admin WebAuthn state-change checks through the central policy evaluator.
- `server/middleware/sensitiveActionMiddleware.js` lets future routes opt in without duplicating policy logic.
- `server/security/authorizationPolicy.js` provides owner, tenant, role, and admin-override decisions for route-level resource checks.
- `server/middleware/routeSecurityGuards.js` wires route-level sensitive actions and zero-trust owner checks into high-risk admin, payment, order, upload, auth-factor, AI, listing, and support routes.
- `docs/security/route-enforcement-coverage.md` records the route-by-route coverage matrix, and `npm run security:routes:coverage:strict` fails when a discovered dangerous route is missing from the matrix.
- `server/services/securityAuditService.js` records bounded audit events with token, OTP, cookie, webhook secret, raw payload, card-data, IP, and user-agent minimization.

## Rollback Flags

| Flag | Default | Effect |
| --- | --- | --- |
| `AUTH_SENSITIVE_ACTION_POLICY_ENABLED` | `true` | Enables central policy evaluation. |
| `AUTH_SENSITIVE_ACTION_POLICY_ROLLBACK` | `false` | Explicit emergency bypass for policy denials. Use only with incident owner approval. |
| `AUTH_REQUIRE_WEBAUTHN_FOR_ADMIN_STATE_CHANGES` | production `true`, non-production `false` | Requires registered WebAuthn plus fresh WebAuthn step-up for critical admin mutations. |
| `AUTH_REQUIRE_WEBAUTHN_STEP_UP_FOR_ADMIN_STATE_CHANGES` | legacy alias | Backward-compatible alias for state-change enforcement. |
| `AUTH_REQUIRE_WEBAUTHN_FOR_ADMIN_SECURITY_CHANGES` | production `true`, non-production `false` | Requires WebAuthn for critical admin security configuration changes. |
| `AUTH_WEBAUTHN_ADMIN_BREAK_GLASS_ENABLED` | `false` | Allows explicit break-glass only when the request also carries break-glass evidence. |

## Verification

```sh
npm --prefix server test -- --runTestsByPath tests/sensitiveActionPolicy.test.js tests/sensitiveActionMiddleware.test.js tests/authorizationPolicy.test.js tests/securityAuditService.test.js tests/authMiddleware.webauthnStepUp.test.js tests/authSecurityTelemetryService.test.js --forceExit
npm run security:admin
```

## Remaining Work

- Persist audit events to the durable event outbox where route ownership is clear.
- Extend route-specific tenant/store resolvers beyond the owner checks now covering orders, payment methods, and seller listings.
