# Post-Quantum Cybersecurity Readiness

## 1. Honest Security Statement

No app can be 100% secure. This project targets maximum practical free/open-source post-quantum readiness: standards-aligned hybrid migration, crypto-agility, rollback safety, CI enforcement, and production runbooks.

The project does not implement custom cryptography. Experimental post-quantum work stays in staging or lab mode until there is deliberate approval and evidence.

## 2. Threat Model

- Harvest-now-decrypt-later collection of encrypted traffic.
- Harvest-now-decrypt-later collection of encrypted data at rest, including database dumps and backups.
- Future quantum attacks against RSA and elliptic-curve public-key cryptography.
- Retrospective forgery or alteration of long-lived audit records after a future signature break.
- Long-lived secrets that outlive current classical cryptographic assumptions.
- TLS traffic capture before future key compromise.
- Server administration compromise through weak SSH posture.
- Long-lived JWT, certificate, or signature keys that are difficult to rotate.
- Key-material compromise or operator error during rotation, including removal of a previous key before old ciphertext is retired.

## 3. Current Safe Areas

- Symmetric crypto such as AES-256-GCM and ChaCha20-Poly1305 remains appropriate with sound key management. Grover's algorithm reduces a 256-bit key to roughly 128-bit security, which remains infeasible.
- HMAC-SHA256 token and session integrity likewise retains roughly 128-bit post-quantum security; symmetric MACs do not need a PQ signature replacement. The PQC work targets asymmetric key establishment, asymmetric signatures, and long-lived key material.
- Password hashing with bcrypt, argon2id, or approved scrypt parameters remains appropriate.
- Short-lived tokens reduce blast radius while JWT/WebPKI ecosystems evolve.
- TLS 1.3 hardening is production-ready now.

## 4. Migration Target

- ML-KEM for key encapsulation.
- ML-DSA and SLH-DSA for signatures when ecosystem support is production-ready.
- Hybrid key exchange first, not direct replacement of stable production crypto.
- Config-driven crypto-agility through `config/security/post-quantum-policy.json`.
- Application-layer composition uses only standardized FIPS 203/204/205 primitives, with explicit domain separation and both hybrid components required. No custom primitive is invented; the composition is documented, tested, and versioned on the wire.

## 5. Free Software Stack

- OpenSSL 3.5+
- OpenSSH 10+
- Open Quantum Safe liboqs
- OQS Provider
- Nginx, Caddy, or HAProxy
- Step CA
- Semgrep CE
- CodeQL
- Trivy
- OSV-Scanner
- Gitleaks
- cryptodeps
- Local Node.js scanner scripts

## 6. What Is Production-Ready Now

- OpenSSH 10+ hybrid PQ key exchange where the host platform supports it.
- TLS 1.3 hardening for public and internal service edges.
- Crypto inventory and policy reporting.
- CI policy guardrails for forbidden new crypto.
- Secret scanning and dependency vulnerability scanning.

## 7. What Should Remain Staging/Lab Only

- OQS Provider TLS experiments.
- PQ certificate and private PKI experiments.
- ML-DSA or SLH-DSA application-signing experiments.
- Custom protocol integrations.

## 8. Third-Party Limitations

- Firebase and other auth providers control parts of token and transport cryptography.
- Stripe, Razorpay, and Resend cryptography is partly outside direct project control.
- Browser/WebPKI and JWT ecosystems do not yet provide universal production PQ signatures.
- Hosted databases and SDK internal crypto may remain classical until vendors support hybrid/PQ options.

## 9. Rollback Plan

- All PQC experimental settings must stay behind config.
- Production can fall back to normal TLS 1.3.
- CI scanning stays active during rollback.
- No data migration should depend on experimental PQ keys.
- Rollback proxy or lab configuration without weakening the policy scripts.

## 10. Acceptance Criteria

- Inventory report generated.
- Policy check passes.
- Deployment proof report generated.
- Controlled-surface matrix reviewed.
- No new forbidden crypto.
- Documentation and runbooks are complete.
- Tests pass.
- CI is green.

## 11. Controlled-Surface Deployment Proof

Aura is PQC-ready and crypto-agile, but it is not 100% quantum-proof. Practical deployment proof is limited to surfaces Aura can control directly:

- OpenSSH hybrid KEX readiness where OpenSSH 10+ is available.
- TLS 1.3 hardening at Aura-controlled edge templates.
- OpenSSL 3.5+ / OQS lab evidence without production replacement.
- Internal MongoDB/Redis/service-to-service encryption readiness.
- Backup encryption key-agility and non-destructive restore proof.
- Release artifact signing readiness for future PQ signatures.
- Provider limitation tracking for browser/WebPKI, Firebase, Stripe, Razorpay, Resend, hosted databases, AI providers, app stores, and SDK crypto.
- Maturity scorecard that separates repo-owned proof from provider-dependent full end-to-end coverage.

Primary evidence:

- `docs/security/pqc-controlled-surface-matrix.md`
- `docs/security/pqc-ssh-hardening.md`
- `docs/security/pqc-tls-edge-readiness.md`
- `docs/security/pqc-openssl-oqs-lab-results.md`
- `docs/security/internal-service-encryption-readiness.md`
- `docs/security/pqc-backup-key-agility.md`
- `docs/security/pqc-release-signing-readiness.md`
- `docs/security/pqc-provider-dependency-register.md`
- `docs/security/pqc-maturity-scorecard.md`
- `reports/security/pqc-deployment-proof.json`
- `reports/security/pqc-maturity-scorecard.json`

Run:

```sh
npm run security:pqc:proof
npm run security:pqc:scorecard
```

## 12. Application-Layer Runtime PQC

Aura now has an opt-in application-layer PQC runtime in `server/security/pqc/`. It uses only the standardized primitives shipped by Node.js 24.7+ / OpenSSL 3.5+: FIPS 203 ML-KEM, FIPS 204 ML-DSA, and FIPS 205 SLH-DSA. No new dependency and no custom cryptographic primitive was added.

The runtime is deliberately default-safe. An unconfigured deployment keeps its existing classical behavior. Enabling PQC requires both a mode and key material, so a missing key cannot silently weaken a configured surface.

### 12.1 Constructions

| Purpose | Construction | Standard | Notes |
| --- | --- | --- | --- |
| Field-encryption key encapsulation | X25519 + ML-KEM-768 | FIPS 203, RFC 7748 | Both shared secrets are required and combined with HKDF-SHA256. The transcript (ephemeral public key, ML-KEM ciphertext, recipient public keys) is bound into the KDF salt. |
| Field-encryption payload protection | AES-256-GCM | NIST SP 800-38D | 12-byte IV, 16-byte tag, context-bound AAD. |
| Ledger signatures | Ed25519 + ML-DSA-65 | FIPS 204, RFC 8032 | Both signatures must verify. The existing HMAC chain remains in place. |
| Offline checkpoint signatures | SLH-DSA-SHA2-128s | FIPS 205 | Reserved for long-lived offline anchors. Signing is intentionally slow and is not used on request paths. |

Key IDs are the SHA-256 fingerprint of the public key bundle, truncated to 128 bits. A record whose key ID does not match its public keys is rejected.

### 12.2 Field encryption modes

`FIELD_ENCRYPTION_PQC_MODE` accepts:

| Mode | Behavior | Failure behavior |
| --- | --- | --- |
| `off` (default) | Classical v1 encryption. If a key reference is configured, the key is still loaded for decrypt-only reads of existing PQ records. | No PQ dependency for new writes. |
| `auto` | Uses PQ when native ML-KEM and the key reference are available; otherwise writes classical v1. | Degrades only on unavailable runtime or key material. It never silently downgrades an existing PQ record. |
| `key-wrap` | Each record embeds a PQ-wrapped per-process AES-256-GCM data key. Rotation and restart need no extra secret store. | Fails startup if PQ capability or key material is missing. |
| `per-record` | Each record performs a fresh hybrid encapsulation. | Fails startup if PQ capability or key material is missing. |
| `require` | Same effective behavior as `per-record`, but the configuration is treated as a hard production requirement. | Fails startup if PQ capability or key material is missing. |

Wire formats are self-describing:

- Classical v1: `v1.<keyVersion>.<iv>.<tag>.<ciphertext>`
- Per-record PQ: `pqc1.<keyId>.<epk>.<kemCiphertext>.<iv>.<tag>.<ciphertext>`
- Key-wrap PQ: `v2.kw.<wrappedToken>.<iv>.<tag>.<ciphertext>`

Decryption dispatches on the prefix, so v1 records remain readable while new records use PQ. Rotation loads the current key plus `FIELD_ENCRYPTION_PQC_KEM_PREVIOUS_KEY_REFS` for dual-read.

### 12.3 Security event ledger signatures

The ledger keeps its HMAC-SHA256 chain as the primary integrity control. When enabled, each record also receives `pqcSignature`, `pqcKeyId`, and `pqcAlgorithm`, signing the canonical `{seq, prevHash, hash, payload}` value.

`SECURITY_EVENT_LEDGER_PQC_MODE` accepts `off`, `auto`, and `require`:

- `off`: existing behavior. A configured key reference still loads for verification only.
- `auto`: signs when key material loads; otherwise continues with the HMAC chain.
- `require`: refuses to append an unsigned event. If the key cannot load, the append is blocked rather than silently downgraded.

Verification checks the HMAC chain first, then verifies every present PQ signature. `SECURITY_EVENT_LEDGER_PQC_REQUIRED_FROM_SEQ` can require signatures from a specific sequence onward.

### 12.4 Key management and rotation

The registry accepts `file:`, `ssm:`, `env:`, `base64-json:`, inline JSON, and inline key records. Private-key files must not be group/other readable on POSIX; the registry fails closed if they are. Key material can be rotated by pointing the current reference at a new key and listing old keys in the previous-reference variable. Old ciphertext and old signatures remain verifiable while new writes use the new key.

Generate keys with:

```sh
npm run security:pqc:keygen -- --type hybrid-kem --compact --out ./secrets/field-kem.json --public-out ./config/public/field-kem.pub.json
npm run security:pqc:keygen -- --type hybrid-signature --compact --out ./secrets/ledger-signing.json
npm run security:pqc:keygen -- --type slh-dsa --out ./secrets/checkpoint-slh.json
```

The private record is written with owner-only permissions on POSIX and is never printed. Store it in SSM SecureString or an equivalent operator-controlled secret store; never commit it.

Use `--compact` for SSM: the full hybrid-signature record is 8,460 bytes, above the 8,192-byte Advanced limit, while the compact record is 5,787 bytes. The KEM record is 3,647 bytes compact, which fits the 4,096-byte Standard tier. The loader derives the omitted public keys and rejects any mismatch. Store key records under a sibling hierarchy such as `/aura/staging-pqc`, not under the runtime parameter prefix, so the deploy renderer never copies private JSON into `runtime-secrets.env`.

Staging activation is scripted in `scripts/staging/03d-put-pqc-ssm-params.sh`. It also enables the field-encryption and ledger feature flags, generates the ledger HMAC secret, and pre-creates the KMS-wrapped field-encryption DEK. A PQC mode alone is inert while its feature flag is off, and the production field-encryption contract rejects a local master key, so a KMS key is required.

### 12.5 Verification and CBOM

```sh
npm run security:pqc:runtime:strict
npm run security:pqc:cbom:strict
npm run security:pqc:policy
npm --prefix server test -- --runTestsByPath tests/pqcPrimitives.test.js tests/fieldEncryptionPqc.test.js tests/securityEventLedgerPqc.test.js tests/tlsPostureProbe.test.js --forceExit
```

`security:pqc:runtime:strict` validates native capability, mode values, key references, key loading, rotation references, and performs an ephemeral KEM/signature round-trip. It exits 0 for a default-safe unconfigured deployment and nonzero for an invalid or unloadable hard-mode configuration.

`security:pqc:cbom:strict` emits a CycloneDX 1.6 CBOM to `reports/security/cbom.json` and `reports/security/cbom.md`. It fails if policy identifiers drift from the runtime constants, if required modules are missing, or if the default mode is not `off`.

### 12.6 Default-safe behavior and rollback

- Production defaults remain classical until an operator sets a PQ mode and key reference.
- `auto` is the canary mode: it exercises PQ when available and falls back only when the runtime or key material is absent.
- `key-wrap`, `per-record`, and `require` fail closed.
- To roll back field encryption, set `FIELD_ENCRYPTION_PQC_MODE=off` but retain the key reference until existing PQ records are re-encrypted or retired. Removing the key makes existing PQ records unreadable.
- To roll back ledger signatures, set `SECURITY_EVENT_LEDGER_PQC_MODE=off` but retain the key reference for verification. The HMAC chain remains valid on its own.
- Do not weaken policy checks, allowlists, or CI gates during rollback.

### 12.7 Residual risks

- Node.js/OpenSSL supplies the FIPS 203/204/205 implementations, but the deployment is not a CMVP-validated cryptographic module. This is algorithm alignment, not a FIPS 140 certification claim.
- Key material lives in process memory while in use. The security boundary is the SSM/KMS/file permission and process isolation, not an HSM.
- TLS hybrid key exchange is measured per edge but is provider-controlled. CloudFront and Vercel accepted the hybrid group during measurement; Netlify selected classical X25519. The app cannot force a viewer-side group.
- SLH-DSA checkpoint signing is an offline procedure. It is not automated on request paths.
- Ledger PQ signatures protect record integrity only if the signing key is not compromised; the HMAC secret remains part of the trust boundary.
- Field encryption hides plaintext but not record length, field presence, or access timing.
- `key-wrap` mode reuses one random DEK per process. AES-GCM with random 96-bit IVs has a birthday-bound limit, so `per-record` is the safer choice for a long-lived process that writes very high record volumes.
- Data in use is outside this layer. Application memory, logs, and crash dumps require separate controls.
- Provider JWT, payment webhook, email, hosted-database, and SDK cryptography remain classical until those providers ship PQ options; see `docs/security/pqc-provider-dependency-register.md`.

### 12.8 CI coverage

`.github/workflows/post-quantum-security.yml` runs the PQC primitive and integration suites on Node 24, verifies the default-safe runtime status, generates ephemeral keys and verifies a hard-mode configuration, and uploads the CBOM plus runtime-status artifacts.
