# Login Security Staging Readiness - 2026-05-01

## Scope
- Defensive authentication/security readiness review for staging-only validation.
- No production traffic, no destructive testing, and no high-volume automation.
- Account bootstrap and authenticated staging smoke are allowed only after staging isolation is explicit.

## Completed Local Evidence
- `npm.cmd run security:attack-smoke`
  - Result: passed
  - Coverage: 1 Jest suite, 5 tests
- `npm.cmd run security:auth-tests`
  - Result: passed
  - Coverage: 10 Jest suites, 105 tests
- `npm.cmd run security:audit`
  - Result: passed
  - Coverage: root, app, and server production dependency audits reported 0 vulnerabilities
- `npm.cmd run security:deprecated`
  - Result: passed
  - Coverage: deprecated package gate passed for 3 npm lockfiles
- `npm.cmd run security:prod-env-audit`
  - Result: passed
  - Coverage: production login environment contract audit reported 0 failures and 0 warnings
- `SMOKE_FLOW_MODE=public SMOKE_BASE_URL=http://127.0.0.1:5000 npm.cmd --prefix server run smoke:staging`
  - Result: blocked
  - Reason: no local backend responded at `http://127.0.0.1:5000`

## Staging Isolation Check
- Active shell did not expose `SMOKE_*` variables.
- `server/.env` is `NODE_ENV=development`, but contains cloud-backed MongoDB/Redis-looking values.
- `server/scripts/bootstrap_staging_smoke_accounts.js` can create or update Firebase users and backend users.
- `server/scripts/staging_smoke.js` can create orders, refunds, replacements, products, and payment-intent records in customer/full modes.

## Decision
Do not run staging account bootstrap or authenticated/customer/full smoke from the current environment.

Reason: the environment does not clearly prove it is isolated staging, and the smoke scripts can mutate external identity, database, payment, and order state.

## Safety Guard Added
- `server/scripts/assert_staging_smoke_safety.js` now runs before staging smoke/bootstrap package scripts.
- `npm run smoke:bootstrap-accounts` now fails closed unless staging intent and isolation are explicit.
- `npm run smoke:staging` still allows local public read-only smoke, but blocks customer/full or external targets unless staging intent is explicit.
- The guard refuses known production hosts, production-like env labels, and live payment keys.
- Focused verification: `npm.cmd --prefix server test -- --runTestsByPath tests/stagingSmokeSafety.test.js` passed, 6 tests.

## Safe Next Gate
Before running mutating staging smoke, provide or configure all of the following against dedicated staging resources:
- `SMOKE_TARGET_ENV=staging`
- `SMOKE_STAGING_ISOLATED=true`
- `SMOKE_BASE_URL`
- `SMOKE_FLOW_MODE=customer` or `SMOKE_FLOW_MODE=full`
- `SMOKE_FIREBASE_API_KEY`
- `SMOKE_USER_EMAIL`
- `SMOKE_USER_PASSWORD`
- Optional for full admin smoke: `SMOKE_ADMIN_EMAIL`, `SMOKE_ADMIN_PASSWORD`
- Staging-only MongoDB connection
- Staging-only Redis connection
- Email/SMS sandbox provider configuration
- Test payment provider keys only

## Allowed Now
- Public non-mutating smoke against a local or staging URL.
- Local Jest security/auth gates.
- Environment contract audits that do not create users, orders, products, refunds, replacements, or payment intents.

## Current Blocker
Authenticated staging smoke remains blocked until `SMOKE_*` variables and staging-only backing services are configured. Local public smoke is blocked until a backend is running at the selected local or staging URL.
