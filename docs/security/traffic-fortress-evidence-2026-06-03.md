# Traffic Fortress Evidence - 2026-06-03

## What Changed

Added central route budgets, body-size guards, timeout budgets, load shedding, attack mode, abuse scoring, cache/query guards, dry-run simulation, traffic proof scripts, and PQC real-target proof integration.

## Commands Run

Baseline on `origin/main` before edits passed:

- `npm run security:pqc:proof`
- `npm run security:pqc:proof:strict`
- `npm run security:pqc:scorecard`
- `npm run security:pqc:scorecard:strict`
- `npm run security:pqc:provider-register`
- `npm run security:pqc`
- `npm run security:routes:coverage:strict`
- `npm run security:free-stack`
- `npm run security:admin`
- `npm test`
- `npm run lint`
- `npm run build`
- `git diff --check`

Post-change verification is recorded in the PR and generated reports.

## Known Limitations

- No system is completely DDoS-proof.
- Volumetric attacks require CDN/WAF/provider absorption and origin lockdown.
- Production load/DDoS testing is forbidden without explicit authorization.
- Cloudflare/free-tier dashboard configuration must be verified outside Codex.
- PQC remains provider/browser/WebPKI capped.

## Rollback

Disable attack mode, budget limits, or blocking abuse shield with the documented flags, then review edge/WAF/provider changes.
