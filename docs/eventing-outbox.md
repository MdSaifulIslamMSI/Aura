# Eventing And Outbox

The payment foundation defines Kafka-compatible event names and a local event bus.

Outbox event types:

- `payment.intent.created`
- `payment.intent.processing`
- `payment.intent.succeeded`
- `payment.intent.failed`
- `payment.refund.requested`
- `payment.refund.succeeded`
- `billing.invoice.created`
- `billing.invoice.paid`
- `ledger.transaction.created`
- `webhook.received`
- `webhook.processed`

Rules:

- Domain state and outbox writes should happen in the same database transaction when persistence is wired.
- Publisher marks events sent only after successful delivery.
- Failed events retry with exponential backoff.
- Events dead-letter after the max attempt count.
- Local event bus is default for development and tests.
- Kafka adapter is contract-only until a producer is configured.
