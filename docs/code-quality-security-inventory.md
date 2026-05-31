# Code Quality And Security Inventory

## Repository map

| Surface | Stack | Package manager | Main checks |
|---|---|---|---|
| Root and desktop | Node.js, Electron | npm, `package-lock.json` | `npm test`, `npm run build`, desktop packaging |
| `app/` | React, Vite, Vitest, Playwright, Capacitor | npm, `app/package-lock.json` | `npm --prefix app run lint`, `npm --prefix app test`, `npm --prefix app run build` |
| `server/` | Node.js, Express, Jest | npm, `server/package-lock.json` | `npm test`, `npm run test:server:coverage`, optional exhaustive `npm --prefix server run test:coverage` |
| Infrastructure | Docker, Compose, Kubernetes, Helm, OpenTofu, CloudFormation | Docker and native CLIs | Trivy, Hadolint, Checkov, tfsec, Terrascan, Helm, OpenTofu |
| Delivery | GitHub Actions, Netlify, Vercel, AWS | GitHub Actions | CI, staging smoke, production-on-push, desktop release, mobile release |

## Existing scanner foundation

The repository already had Gitleaks, Semgrep, Trivy filesystem and image scans, Hadolint, Checkov, tfsec, Terrascan, SPDX SBOM generation, npm audit, OWASP ZAP baseline, security-focused tests, and a production release orchestrator.

This foundation adds:

- `sonar-project.properties` and an optional Sonar quality-gate job.
- CodeQL semantic analysis for JavaScript and TypeScript.
- Dedicated OSV lockfile scanning.
- Knip report-mode dead-code analysis.
- actionlint and ShellCheck gates.
- Real frontend and backend LCOV coverage generation. The push gate covers the curated backend regression tracer; the exhaustive backend Jest coverage command remains available for manual or scheduled investigation.
- A single local `npm run quality:all` entry point.

## Detected files

- Dockerfiles: `Dockerfile`, `server/Dockerfile`
- Compose: root runtime files plus `infra/**/docker-compose*.yml`
- Kubernetes: `k8s/base/**`
- Helm: `charts/app/**`
- OpenTofu: `infra/opentofu/**`
- Shell: `scripts/**/*.sh`, `infra/**/*.sh`
- Workflows: `.github/workflows/**`

## Rollout order

1. Block immediately on tests, build, secret leaks, high-confidence Semgrep errors, critical dependency findings, and critical infrastructure findings.
2. Record Knip and React Hooks legacy findings as a triage backlog.
3. Configure `SONAR_HOST_URL` and `SONAR_TOKEN`, then make `Sonar quality gate` a required branch check.
4. Raise new-code coverage thresholds gradually after the first stable Sonar baseline.
