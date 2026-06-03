# Traffic Resilience Architecture

Target architecture:

`Internet -> CDN/DDoS/cache/TLS -> WAF -> behavior blocking -> origin allowlist -> reverse proxy -> Express API -> Redis budgets -> MongoDB budgets -> queues -> observability`

## Origin Rules

- Origin must not be directly attackable.
- Direct origin exposure is a critical failure.
- Forwarded headers are meaningful only behind the trusted edge path.
- Provider/CDN dashboard changes require production approval.

## App Rules

- Classify requests early.
- Reject oversized bodies before JSON parsing where content length is known.
- Apply per-class timeouts.
- Fail closed for sensitive routes when Redis enforcement is unavailable in production.
- Shed expensive non-critical routes before health/status/webhook/admin-emergency paths.
