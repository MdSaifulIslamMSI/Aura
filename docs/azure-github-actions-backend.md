# Azure Backend CI/CD

This repo supports backend deployment from GitHub Actions to Azure Container Apps, but the real topology is a split runtime and not a magic one-box deploy.

## Pipeline

- Workflow: [deploy-backend-azure.yml](C:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/.github/workflows/deploy-backend-azure.yml)
- Rollback: [rollback-backend-azure.yml](C:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/.github/workflows/rollback-backend-azure.yml)
- Azure promotion logic: [promote-containerapps.sh](C:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/azure/promote-containerapps.sh)

Release flow:

1. Build an immutable backend image with `docker buildx`
2. Reconcile Azure Key Vault + Container Apps runtime config from the canonical env templates
3. Push the image and cache to Azure Container Registry
4. Create or update the API and worker runtime shells as needed
5. Promote the new API revision in Azure Container Apps
6. Wait for candidate revisions to become provisioned and healthy
7. Health-check the candidate revision FQDN directly
8. Re-check the production app FQDN after API and worker promotion
9. Roll back to the previous image automatically if any stage fails

Important: the workflow keeps the API app in single-revision mode, so this is fast rollback with health gates, not full pre-traffic blue/green.

## Azure bootstrap

Run:

```powershell
powershell -ExecutionPolicy Bypass -File infra\azure\bootstrap-github-oidc.ps1
```

This creates or refreshes:

- the GitHub Actions Azure app registration
- the service principal
- the GitHub OIDC federated credential for `main`
- `Reader` on the backend resource group
- `Container Apps Contributor` on the backend resource group
- `AcrPush` on the Azure Container Registry
- `Key Vault Secrets Officer` on the Azure Key Vault
- `Managed Identity Operator` on the backend user-assigned identity

It also writes `infra/azure/github-oidc.env` with the Azure OIDC IDs for reference.

The deploy, rollback, and runtime-sync workflows now run `infra/azure/validate-github-deploy-access.ps1` immediately after Azure login so missing RBAC fails fast with a specific fix instead of surfacing later as a generic `AuthorizationFailed` error.

The workflows now accept GitHub repository variables for the Azure IDs and app names:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_RESOURCE_GROUP`
- `ACR_NAME`
- `ACR_LOGIN_SERVER`
- `ACR_IMAGE_NAME`
- `API_APP_NAME`
- `WORKER_APP_NAME`
- `KEY_VAULT_NAME`
- `CONTAINER_ENV_NAME`
- `BACKEND_IDENTITY_NAME`

If those variables are missing, the committed defaults are still used as fallbacks.

The workflows do not depend on a GitHub Environment, so a push to `main` stays fully automatic.

## Local `.env` to Azure Key Vault

Local machine secret promotion is now handled by:

- [`sync-containerapps-runtime.ps1`](C:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/azure/sync-containerapps-runtime.ps1)
- [`verify-containerapps-runtime.ps1`](C:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/azure/verify-containerapps-runtime.ps1)
- [`publish-azure-runtime-env.ps1`](C:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/github/publish-azure-runtime-env.ps1)

Use it locally when you change `server/.env` or `server/.env.azure-secrets` and want Azure to mirror the new values:

```powershell
powershell -ExecutionPolicy Bypass -File infra\azure\sync-containerapps-runtime.ps1 -SourceEnvFile server\.env -SyncKeyVaultSecrets
```

That script will:

1. Read local env values
2. Push secret keys into Azure Key Vault
3. Reconcile API and worker Container Apps from the checked-in env templates
4. Preserve Key Vault-backed secret refs instead of writing raw secrets into Container Apps

You can also verify drift directly:

```powershell
cd server
npm run azure:runtime:verify
```

And push the local env into GitHub so future syncs stay automated:

```powershell
npm run azure:runtime:publish
```

For future env additions:

- If a new key belongs in an existing service template, add it to that template and the sync step will pick it up automatically.
- If you want to inject a new runtime key without editing templates first, use these env prefixes in the source env file:
  - `SHARED__FOO=bar`
  - `API__FOO=bar`
  - `WORKER__FOO=bar`
- New secret-like keys are auto-detected by name and pushed to Key Vault during sync, so you do not need to update a hardcoded secret map for every future addition.

For CI, the workflow supports an optional multiline secret named `AZURE_RUNTIME_ENV_FILE`. When present, GitHub Actions materializes it as a temp env file and runs the same sync step with `-SyncKeyVaultSecrets`.

## Dedicated runtime workflow

There is now a standalone workflow:

- [`sync-azure-runtime.yml`](C:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/.github/workflows/sync-azure-runtime.yml)

It supports:

- manual dispatch for on-demand env promotion
- scheduled drift correction
- post-sync drift verification against Azure Container Apps and Key Vault

## Frontend routing follow-up

The backend deploy does not rewrite Vercel config for you. If the public backend host changes, sync the two tracked rewrite files with:

```powershell
powershell -ExecutionPolicy Bypass -File infra\azure\sync-frontend-routing.ps1 -BackendUrl https://your-backend-host
```

That updates both `vercel.json` files without hand-editing them separately.

## Rollback

Trigger `Rollback Backend On Azure` and supply an immutable image tag that already exists in ACR.

Example tag shape:

- `20260318223015-25d9d900b641`

The rollback workflow promotes that image through the same health-gated release path instead of mutating production in place.
