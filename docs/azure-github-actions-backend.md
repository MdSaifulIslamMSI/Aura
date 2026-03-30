# Azure Backend CI/CD

This repo supports backend deployment from GitHub Actions to Azure Container Apps, but the real topology is a split runtime and not a magic one-box deploy.

## Pipeline

- Workflow: [deploy-backend-azure.yml](C:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/.github/workflows/deploy-backend-azure.yml)
- Rollback: [rollback-backend-azure.yml](C:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/.github/workflows/rollback-backend-azure.yml)
- Azure promotion logic: [promote-containerapps.sh](C:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/azure/promote-containerapps.sh)

Release flow:

1. Build an immutable backend image with `docker buildx`
2. Push the image and cache to Azure Container Registry
3. Create a new API revision in Azure Container Apps
4. Wait for that revision to become provisioned and healthy
5. Health-check the candidate revision FQDN directly
6. Re-check the production app FQDN after API and worker promotion
7. Roll back to the previous image automatically if any stage fails

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
- `Container Apps Contributor` on the backend resource group
- `AcrPush` on the Azure Container Registry

It also writes `infra/azure/github-oidc.env` with the Azure OIDC IDs for reference.

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

If those variables are missing, the committed defaults are still used as fallbacks.

The workflows do not depend on a GitHub Environment, so a push to `main` stays fully automatic.

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
