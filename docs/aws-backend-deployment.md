# AWS Backend Deployment

## Architecture
- `app/` stays on Vercel and proxies `/api`, `/health`, and `/uploads` to `AURA_BACKEND_ORIGIN`.
- `server/` runs on one low-cost EC2 host as two containers from the same image:
  - API: `node scripts/start_api_runtime.js`
  - Worker: `node scripts/start_worker_runtime.js`
- Redis runs as a sidecar container on the same EC2 host.
- Secrets live in AWS Systems Manager Parameter Store using the `AWS_PARAMETER_STORE_PATH_PREFIX` path.
- Review uploads live in S3 via `UPLOAD_STORAGE_DRIVER=s3`.
- GitHub Actions builds the image once, uploads the release bundle to S3, and deploys through SSM Run Command.

## Why This Shape
- It is cheaper than ECS, App Runner, or managed Redis for a small production footprint.
- It keeps the split API/worker runtime the app already expects.
- It avoids SSH and keeps deploy access on short-lived GitHub OIDC credentials.

## Bootstrap
1. Provision the free-tier stack:
   - `powershell -ExecutionPolicy Bypass -File infra\aws\bootstrap-free-tier.ps1`
2. Create the GitHub deploy role:
   - `powershell -ExecutionPolicy Bypass -File infra\aws\bootstrap-github-oidc.ps1`
3. Edit `/opt/aura/shared/base.env` on the EC2 instance and set:
   - `CORS_ORIGIN`
   - `APP_PUBLIC_URL`
   - `AWS_S3_REVIEW_BUCKET`
   - `AWS_PARAMETER_STORE_PATH_PREFIX`
4. Publish secrets into Parameter Store:
   - `cd server`
   - `npm run aws:ssm:sync`

## GitHub Variables
- `AWS_REGION`
- `AWS_DEPLOY_BUCKET`
- `AWS_INSTANCE_TAG_KEY`
- `AWS_INSTANCE_TAG_VALUE`
- `AWS_PARAMETER_STORE_PATH_PREFIX`
- `AWS_BACKEND_BASE_URL`

## GitHub Secret
- `AWS_DEPLOY_ROLE_ARN`

## Frontend Routing
- Vercel now reads the backend origin from `AURA_BACKEND_ORIGIN` or `AWS_BACKEND_BASE_URL`.
- Set that value to your EC2 public URL or custom domain, for example `http://12.34.56.78:5000` or `https://api.example.com`.

## Runtime Secret Files
- Checked-in non-secret defaults live in [server/.env.example](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/.env.example).
- Checked-in secret placeholders live in [server/.env.aws-secrets.example](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/.env.aws-secrets.example).
- Local secrets should live in `server/.env.aws-secrets`, which is ignored by git.

## Deploy Workflow
- GitHub Actions workflow: [deploy-backend-aws.yml](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/.github/workflows/deploy-backend-aws.yml)
- EC2 compose file: [docker-compose.ec2.yml](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/aws/docker-compose.ec2.yml)
- EC2 rollout script: [deploy-release.sh](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/aws/deploy-release.sh)
- Parameter Store sync: [sync-parameter-store-env.ps1](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/aws/sync-parameter-store-env.ps1)
