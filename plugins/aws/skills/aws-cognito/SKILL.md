---
name: "aws-cognito"
description: "AWS Cognito guidance. Use when working with user pools, identity pools, login flows, tokens, hosted UI, federation, app clients, callback URLs, session behavior, or Cognito integration issues in web or mobile apps."
---

# AWS Cognito

Use this skill for Cognito-centered auth and identity work.

## Do First

1. Read `references/cognito.md`
2. Use AWS Knowledge and Documentation MCP for current Cognito auth and token guidance
3. Use AWS API MCP to inspect pools, clients, domains, and config when live access exists

## Rules

- Separate user-pool auth problems from identity-pool federation problems
- Review callback URLs, app client settings, and token usage together
- Treat token storage and session handling as security-sensitive design choices
