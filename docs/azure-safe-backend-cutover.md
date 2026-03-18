# Azure Safe Backend Cutover

This runbook prepares the backend for a safe move from Render-style environment management to Azure-managed hosting and secrets without exposing raw secret values.

## Decision

Recommended target shape:

- API: Azure App Service Linux Premium
- Worker: separate always-on Azure App Service or Azure Container Apps app
- Cache: Azure Managed Redis
- Secret store: Azure Key Vault
- Media storage: Azure Blob Storage
- Edge: Azure Front Door + WAF
- Monitoring: Azure Monitor + Application Insights
- Database: keep MongoDB Atlas, preferably in Azure regions

Why keep MongoDB Atlas now:

- The catalog layer uses MongoDB Atlas Search via `$search` in [catalogService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/services/catalogService.js:684) and [catalogService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/services/catalogService.js:1352).
- Replacing Atlas with a different Mongo-compatible backend is not a safe drop-in change for this repo.

## Repo Facts Driving The Azure Plan

- The backend already expects split runtime in [index.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/index.js:100).
- The worker is a separate continuous process in [workerProcess.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/workerProcess.js:4).
- Redis becomes production-relevant when split runtime or distributed controls are enabled in [redis.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/config/redis.js:43).
- Socket.IO is active in [socketService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/services/socketService.js:1).
- Review media is still local-disk only in [reviewMediaStorageService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/services/reviewMediaStorageService.js:24).

## Safe Procedure

1. Inventory keys from code and deployment configs.
2. Separate keys into:
   - secret
   - non-secret runtime config
   - public frontend config
   - dev/test/ops-only keys
3. Provision Azure resources first.
4. Recreate or rotate secrets into Azure Key Vault.
5. Bind App Service settings to Key Vault references.
6. Deploy API and worker with production-safe non-secret settings.
7. Validate health, payments, auth, websockets, and worker queues in staging.
8. Cut traffic over.
9. Remove or rotate old Render-side secrets after verification.

## What Not To Do

- Do not paste Render secret values into chat, docs, or code.
- Do not copy `server/.env` or `app/.env` into source control.
- Do not rotate `AUTH_VAULT_SECRET` blindly without preserving previous secrets.
- Do not scale Socket.IO horizontally until a shared adapter/backplane is added.
- Do not keep local-disk review uploads in a multi-instance Azure deployment.

## Azure Resource Plan

Suggested resource grouping:

- Resource group: `rg-aura-prod`
- API app: `app-aura-api`
- Worker app: `app-aura-worker`
- App Service plan: `asp-aura-prod`
- Key Vault: `kv-aura-prod`
- Blob Storage: `stauraprodmedia`
- Managed Redis: `redis-aura-prod`
- App Insights: `appi-aura-prod`
- Front Door: `fd-aura-prod`

## Secret Handling Rules

### Regenerate In Azure

These should be created fresh in Key Vault:

- `CRON_SECRET`
- `METRICS_SECRET`
- `UPLOAD_SIGNING_SECRET`
- `OTP_FLOW_SECRET`
- `OTP_CHALLENGE_SECRET`

### Rotate Carefully

These affect running auth or encrypted payload flows:

- `AUTH_VAULT_SECRET`
- `AUTH_VAULT_SECRET_VERSION`
- `AUTH_VAULT_PREVIOUS_SECRETS`

Safe rule:

- keep the current value initially
- deploy Azure successfully
- then rotate by moving the old value into `AUTH_VAULT_PREVIOUS_SECRETS`
- advance `AUTH_VAULT_SECRET_VERSION`

### Usually Preserve Until Cutover

These often map to external providers and should be copied into Key Vault from their authoritative source, not from chat:

- `MONGO_URI`
- `REDIS_URL`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `FIREBASE_SERVICE_ACCOUNT` or `FIREBASE_PRIVATE_KEY` + `FIREBASE_CLIENT_EMAIL`
- `GROQ_API_KEY`
- `VOYAGE_API_KEY`
- `ELEVENLABS_API_KEY`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `RESEND_API_KEY`
- `GMAIL_APP_PASSWORD`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`

## Runtime Groups

### API App Settings

Use [server-api.appsettings.example.env](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/azure/server-api.appsettings.example.env).

### Worker App Settings

Use [server-worker.appsettings.example.env](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/azure/server-worker.appsettings.example.env).

### Frontend Public Settings

Use [client-public.example.env](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/azure/client-public.example.env).

### Secret Name Mapping

Use [keyvault-secret-map.example.json](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/azure/keyvault-secret-map.example.json).

### Local Secret Import File

Create a local file at [server/.env.azure-secrets.example](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/.env.azure-secrets.example):

1. Copy it to `server/.env.azure-secrets`
2. Fill the values locally from your own provider dashboards
3. Keep it uncommitted

The Azure deploy script automatically uses `server/.env.azure-secrets` when it exists, so you can run the deployment without echoing raw secrets into commands.

## Production-Critical Gaps To Close

### 1. Review Upload Storage

Current state:

- the service now supports `azure-blob` as well as local storage in [reviewMediaStorageService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/services/reviewMediaStorageService.js)

Production rule:

- use `UPLOAD_STORAGE_DRIVER=azure-blob`
- set `AZURE_STORAGE_CONNECTION_STRING` via Key Vault reference
- set `AZURE_STORAGE_CONTAINER_NAME`
- keep `UPLOAD_STORAGE_DRIVER=local` only for local development

### 2. Socket.IO Scale-Out

Current state:

- Socket.IO is initialized, but this repo does not currently show a cross-instance adapter in [socketService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/services/socketService.js:1)

Safe deployment rule:

- start with one API instance
- or add a Redis-backed Socket.IO adapter before horizontal scaling

### 3. Catalog Search

Current state:

- MongoDB Atlas Search is part of the live query path in [catalogService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/services/catalogService.js:684)

Safe deployment rule:

- keep Atlas
- deploy Atlas in Azure region alignment with the app

## Staging Validation Checklist

- `/health` and `/health/ready` return healthy
- Firebase auth works
- OTP challenge works
- catalog search returns published inventory
- checkout intent creation works
- webhook verification works
- worker queue starts and drains
- Redis health is connected
- admin pages load
- user notifications and Socket.IO connect
- review upload path works or is intentionally disabled until Blob support lands

## Cutover Sequence

1. Provision Azure resources.
2. Create Key Vault secrets from authoritative providers.
3. Configure API app settings and worker app settings.
4. Deploy API to staging slot.
5. Deploy worker to staging environment.
6. Run smoke tests.
7. Switch frontend `VITE_API_URL` to the Azure API.
8. Observe metrics and logs.
9. Rotate old Render secrets after stable verification.

## Local Deployment Command

After `server/.env.azure-secrets` is filled locally, run:

```powershell
powershell -ExecutionPolicy Bypass -File infra\azure\deploy-backend.ps1
```

To run only the readiness gate first:

```powershell
powershell -ExecutionPolicy Bypass -File infra\azure\deploy-backend.ps1 -ValidateOnly
```

## Keys That Are Usually Not Part Of Azure Production Runtime

Do not treat these as production app settings by default:

- `CI`
- `DEV`
- `MODE`
- `TEST_*`
- `SMOKE_*`
- `LOAD_*`
- `KAGGLE_*`
- `DEMO_CATALOG_*`
- benchmark/report script variables

Those are dev, CI, smoke, migration, or catalog-import helpers, not normal production runtime requirements.
