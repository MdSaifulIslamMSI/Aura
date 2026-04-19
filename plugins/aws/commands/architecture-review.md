---
description: Review an AWS architecture for resilience, security, operability, and cost tradeoffs
argument-hint: [architecture-focus]
allowed-tools: [Read, Glob, Grep, Bash, Write, Edit, WebFetch]
---

# AWS Architecture Review

This command reviews a target AWS design and prioritizes risks, tradeoffs, and
safe next steps.

## Arguments

The user invoked this command with: $ARGUMENTS

## Instructions

When this command is invoked:

1. Read `skills/aws-runtime/SKILL.md`
2. Pull in the service-specific skill files that match the architecture being discussed
3. Review for security, resilience, cost, deployment safety, and observability gaps
4. Prioritize concrete risks and likely regressions over broad overviews
5. Prefer the smallest production-worthy architecture that fits the stated goal

## Example Usage

```text
/aws:architecture-review
/aws:architecture-review review my CloudFront, ECS, RDS, and Route 53 design
```
