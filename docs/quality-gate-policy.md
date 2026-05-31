# Quality Gate Policy

## Block merge immediately

- Real secret leak.
- Failing test, build, or blocking ESLint rule.
- Auth bypass, admin-route bypass, payment-webhook verification bypass, or unsafe upload path.
- Critical dependency vulnerability with an available fix.
- Critical Docker, Kubernetes, Helm, OpenTofu, or GitHub Actions misconfiguration.
- High-confidence Semgrep error or CodeQL high-severity result.
- Sonar new-code quality gate failure after Sonar credentials are configured.
- Production wildcard CORS or production secret fallback.

## Record and triage

- Existing React Hooks dependency warnings.
- Existing Knip unused-file, dependency, export, alias-resolution, and binary findings.
- Historical duplication and complexity.
- Medium vulnerabilities without a safe upgrade.

Do not hide false positives broadly. Record the rule, file, owner, reason, and review date before suppressing a finding.

## Targets

- New code has no blocker or critical bugs.
- New code has no vulnerabilities.
- New security hotspots are reviewed.
- New-code duplication stays low.
- Coverage thresholds rise gradually from the current real LCOV baseline.
- Main remains green after every merge.
