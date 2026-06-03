# Traffic Observability And Alerting

Metrics added or required:

- `aura_traffic_budget_denied_total`
- `aura_traffic_abuse_events_total`
- `aura_traffic_load_shedding_state`
- `aura_traffic_circuit_breaker_state`
- `aura_traffic_queue_depth`
- HTTP request rate, p95/p99 latency, 4xx/5xx, 429, 401/403 spikes.
- Upload blocks, OTP/recovery spikes, AI cost spikes, payment failure spikes.
- DB connection pressure, Redis errors, queue depth, CDN 4xx/5xx.

No paid monitoring is required. Prometheus, Grafana, Alertmanager, Loki-compatible logs, OpenTelemetry, Sentry/GlitchTip, or Uptime Kuma can consume these signals.
