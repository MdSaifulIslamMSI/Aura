# Aura Security Fabric Recovery Runbook

## Stabilize

1. Confirm whether enforcement is enabled.
2. If users are blocked incorrectly, return to audit-only mode.
3. Keep event logging enabled unless it is the confirmed failure source.
4. Validate that auth, checkout, admin, upload, AI, and status routes respond normally.

## Recover

Run the smallest meaningful checks first:

- Focused security fabric tests.
- Existing auth and sensitive-action tests.
- Route smoke checks for the affected surface.
- `npm run ci:doctor` for broad local health if configuration changed.

## Evidence

Capture:

- Feature flag values.
- Request IDs.
- Decisions and risk scores.
- Any enforcement response status.
- Tests and health checks run.

## Exit Criteria

- No unexpected `DENY`, `LOCKDOWN`, or tenant mismatch events remain.
- Enforcement flags are either disabled or scoped to verified surfaces.
- Rollback flags are documented for the release.
- A follow-up issue exists for any uncovered route or missing tenant context.
