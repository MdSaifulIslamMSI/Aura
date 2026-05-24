# Rotate Secrets Required - 2026-05-24

Gitleaks detected historical secret-like material in git history. The current working tree scan is gated with a redacted baseline so new leaks fail, but these historical values must be treated as exposed because they were committed before this hardening pass.

No secret values are reproduced in this report.

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
