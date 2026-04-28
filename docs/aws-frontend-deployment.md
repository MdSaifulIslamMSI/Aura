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

The workflow also has defaults for the current AWS account, but setting variables makes the deployment portable and explicit.

## Deploy Locally

The deploy script builds the same multi-host frontend bundle used by CI. Netlify and Vercel use their same-origin proxy rewrites for `/api`, `/health`, `/uploads`, and `/socket.io`; S3 website hosting cannot proxy those paths, so the same bundle resolves the configured hosted backend directly when it is running from the S3 website URL.

```powershell
npm run aws:frontend:deploy
```

Use `-BackendOrigin` to override the tracked hosted backend:

```powershell
npm run aws:frontend:deploy -- -BackendOrigin http://3.109.181.238:5000
```

## GitHub Actions

The canonical production storefront workflow is [`deploy-netlify.yml`](../.github/workflows/deploy-netlify.yml). It builds `app/dist` once and publishes that same artifact to Netlify, Vercel, and AWS S3 so the three public frontends show the same commit and release metadata.

[`deploy-frontend-aws.yml`](../.github/workflows/deploy-frontend-aws.yml) remains available as an AWS-only manual or reusable fallback, but it no longer runs on every push. That prevents AWS from racing the shared Netlify/Vercel/AWS production deploy.

After production deploys, the workflow fetches the Netlify, Vercel, and AWS URLs and compares their `aura-release-*` meta tags. If any host serves a different release id, commit, channel, target, or build time, the workflow fails instead of silently allowing drift.

## Backend CORS

Add the S3 website URL to backend runtime config so browser calls from the AWS frontend are allowed:

```text
AWS_FRONTEND_URL=http://aura-frontend-<account-id>-ap-south-1.s3-website.ap-south-1.amazonaws.com
```

If you manage backend config through Parameter Store, add that value to `server/.env.aws-secrets` and run:

```powershell
npm run aws:ssm:sync
```

## Cost Notes

S3 website hosting has no always-on compute cost. The main spend drivers are stored data, requests, and outbound transfer. The bootstrap script keeps versioning suspended and sets incomplete multipart upload cleanup. For HTTPS or a custom domain, add CloudFront and ACM later as a deliberate upgrade rather than the default.
