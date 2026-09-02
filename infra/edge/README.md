# Free Edge Security Layer

This folder contains the repo-owned, self-hosted edge security stack — the
$0 replacement for the removed AWS WAF:

- `docker-compose.yml`: the runnable stack — OWASP CRS (ModSecurity Core Rule Set) v4
  (blocking, paranoia level 1) in front of the API, plus a CrowdSec agent
  parsing WAF access/audit logs.
- `nginx/auth-rate-limit.conf`: first-layer NGINX request throttling for auth, recovery, refresh, and admin paths.
- `modsecurity-crs/crs-overrides.conf`: CRS tuning mounted into the WAF container (keep the rule engine in blocking mode; prefer targeted exclusions).
- `crowdsec/acquis.yaml`: CrowdSec acquisition config for the WAF's NGINX access log and ModSecurity audit log.
- `mock-api.mjs`: verification-only backend used by the CI smoke job.

## Run it

```bash
# CI / verification (mock backend):
docker compose --profile verify up -d --wait
node scripts/security/edge-waf-verification.mjs   # from repo root

# Production-style (real backend):
WAF_BACKEND=http://aura-api:5000 docker compose up -d waf crowdsec
```

The verification asserts CRS blocks SQLi, XSS, path traversal, and command
injection while benign traffic passes; CI runs it on every change to this
directory (`.github/workflows/edge-waf-verification.yml`) and daily.

## Safe Rollout Order

1. Run the WAF in staging with the same API image and realistic traffic.
2. Start CRS at paranoia level 1, review audit logs, and add narrow exclusions only for confirmed false positives.
3. Put NGINX rate limits before CRS so obvious floods are cheap to reject.
4. Feed edge logs into CrowdSec and enable the bouncer only after validating block decisions.
5. Keep app-level Redis rate limits and Turnstile/PoW controls enabled; IP-only edge limits are not enough.

Do not use OWASP ZAP or destructive attack tooling against production. Point dynamic scans at an isolated staging URL through `STAGING_URL`.

