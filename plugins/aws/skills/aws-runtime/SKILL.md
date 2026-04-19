---
name: "aws-runtime"
description: "General AWS guidance for this repo's EC2-backed split runtime, using AWS Documentation and API MCP servers. Use when work involves repo-wide AWS architecture choices, AWS debugging, deployment validation, or when no narrower AWS skill fits."
---

# AWS Runtime

Scope the work to the AWS workflow already checked into this repository.
Prefer the narrower AWS skills when the request is clearly about plugin setup,
Parameter Store, or the EC2 deployment flow.

## Do First

1. Read `references/repo-runtime.md` for the repo's AWS shape and command map.
2. Read `references/mcp-setup.md` if the task depends on live AWS MCP access.
3. Prefer the checked-in repo scripts over ad hoc AWS commands.

## Working Style

- Use `aws-documentation-mcp-server` for current AWS guidance and direct AWS documentation lookups.
- Use `aws-api-mcp-server` for live AWS inspection only after credentials are
  configured and the action is appropriate.
- Treat `aws-knowledge-mcp-server` as optional only if it is re-enabled and revalidated later.
- Keep secrets out of logs, patches, screenshots, and user-facing responses.
- Prefer dry-runs, audits, and read-only inspection before write actions.

## Guardrails

- Treat `ap-south-1` as this repo's current default, not a universal AWS
  default.
- Preserve the current split runtime unless the user explicitly wants an
  architecture change.
- Do not weaken trusted-device, auth-vault, or deploy guardrail checks.
- Leave the AWS API MCP server read-only unless the user deliberately needs
  mutations and has a safety policy in place.
