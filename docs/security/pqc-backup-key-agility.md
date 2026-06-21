# PQC Backup Key-Agility

Backups should use strong symmetric encryption such as AES-256-GCM or ChaCha20-Poly1305. Symmetric encryption is less affected by quantum attacks than RSA/ECC public-key cryptography, but key size, key rotation, envelope design, and restore evidence still matter.

## Target Posture

- Backup keys are rotatable.
- Envelope encryption separates data-encryption keys from wrapping keys.
- Restore dry run is documented and non-destructive by default.
- No backup decryption keys are committed.
- No long-lived static keys are accepted as production posture.
- Future PQ KEM wrapping for backup keys waits for mature tooling and staging proof.

## Verification

```sh
DRY_RUN=true npm run security:backup-restore-check
npm run security:backup-restore-drill
node scripts/security/backup-crypto-agility-check.mjs --json --markdown
```

Optional staging evidence:

```sh
PQC_BACKUP_EVIDENCE_MODE=staging DRY_RUN=true node scripts/security/backup-crypto-agility-check.mjs --json --markdown
```

The local restore drill writes, backs up, restores, and verifies a disposable fixture without network calls or MongoDB access. The optional environment evidence path plans a dry-run restore check and records only missing/configured setting groups. Neither path decrypts production backups, writes production restore targets, or stores backup commands, storage URIs, or key values in reports.

## Emergency Restore Checklist

1. Confirm restore target and blast radius.
2. Keep `DRY_RUN=true` until approval is recorded.
3. Confirm backup storage and key version from approved secret storage.
4. Run the restore verifier.
5. Run a limited restore rehearsal before any production write.
6. Rotate credentials after restore completion.
7. Record evidence in `reports/security/backup-crypto-agility-check.json`.

## Rollback

Restore the previous backup key version only through approved secret storage, revoke the failed rotated version, and re-run the restore dry run.
