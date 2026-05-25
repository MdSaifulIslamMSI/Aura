# Dependency Zero-Day Playbook

## Trigger

- Critical or high advisory in npm audit, OSV, Trivy, Semgrep, GitHub Dependabot, or vendor alert.

## Immediate Actions

1. Identify vulnerable package, version, path, and reachable surface.
2. Check whether the package is runtime, build-time, or transitive.
3. Patch, override, replace, or disable the vulnerable feature.
4. Run focused tests and security scans.
5. Build and deploy hotfix if reachable in production.

## Evidence

- Advisory ID.
- Dependency path.
- Affected environments.
- Patch commit.
- Scanner report after fix.

## Recovery

- Remove temporary overrides when upstream is fixed.
- Add dependency patch SLA tracking.
- Review SBOM artifact for release evidence.
