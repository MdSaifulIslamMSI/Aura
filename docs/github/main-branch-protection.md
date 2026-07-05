# Main Branch Protection

`main` should be protected as the production release branch.

## Required Rules

- Branch protection must be enabled for `main`; repository rulesets that do not
  appear in the branch protection API are not enough for
  `npm run github:main-protection`.
- Direct pushes to `main` are blocked by requiring a pull request before merge.
- Required status checks must be enabled and the branch must be up to date before
  merge.
- Exact required checks:
  - `test`
  - `security`
  - `smoke:staging`
  - `smoke:staging:frontend`
  - `smoke:env-contract`
  - `aws:cost-guard`
  - `aws:observability:guard`
  - `release:rollback-ready`
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
