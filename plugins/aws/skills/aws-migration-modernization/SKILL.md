---
name: "aws-migration-modernization"
description: "AWS migration and modernization guidance. Use when planning cloud migration, cutover strategy, application decomposition, data migration, hybrid transition, workload modernization, or reducing manual drift while moving systems into AWS."
---

# AWS Migration Modernization

Use this skill for migration planning and modernization paths into AWS.

## Do First

1. Read `references/migration.md`
2. Use AWS Knowledge and Documentation MCP for current migration guidance
3. Use AWS API MCP only when live AWS inventory helps evaluate a target-state design

## Rules

- Separate rehost, replatform, and redesign choices clearly
- Treat cutover, rollback, and data consistency as core planning concerns
- Prefer staged migration plans over big-bang rewrites unless the user explicitly wants otherwise
