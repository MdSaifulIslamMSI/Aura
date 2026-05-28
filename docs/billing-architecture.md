# Billing Architecture

The foundation uses a Lago-style billing contract with a mock provider for tests.

Billing provider methods:

- `createCustomer`
- `createSubscription`
- `cancelSubscription`
- `recordUsage`
- `createInvoice`
- `getInvoice`
- `markInvoicePaid`

Implemented contracts:

- `MockBillingProvider`: local safe provider with idempotent usage events.
- `LagoProvider`: HTTP adapter contract with timeout, retry, and circuit breaker helpers.
- `KillBillProvider`: documented contract placeholder for future complex billing needs.

Rules:

- Billing provider is optional by flag.
- Usage events must be idempotent.
- Invoice paid events should connect to payment intents and ledger transactions.
- No billing provider secrets are required in local/test mode.
