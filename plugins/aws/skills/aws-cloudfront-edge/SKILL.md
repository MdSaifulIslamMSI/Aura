---
name: "aws-cloudfront-edge"
description: "AWS CloudFront and edge delivery guidance. Use when working with CloudFront, Route 53, ACM certificates, origins, caching strategy, invalidations, signed delivery, CDN troubleshooting, or edge request-routing behavior."
---

# AWS CloudFront Edge

Use this skill for CDN and edge delivery work.

## Do First

1. Read `references/cloudfront.md`
2. Use AWS Knowledge and Documentation MCP for current edge-delivery patterns
3. Use AWS API MCP to inspect distributions, cache behavior, and cert attachment when live access exists

## Rules

- Review origin security, certificate setup, DNS, and caching together
- Distinguish origin failures from CDN cache behavior
- Treat invalidation cost and cache-key design as architecture decisions
