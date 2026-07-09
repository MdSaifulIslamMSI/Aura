# Backend Latency Incident Runbook

## Symptoms

- `sre:latency:staging` fails p95 budget.
- `sre:synthetic:staging` shows repeated health or API latency misses.
- Users report slow checkout, login, listing, search, AI, or status pages.
- `performance.slow_request` logs increase.

## Immediate Checks

```sh
npm run smoke:env-contract
npm run sre:synthetic:staging
npm run sre:latency:staging
npm run aws:observability:guard
npm run release:rollback-ready
```

Check logs for:

- route
- method
- status
- durationMs
- requestId
- route class
- dependency duration

## What Not To Do

- Do not mutate production while staging, cost, observability, rollback, or branch-protection gates are red.
- Do not raise timeouts to hide latency.
- Do not disable security, auth, DPoP, CSRF, OTP, session, or rate-limit gates.
- Do not create paid AWS resources without exact monthly cost and explicit approval.

## Triage

1. Identify whether latency is health, DB, Redis, external provider, static asset, frontend proxy, or Socket.IO.
2. Check whether the affected route has a traffic budget.
3. Check recent deploy SHA and rollback readiness.
4. Compare SRE probe evidence before and after the incident.
5. If auth/payment/admin paths are affected, prefer fail-closed behavior over partial success.

## Rollback Trigger

Rollback when:

- p95/p99 latency exceeds budget after deploy and no safe quick fix exists.
- Health or readiness is repeatedly failing.
- Auth, payment, admin, or recovery paths are timing out.
- A dependency failure causes unsafe partial success.

## Verification

After fix or rollback:

```sh
npm run smoke:staging
npm run smoke:staging:frontend
npm run smoke:env-contract
npm run sre:synthetic:staging
npm run sre:latency:staging
npm run release:rollback-ready
```

## Incident Notes Template

- Incident start:
- Detected by:
- Affected routes:
- Worst p95/p99:
- Root cause:
- Mitigation:
- Rollback used:
- Verification commands:
- Follow-ups:
