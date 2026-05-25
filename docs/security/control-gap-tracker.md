# Control Gap Tracker

Last updated: 2026-05-25

This tracker connects threats to controls, tests, CI gates, logs, alerts, playbooks, and evidence. A control is not production-complete until every column has a concrete artifact.

| Threat | Prevent Control | Test | CI Gate | Log/Event | Alert/Detection | Playbook | Evidence Status |
|---|---|---|---|---|---|---|---|
| Account takeover | Login throttling, MFA/trusted-device/admin step-up | `npm run security:auth` | `security-gates.yml` tests | `auth.login.failed`, `auth.session.revoked` | Failed login spike | `account-takeover.md` | Partial |
| Tenant data leak | Owner/tenant checks and admin policy | `npm run security:idor` | `security-gates.yml` tests | `tenant.cross_access.denied` | Tenant denial spike | `tenant-data-leak.md` | Partial |
| Upload malware | Magic-byte check and malware scan | `npm run security:malware-runtime` | `security-gates.yml` tests | `upload.malware_detected`, `upload.scan_failed` | Malware/scan failure | `malware-upload.md` | Partial |
| Secret leak | Gitleaks and redaction policy | `npm run security:secrets` | Gitleaks job | `secret.scan.detected` from CI | CI failure | `secret-leak.md` | Partial |
| Dependency compromise | npm audit, OSV, Trivy, SBOM | `npm run security:deps` | dependency/SBOM jobs | CI scanner results | CI failure | `dependency-zero-day.md` | Partial |
| SSRF | Safe egress allowlist and private IP block | Egress/remote-ref security tests | Semgrep/security tests | `egress.private_ip_blocked` | SSRF block spike | `ssrf-attempt.md` | Gap |
| Webhook forgery/replay | Signature/timestamp/event ID checks | `npm run security:webhooks` | security tests | `webhook.signature_invalid`, `webhook.replay_detected` | Signature failure spike | `production-regression.md` | Partial |
| Admin abuse | Admin MFA/passkey/fresh login and audit logs | `npm run security:admin` | security tests/CODEOWNERS | `admin.action.performed`, `admin.break_glass.used` | Admin export/role-change | `admin-abuse.md` | Partial |
| Runtime compromise | Non-root/read-only/cap drops/Falco | Trivy image scan, runtime policy review | Trivy image job | Falco runtime events | Runtime suspicious behavior | `production-regression.md` | Gap |
| Backup destruction | Encrypted immutable backups and restore drills | Restore drill | Manual release evidence | Backup audit log | Backup deletion/change | `ransomware-backup-restore.md` | Gap |

## Current Hard Gates

- Tests: `npm test`
- Dependency audit: `npm run security:deps`
- Secret scan: `npm run security:gitleaks` or `npm run security:secrets`
- SAST: `npm run security:semgrep`
- Filesystem/container scan: `npm run security:trivy`, `npm run security:trivy:image`
- Header/CORS/CSRF/auth/upload/security tests: root `security:*` scripts
- Evidence file presence: `npm run security:evidence`

## Baseline Run

See [baseline-scan-results.md](./baseline-scan-results.md) for the latest local baseline command results and scanner availability gaps.
