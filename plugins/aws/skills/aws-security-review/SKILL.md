---
name: "aws-security-review"
description: "AWS security posture guidance. Use when reviewing public exposure, encryption, secret handling, identity design, network hardening, logging posture, or service configuration choices for least privilege and safer defaults in AWS."
---

# AWS Security Review

Use this skill for AWS-specific security reviews and hardening guidance.

## Do First

1. Read `references/security.md`
2. Use AWS Knowledge and Documentation MCP for current service-specific security guidance
3. Use AWS API MCP for live posture inspection only when credentials and scope make sense

## Rules

- Prioritize public exposure, secrets, and privilege boundaries first
- Distinguish exploitable risk from style or preference
- Prefer safer defaults that fit the current architecture instead of blanket rewrites
