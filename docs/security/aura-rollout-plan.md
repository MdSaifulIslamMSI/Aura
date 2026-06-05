# Aura Security Fabric Rollout Plan

## 1. Local Audit-Only

- Enable `AURA_SECURITY_FABRIC_ENABLED=true`.
- Keep `AURA_SECURITY_FABRIC_AUDIT_ONLY=true`.
- Enable `AURA_SECURITY_BRAIN_ENABLED=true`.
- Run focused tests and inspect `would_block` events.

## 2. Staging Audit-Only

- Deploy audit-only flags to staging.
- Exercise admin, payment, upload, AI, data export, and status incident flows.
- Confirm no response shape changes.

## 3. Production Audit-Only

- Deploy audit-only flags to production.
- Monitor event volume, risk scores, and false positives.
- Keep enforcement flags disabled.

## 4. Admin-Only Step-Up Enforcement

- Set `AURA_SECURITY_FABRIC_AUDIT_ONLY=false`.
- Set `AURA_SECURITY_FABRIC_ENFORCE=true`.
- Set `AURA_SECURITY_BRAIN_ENFORCE=true`.
- Start with admin routes after MFA/trusted-device telemetry is verified.

## 5. Payment and Refund Enforcement

- Enable enforcement for refund and payout actions after webhook and payment tests pass.
- Confirm provider webhook signatures remain the primary webhook authority.

## 6. Tenant Isolation Enforcement

- Pass resource tenant IDs for selected tenant routes.
- Set `AURA_TENANT_GUARD_ENFORCE=true`.
- Monitor 403s and tenant mismatch audit events.

## 7. Incident Mode Enforcement

- Enable incident mode only after operational runbooks are rehearsed.
- Keep manual lockdown as an explicit operator action.
