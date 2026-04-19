---
name: "aws-rds-databases"
description: "AWS RDS and Aurora guidance. Use when designing, reviewing, or debugging managed database deployment, connectivity, backups, failover, parameter groups, migration planning, performance concerns, or operational safety around RDS or Aurora."
---

# AWS RDS Databases

Use this skill for managed relational database work in AWS.

## Do First

1. Read `references/rds.md`
2. Use AWS Knowledge and Documentation MCP for current engine-specific guidance
3. Use AWS API MCP to inspect instance, cluster, subnet group, and parameter state when live access exists

## Rules

- Treat backups, restore posture, and maintenance windows as first-class concerns
- Separate DB-engine behavior from network and auth problems
- Review storage, performance, and failover tradeoffs together
