# Account and Profile Overhaul: Production Verification

## Status

**Not run. Production unchanged.**

This file is the evidence template for a future explicitly authorized rollout. It must not be converted to PASS from static code, a preview, a pending workflow, or a different SHA.

## Release identity

| Evidence | Required value | Current |
|---|---|---|
| Intended commit | Exact approved SHA | Pending |
| CI gate commit | Same SHA | Pending |
| Staging release marker | Same SHA | Pending |
| Production backend release marker | Same SHA | Pending |
| Netlify storefront marker | Same SHA | Pending |
| Vercel storefront/gateway marker | Same SHA where targeted | Pending |
| AWS frontend marker | Same SHA where targeted | Pending |
| Rollback targets captured | Immutable provider-specific targets | Pending |

The audit observed live commit `1c44b26e27aab5203b9b546c9a2efd8c4c4e96b4` while the local checkout was `0e4216c8fbf537f79f75f25a119f4dde13efd33b`. That observation proves a mismatch, not readiness.

## Pre-production gates

| Gate | Required evidence | Status |
|---|---|---|
| Source reconciliation | Scoped target diff based on intended main | Local branch reconciled to `f451584d`; commit/CI still pending |
| Branch protection | Required checks terminal green on exact SHA | Pending |
| Dependency audit | Findings fixed or accepted with evidence | Blocked |
| Secret scan/SBOM/CodeQL | Terminal green | Pending |
| Frontend focused/full CI | Terminal green | Pending |
| Backend focused/full CI | Terminal green | Pending |
| Auth/security abuse tests | Terminal green | Pending |
| Build/bundle budgets | Terminal green with before/after | Local PASS; CI pending |
| Authenticated browser QA | Desktop/tablet/mobile states | Blocked |
| Accessibility | Axe, keyboard, zoom, screen-reader spot check | Blocked |
| Migration rehearsal | Dry-run, resume, rollback/read fallback | Pending |
| Staging health/smoke | Exact SHA and account tasks | Pending |
| Cost/observability | Guard pass and dashboards active | Pending |
| Rollback rehearsal | Captured targets and successful smoke | Pending |
| Production authorization | Explicit confirmation | Not granted |

## Production smoke checklist

Run only after a saved, gated deployment:

### Platform

- `/health/live` and `/health/ready` return expected status.
- Release ID and commit markers agree across targeted hosts.
- API routing points to the intended backend.
- No spike in 4xx/5xx, auth failures, latency, Redis errors, or database pressure.

### Customer account

- Sign in with the approved smoke account.
- Navigate account overview and confirm partial/failure handling.
- Edit a non-sensitive profile field and verify persistence.
- Add/edit/default/delete a disposable smoke address.
- Page and filter order history without exposing another account.
- Read/mark a smoke notification.
- View payment-method summaries without logging sensitive data.
- Verify rewards, marketplace, and support modules.

### Security

- Load MFA/passkey/trusted-device state.
- Load active sessions and identify the current session.
- Revoke a disposable other session and verify it can no longer authenticate.
- Confirm trusted-device credentials remain distinct from session rows.
- Review redacted activity and confirm no raw IP, token, fingerprint, or other-user data.

### Privacy

Do not smoke destructive privacy actions until policy and runbooks are approved. When approved, use a dedicated disposable account and verify request, cancellation, grace, export expiry, retention hold, and audit evidence.

### Accessibility and responsive

- Keyboard-complete one core task.
- Check focus and dialog restoration.
- Inspect 390, 768, 1440, and 2560 px.
- Check 200% zoom and reduced motion.

## Evidence capture

For every production verification:

- workflow URL/run ID and conclusion;
- exact commit SHA;
- deployment IDs and immutable rollback targets;
- health response timestamps;
- release marker responses;
- smoke command exit codes;
- screenshots with secrets/personal data excluded;
- dashboard interval and alert status;
- tester, environment, start/end time;
- failed/skipped steps and issue references.

## Rollback verification

If rollback is exercised:

1. Confirm the rollback workflow terminal status.
2. Confirm each provider is bound to its captured target.
3. Confirm backend and frontend release markers.
4. Re-run health, login, and read-only account smoke.
5. Confirm migration workers are stopped and old readers tolerate additive data.
6. Record residual customer impact.

## Sign-off

Production may be declared verified only when all required rows contain observed evidence for the same release. Current status remains **blocked/not run**.
