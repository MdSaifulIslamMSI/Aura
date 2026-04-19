---
name: "aws-iam-auth"
description: "AWS identity and access guidance. Use when working with IAM users, roles, policies, trust relationships, STS, permission boundaries, profile confusion, cross-account access, federation, or authentication failures in AWS workflows."
---

# AWS IAM Auth

Use this skill for AWS identity and access work.

## Do First

1. Read `references/iam-auth.md`
2. Use AWS Knowledge and Documentation MCP for current IAM guidance
3. Use AWS API MCP for live identity inspection when account credentials are available

## Rules

- Prefer least privilege over convenience
- Review both identity policy and trust policy sides of access problems
- Separate authentication failures from authorization failures before changing permissions
