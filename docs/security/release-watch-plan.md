# 24h Production Watch Plan

Use this template for every security-sensitive production merge.

## Release

- Branch:
- PR:
- Commit:
- Deployment time:
- Owner:
- Rollback command:
- Feature flags:
- Migration status:
- Security evidence artifact:

## Watch Period

- Start:
- End:

## Metrics to Watch

- Health check
- Security health check
- Error rate
- p95 latency
- p99 latency
- CPU and memory
- DB slow queries
- Login failure spike
- MFA failure spike
- Upload rejection spike
- Malware detection
- Upload scan failure spike
- Rate-limit spike
- Webhook failure spike
- External API cost spike
- Admin action anomalies
- User support reports

## Rollback Triggers

- Health check failure for more than 2 minutes.
- 5xx error rate above 2 percent for more than 10 minutes.
- p95 latency doubles for more than 10 minutes.
- Any DB migration error or data integrity regression.
- Auth failures spike abnormally.
- Tenant access denial spike suggests authorization regression.
- Upload malware or scan failures spike.
- Payment, email, or webhook failures spike.
- Any confirmed data exposure.
- Security middleware blocks valid users at material scale.

## Watch Cadence

| Window | Action |
|---|---|
| 0-15 min | Watch deploy status, health, errors, logs, security alerts |
| 15-60 min | Watch auth, DB, uploads, webhooks |
| 1-4 h | Watch latency, cost, abuse, external APIs |
| 4-12 h | Watch user reports and SIEM alerts |
| 12-24 h | Confirm stability and close release watch |

## Commands

```sh
git log --oneline -5
curl -fsS https://YOUR_DOMAIN.com/health
curl -fsS https://YOUR_DOMAIN.com/security/health
```

## Decision

- Keep release:
- Hotfix:
- Rollback:
- Incident opened:
- Evidence attached:
