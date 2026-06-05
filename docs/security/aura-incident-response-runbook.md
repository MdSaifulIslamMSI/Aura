# Aura Security Fabric Incident Response Runbook

## Detect

Review `aura.security_fabric.decision` events for:

- `would_block` in audit-only mode.
- `STEP_UP`, `DENY`, or `LOCKDOWN` decisions.
- `cross_tenant_mismatch`.
- Repeated critical decisions that move incident mode to `heightened`.

## Triage

1. Identify the action, actor, route, tenant, resource, request ID, and risk score.
2. Confirm whether the event came from audit-only or enforcement mode.
3. Check adjacent auth, payment, upload, AI, and admin audit logs.
4. Verify whether the existing route-level auth and sensitive-action middleware behaved as expected.

## Contain

- Keep audit-only enabled while investigating false positives.
- For a confirmed active threat, enable the narrowest safe enforcement flag.
- For tenant mismatch, prefer `AURA_TENANT_GUARD_ENFORCE=true` only after affected routes pass resource tenant IDs.
- For admin abuse, enable brain enforcement on admin routes after confirming MFA and trusted-device signals are available.

## Manual Lockdown

The incident service does not automatically disable user access. To manually enter lockdown behavior, set the relevant incident and enforcement flags through the normal deployment configuration process:

- `AURA_INCIDENT_MODE_ENABLED=true`
- `AURA_SECURITY_FABRIC_AUDIT_ONLY=false`
- `AURA_SECURITY_FABRIC_ENFORCE=true`
- `AURA_SECURITY_BRAIN_ENFORCE=true`
- `AURA_INCIDENT_MODE_ENFORCE=true`

## Communicate

- Open an incident ticket with request IDs and affected actions.
- Notify engineering owners for auth, payments, uploads, AI, or admin depending on the route.
- Preserve logs and do not rotate evidence until incident review is complete.
