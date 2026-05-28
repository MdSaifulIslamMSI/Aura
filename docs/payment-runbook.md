# Payment Runbook

Local checks:

```sh
npm run payment:env:validate
npm run payment:test
npm run payment:smoke
docker compose -f docker-compose.payment.yml config
```

If env validation fails:

- Confirm `PAYMENT_MODE`.
- In live mode, provide all required provider, webhook, billing, event bus, and secrets settings.
- Keep real values in a secret manager or untracked local environment only.

If provider calls fail:

- Check circuit breaker/open state and provider latency.
- Confirm idempotency keys are unique per mutation.
- Confirm no raw card data fields were sent.
- Retry through workflow/outbox rather than direct manual mutation.

If webhooks fail:

- Verify raw body handling.
- Verify provider signing secret.
- Check duplicate event ids before replaying.
- Replay only verified events.

If ledger validation fails:

- Do not mutate entries.
- Create a reversing or correcting transaction.
- Investigate fee/tax split and currency balance.
