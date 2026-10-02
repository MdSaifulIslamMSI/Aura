# Main Branch Protection

`main` should be protected as the production release branch.

## Required Rules

- Branch protection must be enabled for `main`; repository rulesets that do not
  appear in the branch protection API are not enough for
  `npm run github:main-protection`.
- Direct pushes to `main` are blocked by requiring a pull request before merge.
- Required status checks must be enabled.
- Exact required checks (enforced by `npm run github:main-protection`):
  - `Quality, tests, and coverage` (Quality Foundation)
  - `javascript-typescript` (CodeQL)
  - `security` (Giant Release Gates `security` job; Security Gates supplies the scanner fleet)
  - `build-and-smoke` (Docker build and smoke)
  - `Secret Scan` (Security Gates; Gitleaks, PR and push)
  - `SAST` (Security Gates; Semgrep, PR and push)
  - `Trivy Filesystem Scan` (Security Gates; Trivy filesystem HIGH/CRITICAL, PR and push)
  - `Dependency Scan` (Security Gates; npm audit and OSV, PR and push)
  - `Focused Security Tests` (Security Gates; auth, IDOR, payment, webhook, rate-limit suites)
- The scanner lanes above are promoted so a failing scanner blocks the merge instead
  of only reporting. `Dependency Review` is intentionally **not** promoted: it is
  gated on `if: github.event_name == 'pull_request'`, so requiring it would leave the
  check permanently pending and block every merge. Promote it only alongside a
  push-to-main dependency gate. `DAST - OWASP ZAP Baseline`, `SBOM`,
  `Supply Chain Integrity`, `Docker Image Security`, `IaC Security Scan`, and
  `Evidence Check` stay advisory; ZAP degrades to a local static preview whenever
  `vars.STAGING_URL` is unset, so promoting it today would guarantee a hollow pass.
- Promotion candidates: the Giant Release Gates PR checks (`test`,
  `smoke:staging`, `smoke:staging:frontend`, `smoke:env-contract`,
  `aws:cost-guard`, `aws:observability:guard`, `sre:synthetic:staging`,
  `sre:latency:staging`, `test:reliability`, `release:rollback-ready`) should be
  promoted into required status checks once live staging runs continuously
  again; while staging is intentionally stopped they cannot pass, so the guard
  reports them as warnings instead of failures. "Up to date before merge" and
  conversation resolution are also recommended and currently reported as
  warnings.
- Conversations must be resolved.
- Pull requests are required before merge.
- For this single-owner repository, required approving review count is `0`.
  GitHub does not allow the PR author to approve their own pull request, so a
  `1`-approval rule deadlocks releases until another maintainer exists.
- When a second independent maintainer exists, raise required approving review
  count to `1` or more and verify with
  `GITHUB_MAIN_PROTECTION_REQUIRED_APPROVALS=1 npm run github:main-protection`.
- Stale approvals are dismissed after new commits when approvals are required.
- Force pushes and branch deletion are disabled.

## Verification

Run:

```sh
npm run github:main-protection
```

The script uses GitHub CLI read-only API calls and fails closed if protection cannot be inspected.
It will keep failing until `main` branch protection, required status checks, pull
request rules, conversation resolution, and force-push/deletion blocks are
configured or made visible to the GitHub API. By default the guard enforces the
single-owner policy with `0` required approvals; set
`GITHUB_MAIN_PROTECTION_REQUIRED_APPROVALS` to a positive integer once an
independent reviewer is available.
