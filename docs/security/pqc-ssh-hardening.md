# PQC SSH Hardening

Aura can improve SSH readiness on controllable infrastructure now, but only where the server OS and OpenSSH packages support hybrid post-quantum key exchange. This runbook is a staged hardening guide, not an automatic production overwrite.

## Target Posture

- Use OpenSSH 10+ where the host platform supports it.
- Prefer `mlkem768x25519-sha256` and `sntrup761x25519-sha512`.
- Disable direct root login.
- Disable interactive password login.
- Use hardware-backed or security-key admin authentication where possible.
- Rotate deploy keys and avoid long-lived static SSH keys.
- Keep emergency console access for rollback.

## Verification

```sh
ssh -Q kex | grep -E "mlkem|sntrup"
node scripts/security/check-ssh-pqc-readiness.mjs --json --markdown
```

If the KEX query does not list the preferred algorithms, record the host OS, OpenSSH version, package source, and upgrade path. This is a warning for local proof, not a reason to disable existing access controls.

Optional staging evidence:

```sh
PQC_SSH_PROOF_MODE=staging PQC_SSH_HOST=<staging-host> node scripts/security/check-ssh-pqc-readiness.mjs --json --markdown
```

The environment proof report redacts host, user, key paths, and command output. It runs a local client configuration dry-run by default. A remote read-only connect probe stays disabled unless `PQC_SSH_CONNECT_PROBE=true` is explicitly set.

## Staging Rollout

1. Snapshot current SSH daemon and client config through approved change-management notes.
2. Apply `infra/security/sshd_config.pqc.example` to a staging host only after confirming package support.
3. Validate admin login using a non-root admin account and a hardware/security key where available.
4. Validate deploy automation against staging.
5. Keep an active emergency console session until the new config is confirmed.
6. Record OS compatibility, OpenSSH version, KEX list, and rollback owner.

## Rollback

1. Use emergency console access if SSH login fails.
2. Restore the previous daemon config.
3. Restart SSH only after syntax validation.
4. Re-run `ssh -Q kex` and `node scripts/security/check-ssh-pqc-readiness.mjs`.
5. Rotate any deploy key exposed during the incident response window.

## Production Guardrails

- Do not remove classical KEX fallback until every admin and deploy path is validated.
- Do not commit private keys, certs, cookies, raw tokens, OTPs, or deploy credentials.
- Do not lower existing authentication requirements to make PQ KEX work.
- Do not claim SSH is fully quantum-proof; authentication signatures and host keys remain ecosystem-dependent.
