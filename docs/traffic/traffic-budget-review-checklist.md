# Traffic Budget Review Checklist

Use this checklist before marking the PR ready or merging.

## PR Summary

What changed:

- Added `server/config/trafficPolicyRegistry.js` as the component-by-component policy registry.
- Wired route classification to the registry while preserving existing route budget enforcement.
- Added smoothness, abuse-resistance, regression, and safe staging simulation scripts under `scripts/traffic`.
- Added traffic budget docs, component map, matrix, generated audit summaries, and this checklist.
- Added backend tests for registry calibration and 429/503/body-size response smoothness.
- Added a PR workflow for traffic budget gates and optional staging simulation.

Component matrix:

- See `docs/traffic/traffic-budget-matrix.md`.

Audit results:

- Smoothness audit: local pass with warnings preserved as warnings.
- Abuse-resistance audit: local pass.
- Regression audit: local pass.

Tests run locally:

- `npm run scan:prod-fallbacks`
- `npm run security:secrets`
- `npm run traffic:audit:smoothness`
- `npm run traffic:audit:abuse`
- `npm run traffic:audit:regressions`
- `npm run traffic:fortress:test`
- `npm --prefix server test -- --runTestsByPath tests/trafficPolicyRegistry.test.js tests/trafficResponseSmoothness.test.js --forceExit`
- `npm test`
- `git diff --check`

Staging status:

- Local staging smoke/simulation remains blocked until staging variables are configured.
- Required missing local values include staging base/API/frontend/health URLs and staging smoke contract variables.

Production touched: NO.

Paid AWS resources created: NO.

Merge blockers:

- CI must pass on the draft PR.
- Staging/env contract smoke must pass when staging variables are available.
- AWS cost/observability guards require credentials and must pass before merge.
- Rollback readiness requires rollback artifact/target evidence and production health URL before merge.

## Scope

- [ ] Diff is limited to traffic budget registry, audits, tests, docs, and CI gate wiring.
- [ ] No unrelated formatting, dependency, generated artifact, or secret changes were introduced.
- [ ] Production was not mutated.
- [ ] No paid AWS resource was created.

## Component Review

- [ ] Public read routes are smooth enough for normal browsing.
- [ ] Auth routes are strict and do not enumerate users.
- [ ] OTP/password reset routes have per-IP, per-account/session, and per-flow/challenge protection.
- [ ] Payment mutations are idempotency/state-machine protected.
- [ ] Admin routes are privileged, strict, audited, and fail closed.
- [ ] Upload routes have body-size and file-validation posture.
- [ ] AI routes have request/quota/concurrency/provider timeout posture.
- [ ] Webhooks require signature and replay/idempotency protection.
- [ ] Socket/live-call sessions use canonical server-side ownership/session proof.
- [ ] Limits are per-IP/per-user/per-account/per-session/per-flow where needed.

## Response And UX

- [ ] 429 responses include requestId and safe retryAfter when applicable.
- [ ] 503 overload responses include requestId and no internal load details.
- [ ] Auth/security/payment errors do not leak policy internals or account existence.
- [ ] Frontend can show retry/degraded messages without guessing internal policy names.

## Infrastructure And Release Gates

- [ ] Cache policies are correct for public and private routes.
- [ ] Body-size limits match upload/auth/payment/admin risk.
- [ ] Timeouts are route-budgeted and dependency-aware.
- [ ] Retries are bounded with no blind mutation retry.
- [ ] Staging simulation is safe and staging-only.
- [ ] Staging does not fall back to production.
- [ ] AWS cost guard is green or explicitly blocked by missing credentials.
- [ ] AWS observability guard is green or explicitly blocked by missing credentials.
- [ ] Rollback readiness is green before merge.
- [ ] Main branch protection gate is green.

## Commands

- [ ] `npm run scan:prod-fallbacks`
- [ ] `npm run security:secrets`
- [ ] `npm run traffic:audit:smoothness`
- [ ] `npm run traffic:audit:abuse`
- [ ] `npm run traffic:audit:regressions`
- [ ] `npm run traffic:fortress:test`
- [ ] `npm --prefix server test -- --runTestsByPath tests/trafficPolicyRegistry.test.js tests/trafficResponseSmoothness.test.js --forceExit`
- [ ] `npm test`
- [ ] `git diff --check`

## Optional Staging/AWS Commands

Run only when the required staging/AWS environment is configured:

- [ ] `npm run traffic:simulate:staging`
- [ ] `npm run smoke:staging`
- [ ] `npm run smoke:staging:frontend`
- [ ] `npm run smoke:env-contract`
- [ ] `npm run aws:cost-guard`
- [ ] `npm run aws:observability:guard`
- [ ] `npm run release:rollback-ready`
- [ ] `npm run github:main-protection`

## Merge Decision

- [ ] Smoothness audit is green.
- [ ] Abuse audit is green.
- [ ] Regression audit is green.
- [ ] Security scan is green.
- [ ] Required tests are green.
- [ ] CI checks are green.
- [ ] Staging/env/AWS/rollback blockers are resolved or the PR remains draft.
- [ ] Production touched: NO.
- [ ] Paid AWS resources created: NO.
