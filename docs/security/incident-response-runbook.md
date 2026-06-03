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
- DDoS or bot-abuse incident: switch on `ATTACK_MODE=true` only through the approved deployment channel, block AI/uploads/auth pressure first, preserve provider WAF samples, and keep health/status/webhooks reachable.
- Cost-spike incident: disable costly non-critical providers before customer-critical reads, run `npm run security:traffic:proof` after containment, and attach the generated report to the incident record.

## Traffic Fortress Modes

| Mode | Use when | First flags | Rollback |
| --- | --- | --- | --- |
| Public read survival | Search/read traffic is high but core app is healthy | `ATTACK_MODE=true`, `ATTACK_MODE_PUBLIC_READ_ONLY=true` | Set `ATTACK_MODE=false` after edge pressure normalizes |
| Expensive provider shield | AI, upload, OTP, or payment costs spike | `ATTACK_MODE_BLOCK_AI=true`, `ATTACK_MODE_BLOCK_UPLOADS=true` | Re-enable one surface at a time after provider error rate drops |
| Abuse blocking | Confirmed automation bypasses soft scoring | `ABUSE_SHIELD_BLOCKING_ENABLED=true` | Return to observe-only after false-positive review |
| Load shedding | Origin is protecting health/status availability | `TRAFFIC_FORTRESS_FORCE_OVERLOAD` only for drills; production uses measured overload | Remove force flag and keep route budgets enabled |

Never run a production load, stress, or abuse drill from this runbook. Use `npm run traffic:fortress:load:local` for the safe dry-run plan and the staged load-drill playbook for approved environments.

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
