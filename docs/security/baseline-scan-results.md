# Baseline Security Check Results

Run date: 2026-05-25
Branch: `security/zero-trust-production-architecture`

## Local Results

| Check | Command | Result | Notes |
|---|---|---|---|
| Evidence manifest | `npm run security:evidence` | Passed | 26 required evidence files present |
| Root regression tracer | `npm test` | Passed | 29 suites and 319 tests passed with a longer local timeout |
| Dependency audit | `npm audit --audit-level=moderate` | Passed | 0 vulnerabilities |
| Audit CI | `npx audit-ci --moderate` | Passed | 0 vulnerabilities |
| Outdated dependencies | `npm outdated` | Completed with outdated packages | `electron` and `http-proxy-middleware` have newer versions |
| Repo secret scan | `npm run security:secrets` | Passed | Passed across 1487 repository files |
| Free scanner wrapper | `npm run security:free-scanners` | Failed locally | OSV passed via Docker; Trivy failed with Docker `unexpected EOF`; Semgrep failed after Docker Desktop WSL bootstrap instability; ZAP skipped because `STAGING_URL` is unset |
| Header tests | `npm run security:headers` | Passed | 2 tests passed |
| Rate-limit tests | `npm run security:rate-limit` | Passed | 5 tests passed |
| Webhook security tests | `npm run security:webhooks` | Passed | 16 tests passed |
| Upload malware runtime | `npm run security:malware-runtime` | Passed with scanner gap | Built-in EICAR block passed; configured clean scan skipped because local scanner env is disabled |
| Token/session tests | `npm run security:tokens` | Passed | 43 tests passed |
| Access-control tests | `npm run security:access-control` | Passed | IDOR and admin tests passed |
| Admin privilege tests | `npm run security:admin` | Passed | 67 tests passed |

## Local Scanner Blockers

- `semgrep` binary not found.
- `gitleaks` binary not found.
- `osv-scanner` binary not found.
- `trivy` binary not found.
- `scorecard` binary not found.
- Docker CLI exists, but Docker Desktop became unstable during WSL bootstrap after briefly starting.
- `npx semgrep` and `npx gitleaks` could not determine an executable to run.
- `npx osv-scanner` is not an npm package.
- `STAGING_URL` is unset locally, so the free scanner wrapper skips OWASP ZAP; the CI security gates now fall back to a local Vite preview target for DAST evidence without scanning production.

## Required CI Evidence

The security gates workflow should produce retained artifacts for:

- Gitleaks report.
- Semgrep report.
- Trivy filesystem report.
- SBOM.
- ZAP baseline report against `STAGING_URL` when configured, or against the CI-local Vite preview fallback when no staging URL is configured.

Do not commit raw scanner reports if they contain sensitive findings or local paths. Prefer CI artifacts plus this summary.
