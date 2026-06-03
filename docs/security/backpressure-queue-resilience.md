# Backpressure And Queue Resilience

Aura already keeps several slow or retryable workflows out of the direct request path:

- Payment outbox worker.
- Order email queue worker.
- Commerce reconciliation worker.
- Catalog import/sync workers.
- Status monitor worker.

Readiness expectations:

- Max concurrency is bounded by worker configuration.
- Retries have a finite budget and backoff.
- Failed work is auditable and does not leak sensitive data.
- Expensive AI, upload, email, payment, catalog, and status work can be paused or degraded during attack mode.
- Queue depth must be observable before production drills.

If Redis or a provider fails, sensitive routes fail closed or return a safe degraded response. Non-critical public reads may fail open safely or serve cached responses.
