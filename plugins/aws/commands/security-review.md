---
description: Review AWS identity, network exposure, secrets, encryption, and abuse controls
argument-hint: [security-focus]
allowed-tools: [Read, Glob, Grep, Bash, Write, Edit, WebFetch]
---

# AWS Security Review

This command reviews AWS security posture with emphasis on practical exposure
and containment risks.

## Arguments

The user invoked this command with: $ARGUMENTS

## Instructions

When this command is invoked:

1. Read `skills/aws-security-review/SKILL.md`
2. Pull in `aws-iam-auth`, `aws-secrets-manager`, `aws-kms`, `aws-waf-shield`, and `aws-vpc-networking` when relevant
3. Focus on public exposure, least privilege, encryption, secret delivery, logging, and abuse controls
4. Never print secret values or encourage unsafe credential handling
5. Prioritize actionable fixes with the highest blast-radius reduction first

## Example Usage

```text
/aws:security-review
/aws:security-review check my public edge, IAM, and secret handling posture
```
