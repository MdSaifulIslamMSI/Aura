# Abuse And Fraud Detection Policy

Last updated: 2026-05-25

Application abuse must be detected at the behavior layer, not only by WAF and bot rules.

## Signals

| Abuse Case | Detection Signal | Response |
|---|---|---|
| Account takeover | Impossible travel, new device, MFA failures, session churn | Step-up auth, revoke sessions, notify user |
| Password spraying | Many accounts failed from one IP/device | IP/device throttle, edge block |
| Credential stuffing | High failed login velocity across accounts | CAPTCHA/Turnstile, rate limit, alert |
| Signup abuse | High signup velocity, disposable domains, repeated device | Cooldown, verification, manual review |
| OTP abuse | Repeated resend/verify attempts | Per-account/IP throttle, temporary lock |
| Webhook replay | Duplicate event ID or stale timestamp | Reject event, alert provider/security |
| Refund/payment abuse | Unusual refund velocity or state transitions | Admin step-up, manual review |

## Required Events

- `auth.login.failed`
- `auth.impossible_travel.detected`
- `auth.password_spraying.detected`
- `signup.abuse_detected`
- `otp.rate_limit.triggered`
- `webhook.replay_detected`
- `payment.abuse_review_required`

## Definition Of Done

- Abuse detections have alert thresholds.
- Alerts map to playbooks.
- Rate limits are per-IP, per-account, and per-user where applicable.
- False positives are reviewed and tuned after incidents.
