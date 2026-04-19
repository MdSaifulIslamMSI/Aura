---
name: "aws-waf-shield"
description: "AWS WAF and Shield guidance. Use when reviewing or tuning web ACLs, managed rules, custom rules, rate limiting, bot or abuse controls, ALB or CloudFront protection, false positives, or edge security posture in AWS."
---

# AWS WAF Shield

Use this skill for AWS edge and application-layer protection.

## Do First

1. Read `references/waf-shield.md`
2. Use AWS Knowledge and Documentation MCP for current WAF and Shield guidance
3. Use AWS API MCP to inspect ACLs, associations, managed rules, and rate-based rules when live access exists

## Rules

- Balance protection with false-positive risk
- Review rule order, scope, and associations together
- Treat edge protection as part of the delivery path, not a separate afterthought
