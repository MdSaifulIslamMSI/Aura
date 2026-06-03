# Attack Mode Runbook

Environment flags:

- `TRAFFIC_FORTRESS_ENABLED=true`
- `ATTACK_MODE=false`
- `ATTACK_MODE_BLOCK_AI=true`
- `ATTACK_MODE_BLOCK_UPLOADS=true`
- `ATTACK_MODE_STRICT_AUTH=true`
- `ATTACK_MODE_PUBLIC_READ_ONLY=true`
- `ATTACK_MODE_STATUS_CACHE_ONLY=true`

Attack mode blocks expensive and non-critical features first while preserving liveness, provider webhooks, and admin emergency controls. It must not disable audit logging.

Use it when edge/WAF controls are active and origin still shows overload pressure. Disable it only after traffic, provider errors, queue depth, and DB/Redis pressure return to normal.
