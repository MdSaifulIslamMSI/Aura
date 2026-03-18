# Azure Backend CI/CD

This repo now supports zero-touch backend deployment from GitHub Actions to Azure Container Apps.

## Pipeline

- Workflow: [deploy-backend-azure.yml](C:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/.github/workflows/deploy-backend-azure.yml)
- Rollback: [rollback-backend-azure.yml](C:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/.github/workflows/rollback-backend-azure.yml)
- Azure promotion logic: [promote-containerapps.sh](C:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/azure/promote-containerapps.sh)

Release flow:

1. Build immutable backend image with `docker buildx`
2. Push image plus registry cache to Azure Container Registry
3. Create a new API revision in Azure Container Apps
4. Health-check the candidate revision directly
5. Shift production traffic only after the candidate passes
6. Update the worker to the same image
7. Roll back automatically if deploy or health verification fails

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

The current workflows already inline those non-secret IDs, so no GitHub secret is required for Azure login. The repo only needs the committed workflow files and the Azure federated credential created by the bootstrap script.

The workflows do not depend on a GitHub Environment, so a push to `main` stays fully automatic.

## Rollback

Trigger `Rollback Backend On Azure` and supply an immutable image tag that already exists in ACR.

Example tag shape:

- `20260318223015-25d9d900b641`

The rollback workflow promotes that image through the same health-gated release path instead of mutating production in place.
