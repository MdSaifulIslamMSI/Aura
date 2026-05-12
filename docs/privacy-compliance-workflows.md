# Privacy And Compliance Workflows

## Inventory
The privacy data inventory is codified in `server/config/privacyDataInventory.js`.

## Workflow Contract
| Workflow | Required behavior |
|---|---|
| Consent management | Track marketing/support/analytics consent separately from authentication necessity. |
| Data export | Export identity, commerce, support, and assistant data where legally allowed. |
| Erasure | Delete or pseudonymize personal data, preserving payment/tax/security records only for legal retention windows. |
| Retention | Apply shortest operational windows to diagnostics and auth security outbox events. |
| Audit evidence | Log request, approval, export, erasure, retention override, and completion events. |

## No-Go
- Do not delete payment/tax evidence blindly.
- Do not expose raw auth security events directly to users; export subject-linked summaries only.
- Do not perform erasure without authenticated, fresh-session confirmation.
