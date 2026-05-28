# Payment Provider Contract

The foundation provider interface lives in `server/services/payments/foundation/providerContract.js`.

Required methods:

- `createPaymentIntent(input)`
- `confirmPayment(input)`
- `cancelPayment(input)`
- `refundPayment(input)`
- `getPaymentStatus(input)`
- `verifyWebhookSignature(rawBody, headers)`
- `parseWebhook(rawBody, headers)`

Safety rules:

- Mutating calls require an idempotency key.
- Amounts are integer minor units, never floating point.
- Currency must be a three-letter ISO code.
- Raw PAN, full card number, CVV/CVC, magnetic stripe, and track data are rejected.
- External calls must use timeout, retry, and circuit breaker wrappers.
- Mock provider is safe for local tests and never moves real money.
- Hyperswitch is adapter-only until `PAYMENT_PROVIDER=hyperswitch` is explicitly configured.

Environment:

- `PAYMENT_PROVIDER=mock|hyperswitch`
- `PAYMENT_MODE=test|live`
- `PAYMENT_WEBHOOK_SECRET`
- `HYPERSWITCH_BASE_URL`
- `HYPERSWITCH_API_KEY`
- `HYPERSWITCH_PROFILE_ID`
- `HYPERSWITCH_MERCHANT_ID`
- `PAYMENT_SUCCESS_URL`
- `PAYMENT_CANCEL_URL`

Current production runtime still uses the existing Razorpay/Stripe code path unless explicitly changed in a later, separately tested integration.
