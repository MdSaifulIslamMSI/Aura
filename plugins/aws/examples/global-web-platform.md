# Global Web Platform Playbook

## Use This When

You are designing or reviewing an internet-facing application that needs fast
delivery, identity, data storage, observability, and layered security.

## Common AWS Building Blocks

- Route 53 for DNS and traffic entry
- CloudFront for CDN, TLS termination, and edge caching
- WAF for abuse controls, managed rules, and rate limiting
- ECS, EC2, or Lambda for compute
- API Gateway when the backend is API-first or serverless
- RDS, DynamoDB, or ElastiCache for persistence and performance
- CloudWatch for visibility and alarms

## Plugin Skills To Pull In First

- `aws-route53-dns`
- `aws-cloudfront-edge`
- `aws-waf-shield`
- `aws-ecs-containers` or `aws-lambda-serverless`
- `aws-rds-databases`, `aws-dynamodb`, and `aws-elasticache`
- `aws-observability`
- `aws-security-review`

## Copy-Paste Prompts

```text
Review my internet-facing AWS architecture for reliability, cache design, public exposure, and rollback safety.
```

```text
Map a global web platform on AWS for a product with CloudFront, WAF, DNS, application compute, primary data storage, and observability. Show the smallest production-ready version first.
```

```text
Compare ECS, Lambda, and EC2 for this workload, then explain how Route 53, CloudFront, WAF, and the data layer should fit together.
```

## What Good Output Looks Like

- a clear recommended stack instead of a vague service dump
- explicit tradeoffs around cost, latency, and operations
- concrete notes on secrets, TLS, abuse protection, and monitoring
- rollout and rollback thinking, not just architecture diagrams
