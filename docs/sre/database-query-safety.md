# Database Query Safety

## Goals

- Bound query latency.
- Prevent unbounded lists and unsafe search.
- Keep hot paths index-aware.
- Keep auth, payment, order, admin, and recovery flows fail-closed.

## Current Controls

- Mongo connection options in `server/config/db.js` set bounded server selection, socket, pool, idle, connection, wait queue, and write concern timeouts.
- `server/middleware/queryBudgetGuard.js` rejects unsafe page sizes and search lengths based on the route traffic budget.
- `server/config/trafficBudgets.js` assigns `dbQueryCostBudget` by route class.
- Many controllers clamp page size, for example admin users, products, notifications, orders, status, recommendations, and listings.
- Catalog service uses `maxTimeMS` on several hot paths.
- Payment and order mutation paths include idempotency checks.

## Required Pattern For New Queries

New list/search endpoints must:

- Parse page and limit through a bounded helper or validator.
- Cap maximum page size.
- Use indexed filters and indexed sorts.
- Use `lean()` for read-only Mongoose document reads unless model methods are required.
- Use projection for large documents.
- Use `maxTimeMS` on hot or user-controlled searches.
- Reject or bound regex patterns.
- Avoid unbounded aggregation.
- Avoid unbounded `Promise.all` over user-controlled arrays.

## Mutation Safety

Auth, payment, order, wallet, refund, admin, and account-recovery mutations must:

- Derive authority from server-side state.
- Require idempotency where duplicate execution can cause side effects.
- Avoid retrying non-idempotent provider calls unless an idempotency key or equivalent protection exists.
- Return safe public errors on dependency timeout.

## Review Checklist

- Is every user-controlled limit clamped?
- Is the sort supported by an index or documented as low-volume?
- Is any regex anchored, length-bounded, and escaped?
- Does the endpoint have a traffic budget route class?
- Does the dependency timeout fit the latency budget?
- Does the response avoid secret or private infrastructure metadata?
