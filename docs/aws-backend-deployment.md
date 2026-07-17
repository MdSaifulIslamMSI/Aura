# AWS Backend Deployment

## Production Architecture

- The backend runs on one EC2 host as API and worker containers built from the same immutable image.
  - API: `node scripts/start_api_runtime.js`
  - Worker: `node scripts/start_worker_runtime.js`
- Redis runs on the same private Compose network.
- Caddy terminates public TLS and proxies to the API. Port `5000` is bound only to `127.0.0.1` for host health checks.
- Runtime secrets are rendered from AWS Systems Manager Parameter Store into `/opt/aura/shared/runtime-secrets.env`; they are never packaged in an image or release artifact.
- Review uploads use S3 when `UPLOAD_STORAGE_DRIVER=s3`.
- GitHub Actions uses short-lived AWS OIDC credentials and deploys through SSM Run Command. SSH is not part of the release path.

## No-LLM Commerce Assistant Contract

AWS production intentionally runs the commerce assistant without an LLM. The API and worker receive these enforced values from [docker-compose.ec2.yml](../infra/aws/docker-compose.ec2.yml):

```text
AI_MODEL_PROVIDER=disabled
AI_MODEL_PROVIDER_FALLBACKS=
ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA=false
ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED=false
```

`AI_PUBLIC_CHAT_ACCESS_ENABLED` also defaults to `false`, so anonymous callers cannot invoke the authenticated assistant route.

The assistant remains useful through deterministic intent routing, live catalog lookup, lexical retrieval, checked application knowledge, recommendation data, structured filters, citations, and app-grounded actions. A production response must have an empty `providerModel`; a non-empty model name is a deployment failure.

The Compose file retains an `ollama` profile only for non-production compatibility. Production bootstrap and release scripts:

- do not enable the profile;
- remove `ollama` from inherited profile lists;
- reject unknown production profiles;
- stop and remove any legacy Ollama container during activation; and
- never select hosted-provider fallbacks.

`OLLAMA_*` compatibility variables may still appear in the Compose schema, but they do not activate a model provider. Do not set `COMPOSE_PROFILES=ollama` or `AI_MODEL_PROVIDER=ollama` in production.

## Bootstrap

1. Provision or refresh the EC2 stack:

   ```powershell
   powershell -ExecutionPolicy Bypass -File infra\aws\bootstrap-free-tier.ps1 `
     -InstanceType t4g.xlarge `
     -RootVolumeSizeGiB 32 `
     -FrontendOrigin https://aurapilot.vercel.app `
     -SecondaryFrontendOrigin https://aurapilot.netlify.app
   ```

2. Install cost and expiration guardrails:

   ```powershell
   powershell -ExecutionPolicy Bypass -File infra\aws\bootstrap-cost-guardrails.ps1 `
     -AwsProfile aura-bootstrap `
     -MonthlyBudgetUsd 90
   ```

3. Install security visibility controls:

   ```powershell
   powershell -ExecutionPolicy Bypass -File infra\aws\bootstrap-security-posture.ps1 `
     -AwsProfile aura-bootstrap
   ```

4. Create or refresh the GitHub OIDC role after deployment-policy changes:

   ```powershell
   powershell -ExecutionPolicy Bypass -File infra\aws\bootstrap-github-oidc.ps1 `
     -Repository MdSaifulIslamMSI/Aura `
     -AwsProfile aura-bootstrap
   ```

5. Publish local runtime secrets to Parameter Store. Never commit or print the source file:

   ```powershell
   powershell -ExecutionPolicy Bypass -File infra\aws\sync-parameter-store-env.ps1 `
     -SourceEnvFile .\server\.env.aws-secrets `
     -PathPrefix /aura/prod `
     -AwsRegion ap-south-1 `
     -AwsProfile aura-bootstrap
   ```

Amazon Linux 2023 installs Docker from `dnf`; bootstrap installs the Compose plugin for the detected host architecture. Size EC2 for API, worker, Redis, malware scanning, and traffic needs—not for an Ollama sidecar.

## Required GitHub Configuration

Repository variables:

- `AWS_REGION`
- `AWS_DEPLOY_BUCKET`
- `AWS_INSTANCE_TAG_KEY`
- `AWS_INSTANCE_TAG_VALUE`
- `AWS_PARAMETER_STORE_PATH_PREFIX`
- `AURA_BACKEND_ORIGIN`
- `AWS_BACKEND_BASE_URL`
- `AWS_DOCKER_PLATFORM`
- `AWS_DEPLOY_ROLE_ARN`

`AWS_DEPLOY_ROLE_ARN` may instead be supplied as a repository secret. Account, bucket, instance, and role identifiers have no checked-in production defaults; preflight fails closed when required configuration is missing.

For Graviton hosts, set `AWS_DOCKER_PLATFORM=linux/arm64`. `AURA_BACKEND_PUBLIC_HOST` must resolve to the Caddy origin hostname. Hosted frontends proxy `/api`, `/health`, and `/uploads` to the durable HTTPS backend origin.

## Immutable Release and Rollback Flow

[deploy-backend-aws.yml](../.github/workflows/deploy-backend-aws.yml) and [deploy-release.sh](../infra/aws/deploy-release.sh) enforce this sequence:

1. Resolve and check out one full lowercase commit SHA.
2. Build the backend image once and package image and infrastructure artifacts.
3. Compute SHA-256 digests for both artifacts.
4. Capture the currently active full SHA before uploading or mutating anything.
5. Reject a same-SHA redeploy so immutable rollback artifacts cannot be overwritten.
6. Upload artifacts under the immutable release SHA and verify their digests on the host.
7. Acquire the shared non-blocking backend release lock and refuse activation if any recovery journal exists.
8. Stage code, `release.env`, `base.env`, and decrypted `runtime-secrets.env`; validate trust, no-LLM, Compose, and health contracts against the staged state.
9. Back up all four active state components, atomically activate all four, recreate API and worker, and verify local readiness plus the TLS edge.
10. Restore the complete previous state automatically if any post-activation check fails.

The deploy workflow refreshes OIDC credentials after the image build and again before any failure restoration. SSM polling retries only the documented `InvocationDoesNotExist` eventual-consistency response and fails closed on other AWS errors.

[rollback-backend.sh](../infra/aws/rollback-backend.sh) requires an explicit known-good 40-character SHA. It always uses current rollback tooling; it never executes historical repository code or infers a target from directory modification time.

## Runtime Security Contracts

- `HEALTH_READY_TOKEN` is required in production Parameter Store. Public probes use `GET /health`; protected readiness uses `GET /health/ready` with `x-health-token` inside the trusted runtime.
- `AUTH_DEVICE_CHALLENGE_MODE=always` is enforced for API and worker startup. Do not set it to `off`.
- `ADMIN_REQUIRE_PASSKEY=true` remains enforced in the EC2 runtime.
- CloudFront origin verification uses `X-Aura-Origin-Verify` and the matching Parameter Store secret. Never put that value in a frontend bundle.
- Hosted model keys may exist for other environments or features, but the AWS production assistant cannot select them while the no-LLM contract above is enforced.
- Do not edit `/opt/aura/shared/base.env` to change model behavior. Make tracked contract changes, pass CI, and use the release workflow.

### Origin protection and secret hygiene

- When the backend origin uses a free TLS hostname such as `sslip.io`, configure CloudFront with `X-Aura-Origin-Verify` and store the matching value as `/aura/prod/AURA_CLOUDFRONT_ORIGIN_VERIFY_SECRET`.
- Store `AUTH_RISK_SIGNAL_SECRET` separately before enabling risk-engine enforcement. Edge or server-side producers must sign login-risk headers with `X-Aura-Login-Risk-Signature` and `X-Aura-Login-Risk-Timestamp`; unsigned client copies are ignored and stripped.
- Origin protection keeps health routes and signed provider webhooks reachable. Verify both allowed and denied paths with `npm run security:origin-protection-smoke` before promotion.
- Rotate origin verification by updating CloudFront first, waiting until the distribution is deployed, updating Parameter Store, and then releasing the backend.
- Never put origin, risk-signal, health, or runtime secrets in the frontend bundle or workflow logs.
- Checked-in defaults and placeholders live in [server/.env.example](../server/.env.example) and [server/.env.aws-secrets.example](../server/.env.aws-secrets.example). The real `server/.env.aws-secrets` remains ignored and local.

## Verification

Before release:

```powershell
npm run ci:doctor
npm run quality:actions
npm run security:prod-env-audit
npm run security:prod-hardening-audit
npm run scan:prod-fallbacks
npm --prefix server run aws:ssm:audit
```

After release, a sanitized SSM check must prove all of the following without printing secret values:

- active release SHA equals the deployed merge SHA;
- API and worker are running;
- API and worker use `AI_MODEL_PROVIDER=disabled` with empty fallbacks;
- hosted-model requirement and model summaries are disabled;
- anonymous `/api/ai/chat` returns `401`;
- internal live and token-protected ready probes return `200`;
- no Ollama container or activation recovery journal exists; and
- a live commerce query returns an app-grounded answer, catalog products, and an empty `providerModel`.

The production command center must first pass a targetless no-op run. A real deployment should name `backend` explicitly, keep health checks enabled, enable automatic rollback, and retain the captured previous SHA until post-deploy verification succeeds.
