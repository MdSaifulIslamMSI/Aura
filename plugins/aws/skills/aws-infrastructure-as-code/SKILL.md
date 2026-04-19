---
name: "aws-infrastructure-as-code"
description: "AWS infrastructure-as-code guidance. Use when designing or reviewing AWS changes expressed through CloudFormation, CDK, Terraform, or script-to-IaC migration planning, especially when choosing how to model cloud resources and reduce manual drift."
---

# AWS Infrastructure as Code

Use this skill for IaC choices and review workflows around AWS resources.

## Do First

1. Read `references/iac.md`
2. Match recommendations to the user's existing IaC system when one already exists
3. Use AWS Knowledge and Documentation MCP for current service-specific resource modeling guidance

## Rules

- Prefer consistency with the existing IaC system over tool churn
- Distinguish modeling problems from provider or state problems
- Treat drift detection and rollout safety as part of IaC design
