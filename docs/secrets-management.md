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

## 1Password Connect (opt-in runtime secrets provider)

AWS SSM stays the default. 1Password Connect resolves `op://vault/item/field`
(or `op://vault/item/section/field`) references in memory at boot via
`server/config/onePasswordProvider.js`, wired through `primeRuntimeSecretsEnv`
in `server/config/runtimeConfig.js` (used by `start_api_runtime.js` and
`start_worker_runtime.js`). No new runtime dependencies; fail-closed when enabled.

Enable:

- `ONEPASSWORD_ENABLED=true` or `RUNTIME_SECRETS_PROVIDER=aws-ssm+onepassword`
- `OP_CONNECT_HOST` (e.g. `http://localhost:8080`), `OP_CONNECT_TOKEN`
- Optional: `OP_CONNECT_VAULT_ALLOWLIST`, `OP_CONNECT_TIMEOUT_MS` (1–30s),
  `OP_CONNECT_ITEM_MAP` (`{"ENV_NAME":"op://vault/item/field"}`),
  `ONEPASSWORD_REQUIRED=true` (hard-fail boot on any lookup failure)

Rules:

- Never commit `OP_CONNECT_TOKEN` or resolved secret values; audit with
  `node server/scripts/audit_onepassword_secret_contract.js` (prints names only).
- Keep `OP_CONNECT_VAULT_ALLOWLIST` tight so one map cannot exfiltrate other vaults.
- 1Password and AWS SSM compose: SSM primes first, then `op://` refs resolve.

Frontend note: login forms already use `username` / `current-password` /
`new-password` / `one-time-code` autocomplete, so 1Password fills work with no
extension-specific code. Guarded by
`app/src/pages/Login/onePasswordCompatibility.test.jsx` — keep
`autocomplete="off"` off credential inputs (one-time recovery grants are the
intentional exception).
