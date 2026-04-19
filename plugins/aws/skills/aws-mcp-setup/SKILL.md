---
name: "aws-mcp-setup"
description: "Bootstrap and troubleshoot the AWS plugin's MCP environment. Use when Codex needs to install AWS MCP Python packages, verify AWS CLI availability, diagnose plugin readiness, configure authentication, or prepare safer AWS API MCP usage."
---

# AWS MCP Setup

Use this skill when the problem is the plugin environment itself, not the repo's
AWS infrastructure.

## Do First

1. Read `references/install.md`
2. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\plugins\aws\scripts\doctor-aws-plugin.ps1` if setup state is unclear
3. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\plugins\aws\scripts\bootstrap-aws-mcp.ps1` when packages are missing

## Rules

- Prefer the smallest step that unblocks the user
- Treat missing AWS credentials as a setup issue, not a code bug
- Keep the AWS API MCP server read-only unless the user explicitly wants
  mutation access
- Recommend generating the AWS API MCP security policy before any write enablement
