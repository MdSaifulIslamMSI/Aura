# Security Event Ledger Fork — 2026-11-09

**Status:** remediated and verified  
**Severity:** high (audit integrity; no confidentiality impact)  
**Affected surface:** production security event ledger (`securityeventledgers`)  
**Fixes:** #746 (transactional append, deployed as `9a36ab8a`) and #747 (verifier ESM)  
**Archive:** `securityeventledgers_incident_20261109`, 126 records, SHA-256 `6a1a0aa292f384cca1b894bd5a4107dd2e9a3699bb640baf76847c12b83084f3`

## Summary

The production security event ledger forked during a 69-second rate-limit burst on 2026-11-09. Concurrent appends reserved distinct sequence numbers but linked to the same predecessor hash. The head's ancestry chain contains 64 of 126 records; the other 62 are validly signed but orphaned across 28 fork points.

There is no evidence of payload tampering or signature forgery: every one of the 126 records passes its own HMAC and hybrid PQC signature check against its stated `prevHash`. The damage is structural (chain topology), not cryptographic.

## Timeline (UTC)

| Time | Event |
|---|---|
| 2026-11-08 11:59:45 | seq 1, `security.pqc.activation_verified` |
| 2026-11-08 12:03:19 | seq 2, `security.pqc.chain_continuity_verified` |
| 2026-11-09 09:49:52.695 | seq 3, `rate_limit.hit` |
| 2026-11-09 09:49:52.702 | seq 4, `rate_limit.hit` — first fork; both point at seq 2's hash |
| 2026-11-09 09:50:00–09:50:47 | 13 `security_ledger.append_failed`, all `E11000 duplicate key seq_1`, sequence numbers 30–110 |
| 2026-11-09 09:51:01.289 | seq 126, last record of the burst |
| 2026-11-09 13:20 | read-only verification returns `integrity_mismatch` at seq 4 |
| 2026-11-09 13:27 | topology walk finds 64 on-chain, 62 orphaned, 28 fork points (max 13 siblings) |
| 2026-11-09 13:37–13:40 | `9a36ab8a` deployed; live image and `/health` confirmed |
| 2026-11-09 13:46 | archive exported to host and S3; digest recorded |
| 2026-11-09 13:49:38 | signed reset record appended at seq 1; chain verifies |
| 2026-11-09 13:51:28 | signed probe appended at seq 2; chain verifies |
| 2026-11-09 13:53 | post-reset audit confirms archive digest, indexes, and PQC coverage |

## Root cause

The pre-#746 append path did four separate operations:

1. atomically `$inc` the head counter to reserve a sequence number;
2. read `lastHash` from the same update;
3. insert the record;
4. `$set` both `seq` and `lastHash` on the head.

Two concurrent appends could read the same `lastHash` before either performed step 4. Both then computed their hash against the same predecessor, producing sibling records instead of a chain. Because step 4 also wrote `seq`, a slower append could overwrite a newer counter value; the next `$inc` re-issued a stored sequence number, and the unique `seq_1` index rejected the insert. That is the source of the 13 dropped events.

## Impact

- 126 ledger records written; 64 on the head chain, 62 orphaned.
- 13 security events were not persisted to the ledger because their inserts hit the duplicate-key index.
- `verifySecurityEventLedger` reported `integrity_mismatch` at seq 4.
- No payload tampering or forged signatures detected.
- Ledger payloads are security event metadata; no customer secrets or credentials are stored in the ledger.

## Detection gap

The shipped `server/scripts/verify-security-event-ledger.mjs` was ESM but used CommonJS `require()`, so every invocation crashed with `ReferenceError: require is not defined in ES module scope` before reaching the database. In addition, no workflow or cron invoked the script; `docs/security/phase5-evidence-and-behavior.md` described a schedule that did not exist. The fork was found by a manual read-only verification, not by the integrity check.

## Remediation

1. **Stop new forks.** Deployed `9a36ab8a` (#746). Reserving `seq`, inserting the record, and advancing `lastHash` now share one MongoDB transaction (`readConcern: snapshot`, `writeConcern: majority`); the redundant `seq` write is gone.
2. **Preserve the old chain.** Exported all 126 records as JSONL (700,091 bytes) and computed SHA-256 `6a1a0aa292f384cca1b894bd5a4107dd2e9a3699bb640baf76847c12b83084f3`. The file is at `/var/lib/aura/security-ledger-archive-20261109.jsonl` and in `s3://aura-prod-mongo-backups-517353742644/security-event-ledger/2026-11-09/`.
3. **Archive in place.** Renamed `securityeventledgers` to `securityeventledgers_incident_20261109`; the archive retains the original documents and the unique `seq_1` index.
4. **Reset the head.** Set the head document to `seq: 0`, `lastHash: "genesis"`, then recreated the live collection indexes (including unique `seq_1`) before accepting appends.
5. **Attest the reset.** Appended `security.ledger.chain_reset` as seq 1. Its payload binds the archive digest, old head (`af4d4efff3c7b81872740532214ccbd53b50f07d2bf2afb343688a6c8d21c052`), counts, fork analysis, cause, fix, and deployed commit. The record is PQC-signed (`pqc-41672468…`) and has hash `1f93a36d…`.
6. **Prove linkage.** Appended `security.ledger.post_reset_probe` as seq 2 (hash `f7dd8b84…`). Verification returns `verified: true`, `checked: 2`, `pqc.mode: require`, `pqc.unsigned: 0`.
7. **Fix the verifier.** #747 adds `createRequire(import.meta.url)` so the shipped script runs under ESM.

## Verification evidence

- `verifySecurityEventLedger({ limit: 100 })` → `{"verified":true,"checked":2,"headHash":"f7dd8b849e68222f4588e3c51b3139636171b105c13aed31ce7385de18f955ad","pqc":{"mode":"require","active":true,"checked":2,"unsigned":0}}`
- Archive digest recomputed from `securityeventledgers_incident_20261109` equals the recorded digest.
- Live and archive collections both expose unique `seq_1`; live also has `eventId_1`, `hash_1`, `pqcKeyId_1`, and `createdAt_-1`.
- Post-reset health check returned HTTP 200 with `{"status":"ok",...}`.
- No `security_ledger.append_failed` entries after the deploy.

## Residual risk and follow-ups

- **The archive is still a forked DAG.** Re-linking the 62 orphans would require rewriting their hashes and PQC signatures, which would destroy the audit value. The signed reset record binds the archive digest instead. Treat the archive as an attested historical artifact, not a replayable chain.
- **No scheduled verifier.** Nothing runs the (now fixed) script automatically. Scheduling needs either Atlas network access from CI or an on-instance cron; the design is not included in this change.
- **Production image predates #747.** The running image is `9a36ab8a`; the verifier fix (`49f0e60e`) ships with the next deploy. The inline verifier used during this incident is equivalent to the shipped logic.
- **#744 remains parked** until the dependency release cooldown clears on 2026-11-13 06:15 UTC.
