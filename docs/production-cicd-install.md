# Aura Production CI/CD installation

## Repository integration note

This repository has two production entrypoints:

- `.github/workflows/production-on-push.yml` is the automatic release train for every `main` push.
- `.github/workflows/production-cicd.yml` is the manual command center for selected deploys, rollbacks, and signed releases.

The reusable lane workflows are intentionally separate so each surface can be tested and repaired independently, but humans should start from the two entrypoints above.

This repository uses the full manual command center from the package, with repo-specific compatibility fixes:

- The storefront deploy still calls the existing multi-host workflow that
  publishes Netlify, Vercel, and AWS from one shared build.
- AWS-only storefront deploy remains available as an explicit manual fallback.
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
scripts/rollback-gateway-vercel.sh or scripts/rollback-gateway-vercel.ps1
```

This repo currently provides the `.sh` hooks listed above. AWS frontend deploys
also write S3 rollback snapshots under `_aura-rollback/<sha>/`; if a snapshot is
missing, the AWS frontend rollback hook can rebuild a supplied `ROLLBACK_REF`
from the checked-out git ref.

Manual production actions require typing:

```text
PRODUCTION
```

into the `confirm_production` input.
