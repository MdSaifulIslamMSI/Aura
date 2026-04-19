---
name: "aws-event-driven"
description: "AWS event-driven architecture guidance. Use when working with SQS, SNS, EventBridge, Step Functions, retries, dead-letter queues, fan-out, idempotency, async workflows, or service decoupling patterns in AWS."
---

# AWS Event Driven

Use this skill for asynchronous and event-driven AWS workflows.

## Do First

1. Read `references/event-driven.md`
2. Use AWS Knowledge and Documentation MCP for current queue, bus, and workflow patterns
3. Use AWS API MCP to inspect queue, topic, bus, or state-machine configuration when live access exists

## Rules

- Treat retries, idempotency, ordering, and dead-letter behavior as core design concerns
- Separate producer issues from consumer issues and orchestration issues
- Prefer explicit failure handling over silent retry loops
