---
description: Map a workload to the right AWS services, plugin skills, and next steps
argument-hint: [workload-or-goal]
allowed-tools: [Read, Glob, Grep, Bash, Write, Edit, WebFetch]
---

# AWS Solution Map

This command helps translate a product, platform, or operations problem into the
right AWS services and plugin skills.

## Arguments

The user invoked this command with: $ARGUMENTS

## Instructions

When this command is invoked:

1. Read `README.md` and `examples/README.md`
2. Match the request to the closest starter playbook or workload shape
3. Recommend the smallest useful service set before suggesting optional extras
4. Name the most relevant AWS plugin skills to use next
5. Offer copy-paste prompts or a tight next-step plan instead of generic summaries

## Example Usage

```text
/aws:solution-map
/aws:solution-map map an API product with auth, caching, and analytics
```
