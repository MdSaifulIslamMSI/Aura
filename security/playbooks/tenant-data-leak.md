# Tenant Data Leak Playbook

## Trigger

- Tenant cross-access denied spike.
- IDOR report.
- User sees another user's or tenant's data.

## Immediate Actions

1. Disable the affected route or feature flag if exposure is ongoing.
2. Preserve request logs and object IDs.
3. Identify affected tenants, users, and records.
4. Patch owner/tenant authorization check.
5. Add a regression test for the exact object path.
6. Review nearby routes for the same pattern.

## Evidence

- Tenant IDs and resource IDs.
- User IDs.
- Request IDs and timestamps.
- Controller/route involved.
- Before/after test results.

## Recovery

- Notify according to legal/compliance requirements.
- Complete access review for the affected surface.
- Close with route matrix update.
