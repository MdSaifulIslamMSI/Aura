# PQC Production Runbook

Use this checklist for production hardening and rollout planning. Do not deploy experimental OQS/liboqs TLS directly to production without staging evidence and rollback approval.

This runbook does not claim complete end-to-end PQC. Provider, browser/WebPKI, payment, email, hosted database, app-store, AI provider, and SDK cryptography remain ecosystem-dependent.

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
npm run security:pqc:proof
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
- Re-run `npm run security:pqc` and `npm run security:pqc:proof` after rollback.

## H. Deployment Proof Links

- Controlled-surface matrix: `docs/security/pqc-controlled-surface-matrix.md`
- SSH hardening: `docs/security/pqc-ssh-hardening.md`
- TLS edge readiness: `docs/security/pqc-tls-edge-readiness.md`
- OpenSSL/OQS lab: `docs/security/pqc-openssl-oqs-lab-results.md`
- Internal services: `docs/security/internal-service-encryption-readiness.md`
- Backup key-agility: `docs/security/pqc-backup-key-agility.md`
- Release signing: `docs/security/pqc-release-signing-readiness.md`
- Provider limitations: `docs/security/pqc-provider-dependency-register.md`

## I. Application-Layer Runtime PQC Rollout

This section covers the opt-in runtime layer in `server/security/pqc/`. It does not change edge TLS, provider cryptography, or JWT/payment signing. Those remain tracked separately.

### I.1 Preflight

- Confirm the runtime is Node.js 24.7+ with OpenSSL 3.5+. Capability is probed, not inferred from the major version.
- Run the default-safe gate before changing any environment variable:

```sh
npm run security:pqc:runtime:strict
npm run security:pqc:cbom:strict
npm --prefix server test -- --runTestsByPath tests/pqcPrimitives.test.js tests/fieldEncryptionPqc.test.js tests/securityEventLedgerPqc.test.js tests/tlsPostureProbe.test.js --forceExit
```

- Confirm the target secret store can hold an SSM SecureString or a mounted 0600 file.
- Keep a rollback window and the previous deployment configuration.

### I.2 Generate and store keys

```sh
# Field-encryption KEM key: 3,647 bytes compact
npm run security:pqc:keygen -- --type hybrid-kem --compact \
  --out ./secrets/field-kem.json --public-out ./config/public/field-kem.pub.json

# Ledger signing key: 5,787 bytes compact
npm run security:pqc:keygen -- --type hybrid-signature --compact \
  --out ./secrets/ledger-signing.json --public-out ./config/public/ledger-signing.pub.json

# Offline checkpoint anchor: 369 bytes
npm run security:pqc:keygen -- --type slh-dsa --out ./secrets/checkpoint-slh.json
```

`--compact` omits the public keys from the stored record. The registry derives them from the private keys and rejects any mismatch, so validation is unchanged. This is required for SSM: the full hybrid-signature record is 8,460 bytes, above the 8,192-byte Advanced limit, while the compact record is 5,787 bytes.

SSM SecureString limits are measured in UTF-8 bytes, not characters:

| Record | Full | Compact | Standard (4,096) | Advanced (8,192) |
| --- | ---: | ---: | --- | --- |
| hybrid-kem | 5,296 | 3,647 | compact only | yes |
| hybrid-signature | 8,460 | 5,787 | no | yes |
| slh-dsa | 369 | — | yes | yes |

- Never commit the private record. On POSIX the generator writes it as `0600`.
- Store the private record in SSM SecureString or an equivalent operator-controlled secret store. Use `--tier Advanced` for the ledger signing key; the KEM key fits `Standard`.
- Record only the returned `keyId` and algorithm in change tickets. Do not paste key material into tickets, chat, or logs.
- Publish the public record only through the channel that distributes keys to the services that must verify or encrypt.

Example SSM write with compact records:

```sh
aws ssm put-parameter --region "$AWS_REGION" \
  --name /aura/staging-pqc/field-encryption-kem-key \
  --type SecureString --tier Standard \
  --value "file://./secrets/field-kem.json" --overwrite

aws ssm put-parameter --region "$AWS_REGION" \
  --name /aura/staging-pqc/security-ledger-signing-key \
  --type SecureString --tier Advanced \
  --value "file://./secrets/ledger-signing.json" --overwrite
```

Then reference the parameters from the service configuration:

```sh
FIELD_ENCRYPTION_PQC_KEM_KEY_REF=ssm:/aura/staging-pqc/field-encryption-kem-key
SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF=ssm:/aura/staging-pqc/security-ledger-signing-key
```

Keep key records in a **sibling** hierarchy of the runtime parameter prefix (for example `/aura/staging-pqc` next to `/aura/staging`). `infra/aws/render-runtime-secrets.sh` copies every parameter under the staging prefix into `runtime-secrets.env`; a private key record must never be materialized there. `GetParametersByPath` is hierarchy-based, so a sibling path is not returned.

### I.2b Staging activation

Field encryption under `NODE_ENV=production` requires a KMS key. Create a dedicated staging key once (or reuse an approved staging key):

```sh
aws kms create-key --description "aura staging field encryption" \
  --tags TagKey=Environment,TagValue=staging
aws kms create-alias --alias-name alias/aura-staging-field-encryption \
  --target-key-id <key-id-from-previous-command>
```

Key creation requires `kms:CreateKey` and `kms:CreateAlias`. The activation step requires `ssm:PutParameter` on the staging prefix plus `kms:DescribeKey` and `kms:GenerateDataKey` on the selected key. The bootstrap operator role created by `00-create-iam-auth.sh` has the SSM write grant but no KMS grant, so run the key creation and `03d` with credentials that include those KMS actions, or attach the equivalent policy statement first.

`scripts/staging/03d-put-pqc-ssm-params.sh` then provisions everything the runtime needs, retaining existing values on re-runs:

- compact hybrid KEM and hybrid signing keys in `/aura/staging-pqc`;
- `SECURITY_EVENT_LEDGER_SECRET` as a generated SecureString;
- `FIELD_ENCRYPTION_WRAPPED_DEK`, produced with KMS `GenerateDataKey` and stored as a SecureString, so the read-only instance role never needs `ssm:PutParameter` to boot;
- `FIELD_ENCRYPTION_ENABLED=true` and `SECURITY_EVENT_LEDGER_ENABLED=true`, because a PQC mode is inert while its feature flag is off;
- the PQC mode and `ssm:` key-reference parameters under `/aura/staging`.

```sh
AWS_REGION=... STAGING_SSM_PREFIX=/aura/staging \
FIELD_ENCRYPTION_KMS_KEY_ID=alias/aura-staging-field-encryption \
  bash scripts/staging/03d-put-pqc-ssm-params.sh
```

Defaults are `PQC_FIELD_MODE=per-record` and `PQC_LEDGER_MODE=require`. The script refuses field activation without a KMS key. Override the modes explicitly when doing a softer canary:

```sh
PQC_FIELD_MODE=auto PQC_LEDGER_MODE=auto bash scripts/staging/03d-put-pqc-ssm-params.sh
```

`scripts/staging/07-deploy-compose.sh` forwards the PQC modes, key references, feature flags, KMS key ID, and ledger secret into `.env.staging` when they exist. An unconfigured staging deployment imports nothing and keeps the classical default. After deployment, run the hard-mode gate against the deployed configuration:

```sh
npm run security:pqc:runtime:strict
npm --prefix server test -- --runTestsByPath tests/fieldEncryptionPqc.test.js tests/securityEventLedgerPqc.test.js --forceExit
```

Confirm the startup logs show `field_encryption.pqc_primed` with `effectiveMode=per-record` and `security_ledger.pqc_primed` with `effectiveMode=sign`, and that new field records start with `pqc1.`. If either is absent, do not treat the rollout as active.

#### Backfill existing plaintext

Enabling field encryption changes new writes only. Existing rows stay readable through dual-read, but they remain plaintext until rewritten. After the startup checks pass, run the backfill on the staging host with the runtime environment (or locally with equivalent KMS/SSM credentials):

```sh
# Count work first. This performs no writes.
MONGO_URI=... AWS_REGION=... AWS_PARAMETER_STORE_PATH_PREFIX=/aura/staging \
FIELD_ENCRYPTION_ENABLED=true \
FIELD_ENCRYPTION_KMS_KEY_ID=alias/aura-staging-field-encryption \
FIELD_ENCRYPTION_PQC_MODE=per-record \
FIELD_ENCRYPTION_PQC_KEM_KEY_REF=ssm:/aura/staging-pqc/field-encryption-kem-key \
  node server/scripts/backfill-field-encryption.js --dry-run

# Apply the same command without --dry-run after reviewing the counts.
```

The backfill is idempotent: it skips values that `fieldEncryptionService.isEncrypted()` recognizes, which covers classical `v1.`, PQC `pqc1.`, and key-wrap `v2.kw.` records. Re-running cannot double-encrypt a field. It also computes missing blind indexes from plaintext before encryption, so equality lookups keep working.

### I.3 Staged field-encryption rollout

1. **Observe-only**: set `FIELD_ENCRYPTION_PQC_MODE=off` with `FIELD_ENCRYPTION_PQC_KEM_KEY_REF` set. New writes stay classical v1; existing PQ records can be decrypted. Verify the service starts and health/status shows the key loaded in decrypt-only mode.
2. **Canary writes**: set `FIELD_ENCRYPTION_PQC_MODE=auto` with the same key reference. When PQ is available this becomes effective `per-record`; when it is not, writes stay classical v1. Verify a canary record starts with `pqc1.` and decrypts.
3. **Explicit envelope**: choose `key-wrap` when you need the per-process DEK embedded in each record, or `per-record` for a fresh encapsulation per record.
4. **Hard requirement**: move to `require` only after the canary window and a tested restore/read path. `require` fails startup if PQ or key material is unavailable.
5. Keep `FIELD_ENCRYPTION_PQC_KEM_PREVIOUS_KEY_REFS` populated during every rotation so old records remain readable.

### I.4 Ledger rollout

1. Set `SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF` and start with `SECURITY_EVENT_LEDGER_PQC_MODE=auto`.
2. Confirm new records carry `pqcSignature`, `pqcKeyId`, and `pqcAlgorithm`, and that verification still passes for the HMAC chain.
3. Move to `SECURITY_EVENT_LEDGER_PQC_MODE=require` after the signing key and monitoring are stable. Unsigned appends are then blocked instead of silently downgraded.
4. Set `SECURITY_EVENT_LEDGER_PQC_REQUIRED_FROM_SEQ` to the first sequence that must be signed. Do not set it ahead of records you have not verified.
5. Keep previous signing keys listed during rotation.

### I.5 Rotation

1. Generate the replacement key with the same type.
2. Add the old reference to the previous-reference variable and deploy the new current reference.
3. Verify `previousKeys` is non-zero and old records/signatures still verify.
4. Re-encrypt or age out old records.
5. Remove the previous reference only after the old key is no longer needed.

### I.6 Rollback

- Field encryption: set `FIELD_ENCRYPTION_PQC_MODE=off`, but **retain the key reference** until existing `pqc1.` / `v2.kw.` records are re-encrypted or retired. Removing the key makes those records unreadable.
- Ledger: set `SECURITY_EVENT_LEDGER_PQC_MODE=off`, but retain the key reference for verification. The HMAC chain remains the baseline integrity control.
- Do not delete private keys during an incident. Revoke only after the affected data is migrated.
- Do not relax policy checks or allowlists to make a rollback pass.

### I.7 Failure modes

| Symptom | Meaning | Action |
| --- | --- | --- |
| `field_encryption.pqc_unavailable` at startup with `auto` | Native ML-KEM or the key reference is unavailable | Fix Node/OpenSSL or the key reference; writes remain classical v1 until fixed. |
| Startup failure with `key-wrap`, `per-record`, or `require` | Hard mode cannot load PQ capability or key material | Restore capability/key material or roll back the mode explicitly. |
| `security_ledger.pqc_signing_blocked` | `require` mode could not sign | Fix the key or roll back to `auto` with an incident record. |
| Old records unreadable after a change | Previous key reference was removed too early | Restore the old key reference and re-run verification. |
| `keyId does not match` | Key record corruption or a swapped public key | Regenerate/restore the correct record; do not bypass the check. |

### I.8 CBOM and evidence

Generate the CycloneDX 1.6 CBOM:

```sh
npm run security:pqc:cbom:strict
```

Artifacts:

- `reports/security/cbom.json`
- `reports/security/cbom.md`
- `reports/security/pqc-runtime-status.json`
- `reports/security/pqc-runtime-status.md`

The CI job `pqc-runtime` in `.github/workflows/post-quantum-security.yml` runs the runtime tests, default-safe status, a generated-key hard-mode check, and the CBOM gate.
