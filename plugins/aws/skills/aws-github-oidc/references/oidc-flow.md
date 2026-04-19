# OIDC Flow

## Main Files

- `infra/aws/bootstrap-github-oidc.ps1`
- `.github/workflows/deploy-backend-aws.yml`

## What the bootstrap script does

- Resolves the repo slug from git or an explicit input
- Creates or reuses the GitHub OIDC provider
- Creates or updates the deploy IAM role
- Builds trust policy subjects from the repo, branch, and optional GitHub environment
- Writes inline permissions for S3 artifact access plus EC2 and SSM deploy commands

## What the workflow expects

- `AWS_REGION`
- `AWS_DEPLOY_BUCKET`
- `AWS_INSTANCE_TAG_KEY`
- `AWS_INSTANCE_TAG_VALUE`
- `AWS_PARAMETER_STORE_PATH_PREFIX`
- `AWS_DOCKER_PLATFORM`
- `AWS_DEPLOY_ROLE_ARN`

## Review Checklist

- Do trust policy subjects still match the repo and target branch?
- Does the deploy role still cover only the bucket plus the EC2 and SSM actions needed for rollout?
- Do the workflow env defaults and the bootstrap output still agree?
