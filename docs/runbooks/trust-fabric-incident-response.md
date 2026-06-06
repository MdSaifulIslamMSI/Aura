# Trust Fabric Incident Response

Use this runbook when Trust Fabric audit events show abuse, ownership probing, webhook replay, high-risk admin actions, or degraded-system throttling.

## Triage

1. Search logs for `trust.fabric.decision`.
2. Filter by `decisionId`, `requestId`, `action`, `reason`, and `riskLevel`.
3. Compare Trust Fabric events with existing auth, payment, upload, and route security audit events.
4. Confirm whether the deployment is `shadow`, `enforce-safe`, or `enforce-sensitive`.
5. Check Redis and database health before interpreting missing rate signals.

## Response

- For shadow-only findings, do not assume users were blocked.
- For ownership probing, raise route-specific rate strictness through existing controls when available.
- For webhook replay, confirm provider event IDs and existing `PaymentEvent` records.
- For missing step-up on admin actions, verify the MFA/passkey flow before enabling enforcement.
- For health throttles, check database, Redis, payment outbox, upload scanner, and queue backlog.

## Boundaries

Do not permanently ban users, issue refunds, delete data, rotate production secrets, or change schemas from this runbook. Use existing incident, security, payment, and deployment procedures for those actions.
