# Apply Staging Release Guard IAM

This runbook updates the staging operator IAM role so the release guards can prove
staging is free-tier safe and observable. The permissions are read-only inventory
permissions used by `npm run aws:cost-guard` and
`npm run aws:observability:guard`.

This does not change production. The staging bootstrap script refuses non-staging
SSM prefixes and non-staging bucket values, and the policy update
targets the staging operator role generated from `PROJECT_NAME` and
`STAGING_NAME`.

## Why These Permissions Are Needed

The release gates fail closed when AWS inventory cannot be read. That is
intentional: without inventory access, CI cannot prove that staging stayed within
the low-cost resource envelope or that CloudWatch retention/visibility is safe.

## Required Read-Only Permissions

`scripts/aws/assert-free-tier-cost-guard.mjs` requires:

- `ec2:DescribeInstances`
- `ec2:DescribeAddresses`
- `ec2:DescribeNatGateways`
- `elasticloadbalancing:DescribeLoadBalancers`
- `rds:DescribeDBInstances`
- `elasticache:DescribeCacheClusters`
- `es:ListDomainNames`
- `s3:GetBucketVersioning`
- `s3:GetLifecycleConfiguration`
- `logs:DescribeLogGroups`
- `ce:GetCostForecast`
- `ce:GetCostAndUsage`

`scripts/aws/assert-observability-guard.mjs` requires:

- `logs:DescribeLogGroups`
- `cloudwatch:DescribeAlarms`
- `cloudwatch:ListDashboards`

The current staging bootstrap policy in
`scripts/staging/00-create-iam-auth.sh` includes these actions in
`ReadBootstrapDiscovery` and `ReadStagingCostExplorerUsage`.

## Apply

Prerequisites:

- Use an admin profile that can update the staging IAM role policy, passed by
  `STAGING_IAM_ADMIN_PROFILE` or `AWS_PROFILE`.
- Set `AWS_REGION`, `AWS_ACCOUNT_ID`, and `STAGING_BUCKET_NAME`.
- Set `GH_REPO` or run from a checkout where `gh repo view` resolves the repo,
  so the bootstrap preserves GitHub Actions OIDC trust for the staging
  environment.
- Keep `STAGING_SSM_PREFIX=/aura/staging`.

Run a dry-run first. This writes the rendered IAM policy JSON under `.staging/`
without applying it to AWS:

PowerShell:

```powershell
$env:AWS_REGION = "ap-south-1"
$env:AWS_ACCOUNT_ID = "<staging-account-id>"
$env:STAGING_BUCKET_NAME = "<staging-upload-bucket>"
$env:STAGING_SSM_PREFIX = "/aura/staging"
$env:GH_REPO = "MdSaifulIslamMSI/Aura"
$env:STAGING_IAM_DRY_RUN = "true"
npm run staging:iam:bootstrap
```

Bash:

```sh
export AWS_REGION=ap-south-1
export AWS_ACCOUNT_ID=<staging-account-id>
export STAGING_BUCKET_NAME=<staging-upload-bucket>
export STAGING_SSM_PREFIX=/aura/staging
export GH_REPO=MdSaifulIslamMSI/Aura
STAGING_IAM_DRY_RUN=true npm run staging:iam:bootstrap
```

Inspect `.staging/operator-policy.json` and confirm the read-only actions above
are present.

After explicit approval to mutate staging IAM, apply the same bootstrap without
the dry-run flag:

PowerShell:

```powershell
Remove-Item Env:STAGING_IAM_DRY_RUN -ErrorAction SilentlyContinue
npm run staging:iam:bootstrap
```

Bash:

```sh
unset STAGING_IAM_DRY_RUN
npm run staging:iam:bootstrap
```

This updates the staging operator role inline policy and preserves the GitHub
Actions OIDC trust needed by PR release gates. It does not deploy code, does not
touch production resources, and does not create paid AWS resources.

## Verify

After the staging IAM policy is applied, rerun:

```sh
npm run aws:cost-guard
npm run aws:observability:guard
```

Then rerun or requeue PR #302 checks for:

- `aws:cost-guard`
- `aws:observability:guard`

Both checks must pass before the PR can be marked ready or merged.

## Rollback And Safety

If the applied policy needs to be rolled back, restore the previous version of
`scripts/staging/00-create-iam-auth.sh`, run the dry-run, inspect
`.staging/operator-policy.json`, then apply the bootstrap again after explicit
approval.

Do not delete the staging role or instance profile as part of rollback unless
the staging environment is being intentionally decommissioned.

Production is not changed by this runbook. Keep `STAGING_SSM_PREFIX` set to
`/aura/staging`; never run this with production bucket names, production SSM
prefixes, or production role names.
