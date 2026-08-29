# GitHub Actions Audit — Baseline & Promotion Policy

`actions-audit.yml` runs [zizmor](https://docs.zizmor.sh/) over every workflow
and publishes findings to code scanning. It is **non-blocking during the
baseline burn-down period**; it becomes merge-blocking once the criteria below
are met.

## Baseline (measured 2026-08-29, zizmor 1.29.0, regular persona)

Total findings: **404** across 36 workflows.

| Audit | Count | Typical fix |
| --- | --- | --- |
| `unpinned-uses` | 248 | Pin third-party actions to commit SHA (e.g. `ossf/scorecard-action@2d11466...`) |
| `artipacked` | 102 | Add `persist-credentials: false` to `actions/checkout` steps |
| `template-injection` | 36 | Move untrusted `github.event.*` values into `env:` instead of inline `${{ }}` |
| `excessive-permissions` | 16 | Narrow top-level `permissions:` blocks |
| `dangerous-triggers` | 1 | Review `pull_request_target` usage; scope checkout to the PR base |
| `superfluous-actions` | 1 | Remove the unnecessary action |

Severity/confidence split: 264 findings are `high/high`, 3 `medium/high`.

## Promotion to blocking (gate flip criteria)

1. `unpinned-uses` findings at or below 10 (remaining entries are first-party
   actions owned by this repo, or individually waived in `.github/zizmor.yml`).
2. `artipacked` findings at 0 (purely mechanical: one line per checkout).
3. `template-injection` findings at 0.
4. After (1)-(3): remove `continue-on-error: true` from the
   `Run zizmor audit` step in `.github/workflows/actions-audit.yml`.

Suggested batches: (a) `artipacked` — mechanical, ~100 line changes;
(b) `excessive-permissions` + `dangerous-triggers` — small;
(c) `template-injection` — needs per-site review;
(d) `unpinned-uses` — automate with a pinning pass (e.g. Dependabot or
`pin-jact`) and waive first-party entries.

## Local runs

```bash
npm run security:zizmor          # SARIF report into security-reports/
```

(zizmor runs pinned container image `ghcr.io/zizmorcore/zizmor`.)
