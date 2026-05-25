# Security Incident Response

Last updated: 2026-05-25

## Severity

| Severity | Example | Initial Response | Target Response |
|---|---|---|---|
| SEV-1 | Confirmed data exposure, active account takeover, production secret leak | Revoke/contain immediately, open incident, notify leadership | 15 minutes |
| SEV-2 | Malware upload blocked, tenant access spike, admin anomaly | Contain affected surface, preserve evidence, run playbook | 60 minutes |
| SEV-3 | Scanner failure, isolated suspicious event | Triage, add detection/test if needed | 1 business day |

## On-Call Routing

| Role | Responsibility |
|---|---|
| Incident commander | Own severity, timeline, containment, and decision log |
| Security lead | Evidence preservation, attacker path analysis, and control validation |
| Platform lead | Rollback, infra containment, credential rotation, and runtime isolation |
| Product/support lead | User/customer impact assessment and notification coordination |
| Communications owner | Internal status, admin/customer notification templates, postmortem distribution |

## Immediate Actions

1. Assign incident owner.
2. Preserve logs and request IDs.
3. Identify affected users, tenants, files, or credentials.
4. Contain using token revocation, IP block, feature flag, route disablement, or rollback.
5. Record timeline and evidence.
6. Communicate internally.
7. Complete post-incident review and add regression tests/detections.

## Incident Timeline Template

| Time UTC | Event | Owner | Evidence |
|---|---|---|---|
| | Detected | | Alert, request ID, dashboard link |
| | Severity assigned | | Incident channel/log |
| | Containment started | | Token revoke, IP block, feature flag, rollback |
| | Impact scoped | | Affected users/tenants/resources |
| | Recovery completed | | Deploy, rollback, restore, or config change |
| | Monitoring closed | | Stability evidence |

## Evidence Preservation And Forensics

- Preserve application, WAF, auth, upload, database, CI, and deploy logs outside the affected host when possible.
- Capture request IDs, IPs, user agents, user IDs, tenant IDs, resource IDs, scanner artifacts, and commit SHAs.
- Avoid modifying suspicious files or containers until required evidence is copied.
- Record credential rotation, token revocation, rollback, and hotfix commands in the timeline.
- Store evidence with restricted access and retention appropriate to severity.

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

## Notification Templates

### Internal Admin Notice

Subject: Security incident SEV-[level] - [short title]

Summary:
Impact:
Containment:
Current risk:
Owner:
Next update:

### Customer/User Notice

Subject: Important security update for your Aura account

What happened:
What information was involved:
What we did:
What you should do:
How to contact support:

Use legal/privacy review before sending customer-facing notices for SEV-1 or regulated data exposure.

## Postmortem Template

| Section | Required Content |
|---|---|
| Summary | What happened and current state |
| Impact | Users, tenants, data, systems, duration |
| Timeline | Detection through recovery |
| Root cause | Technical and process cause |
| Detection | How it was found and what should have found it earlier |
| Response | What worked and what slowed recovery |
| Follow-up | Owners, due dates, tests, detections, docs |

## Tabletop Exercises

Run one tabletop per month and rotate scenarios:

- Account takeover
- Malware upload
- Secret leak
- SSRF attempt
- Tenant data leak
- Admin abuse
- Dependency zero-day
- Ransomware and backup restore
- Production regression and rollback
