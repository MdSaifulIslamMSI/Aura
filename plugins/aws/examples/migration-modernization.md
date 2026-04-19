# Migration And Modernization Playbook

## Use This When

You are moving an existing system to AWS, splitting a monolith, or trying to
reduce operational drag and architecture drift over time.

## Common AWS Building Blocks

- EC2, ECS, Lambda, or EKS for target runtime choices
- RDS, DynamoDB, S3, ElastiCache, and OpenSearch for state and access patterns
- IAM, KMS, Secrets Manager, and VPC controls for baseline safety
- CloudWatch and rollout tooling for migration visibility

## Plugin Skills To Pull In First

- `aws-migration-modernization`
- `aws-ec2-backend-deploy`
- `aws-ecs-containers`
- `aws-lambda-serverless`
- `aws-rds-databases`
- `aws-dynamodb`
- `aws-observability`
- `aws-security-review`

## Copy-Paste Prompts

```text
Help me choose between rehost, replatform, and redesign for this workload moving onto AWS. I want the smallest safe migration path first, not the fanciest one.
```

```text
Review this migration plan for sequencing, data cutover risk, rollback design, secrets handling, and post-cutover observability.
```

```text
Map a phased modernization plan from a single-server or monolith-style deployment to a more managed AWS architecture without creating unnecessary complexity.
```

## What Good Output Looks Like

- a phased plan rather than an all-at-once transformation
- explicit cutover, rollback, and data sync concerns
- realistic notes on team maturity and operational burden
- advice that reduces long-term drift instead of simply copying the current mess into AWS
