# Security Decision Matrix

| Risk | Sensitivity | Decision |
| --- | --- | --- |
| Low | Low | Allow |
| Low | Medium | Allow with audit |
| Medium | Medium | Allow with audit or throttle |
| Medium | High | Challenge |
| High | High | Deny or challenge |
| High | Critical | Contain |
| Unknown sensitive action | Any | Deny |
| Missing authenticated user for authenticated action | Any | Deny |
| Missing tenant proof for tenant resource | Any | Deny |
| Missing owner/resource proof for owner resource | Any | Deny |
| Missing fresh auth for destructive action | High/Critical | Challenge or deny |

Every `DENY`, `CHALLENGE`, `THROTTLE`, and `CONTAIN` decision emits a security event. `ALLOW_WITH_AUDIT` also emits an event.
