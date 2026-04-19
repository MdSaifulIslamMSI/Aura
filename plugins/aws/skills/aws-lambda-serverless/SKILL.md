---
name: "aws-lambda-serverless"
description: "AWS Lambda and serverless workflow guidance. Use when building, reviewing, or debugging Lambda functions, event triggers, layers, function URLs, environment variables, cold starts, deployment packaging, or serverless operational issues."
---

# AWS Lambda Serverless

Use this skill for Lambda-centered work.

## Do First

1. Read `references/lambda.md`
2. Use AWS Knowledge and Documentation MCP for current limits and service integrations
3. Use AWS API MCP to inspect function config or trigger state when live access exists

## Rules

- Match packaging and runtime advice to the actual language and deployment method
- Separate handler logic issues from trigger, IAM, networking, and env config issues
- Treat concurrency, timeout, and cold-start tradeoffs as first-class concerns
