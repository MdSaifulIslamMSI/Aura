# Auth Shield Audit Events

Auth Shield emits `authshield.decision` when `AUTH_SHIELD_AUDIT_ENABLED=true`.

## Shape

```js
{
    event: 'authshield.decision',
    decision: 'allow',
    action: 'payment.refund',
    sensitivity: 'critical',
    riskLevel: 'low',
    riskReasons: [],
    policyVersion: '2026-06-05',
    userIdHash: '...',
    resourceType: 'refund',
    resourceIdHash: '...',
    tenantIdHash: '...',
    requestId: '...',
    route: '/api/payments/intents/:id/refunds',
    method: 'POST',
    ipHash: '...',
    userAgentHash: '...',
    shadowMode: true,
    failClosed: true,
    createdAt: '...'
}
```

## Redaction Rules

- Hash user IDs.
- Hash resource IDs.
- Hash tenant IDs.
- Hash IP and user agent values.
- Never log raw access tokens.
- Never log cookies.
- Never log OTPs.
- Never log passwords.
- Never log card/payment secrets.
- Never log private keys.
- Never log raw authorization headers.
- Never log full request bodies on sensitive routes.

## Failure Behavior

Audit failures do not block ordinary low-risk traffic. Critical fail-closed audit behavior is available through `AUTH_SHIELD_AUDIT_FAIL_CLOSED_CRITICAL=true`.
