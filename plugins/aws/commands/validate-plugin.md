---
description: Validate the AWS plugin package structure and release-facing readiness
argument-hint: [optional-focus]
allowed-tools: [Read, Glob, Grep, Bash, Write, Edit, WebFetch]
---

# Validate AWS Plugin

This command checks the AWS plugin package itself rather than the user's AWS
account resources.

## Arguments

The user invoked this command with: $ARGUMENTS

## Instructions

When this command is invoked:

1. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\plugins\aws\scripts\validate-aws-plugin.ps1`
2. Report missing package files, skill count, command count, and example count
3. Call out release-facing blockers first
4. Suggest `/aws:doctor` separately if the package looks fine but runtime readiness is still in doubt

## Example Usage

```text
/aws:validate-plugin
/aws:validate-plugin check whether this AWS plugin is publish-ready
```
