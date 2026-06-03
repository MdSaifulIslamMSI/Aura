# Safe Traffic Simulation

`scripts/security/safe-traffic-simulation.mjs` is dry-run by default.

Allowed safe profiles:

- `baseline`
- `search-scrape`
- `mixed-bot`
- `status-survival`

Refused profiles by default:

- `login-abuse`
- `otp-abuse`
- `upload-abuse`
- `ai-abuse`
- `payment-abuse`

Rules:

- No production URL is used unless `TRAFFIC_SIMULATION_ALLOW_PRODUCTION_READONLY=yes` and the profile is read-only.
- No payment, refund, OTP/email, malware upload, bypass, or third-party target calls are performed.
- Reports store only route labels, method labels, and expected outcomes.
- Default runs send zero network requests.
