---
name: "aws-route53-dns"
description: "AWS Route 53 and DNS guidance. Use when designing or debugging hosted zones, records, aliases, health checks, weighted or failover routing, domain cutovers, certificate validation, or name-resolution issues in AWS."
---

# AWS Route 53 DNS

Use this skill for AWS DNS and traffic-routing work.

## Do First

1. Read `references/route53.md`
2. Use AWS Knowledge and Documentation MCP for current Route 53 guidance
3. Use AWS API MCP to inspect hosted zones, records, and health checks when live access exists

## Rules

- Separate DNS propagation and resolver-cache issues from wrong-record issues
- Review certificate validation, aliases, and health checks together
- Treat cutover and failover changes as high-impact operations
