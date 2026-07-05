# Rollback After Bad Latency Runbook

## Symptoms

- Latency gates pass before merge but fail on main or staging after merge.
- `/health`, `/api/health`, or frontend HTML p95 regresses.
- Error rate or timeouts increase after deploy.
- Users report slow or hanging critical flows.

## Immediate Checks

```sh
npm run sre:synthetic:staging
npm run sre:latency:staging
npm run smoke:env-contract
npm run release:rollback-ready
```

Check current main SHA and latest release artifact before touching production.

## What Not To Do

- Do not rollback blindly without confirming rollback target evidence.
- Do not run destructive migrations or purges.
- Do not increase AWS spend to mask latency.
- Do not disable auth, payment, admin, rate-limit, or deployment gates.

## Rollback Trigger

Rollback is justified when:

- SRE p95 budget fails repeatedly,
- health/readiness fails after deploy,
- critical auth/payment/admin flows are impacted,
- and a safer forward fix is not immediately available.

## Rollback Steps

1. Confirm `npm run release:rollback-ready` passes.
2. Follow `docs/runbooks/aws-production-rollback.md`.
3. Record rollback target SHA/artifact.
4. Run staging smoke and SRE checks after rollback.
5. Watch main workflows.

## Verification

```sh
npm run smoke:staging
npm run smoke:staging:frontend
npm run smoke:env-contract
npm run sre:synthetic:staging
npm run sre:latency:staging
npm run aws:cost-guard
npm run aws:observability:guard
npm run release:rollback-ready
```

## Incident Notes Template

- Bad deploy SHA:
- Rollback target SHA:
- Artifact URI:
- Latency before rollback:
- Latency after rollback:
- Smoke result:
- Cost guard result:
- Observability guard result:
- Final verdict:
