# OpenTofu Infrastructure

This directory is a validation-first OpenTofu foundation. It is compatible with Terraform-style providers and keeps all resource creation behind explicit booleans so CI can run `fmt` and `validate` without cloud credentials.

## Local Commands

```sh
npm run tofu:fmt
npm run tofu:validate
npm run tofu:plan:staging
```

`tofu:plan:staging` requires AWS credentials only when you enable real resources in a copied tfvars file. CI must never run `apply`.

## Environments

- `environments/staging.tfvars.example` is free-tier oriented and keeps resources disabled by default.
- `environments/production.tfvars.example` is example-only and must be copied, reviewed, and wired to real domains/images outside Git before production use.

## Safety Rules

- Do not hardcode AWS credentials, kubeconfigs, tokens, or database secrets.
- Keep `create_example_infra=false` until the target account, cost guardrails, and teardown plan are reviewed.
- Run `tofu plan` against staging before production.
- Production promotion is a manual action after CI, staging smoke, and Argo CD sync checks are green.
