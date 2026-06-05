# Trust Risk Scoring

The first Trust Fabric risk engine is deterministic. It does not use AI for enforcement.

Risk levels:

- `0-29`: low
- `30-59`: medium
- `60-79`: high
- `80-100`: critical

Current factors include:

- Sensitive action.
- Unknown device.
- Missing trusted session.
- New or unusual IP.
- Actor or IP route velocity.
- Repeated ownership mismatch.
- Repeated auth, OTP, or passkey failures when supplied as signals.
- High-value refund/payment/admin action.
- Admin sensitive action velocity.
- Sensitive action without fresh step-up.
- Suspicious user-agent.
- Endpoint under abuse.
- Many object IDs touched in a short window.
- Payment webhook replay.
- Upload failure velocity.
- AI endpoint velocity.
- Degraded system health on risky writes.

Redis is used when configured through the existing Redis client. Tests and local development safely fall back to in-memory counters. Production enforcement should not rely on memory-only signals across multiple instances.
