# Payment Environment Variables

Validation entrypoint:

```sh
npm run payment:env:validate
```

Core variables:

- `PAYMENT_PROVIDER=mock|hyperswitch`
- `PAYMENT_MODE=test|live`
- `PAYMENT_WEBHOOK_SECRET`
- `PAYMENT_SUCCESS_URL`
- `PAYMENT_CANCEL_URL`

Hyperswitch:

- `HYPERSWITCH_BASE_URL`
- `HYPERSWITCH_API_KEY`
- `HYPERSWITCH_PROFILE_ID`
- `HYPERSWITCH_MERCHANT_ID`

Billing:

- `BILLING_PROVIDER=mock|lago|killbill`
- `LAGO_BASE_URL`
- `LAGO_API_KEY`
- `KILLBILL_BASE_URL`
- `KILLBILL_API_KEY`
- `KILLBILL_API_SECRET`

Event bus:

- `EVENT_BUS=local|kafka`
- `KAFKA_BROKERS`
- `KAFKA_CLIENT_ID`
- `KAFKA_PAYMENT_TOPIC`
- `KAFKA_BILLING_TOPIC`
- `KAFKA_LEDGER_TOPIC`

Secrets:

- `SECRETS_PROVIDER=env|openbao`
- `OPENBAO_ADDR`
- `OPENBAO_TOKEN`
- `OPENBAO_MOUNT`
- `OPENBAO_PAYMENT_PATH`

Fail-closed behavior:

- `PAYMENT_MODE=live` cannot use `PAYMENT_PROVIDER=mock`.
- Live Hyperswitch requires its base URL, API key, profile id, merchant id, webhook secret, success URL, and cancel URL.
- Live Lago, Kill Bill, Kafka, and OpenBao modes require their respective connection settings.
- Test/mock mode does not require real secrets.
