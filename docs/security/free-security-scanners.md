# Free Security Scanner Stack

This project uses free/open-source software and GitHub-native features for security checks. Paid SaaS scanners are not required for the post-quantum readiness workflow.

## Tools

| Tool | Free/open-source status | Protects | Local command | CI behavior |
| --- | --- | --- | --- | --- |
| Custom PQC inventory | Local Node.js script | New forbidden crypto, classical-signature migration inventory, TLS policy drift | `npm run security:pqc:inventory` | Runs in `post-quantum-security.yml` and uploads inventory artifacts. |
| Custom PQC policy | Local Node.js script | Blocks unallowlisted blocker crypto findings | `npm run security:pqc:policy` | Fails pull requests and main pushes on policy blockers. |
| Custom PQC deployment proof | Local Node.js script | Controllable-surface evidence for SSH, TLS edge/endpoint, OpenSSL/OQS lab, internal service encryption, backup key-agility, release signing, and provider limitations | `npm run security:pqc:proof` | Runs in `post-quantum-security.yml` and uploads proof artifacts. |
| Custom PQC maturity scorecard | Local Node.js script | Previous/current maturity estimates with provider-dependent caps | `npm run security:pqc:scorecard` | Runs in `post-quantum-security.yml` and uploads scorecard artifacts. |
| Semgrep CE | Free community engine | Static crypto misuse patterns and policy guardrails | `semgrep scan --config security/semgrep/pqc-crypto-policy.yml` | The PQC workflow installs Semgrep CE when available and uploads SARIF; the allowlist-aware Node policy is the CI enforcement gate. |
| CodeQL | GitHub-native for public repos | Code scanning and dataflow findings | Existing `codeql.yml` workflow | Runs on pull requests, main pushes, schedules, and manual dispatch. |
| Trivy | Open-source | Filesystem, dependency, container, and IaC risk | `trivy fs .` or `npm run security:trivy` | Existing free scanner/security workflows run Trivy and upload reports. |
| OSV-Scanner | Open-source | Vulnerable open-source dependencies | `osv-scanner -r .` | Existing free scanner workflow can run it through binary or container. |
| Gitleaks | Open-source | Secret leakage | `gitleaks detect` or `npm run security:gitleaks` | Existing security gates run secret scanning. |
| cryptodeps | Open-source where locally installed | Crypto dependency inventory | `cryptodeps .` | Optional in `npm run security:free-stack:ci`; missing local tools are documented. |

## Local Commands

```sh
npm run security:pqc
npm run security:pqc:proof
npm run security:pqc:scorecard
npm run security:pqc:inventory:strict
npm run security:free-stack
npm run security:secrets
npm run security:deps
```

`npm run security:free-stack` runs the required PQC policy first, then tries optional local scanner binaries. Missing optional tools are warnings in local mode and failures in CI mode.

## CI Commands

The `Post-Quantum Security` workflow runs:

```sh
npm ci
npm run security:pqc:inventory
npm run security:pqc:policy
npm run security:pqc:proof
npm run security:pqc:scorecard:strict
npm run security:pqc:provider-register
python -m semgrep scan --config security/semgrep/pqc-crypto-policy.yml --sarif --output reports/security/semgrep-pqc.sarif .
```

Semgrep installation failure or advisory findings do not disable the Node policy gate. Policy blockers still fail CI through `npm run security:pqc:policy`, which understands the expiring allowlist.

## Reports

Generated reports are written to ignored local artifacts:

```text
reports/security/crypto-inventory.json
reports/security/crypto-inventory.md
reports/security/pqc-policy-check.json
reports/security/pqc-policy-check.md
reports/security/pqc-deployment-proof.json
reports/security/pqc-deployment-proof.md
reports/security/ssh-pqc-readiness.json
reports/security/ssh-pqc-environment-proof.json
reports/security/tls-config-readiness.json
reports/security/tls-endpoint-pqc-readiness.json
reports/security/pqc-lab-smoke.json
reports/security/pqc-lab-benchmark.json
reports/security/internal-service-encryption-check.json
reports/security/internal-service-encryption-evidence.json
reports/security/backup-crypto-agility-check.json
reports/security/backup-pqc-encryption-evidence.json
reports/security/release-signing-readiness.json
reports/security/pqc-provider-register-check.json
reports/security/pqc-maturity-scorecard.json
reports/security/semgrep-pqc.sarif
```
