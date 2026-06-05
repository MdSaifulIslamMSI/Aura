# Trust Audit Evidence

Trust Fabric writes structured audit events through `server/trust/audit/trustAuditLogger.js`, which delegates to the existing security audit logger after local redaction.

Required evidence fields:

- `decisionId`
- `requestId`
- `actorId` as hashed or safe ID
- `actorRole`
- `action`
- `resourceType`
- `resourceId` as hashed or safe ID
- `route`
- `method`
- `decision`
- `reason`
- `riskScore`
- `riskLevel`
- `enforcementMode`
- `requiredStepUp`
- `timestamp`
- redacted `metadata`

Never log access tokens, refresh tokens, cookies, passwords, OTPs, raw card data, payment secrets, private keys, full auth headers, raw webhook bodies, or unnecessary PII.

Audit failures must never change request behavior.
