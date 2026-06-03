# TLS 1.3 And Hybrid-PQC Edge Readiness

TLS 1.3 hardening is production-ready for Aura-controlled edge configurations today. Browser/WebPKI hybrid PQC support is provider and ecosystem dependent, so Aura should stage hybrid experiments without forcing OQS/liboqs into production.

## Production-Ready Controls

- Require TLS 1.3 where Aura directly terminates TLS.
- Avoid legacy protocol versions and known weak ciphers.
- Use HSTS after domain ownership and rollback paths are confirmed.
- Keep certificate private keys short-lived and rotatable.
- Keep provider-managed certificates documented in the provider dependency register.

## Lab/Staging Only

- OQS Provider experiments.
- liboqs proxy experiments.
- PQ certificate chains not accepted by mainstream browser/WebPKI clients.
- Any custom app-level protocol wrapper.

## Verification

```sh
node scripts/security/tls-config-readiness.mjs --json --markdown
node scripts/security/tls-endpoint-pqc-readiness.mjs --json --markdown
npm run security:pqc:proof
```

The checker fails repo-owned TLS examples that enable legacy protocol tokens or omit a TLS 1.3 minimum where the config terminates TLS. Plain internal HTTP templates are recorded as not TLS-terminating because they are expected to sit behind an edge or private-network control.

Set `PQC_TLS_TARGET_URL` only for an explicitly approved read-only staging or production endpoint probe. The endpoint report validates negotiated TLS version, legacy protocol rejection, certificate metadata, and HSTS header presence without storing certificate bodies or response bodies. It does not prove browser/WebPKI PQC support.

## Rollback

1. Restore the previous edge config.
2. Keep stable TLS 1.3 enabled.
3. Remove only the experimental hybrid/OQS setting that caused the regression.
4. Re-run the TLS checker and the aggregate PQC proof.
