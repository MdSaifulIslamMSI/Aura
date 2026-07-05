# AWS Production Rollback Runbook

## What Triggers Rollback

Start rollback when production health, login, checkout, upload, socket, or admin safety checks fail after a deploy and the failure is tied to the new release. Prefer rollback over hot patching when customer-facing availability, auth, payment, or data integrity is at risk.

## Identify The Failed Deploy

1. Record the failing production URL, workflow run, git SHA, deploy time, and operator.
2. Confirm whether the backend, frontend, gateway, or cache layer is failing.
3. Check the production release manifest and the last known good artifact SHA.
4. Do not print secrets, SSM values, runtime env files, database URLs, Redis URLs, tokens, or private keys.

## Restore The Previous Artifact

Backend rollback uses the existing immutable release directories on EC2 and the S3-uploaded release artifacts. Rollback does not rebuild from source.

```sh
ROLLBACK_REF=<previous-good-git-sha> \
AWS_INSTANCE_TAG_VALUE=aura-backend \
AWS_PARAMETER_STORE_PATH_PREFIX=/aura/prod \
bash infra/aws/rollback-backend.sh
```

The rollback hook selects a previous release directory, verifies the artifact files exist, loads the prior Docker image, rewrites release metadata, restarts Compose, and checks local readiness before returning success.

## Verify Health

1. Check public production health.
2. Check authenticated critical paths only with approved smoke accounts.
3. Confirm `/health/ready` is checked locally by the rollback hook with the configured health token.
4. Confirm no staging host or `/aura/staging` prefix is used by production.

## Verify Frontend Cache And Service Worker

1. Fetch the production HTML and confirm it references the expected restored asset names.
2. Fetch referenced JS/CSS assets directly and confirm HTTP 200.
3. Check cache headers for HTML so stale broken JS is not pinned.
4. If a service worker is active, verify it is serving the restored manifest or unregister it through the approved production mitigation path.

## Stop Retry Loops

Pause or cancel any deploy workflow that is retrying the broken release. Keep rollback workflows serialized. Do not start a new production deploy until staging smoke, environment contract, cost guard, and rollback readiness pass for the replacement commit.

## Record Incident Notes

Record:

- Trigger and detection time.
- Failed release SHA.
- Restored release SHA.
- Health verification results.
- User impact.
- Follow-up owner.
- Whether secrets, payments, auth, or data integrity were involved.
