---
name: "aws-opensearch"
description: "AWS OpenSearch guidance. Use when designing, reviewing, or debugging OpenSearch domains, indexing pipelines, cluster sizing, access policy, query performance, ingestion flow, dashboard access, or search application architecture in AWS."
---

# AWS OpenSearch

Use this skill for search and indexing workloads in AWS.

## Do First

1. Read `references/opensearch.md`
2. Use AWS Knowledge and Documentation MCP for current OpenSearch guidance
3. Use AWS API MCP to inspect domain, access policy, cluster, and endpoint config when live access exists

## Rules

- Separate search-quality issues from cluster-health or indexing issues
- Review access policy, VPC exposure, and auth posture together
- Treat shard design, ingestion rate, and retention as core scaling choices
