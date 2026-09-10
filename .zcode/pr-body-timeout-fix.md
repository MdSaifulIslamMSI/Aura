## Why main went red

The Security Gate regression run on the #458 merge commit flaked in `tests/adminMonitorAlertDedupe.test.js`: the `beforeAll` hook that runs `AdminNotification.syncIndexes()` exceeded Jest's default 5s hook timeout on a loaded CI runner. The same suite passed in the PR run and locally - it is pure DB-latency flakiness, not a product bug. `docker-image-security` was skipped as a dependent job.

## Fix

- `jest.setTimeout(30000)` (the repo standard for DB-backed suites) on `adminMonitorAlertDedupe.test.js`.
- Same preventive timeout on `migrationRunner.test.js`, which has the identical latent hazard (per-test cleanups, ledger writes, lock transitions).

## Verification

| Check | Result |
|---|---|
| Both suites locally | 6/6 pass |
| EOL-safe surgical diff | +8 lines across 2 files |
| CI | see checks below |

## Risks

None product-facing - test infrastructure only.
