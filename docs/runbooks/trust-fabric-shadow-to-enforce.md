# Trust Fabric Shadow To Enforce

Move from shadow to enforcement in small, reversible steps.

## Prerequisites

- Focused Trust Fabric tests are green.
- Existing auth, checkout, upload, admin, payment, and AI smoke tests are green.
- Audit events are redacted and usable.
- Redis is healthy for distributed signal tracking in multi-instance environments.

## Step 1: Shadow

Use:

```text
AURA_TRUST_FABRIC_ENABLED=true
AURA_TRUST_FABRIC_MODE=shadow
```

Watch `trust.fabric.decision` for at least one normal traffic cycle. Investigate false positives before enforcement.

## Step 2: Enforce Safe

Use:

```text
AURA_TRUST_FABRIC_MODE=enforce-safe
AURA_TRUST_FABRIC_ENFORCE_OWNERSHIP=true
```

Start with ownership mismatch and duplicate webhook/idempotency controls. Monitor 403s and customer support signals.

## Step 3: Enforce Sensitive

Use:

```text
AURA_TRUST_FABRIC_MODE=enforce-sensitive
AURA_TRUST_FABRIC_ENFORCE_ADMIN_STEP_UP=true
```

Enable high-risk blocking separately:

```text
AURA_TRUST_FABRIC_ENFORCE_RISK=true
```

Only enable risk enforcement after confirming thresholds against shadow evidence.
