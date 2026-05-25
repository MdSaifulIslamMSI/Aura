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

## High-Risk Change Rule

Changes touching auth, admin, uploads, payments/webhooks, secrets, deployment, migrations, tenant access, or security workflows require:

- Security inventory update when the surface changes.
- Focused security test or scanner proof.
- CODEOWNERS/manual review after branch protection is enabled.
- Rollback or hotfix path documented before production deploy.
