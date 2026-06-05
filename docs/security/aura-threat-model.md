# Aura Security Fabric Threat Model

## Assets

- User accounts, sessions, MFA factors, trusted devices, and admin privileges.
- Tenant-scoped resources and private user data.
- Payment intents, refunds, webhook events, and payout state.
- Uploaded media, AI requests, AI tool actions, and generated media.
- Security configuration, audit exports, status incidents, secrets, and CI/CD evidence.

## Trust Boundaries

- Browser, mobile, and desktop clients to API.
- API to Firebase/Auth and browser session services.
- API to payment providers through signed webhooks.
- API to upload, AI, and data export services.
- Admin users to privileged admin routes.

## Key Threats

- Stolen bearer token or browser session.
- Stale admin session used for destructive action.
- Cross-tenant resource access.
- Refund, payout, or webhook abuse.
- AI tool action causing unauthorized mutation.
- Upload abuse through oversized or risky media.
- Secret leakage through logs.
- Security config change without fresh assurance.
- Incident response delayed by missing telemetry.

## Controls

- Action sensitivity registry with required controls.
- Deterministic risk scoring for auth, tenant, MFA, trusted-device, payload, payment, upload, AI, and incident signals.
- Audit-only logging by default.
- Explicit enforcement flags for blocking.
- Redaction of secret-bearing fields.
- Tenant guard for resource isolation.
- Incident mode for repeated critical decisions.

## Residual Risk

- Enforcement is only as complete as route coverage and resource context.
- Public AI access remains governed by existing route flags unless fabric enforcement is enabled.
- Webhook trust still depends on existing provider signature verification.
- Step-up UX depends on existing MFA/passkey flows.
