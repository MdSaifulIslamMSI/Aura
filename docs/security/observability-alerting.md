# Observability Alerting

Traffic fortress alert sources:

- Request rate, 429 rate, 401/403 spike, 5xx spike.
- p95/p99 latency.
- Upload blocks.
- OTP/recovery spikes.
- AI cost/proxy errors.
- Payment provider failure spike.
- DB connection pressure and query duration.
- Redis errors.
- Queue depth.
- WAF/CDN block rate.

Use free/open-source alerting first: Prometheus, Alertmanager, Grafana, Loki-compatible logs, OpenTelemetry, and Uptime Kuma.
