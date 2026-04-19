# Incident Response Playbook

## Use This When

A system is broken, degraded, leaking errors, under abuse, or behaving
unexpectedly in production and you need structured triage.

## Common AWS Building Blocks

- CloudWatch logs, metrics, dashboards, and alarms
- IAM and STS context for permission failures
- WAF and CloudFront for edge issues and abuse spikes
- Route 53 and networking layers for reachability problems
- service-specific runtime skills such as ECS, Lambda, RDS, DynamoDB, or API Gateway

## Plugin Skills To Pull In First

- `aws-observability`
- `aws-security-review`
- `aws-waf-shield`
- `aws-route53-dns`
- `aws-vpc-networking`
- the service skill that matches the failing component

## Copy-Paste Prompts

```text
Help me triage an AWS production incident. Start by narrowing whether this looks like networking, DNS, app runtime, auth, abuse traffic, or a data dependency failure.
```

```text
Review the likely blast radius and first containment steps for an AWS service outage or active abuse event.
```

```text
I have alarms, elevated errors, and slow requests in AWS. Give me an investigation flow that prioritizes the highest-signal checks first.
```

## What Good Output Looks Like

- a calm, ordered triage sequence instead of generic advice
- narrowing checks that separate edge, network, runtime, identity, and data failures
- containment thinking for security or abuse cases
- follow-up fixes that reduce repeat incidents after recovery
