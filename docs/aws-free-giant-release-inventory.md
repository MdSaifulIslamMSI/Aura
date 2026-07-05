# AWS Free Giant Release Inventory

Generated from read-only local and AWS checks on 2026-07-05.

## Summary

Aura has separate AWS staging and production EC2 hosts. Staging is full-stack on the AWS staging origin, but the local `.staging/state.json` in the original checkout was stale and pointed to an older EC2 public DNS/IP. The release hardening work adds a state refresh/check gate so local smoke commands do not keep using stale staging state.

## Current Hosts

| Environment | Host | Evidence |
| --- | --- | --- |
| Staging | `http://ec2-43-205-214-241.ap-south-1.compute.amazonaws.com` | Running EC2 `i-0af0bd44f6463b11b`, `Environment=staging`, `ManagedBy=codex-staging-bootstrap`, `t3.micro`, launched `2026-07-04T04:55:31Z`. |
| Production backend | `ec2-13-206-172-186.ap-south-1.compute.amazonaws.com` | Running EC2 `i-081546f5786414e38`, `Environment=production`, `ManagedBy=codex-aws-bootstrap`, `t4g.small`, launched `2026-06-20T16:55:19Z`. |

## Staging State Drift

| File | Recorded host | AWS active host | Status |
| --- | --- | --- | --- |
| `.staging/state.json` in the original checkout | `ec2-13-201-55-118.ap-south-1.compute.amazonaws.com` | `ec2-43-205-214-241.ap-south-1.compute.amazonaws.com` | Stale before refresh. |

## CloudFront

The current staging operator role could not run `cloudfront:ListDistributions`; AWS returned `AccessDenied`. Existing production workflows and docs still reference CloudFront-backed production frontend distribution checks, but this inventory could not verify the live distribution ID with the available read-only role.

## S3 Buckets

Known Aura bucket checked:

| Bucket | Read-only evidence |
| --- | --- |
| `aura-staging-uploads-942679464475-ap-south-1-v2` | `aws s3 ls` showed `backups/` and `bootstrap/` prefixes. |

Other production deploy/frontend buckets are referenced by workflows and GitHub variables, but were not locally resolved from the staging operator environment.

## IAM And GitHub OIDC

Local AWS caller identity used the assumed role `aura-staging-bootstrap-operator`. GitHub OIDC usage is present in deployment and rollback workflows through `aws-actions/configure-aws-credentials` with `id-token: write` and role variables including `STAGING_AWS_DEPLOY_ROLE_ARN`, `AWS_DEPLOY_ROLE_ARN`, and `AWS_FRONTEND_DEPLOY_ROLE_ARN`.

## SSM Prefixes

Required prefixes:

| Prefix | Purpose | Inventory result |
| --- | --- | --- |
| `/aura/staging` | Isolated staging runtime config. | Expected by staging scripts and smoke gates. `ssm:DescribeParameters` was denied for names-only inventory. |
| `/aura/prod` | Production runtime config. | Expected by production workflows and deployment docs. `ssm:DescribeParameters` was denied for names-only inventory. |

No SSM values were read or printed.

## Monitoring And Logging

Read-only checks found one VPC flow log: `fl-0cd57bd032bdea126`, resource `vpc-0285b12b9face02d2`, destination CloudWatch Logs group `/aws/vpc/aura-backend-flow-logs`.

The staging operator role was denied for:

- `cloudtrail:DescribeTrails`
- `config:DescribeConfigurationRecorders`
- `logs:DescribeLogGroups`

The new observability guard fails closed if log retention cannot be checked.

## Current Month Cost

Cost Explorer month-to-date unblended cost returned `0.0000004506 USD` for the current month window at inventory time.

Budgets found:

| Budget | Limit |
| --- | --- |
| `aura-backend-monthly-guardrail` | `90 USD` monthly |
| `aura-staging-monthly-budget` | `5 USD` monthly |

## Resources That May Be Paid

- Production EC2 `t4g.small`.
- Staging EC2 `t3.micro`.
- Public IPv4 addresses attached to running EC2 hosts.
- S3 storage and request charges for staging backups/bootstrap artifacts.
- CloudWatch Logs ingestion/storage for flow logs and app logs.
- CloudFront distribution and invalidations where configured.
- Any AWS service that appears unexpectedly in cost guard checks: NAT Gateway, ALB/NLB, RDS, ElastiCache, or OpenSearch.

## Read-Only Commands Run

- `git status --short --branch`
- `git log --oneline -5`
- `gh pr status`
- `aws sts get-caller-identity`
- `aws configure get region`
- `aws ec2 describe-instances` for staging and production tags
- `aws ssm describe-parameters` for `/aura/staging` and `/aura/prod` names only
- `aws cloudfront list-distributions`
- `aws s3 ls` for known Aura buckets only
- `aws budgets describe-budgets`
- `aws ce get-cost-and-usage`
- `aws ec2 describe-flow-logs`
- CloudTrail, Config, and CloudWatch Logs read-only inventory checks, which were denied by IAM
