# Security Risk Register

Last updated: 2026-05-25

| ID | Risk | Likelihood | Impact | Current Controls | Owner | Status | Next Evidence |
|---|---|---:|---:|---|---|---|---|
| R-001 | Production MFA/passkey enforcement is not proven from repo-only evidence | Medium | High | Admin policy flags, Duo/OIDC tests, trusted-device services | Security owner | Open | Capture production config and admin MFA test evidence |
| R-002 | Upload malware scanner unavailable in production could block users or allow unsafe files depending on config | Medium | Critical | Upload pipeline fails closed on scan error in code paths, runtime validation script | Platform owner | Open | Prove ClamAV/YARA deployment and quarantine behavior |
| R-003 | Tenant/object authorization may be inconsistent across all controllers | Medium | Critical | IDOR tests, admin tests, controller owner checks | Backend owner | Open | Complete route-by-route owner/tenant matrix |
| R-004 | Raw scan reports may contain sensitive paths or findings if committed | Medium | Medium | Security reports are gitignored, CI artifacts retained separately | Security owner | Accepted | Store reports as CI artifacts, summarize in docs |
| R-005 | Runtime hardening is not fully enforced | Medium | High | Dockerfile and compose assets, Trivy image scan script | Platform owner | Open | Non-root/read-only/capability evidence and Falco deployment |
| R-006 | DB backup and restore proof is absent | Medium | Critical | Backup policy docs | Data owner | Open | Monthly restore drill record |
| R-007 | Branch protection cannot be guaranteed from repo contents alone | Medium | High | CODEOWNERS, security-gates workflow | Repo admin | Open | Screenshot/export of GitHub branch protection settings |
| R-008 | SIEM/alert delivery proof is incomplete | Medium | High | Prometheus alert rules, structured security logs | Observability owner | Open | Alert test evidence and notification route proof |
| R-009 | Image signing/SLSA provenance not implemented | Low | High | SBOM workflow step | Platform owner | Backlog | Add Cosign/Sigstore signing and provenance |
| R-010 | ZAP DAST requires safe staging target and may be skipped without `STAGING_URL` | Medium | High | Guarded ZAP scripts and workflow condition | Release owner | Open | Configure staging URL secret/variable and attach report |
