# Rotate Secrets Required - 2026-05-24

Gitleaks detected historical secret-like material in git history. The current working tree scan is gated with a redacted baseline so new leaks fail, but these historical values must be treated as exposed because they were committed before this hardening pass.

No secret values are reproduced in this report.

## Working-Tree Status (verified 2026-09-06)

| Surface | Status | Evidence |
| --- | --- | --- |
| `app/.env.production` | Removed from working tree | File no longer exists; only env example templates are tracked |
| Android hardcoded Firebase key | Remediated — key now injected at build time | `app/android/app/build.gradle` reads `AURA_ANDROID_FIREBASE_API_KEY` via `resolveStringEnv` with placeholder default `example-firebase-api-key` |
| Working-tree secret scan | PASS | `npm run security:secrets` — 2/2 gate tests, 0 findings across 2,786 files |
| History scan gate | Enforced in CI (local run requires Docker Desktop running) | `.github/workflows/security.yml:69`, `security-gates.yml`, `ci.yml` run `npm run security:gitleaks` |
| **Console-side rotation of the historically committed key** | **STILL OPEN — owner action required** | Checklist below has blank verification dates |

What remains open cannot be done from this repository: the key that was committed before 2026-05-24 lives in the Firebase/GCP console. Until the owner confirms rotation or restriction below, treat that key as attacker-known.

## Findings

| Finding class | Historical locations | Required action |
| --- | --- | --- |
| GCP/Firebase API key pattern | `app/android/app/build.gradle`, `app/.env.production` in prior commits | Rotate or delete the affected API key, restrict it by application/package/SHA and API scope, and verify the old key is disabled. |
| Generic API key pattern | `server/public/market-locale-ja-l1czkLFx.js` in prior commits | Rotate the referenced provider key if it was real; if it was a generated asset false positive, keep it out of future committed build output. |
| Curl authorization header examples | `SECURITY.md`, `SECURITY_FIXES.md`, `DEPLOYMENT_GUIDE.md`, `REPOSITORY_STATUS.md` in prior commits | Confirm the documented bearer values were placeholders. Rotate any token if it was ever live. |

## Mitigation Applied

- Added `.gitleaks-baseline.json` with redacted fingerprints for the known historical findings.
- Updated `npm run security:gitleaks` to use the repo Gitleaks config and the redacted baseline.
- Kept Gitleaks fail-closed for any new finding not in the baseline.

## Owner Checklist

- Rotate/restrict any Firebase or GCP key that matches the historical commits.
- Revoke any bearer/API token that may have been copied into documentation.
- Re-run `npm run security:gitleaks` after rotation; new findings must fail the gate.
- Avoid force-pushing history unless the repository owner explicitly approves a coordinated history rewrite.

## Owner Verification Checklist (console actions — record dates, never values)

Complete each item in the provider console, then fill in the date + ticket
reference and commit this file. Do not paste keys, tokens, or secrets here.

- [ ] Firebase/GCP API key from historical commits rotated or deleted
  (APIs & Services > Credentials). Old key state: ______. Date: ______
  Steps:
  1. Open https://console.cloud.google.com/apis/credentials (project
     `billy-b674c`) or Firebase console > Project settings > General >
     "Web API Key" > "Manage in Google Cloud".
  2. Identify the exposed key by creation/last-used date inside the
     commit window ending 2026-05-24. Never paste the key anywhere;
     match by fingerprint only.
  3. Preferred: DELETE the exposed key, then CREATE a replacement. If
     other consumers still use it, keep it only until the replacement
     is deployed, then delete.
  4. Record the old key state (deleted / restricted) and date above.
- [ ] Replacement key (if any) restricted by application and by API scope.
  Restriction summary: ______. Date: ______
  Steps:
  1. On the new key: Application restrictions > Android applications >
     add package name + SHA-1 of the release signing cert
     (`cd app/android && ./gradlew signingReport` prints SHA-1 locally).
  2. Add HTTP referrer restrictions for every deployed web origin
     (Vercel/Netlify production + preview domains).
  3. API restrictions > Restrict key > allow only the APIs the app calls
     (Identity Toolkit, Firebase Installations/FCM, and any others in
     actual use). Deny-by-default beats allow-all.
  4. Set `AURA_ANDROID_FIREBASE_API_KEY` (and web `VITE_FIREBASE_API_KEY`)
     in the build/CI environment from the new key; never commit it.
  5. Verify the OLD key now fails: after deletion/restriction, run the
     app once with the old key value forced in a local env to confirm
     Firebase rejects it, then remove that local override.
- [ ] Doc bearer/authorization examples confirmed placeholders; any live
  token rotated and old token revoked. Outcome: ______. Date: ______
- [ ] Generated asset (market-locale JS) confirmed false positive or
  provider key rotated. Outcome: ______. Date: ______
- [ ] `npm run security:gitleaks` re-run after rotation: PASS. Date: ______

Verification evidence lives in this checklist plus the gitleaks gate.
History is intentionally not rewritten (see Owner Checklist above).
