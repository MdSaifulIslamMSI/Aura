# Branch Protection Policy

Target branch: `main`

Required GitHub settings:

- Require pull request before merge.
- Require at least one reviewer; use two for auth, admin, payment, upload, secrets, CI/CD, deployment, migration, or data-retention changes.
- Require CODEOWNERS review.
- Require status checks:
  - Tests
  - Dependency scan
  - Secret scan
  - SAST
  - Trivy filesystem scan
  - SBOM
  - Security evidence check
- Block force pushes.
- Block direct pushes to `main`.
- Require conversation resolution.
- Require linear history where compatible with the repo workflow.

Evidence to attach:

- Screenshot or API export of branch protection settings.
- Link to a PR blocked by a failing security gate.
- Link to a PR approved through CODEOWNERS.
