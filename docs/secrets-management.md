# Secrets Management

Local development uses environment variables. Production payment secrets should be stored in an approved secrets manager; the foundation documents an OpenBao-compatible contract.

Rules:

- Never commit real secrets, API keys, webhook signing secrets, or provider tokens.
- Do not log authorization headers, API keys, webhook secrets, tokens, or provider credential values.
- `PAYMENT_MODE=live` fails validation unless required payment and webhook secrets are present.
- `SECRETS_PROVIDER=openbao` requires `OPENBAO_ADDR`, `OPENBAO_TOKEN`, `OPENBAO_MOUNT`, and `OPENBAO_PAYMENT_PATH`.
- Test/mock mode must not require live secrets.

Suggested OpenBao layout:

- Mount: `secret`
- Path: `payments/{environment}`
- Keys: provider API keys, webhook signing secrets, billing provider credentials, Kafka credentials if needed.

Local example values are documented in `config/payment.example.env`; real values belong in local untracked env files or the production secret store.
