# Dependency Outage Runbook

## Symptoms

- Health/readiness dependency checks degrade.
- DB, Redis, email, payment, AI, uploads, scanner, or Socket.IO dependency errors increase.
- Rate limiter reports Redis unavailable.
- Provider calls timeout or retry exhaustion appears in logs.

## Immediate Checks

```sh
npm run smoke:env-contract
npm run sre:synthetic:staging
npm run aws:observability:guard
npm run security:secrets
```

Backend checks:

- `/health`
- `/health/ready`
- `/api/health`
- `/api/health/deep`
- `/api/health/db`
- `/api/health/redis`

## What Not To Do

- Do not print provider tokens, SSM values, DB URLs, Redis URLs, cookies, auth headers, OTPs, or reset tokens.
- Do not disable fail-closed auth, payment, admin, or rate-limit behavior.
- Do not retry non-idempotent mutations unless idempotency protection exists.
- Do not create paid replacement infrastructure without approval.

## Response

1. Classify dependency: DB, cache, provider, queue, storage, scanner, socket, or frontend proxy.
2. Check if the route is security-sensitive.
3. For non-critical features, degrade gracefully where existing code supports it.
4. For auth, security, payment, admin, and account recovery, fail closed.
5. If Redis is required in production for distributed controls, treat Redis outage as release-blocking.

## Rollback Trigger

Rollback when dependency outage correlates with the latest release and:

- readiness is failing,
- security-sensitive flows no longer fail closed,
- payment/order side effects are uncertain,
- or latency budgets are repeatedly missed.

## Verification

```sh
npm run smoke:staging
npm run smoke:env-contract
npm run sre:synthetic:staging
npm run sre:latency:staging
npm run aws:observability:guard
npm run release:rollback-ready
```

## Incident Notes Template

- Dependency:
- First failing check:
- Request IDs:
- User impact:
- Fail-open/fail-closed behavior:
- Mitigation:
- Rollback decision:
- Follow-ups:
