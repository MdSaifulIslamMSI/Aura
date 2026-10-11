# Authenticated DAST — Local Bring-Up Runbook

Last updated: 2026-10-11

How to run `npm run security:zap:auth` against a **fully local** stack (no staging,
no cloud writes). Verified step-by-step on Windows + Docker Desktop. Every gotcha
below was hit during the first live run; they are not obvious from the code.

## Why this matters

The black-box pentest report (`security-reports/pentest-blackbox-unauthenticated-2026-09-07.md`)
could not exercise authenticated batteries. The equivalent Jest suites already
cover the server logic (IDOR/BOLA, cookie flags, prompt injection, limiter bypass),
so what this runbook buys is the **live** authenticated scan.

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Docker Desktop | Mongo + Redis come from `docker-compose.split-runtime.yml` |
| Java + `firebase-tools` | Only for the Firebase Auth **emulator** path |
| `app/.env` / `server/.env` | Present in the workspace; no edits required |

## Bring-up

```sh
# 1. Data services
docker compose -f docker-compose.split-runtime.yml up -d mongo redis mongo-init

# 2. Point the replica set at a host-resolvable member (see Gotcha 1)
docker exec <mongo-container> mongosh --quiet --eval \
  "cfg = rs.conf(); cfg.members[0].host = '127.0.0.1:27017'; rs.reconfig(cfg, {force: true})"

# 3. Firebase Auth emulator (avoids any cloud mutation)
firebase emulators:start --only auth --project demo-aura

# 4. Seed one disposable user, then mark it verified (see Gotcha 3)
#    POST http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=any
#    then admin.auth().updateUser(uid, { emailVerified: true })

# 5. Backend
MONGO_URI=mongodb://127.0.0.1:27017/aura?replicaSet=rs0 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIREBASE_PROJECT_ID=demo-aura \
FIREBASE_SERVICE_ACCOUNT_FILE=" " \
PAYMENT_PROVIDER=simulated OTP_SMS_ENABLED=false NODE_ENV=development \
npm --prefix server start

# AURA authenticated bearer token is minted by the runner
# (`npm run security:zap:auth`) using the same Firebase REST sign-in the
# storefront performs — no ZAP script engine involved, no SDK, host-side fetch
# only. The plan then injects it via header-based session management.
#   ZAP_AUTH_TARGET=http://host.docker.internal:5000 \
#   ZAP_AUTH_USERNAME=<seeded email> \
#   ZAP_AUTH_PASSWORD=<seeded password> \
#   ZAP_AUTH_FIREBASE_API_KEY=<web api key> \
#   ZAP_AUTH_FIREBASE_ORIGIN=https://identitytoolkit.googleapis.com \
#   npm run security:zap:auth -- http://host.docker.internal:5000
```

## Why header-based sessions (not script authentication)

The first working proof used ZAP's script-based authentication with a GraalJS
script. The pinned `ghcr.io/zaproxy/zaproxy:stable` image ships the GraalJS
engine only as an **unenabled alpha add-on**, so no `scriptEngine` value is
accepted and the plan fails with `Invalid Script Engine`. Mounting the image's
own plugin directory does not enable it. Rather than shipping a runbook that
depends on a marketplace add-on install, the design now:

1. mints the Firebase ID token host-side (same `accounts:signInWithPassword`
   exchange the storefront uses; emulator origin supported via
   `ZAP_AUTH_FIREBASE_ORIGIN`), and
2. injects it through `sessionManagement.method: headers` — a core mechanism
   with no add-on dependency.

## Gotchas (verified 2026-10-11)

1. **Replica set member host must be host-resolvable.** `mongo-init` registers
   the set as `mongo:27017` (correct inside the compose network). A client on
   the Windows host connects to `127.0.0.1:27017`, then MongoDB topology
   discovery hands it `mongo:27017` and the connection dies with
   `getaddrinfo ENOTFOUND mongo` — even though the URI it dialed was correct.
   Fix: `rs.reconfig` the member to `127.0.0.1:27017` (step 2), or skip Docker
   and boot an in-process replica set (`.run-logs/local-stack.cjs` in the
   workspace uses `mongodb-memory-server`, which names the set `testset`, not
   `rs0` — pass `replset.getUri('aura')` straight through).

2. **The real service-account file overrides the emulator project.**
   `server/config/firebase.js` prefers the project id inside
   `FIREBASE_SERVICE_ACCOUNT_FILE` over `FIREBASE_PROJECT_ID`, and then
   verification runs against real Firebase (`aud` mismatch on emulator tokens).
   The runtime loads `server/.env` but `dotenv` does not override values that
   already exist in the environment — however `$env:X = ""` in PowerShell
   **deletes** the variable rather than emptying it. Set it to a single space
   instead: `FIREBASE_SERVICE_ACCOUNT_FILE=" "` → `readEnv()` trims it to blank,
   so no credential is loaded and the emulator host is honored.

3. **Emulator users must be verified, and the token re-minted afterwards.**
   `/api/auth/sync` rejects unverified accounts
   ("Email verification is required before session sync"). Identity Toolkit
   `signUp` cannot set `emailVerified`; use the Admin SDK against the emulator
   (`admin.auth().updateUser(uid, { emailVerified: true })`), then sign in
   **again** — Firebase ID tokens are immutable claim snapshots, so the
   pre-update token still carries `email_verified: false`.

4. **The bundled `requestor` add-on rejects the documented `requests`
   parameter** in the pinned image (`Unrecognised parameter for job requestor:
   requests`), so the plan does not use it. Seeds live in the context `urls`;
   the spider job fails the plan on any seed that is not 200 (the API root is a
   404), so use a known-200 endpoint such as `/health/live`.

5. **FATAL on the docker image invocation**: the zaproxy image has **no
   entrypoint** (`docker run image -cmd` fails with `executable file not
   found`), and `--entrypoint` must precede the image name. The runner invokes
   `/bin/bash -c '/zap/zap.sh -cmd -autorun /zap/wrk/scripts/security/zap-auth-plan.yaml'`.

## What the runbook does not do

- It never contacts production: the runner refuses known production hosts and
  any target with a `prod`/`production`/`live` word before Docker starts.
- It never mutates cloud state: the emulator is in-memory, the Mongo user is
  auto-provisioned locally by `syncAuthenticatedUser`, and no
  `bootstrap_staging_smoke_accounts.js` run is involved.