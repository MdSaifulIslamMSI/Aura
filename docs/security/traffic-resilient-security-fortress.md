# Traffic-Resilient Security Fortress

Aura now has a layered traffic-resilience control plane that is free/open-source friendly and safe by default.

## What Is Enforced Now

- Request classification through `server/middleware/routeCostClassifier.js`.
- Central route budgets through `server/config/trafficBudgets.js`.
- Content-length body caps through `server/middleware/bodySizeGuards.js`.
- Per-class timeout budgets through `server/middleware/requestTimeouts.js`.
- Redis-backed route budgets through `server/middleware/trafficBudgetPolicy.js`.
- Load shedding for degradable routes through `server/middleware/loadShedding.js`.
- Attack mode route blocking through `server/middleware/attackModeGuard.js`.
- Abuse scoring and temporary denylist support through `server/middleware/abuseShield.js`.
- Cache and query budget headers/guards through `server/middleware/cachePolicy.js` and `server/middleware/queryBudgetGuard.js`.

## What Is Staging Or Read-Only Only

- Safe traffic simulation is dry-run by default and refuses production-like targets unless explicitly approved for read-only profiles.
- WAF/OWASP CRS/CrowdSec examples start in detection mode.
- Load drills must run only against local or explicitly configured staging targets owned by the team.

## What Requires Production Approval

- Enabling attack mode in production.
- Switching WAF from detection to blocking.
- Updating provider dashboards, CDN/WAF rules, DNS, firewall allowlists, or origin firewall rules.
- Any load, stress, or abuse drill against a production URL.

## Honest Limits

Aura is not 100% DDoS-proof and does not claim unlimited traffic survival. Massive volumetric attacks must be absorbed by CDN/WAF/provider layers before requests reach the origin. App-layer controls protect the origin from realistic abuse, cost spikes, expensive-route pressure, and partial overload.

No system is 100% quantum-proof. Full end-to-end PQC remains capped by browser, WebPKI, provider, app-store, and third-party SDK migration.

## Rollback Flags

- `TRAFFIC_FORTRESS_ENABLED=false`
- `TRAFFIC_BUDGET_LIMITS_ENABLED=false`
- `ATTACK_MODE=false`
- `ABUSE_SHIELD_BLOCKING_ENABLED=false`
- `ABUSE_SHIELD_DENYLIST_ENABLED=false`

Use rollback flags only with an incident note and follow-up remediation.
