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
- GitHub Actions CI is path-aware and now skips docs-only churn while still validating backend, frontend, and deploy changes.
- The default free-plan target is `t4g.small` with an arm64 image build, 16 GiB `gp3` root volume, and automatic cost guardrails.
- Amazon Linux 2023 installs Docker from `dnf`, while the Compose plugin is installed from Docker's official `latest` release URL for the detected host architecture.

## Why This Shape
- It is cheaper than ECS, App Runner, or managed Redis for a small production footprint.
- It keeps the split API/worker runtime the app already expects.
- It avoids SSH and keeps deploy access on short-lived GitHub OIDC credentials.

## Bootstrap
1. Provision the free-tier stack:
   - `powershell -ExecutionPolicy Bypass -File infra\aws\bootstrap-free-tier.ps1 -FrontendOrigin https://aurapilot.vercel.app`
2. Install monthly budget and free-plan expiration guardrails:
   - `powershell -ExecutionPolicy Bypass -File infra\aws\bootstrap-cost-guardrails.ps1 -AwsProfile aura-bootstrap`
3. Create or refresh the GitHub deploy role:
   - `powershell -ExecutionPolicy Bypass -File infra\aws\bootstrap-github-oidc.ps1 -Repository MdSaifulIslamMSI/Aura -AwsProfile aura-bootstrap`
4. Publish secrets into Parameter Store:
   - `powershell -ExecutionPolicy Bypass -File infra\aws\sync-parameter-store-env.ps1 -SourceEnvFile .\server\.env.aws-secrets -PathPrefix /aura/prod -AwsRegion ap-south-1 -AwsProfile aura-bootstrap`

## GitHub Variables
- `AWS_REGION`
- `AWS_DEPLOY_BUCKET`
- `AWS_INSTANCE_TAG_KEY`
- `AWS_INSTANCE_TAG_VALUE`
- `AWS_PARAMETER_STORE_PATH_PREFIX`
- `AWS_BACKEND_BASE_URL`
- `AWS_DOCKER_PLATFORM`
 - `AWS_DEPLOY_ROLE_ARN`

## GitHub Secret
- `AWS_DEPLOY_ROLE_ARN`

## Frontend Routing
- Vercel now reads the backend origin from `AURA_BACKEND_ORIGIN` or `AWS_BACKEND_BASE_URL`.
- Set that value to your EC2 public URL or custom domain, for example `http://12.34.56.78:5000` or `https://api.example.com`.
- If those variables are blank on a hosted Vercel deployment, the checked-in config now falls back to the live AWS backend origin instead of `127.0.0.1`.
- For the default `t4g.small` target, set `AWS_DOCKER_PLATFORM=linux/arm64`.
- The bootstrap defaults already disable paid integrations that would otherwise fail closed on a bare free-plan stack: payments, OTP SMS, and order email sending.

## Runtime Secret Files
- Checked-in non-secret defaults live in [server/.env.example](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/.env.example).
- Checked-in secret placeholders live in [server/.env.aws-secrets.example](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/.env.aws-secrets.example).
- Local secrets should live in `server/.env.aws-secrets`, which is ignored by git.

## Deploy Workflow
- Validation workflow: [ci.yml](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/.github/workflows/ci.yml)
- Production backend deploy workflow: [deploy-backend-aws.yml](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/.github/workflows/deploy-backend-aws.yml)
- EC2 compose file: [docker-compose.ec2.yml](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/aws/docker-compose.ec2.yml)
- EC2 rollout script: [deploy-release.sh](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/aws/deploy-release.sh)
- Parameter Store sync: [sync-parameter-store-env.ps1](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/aws/sync-parameter-store-env.ps1)

## CI/CD Shape
- GitHub Actions now keeps only two first-party workflows: `CI` for validation and `Deploy Backend To AWS` for production rollout.
- The old duplicated coverage pass has been removed. Backend regressions now run once per relevant change set.
- Frontend preview and production deploys continue to come from the Vercel GitHub integration, not an extra GitHub Actions deploy workflow.
- Backend, frontend, and deploy checks are gated by file-path detection so docs-only and unrelated edits do not burn CI minutes.
- Production deploys are serialized with workflow concurrency, and manual dispatch can target a specific git ref when rollback or re-release is needed.
- The AWS deploy workflow now ships with live repo defaults for the current production stack and validates real AWS access during preflight, so missing GitHub repo variables no longer hard-fail the pipeline.
