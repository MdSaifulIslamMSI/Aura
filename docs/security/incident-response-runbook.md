# Incident Response Runbook

This runbook extends `docs/security/incident-response.md` with campaign-specific evidence and rollback steps.

## Severity

| Severity | Examples | First Response |
| --- | --- | --- |
| SEV-1 | confirmed data exposure, active account takeover, payment integrity failure, production secret leak | contain immediately, page owners, preserve evidence |
| SEV-2 | auth bypass attempt, repeated webhook replay, upload malware burst, admin policy false positive affecting operations | restrict affected surface, collect logs, prepare hotfix |
| SEV-3 | suspicious but blocked activity, scanner failure, isolated abuse spike | monitor, tune detections, add regression coverage |

## Evidence Checklist

- Request IDs and time range.
- Actor IDs, resource types, reason codes, and risk levels.
- Security audit events and auth security event metrics.
- Deployment SHA, feature flags, rollback flags, and CI status.
- Provider event IDs for Stripe/Razorpay/Resend/Firebase where applicable.
- Screenshots or exports of relevant dashboards without secrets.

## Procedures

- Auth incident: revoke sessions, force re-auth, review WebAuthn/passkey enrollment, inspect recovery-code use.
- Payment incident: stop affected admin payment action, keep webhook signature checks enabled, inspect replay/idempotency state.
- Upload or malware incident: fail closed if configured, quarantine objects, review MIME/magic-byte and scanner logs.
- Secret leak: rotate affected secret, invalidate sessions/tokens, run secret scanners, review CI logs.
- Data leak: preserve evidence, identify data categories, apply containment, prepare notification decision.
- Outage: use rollback runbooks and status page workflow before broad code changes.

## Postmortem Template

- Summary
- Customer impact
- Timeline
- Root cause
- Detection gap
- What worked
- What failed
- Corrective actions
- Regression tests
- Owner and due date
