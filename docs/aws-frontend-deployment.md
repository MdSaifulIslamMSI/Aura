# AWS Frontend Deployment

This path hosts the Vite frontend as a static S3 website. It is intentionally low spend: no EC2, no Amplify app, no CloudFront distribution, and no Route 53 zone by default.

## What It Creates

- One S3 bucket named `aura-frontend-<account-id>-<region>` unless `-BucketName` is passed.
- S3 static website hosting with `index.html` as both the index and SPA fallback error document.
- Public read access for built static objects only.
- Server-side encryption, bucket owner enforced object ownership, lifecycle cleanup for incomplete uploads, and cost tags.
- Optional AWS Budget email alerts when `-BudgetEmail` is provided.

## Bootstrap

Run this once from the repository root:

```powershell
npm run aws:frontend:bootstrap -- -BudgetEmail you@example.com
```

Then create the GitHub OIDC deploy role:

```powershell
npm run aws:frontend:oidc
```

Add the printed values to GitHub repository variables:

```text
AWS_REGION=ap-south-1
AWS_FRONTEND_BUCKET=aura-frontend-<account-id>-ap-south-1
AWS_FRONTEND_DEPLOY_ROLE_ARN=arn:aws:iam::<account-id>:role/aura-github-actions-frontend-deploy
```

Production workflows require these AWS variables explicitly; checked-in account, bucket, distribution, and role fallbacks are not used for release deploys.

## Deploy Locally

The deploy script builds the same multi-host frontend bundle used by CI. Netlify and Vercel use their same-origin proxy rewrites for `/api`, `/health`, `/uploads`, and `/socket.io`; S3 website hosting cannot proxy those paths, so the same bundle resolves the configured hosted backend directly when it is running from the S3 website URL.

```powershell
npm run aws:frontend:deploy
```

Use `-BackendOrigin` to point the release at a durable HTTPS backend edge:

```powershell
npm run aws:frontend:deploy -- -BackendOrigin https://api.example.com
```

## GitHub Actions

The canonical production storefront workflow is [`deploy-netlify.yml`](../.github/workflows/deploy-netlify.yml). It builds `app/dist` once and publishes that same artifact to Netlify, Vercel, and AWS S3 so the three public frontends show the same commit and release metadata.

[`deploy-frontend-aws.yml`](../.github/workflows/deploy-frontend-aws.yml) remains available as an AWS-only manual or reusable fallback, but it no longer runs on every push. That prevents AWS from racing the shared Netlify/Vercel/AWS production deploy.

After production deploys, the workflow fetches the Netlify, Vercel, and AWS URLs and compares their `aura-release-*` meta tags. If any host serves a different release id, commit, channel, target, or build time, the workflow fails instead of silently allowing drift.

## Backend CORS

The backend no longer ships a hardcoded hosted-origin allowlist (`server/config/corsFlags.js`
resolves production origins exclusively from env), so every production storefront lane must be
present in the backend runtime config. `infra/aws/bootstrap-instance-user-data.sh` seeds
`/opt/aura/shared/base.env` with the full lane list under `CORS_ORIGIN`; keep it in sync when
adding a lane:

```text
CORS_ORIGIN=https://aurapilot.vercel.app,https://aurapilot.netlify.app,https://dbtrhsolhec1s.cloudfront.net,https://aura-storefront.onrender.com,https://aurapilot.aws.app,https://aura-storefront.pages.dev,https://mdsaifulislammsi.github.io,https://aura-storefront-production.up.railway.app,https://aura-mdsaifulislammsiss-projects.vercel.app
```

Existing instances do not re-run bootstrap: update `/opt/aura/shared/base.env` on the host and
restart the stack (or fold the update into the next `deploy-release.sh` run) **before** deploying
a backend built from this change, otherwise direct-call lanes lose CORS. If the resolved
allowlist would be empty, `assertProductionCorsConfig()` fails the boot instead of silently
breaking origins.

Additional per-lane variables (`AWS_FRONTEND_URL`, `RAILWAY_FRONTEND_URL`, `NETLIFY_FRONTEND_URL`,
`VERCEL_FRONTEND_URL`) are still collected by `corsFlags.js` and can extend the allowlist without
touching `CORS_ORIGIN`:

```text
AWS_FRONTEND_URL=http://aura-frontend-<account-id>-ap-south-1.s3-website.ap-south-1.amazonaws.com
```

If you manage backend config through Parameter Store, add that value to `server/.env.aws-secrets` and run:

```powershell
npm run aws:ssm:sync
```

## Cost Notes

S3 website hosting has no always-on compute cost. The main spend drivers are stored data, requests, and outbound transfer. The bootstrap script keeps versioning suspended and sets incomplete multipart upload cleanup. For HTTPS or a custom domain, add CloudFront and ACM later as a deliberate upgrade rather than the default.
