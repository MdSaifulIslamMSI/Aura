# PQC Lab

This lab is for OpenSSL 3.5+ and OQS compatibility experiments. It is intentionally isolated from production.

Rules:

- Do not replace system OpenSSL.
- Do not deploy OQS Provider or liboqs directly to production.
- Do not commit generated private keys, certificates, CSRs, or provider build artifacts.
- Prefer native OpenSSL 3.5+ standardized PQ algorithms where available.
- Destroy temp lab material after every smoke run.

Smoke command:

```sh
node scripts/security/pqc-lab-smoke.mjs --json --markdown
```
