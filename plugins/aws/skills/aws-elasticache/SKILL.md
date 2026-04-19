---
name: "aws-elasticache"
description: "AWS ElastiCache guidance. Use when designing, reviewing, or debugging Redis or Memcached in AWS, including topology choices, replication, failover, auth, subnet placement, eviction behavior, connection issues, and application cache integration."
---

# AWS ElastiCache

Use this skill for managed cache design and troubleshooting in AWS.

## Do First

1. Read `references/elasticache.md`
2. Use AWS Knowledge and Documentation MCP for current ElastiCache guidance
3. Use AWS API MCP to inspect clusters, replication groups, subnet groups, and parameter settings when live access exists

## Rules

- Distinguish client-library problems from network and cache-topology problems
- Review auth, TLS, subnet placement, and failover together
- Treat eviction policy and key-shape behavior as application design concerns
