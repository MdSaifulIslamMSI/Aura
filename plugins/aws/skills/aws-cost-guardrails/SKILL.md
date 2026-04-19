---
name: "aws-cost-guardrails"
description: "AWS cost and expiration guardrails for this repo's backend stack. Use when configuring the monthly budget action, SNS topic, scheduler stop/terminate policy, free-plan expiration handling, or reviewing `infra/aws/bootstrap-cost-guardrails.ps1`."
---

# AWS Cost Guardrails

Use this skill when the work is about protecting the AWS footprint from surprise
spend or stale free-plan resources.

## Do First

1. Read `references/guardrails.md`
2. Inspect `infra/aws/bootstrap-cost-guardrails.ps1`
3. Confirm the current EC2 instance tag and region assumptions

## Rules

- Preserve monthly budget alerts and automated protective actions
- Treat the free-plan expiration stop/terminate schedule as part of the intended design
- Check whether changes widen IAM permissions or relax shutdown behavior
