# Free-Tier Observability Plan

Aura should keep production and staging visible without turning observability into a surprise bill.

## Guardrails

- CloudWatch log groups must have finite retention.
- Health checks should be lightweight and run from CI or scheduled jobs, not tight continuous polling.
- Use only a small number of critical alarms for production health and cost.
- Avoid high-cardinality custom metrics.
- Avoid verbose production debug logs.
- Store security scanner artifacts in GitHub artifacts with bounded retention.

## Scripted Check

Run:

```sh
npm run aws:observability:guard
```

The guard fails when Aura CloudWatch log groups have infinite retention. It warns when log storage, alarm count, or dashboard count exceeds the free-safe thresholds in `config/aws-free-guard.json`.

## Current Limits

- Maximum Aura alarms: `5`
- Maximum Aura dashboards: `2`
- Log storage warning threshold: `250 MB` per Aura log group

## Operational Notes

Staging smoke and DAST checks should stay CI-driven. Do not add always-on synthetic polling, NAT Gateway based scanners, managed OpenSearch, or large paid dashboards without explicit cost approval.
