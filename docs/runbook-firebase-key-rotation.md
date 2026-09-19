# Runbook — Firebase Admin service-account key rotation

Open since May 2026 — the service-account private key that signs every
Admin-SDK operation (custom tokens, session-cookie minting, phone-auth
admin flows) has never been rotated. GCP service-account keys never expire,
so every key created for `firebase-adminsdk-fbsvc@billy-b674c.iam.gserviceaccount.com`
(project `billy-b674c`) since project creation is live until deleted.
Rotation = create a new key, cut the runtime over, **delete the old one**.

Storage layout (verified 2026-09-19): SSM `/aura/prod/` holds the discrete
fields `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` (the runtime's
"discrete_fields" source; the `FIREBASE_SERVICE_ACCOUNT` JSON blob is not
used in production).

## Tools

- **Cutover probe**: `npm --prefix server run auth:verify-firebase-admin`
  (`server/scripts/verify_firebase_admin_credentials.js`). Signs a JWT with
  the configured key and exchanges it at Google's token endpoint — proves the
  private key is active and matches the service-account email without
  touching Firebase data. Works locally (with SSM priming, as the app user)
  and on the host.
- Baseline receipt 2026-09-19: probe returned **KEY VALID** for
  `firebase-adminsdk-fbsvc@billy-b674c.iam.gserviceaccount.com` — the current
  key is live and healthy before any rotation.

## Steps

1. **Pre-flight** — run the probe; it must print `KEY VALID`. If it does not,
   stop and fix the current credentials first (never rotate from a broken state).

2. **Create the new key** *(GCP console — the only step a human must do)*:
   IAM & Admin → Service Accounts → `firebase-adminsdk-fbsvc@billy-b674c` →
   Keys → Add key → Create new key → JSON. Download it; treat the file as a
   live secret (never commit, never paste into chat/logs). GCP allows up to
   10 keys per service account, so old and new are both valid during overlap.

3. **Update SSM** — put the new private key into
   `/aura/prod/FIREBASE_PRIVATE_KEY` (overwrite). Keep the exact `\n`
   escaping the runtime expects (`privateKey.replace(/\\n/g, '\n')`):
   store the key with literal `\n` sequences, not raw newlines.
   `FIREBASE_CLIENT_EMAIL` is unchanged (same service account).
   ```sh
   MSYS_NO_PATHCONV=1 aws ssm put-parameter --name /aura/prod/FIREBASE_PRIVATE_KEY \
     --type SecureString --overwrite --value "$(node -e 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8").replace(/\r?\n/g, "\\n"))' /path/to/new-key.json.frag)" \
     --profile aura-new-admin --region ap-south-1
   ```
   (Extract `private_key` from the downloaded JSON first; the one-liner above
   converts its newlines to the `\n` escapes.)

4. **Reload the backend** — deploy or restart the api container so the
   runtime re-primes from SSM, then run the probe **on the host** → `KEY VALID`.

5. **Smoke the real flows** — one fresh OTP login and one passwordless
   session; watch for Firebase auth errors in the api logs.

6. **Delete the old key** *(GCP console)* — Keys page: delete the pre-rotation
   key (note its `keyId`; the probe output does not expose it). This is the
   step that actually retires the May-era exposure.

7. **Post-delete verification** — run the probe again: it must still print
   `KEY VALID` (proving nothing in the runtime depended on the deleted key),
   plus one more OTP login.

## Rollback

A deleted GCP key cannot be un-deleted. If step 7 fails, create another new
key (step 2) and repeat the cutover (steps 3–5). If the runtime breaks
between steps 3 and 6, re-put the previous `FIREBASE_PRIVATE_KEY` value into
SSM and reload — the old key is still valid until step 6 deletes it.

## Scope note

This runbook covers the **Admin SDK service-account key**. Related, separate
hygiene items in the same GCP console session: confirm the Firebase **Web
API key** (the public `VITE_FIREBASE_API_KEY`) has HTTP-referrer
restrictions, and review OAuth client secrets if any are unused.
