---
name: "aws-bedrock-ai"
description: "AWS Bedrock guidance. Use when evaluating or integrating foundation models, inference APIs, guardrails, knowledge bases, agents, retrieval workflows, model access, or AI application architecture built on Amazon Bedrock."
---

# AWS Bedrock AI

Use this skill for Bedrock and AI-app integration work in AWS.

## Do First

1. Read `references/bedrock.md`
2. Use AWS Knowledge and Documentation MCP for current Bedrock capabilities and provider-specific notes
3. Use AWS API MCP to inspect account-level Bedrock setup when live access exists and the required permissions are available

## Rules

- Separate model-choice questions from system-design questions
- Treat cost, latency, retrieval quality, and safety controls as design tradeoffs
- Review guardrails, knowledge sources, and agent behavior before scaling usage
