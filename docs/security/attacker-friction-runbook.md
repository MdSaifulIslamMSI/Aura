# Attacker-Friction Runbook

## Triage

1. Search security events by request ID, user ID, tenant ID, action, route, IP hash, and decision.
2. Separate canary touches from legitimate user friction.
3. Check whether the event is isolated, repeated, distributed, or tied to a sensitive action.
4. Review recent failed attempts, request velocity, payload risk, and previous security events.

## Response

- `CHALLENGE`: confirm step-up UX is available and not looping.
- `THROTTLE`: verify the window is temporary and account enumeration is not exposed.
- `DENY`: verify the route did not leak user, email, resource, or policy details.
- `CONTAIN`: inspect containment actions and decide whether to clear, extend, or escalate.

## Verification

Run `npm run security:routes` after route changes and `npm run security:friction` after policy changes.
