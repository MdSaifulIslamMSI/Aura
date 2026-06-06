# Trust Fabric Rollback

Trust Fabric is feature-flagged so rollback should start with configuration, not code.

## Fast Rollback

Set:

```text
AURA_TRUST_FABRIC_MODE=shadow
AURA_TRUST_FABRIC_ENFORCE_OWNERSHIP=false
AURA_TRUST_FABRIC_ENFORCE_ADMIN_STEP_UP=false
AURA_TRUST_FABRIC_ENFORCE_RISK=false
AURA_TRUST_FABRIC_SELF_HEALING_ENABLED=false
```

If audit volume is causing operational trouble, set:

```text
AURA_TRUST_FABRIC_AUDIT_ENABLED=false
```

Only disable the whole system if necessary:

```text
AURA_TRUST_FABRIC_ENABLED=false
```

## Validation

After rollback:

1. Confirm successful order read/cancel, upload, payment webhook, admin, and AI routes.
2. Confirm logs no longer show enforced `BLOCK`, `CHALLENGE`, or `THROTTLE` from Trust Fabric.
3. Run the closest available backend smoke tests.
4. Keep shadow audit on when possible so evidence is preserved.
