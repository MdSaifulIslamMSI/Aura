# Security Architecture

This is the target-state security architecture for the final hardening plan. It is a design map, not proof that every control is currently implemented.

## Proof Standard

Every security box must map to evidence before it is treated as production-ready:

| Layer | Prevent | Detect | Respond | Evidence |
|---|---|---|---|---|
| Edge | CDN, WAF, origin protection, rate limits | WAF and edge logs | Block rule or origin lockdown | Edge config, tests, alert record |
| Auth | MFA, passkeys/trusted device, session rotation | Auth telemetry and anomaly rules | Revoke session/token, lock account | Auth tests, logs, playbook |
| App | Headers, CORS, CSRF, validation, safe egress | Structured app logs | Hotfix branch, kill switch, rollback | Unit tests, CI reports |
| Upload | Type policy, magic bytes, malware scan | Upload security telemetry | Quarantine, block, alert | Upload tests, ClamAV/YARA reports |
| Data | TLS, encryption, tenant checks, backups | DB audit logs | Restore, revoke access, retention action | Restore drill, access review |
| Runtime | Non-root, read-only FS, resource limits | Falco/runtime detections | Restart, isolate, rollback | Runtime policy, alert evidence |
| Supply chain | SAST, SCA, secrets, SBOM, container scan | CI failure and artifact reports | Block merge, rotate secret, patch | Workflow run artifacts |
| Threat Modeling | STRIDE, abuse cases, trust boundaries, risk review | Risk register drift and high-risk change review | Manual security review and backlog owner | Threat model, risk register, control map |
| Zero Trust Service Mesh | mTLS, service identity, internal authz, egress allowlist | Service authz and egress denial logs | Revoke service account, isolate segment | Mesh/network/IAM config, policy tests |
| IaC Security | Checkov, tfsec, Terrascan, Trivy config scans | IaC report artifacts and posture findings | Fix, rollback infra change, accept risk | CI artifacts, cloud posture review |
| Artifact Provenance | SBOM, provenance, Cosign/Sigstore signing, action pins | Signature/provenance verification logs | Block deploy, rebuild, rotate token | SBOM, attestation, signature evidence |
| Data Governance | Classification, DLP, retention, right-to-delete, tokenization | DLP alerts and sensitive-read audit logs | Purge, legal hold, user notification | Data flow map, deletion/export proof |
| Abuse Detection | ATO, impossible travel, spraying, signup/OTP abuse rules | Fraud/auth anomaly events | Step-up, lock, rate limit, edge block | Detection rules and abuse playbooks |
| Vulnerability Loop | Scheduled scans, CVE triage, patch SLA, retest | Weekly review and aged-risk dashboards | Hotfix, dependency override, compensating control | Backlog, scanner rerun, risk acceptance |
| Security Testing | Fuzzing, auth bypass, tenant, SSRF, upload, business logic tests | Test failures and coverage trend | Block merge and add regression test | Security test suite reports |
| Post-Incident Review | Severity, on-call, timeline, forensics, tabletop drills | Incident metrics and action item tracking | Lessons learned, follow-up fixes | Postmortem, evidence bundle, drill record |

See [control-gap-tracker.md](./control-gap-tracker.md) for the current threat-to-evidence traceability map.

## Enterprise 10/10 Overlay

This overlay shows the missing layers required to move from strong SaaS security to a zero-trust, supply-chain-verified, runtime-monitored security program.

```mermaid
flowchart TD
    Threat["Threat Modeling"] --> Assets["Assets"]
    Threat --> Boundaries["Trust Boundaries"]
    Threat --> Abuse["Abuse Cases"]
    Threat --> Stride["STRIDE"]
    Threat --> Risks["Risk Register"]
    Risks --> Controls["Control Gap Tracker"]
    Controls --> Tests["Security Regression Tests"]

    Mesh["Zero Trust Service Mesh"] --> Identity["Service Identity"]
    Mesh --> Mtls["mTLS Between Services"]
    Mesh --> InternalAuthz["Internal API Authorization"]
    Mesh --> Segmentation["Network Segmentation"]
    Mesh --> Egress["Egress Control"]
    Mesh --> ServiceAccounts["Least-Privilege Service Accounts"]

    Runtime10["Runtime Container Security"] --> NonRoot["Non-Root Containers"]
    Runtime10 --> ReadOnly["Read-Only Filesystem"]
    Runtime10 --> Profiles["Seccomp and AppArmor Profiles"]
    Runtime10 --> Limits["CPU, Memory, and PID Limits"]
    Runtime10 --> Falco["Runtime Anomaly Detection"]
    Runtime10 --> Escape["Container Escape Detection"]

    Iac["IaC Security Scanning"] --> Checkov["Checkov"]
    Iac --> Tfsec["tfsec"]
    Iac --> Terrascan["Terrascan"]
    Iac --> K8s["Kubernetes and Compose Scans"]
    Iac --> CloudPosture["Cloud Security Posture Checks"]

    Supply["SBOM, Cosign, and SLSA Provenance"] --> Sbom["SBOM Generation"]
    Supply --> Provenance["SLSA-Style Build Provenance"]
    Supply --> Signing["Sigstore or Cosign Signing"]
    Supply --> Verify["Verify Signature Before Deploy"]
    Supply --> Pinning["Pinned Actions and Docker Images"]

    DataGov["Data Classification and DLP"] --> Classification["Data Classification"]
    DataGov --> Pii["PII Detection"]
    DataGov --> DlpRules["DLP Rules"]
    DataGov --> Retention["Retention Policy"]
    DataGov --> Delete["Right-To-Delete Workflow"]
    DataGov --> Encrypt["Field-Level Encryption and Tokenization"]

    AbuseLayer["Abuse Detection"] --> Ato["Account Takeover Detection"]
    AbuseLayer --> Travel["Impossible Travel"]
    AbuseLayer --> Spray["Password Spraying"]
    AbuseLayer --> Signup["Signup Abuse"]
    AbuseLayer --> Otp["OTP Abuse Rate Limits"]
    AbuseLayer --> Replay["Webhook Replay Protection"]

    Vuln["Vulnerability Management Loop"] --> Scheduled["Scheduled Scans"]
    Vuln --> Weekly["Weekly Review"]
    Vuln --> Cve["CVE Triage"]
    Vuln --> Sla["Patch SLA"]
    Vuln --> Exploit["Exploitability Ranking"]
    Vuln --> Retest["Retesting After Fixes"]

    Incident["Post-Incident Review"] --> Severity["Severity Levels"]
    Incident --> OnCall["On-Call Routing"]
    Incident --> Timeline["Incident Timeline"]
    Incident --> Evidence["Evidence Preservation"]
    Incident --> Forensics["Forensics Logs"]
    Incident --> Notices["Customer/Admin Notification Templates"]
    Incident --> Tabletop["Tabletop Exercises"]
```

## End-to-End Security Architecture

```mermaid
flowchart TD
    User["User, Browser, or Mobile App"] --> DNS["DNS Protection"]
    DNS --> CDN["CDN and DDoS Protection"]
    CDN --> WAF["WAF, Bot Protection, and Edge Rate Limits"]
    WAF --> Gateway["API Gateway or Reverse Proxy"]

    Gateway --> Headers["Global Security Middleware<br/>Helmet, CSP, HSTS, CORS, request IDs"]
    Headers --> Auth["Authentication Layer"]
    Auth --> Identity["OAuth, MFA, passkeys, secure sessions"]
    Identity --> Authz["Authorization Engine"]
    Authz --> Policy["RBAC, ABAC, owner checks, tenant isolation"]
    Policy --> Backend["Application Backend"]

    Backend --> Validation["Input Validation<br/>XSS, SQLi, SSRF, CSRF, path traversal controls"]
    Backend --> Uploads["Upload Security Pipeline"]
    Backend --> Jobs["Background Jobs and Cron Workers"]
    Backend --> Cache["Redis or Runtime Cache"]
    Backend --> Database[("Database")]
    Backend --> Storage[("Object Storage")]
    Backend --> External["External APIs and Webhooks"]

    Uploads --> Size["Size Limit"]
    Size --> Extension["Extension and Double-Extension Check"]
    Extension --> Mime["MIME Check"]
    Mime --> Magic["Magic Byte Check"]
    Magic --> Malware["Malware Scan"]
    Malware --> Quarantine["Quarantine"]
    Quarantine --> Clean["Clean File Promotion"]
    Clean --> Storage

    Database --> DbTls["TLS Connections"]
    Database --> DbEncryption["Encryption at Rest"]
    Database --> DbAuthz["Row-Level Security or Owner Checks"]
    Database --> DbAudit["Database Audit Logs"]
    Database --> Backups["Encrypted Backups and Restore Tests"]

    Storage --> SignedUrls["Signed URLs"]
    Storage --> Dlp["Metadata Stripping and Privacy Controls"]

    Secrets["Secrets Manager"] --> Backend
    Secrets --> Jobs
    Secrets --> Pipeline["CI/CD Pipeline"]

    Developer["Developer"] --> Git["Git Repository"]
    Git --> Pipeline
    Pipeline --> Tests["Unit and Security Tests"]
    Pipeline --> Sast["SAST: Semgrep or CodeQL"]
    Pipeline --> Sca["SCA: npm audit and audit-ci"]
    Pipeline --> SecretScan["Secret Scan: Gitleaks"]
    Pipeline --> Trivy["Trivy Filesystem, Config, and Image Scans"]
    Pipeline --> Zap["DAST: OWASP ZAP Baseline"]
    Zap --> Gate{"All security gates passed?"}
    Gate -- "No" --> Block["Block Merge"]
    Gate -- "Yes" --> Artifact["Signed Build Artifact"]
    Artifact --> Staging["Staging Deploy"]
    Staging --> Production["Production Deploy"]
    Production --> Backend

    Backend --> AppLogs["Structured Application Logs"]
    Auth --> AppLogs
    WAF --> EdgeLogs["Edge Security Logs"]
    Uploads --> UploadLogs["Upload Security Logs"]
    DbAudit --> Siem["SIEM or Log Analytics"]
    AppLogs --> Siem
    EdgeLogs --> Siem
    UploadLogs --> Siem

    Siem --> Alerts["Security Alerts"]
    Alerts --> Response["Incident Response Playbooks"]
    Response --> Disable["Disable Token or Session"]
    Response --> EdgeBlock["Block IP or Rule at Edge"]
    Response --> Rollback["Rollback Deploy"]
    Response --> Notify["Notify Admins"]
    EdgeBlock --> WAF
    Rollback --> Production
```

## Simplified Runtime View

```mermaid
flowchart LR
    User["User"] --> Edge["CDN, DDoS, WAF, and Bot Controls"]
    Edge --> Gateway["API Gateway or Reverse Proxy"]
    Gateway --> Auth["Auth and MFA"]
    Auth --> Authz["Authorization"]
    Authz --> App["Application Backend"]
    App --> Db[("Database")]
    App --> Store[("Object Storage")]
    App --> Logs["Structured Logs"]
    Logs --> Siem["SIEM or Log Analytics"]
    Siem --> Alert["Alerts"]
    Alert --> Response["Incident Response"]
    Response --> Action["Rollback, Block, Disable, or Notify"]
```

## CI/CD Security Gate

```mermaid
flowchart LR
    Push["Developer Push or Pull Request"] --> Ci["CI Pipeline"]
    Ci --> Test["Tests"]
    Ci --> Audit["Dependency Audit"]
    Ci --> Sast["Static Analysis"]
    Ci --> Secrets["Secret Scan"]
    Ci --> Container["Trivy Filesystem, Config, and Image Scan"]
    Ci --> Zap["OWASP ZAP Baseline"]
    Test --> Decision{"Passed?"}
    Audit --> Decision
    Sast --> Decision
    Secrets --> Decision
    Container --> Decision
    Zap --> Decision
    Decision -- "No" --> Block["Block Merge"]
    Decision -- "Yes" --> Merge["Merge"]
    Merge --> Deploy["Deploy"]
    Deploy --> Watch["24-Hour Production Watch"]
    Watch --> Healthy{"Healthy?"}
    Healthy -- "Yes" --> Run["Keep Running"]
    Healthy -- "No" --> Rollback["Rollback"]
```

## Upload Security Flow

```mermaid
flowchart TD
    Upload["Upload Received"] --> Size["Size Check"]
    Size --> Ext["Extension Check"]
    Ext --> Mime["MIME Check"]
    Mime --> Magic["Magic Byte Check"]
    Magic --> Exec["Executable and Double-Extension Blocklist"]
    Exec --> Scan["Malware Scan"]
    Scan --> Verdict{"Clean?"}
    Verdict -- "No" --> Quarantine["Keep in Quarantine"]
    Quarantine --> Alert["Log and Alert"]
    Verdict -- "Yes" --> Rename["Server-Side Rename"]
    Rename --> Strip["Strip Metadata When Required"]
    Strip --> Store["Move to Final Storage"]
    Store --> SignedUrl["Serve by Signed URL"]
```

## Production Watch and Rollback

```mermaid
flowchart TD
    Deploy["Production Deploy"] --> Watch["First 24-Hour Watch"]
    Watch --> Errors["Error Rate"]
    Watch --> Login["Login Failures"]
    Watch --> Limits["Rate-Limit Spikes"]
    Watch --> Uploads["Upload Scan Failures"]
    Watch --> Webhooks["Webhook Failures"]
    Watch --> Database["Database Health"]
    Watch --> Latency["API Latency"]
    Errors --> Decision{"Incident Threshold Reached?"}
    Login --> Decision
    Limits --> Decision
    Uploads --> Decision
    Webhooks --> Decision
    Database --> Decision
    Latency --> Decision
    Decision -- "No" --> Continue["Continue Monitoring"]
    Decision -- "Yes" --> Rollback["Rollback Last Deploy"]
    Rollback --> Investigate["Open Incident and Investigate"]
```
