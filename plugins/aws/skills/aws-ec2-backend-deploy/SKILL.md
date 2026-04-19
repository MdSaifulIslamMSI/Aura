---
name: "aws-ec2-backend-deploy"
description: "Repo-specific EC2 backend deployment workflow. Use when bootstrapping the free-tier AWS stack, creating GitHub OIDC deploy roles, checking deploy guardrails, validating CI/CD config, or reasoning about the EC2 plus Redis plus SSM release shape in this repo."
---

# AWS EC2 Backend Deploy

Use this skill for the tracked production deployment flow in this repository.

## Do First

1. Read `references/deploy-flow.md`
2. Inspect the checked-in docs, workflows, and bootstrap scripts before
   proposing changes
3. Prioritize rollout risks and guardrails over summaries

## Rules

- Preserve the repo's EC2 plus API plus worker plus Redis shape unless the user
  explicitly wants to redesign it
- Keep GitHub OIDC and SSM Run Command as the default deployment access path
- Respect the current trusted-device deployment guardrails
- Treat cost guardrails and free-tier defaults as important parts of the design,
  not optional extras
