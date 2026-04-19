---
description: Diagnose AWS plugin readiness, installed packages, and credential state
argument-hint: [optional-focus]
allowed-tools: [Read, Glob, Grep, Bash, Write, Edit, WebFetch]
---

# AWS Doctor

This command checks whether the AWS plugin is ready to use on the current
machine and highlights the blockers.

## Arguments

The user invoked this command with: $ARGUMENTS

## Instructions

When this command is invoked:

1. Read `skills/aws-mcp-setup/SKILL.md`
2. Run `scripts/doctor-aws-plugin.ps1`
3. If needed, use `scripts/bootstrap-aws-mcp.ps1` to fix missing packages
4. If the AWS API MCP path is blocked by missing credentials, explain the
   smallest next step clearly

## Example Usage

```text
/aws:doctor
/aws:doctor why can't the AWS API server read my account?
```
