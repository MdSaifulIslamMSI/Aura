# Extreme Attacker-Friction Security Fabric

## What was added

- Central decision engine: `server/security/securityDecisionEngine.js`.
- Sensitive action registry: `server/security/sensitiveActionRegistry.js`.
- Risk scoring: `server/security/riskScoringService.js`.
- Context builder, fresh auth, resource authorization, audit redaction, containment, payload hardening, remote fetch guard, and canary services.
- Middleware adapters for security decisions, fresh auth, tenant boundary, ownership, adaptive rate limiting, and audit logging.
- Safe canary routes for attacker-signal collection.
- Route scanner and friction gate scripts.
- Focused Jest tests and security documentation.

## Why it exists

The goal is not to promise an unhackable app. The goal is to make attacks fail early, become slower, noisier, more expensive, and lower impact. Sensitive actions now have one central policy shape and every deny, challenge, throttle, or containment decision can produce a security event.

## How decisions are made

The engine builds or receives a security context, resolves the action policy, computes risk, then returns one of:

- `ALLOW`
- `ALLOW_WITH_AUDIT`
- `CHALLENGE`
- `THROTTLE`
- `DENY`
- `CONTAIN`

Every decision includes action, reason, risk score, sensitivity, required controls, audit event, and containment actions.

## How risk scoring works

Risk considers device trust, CSRF proof, freshness, request velocity, failed attempts, previous security events, payload risk, and action sensitivity. Thresholds are conservative and deterministic in tests.

## How sensitive routes are protected

Existing route controls remain valid approved equivalents: auth shield, sensitive action middleware, resource authorization, CSRF validation, distributed rate limits, and explicit `requireSecurityDecision` middleware. The `security:routes` script scans for naked sensitive routes.

## How to add a new sensitive action

1. Add the action to `server/security/sensitiveActionRegistry.js`.
2. Define sensitivity, auth/fresh-auth requirements, tenant or owner checks, audit requirement, rate limit policy, max risk, and containment policy.
3. Add `requireSecurityDecision("<action>")` or an approved equivalent to the route.
4. Add a focused test for allow, challenge/deny, and audit behavior.
5. Run `npm run security:routes` and `npm run security:friction`.

## How to verify

Run:

```sh
npm test -- --runInBand
npm run lint
npm run build
npm run security:secrets
npm run security:deps
npm run security:routes
npm run security:auth
npm run security:friction
git diff --check
```
