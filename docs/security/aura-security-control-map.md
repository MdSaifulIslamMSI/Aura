# Aura Security Control Map

## NIST CSF 2.0

- Govern: action registry, feature flags, rollout and rollback controls.
- Identify: request context builder, resource and tenant metadata.
- Protect: step-up decisions, tenant guard, trusted-device requirements.
- Detect: risk scoring, audit logging, repeated critical-decision detection.
- Respond: incident mode service and incident response runbook.
- Recover: recovery runbook and rollback flags.

## OWASP ASVS

- V2 Authentication: fresh MFA and trusted-device requirements for critical actions.
- V3 Session Management: session age scoring and session revoke action coverage.
- V4 Access Control: admin action registry and tenant isolation guard.
- V5 Validation: payload size anomaly scoring, no raw secret logging.
- V7 Error Handling and Logging: redacted structured security events.
- V10 Malicious Code: supply-chain and free scanner guidance.
- V13 API Security: route-level middleware for admin, payment, upload, AI, and data export surfaces.

## CISA Zero Trust

- Identity: actor, role, MFA freshness, trusted device.
- Device: trusted-device signal and step-up control.
- Network: hashed IP and user-agent telemetry without raw storage.
- Application: action-sensitive policy engine.
- Data: tenant guard and data export action model.
- Visibility: audit-only telemetry before enforcement.

## CIS Controls

- Inventory and Control of Enterprise Assets: action registry and route mapping.
- Access Control Management: admin and tenant enforcement hooks.
- Audit Log Management: redacted event logger.
- Data Protection: no raw token, cookie, OTP, card, or secret logging.
- Incident Response Management: incident mode and runbooks.
- Application Software Security: tests for risk scoring, redaction, middleware, and registry validation.

## SLSA and OpenSSF

- Supply-chain scripts use existing free tooling where available: `security:free-stack`, `sbom:generate`, `security:auth`, and dependency audit scripts.
- CI should prefer skip-with-evidence behavior when optional local tools are unavailable.
- No paid dependency or secret-bearing scanner configuration is introduced by the fabric.
