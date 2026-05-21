# Student Pack CLI Start

This repo can use the activated student-pack tools without committing provider secrets.

## Quick Start

```powershell
npm run student-pack:doctor
npm run student-pack:auth:live -- --write
npm run student-pack:start
```

For the full local workflow:

```powershell
npm run student-pack:god
```

`student-pack:start` does the local work that is useful for Aura:

- starts MongoDB replica-set support and Redis through Docker Compose
- starts LocalStack for local S3/SSM-style AWS testing
- creates the local S3 bucket used by review-media uploads
- runs the backend and frontend with Doppler when the Doppler CLI is configured
- optionally starts a LambdaTest tunnel

The local app opens at `http://127.0.0.1:5173`.

## Live Login Assist

Some providers cannot create tokens from a CLI without a provider-owned browser login, MFA, or account confirmation. Use the login assist to launch those safe handoffs:

```powershell
npm run student-pack:login
```

After completing the provider prompts, refresh the redacted live-auth report:

```powershell
npm run student-pack:auth:live -- --write
```

The app reads `.run-logs/student-pack-live-auth.json` and shows each provider as ready, partial, or blocked on `/status`. The report never stores token values.

## Doppler

Use Doppler for secrets instead of committing `.env` changes.

```powershell
doppler login
doppler setup
npm run student-pack:start
```

If `doppler configure get project` fails and `DOPPLER_TOKEN` is not set, the start script falls back to local ignored env files.

## LocalStack

The start script prefers the LocalStack CLI:

```powershell
localstack start -d
awslocal s3 mb s3://aura-review-media-local
```

If the LocalStack CLI is not installed but Docker is available, it starts a Docker fallback container named `aura-localstack`.
To avoid a silent long pull during app startup, the Docker fallback only starts when the image is already present. Pull it once when you are ready:

```powershell
docker pull localstack/localstack:latest
```

If your activated plan requires licensing, keep the token in Doppler or your shell:

```powershell
$env:LOCALSTACK_AUTH_TOKEN="your-localstack-token"
npm run student-pack:start
```

The backend gets these local AWS values for the started process only:

```text
UPLOAD_STORAGE_DRIVER=s3
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_S3_ENDPOINT=http://127.0.0.1:4566
AWS_S3_FORCE_PATH_STYLE=true
AWS_S3_REVIEW_BUCKET=aura-review-media-local
```

## LambdaTest

To start the local tunnel with the app:

```powershell
$env:LT_USERNAME="your-lambdatest-username"
$env:LT_ACCESS_KEY="your-lambdatest-access-key"
npm run student-pack:start -- -StartLambdaTestTunnel
```

Keep those values in Doppler for normal use.

You can also run only the tunnel:

```powershell
npm run student-pack:lambdatest:tunnel
```

## Sentry

Use Sentry CLI after a production build when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are present in Doppler or your shell.

```powershell
npm run build
sentry-cli releases new $env:GITHUB_SHA
sentry-cli releases set-commits $env:GITHUB_SHA --auto
```

Sourcemap upload should only be enabled when the frontend build intentionally emits sourcemaps.
The repo helper is:

```powershell
npm run student-pack:sentry:release
```

## Datadog

Use `datadog-ci` from CI or a local shell after tests produce uploadable reports.

```powershell
datadog-ci version
```

Keep `DATADOG_API_KEY` or `DD_API_KEY` in Doppler/GitHub secrets, not in the repo.
If live auth says the configured value looks like an application key, move that value to `DATADOG_APP_KEY` and add a real Datadog API key as `DD_API_KEY` or `DATADOG_API_KEY`.

Repo helpers:

```powershell
npm run student-pack:datadog:doctor
npm run student-pack:datadog:junit -- test-results
```

## Testmail

Use Testmail.app for OTP, auth, and order-email flows. Keep `TESTMAIL_APIKEY` and `TESTMAIL_NAMESPACE` in Doppler, then point smoke tests or email-delivery scripts at those mailbox values.

```powershell
npm run student-pack:doctor
npm run student-pack:testmail
```

The repo uses the Testmail.app JSON API directly because the npm package named `testmail` is not the Testmail.app CLI.
