# Traffic Resilience Production Rollout

## Preflight

- Run `npm run traffic:fortress:gate`.
- Run `npm run security:pqc:real-target` with disabled/default mode.
- Verify Cloudflare/CDN proxy and origin allowlist in dashboard.
- Confirm Prometheus/Grafana/Alertmanager scrape and alert routing.

## Rollout

1. Deploy app-layer controls with attack mode off.
2. Enable provider/CDN/WAF detection mode.
3. Watch 429, 403, 5xx, latency, DB, Redis, queue, provider, and cost metrics.
4. Tune false positives in staging.
5. Move WAF rules to blocking only after approval.

## Rollback

- `ATTACK_MODE=false`
- `TRAFFIC_BUDGET_LIMITS_ENABLED=false`
- `ABUSE_SHIELD_BLOCKING_ENABLED=false`
- Return WAF to detection mode.
- Revert CDN/dashboard changes through provider change control.
