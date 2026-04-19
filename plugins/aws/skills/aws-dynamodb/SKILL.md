---
name: "aws-dynamodb"
description: "AWS DynamoDB guidance. Use when modeling tables, partition keys, sort keys, GSIs, LSIs, streams, TTL, access patterns, hot partitions, capacity behavior, or application design choices around DynamoDB."
---

# AWS DynamoDB

Use this skill for DynamoDB data modeling and operational review.

## Do First

1. Read `references/dynamodb.md`
2. Use AWS Knowledge and Documentation MCP for current DynamoDB modeling guidance
3. Use AWS API MCP to inspect table, index, stream, and capacity config when live access exists

## Rules

- Start from access patterns, not from relational-table instincts
- Treat hot partitions and item size as first-class design constraints
- Review GSIs, consistency, TTL, and stream usage together
