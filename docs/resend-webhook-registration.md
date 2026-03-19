# Resend Webhook Registration

Use [register-resend-webhook.ps1](/c:/Users/mdsai/Downloads/Kimi_Agent_Flipkart-Style%20Frontend/infra/azure/register-resend-webhook.ps1) to create or update the production Resend webhook and synchronize the returned signing secret into Azure Key Vault and the live Container Apps.

## What It Does

1. Lists existing Resend webhooks.
2. Creates or updates the production webhook endpoint.
3. Retrieves the Resend-generated `signing_secret`.
4. Stores that value in Azure Key Vault as `resend-webhook-secret`.
5. Updates `RESEND_WEBHOOK_SECRET` on:
   - `aura-msi-api-ca`
   - `aura-msi-worker-ca`
6. Promotes the latest API revision to `100%` traffic.

## Requirement

The script requires a Resend API key with webhook-management permissions. A send-only restricted key will fail with `restricted_api_key`.

## Command

```powershell
powershell -ExecutionPolicy Bypass -File infra\azure\register-resend-webhook.ps1 -ResendApiKey "re_xxx"
```

## Production Endpoint

```text
https://aura-msi-api-ca.wittycliff-f743de69.southeastasia.azurecontainerapps.io/api/email-webhooks/resend
```

## Event Set

The script registers these events:

- `email.sent`
- `email.delivered`
- `email.delivery_delayed`
- `email.bounced`
- `email.complained`
- `email.opened`
- `email.clicked`
- `email.failed`
- `email.suppressed`

## Validation

After running the script:

1. Confirm [health](https://aura-msi-api-ca.wittycliff-f743de69.southeastasia.azurecontainerapps.io/health) is green.
2. Confirm the webhook route returns `400` for unsigned requests rather than `503`.
3. Send a real email through Resend.
4. Confirm the admin email ops portal records delivery lifecycle updates.
