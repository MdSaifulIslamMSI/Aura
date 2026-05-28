# Payment Webhooks

Webhook requirements:

- Use raw request body for signature verification.
- Verify provider signature before parsing or trusting any payload field.
- Store provider plus event id under a unique key.
- Treat duplicate events as success/no-op.
- Map provider statuses through explicit state transitions.
- Write audit and outbox events after verified processing.
- Never log raw headers, secrets, tokens, or sensitive provider metadata.

Foundation support:

- `MockPaymentProvider` signs and verifies local HMAC webhooks.
- `HyperswitchProvider` includes a signature verification contract.
- `parseWebhook` returns `{ provider, eventId, type, payload }`.
- Duplicate webhook handling is tested for the mock provider.

The existing Razorpay and Stripe webhook routes remain the live runtime path for now.
