# Aura Incident Severity Policy

| Severity | Meaning | Public status | Required action |
|---|---|---|---|
| SEV1 | Full outage / payments/auth dead | Major Outage | Immediate public incident |
| SEV2 | Core feature broken | Partial Outage | Public incident |
| SEV3 | Degraded performance / one provider failing | Degraded | Public or internal |
| SEV4 | Minor bug / no customer impact | Operational or degraded | Internal only |

Rules:

- SEV1 updates every 15 minutes.
- SEV2 updates every 30 minutes.
- SEV3 updates every 60 minutes.
- Every incident must have a timeline.
- Every SEV1/SEV2 must have a postmortem.
- No resolved incident should leave prevention action blank.
