# Security Risk Register

Last updated: 2026-06-02

| ID | Risk | Likelihood | Impact | Current Controls | Owner | Status | Next Evidence |
|---|---|---:|---:|---|---|---|---|
| R-001 | Production MFA/passkey enforcement is not proven from repo-only evidence | Medium | High | Admin policy flags, Duo/OIDC tests, trusted-device services | Security owner | Open | Capture production config and admin MFA test evidence |
| R-002 | Upload malware scanner unavailable in production could block users or allow unsafe files depending on config | Medium | Critical | Upload pipeline fails closed on scan error in code paths, runtime validation script records EICAR, scanner env contract, and local quarantine behavior | Platform owner | Open | Run staging with `MALWARE_RUNTIME_REQUIRED=true`, `UPLOAD_MALWARE_SCAN_ENABLED=true`, and `CLAMAV_ENABLED=true`; retain ClamAV/YARA and quarantine artifact evidence |
| R-003 | Tenant/object authorization may be inconsistent across all controllers | Medium | Critical | IDOR tests, admin tests, controller owner checks | Backend owner | Open | Complete route-by-route owner/tenant matrix |
| R-004 | Raw scan reports may contain sensitive paths or findings if committed | Medium | Medium | Security reports are gitignored, CI artifacts retained separately | Security owner | Accepted | Store reports as CI artifacts, summarize in docs |
| R-005 | Runtime hardening is not fully enforced | Medium | High | Dockerfile and compose assets, Trivy image scan script | Platform owner | Open | Non-root/read-only/capability evidence and Falco deployment |
| R-006 | DB backup and restore proof is absent | Medium | Critical | Backup policy docs | Data owner | Open | Monthly restore drill record |
| R-007 | Branch protection cannot be guaranteed from repo contents alone | Medium | High | CODEOWNERS, security-gates workflow | Repo admin | Open | Screenshot/export of GitHub branch protection settings |
| R-008 | SIEM/alert delivery proof is incomplete | Medium | High | Prometheus alert rules, structured security logs | Observability owner | Open | Alert test evidence and notification route proof |
| R-009 | Image signing/SLSA provenance not implemented | Low | High | SBOM workflow step | Platform owner | Backlog | Add Cosign/Sigstore signing and provenance |
| R-010 | External staging DAST target needs retained live-environment evidence | Medium | High | Local-preview ZAP report plus scheduled `staging-ops-watch` live staging ZAP baseline with retained artifacts | Release owner | Partial | Confirm the scheduled staging artifact contains a completed `zap-baseline` run and compare local-preview vs staging findings |
| R-011 | Password spraying and account takeover patterns may outpace static login limits | Medium | High | Login throttling, auth telemetry, abuse detection policy | Security owner | Open | Impossible-travel/password-spraying alert test |
| R-012 | SSRF or unsafe egress could reach internal services through new integrations | Medium | Critical | Safe egress policy, private IP block requirements | Backend owner | Open | Metadata IP and redirect-to-private regression tests |
| R-013 | Webhook replay or stale events could mutate payment/order state | Low | High | Webhook signature tests and replay policy | Payments owner | Partial | Event ID replay store evidence |
| R-014 | Signup, OTP, and recovery abuse could create cost or fraud pressure | Medium | Medium | Rate-limit scripts and abuse detection policy | Auth owner | Open | Signup/OTP abuse dashboards and alert drills |
| R-015 | Admin misuse may not be fully investigated without post-incident evidence bundles | Low | Critical | Admin tests, admin abuse playbook, incident response doc | Security owner | Partial | Postmortem template and tabletop evidence |
| R-016 | Permission matrix coverage is incomplete across all user/admin/service actions | Medium | Critical | IDOR/admin tests and control gap tracker | Backend owner | Open | Route-by-route permission matrix |
| R-017 | Mutable workflow or scanner references could weaken build reproducibility | Low | High | Supply-chain pin checker, SBOM, provenance policy | Platform owner | Partial | Cosign signature verification before deploy |
| R-018 | Runtime container escape detection is not proven in production | Low | Critical | Runtime hardening policy and Falco rules | Platform owner | Open | Falco alert drill and container escape detection proof |
| R-019 | PII classification, DLP, retention, deletion, and tokenization evidence is incomplete | Medium | High | Data flow map and data governance policy | Data owner | Open | DLP test, export/delete test, field-level encryption review |
| R-020 | Vulnerability management loop is policy-only until scheduled review evidence exists | Medium | High | Vulnerability management policy, security gates | Security owner | Open | Weekly review record, SLA dashboard, retest artifacts |
| R-021 | IaC baseline findings need triage before Checkov/Terrascan can become hard blocking gates | Medium | High | `npm run security:iac` reports, Trivy config hard gate | Platform owner | Open | Fix or accept S3 logging, IAM constraint, workflow posture, and Dockerfile findings |
