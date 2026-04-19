# AWS Prompt Library

Use these prompts when you want fast, high-signal help without drafting the
entire request from scratch.

## Setup And Readiness

```text
Diagnose whether this AWS plugin is fully ready to use on my machine and tell me the smallest next step if it is not.
```

```text
Explain whether my AWS MCP setup is blocked by missing packages, missing auth, region mismatch, or profile mismatch.
```

## Architecture Review

```text
Review this AWS architecture for reliability, blast radius, observability, and cost posture. Prioritize concrete risks first.
```

```text
Map this product requirement to the simplest production-ready AWS architecture and explain what not to add yet.
```

## Security And Identity

```text
Review my AWS IAM, secret handling, encryption, and public exposure posture. Call out the highest-risk gaps first.
```

```text
Explain whether this workload should use Parameter Store, Secrets Manager, KMS, or some combination of them.
```

## Compute And Delivery

```text
Compare EC2, ECS, EKS, and Lambda for this AWS workload and recommend the smallest option that still fits the operational needs.
```

```text
Review my CloudFront, Route 53, WAF, and origin setup for latency, security, and rollback safety.
```

## Data And Events

```text
Review my AWS data layer design across RDS, DynamoDB, ElastiCache, OpenSearch, and event-driven flows. Focus on the most likely scaling or consistency mistakes.
```

```text
Help me design an AWS analytics stack using S3, Glue, Athena, Kinesis, and Redshift, and explain where each service earns its complexity.
```

## Operations And Incidents

```text
Help me triage this AWS incident by separating DNS, network, auth, runtime, and data-layer failure possibilities.
```

```text
Review my AWS observability setup and tell me which logs, alarms, and dashboards are still missing for safe production operation.
```

## Migration And Modernization

```text
Create a phased AWS migration plan with cutover, rollback, secrets, observability, and team-operations tradeoffs called out clearly.
```

```text
Show me how to modernize this AWS deployment gradually instead of rebuilding everything at once.
```
