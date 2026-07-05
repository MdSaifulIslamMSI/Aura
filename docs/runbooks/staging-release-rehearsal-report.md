# Staging Release Rehearsal Report

Date: 2026-07-05

Scope: non-mutating staging credential and rollback-readiness rehearsal for Aura release gates.

## Safety Summary

| Item | Result |
| --- | --- |
| Production touched | NO |
| Production workflow dispatch triggered | NO |
| `confirm_production=PRODUCTION` used | NO |
| AWS resources created | NO |
| SSM secret values read or printed | NO |
| Secrets printed | NO |
| Permanent AWS access keys created | NO |

## Environment

The rehearsal exported staging variables into the local process environment only. No local env file was written.

| Variable | Result |
| --- | --- |
| `STAGING_BASE_URL` | configured |
| `STAGING_API_BASE_URL` | configured |
| `STAGING_FRONTEND_URL` | configured |
| `STAGING_HEALTH_URL` | configured |
| `STAGING_SSM_PREFIX` | configured as `/aura/staging` |
| `SMOKE_TARGET_ENV` | configured as `staging` |

## Local Results

| Check | Result | Notes |
| --- | --- | --- |
| AWS identity verified | YES | `aws sts get-caller-identity --profile aura-staging-operator` resolves to the staging operator assumed role. |
| Local profile setup | PASS | `aura-staging-operator` was created as a unique staging role-assumption profile because IAM Identity Center is not discoverable in the AWS account. No access keys were created or stored on this profile. |
| Local credential checker | PASS | `npm run credentials:check:local-release` passed with staging environment variables and `STAGING_SSM_PREFIX=/aura/staging`. The checker rejects direct static credentials and production-looking role profiles. |
| Staging smoke | PASS | Live staging contract, health, API health, uploads, and socket checks passed. |
| Frontend smoke | PASS | Staging frontend, assets, health proxies, upload proxy, and socket proxy checks passed. |
| Env contract | PASS | Full staging environment contract passed. |
| Cost guard | PASS | `npm run aws:cost-guard` passed locally with one Cost Explorer forecast-start warning. |
| Observability guard | PASS | `npm run aws:observability:guard` passed locally with zero warnings. |
| Rollback-ready | PASS | `npm run release:rollback-ready` passed locally and confirmed the rollback release prefix contains `infra.tar.gz` and `image.tar.gz`. |
| Traffic audit | PASS | Smoothness, abuse-resistance, and regression audits passed. Generated traffic docs were reverted because they were not part of this report change. |
| CI doctor | PASS | Critical CI/CD structure checks passed. |
| `git diff --check` | PASS | No whitespace errors before report creation. |

## CI Results

Read-only `Giant Release Gates` was dispatched on `main` to rehearse CI staging credentials without invoking any production workflow.

Run: https://github.com/MdSaifulIslamMSI/Aura/actions/runs/28745888757

| Check | Result |
| --- | --- |
| `test` | PASS |
| `security` | PASS |
| `smoke:staging` | PASS |
| `smoke:staging:frontend` | PASS |
| `smoke:env-contract` | PASS |
| `aws:cost-guard` | PASS |
| `aws:observability:guard` | PASS |
| `release:rollback-ready` | PASS |
| `test:reliability` | PASS |
| `sre:synthetic:staging` | PASS |
| `sre:latency:staging` | PASS |

## Rollback Target

GitHub `staging` environment variable `ROLLBACK_TARGET_SHA` is configured to:

```text
bf7c64fb9bb294576f9feb803d0e1729e02b5aff
```

CI rollback readiness confirmed that this target is artifact-backed: the release prefix contains both `infra.tar.gz` and `image.tar.gz`.

## Remaining Blockers

1. IAM Identity Center is still not available or discoverable in this standalone AWS account. If it is later enabled, migrate `aura-staging-operator` to SSO with `aws configure sso --profile aura-staging-operator` or `npm run credentials:setup:local-release-sso`.
2. Keep the current `aura-staging-operator` profile pointed only at the staging operator role. Do not add access keys directly to that profile and do not point it at production.
3. Rerun the local AWS-dependent checks after any profile change:

```powershell
$env:AWS_PROFILE = 'aura-staging-operator'
npm run credentials:check:local-release
npm run aws:cost-guard
npm run aws:observability:guard
npm run release:rollback-ready
```

Read-only CLI discovery after the rehearsal did not find IAM Identity Center metadata:

- `sso-admin list-instances` returned no IAM Identity Center instances in any enabled region for the available discovery profile.
- The staging bootstrap role was denied SSO-admin and IAM role listing, which is consistent with least privilege.
- `iam list-roles --path-prefix /aws-reserved/sso.amazonaws.com/` returned no reserved SSO roles for the available admin CLI profile.
- The AWS account reported that it is not a member of an AWS Organization, so there is no organization-level Identity Center instance to reuse from this account.

## Release Readiness

CI staging credentials and rollback artifact proof are ready.

Local release-gate credentials are ready with the unique `aura-staging-operator` staging role-assumption profile. A future IAM Identity Center migration would improve local credential hygiene further, but it is not available from the current AWS account state.
