---
name: "aws-parameter-store"
description: "Safe AWS Systems Manager Parameter Store workflows for this repo. Use when syncing `server/.env.aws-secrets` into SSM, auditing the secret contract, previewing dry-runs, resolving path-prefix or region issues, or comparing repo env files to SSM expectations."
---

# AWS Parameter Store

Use this skill when the task is about the repo's secret contract and SSM sync
flow.

## Do First

1. Read `references/ssm-flow.md`
2. Prefer `npm run aws:ssm:audit` or a dry-run before a live sync
3. Inspect `infra/aws/sync-parameter-store-env.ps1` before changing sync behavior

## Rules

- Never print secret values from env files or SSM
- Prefer `.env.aws-secrets.example` or dry-runs when exploring the contract
- Keep path prefix and region explicit if they are missing from the environment
- Treat skipped placeholders as expected behavior, not silent data loss
