---
name: "aws-analytics"
description: "AWS analytics guidance. Use when working with Athena, Glue, Redshift, Kinesis, data pipelines, lakehouse patterns, batch or streaming analytics, schema evolution, or querying and transformation workflows in AWS."
---

# AWS Analytics

Use this skill for data and analytics workflows in AWS.

## Do First

1. Read `references/analytics.md`
2. Use AWS Knowledge and Documentation MCP for current analytics-service guidance
3. Use AWS API MCP to inspect workgroups, crawlers, streams, clusters, or jobs when live access exists

## Rules

- Distinguish storage layout problems from query-engine problems
- Treat schema evolution, partitioning, and data quality as first-class concerns
- Review cost and latency tradeoffs before recommending architecture changes
