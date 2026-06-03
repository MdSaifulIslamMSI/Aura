# Post-Quantum Cybersecurity Readiness

## 1. Honest Security Statement

No app can be 100% secure. This project targets maximum practical free/open-source post-quantum readiness: standards-aligned hybrid migration, crypto-agility, rollback safety, CI enforcement, and production runbooks.

The project does not implement custom cryptography. Experimental post-quantum work stays in staging or lab mode until there is deliberate approval and evidence.

## 2. Threat Model

- Harvest-now-decrypt-later collection of encrypted traffic.
- Future quantum attacks against RSA and elliptic-curve public-key cryptography.
- Long-lived secrets that outlive current classical cryptographic assumptions.
- TLS traffic capture before future key compromise.
- Server administration compromise through weak SSH posture.
- Long-lived JWT, certificate, or signature keys that are difficult to rotate.

## 3. Current Safe Areas

- Symmetric crypto such as AES-256-GCM and ChaCha20-Poly1305 remains appropriate with sound key management.
- Password hashing with bcrypt, argon2id, or approved scrypt parameters remains appropriate.
- Short-lived tokens reduce blast radius while JWT/WebPKI ecosystems evolve.
- TLS 1.3 hardening is production-ready now.

## 4. Migration Target

- ML-KEM for key encapsulation.
- ML-DSA and SLH-DSA for signatures when ecosystem support is production-ready.
- Hybrid key exchange first, not direct replacement of stable production crypto.
- Config-driven crypto-agility through `config/security/post-quantum-policy.json`.
- No custom app-level post-quantum protocol wrappers.

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

Primary evidence:

- `docs/security/pqc-controlled-surface-matrix.md`
- `docs/security/pqc-ssh-hardening.md`
- `docs/security/pqc-tls-edge-readiness.md`
- `docs/security/pqc-openssl-oqs-lab-results.md`
- `docs/security/internal-service-encryption-readiness.md`
- `docs/security/pqc-backup-key-agility.md`
- `docs/security/pqc-release-signing-readiness.md`
- `docs/security/pqc-provider-dependency-register.md`
- `reports/security/pqc-deployment-proof.json`

Run:

```sh
npm run security:pqc:proof
```
