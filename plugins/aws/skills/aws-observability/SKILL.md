---
name: "aws-observability"
description: "AWS observability guidance. Use when working with CloudWatch logs, metrics, dashboards, alarms, tracing, log retention, runtime health visibility, or production debugging workflows across AWS services."
---

# AWS Observability

Use this skill for logging, metrics, alarms, and runtime visibility work.

## Do First

1. Read `references/observability.md`
2. Use AWS Knowledge and Documentation MCP for current observability guidance
3. Use AWS API MCP to inspect log groups, alarms, dashboards, and service health objects when live access exists

## Rules

- Prefer actionable signals over noisy dashboards
- Review retention, cardinality, and alert fatigue tradeoffs
- Connect service failures to concrete logs and metrics before changing architecture
