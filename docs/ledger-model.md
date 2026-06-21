# Ledger Model

The internal ledger foundation is Formance-compatible in shape but local and dependency-free.

Rules:

- Money is stored as integer minor units.
- Legacy Order and PaymentIntent decimal fields are compatibility fields only. New writes also persist integer minor-unit mirrors; historical records need an audited backfill before the decimal fields can be deprecated.
- Historical coverage audit: `npm --prefix server run mongo:money:audit` checks stored Orders and PaymentIntents read-only, reports hashed document IDs only, and must be clean before any decimal-field deprecation plan. The guarded backfill mode requires `MONEY_MINOR_BACKFILL_APPROVED=true npm --prefix server run mongo:money:audit -- --apply` and refuses limited runs.
- Every movement has debit and credit entries.
- A transaction must balance to zero per currency.
- Entries are immutable after creation.
- Corrections use reversing transactions, never silent mutation.
- Fees and taxes are separate accounts.

Accounts:

- `platform:cash`
- `platform:fees`
- `platform:revenue`
- `platform:tax`
- `user:{userId}:receivable`
- `user:{userId}:wallet`
- `processor:{provider}:clearing`
- `refunds:pending`
- `disputes:pending`

Implemented builders:

- `buildPaymentSuccessTransaction`
- `buildRefundTransaction`
- `createLedgerTransaction`

PostgreSQL/Formance path:

- Persist `ledger_transactions` and `ledger_entries` append-only.
- Add a unique source id for payment/refund events.
- Export transactions to Formance later through an adapter without changing domain callers.
