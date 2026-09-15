# Production CI/CD Secrets and Variables

This production pipeline is planner-driven. Missing cloud configuration does not attempt a fake deploy; the orchestrator records a clear no-op with the missing secret or variable names.

## Required Secrets for Production Deploys

| Secret | Used by | Purpose |
|---|---|---|
| `AWS_DEPLOY_ROLE_ARN` | Backend AWS deploy and rollback | GitHub OIDC role for backend deployment. |
| `AWS_FRONTEND_DEPLOY_ROLE_ARN` | AWS frontend deploy and rollback | GitHub OIDC role for S3 / CloudFront deployment. |
| `NETLIFY_AUTH_TOKEN` | Netlify frontend deploy | Netlify CLI authentication token. |
| `VERCEL_TOKEN` | Gateway and Vercel frontend deploys | Vercel CLI authentication token. |
| `RENDER_API_KEY` | Render frontend deploy and rollback | Render API key for the coordinated multi-host storefront release. |
| `RAILWAY_API_TOKEN` | Railway frontend deploy and rollback | Railway account/workspace API token (`Authorization: Bearer` against `https://backboard.railway.com/graphql/v2`). |

## Optional Sentry Secrets for Error Tracking

Sentry stays a no-op (frontend and backend) until DSNs are configured. The AWS
frontend deploy uploads releases/sourcemaps only when `SENTRY_AUTH_TOKEN` exists.

| Secret | Used by | Purpose |
|---|---|---|
| `VITE_SENTRY_DSN` | AWS frontend build | Enables browser error capture; baked at build time. |
| `SENTRY_AUTH_TOKEN` | AWS frontend build (Sentry release step) | Creates the Sentry release and uploads `app/dist` sourcemaps. |
| `SENTRY_ORG` | AWS frontend build (Sentry release step) | Sentry organization slug. |
| `SENTRY_PROJECT` | AWS frontend build (Sentry release step) | Sentry project slug. |
| `SENTRY_URL` | AWS frontend build (Sentry release step, optional) | Regional SaaS host, defaults to `https://xyz-yra.sentry.io`. |

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
| `RENDER_SERVICE_ID` | Render frontend deploy and rollback | Render service id (`srv-…`) for `aura-storefront`; may also be a secret. |
| `RAILWAY_SERVICE_ID` | Railway frontend deploy and rollback | Railway storefront service id/name; may also be a secret. |
| `RAILWAY_PROJECT_ID` | Railway frontend deploy and rollback | Railway project id used to link the CLI before mutating. |
| `RAILWAY_ENVIRONMENT_ID` | Railway frontend deploy and rollback | Railway environment id (production) for the storefront service. |
| `RAILWAY_PRODUCTION_URL` | Railway frontend deploy and smoke tests | Public Railway storefront URL, e.g. `https://aura-storefront.up.railway.app`. |
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
