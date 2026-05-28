# Ledger Model

The internal ledger foundation is Formance-compatible in shape but local and dependency-free.

Rules:

- Money is stored as integer minor units.
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
