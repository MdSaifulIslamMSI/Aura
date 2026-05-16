# AWS Backend Deployment

## Architecture
- `app/` stays on Vercel and proxies `/api`, `/health`, and `/uploads` to `AURA_BACKEND_ORIGIN`.
- `server/` runs on one low-cost EC2 host as two containers from the same image:
  - API: `node scripts/start_api_runtime.js`
  - Worker: `node scripts/start_worker_runtime.js`
- Redis runs as a sidecar container on the same EC2 host.
- Ollama runs as an internal sidecar container when `COMPOSE_PROFILES=ollama` and `AI_MODEL_PROVIDER=ollama` are set in the EC2 `base.env`. API and worker containers reach it at `http://ollama:11434`.
- The deployed no-key assistant uses local Ollama models for LLM and embeddings, with retrieval, live commerce tools, citations, and deterministic grounded fallback when the model is unavailable.
- Caddy runs as the public HTTPS edge on ports `80` and `443`, terminates TLS for `AURA_BACKEND_PUBLIC_HOST`, and proxies to the API container on the private Docker network.
- The API container binds port `5000` only to `127.0.0.1` for local health probes; public traffic should use the HTTPS edge.
- Secrets live in AWS Systems Manager Parameter Store using the `AWS_PARAMETER_STORE_PATH_PREFIX` path.
- Review uploads live in S3 via `UPLOAD_STORAGE_DRIVER=s3`.
- GitHub Actions builds the image once, uploads the release bundle to S3, and deploys through SSM Run Command.
- GitHub Actions CI is path-aware and now skips docs-only churn while still validating backend, frontend, and deploy changes.
- The historical free-plan target was `t4g.small` with an arm64 image build, 16 GiB `gp3` root volume, and automatic cost guardrails.
- The Ollama sidecar needs more memory than that free-plan target. On a blocked/free-plan `t4g.small`, use `llama3.2:1b` with a smaller context window. For live LLM traffic with `llama3.2:3b` plus `all-minilm`, use at least `t4g.large`; `t4g.xlarge` is the budget-friendly production choice for more CPU and 16 GiB RAM. GPU instances are faster but much more expensive.
- Amazon Linux 2023 installs Docker from `dnf`, while the Compose plugin is installed from Docker's official `latest` release URL for the detected host architecture.

## Why This Shape
- It is cheaper than ECS, App Runner, or managed Redis for a small production footprint.
- It keeps the split API/worker runtime the app already expects.
- It avoids SSH and keeps deploy access on short-lived GitHub OIDC credentials.

## Bootstrap
1. Provision the EC2 backend stack:
   - `powershell -ExecutionPolicy Bypass -File infra\aws\bootstrap-free-tier.ps1 -InstanceType t4g.xlarge -RootVolumeSizeGiB 32 -FrontendOrigin https://aurapilot.vercel.app -SecondaryFrontendOrigin https://aurapilot.netlify.app`
2. Install monthly budget and free-plan expiration guardrails:
   - `powershell -ExecutionPolicy Bypass -File infra\aws\bootstrap-cost-guardrails.ps1 -AwsProfile aura-bootstrap -MonthlyBudgetUsd 90`
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
- `AURA_BACKEND_ORIGIN`
- `AWS_BACKEND_BASE_URL`
- `AWS_DOCKER_PLATFORM`
- `AWS_DEPLOY_ROLE_ARN`

The deploy workflow intentionally has no checked-in account, bucket, instance, or role defaults. Production deploys fail closed until these values are configured as GitHub variables or secrets.

## GitHub Secret
- `AWS_DEPLOY_ROLE_ARN`

## Frontend Routing
- Vercel now reads the backend origin from `AURA_BACKEND_ORIGIN` or `AWS_BACKEND_BASE_URL`.
- Set that value to a durable HTTPS edge URL or custom domain, for example `https://api.example.com`.
- If those variables are blank on a hosted deployment, CI fails closed instead of publishing a frontend pinned to a temporary host.
- For the Graviton `t4g.*` target, set `AWS_DOCKER_PLATFORM=linux/arm64`.
- The EC2 `base.env` file must include `AURA_BACKEND_PUBLIC_HOST` for Caddy. Replace the placeholder with a durable API hostname before production traffic.
- The bootstrap defaults already disable paid integrations that would otherwise fail closed on a bare free-plan stack: payments, OTP SMS, and order email sending.
- The checked-in AWS bootstrap now seeds `CORS_ORIGIN` with both production frontends, `https://aurapilot.vercel.app` and `https://aurapilot.netlify.app`, so hosted auth POST flows do not fail when the second domain is added later.
- The AWS Ollama runtime uses:
  - `COMPOSE_PROFILES=ollama`
  - `AI_MODEL_PROVIDER=ollama`
  - `ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA=false`
  - `ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED=false` on constrained CPU hosts so product/search answers use deterministic catalog/RAG summaries instead of a slow final LLM JSON pass
  - `OLLAMA_BASE_URL=http://ollama:11434`
  - `OLLAMA_CHAT_MODEL=llama3.2:1b` on `t4g.small`; `llama3.2:3b` on `t4g.large` or larger
  - `OLLAMA_EMBED_MODEL=all-minilm`
  - `OLLAMA_TIMEOUT_MS=180000` on constrained CPU hosts
  - `OLLAMA_CONTEXT_LENGTH=1024`
  - `OLLAMA_NUM_PARALLEL=1`
  - `OLLAMA_MAX_LOADED_MODELS=2`
- Existing EC2 instances keep their current `/opt/aura/shared/base.env`; update that file manually or reprovision before relying on the no-key assistant in AWS.

## No-Domain Origin Protection
- If no owned domain is available, the current zero-cost fallback is to keep the free TLS hostname such as `13.206.172.186.sslip.io` as the CloudFront backend origin.
- To reduce direct-origin exposure, configure a CloudFront custom origin header named `X-Aura-Origin-Verify` and store the same secret in Parameter Store as `/aura/prod/AURA_CLOUDFRONT_ORIGIN_VERIFY_SECRET`.
- Before promoting `AUTH_RISK_ENGINE_MODE=enforce`, store a separate `/aura/prod/AUTH_RISK_SIGNAL_SECRET`. Edge or server-side risk signal injectors must sign `X-Aura-Login-Failure-Count`, `X-Aura-IP-Reputation`, and `X-Aura-Impossible-Travel` with `X-Aura-Login-Risk-Signature` plus `X-Aura-Login-Risk-Timestamp`; unsigned copies are ignored and stripped by the API. The backend middleware can also produce signed IP reputation for exact-match `AUTH_RISK_IP_DENYLIST` / `AUTH_RISK_IP_WATCHLIST` entries.
- When that secret is present, the API rejects direct non-health, non-webhook requests that do not include the CloudFront origin header. Health routes remain reachable for liveness checks, and signed provider webhook routes remain reachable so payment/email providers do not lose events.
- Do not put this secret in the frontend bundle. Rotate it by updating CloudFront first, waiting for `Deployed`, updating Parameter Store, and then redeploying the backend.
- Verify this guard with `npm run security:origin-protection-smoke` after setting `AURA_EDGE_ORIGIN` to the CloudFront URL and `AURA_DIRECT_BACKEND_ORIGIN` to the backend TLS origin.

## Runtime Secret Files
- Checked-in non-secret defaults live in [server/.env.example](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/.env.example).
- Checked-in secret placeholders live in [server/.env.aws-secrets.example](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/.env.aws-secrets.example).
- Local secrets should live in `server/.env.aws-secrets`, which is ignored by git.
- `HEALTH_READY_TOKEN` is required in production Parameter Store. Public deploy smoke checks use `GET /health`; the EC2 rollout script uses `GET /health/ready` with `x-health-token` from runtime secrets.
- Hosted model API keys such as `GEMINI_API_KEY`, `GROQ_API_KEY`, and `VOYAGE_API_KEY` are optional when the AWS runtime uses Ollama. Leave their placeholders in `.env.aws-secrets.example`; the SSM sync skips placeholder values.

## Trusted Device Gate
- The tracked AWS runtime keeps `AUTH_DEVICE_CHALLENGE_MODE=admin` in [server/.env.example](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/.env.example) and [docker-compose.ec2.yml](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/aws/docker-compose.ec2.yml).
- Do not set that mode to `off` for production.
- The AWS contract audit in CI now checks the non-secret env example, the AWS secrets example, and the EC2 compose file together so trusted-device enforcement cannot drift silently.
- The EC2 rollout script in [deploy-release.sh](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/aws/deploy-release.sh) now refuses to start a release if the resolved runtime mode is `off`, blank, invalid, or enabled without `AUTH_DEVICE_CHALLENGE_SECRET` or an allowed `AUTH_VAULT_SECRET` fallback.

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
- Production deploys now trigger only for backend runtime changes, not for every AWS bootstrap script edit.
- Production deploys are serialized with workflow concurrency, and manual dispatch can target a specific git ref when rollback or re-release is needed.
- The AWS deploy workflow now ships with live repo defaults for the current production stack and validates real AWS access during preflight, so missing GitHub repo variables no longer hard-fail the pipeline.
