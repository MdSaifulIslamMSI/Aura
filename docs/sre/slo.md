# Service-Level Objectives

Grounded in what this repo already measures. No new telemetry required.

## Summary

| SLI | SLO (30-day) | Budget | Measured by |
|---|---|---|---|
| Storefront availability (synthetic) | 99.5% checks pass | 0.5% | `sre:synthetic:staging` |
| Backend p95 latency | 99.0% runs within budget | 1.0% | `sre:latency:staging` |
| Checkout / payment success | 99.9% transitions succeed | 0.1% | payment integrity + webhook guards, `test:reliability` |
| Error budget burn rate | page >= 14.4x, ticket >= 6x | — | `sre:slo:burn` |

## SLI 1 — Storefront availability (synthetic)

- Source: `npm run sre:synthetic:staging` (`scripts/sre/synthetic-staging-check.mjs`).
- Evidence: `artifacts/sre/synthetic-staging-check.json`.
- SLI: fraction of synthetic staging checks with `status: pass` over a 30-day window.
- SLO: 99.5% of checks pass.
- Budget: 0.5% failed checks per window (~3.6h downtime-equivalent per 30 days).
- Notes: covers staging health, API health, frontend HTML, static assets,
  frontend API proxy, and Socket.IO reachability. CI runners use a relaxed
  1000ms health guardrail; the 250ms service target still applies in-region.

## SLI 2 — Backend p95 latency

- Source: `npm run sre:latency:staging` (`scripts/sre/backend-latency-probe.mjs`).
- Evidence: `artifacts/sre/backend-latency-probe.json`.
- SLI: fraction of probed paths whose p95 stays within budget
  (health 250ms, normal API 800ms per `docs/sre/latency-and-reliability-budgets.md`).
- SLO: 99.0% of latency probe runs meet all path budgets over 30 days.
- Budget: 1.0% of runs may breach a path budget.
- Notes: read-only regression detector, not a load test. Production probing
  stays disabled unless `ALLOW_PRODUCTION_LATENCY_PROBE=true`.

## SLI 3 — Checkout / payment success

- Source: `npm run security:business-logic`, `npm run security:webhooks`,
  `npm run test:reliability` (payment integrity, webhook transition guards,
  provider retry tests).
- SLI: fraction of payment-order state transitions that complete without an
  integrity-guard rejection or unhandled provider failure, per provider retry
  test outcomes and production `payment.*` failure logs.
- SLO: 99.9% successful payment transitions over 30 days.
- Budget: 0.1% failed transitions (~43m per 30 days).
- Notes: PAYMENT routes retry only with idempotency protection; webhook
  signature verification must never be bypassed to "improve" this SLI.

## SLI 4 — Error budget policy + burn-rate alerts

- Burn rate = observed error ratio / budget ratio, where
  budget ratio = 1 - SLO target (e.g. 0.001 for 99.9%).
- Calculator: `npm run sre:slo:burn -- --window 1h --errors <n> --total <m> --slo-target 0.999`.
- Thresholds (30-day SLO basis, Google SRE multiwindow style):

| Alert | Burn rate | Long window | Short window | Routing |
|---|---|---|---|---|
| Fast-burn | >= 14.4x | 1h | 5m | Page (SEV1/SEV2 path) |
| Slow-burn | >= 6x | 6h | 30m | Ticket (SEV3/SEV4 path) |
| Healthy | < 6x | — | — | No action |

- Fast-burn at 14.4x exhausts a 30-day budget in ~2 days; page immediately and
  open a SEV1/SEV2 incident per `docs/status/incident-severity-policy.md`.
- Slow-burn at 6x exhausts the budget in ~5 days; file a ticket, assign an
  owner, and review at the next deploy gate.
- Freeze non-urgent releases when either alert fires; freeze all feature
  releases when the remaining 30-day budget drops below 25%.
- Reset discussion, not silent reset: budget recovers only as the rolling
  window advances. Document sustained breaches in a postmortem
  (`docs/runbooks/postmortem-template.md`).

## Worked example

SLO 99.9% over 30 days gives a budget ratio of 0.001. In the last hour,
20 of 10,000 payment transitions failed:

```sh
npm run sre:slo:burn -- --window 1h --errors 20 --total 10000 --slo-target 0.999
```

Error ratio = 0.002, burn rate = 0.002 / 0.001 = 2x → verdict `ok`.
At 80 failures the burn hits 8x → `ticket`; at 200 it hits 20x → `page`.
Pair the fast-burn 1h window with its 5m short window (and 6h/30m for
slow-burn) before paging, so a single bad 5-minute spike alone does not page.

## Related docs

- `docs/sre/latency-probe.md` — latency probe command, budgets, output.
- `docs/sre/latency-and-reliability-budgets.md` — service budgets, route-class
  mapping, gate enforcement, release rule.
- `docs/sre/backend-reliability-inventory.md` — timeout/retry primitives behind
  the reliability SLI.
- `docs/status/incident-severity-policy.md` — SEV levels and update cadence.
- `docs/runbooks/postmortem-template.md` — postmortem template for SEV1/SEV2.

## Verification

```sh
npm run sre:synthetic:staging
npm run sre:latency:staging
npm run sre:slo:burn -- --self-test
```
