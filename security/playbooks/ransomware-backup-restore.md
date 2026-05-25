# Ransomware Backup Restore Playbook

## Trigger

- Backup deletion/change alert.
- Mass data corruption.
- Ransomware or destructive actor evidence.
- Restore drill failure.

## Immediate Actions

1. Isolate affected credentials and hosts.
2. Stop destructive jobs or writes if still active.
3. Preserve audit logs.
4. Identify last known-good backup.
5. Restore to isolated environment first.
6. Validate data integrity before production cutover.

## Evidence

- Backup IDs and timestamps.
- Restore target.
- Integrity checks.
- Access logs around destructive activity.
- Recovery point and recovery time.

## Recovery

- Rotate affected credentials.
- Re-enable services after validation.
- Record RPO/RTO outcome and drill improvements.
