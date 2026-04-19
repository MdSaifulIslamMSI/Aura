---
name: "aws-s3-storage"
description: "AWS S3 workflow guidance. Use when designing or debugging buckets, object access, lifecycle rules, static hosting, signed URLs, uploads, encryption, public access posture, or storage-event integrations."
---

# AWS S3 Storage

Use this skill for bucket and object-storage work.

## Do First

1. Read `references/s3.md`
2. Use AWS Knowledge and Documentation MCP for current S3 patterns and guardrails
3. Use AWS API MCP to inspect bucket config and policy state when appropriate

## Rules

- Treat public access as a security decision, not a shortcut
- Review bucket policy, ACL posture, Block Public Access, and encryption together
- Distinguish client-upload issues from bucket policy or CORS issues
