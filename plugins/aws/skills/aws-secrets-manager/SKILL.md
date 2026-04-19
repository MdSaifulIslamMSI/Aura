---
name: "aws-secrets-manager"
description: "AWS Secrets Manager guidance. Use when storing, rotating, retrieving, or integrating secrets in AWS applications, especially when comparing Secrets Manager to Parameter Store, reviewing secret access policy, or debugging runtime secret delivery."
---

# AWS Secrets Manager

Use this skill for managed secret lifecycle work in AWS.

## Do First

1. Read `references/secrets-manager.md`
2. Use AWS Knowledge and Documentation MCP for current secret-management guidance
3. Use AWS API MCP to inspect secret metadata, policy, and rotation state when live access exists

## Rules

- Never print secret values in user-facing output
- Distinguish secret storage choice from secret delivery choice
- Review rotation, retrieval path, and IAM access together
