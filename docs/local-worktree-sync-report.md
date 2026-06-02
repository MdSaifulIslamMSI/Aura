# Local Worktree Sync Report

Generated during the post-PR-199 local sync safety pass.

## Summary

- Current branch: `codex/world-class-localization-followup`
- Upstream branch: `origin/codex/world-class-localization-followup`
- Branch state after `git fetch origin`: local branch is ahead 2 and behind 2 relative to its upstream.
- Main merge target: `origin/main` at `03e63fa9d3616eb35634eb7b4ad510827b87e17a`
- Final PR #199 head: `6610bcb0c6fd86ecf30853f0bf40a812094fc7f8`
- Staged files: none

## Ahead Commits

`git log --oneline --left-right --cherry-pick HEAD...origin/main` reports:

- `< 497e8f18 feat(i18n): add production-grade localization pipeline`

This is the pre-rebase local localization commit and should not be force-kept over `origin/main`.

## Behind Commits

`git log --oneline --left-right --cherry-pick HEAD...origin/main` reports:

- `> 03e63fa9 feat(i18n): add production-grade localization pipeline`

This is the squash merge commit already on `origin/main`.

## Unstaged Files

- `.github/workflows/staging-ops-watch.yml`
- `SECURITY_ARCHITECTURE_REVIEW.md`
- `app/config/vercelRoutingContract.mjs`
- `app/index.html`
- `app/src/components/layout/Navbar/Navbar.test.jsx`
- `app/src/components/layout/Navbar/index.jsx`
- `app/src/config/cspPolicy.test.js`
- `app/src/pages/Home/index.jsx`
- `app/src/services/api/recommendationApi.js`
- `app/vercel.json`
- `app/vite.config.js`
- `docs/security/risk-register.md`
- `docs/staging-operations-upgrades.md`
- `infra/aws/docker-compose.ec2.yml`
- `netlify.toml`
- `package.json`
- `scripts/security-free-scanners.mjs`
- `scripts/security-harness-check.mjs`
- `server/routes/aiRoutes.js`
- `server/routes/emailWebhookRoutes.js`
- `server/scripts/audit_production_hardening_contract.js`
- `server/tests/emailWebhookRoutes.test.js`
- `vercel.json`

## Untracked Files

- `app/src/services/api/recommendationApi.test.js`
- `server/tests/aiRateLimitPolicy.test.js`
- `server/tests/emailWebhookRateLimitPolicy.test.js`

## Files Changed By Unrelated Security/CSP Work

The local dirty work appears to be security/CSP/staging-ops/API-hardening oriented:

- `.github/workflows/staging-ops-watch.yml`
- `SECURITY_ARCHITECTURE_REVIEW.md`
- `app/config/vercelRoutingContract.mjs`
- `app/index.html`
- `app/src/components/layout/Navbar/Navbar.test.jsx`
- `app/src/components/layout/Navbar/index.jsx`
- `app/src/config/cspPolicy.test.js`
- `app/src/pages/Home/index.jsx`
- `app/src/services/api/recommendationApi.js`
- `app/src/services/api/recommendationApi.test.js`
- `app/vercel.json`
- `app/vite.config.js`
- `docs/security/risk-register.md`
- `docs/staging-operations-upgrades.md`
- `infra/aws/docker-compose.ec2.yml`
- `netlify.toml`
- `package.json`
- `scripts/security-free-scanners.mjs`
- `scripts/security-harness-check.mjs`
- `server/routes/aiRoutes.js`
- `server/routes/emailWebhookRoutes.js`
- `server/scripts/audit_production_hardening_contract.js`
- `server/tests/aiRateLimitPolicy.test.js`
- `server/tests/emailWebhookRateLimitPolicy.test.js`
- `server/tests/emailWebhookRoutes.test.js`
- `vercel.json`

## Overlap With Merged Localization Work

Filename overlap with merge commit `03e63fa9d3616eb35634eb7b4ad510827b87e17a`:

- `package.json`

The `package.json` overlap is expected because PR #199 added i18n scripts there, while local dirty work still has unrelated package-level changes. It requires manual review after stash restore.

## Files Safe To Stash

All listed dirty and untracked files are safe to preserve with a named stash before syncing main. No staged files are present.

## Files Requiring Manual Review

- `package.json`: overlaps with the merged localization commit by filename.
- Any conflict file reported by `git stash apply` after restoring the dirty work on the recovery branch.

## Planned Sync Path

1. Create patch and status backups under `artifacts/git-safety/`.
2. Stash dirty and untracked files with a named safety stash.
3. Check out `main` and fast-forward to `origin/main`.
4. Run clean-main localization sanity checks.
5. Create `codex/security-csp-dirty-work-recovery` from updated `main`.
6. Apply, but do not pop, the safety stash.
7. Stop on conflicts; otherwise classify and verify the restored security/CSP work.
