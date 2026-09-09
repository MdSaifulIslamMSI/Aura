# SLOs And On-Call Loop

Aura is currently a small-team operation: the "on-call loop" is GitHub
scheduled-workflow notifications plus the in-app status system, escalating to
a paging vendor later. This document defines the objectives those signals
guard and what to do when they burn.

## Service Level Objectives (30-day windows)

| Objective | SLI | Target |
| --- | --- | --- |
| Liveness | `GET /health/live` succeeds (Uptime Probe, 30-min cadence) | 99.9% |
| Readiness | `GET /health/ready` returns 200 (excludes intentional fail-closed gates) | 99.5% |
| Backup freshness | A production Mongo archive younger than 26h exists | 99.0% |
| Backup restorability | Quarterly drill (`RESTORE_DRILL=true`) passes with verified checksums | 100% |

Money-adjacent flows (order placement, payment capture via the outbox worker)
have no latency SLO yet; track them through the Grafana dashboards and the
`aura_` Prometheus metrics until the burn-rate tooling is fed automatically.

## Error Budget

Burn rate = (errors / total) / (1 - sloTarget). Evaluate with:

```sh
node scripts/sre/slo-burn-rate-check.mjs --window 30d --errors <n> --total <m> --slo-target 0.999
```

Exit codes: `0` ok (burn < 6x), `1` ticket (6x–14.4x), `2` page (>= 14.4x).
Fast-burn (>= 14.4x over a short window) means stop feature work and fix
reliability first.

## Alert Sources

1. **Uptime Probe** (every 30 min) — fails red when liveness fails or
   `AURA_UPTIME_BACKEND_URL` is unset. GitHub failure email is the signal.
2. **Production DB Backup** (daily 21:13 UTC) — job failure posts to the Aura
   status webhook; the `freshness` job fails if the newest archive is older
   than 26h.
3. **Alertmanager** (`infra/observability/`) — Prometheus rules (load
   shedding, traffic budgets, login security) post to
   `/api/status/webhooks/alertmanager`; admin notifications appear in the
   status system.
4. **Readiness gates** — `/health/ready` fails closed with a machine-readable
   reason (`catalog_stale`, `split_runtime_workers_unavailable`,
   `index_integrity_failed`); see `docs/incident-runbook.md` for the response.

## On-Call Loop

- Triage: run `docs/incident-runbook.md` "First Five Minutes".
- Escalate: incident owner → database owner (Mongo/backup issues) → deploy
  owner (rollback workflows).
- After every page: file a short postmortem note (what burned, which SLO, what
  changed) and, when the fix is code, link the PR.
- Review the SLO table quarterly; adjust targets before automating more pages.

## Open Gaps (tracked)

- No paging vendor; GitHub email and the status webhook are the only fan-out.
- `scripts/sre/slo-burn-rate-check.mjs` is run manually; nothing feeds it
  from metrics yet.
