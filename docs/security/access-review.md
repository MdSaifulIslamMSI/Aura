# Access Review

Last updated: 2026-05-25

Run monthly and before major production security releases.

## Scope

- GitHub repository admins, maintainers, deploy keys, and GitHub Actions secrets.
- Cloud provider users, roles, service accounts, and break-glass access.
- Database users and backup readers.
- Object storage readers/writers and CDN origin credentials.
- Payment, email, SMS, AI, observability, and support provider accounts.
- Admin users inside the Aura application.

## Review Checklist

| Control | Evidence | Status |
|---|---|---|
| Leavers removed from GitHub/cloud/providers | Access export | Pending |
| Admin users have MFA | Provider/app evidence | Pending |
| Break-glass account disabled by default | Config/audit entry | Pending |
| CI secrets scoped to least privilege | Secret inventory | Pending |
| Production deploy rights limited | Branch protection and environment rules | Pending |
| Database users least privilege | DB role export | Pending |
| Backup access restricted | IAM/storage policy | Pending |
| Service keys rotated per calendar | Rotation log | Pending |

## Approval

- Reviewer:
- Date:
- Exceptions:
- Follow-up tickets:
- Next review date:
