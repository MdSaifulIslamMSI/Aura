# Aura Production CI/CD installation

## Repository integration note

This repository has two production entrypoints:

- `.github/workflows/production-on-push.yml` is the automatic release train for every `main` push.
- `.github/workflows/production-cicd.yml` is the manual command center for selected deploys, rollbacks, and signed releases.

The reusable lane workflows are intentionally separate so each surface can be tested and repaired independently, but humans should start from the two entrypoints above.

This repository uses the full manual command center from the package, with repo-specific compatibility fixes:

- The storefront deploy still calls the existing multi-host workflow that
  publishes Netlify, Vercel, and AWS from one shared build.
- AWS-only storefront deploy remains available as a direct manual fallback; it
  is not a separate command-center target.
- Desktop release signing remains optional for the current free/internal release
  lane. Unsigned desktop artifacts are internal testing builds only until real
  platform signing/notarization is configured.
- Rollback hook scripts are checked in for backend AWS, AWS frontend, Netlify,
  and the Vercel gateway.

Copy these files into your repository:

```text
.github/workflows/production-on-push.yml
.github/workflows/production-cicd.yml
.github/workflows/production-admin-access.yml
.github/workflows/rollback-backend-aws.yml
.github/workflows/rollback-frontend-aws.yml
.github/workflows/rollback-netlify.yml
.github/workflows/rollback-storefront-vercel.yml
.github/workflows/rollback-gateway-vercel.yml
```

This package assumes these existing reusable workflows already exist:

```text
.github/workflows/ci.yml
.github/workflows/deploy-backend-aws.yml
.github/workflows/deploy-netlify.yml
.github/workflows/deploy-frontend-aws.yml
.github/workflows/deploy-gateway-vercel.yml
.github/workflows/desktop-release.yml
.github/workflows/mobile-release.yml
```

The backend deploy workflow must build the default `linux/arm64` image on a native GitHub ARM64 runner. Do not move that lane back to an x64 runner with QEMU for normal production releases; emulated ARM64 `npm ci` can fail with `Illegal instruction`.

The backend GitHub OIDC role must also allow `ssm:PutParameter` for the configured production runtime prefix, for example `/aura/prod/*`. Re-run `infra/aws/bootstrap-github-oidc.ps1` after installing this package so the manual admin access workflow can write allowlist values directly to Parameter Store.

Create a GitHub environment named `production` and add required reviewers.

Required repository variables/secrets used by the orchestrator:

```text
AWS_DEPLOY_ROLE_ARN
AWS_DEPLOY_BUCKET
AWS_INSTANCE_TAG_VALUE
AWS_PARAMETER_STORE_PATH_PREFIX
AURA_BACKEND_ORIGIN or AWS_BACKEND_BASE_URL
NETLIFY_AUTH_TOKEN
NETLIFY_SITE_ID
NETLIFY_PRODUCTION_URL
AWS_FRONTEND_BUCKET
AWS_FRONTEND_DISTRIBUTION_ID
AWS_FRONTEND_PUBLIC_URL
AWS_FRONTEND_DEPLOY_ROLE_ARN
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
GATEWAY_PRODUCTION_URL
```

Rollback workflows intentionally call project rollback hooks. Add the hook that matches your platform:

```text
infra/aws/rollback-backend.sh or infra/aws/rollback-backend.ps1
infra/aws/rollback-frontend-s3.sh or infra/aws/rollback-frontend-s3.ps1
scripts/rollback-netlify.sh or scripts/rollback-netlify.ps1
scripts/rollback-storefront-vercel.sh
scripts/rollback-gateway-vercel.sh or scripts/rollback-gateway-vercel.ps1
```

This repo currently provides the `.sh` hooks listed above. AWS frontend deploys
also write completion-manifest-backed S3 rollback snapshots under
`_aura-rollback/<sha>/`. The AWS frontend rollback hook fails closed unless the
requested snapshot has that completion manifest; it never executes historical
application code in the production-credentialed restore job.

Manual production actions require typing:

```text
PRODUCTION
```

into the `confirm_production` input.

Select manual lanes with comma-separated target inputs. This keeps the
workflow within GitHub's 10-input `workflow_dispatch` limit while preserving
per-surface deploy and rollback gates.

```text
deploy_targets=backend,frontend-multihost,gateway
release_targets=desktop,mobile
rollback_targets=backend,frontend-multihost,gateway
rollback_refs_json={"backend":"sha","netlify":"deploy-id","vercel-storefront":"deployment-id","aws-frontend":"snapshot-ref","gateway":"deployment-id"}
```

Leave target inputs blank for no-op validation runs. Use only the targets you
intend to run; for example, the storefront multi-host deploy is
`frontend-multihost`. It deploys or rolls back Netlify, the Vercel storefront,
and AWS CloudFront as one command-center lane. The command center rejects a lane
selected for both deploy and rollback before any mutation. For rollback, supply
the selected providers' immutable identifiers through `rollback_refs_json`.
Backend rollback always requires a full known-good 40-character release SHA;
the workflow never guesses from release-directory timestamps. Automatic
post-deploy rollback uses the SHA captured before the backend mutation.

The command center and every direct production frontend or gateway mutation use
the same non-canceling production lock. Reusable deploy and rollback workflows
set `parent_holds_production_lock=true` only when the command center or the
multi-host parent already owns the lock; standalone calls leave it false.
Preview runs retain cancel-on-new-run behavior and never share the production
lock.
