# Internal Service Darkening

Internal services must not be exposed directly to the public internet.

## Do Not Publicly Expose

- MongoDB or PostgreSQL
- Redis
- Object storage admin consoles
- Queue dashboards
- Grafana, Prometheus, Kibana
- Adminer or phpMyAdmin
- Docker daemon
- SSH outside approved network policy
- Internal health dashboards
- Debug endpoints
- Preview-only tools

## Check

Run:

```sh
npm run security:internal-exposure
```

The script performs high-confidence config checks and writes `reports/security/internal-exposure-check.json`.

## Rollback

Remove public listeners or firewall them behind private networking, VPN, SSO, or provider-native private endpoints. Do not use application cloaking as the only control for databases, cache, queues, or admin consoles.
