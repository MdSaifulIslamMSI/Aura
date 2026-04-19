---
name: "aws-kms"
description: "AWS KMS guidance. Use when working with KMS keys, key policies, grants, aliasing, envelope encryption, service integration, cross-account crypto access, rotation policy, or encryption failure debugging in AWS."
---

# AWS KMS

Use this skill for encryption-key architecture and KMS troubleshooting.

## Do First

1. Read `references/kms.md`
2. Use AWS Knowledge and Documentation MCP for current KMS service-integration guidance
3. Use AWS API MCP to inspect keys, aliases, grants, and policies when live access exists

## Rules

- Review key policy, IAM policy, and grants together
- Separate key-ownership and access-model questions from app-layer crypto questions
- Treat cross-account and cross-service access as high-risk review areas
