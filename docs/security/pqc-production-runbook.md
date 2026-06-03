# PQC Production Runbook

Use this checklist for production hardening and rollout planning. Do not deploy experimental OQS/liboqs TLS directly to production without staging evidence and rollback approval.

## A. Server SSH Hardening

- Install or upgrade to OpenSSH 10+ where supported.
- Verify supported hybrid key exchange:

```sh
ssh -Q kex | grep -E "mlkem|sntrup"
```

- Prefer:
  - `mlkem768x25519-sha256`
  - `sntrup761x25519-sha512`
- Disable root login.
- Disable password login.
- Use hardware or security keys where possible.
- Keep emergency rollback console access.

## B. TLS Hardening

- Use TLS 1.3 minimum where compatible.
- Disable TLS 1.0 and 1.1.
- Disable weak ciphers.
- Enable HSTS after domain ownership and rollback paths are confirmed.
- Rotate certificates.
- Keep origin certificate private keys short-lived and rotatable.

## C. Nginx Example

Do not force this into production automatically. Apply only after staging validation.

```nginx
ssl_protocols TLSv1.3;
ssl_prefer_server_ciphers off;
ssl_session_timeout 1d;
ssl_session_cache shared:TLS:10m;
ssl_session_tickets off;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

## D. Caddy Example

Do not force this into production automatically. Apply only after staging validation.

```caddyfile
example.com {
  tls {
    protocols tls1.3
  }
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
  }
  reverse_proxy localhost:5000
}
```

## E. Internal Service Encryption

- Prefer TLS for MongoDB and Redis if production architecture supports it.
- Rotate credentials.
- Avoid long-lived static secrets.
- Use sops, age, or Step CA only where appropriate and documented.

## F. Verification Commands

```sh
npm run security:pqc
ssh -Q kex
openssl version -a
openssl list -kem-algorithms
semgrep scan --config security/semgrep/pqc-crypto-policy.yml
trivy fs .
osv-scanner -r .
gitleaks detect
```

`openssl list -kem-algorithms` is available only when the local OpenSSL/provider stack exposes KEM algorithms.

## G. Rollback

- Revert proxy config.
- Keep TLS 1.3 classical secure fallback.
- Do not roll back CI policy unless a false positive is documented with owner, reason, and expiry.
- Re-run `npm run security:pqc` after rollback.

