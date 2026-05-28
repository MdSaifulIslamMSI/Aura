# Payment Observability

Foundation span names:

- `payment.create_intent`
- `payment.confirm`
- `payment.provider_call`
- `payment.webhook.verify`
- `payment.webhook.process`
- `payment.refund`
- `ledger.transaction`
- `billing.invoice`
- `outbox.publish`

Foundation metrics:

- `payment_intent_created_total`
- `payment_success_total`
- `payment_failure_total`
- `payment_refund_total`
- `payment_webhook_duplicate_total`
- `payment_provider_latency_ms`
- `payment_provider_error_total`
- `outbox_pending_count`
- `outbox_failed_count`
- `ledger_transaction_total`

Assets:

- Prometheus alerts: `observability/prometheus/payment-rules.yml`
- Grafana dashboard: `observability/grafana/dashboards/payment-architecture.json`

Logging:

- Include request id, payment intent id, provider, and event id.
- Redact authorization headers, tokens, API keys, webhook secrets, and provider credentials.
