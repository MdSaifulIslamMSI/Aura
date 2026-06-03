# OpenSSL 3.5 / OQS Lab Results

Aura prefers OpenSSL 3.5+ native standardized PQ algorithms for lab proof when the local or container toolchain supports them. OQS Provider and liboqs remain compatibility experiments only and must not be pushed into production without explicit staging evidence and rollback approval.

## Current Evidence Command

```sh
node scripts/security/pqc-lab-smoke.mjs --json --markdown
```

The lab smoke captures:

- Node OpenSSL version.
- System OpenSSL version when available.
- KEM algorithm listing support.
- ML-KEM, ML-DSA, and SLH-DSA presence when exposed by the local OpenSSL build.
- Temp-directory-only sample generation when supported.
- Cleanup confirmation by checking that lab key/cert artifacts are not committed.

## Interpretation

- `pass` means the repo-owned lab evidence exists and no generated key/cert files are committed.
- `warning` means the local machine or CI runner lacks a PQ-capable OpenSSL surface.
- A warning is expected on many developer machines and does not justify weakening CI, TLS, or secret scanning gates.

## Production Rule

Do not replace system OpenSSL and do not deploy OQS/liboqs TLS to production from this lab. Use staging evidence, change approval, rollback testing, and provider/browser compatibility review first.
