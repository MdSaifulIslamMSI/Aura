# Aura Google Cloud Backend + Vercel Frontend

This repo is now set up for:

- `app` on Vercel
- `server` on Google Cloud Run
- review-media uploads in Google Cloud Storage

For the lowest-cost setup, use `us-central1`.

## Target architecture

- `Cloud Run` for the backend container
- `Artifact Registry` for the backend image
- `Cloud Storage` for review-media uploads
- `Secret Manager` for backend secrets
- `Cloud Logging` for runtime logs
- `Vercel` for the frontend

## Backend runtime changes

The backend container still builds from:

- [server/Dockerfile](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/Dockerfile)

Persistent review-media storage now supports:

- local disk for development
- `gcs` for Cloud Run

That logic lives in:

- [reviewMediaStorageService.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/services/reviewMediaStorageService.js)
- [uploadAssetController.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/server/controllers/uploadAssetController.js)

When `UPLOAD_STORAGE_DRIVER=gcs`, the backend proxies files back through `/uploads/reviews/...`, so the bucket does not need to be public.

## GitHub workflow

Use:

- [deploy-backend-gcp.yml](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/.github/workflows/deploy-backend-gcp.yml)

Required GitHub secrets:

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_DEPLOY_SERVICE_ACCOUNT_EMAIL`
- `GCP_RUNTIME_SERVICE_ACCOUNT_EMAIL`
- `GCP_ARTIFACT_REGISTRY_REPOSITORY`
- `GCP_CLOUD_RUN_SERVICE`
- `FRONTEND_ORIGIN`
- `APP_PUBLIC_URL`
- `REVIEW_UPLOAD_GCS_BUCKET`
- `REVIEW_UPLOAD_GCS_PREFIX`
- `REVIEW_UPLOAD_PUBLIC_BASE_URL`
- `MONGO_URI_SECRET_NAME`
- `REDIS_URL_SECRET_NAME`
- `BYTEZ_API_KEY_SECRET_NAME`
- `UPLOAD_SIGNING_SECRET_SECRET_NAME`

## Required runtime env vars

Non-secret env values:

- `NODE_ENV=production`
- `CORS_ORIGIN=https://your-frontend-domain.vercel.app`
- `APP_PUBLIC_URL=https://your-frontend-domain.vercel.app`
- `REDIS_ENABLED=true`
- `REDIS_REQUIRED=true`
- `SPLIT_RUNTIME_ENABLED=true`
- `UPLOAD_STORAGE_DRIVER=gcs`
- `GCP_PROJECT_ID=<your-project-id>`
- `REVIEW_UPLOAD_GCS_BUCKET=<bucket-name>`
- `REVIEW_UPLOAD_GCS_PREFIX=reviews`

## Required Secret Manager secrets

- `MONGO_URI`
- `REDIS_URL`
- `BYTEZ_API_KEY`
- `UPLOAD_SIGNING_SECRET`

Add any additional mail, payment, Firebase admin, or SMS secrets you use in production.

## First-time GCP setup

Use:

- [bootstrap-backend.ps1](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/gcp/bootstrap-backend.ps1)

It enables the required APIs and creates:

- Artifact Registry repository
- Cloud Storage bucket
- runtime service account

## Frontend on Vercel

The frontend API client already supports a direct backend URL via:

- [apiBase.js](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/app/src/services/apiBase.js)

When your Cloud Run backend is live:

1. Set `VITE_API_URL=https://<cloud-run-url>/api` in Vercel.
2. Redeploy the frontend.

## Rollout order

1. Create or choose a GCP project.
2. Enable Cloud Run, Artifact Registry, Secret Manager, Cloud Build, and Cloud Storage APIs.
3. Create the runtime service account and grant it `Storage Object Admin` on the upload bucket and `Secret Manager Secret Accessor`.
4. Add the secrets in Secret Manager.
5. Configure the GitHub secrets listed above.
6. Run the GitHub workflow.
7. Point the Vercel frontend to the Cloud Run backend URL.
