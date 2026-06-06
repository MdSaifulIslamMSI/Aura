# Security Events

Security events use this shape:

```txt
timestamp
requestId
userId
tenantId
action
route
method
ipHash
userAgentHash
riskScore
decision
reasonCode
environment
metadata
```

Never log passwords, OTPs, full tokens, full API keys, payment card data, raw authorization headers, secrets, or unredacted payloads.

Common events:

- `auth.stepup.required`
- `access.denied`
- `access.crossTenantDenied`
- `rate.limit.hit`
- `rate.limit.escalated`
- `upload.rejected`
- `payload.rejected`
- `ssrf.blocked`
- `webhook.invalidSignature`
- `payment.refund.requested`
- `payment.refund.blocked`
- `data.export.requested`
- `data.export.blocked`
- `canary.touched`
- `risk.score.high`
- `containment.triggered`
