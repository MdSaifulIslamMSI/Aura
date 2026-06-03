# Security Maturity Scorecard

`npm run security:maturity` combines:

- PQC readiness.
- Controllable-surface PQC proof.
- Full end-to-end PQC cap.
- Route security.
- Rate-limit coverage.
- Traffic-resilience proof.
- Observability readiness.
- Incident readiness.
- Provider dependency risk.

The score is an evidence and maturity estimate, not a security guarantee.

Strict verification:

```sh
npm run security:maturity:strict
npm run traffic:fortress:gate
```

Known caps:

- Full end-to-end PQC remains capped by browser, WebPKI, provider, app-store, hosted database, AI provider, and third-party SDK migration.
- Traffic resilience remains capped by CDN/WAF/provider capacity and origin lockdown.
