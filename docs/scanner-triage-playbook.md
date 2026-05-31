# Scanner Triage Playbook

## General loop

1. Reproduce the finding locally where possible.
2. Decide whether the finding is exploitable, configuration debt, legacy debt, or false positive.
3. Fix the root cause for real findings.
4. Rerun the narrow scanner.
5. Rerun `npm run quality:all` and the affected build or test suite.
6. Add a narrow documented suppression only when a fix is not appropriate.

## Tool notes

- SonarQube: inspect the new-code quality gate first. Treat new vulnerabilities and unreviewed hotspots as release blockers.
- Semgrep: review `security-reports/semgrep-report.json`. Custom Aura rules live in `semgrep-rules/aura-security.yml`.
- CodeQL: triage GitHub code-scanning alerts by data flow and reachable attack surface.
- Trivy: prioritize critical vulnerabilities and critical infrastructure misconfigurations. Add `.trivyignore` entries only with owner and expiry.
- OSV: prefer safe dependency upgrades that preserve lockfile integrity. Avoid blind major upgrades.
- Gitleaks: stop immediately, rotate the credential, and remove it safely. Never print the credential in an issue or PR.
- Knip: confirm dynamic imports and runtime references before deleting anything.
- actionlint, Hadolint, ShellCheck: fix workflow, Dockerfile, and shell root causes before merge.

For urgent production hotfixes, never waive secret leaks, exploitable auth bypasses, or critical findings. Record any temporary legacy-only exception and open a follow-up issue with an owner and review date.
