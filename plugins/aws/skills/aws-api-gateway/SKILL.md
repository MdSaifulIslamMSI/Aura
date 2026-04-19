---
name: "aws-api-gateway"
description: "AWS API Gateway guidance. Use when designing, reviewing, or debugging REST APIs, HTTP APIs, routes, stages, authorizers, Lambda integrations, CORS, throttling, custom domains, or request and response issues in API Gateway."
---

# AWS API Gateway

Use this skill for API Gateway architecture and troubleshooting.

## Do First

1. Read `references/api-gateway.md`
2. Use AWS Knowledge and Documentation MCP for current API Gateway patterns
3. Use AWS API MCP to inspect APIs, routes, stages, integrations, and auth config when live access exists

## Rules

- Separate API definition issues from backend integration issues
- Review auth, CORS, throttling, and stage behavior together
- Treat custom domains and certificates as part of the delivery path, not an afterthought
