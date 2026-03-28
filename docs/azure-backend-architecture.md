# Azure Backend Architecture

## What actually runs

- Vercel serves the static frontend.
- `vercel.json` and `app/vercel.json` proxy `/api`, `/health`, and `/uploads` to the Azure backend host.
- Azure Container Registry stores one backend image.
- Azure Container Apps runs that same image twice:
  - API app: `node index.js`
  - Worker app: `node workerProcess.js`
- MongoDB is the system of record.
- Redis is mandatory for split-runtime coordination, distributed rate limiting, and queue/backplane behavior.
- Azure Key Vault stores runtime secrets, and a user-assigned managed identity lets both Container Apps read them.
- Azure Blob Storage stores review media uploads.

## Deployment path

- GitHub Actions builds and pushes a new image to ACR.
- The release script updates the API Container App revision first.
- The script waits for the new revision to be provisioned, then probes that revision's direct FQDN.
- After the candidate looks healthy, the script re-checks the production app FQDN and then updates the worker app to the same image.
- If a deploy stage fails, the script rolls both apps back to the previous image reference.

## Brutal truth

- This is split runtime, but not true blue/green. The API app is kept in single-revision mode, so safety comes from health checks plus rollback speed.
- Frontend routing is still a tracked config concern. If the backend public host changes, the Vercel rewrites must be synced.
- The old scripts and docs drifted: some still implied one process with in-process workers, which is no longer true.
- The previous Container Apps bootstrap script depended on one author's local secret file path and default frontend domain, which made the "portable" story weaker than advertised.

## What was fixed here

- Container Apps bootstrap now defaults to the repo-local `server/.env.azure-secrets` file when present instead of a machine-specific path.
- Frontend origin and API public URL can now be resolved from deploy input/env instead of silently defaulting to one hardcoded domain.
- Promotion now probes the candidate revision FQDN directly before relying on production health.
- GitHub Actions accepts repository-variable overrides for Azure IDs and app names instead of forcing code edits for every environment.
- A dedicated routing sync script now updates both tracked Vercel rewrite files from one backend URL.
