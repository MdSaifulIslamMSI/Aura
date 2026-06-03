# Add PQC Deployment Proof For Controllable Surfaces

## Summary

Adds a rollback-safe PQC deployment-proof campaign for Aura-controlled surfaces without claiming complete end-to-end PQC. The branch adds matrix evidence, checkers, lab proof, CI artifact generation, and docs for provider limitations.

## Controlled Surfaces Covered

- SSH admin access.
- TLS 1.3 edge readiness.
- OpenSSL 3.5+/OQS lab-only proof.
- Internal service encryption readiness.
- Backup key-agility.
- Release signing readiness.
- Provider dependency limitations.

## Scripts Added

- `scripts/security/pqc-deployment-proof.mjs`
- `scripts/security/check-ssh-pqc-readiness.mjs`
- `scripts/security/tls-config-readiness.mjs`
- `scripts/security/pqc-lab-smoke.mjs`
- `scripts/security/internal-service-encryption-check.mjs`
- `scripts/security/backup-crypto-agility-check.mjs`

## Reports Generated

- `reports/security/pqc-deployment-proof.json`
- `reports/security/ssh-pqc-readiness.json`
- `reports/security/tls-config-readiness.json`
- `reports/security/pqc-lab-smoke.json`
- `reports/security/internal-service-encryption-check.json`
- `reports/security/backup-crypto-agility-check.json`

Markdown companions are generated for each report.

## Local Verification

- `npm run security:pqc:proof`
- `npm run security:pqc:proof:strict`
- `npm --prefix server test -- --runTestsByPath tests/pqcDeploymentProof.test.js tests/sshPqcReadiness.test.js tests/tlsConfigReadiness.test.js tests/backupCryptoAgility.test.js tests/internalServiceEncryptionReadiness.test.js tests/pqcConfig.test.js tests/cryptoPolicyConfig.test.js --forceExit`
- `npm run security:pqc`
- `npm run security:routes:coverage:strict`
- `npm run security:free-stack`
- `npm run security:admin`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run security:secrets`
- `git diff --check`

Broader standalone `npm --prefix app test` and `npm --prefix server test -- --forceExit` sweeps were attempted locally after the passing focused/root checks, but hit local Node/Vitest heap exhaustion rather than assertion failures. CI should remain the source of truth for runner-sized all-suite coverage.

## CI Expectations

CI should fail for repo-owned missing evidence/config/script gaps. Missing local OpenSSH/OpenSSL PQC support remains a warning because runner images vary.

## Production Rollout Checklist

1. Keep stable TLS 1.3 as the production baseline.
2. Stage SSH hybrid KEX only on hosts with supported OpenSSH.
3. Keep OQS Provider and liboqs lab/staging only.
4. Validate internal service encryption in staging without logging connection strings.
5. Validate backup restore dry runs and key rotation.
6. Track provider PQC support before claiming end-to-end PQC.

## Provider Limitations

Aura cannot directly control browser/WebPKI, Firebase, Stripe, Razorpay, Resend, hosted databases, AI providers, mobile app stores, or third-party SDK cryptography.

## Remaining Limitations

No system is 100% quantum-proof. Full end-to-end PQC is ecosystem-dependent. Hybrid migration remains safer than replacing stable production crypto in one jump.
