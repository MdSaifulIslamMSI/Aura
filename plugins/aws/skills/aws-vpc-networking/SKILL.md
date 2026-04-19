---
name: "aws-vpc-networking"
description: "AWS networking guidance. Use when designing or debugging VPCs, subnets, route tables, security groups, NACLs, NAT gateways, internet access, private connectivity, VPC endpoints, or service-to-service reachability issues."
---

# AWS VPC Networking

Use this skill for AWS network architecture and reachability debugging.

## Do First

1. Read `references/vpc.md`
2. Use AWS Knowledge and Documentation MCP for current VPC patterns
3. Use AWS API MCP to inspect route tables, subnets, and security groups when live access exists

## Rules

- Distinguish routing problems from security-group problems from DNS problems
- Review ingress and egress, not just one side
- Treat private connectivity and egress cost as architecture tradeoffs
