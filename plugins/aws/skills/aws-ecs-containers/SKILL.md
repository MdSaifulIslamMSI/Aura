---
name: "aws-ecs-containers"
description: "AWS ECS and container deployment guidance. Use when working with ECS, Fargate, ECR, task definitions, service rollout, load balancers, container networking, image publishing, or production container troubleshooting in AWS."
---

# AWS ECS Containers

Use this skill for ECS and Fargate work.

## Do First

1. Read `references/ecs.md`
2. Use AWS Knowledge and Documentation MCP for current ECS service patterns
3. Use AWS API MCP to inspect clusters, services, tasks, and target groups when live access exists

## Rules

- Review image build, task definition, IAM, networking, and load balancing together
- Separate application crashes from orchestration failures
- Treat rollout health and rollback behavior as part of the design
