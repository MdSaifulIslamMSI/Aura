# DDoS And Bot Abuse Runbook

## DDoS Mode

- Detection: edge 4xx/5xx spike, elevated request rate, origin CPU/memory pressure.
- Immediate containment: enable provider DDoS/WAF rules, verify origin allowlist, enable attack mode.
- Safe toggles: `ATTACK_MODE=true`, `ATTACK_MODE_PUBLIC_READ_ONLY=true`, `ATTACK_MODE_BLOCK_AI=true`, `ATTACK_MODE_BLOCK_UPLOADS=true`.
- Rollback: disable attack mode after traffic normalizes and cache/provider rules are reviewed.
- Evidence: request rate, blocked rate, edge logs, origin logs, cache hit ratio, top routes.
- Postmortem: origin exposure, WAF false positives, cost impact, route budgets.

## Bot Login Abuse Mode

- Detection: login failures, 401/403 spikes, abuse score events.
- Containment: strict auth mode, Turnstile checks, temporary denylist if needed.
- Communication: tell users login protection is elevated.

## OTP/Email Abuse Mode

- Detection: OTP send/failure spike or email provider errors.
- Containment: disable OTP send when needed, keep existing sessions alive.

## Upload Storm Mode

- Detection: upload blocks, scanner pressure, body-size denials.
- Containment: block uploads in attack mode, keep public reads and status online.

## Payment/Refund Abuse Mode

- Detection: payment failure/refund spike, provider errors.
- Containment: disable payment writes, keep webhooks verified and idempotent.

## AI Cost Spike Mode

- Detection: AI route budget denials or provider spend spike.
- Containment: block AI first; keep support/status paths available.

## Database Overload Mode

- Detection: DB latency, connection pressure, query timeout.
- Containment: shed search/catalog heavy routes, serve cached public data.

## Provider Outage Mode

- Detection: provider failure rate or circuit-open state.
- Containment: open provider circuit, show safe degraded errors, avoid infinite retries.
