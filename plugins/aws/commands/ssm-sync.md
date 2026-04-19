---
description: Plan or run a safe AWS Systems Manager Parameter Store sync for this repo
argument-hint: [optional-sync-goal]
allowed-tools: [Read, Glob, Grep, Bash, Write, Edit, WebFetch]
---

# AWS SSM Sync

This command helps with the repo's Parameter Store contract and sync workflow.

## Arguments

The user invoked this command with: $ARGUMENTS

## Instructions

When this command is invoked:

1. Read `skills/aws-parameter-store/SKILL.md`
2. Use `skills/aws-parameter-store/references/ssm-flow.md`
3. Prefer a dry-run or audit before a live sync
4. Never print secret values from env files or SSM responses

## Example Usage

```text
/aws:ssm-sync
/aws:ssm-sync audit the secret contract before syncing
```
