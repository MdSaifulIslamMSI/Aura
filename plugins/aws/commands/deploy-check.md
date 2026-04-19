---
description: Review EC2 backend deploy readiness and guardrails for this repo
argument-hint: [optional-deploy-focus]
allowed-tools: [Read, Glob, Grep, Bash, Write, Edit, WebFetch]
---

# AWS Deploy Check

This command reviews the repo's EC2 backend deployment shape, bootstrap
scripts, and GitHub OIDC rollout path.

## Arguments

The user invoked this command with: $ARGUMENTS

## Instructions

When this command is invoked:

1. Read `skills/aws-ec2-backend-deploy/SKILL.md`
2. Use `skills/aws-ec2-backend-deploy/references/deploy-flow.md`
3. Inspect the checked-in AWS docs, workflows, and deploy scripts before making
   recommendations
4. Prioritize risks, regressions, and rollout blockers over summaries

## Example Usage

```text
/aws:deploy-check
/aws:deploy-check review whether the backend rollout path is safe
```
