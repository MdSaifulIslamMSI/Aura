# Latency And Reliability Budgets

Latency budget is not a fake number. Every endpoint must either meet the budget or document why it is excluded.

## Service Budgets

These service budgets are targets for staging-region or app-adjacent measurement. Remote CI runners add network distance and have their own release guardrail below.

| Surface | Target |
| --- | ---: |
| API health p95 | under 250ms |
| Normal API p95 | under 800ms |
| Normal API p99 | under 2000ms |
| Auth/security-sensitive API p95 | under 1000ms |
| Hard request timeout | 10s to 15s maximum unless explicitly exempted |
| DB operation timeout | 2s to 5s depending on operation |
| Redis/cache timeout | under 500ms |
| External provider timeout | 3s to 8s depending on provider |
| Frontend first API response | under 1s from staging region when warm |
| Secret leakage in logs | zero |
| Rollback readiness | proven before merge |

## Current Route Budget Mapping

The existing traffic budget map in `server/config/trafficBudgets.js` is the source of truth for request-class guardrails.

| Route class | Current timeout | Merge posture |
| --- | ---: | --- |
| HEALTH | 1500ms | Synthetic gate uses a stricter 250ms p95 budget for live staging health. |
| STATUS_PUBLIC | 3000ms | Public status should normally stay under normal API targets. |
| PUBLIC_SEARCH | 4500ms | Must document or fix p95 over 800ms. |
| PUBLIC_READ | 6000ms | Must document or fix p95 over 800ms. |
| AUTH_LOGIN / OTP | 7000ms | Must stay under 1000ms p95 unless provider latency is documented. |
| AUTH_WEBAUTHN / ADMIN / AUTHENTICATED_WRITE | 10000ms | Fail closed for security-sensitive dependencies. |
| PAYMENT | 12000ms | Retry only with idempotency protection. |
| OTP_RESET | 15000ms | Exempt due provider cleanup, but must remain fail closed. |
| UPLOAD | 20000ms | Exempt due media size, with body limits and dependency timeouts. |
| AI_EXPENSIVE | 25000ms | Exempt only for explicit AI/provider paths with fallback behavior. |

## Gate Enforcement

- `npm run sre:synthetic:staging` checks staging health, API health, frontend HTML, static assets, frontend API proxy, and Socket.IO reachability with small samples.
- `npm run sre:latency:staging` runs a small read-only latency probe and writes JSON evidence to `artifacts/sre/`.
- GitHub-hosted SRE jobs currently set the health budget to 1000ms because the runner is outside the staging region; this is a release guardrail, not a replacement for the 250ms service target.
- `npm run test:reliability` verifies timeout and retry primitives.
- `npm run github:main-protection` now requires the SRE gates to be configured as required checks.

## Exclusion Rules

An endpoint may exceed the normal API budget only when all are true:

- The route class already declares a longer timeout.
- The route is not an auth, authorization, payment, admin, or secret-bearing route unless it fails closed.
- The reason is documented in code or SRE docs.
- A cheaper health/readiness endpoint still exists.
- The route has request body, rate, and dependency timeout controls.

## Release Rule

Do not mark a PR ready or merge when any of these are red:

- staging smoke
- frontend staging smoke
- env contract
- AWS cost guard
- AWS observability guard
- rollback readiness
- security secret scan
- reliability tests
- SRE synthetic staging check
- SRE latency staging check
- main branch protection
