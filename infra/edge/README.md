# Free Edge Security Layer

This folder contains repo-owned templates for the free/open-source edge layer:

- `nginx/auth-rate-limit.conf`: first-layer NGINX request throttling for auth, recovery, refresh, and admin paths.
- `modsecurity-crs/docker-compose.example.yml`: OWASP CRS with ModSecurity in front of the API.
- `crowdsec/acquis.yaml`: CrowdSec acquisition config for NGINX/Caddy logs.

## Safe Rollout Order

1. Run the WAF in staging with the same API image and realistic traffic.
2. Start CRS at paranoia level 1, review audit logs, and add narrow exclusions only for confirmed false positives.
3. Put NGINX rate limits before CRS so obvious floods are cheap to reject.
4. Feed edge logs into CrowdSec and enable the bouncer only after validating block decisions.
5. Keep app-level Redis rate limits and Turnstile/PoW controls enabled; IP-only edge limits are not enough.

Do not use OWASP ZAP or destructive attack tooling against production. Point dynamic scans at an isolated staging URL through `STAGING_URL`.
