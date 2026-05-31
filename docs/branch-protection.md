# Branch Protection Guidance

Protect `main` with:

- Pull request required before merge.
- Required approvals and resolved conversations.
- Required status checks.
- Branch must be up to date before merge.
- Force pushes disabled.
- Direct pushes disabled except documented emergency administration.

Recommended required checks:

- `Quality, tests, and coverage`
- `Repo hygiene`
- `OSV dependency scan`
- `Sonar quality gate` after Sonar secrets are configured
- `JavaScript and TypeScript` from CodeQL
- Existing CI tests, build, security, Semgrep, Trivy, Gitleaks, and staging smoke checks

Production deploy workflows should retain their existing credential checks and explicit signed-store release controls.
