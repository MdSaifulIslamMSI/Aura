# Auth Disaster Recovery And High Availability

## Critical State
| State | Store | DR concern |
|---|---|---|
| User identity/profile | MongoDB | Backups, restore drill, index integrity |
| Browser sessions | Redis or memory fallback | Session loss should fail closed and force re-login |
| OTP sessions/grants | MongoDB/Redis-backed flow state | Expired or restored OTPs must not become reusable |
| Trusted devices/passkeys | MongoDB user profile | Restore must preserve counters and last verification state |
| Recovery codes | MongoDB hashed codes | Restore must preserve used-code state |
| Metrics/security events | Prometheus/logs/outbox | Retention and incident evidence |

## Minimum Drill
1. Restore MongoDB backup into isolated staging.
2. Confirm login sessions fail closed when Redis is empty.
3. Verify used OTP grants and recovery codes cannot be reused.
4. Confirm trusted-device verification still requires fresh proof.
5. Run `npm.cmd run security:login-gates`.

## RTO/RPO Targets
| Layer | Target |
|---|---|
| Login API process | RTO 30 minutes |
| Mongo identity data | RPO 24 hours until managed backups are formalized |
| Redis sessions | RPO 0; sessions are disposable |
| Audit/security evidence | RPO 1 hour once log shipping is configured |
