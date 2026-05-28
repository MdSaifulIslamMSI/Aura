# Payment Local Development

Local defaults are mock-first and do not require real payment, billing, Kafka, Temporal, Formance, or OpenBao credentials.

Useful commands:

```sh
npm run payment:env:validate
npm run payment:test
npm run payment:smoke
docker compose -f docker-compose.payment.yml config
```

Optional infrastructure profiles:

```sh
docker compose -f docker-compose.payment.yml --profile postgres up
docker compose -f docker-compose.payment.yml --profile kafka up
docker compose -f docker-compose.payment.yml --profile temporal up
docker compose -f docker-compose.payment.yml --profile openbao up
docker compose -f docker-compose.payment.yml --profile observability up
```

Use `config/payment.example.env` as the safe example contract. Copy values into an untracked local env file only when needed.

The default app does not require these services. They exist to make the payment architecture path testable without forcing heavy dependencies on every developer.
