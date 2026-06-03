# Internal Service Encryption Readiness

This runbook covers MongoDB TLS readiness, Redis TLS/private-network readiness, and service-to-service encryption without opening live database or cache connections.

## Required Environment Names

- `DATABASE_URL`
- `MONGO_URI`
- `REDIS_URL`

The checker redacts connection shapes and must never print raw connection strings.

## MongoDB TLS Readiness

- Prefer provider-managed TLS for hosted MongoDB.
- Use TLS parameters or provider SRV records where the deployment requires them.
- Validate certificate trust in staging before production rollout.
- Rotate MongoDB credentials alongside certificate or provider endpoint changes.

## Redis TLS And Private Network Readiness

- Prefer `rediss://` for production Redis where supported.
- If TLS is unavailable inside a private network, document network isolation, ACLs, and credential rotation.
- Do not expose Redis over a public network.

## Service-To-Service TLS

- Same-host dev containers may use plain loopback/private Docker networks.
- Cross-host or public-network service traffic should use TLS or a provider-managed private link.
- Edge-to-origin TLS remains tracked in `docs/security/pqc-tls-edge-readiness.md`.

## Verification

```sh
node scripts/security/internal-service-encryption-check.mjs --json --markdown
```

Optional staging evidence:

```sh
PQC_INTERNAL_EVIDENCE_MODE=staging node scripts/security/internal-service-encryption-check.mjs --json --markdown
```

The optional evidence report records only redacted URI schemes and setting presence. It does not open MongoDB or Redis sockets and must not print raw `DATABASE_URL`, `MONGO_URI`, or `REDIS_URL` values.

## Rollout Checklist

1. Validate staging env separation.
2. Confirm MongoDB TLS/provider setting.
3. Confirm Redis TLS or private-network isolation.
4. Rotate service credentials.
5. Confirm logs do not include connection strings.
6. Re-run the aggregate PQC proof.

## Rollback

Restore the previous provider endpoint or private-network route, rotate any exposed credential, and keep auth/route/security scanners active.
