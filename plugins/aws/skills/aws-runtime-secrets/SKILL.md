---
name: "aws-runtime-secrets"
description: "AWS runtime secret materialization for this repo's EC2 deployment. Use when reviewing or changing how runtime env files are rendered from Systems Manager Parameter Store, checking `infra/aws/render-runtime-secrets.sh`, or reasoning about env file precedence in the deployed backend."
---

# AWS Runtime Secrets

Use this skill for the runtime secret rendering path on the EC2 host.

## Do First

1. Read `references/runtime-secrets.md`
2. Inspect `infra/aws/render-runtime-secrets.sh`
3. Check the compose file and deploy script that consume the rendered env file

## Rules

- Never print decrypted secret values
- Preserve the current path-prefix plus region contract
- Treat output file permissions and env file ordering as important runtime behavior
