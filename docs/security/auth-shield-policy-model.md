# Auth Shield Policy Model

## Decision Priority

1. Missing identity on protected route: deny.
2. Disabled, banned, suspended, or deleted account: deny.
3. Tenant mismatch: deny.
4. Replay detected: deny.
5. Critical action with stale or missing step-up, when step-up is enabled: `step_up_required`.
6. Relationship denied: deny.
7. Role/policy denied: deny.
8. High risk plus sensitive action: step-up when enabled.
9. Policy allow: allow.

## Sensitive Action Registry

The registry lives in `server/security/authShield/sensitiveActionRegistry.js`.

Initial critical/high action families:

- `admin.user.role.update`
- `admin.config.update`
- `payment.refund`
- `payment.payout.update`
- `auth.password.change`
- `auth.mfa.disable`
- `auth.email.change`
- `upload.moderate`

Initial medium action families:

- `order.cancel`
- `listing.update`
- `listing.delete`
- `review.delete`

Aliases map existing route classifications such as `payment.refund.create`, `admin.users.mutate`, and `auth.factor.change` to the new action families.

## Fail-Closed Patterns

Default fail-closed patterns:

```txt
admin.*
payment.*
auth.mfa.*
auth.password.*
auth.email.*
auth.role.*
security.*
```

Fail-closed means a deny/step-up decision still blocks when shadow mode is on.

## Relationship Rules

- Buyer can act on own order.
- Seller can update own listing.
- Seller cannot update another seller listing.
- User can act on own auth/profile resource.
- Support role cannot refund unless admin policy also allows it.
- Admin actions require server-side admin role.
- Tenant mismatch always denies.

## Future Adapter Boundaries

- `relationshipAuthz.can(identity, action, resource, context)` can be replaced or backed by OpenFGA/Zanzibar-style relationship checks.
- `policyDecisionPoint.policyAdapter.evaluate(input)` can be backed by OPA/Rego later.
