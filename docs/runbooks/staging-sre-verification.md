# Staging SRE Verification Runbook

## Purpose

Use this before marking an SRE, backend reliability, deployment, or latency PR ready.

## Required Commands

```sh
npm run scan:prod-fallbacks
npm run security:secrets
npm run smoke:staging
npm run smoke:staging:frontend
npm run smoke:env-contract
npm run sre:synthetic:staging
npm run sre:latency:staging
npm run release:rollback-ready
npm run aws:cost-guard
npm run aws:observability:guard
npm run github:main-protection
npm test
git diff --check
```

## Safe Preconditions

- `SMOKE_TARGET_ENV=staging`
- `STAGING_SSM_PREFIX=/aura/staging`
- production SSM prefix is configured separately by the release contract
- staging frontend/backend URLs do not equal production URLs
- AWS read-only credentials are configured only for inventory/guard checks
- rollback target evidence is configured

## What Not To Do

- Do not mutate production.
- Do not turn failing gates into warnings.
- Do not bypass AWS cost or observability failures.
- Do not create NAT Gateway, load balancer, paid RDS, paid Redis, OpenSearch, paid WAF expansion, extra Elastic IPs, or other paid resources without approval.

## Acceptance Criteria

- All required commands pass.
- SRE evidence exists under `artifacts/sre/`.
- Release-gate evidence exists under `artifacts/release-gates/` when produced.
- Main protection requires test, security, smoke, AWS, rollback, and SRE gates.
- Production touched: NO.

## Incident Notes Template

- Branch:
- Commit SHA:
- Staging state source:
- Commands passed:
- Commands failed:
- Blockers:
- Ready to mark PR ready:
- Ready to merge:
