# Security Scanning

## Local commands

```sh
npm run quality:secrets
npm run quality:deps
npm run quality:semgrep
npm run quality:trivy
npm run quality:osv
npm run quality:dockerfile
npm run quality:shell
npm run quality:actions
npm run quality:sonar
npm run quality:all
```

Docker-backed commands skip locally with an explicit message when Docker Desktop is not running. CI sets required mode, so missing tooling fails instead of skipping.

## Tool responsibilities

| Tool | Responsibility |
|---|---|
| SonarQube | Quality dashboard, complexity, duplication, hotspots, coverage, gate |
| Semgrep | Repository-specific and OWASP-style source guardrails |
| CodeQL | Deep semantic JavaScript and TypeScript analysis |
| Trivy | Filesystem, dependency, secret, misconfiguration, and image scanning |
| OSV-Scanner | Lockfile vulnerability scan |
| Gitleaks | Secret leak blocker |
| ESLint | JavaScript, JSX, TypeScript, and TSX blocker rules |
| Knip | Dead-code and dependency cleanup report |
| actionlint | Workflow syntax and expression validation |
| Hadolint | Dockerfile lint |
| ShellCheck | Shell safety lint |

## GitHub Code scanning ingestion

- CodeQL runs the `security-and-quality` suite for JavaScript, TypeScript, and GitHub Actions.
- Gitleaks, Semgrep, Trivy filesystem, Trivy image, and Checkov reports are uploaded as separate SARIF categories.
- Dependency Review blocks newly introduced dependencies at high or critical severity.
- Dependabot checks npm workspaces, GitHub Actions, and Docker inputs weekly.

Run `npm run security:sarif-contract` after changing scanner wrappers or security workflows. It verifies that every SARIF producer still has a matching GitHub upload path.

## Existing workflows

- `.github/workflows/security-gates.yml`: Gitleaks, Semgrep, Trivy, IaC scanners, SBOM, ZAP, security tests.
- `.github/workflows/security.yml`: integrated security release gate and image scanning.
- `.github/workflows/quality.yml`: lint, tests, coverage, OSV, hygiene, optional Sonar gate.
- `.github/workflows/codeql.yml`: semantic code scanning.

Reports are generated under ignored `reports/` or `security-reports/` folders and uploaded by CI where useful.
