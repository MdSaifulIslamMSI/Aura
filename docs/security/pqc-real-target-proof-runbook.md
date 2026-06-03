# PQC Real Target Proof Runbook

`npm run security:pqc:real-target` writes disabled/skipped reports by default.

Modes:

- `PQC_REAL_TARGET_PROOF_MODE=disabled`
- `PQC_REAL_TARGET_PROOF_MODE=local`
- `PQC_REAL_TARGET_PROOF_MODE=staging`
- `PQC_REAL_TARGET_PROOF_MODE=production-readonly`

Inputs are aliases for existing proof scripts:

- `PQC_SSH_TARGET_HOST`, `PQC_SSH_TARGET_PORT`, `PQC_SSH_TARGET_USER`, `PQC_SSH_EXPECTED_KEX`
- `PQC_TLS_TARGET_URL`, `PQC_TLS_EXPECT_TLS13=true`
- `PQC_INTERNAL_SERVICE_PROOF_MODE`, `EXPECT_MONGODB_TLS`, `EXPECT_REDIS_TLS_OR_PRIVATE`
- `PQC_BACKUP_PROOF_MODE`, `BACKUP_DRY_RUN_EVIDENCE_PATH`, `RESTORE_DRY_RUN_EVIDENCE_PATH`

Rules:

- Default mode is disabled.
- Production mode is read-only only.
- No DNS, CDN, server, database, backup, or provider config is mutated.
- Hostnames and connection shapes are redacted.
- No private keys, certs, headers, cookies, tokens, or raw connection strings are written.
