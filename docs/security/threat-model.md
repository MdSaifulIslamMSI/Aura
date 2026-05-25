# Threat Model

Last updated: 2026-05-25

## Assets

- User accounts
- Browser sessions and refresh/session state
- Uploaded files and review media
- PII: name, email, phone, address, IP, device signals
- Payment records and webhook events
- Admin portal and privileged actions
- API keys, signing secrets, webhook secrets, and CI credentials
- MongoDB data and object storage
- Redis cache/session/rate-limit state
- CI/CD pipeline and deploy workflows

## Trust Boundaries

- Internet to CDN/WAF/origin protection
- Edge to API gateway/reverse proxy
- API middleware to route/controller layer
- Authenticated user to authorization policy
- App to MongoDB/Redis/object storage
- App to external APIs and webhooks
- CI to deployment environments
- Admin browser to production controls

## Top Threats

| Threat | Prevent | Detect | Respond | Evidence |
|---|---|---|---|---|
| Account takeover | MFA/passkey/trusted-device policy, login throttling, CSRF/session binding | Auth failure and anomaly logs | Revoke sessions, lock account, notify user | `security:auth`, account takeover playbook |
| Tenant data leak or IDOR | Server-side owner/tenant checks, admin policy | Tenant cross-access denied events | Disable route/feature, hotfix, incident | `security:idor`, risk register |
| Upload malware | Upload token, size/type/magic checks, malware scan | Upload malware and scan-failure telemetry | Quarantine, block, alert | `security:malware-runtime`, malware playbook |
| SSRF to metadata/internal systems | Safe egress helper, private IP block, allowlists | `egress.private_ip_blocked` alert | Block domain, rotate exposed secrets, hotfix | SSRF playbook, egress tests |
| NoSQL/SQL injection | Zod validation, Mongo sanitizer, parameterized queries where SQL exists | Validation error spikes | Patch route, add regression test | security tests and Semgrep |
| XSS/session theft | React escaping, CSP, XSS sanitizer, secure cookies | CSP/report and auth anomaly logs | Revoke sessions, patch vector | headers/CSRF tests |
| Admin abuse | Admin MFA/passkey/fresh login, policy middleware | Admin action logs and export alerts | Suspend admin session, access review | admin security tests, admin abuse playbook |
| Dependency compromise | npm audit, OSV, Semgrep, Trivy, SBOM | CI gates and scanner artifacts | Patch/override, hotfix branch | security-gates workflow |
| Secret leakage | `.gitignore`, Gitleaks, redaction tests | Secret scan failure and leak alerts | Rotate secret, revoke token, audit use | secret leak playbook |
| Backup destruction/ransomware | Immutable encrypted backups, least privilege | Backup deletion/audit alerts | Restore drill, isolate credentials | ransomware restore playbook |

## Abuse Cases

| Abuse Case | Attacker Goal | Control | Detection | Risk |
|---|---|---|---|---|
| Password spraying | Try common passwords across many accounts | Per-IP and per-account throttles, MFA | Failed login velocity by IP/account | R-011 |
| Account takeover | Use stolen credentials or sessions | MFA, trusted device, session revocation | Impossible travel, new device, MFA failure spike | R-001 |
| Tenant object guessing | Read or mutate another tenant's object ID | Server-side owner/tenant checks | `tenant.cross_access.denied` | R-003 |
| Upload bypass | Upload malware or spoof file type | Size, extension, MIME, magic byte, malware scan | `upload.rejected`, `upload.malware_detected` | R-002 |
| SSRF probe | Reach metadata/private services | Safe egress client, private IP and redirect block | `egress.private_ip_blocked` | R-012 |
| Webhook replay | Replay valid payment/provider event | Timestamp, signature, event ID replay cache | `webhook.replay_detected` | R-013 |
| Signup abuse | Create accounts for spam/fraud | Signup rate limits, verification, abuse scoring | `signup.abuse_detected` | R-014 |
| Admin misuse | Export data or change roles without business need | Admin MFA, step-up, policy checks, audit logs | `admin.action.performed`, export/role alerts | R-015 |
| Supply-chain tampering | Modify build, dependency, or artifact | SBOM, provenance, signing, action pins | CI gate failure, attestation verification failure | R-009 |
| Runtime escape | Break out of container or modify filesystem | Non-root, read-only FS, seccomp/AppArmor, cap drop | Falco/container escape rules | R-005 |

## STRIDE Matrix

| STRIDE | Primary Surface | Example Threat | Prevent | Detect | Evidence |
|---|---|---|---|---|---|
| Spoofing | Auth, service-to-service calls | Stolen user token or forged service identity | MFA/session rotation, mTLS/service identity | Auth anomaly, service authz denied | Auth tests, service mesh policy |
| Tampering | CI/CD, uploads, webhooks, database | Alter artifact, upload malware, replay webhook | Signed artifacts, magic bytes, webhook signature | Scanner reports, replay alert | SBOM/provenance, upload/webhook tests |
| Repudiation | Admin actions, deployments | Admin denies sensitive change | Request IDs, admin audit logs, signed CI provenance | Audit log review | Admin audit schema, incident timeline |
| Information disclosure | Tenant data, PII, logs, storage | IDOR, leaked PII, over-broad signed URL | Tenant checks, DLP/redaction, signed URLs | Sensitive read and DLP alerts | Data flow map, access review |
| Denial of service | Login, OTP, uploads, search, webhooks | Resource exhaustion or abuse traffic | Rate limits, request limits, queues | Rate-limit and latency alerts | Rate-limit tests, release watch |
| Elevation of privilege | Admin APIs, internal services | Normal user/admin/service gains higher permission | RBAC/ABAC, step-up, internal authz | Privilege change/admin anomaly alert | Permission tests, audit logs |

## Threat To Risk Register Map

| Threat Area | Risk IDs | Control Evidence |
|---|---|---|
| Account takeover and auth abuse | R-001, R-011, R-014 | Auth tests, abuse detection policy, account takeover playbook |
| Tenant and authorization bypass | R-003, R-016 | IDOR tests, permission matrix, control gap tracker |
| Upload and malware handling | R-002 | Malware runtime validation, upload logs, malware playbook |
| SSRF and egress | R-012 | Egress policy, SSRF tests, SSRF playbook |
| Supply chain and provenance | R-009, R-017 | SBOM, action pin check, provenance policy |
| Runtime/container compromise | R-005, R-018 | Runtime hardening, Falco rules, Trivy image scan |
| Data governance and privacy | R-019 | Data flow map, DLP policy, access review |
| Incident response maturity | R-020 | Incident response doc, postmortem template, tabletop record |

## High-Risk Change Rule

Changes touching auth, admin, uploads, payments/webhooks, secrets, deployment, migrations, tenant access, or security workflows require:

- Security inventory update when the surface changes.
- Focused security test or scanner proof.
- CODEOWNERS/manual review after branch protection is enabled.
- Rollback or hotfix path documented before production deploy.
