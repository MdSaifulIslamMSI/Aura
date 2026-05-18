# Production CI/CD Secrets and Variables

This production pipeline is planner-driven. Missing cloud configuration does not attempt a fake deploy; the orchestrator records a clear no-op with the missing secret or variable names.

## Required Secrets for Production Deploys

| Secret | Used by | Purpose |
|---|---|---|
| `AWS_DEPLOY_ROLE_ARN` | Backend AWS deploy and rollback | GitHub OIDC role for backend deployment. |
| `AWS_FRONTEND_DEPLOY_ROLE_ARN` | AWS frontend deploy and rollback | GitHub OIDC role for S3 / CloudFront deployment. |
| `NETLIFY_AUTH_TOKEN` | Netlify frontend deploy | Netlify CLI authentication token. |
| `VERCEL_TOKEN` | Gateway and Vercel frontend deploys | Vercel CLI authentication token. |

## Required Variables for Production Deploys

| Variable | Used by | Purpose |
|---|---|---|
| `AWS_DEPLOY_BUCKET` | Backend AWS deploy | S3 bucket for backend deployment bundles. |
| `AWS_INSTANCE_TAG_VALUE` | Backend AWS deploy | EC2 instance tag value used to locate the backend host. |
| `AWS_PARAMETER_STORE_PATH_PREFIX` | Backend AWS deploy | Parameter Store path prefix for runtime config. |
| `AURA_BACKEND_ORIGIN` or `AWS_BACKEND_BASE_URL` | Backend, frontend, smoke tests | Public backend origin used by deploys and health checks. |
| `NETLIFY_SITE_ID` | Netlify frontend deploy | Netlify site identifier. |
| `NETLIFY_PRODUCTION_URL` | Netlify smoke tests | Public Netlify production URL. |
| `AWS_FRONTEND_BUCKET` | AWS frontend deploy | S3 bucket for the hosted storefront. |
| `AWS_FRONTEND_DISTRIBUTION_ID` | AWS frontend deploy | CloudFront distribution for cache invalidation and verification. |
| `AWS_FRONTEND_PUBLIC_URL` | AWS frontend deploy and smoke tests | Public CloudFront or custom domain URL. |
| `VERCEL_ORG_ID` | Gateway and Vercel deploy readiness | Vercel organization/team id. |
| `VERCEL_PROJECT_ID` | Gateway and Vercel deploy readiness | Vercel project id. |
| `GATEWAY_PRODUCTION_URL` | Gateway smoke tests | Public gateway production URL. |
| `BACKEND_HEALTH_PATH` | Optional smoke tests | Backend health path, defaults to `/health`. |
| `GATEWAY_HEALTH_PATH` | Optional smoke tests | Gateway health path, defaults to `/`. |

## Signing Secrets Are Optional by Default

The production orchestrator passes signing requirements as false:

| Platform | Input passed by orchestrator | Default behavior |
|---|---|---|
| Windows | `require_windows_signing: false` | Build unsigned Windows artifacts when possible. |
| macOS | `require_macos_signing: false` | Skip macOS signing and notarization. |
| Android | `require_android_signing: false` | Build an unsigned debug APK when possible. |
| iOS | `require_ios_signing: false` | Build simulator validation artifacts only. |

These signing secrets are not required while signing is disabled:

| Optional signing secret | Platform |
|---|---|
| `WINDOWS_CERTIFICATE_BASE64` | Windows |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows |
| `APPLE_CERTIFICATE_BASE64` | macOS / iOS |
| `APPLE_CERTIFICATE_PASSWORD` | macOS / iOS |
| `APPLE_TEAM_ID` | macOS / iOS |
| `APPLE_ID` | macOS |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS |
| `ANDROID_KEYSTORE_BASE64` | Android |
| `ANDROID_KEYSTORE_PASSWORD` | Android |
| `ANDROID_KEY_ALIAS` | Android |
| `ANDROID_KEY_PASSWORD` | Android |
| `APPLE_PROVISIONING_PROFILE_BASE64` | iOS |

Store publishing is disabled by default with `publish_store_release: false`. Google Play, App Store, Microsoft Store, and Mac App Store publishing must remain off unless store publishing is explicitly enabled and signing is explicitly required.
