# Credential-Stuffing Game-Day Runbook (Phase 3)

Simulated brute-force against staging to prove the containment chain:
failure counting → lockout engagement (or rate-limit containment) →
observable 429s → postmortem.

## Prerequisites

- Staging backend URL + `SMOKE_TARGET_ENV=staging`.
- No production credentials, no real user identities. The drill uses a
  synthetic `gameday-<timestamp>@example.com` identity only.
- The drill never touches production: `staging-credential-stuffing-gameday.mjs`
  refuses known production hosts and production-like names, and requires
  `STAGING_GAMEDAY_ARM=1` for live fire.

## Procedure

```sh
# 1. Dry run (validates guards, fires nothing).
SMOKE_TARGET_ENV=staging STAGING_API_BASE_URL=https://<staging-backend> \
  node scripts/security/staging-credential-stuffing-gameday.mjs

# 2. Live fire (10 bad recovery-code verifies, 1.5s apart).
SMOKE_TARGET_ENV=staging STAGING_API_BASE_URL=https://<staging-backend> \
  STAGING_GAMEDAY_ARM=1 \
  node scripts/security/staging-credential-stuffing-gameday.mjs --execute
```

## Expected outcomes

| Verdict | Meaning | Follow-up |
|---|---|---|
| `LOCKOUT_ENGAGED` | `ACCOUNT_TEMPORARILY_LOCKED` observed — distributed lockout works | File postmortem (success), note time-to-engage |
| `RATE_LIMIT_CONTAINED` | 429s without lockout code — rate limiters absorbed it | File postmortem; consider lockout tuning |
| `NO_CONTAINMENT_OBSERVED` | No 429s at all — exit 1 | Treat as a finding: investigate before release |

## After the drill

1. Artifact lands at `artifacts/security/gameday-credential-stuffing.json`
   (timeline of every attempt — attach to the postmortem, do not commit).
2. Correlate with telemetry: `auth.lockout.*`, `rate_limit.hit`,
   `auth.lockout.degraded` events for the game-day identity.
3. Write the postmortem in `docs/runbooks/postmortem-template.md` —
   the repo's first real one. SEV3 unless containment failed (then SEV2).
