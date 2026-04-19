---
description: Install and verify the AWS MCP environment for this plugin
argument-hint: [optional-setup-goal]
allowed-tools: [Read, Glob, Grep, Bash, Write, Edit, WebFetch]
---

# Setup AWS MCP

This command helps prepare the AWS plugin so its MCP servers are usable on this
machine.

## Arguments

The user invoked this command with: $ARGUMENTS

## Instructions

When this command is invoked:

1. Read `skills/aws-mcp-setup/SKILL.md`
2. Use `skills/aws-mcp-setup/references/install.md` for bootstrap and auth flow
3. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\plugins\aws\scripts\bootstrap-aws-mcp.ps1` when installation is required
4. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\plugins\aws\scripts\doctor-aws-plugin.ps1` if setup or credentials look incomplete
5. Keep the AWS API MCP server read-only unless the user explicitly requests
   write access

## Example Usage

```text
/aws:setup-mcp
/aws:setup-mcp verify whether the plugin is fully ready
```
