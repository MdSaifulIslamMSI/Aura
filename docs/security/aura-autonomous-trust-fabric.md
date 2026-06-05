# Aura Autonomous Trust Fabric

Aura Trust Fabric is a backend control plane for action-level authorization and risk decisions. It evaluates sensitive backend actions with identity, role, resource ownership, resource state, step-up state, rate/risk signals, system health, and redacted audit evidence before the controller executes.

## Request Flow

1. Existing route authentication runs first.
2. Route validation runs before Trust Fabric when the route already has a validator.
3. `requireTrustDecision(action, resourceLoader, options)` loads trusted resource metadata from the backend, never from caller-supplied owner fields.
4. `trustFabric.evaluate(...)` returns `ALLOW`, `AUDIT_ONLY`, `CHALLENGE`, `THROTTLE`, `BLOCK`, or `QUARANTINE`.
5. The middleware writes a redacted trust audit event and attaches `req.trustDecision`.
6. Shadow decisions continue to the existing route controller. Enforced deny decisions return a structured response.

## Feature Flags

Safe defaults are resolved in `server/trust/trustContext.js`:

```text
AURA_TRUST_FABRIC_ENABLED=true
AURA_TRUST_FABRIC_MODE=shadow
AURA_TRUST_FABRIC_ENFORCE_OWNERSHIP=false
AURA_TRUST_FABRIC_ENFORCE_ADMIN_STEP_UP=false
AURA_TRUST_FABRIC_ENFORCE_RISK=false
AURA_TRUST_FABRIC_SELF_HEALING_ENABLED=false
AURA_TRUST_FABRIC_AUDIT_ENABLED=true
AURA_TRUST_FABRIC_METRICS_ENABLED=true
```

Missing flags default to enabled shadow mode. If `AURA_TRUST_FABRIC_ENABLED=false`, decisions return `ALLOW` with audit skipped.

## Modes

- `off`: Trust Fabric returns `ALLOW` and does not enforce.
- `shadow`: Trust Fabric evaluates and audits but does not block successful legacy behavior.
- `enforce-safe`: Safe enforcement mode for mapped rules such as ownership mismatch when the matching feature flag is enabled.
- `enforce-sensitive`: Sensitive enforcement mode for explicit step-up and high-risk blocking flags.

## Integrated Routes

Initial route integration is intentionally narrow and additive:

- Order read by ID via timeline and command-center routes.
- Order cancel.
- Customer refund request and admin refund decision.
- Admin product delete.
- Admin user state-changing mutations as the current admin-user sensitive surface.
- Payment webhook processing and payment refund creation.
- Review upload signing/upload.
- AI chat invoke.

## API Deny Responses

Challenge:

```json
{
  "error": "STEP_UP_REQUIRED",
  "requiredStepUp": "PASSKEY",
  "reason": "STEP_UP_REQUIRED",
  "decisionId": "trust_..."
}
```

Block:

```json
{
  "error": "ACCESS_DENIED",
  "reason": "RESOURCE_OWNERSHIP_MISMATCH",
  "decisionId": "trust_..."
}
```

Throttle:

```json
{
  "error": "TRUST_THROTTLED",
  "reason": "SYSTEM_HEALTH_DEGRADED",
  "decisionId": "trust_..."
}
```

## Adding A Protected Action

1. Add a policy in `server/trust/policies/*Policies.js`.
2. Export it through `server/trust/policies/actionRegistry.js`.
3. Add or reuse a trusted resource loader in `server/trust/adapters/`.
4. Add `requireTrustDecision("action.name", loader)` after auth and validation.
5. Add focused tests for shadow behavior, enforcement behavior, audit evidence, and any new resource-state or risk rule.

## What Not To Automate

The self-healing skeleton is disabled by default. Do not automate user deletion, order deletion, refunds, permanent bans, payment state changes, production secret rotation, or schema changes.
