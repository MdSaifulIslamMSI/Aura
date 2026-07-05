# Backend Latency Probe

Command:

```sh
npm run sre:latency:staging
```

Script:

```sh
node scripts/sre/backend-latency-probe.mjs
```

## Purpose

This is a regression detector, not a load test. It sends a small number of safe read-only requests and writes summary evidence to:

```text
artifacts/sre/backend-latency-probe.json
```

## Defaults

- Target environment: staging.
- Required staging env: `SMOKE_TARGET_ENV=staging` and `STAGING_API_BASE_URL`.
- Default paths: `/health,/api/health`.
- Default samples: 7.
- Health p95 budget: 250ms.
- Normal API p95 budget: 800ms.
- Hard per-request timeout: 15000ms.

## Production Safety

Production probing is disabled by default. It requires:

```sh
SRE_TARGET_ENV=production
ALLOW_PRODUCTION_LATENCY_PROBE=true
```

The probe only performs `GET` requests and rejects route paths that look destructive, such as purge, reset, wipe, migrate, deploy, or teardown.

## Output

The script prints only a safe summary:

- path
- sample count
- median
- p95
- max
- budget

It does not print response bodies, secrets, tokens, or private env values.
