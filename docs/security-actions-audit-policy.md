# GitHub Actions Audit — Baseline & Promotion Policy

`actions-audit.yml` runs [zizmor](https://docs.zizmor.sh/) over every workflow
with **two tiers**:

1. **SARIF report (non-blocking)** — all findings published to code scanning.
2. **Regression gate (BLOCKING)** — fails on any finding from the enforced
   classes (`artipacked`, `unpinned-uses`) via
   `scripts/security/actions-audit-regression-gate.mjs`.

## Baseline history

| Date | zizmor | Total | Breakdown | Gate |
| --- | --- | --- | --- | --- |
| 2026-08-29 (pre-hardening) | 1.29.0 | 404 | 248 unpinned-uses, 102 artipacked, 36 template-injection, 16 excessive-permissions, 1 dangerous-triggers, 1 superfluous-actions | none (audit added) |
| 2026-08-29 (post-hardening) | 1.29.0 | **54** | 36 template-injection, 16 excessive-permissions, 1 dangerous-triggers, 1 superfluous-actions | **blocking on enforced classes** |

## Hardening batch (2026-08-29)

- `persist-credentials: false` added to 102 checkout steps (4 already had it).
- 248 tag-pinned actions replaced with commit-SHA pins (resolved via the
  GitHub API at the tag each workflow referenced; e.g. `actions/checkout@v6`
  → `@d23441a...`).
- Enforced classes driven to **zero**; the regression gate now blocks any
  reintroduction.

## Remaining 54 findings (review-required, SARIF-tracked)

- 36 `template-injection` — each needs per-site review: move untrusted
  `github.event.*` values into `env:` and reference the env var.
- 16 `excessive-permissions` — narrow top-level `permissions:` per workflow.
- 1 `dangerous-triggers` — `workflow_run` in `status-watch.yml`: review
  checkout/credential handling in the triggered run.
- 1 `superfluous-actions` — `softprops/action-gh-release` in
  `mobile-release.yml`: evaluate replacing with a release API call.

These do NOT block the gate; they are reported in SARIF and must be burned
down before the report tier is also promoted to blocking.

## Local runs

```bash
npm run security:zizmor          # SARIF report into security-reports/
```

(zizmor runs pinned container image `ghcr.io/zizmorcore/zizmor`.)

