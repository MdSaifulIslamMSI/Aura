# Auth Shield Rollout

## Stages

Stage 0: code merged, `AUTH_SHIELD_ENABLED=false`.

Stage 1: enable shadow mode in staging:

```env
AUTH_SHIELD_ENABLED=true
AUTH_SHIELD_SHADOW_MODE=true
```

Stage 2: review `authshield.decision` audit events for admin/payment/auth/order/listing/upload actions.

Stage 3: enable fail-closed behavior only for critical configured actions.

Stage 4: enable step-up for critical actions:

```env
AUTH_SHIELD_STEP_UP_ENABLED=true
```

Stage 5: enable DPoP proof for selected trusted clients:

```env
AUTH_SHIELD_DPOP_ENABLED=true
```

Stage 6: expand resource resolvers and route integrations.

Stage 7: production rollout with dashboards, alerting, and incident rollback.

## Rollback

Immediate rollback flags:

```env
AUTH_SHIELD_ENABLED=false
AUTH_SHIELD_DPOP_ENABLED=false
AUTH_SHIELD_STEP_UP_ENABLED=false
```

These leave existing auth, admin, payment, checkout, upload, AI, mobile, desktop, and public routes on their previous controls.

## Operational Checks

- Confirm request IDs are present.
- Confirm audit events contain hashes, not raw identifiers.
- Confirm critical deny/step-up responses use safe public errors.
- Confirm public read latency does not change.
- Confirm replay denials are not caused by client retries missing fresh nonces.

## Known Limitations

- DPoP is implemented as a server verifier and disabled-by-default frontend placeholder, not a globally rolled-out client signing protocol.
- Relationship checks are local and intentionally simple. OpenFGA/Zanzibar can be added behind `relationshipAuthz.can`.
- Policy is local and testable. OPA can be added behind `policyAdapter.evaluate`.
- Redis is optional; replay and step-up use in-memory fallback only for local/test safety.
