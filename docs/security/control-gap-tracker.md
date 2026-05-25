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
| Missing threat rationale | Assets, trust boundaries, abuse cases, STRIDE, risk register | Threat model review | Evidence Check | `security.threat_model.reviewed` | High-risk change without review | `production-regression.md` | Partial |
| Service-to-service compromise | mTLS, service identity, internal authz, segmentation, egress allowlist | Internal API policy tests | Security tests/manual mesh gate | `service.authz.denied`, `egress.private_ip_blocked` | Internal denial spike | `ssrf-attempt.md` | Gap |
| IaC misconfiguration | Trivy config, Checkov, tfsec, Terrascan, cloud posture review | `npm run security:iac` | IaC Security Scan | CI IaC scan artifacts | CI failure or accepted-risk expiry | `production-regression.md` | Partial |
| Artifact tampering | SBOM, provenance, action pins, Cosign/Sigstore signing | `npm run security:supply-chain-pins` | Supply Chain Integrity and SBOM jobs | provenance verification record | Signature/provenance failure | `dependency-zero-day.md` | Partial |
| PII leakage or misuse | Classification, DLP, retention, deletion/export, tokenization | DLP/export/delete drills | Evidence Check and manual review | `dlp.match.detected`, `db.sensitive_read` | DLP or sensitive-read spike | `tenant-data-leak.md` | Gap |
| Vulnerability aging | Scheduled scans, CVE triage, patch SLA, exploitability ranking | Weekly review and retest | Dependency/SAST/Trivy gates | vulnerability review record | SLA breach | `dependency-zero-day.md` | Gap |
| Abuse/fraud behavior | ATO, impossible travel, spraying, signup/OTP abuse, webhook replay | Auth/rate-limit/webhook/business-logic tests | Focused Security Tests | `auth.impossible_travel.detected`, `signup.abuse_detected` | Abuse anomaly threshold | `account-takeover.md` | Partial |
| Security regression depth | API fuzzing, auth bypass, tenant, SSRF, upload, permission matrix | Security regression suite and fuzz report | Focused Security Tests | security test failures | Fuzz finding or bypass failure | `production-regression.md` | Partial |
| Incident evidence gap | Severity, on-call, timeline, evidence preservation, forensics, notification templates, tabletop | Tabletop drill | Manual release evidence | incident timeline and evidence bundle | Postmortem action overdue | Incident response doc | Partial |

## Current Hard Gates

- Tests: `npm test`
- Dependency audit: `npm run security:deps`
- Secret scan: `npm run security:gitleaks` or `npm run security:secrets`
- SAST: `npm run security:semgrep`
- Filesystem/container scan: `npm run security:trivy`, `npm run security:trivy:image`
- IaC evidence scan: `npm run security:iac`
- Supply-chain pin check: `npm run security:supply-chain-pins`
- Header/CORS/CSRF/auth/upload/security tests: root `security:*` scripts
- Evidence file presence: `npm run security:evidence`

## Baseline Run

See [baseline-scan-results.md](./baseline-scan-results.md) for the latest local baseline command results and scanner availability gaps.
