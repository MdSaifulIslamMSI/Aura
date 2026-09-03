# Test Flake Policy

## Known timeout-flake pool

- `server/tests/payments.webhook.security.test.js` — 9 DB-heavy seed tests flaked in CI with `Exceeded timeout of 5000 ms` under parallel load; 9/9 pass in isolation. Fixed with `jest.setTimeout(15000)`.
- `server/tests/authSessionService.test.js` — phone-conflict seed test (`User.create` + sync) flaked the same way in the Focused Security Tests job; 15/15 pass in isolation. Fixed with `jest.setTimeout(15000)`.
- 14 suites already carry explicit `jest.setTimeout(...)` (established pattern):
  - `adminOpsRoutes.test.js` (30000)
  - `adminRouteSurfaceSecurity.test.js` (30000)
  - `authMiddleware.desktopHandoffQuarantine.test.js` (30000)
  - `authRoutes.integration.test.js` (30000)
  - `catalogAdminRoutes.test.js` (30000)
  - `commerceAssistantHostedGemma.test.js` (15000)
  - `config.headers.security.test.js` (15000)
  - `mfaController.passkeyResponse.test.js` (30000)
  - `observabilityRoutes.test.js` (30000)
  - `otpEmailFailClosed.test.js` (15000)
  - `otpSystem.test.js` (25000)
  - `productionGateRoutes.test.js` (15000)
  - `recommendationRoutes.test.js` (30000)
  - `security.integration.test.js` (15000)

## Rule

- DB-heavy suites (Mongo seed helpers, `createTestUser` / `createFakeOrder` / intent setup, parallel CI workers) get an explicit `jest.setTimeout(...)` near the top, after requires and before `describe` blocks.
- Default is Jest's 5s timeout otherwise — do not add timeouts to pure unit suites.
- Prefer `15000` for seed-heavy security suites; use `30000` only if durations justify it.

## How to triage a flake

1. Re-run the failed job first — a single `Exceeded timeout` under parallel load with a green isolated re-run is a timeout flake, not a product bug.
2. Check duration vs timeout — compare the failing test's duration to the suite's `jest.setTimeout` (or 5s default). Near-timeout durations point at DB-seed latency.
3. Check for cascade dup-key failures — a timed-out seed can leave partial documents; follow-on `E11000 duplicate key` errors in the same run are cascade noise, not new failures.

## Aspiration

Zero flakes, full-suite green. Add timeouts only to absorb CI latency — keep suites fast and investigate any suite that needs repeated bumps.
