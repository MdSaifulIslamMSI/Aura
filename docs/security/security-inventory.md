# Security Inventory

Last updated: 2026-05-25

This inventory records what is visible in the repository at the time of the zero-trust architecture branch. "Present" means code, config, tests, or docs exist in this repo; it does not prove live production activation.

| Area | Present? | Current Protection | Missing | Risk |
|---|---:|---|---|---|
| Auth | Yes | Firebase token verification, browser session service, CSRF middleware, trusted-device/WebAuthn signals, Duo step-up tests, admin access policy, auth telemetry | Prove production MFA/passkey enforcement and refresh-token rotation from live config | High |
| Uploads | Yes | Upload token checks, size/MIME/extension checks, magic-byte verification, unsafe filename block, malware scan integration, upload telemetry, runtime malware validation script | Prove production ClamAV/YARA availability and quarantine storage policy | Critical |
| API | Yes | Helmet/CSP, CORS allowlist, request IDs, body limits, Redis-backed rate limiting, origin protection, timeout middleware, validation helpers | Per-route proof matrix for every public/admin/AI/search endpoint | High |
| Database | Partial | Mongoose models, owner checks in security tests, Redis health checks, production DB contract audits | DB-level RLS is not applicable to Mongo; document app-layer tenant guarantees, backup encryption, restore evidence, DB audit export | High |
| CI/CD | Yes | Existing security workflow, free scanner workflow, dependency audit scripts, secret scan script, Semgrep, Trivy, ZAP, Hadolint, security test suites | SBOM artifact gate, CODEOWNERS, explicit high-risk manual review gate | Critical |
| Logs | Yes | Request IDs, HTTP request logs, auth security events, upload security telemetry, admin notifications, Prometheus metrics | SIEM export proof, tamper-resistant storage, alert delivery evidence | High |
| Runtime | Partial | Dockerfile, compose files, observability compose, edge assets, Trivy image scan script | Non-root/read-only/container capability proof and Falco runtime detection deployment | High |
| Incident Response | Partial | Incident and emergency docs, rollback workflows, status-watch workflow | Security-specific playbooks mapped to every critical alert | High |

## Edge

- DNSSEC: Not proven in repo. Track with DNS provider evidence.
- CDN: Present via Vercel/Netlify/CloudFront-facing docs and routing config.
- WAF: Present as Cloudflare and AWS WAF planning/config assets.
- Bot protection: Partial; Cloudflare/Turnstile readiness scripts and tests exist.
- Rate limiting: Present; Redis-backed distributed rate limiter plus edge rate-limit config.
- Secure headers: Present; Helmet/CSP in `server/index.js` and header security tests.

## Identity

- MFA: Partial; Duo/OIDC and trusted-device/passkey signals exist. Production enforcement needs environment evidence.
- OAuth/OIDC: Present through Firebase auth and Duo OIDC-related tests.
- Passkeys: Partial; WebAuthn trusted-device service exists.
- Session rotation: Partial; browser session service and token/session tests exist.
- Refresh token rotation: Not fully proven from repo inventory.
- RBAC: Present for admin middleware and route tests.
- ABAC: Partial; admin policy and risk/assurance services exist.
- Tenant isolation: Partial; IDOR tests exist, but a full object-by-object route matrix is still required.
- Admin access controls: Present; strict admin policy supports MFA/passkey/allowlist/fresh-login gates.

## App Security

- Input validation: Present across validators with Zod and route validators.
- Output encoding: Partial; frontend escaping is React-default, XSS sanitizer exists server-side.
- SQL injection protection: Not applicable for Mongo paths; NoSQL injection sanitizer exists.
- XSS protection: Present via CSP and XSS sanitizer; keep tests current.
- SSRF protection: Partial; remote media/catalog tests exist, but a single allowlisted egress client remains a target.
- CSRF protection: Present with CSRF middleware and tests.
- Upload scanning: Present through upload security pipeline and malware scan service.
- File quarantine: Partial; failed scans are blocked, but quarantine storage evidence is not yet complete.

## Data

- Encryption at rest: Not proven in repo; must be collected from Mongo/object-store provider.
- TLS in transit: Partial; production DB/TLS evidence needed.
- Row-level security: Not applicable to Mongo; app-layer owner/tenant checks required.
- Audit logs: Partial; auth/upload/admin/support/status audit-style events exist.
- Backups: Documented as a requirement, not proven.
- Restore drill: Missing evidence.
- Retention/deletion: Partial; soft-delete and account governance paths exist.

## Supply Chain

- Protected branch: Must be enabled in GitHub settings; document evidence after activation.
- CODEOWNERS: Added in this branch.
- SAST: Present via Semgrep scripts/workflows.
- SCA: Present via npm audit and OSV/free scanner scripts.
- Secret scanning: Present via Gitleaks scripts/workflows.
- Container scanning: Present via Trivy scripts/workflows.
- SBOM: Added to security-gates workflow in this branch.
- Image signing: Missing; track as a gap.
- DAST: Present via ZAP baseline script/workflow when staging URL is configured.
- Manual review gate: Partial; CODEOWNERS and branch protection still need GitHub activation.

## Runtime

- Non-root containers: Not proven; server Dockerfile must be reviewed and hardened if needed.
- Read-only filesystem: Not proven.
- Seccomp/AppArmor: Not proven.
- Network policies: Not proven.
- Runtime detection: Missing Falco deployment evidence.

## Monitoring

- Structured logs: Present in backend logger and request pipeline.
- Auth logs: Present through auth security telemetry.
- Upload logs: Present through upload security telemetry.
- Admin audit logs: Partial; admin actions and notifications exist, but a central admin audit evidence query is needed.
- DB audit logs: Not proven.
- SIEM: Not proven.
- Alerts: Partial; Prometheus alert files exist for login/upload security.
- Incident playbooks: Added in this branch.
