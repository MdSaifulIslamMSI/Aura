# Postmortem Template

Copy this file per incident: `docs/runbooks/postmortem-YYYY-MM-DD-<slug>.md`.
Required for every SEV1/SEV2 (see `docs/status/incident-severity-policy.md`).
No resolved incident leaves the prevention action blank.

## Summary

- Date:
- Severity (SEV1/SEV2/SEV3/SEV4):
- Duration (detect → resolve):
- One-paragraph summary:

## Impact

- Who was affected (users, routes, providers):
- SLO impact (which SLI in `docs/sre/slo.md`, budget consumed):
- Status page state (Major Outage / Partial Outage / Degraded):

## Timeline

Every incident must have a timeline. Use UTC.

| Time | Event |
|---|---|
| | Detected (how): |
| | Severity declared: |
| | Status page updated: |
| | Mitigated: |
| | Resolved: |

Update cadence kept: SEV1 every 15 min / SEV2 every 30 min / SEV3 every 60 min.

## Root Cause

- Proximate cause:
- Contributing factors:
- Evidence (logs, `artifacts/sre/*.json`, commit, deploy):

## Action Items

Every item needs an owner and a date. Prevention action must not be blank.

| Action | Owner | Due | Status |
|---|---|---|---|
| | | | |
| | | | |

## SEV Linkage

- Severity justification per `docs/status/incident-severity-policy.md`:
- Postmortem required? (yes for SEV1/SEV2):
- Follow-up: link ticket/PR for each action item above.
