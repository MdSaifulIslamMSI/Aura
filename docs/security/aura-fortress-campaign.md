# Aura Fortress Campaign

Aura Fortress is the production security campaign for turning Aura from secure code into a security-operated commerce platform. The campaign is sequenced so each layer adds enforceable controls, telemetry, and verification before the next layer depends on it.

## Mission

Every code change is scanned, every sensitive action is authorized, every incident is visible, every sensitive configuration item is controlled, every deploy is reversible, every user-data flow is known, and every major attack path has a defense.

## Campaign Tracks

| Order | Track | Mission | Evidence |
| ---: | --- | --- | --- |
| 1 | PQC readiness | Inventory crypto, block unsafe crypto drift, document rollback-safe PQC posture. | `npm run security:pqc`, Post-Quantum Security CI, PQC runbooks |
| 2 | Identity fortress | Require phishing-resistant admin proof, fresh step-up for sensitive actions, session/device trust, and auth audit logs. | Auth middleware tests, admin WebAuthn policy, auth security events |
| 3 | Supply-chain shield | Block dependency, credential-leakage, GitHub Actions, Docker image, and lockfile compromise. | OSV, Trivy, Gitleaks, Semgrep, dependency review, pinning checks |
| 4 | Runtime hardening | Harden TLS, runtime config, MongoDB, Redis, proxy headers, backups, and log hygiene. | Runtime audits, deployment contracts, restore tests |
| 5 | Detection command center | Surface errors, logs, metrics, traces, uptime, incidents, and security events. | Status dashboards, telemetry pipelines, alert checks |
| 6 | Zero-trust core | Evaluate role, ownership, tenant, device, risk, and step-up proof on sensitive requests. | Access-control tests, sensitive-action policy, audit trails |
| 7 | Attack simulation lab | Prove controls with safe auth, rate-limit, upload, webhook, ZAP, and privilege-escalation tests. | Security test suites and scan artifacts |
| 8 | Governance and resilience | Add data inventory, privacy controls, compliance evidence, disaster recovery, and release gates. | Governance docs, DR runbooks, release summaries |

## Current Implementation Slice

The previous branch started Track 2 after the PQC merge:

- Production admin state-changing actions require fresh WebAuthn step-up by default through `AUTH_REQUIRE_WEBAUTHN_STEP_UP_FOR_ADMIN_STATE_CHANGES`.
- Admins without a registered WebAuthn credential fail closed before high-risk state changes when that policy is enabled.
- Review upload writes are classified as sensitive actions, so stale sessions must re-authenticate before upload submission.
- Existing Duo step-up remains available as an additional admin state-change gate when enabled, but WebAuthn step-up is the phishing-resistant control.

This branch advances Track 6 and Track 8:

- Central sensitive-action classification and decision output in `server/config/sensitiveActionPolicy.js` and `server/security/sensitiveActionPolicy.js`.
- Critical admin WebAuthn decisions now flow through the central policy engine.
- Reusable middleware exists for route-level sensitive action adoption.
- Zero-trust resource authorization helpers exist for owner, tenant, role, and admin override checks.
- Audit events use safe redaction and IP/user-agent minimization through `server/services/securityAuditService.js`.
- Non-destructive backup/restore verification exists at `scripts/smoke/backup-restore-check.mjs`.

## Rollout Contract

| Environment | Default | Operator Override |
| --- | --- | --- |
| Production | WebAuthn step-up required for admin state changes. | Disable `AUTH_REQUIRE_WEBAUTHN_STEP_UP_FOR_ADMIN_STATE_CHANGES` only for emergency rollback. |
| Non-production | Compatible with existing smoke accounts. | Enable `AUTH_REQUIRE_WEBAUTHN_STEP_UP_FOR_ADMIN_STATE_CHANGES` to test enforcement. |

## Verification

Run the focused identity fortress gate:

```sh
npm --prefix server test -- --runTestsByPath tests/authMiddleware.webauthnStepUp.test.js tests/authMiddleware.continuousAccess.test.js tests/loginRuntimeEnforcementPolicy.test.js tests/authSecurityTelemetryService.test.js --forceExit
```

Run broader auth/security checks before merging:

```sh
npm test
npm run security:free-stack
```

Run this branch's focused policy and DR checks:

```sh
npm --prefix server test -- --runTestsByPath tests/sensitiveActionPolicy.test.js tests/sensitiveActionMiddleware.test.js tests/authorizationPolicy.test.js tests/securityAuditService.test.js tests/disasterRecoveryRunbook.test.js tests/authMiddleware.webauthnStepUp.test.js tests/authSecurityTelemetryService.test.js --forceExit
```
