# GitHub OIDC Release Credentials

This runbook documents the CI credential model for Aura release gates. GitHub Actions must assume AWS roles through OpenID Connect (OIDC). Do not store long-lived AWS access keys in GitHub secrets.

References:

- AWS IAM GitHub OIDC role guidance: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html#idp_oidc_Create_GitHub
- Repo bootstrap script: `scripts/staging/00-create-iam-auth.sh`
- Production backend OIDC bootstrap: `infra/aws/bootstrap-github-oidc.ps1`
- Giant release gates workflow: `.github/workflows/giant-release-gates.yml`

## OIDC Flow

GitHub Actions jobs request a short-lived OIDC token from GitHub, then `aws-actions/configure-aws-credentials` exchanges it for AWS STS credentials by assuming the configured IAM role.

The workflow must keep:

```yaml
permissions:
  contents: read
  id-token: write
```

The workflow must use role assumption, not stored AWS keys:

```yaml
- uses: aws-actions/configure-aws-credentials@e7f100cf4c008499ea8adda475de1042d6975c7b
  with:
    aws-region: ${{ env.AWS_REGION }}
    role-to-assume: ${{ env.STAGING_AWS_DEPLOY_ROLE_ARN }}
    role-session-name: aura-giant-release-staging-smoke
    mask-aws-account-id: true
    unset-current-credentials: true
```

## Staging Environment Requirements

Store these on the GitHub `staging` environment unless a workflow explicitly documents a different scope.

| Name | Type | Secret? | Purpose |
|---|---|---:|---|
| `STAGING_AWS_DEPLOY_ROLE_ARN` | environment variable or secret | No by itself | Staging OIDC role ARN assumed by release gates. Use a secret if the repo treats account IDs as private. |
| `AWS_REGION` | environment variable | No | AWS region for staging. |
| `AWS_ACCOUNT_ID` | environment variable | No by itself | Staging account id used by IAM bootstrap and checks. Use a secret if account IDs are private. |
| `PROJECT_NAME` | environment variable | No | Defaults to `aura`. |
| `STAGING_NAME` | environment variable | No | Defaults to `staging`. |
| `STAGING_SSM_PREFIX` | environment variable | No | Must be `/aura/staging`. |
| `STAGING_BASE_URL` | environment variable | No | Non-secret staging frontend URL. |
| `STAGING_FRONTEND_URL` | environment variable | No | Non-secret staging frontend URL used by frontend smoke. |
| `STAGING_API_BASE_URL` | environment variable | No | Non-secret staging backend URL. |
| `STAGING_HEALTH_URL` | environment variable | No | Non-secret staging health URL. |
| `PROD_BASE_URL` | environment variable | No | Non-secret comparison value only. |
| `PROD_API_BASE_URL` | environment variable | No | Non-secret comparison value only. |
| `PROD_SSM_PREFIX` | environment variable | No | Must be `/aura/prod`; comparison value only. |
| `AWS_DEPLOY_BUCKET` | environment variable | No by itself | Release or rollback artifact bucket expected by rollback-readiness checks. |
| `ROLLBACK_ARTIFACT_URI` | environment variable | No by itself | Explicit rollback artifact URI when live rollback proof is required. |
| `ROLLBACK_TARGET_SHA` | environment variable | No | Explicit last-known artifact-backed commit SHA used for rollback proof. Do not default it to the latest PR or main SHA unless that SHA has release artifacts. |
| `STAGING_SSH_PRIVATE_KEY` | secret | Yes | Only for the manual staging deploy workflow. Not needed by read-only PR gates. |

Do not create GitHub secrets named `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or `AWS_SESSION_TOKEN` for these gates.

## Production Environment Separation

Staging and production must not share GitHub environments, role ARNs, SSM prefixes, buckets, URLs, or approval rules.

- Staging release gates run under the GitHub `staging` environment.
- Production deploy and rollback workflows must use production-specific roles and variables.
- Staging jobs must keep `STAGING_SSM_PREFIX=/aura/staging`.
- Production jobs must keep `AWS_PARAMETER_STORE_PATH_PREFIX=/aura/prod` or `PROD_SSM_PREFIX=/aura/prod`, depending on the workflow.
- PR release gates must not run production mutation gates.
- Production mutation requires the existing explicit production controls; do not bypass them with staging credentials.

## Least-Privilege Requirements

Each OIDC role must be scoped to the smallest action set needed by that workflow.

Staging read/release-gate role:

- Allows read-only EC2, S3, CloudWatch, CloudWatch Logs, Cost Explorer, and staging Parameter Store metadata needed by the release gates.
- Allows SSM command reads needed to observe staging command results.
- Does not allow production SSM prefixes, production buckets, production instance tags, or production deploy actions.

Staging deploy role:

- May include staging EC2, staging S3, and staging SSM mutation actions only where the manual staging deploy workflow needs them.
- Must retain tags, prefix checks, and explicit deploy enablement gates.
- Must not create paid resources outside the documented free-tier staging envelope.

Production roles:

- Must be separate from staging roles.
- Must remain bound to production workflows and protected environments.
- Must not be used for local staging checks or PR staging gates.

## Trust Policy Requirements

Trust policies must limit GitHub OIDC subjects to this repository, approved branches, and the intended GitHub environment.

For staging gates in this repo, keep the allowed subjects equivalent to:

```json
[
  "repo:MdSaifulIslamMSI/Aura:ref:refs/heads/main",
  "repo:MdSaifulIslamMSI/Aura:environment:staging"
]
```

The trust policy must also require:

```json
{
  "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
}
```

Do not use an organization-wide wildcard, repository wildcard, or branch wildcard for release-gate roles. If a temporary exception is required, document the expiry and remove it before marking a PR ready.

## Bootstrap And Verify

Render and inspect staging IAM policy documents before applying:

```sh
STAGING_IAM_DRY_RUN=true npm run staging:iam:bootstrap
```

After explicit approval to update staging IAM, apply the bootstrap without the dry-run flag, then verify:

```sh
npm run aws:cost-guard
npm run aws:observability:guard
npm run smoke:env-contract
```

These commands must fail closed when role assumption, staging variables, cost guardrails, observability guardrails, smoke gates, rollback gates, or traffic gates are not satisfied.
