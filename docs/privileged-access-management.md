# Privileged Access Management

## Current Baseline
Admin access already requires backend role checks and can require allowlist, verified email, fresh session, second factor, and passkey. The policy manifest is `server/config/privilegedAccessPolicy.js`.

## JIT Roadmap
| Step | Behavior |
|---|---|
| Request | Admin asks for a specific permission and reason. |
| Approve | Another authorized admin grants time-boxed access. |
| Enforce | Destructive routes check active grant in addition to existing admin middleware. |
| Audit | Every request, approval, denial, expiry, and privileged action is logged. |
| Expire | Grants default to 30 minutes and never auto-renew. |

## First Permissions Requiring Approval
- `admin.users.delete`
- `admin.products.delete`
- `admin.ops.maintenance`
- `admin.payments.capture`

JIT is intentionally disabled by default until the approval model and operator roster are confirmed.
