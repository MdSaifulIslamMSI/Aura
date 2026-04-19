# Secure Serverless API Playbook

## Use This When

You want an API-centric backend with minimal operations overhead and strong
default security posture.

## Common AWS Building Blocks

- API Gateway for routing, auth integration, and stage management
- Lambda for compute
- Cognito for user identity and tokens
- DynamoDB for high-scale managed state
- Secrets Manager or Parameter Store for secrets and config
- KMS for encryption posture
- CloudWatch for logs, metrics, and alarms

## Plugin Skills To Pull In First

- `aws-api-gateway`
- `aws-lambda-serverless`
- `aws-cognito`
- `aws-dynamodb`
- `aws-secrets-manager` or `aws-parameter-store`
- `aws-kms`
- `aws-observability`
- `aws-security-review`

## Copy-Paste Prompts

```text
Design a secure serverless API on AWS using API Gateway, Lambda, Cognito, DynamoDB, and KMS. Keep the first version as simple as possible without skipping important security controls.
```

```text
Review my API Gateway plus Lambda design for auth, secret handling, least privilege, observability, retries, and deployment safety.
```

```text
Explain when this workload should use Parameter Store versus Secrets Manager, and how KMS should be applied across the runtime.
```

## What Good Output Looks Like

- a clear path for auth, secrets, encryption, and runtime access
- practical advice about cold starts, retries, idempotency, and quotas
- explicit logging and alarm recommendations
- least-privilege guidance for Lambda execution roles and service integrations
