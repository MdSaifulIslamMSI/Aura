# Security Incident Response

Last updated: 2026-05-25

## Severity

| Severity | Example | Initial Response |
|---|---|---|
| SEV-1 | Confirmed data exposure, active account takeover, production secret leak | Revoke/contain immediately, open incident, notify leadership |
| SEV-2 | Malware upload blocked, tenant access spike, admin anomaly | Contain affected surface, preserve evidence, run playbook |
| SEV-3 | Scanner failure, isolated suspicious event | Triage, add detection/test if needed |

## Immediate Actions

1. Assign incident owner.
2. Preserve logs and request IDs.
3. Identify affected users, tenants, files, or credentials.
4. Contain using token revocation, IP block, feature flag, route disablement, or rollback.
5. Record timeline and evidence.
6. Communicate internally.
7. Complete post-incident review and add regression tests/detections.

## Playbook Map

| Alert | Playbook |
|---|---|
| Failed login spike or impossible travel | [account-takeover.md](../../security/playbooks/account-takeover.md) |
| Upload malware detected or scan unavailable | [malware-upload.md](../../security/playbooks/malware-upload.md) |
| Secret scanner hit or exposed token | [secret-leak.md](../../security/playbooks/secret-leak.md) |
| Private IP/metadata egress attempt | [ssrf-attempt.md](../../security/playbooks/ssrf-attempt.md) |
| Tenant cross-access denied spike | [tenant-data-leak.md](../../security/playbooks/tenant-data-leak.md) |
| Admin anomaly or break-glass use | [admin-abuse.md](../../security/playbooks/admin-abuse.md) |
| Critical dependency advisory | [dependency-zero-day.md](../../security/playbooks/dependency-zero-day.md) |
| Backup/ransomware event | [ransomware-backup-restore.md](../../security/playbooks/ransomware-backup-restore.md) |
| Post-release regression | [production-regression.md](../../security/playbooks/production-regression.md) |

## Evidence Required

- Request IDs
- User IDs and tenant IDs where available
- IPs and user agents
- Timestamps in UTC
- Changed resources
- Scanner or CI artifact links
- Rollback/hotfix commit
- Customer/user impact assessment
- Follow-up test or detection
