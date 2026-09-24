# Privileged Access Management

## Current Baseline
Admin access already requires backend role checks and can require allowlist, verified email, fresh session, second factor, and passkey. The policy manifest is `server/config/privilegedAccessPolicy.js`.

## JIT Workflow (implemented, disabled by default)

The full request → approve → enforce → audit → expire chain now exists in code:

| Step | Behavior | Where |
|---|---|---|
| Request | Admin asks for a specific permission and reason via `POST /api/admin/privileged-access/grants`. Only permissions in `approvalRequiredFor` are eligible; duplicates (pending or active) are rejected with `PRIVILEGED_GRANT_ALREADY_ACTIVE`. | `server/services/auth/privilegedAccessGrantService.js` |
| Approve | Another authorized admin approves via `POST /grants/:grantId/approve`. Self-approval is rejected (`PRIVILEGED_SELF_APPROVAL_DENIED`). Approval is a super-admin-class trust decision (`admin.security.setting.update`) with the full sensitive-action guard chain. | same |
| Deny / Revoke | `POST /grants/:grantId/deny` (with reason) and `POST /grants/:grantId/revoke` (immediate kill of an approved grant). | same |
| Enforce | When JIT is enabled, the admin middleware hydrates active grants from the grant store per request and `evaluateAuthorization` requires one for approval-gated permissions (403 `PRIVILEGED_JIT_REQUIRED` without a grant). | `server/middleware/authMiddleware.js` (`enforceAdminAuthorizationPolicy`) |
| Audit | `privileged_access.requested/approved/denied/revoked/expired` and `privileged_action.executed` are logged for every transition and privileged execution under a grant. | service + middleware |
| Expire | Grants default to `defaultGrantTtlMinutes` (30) and never auto-renew; due grants transition to `expired` lazily on read. | service |

Grant store: `PrivilegedAccessGrant` model (`server/models/PrivilegedAccessGrant.js`), status lifecycle `pending → approved | denied`, `approved → revoked | expired`.

## Permissions Requiring Approval

- `admin.users.delete`
- `admin.products.delete`
- `admin.ops.maintenance`
- `admin.payments.capture`
- `admin.payments.expire_stale`
- `admin.payments.refunds.write`

## Activation

JIT stays **disabled by default**. Setting `PRIVILEGED_JIT_ACCESS_ENABLED=true` activates hydration + enforcement with no code change; with the flag off, behavior is byte-identical to the pre-JIT baseline (the gate short-circuits before any grant lookup). Operator roster: any SUPER_ADMIN can approve; self-approval is structurally blocked. A dedicated admin-panel UI for the request/approve flow is a follow-up; the API is complete and scriptable today.
