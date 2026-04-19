# MCP Setup

This plugin exposes three AWS-focused MCP servers:

- `aws-knowledge-mcp-server`
  - Remote AWS-managed endpoint
  - Best for current AWS guidance, agent SOPs, code samples, and best practices
- `aws-documentation-mcp-server`
  - Local Python package
  - Best for direct AWS documentation lookups and exact doc sections
- `aws-api-mcp-server`
  - Local Python package
  - Best for live AWS inspection and, if explicitly enabled later, guarded AWS changes

## Bootstrap

Install the local Python packages:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\plugins\aws\scripts\bootstrap-aws-mcp.ps1
```

Check plugin readiness:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\plugins\aws\scripts\doctor-aws-plugin.ps1
```

## Authentication

The Knowledge server can still be useful without local AWS credentials because
it is a remote managed endpoint.

The AWS API MCP server needs local AWS credentials. If `aws sts get-caller-identity`
fails, authenticate first with one of:

- `aws login`
- `aws configure sso`
- `aws configure`

This plugin currently targets the `aura-bootstrap` AWS profile for the AWS API
MCP server.

## Safety Defaults

- `.mcp.json` keeps `READ_OPERATIONS_ONLY=true`
- `.mcp.json` keeps `REQUIRE_MUTATION_CONSENT=true`
- The working directory is pinned to this repo so file-access-capable AWS CLI
  operations stay scoped to the workspace by default

If the user later needs write access through the AWS API MCP server, generate a
security policy first:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\plugins\aws\scripts\write-aws-api-mcp-security-policy.ps1
```

## AWS MCP Server (Preview)

AWS now offers a unified AWS MCP Server (Preview). AWS documentation recommends
avoiding overlapping old and new server setups because tool conflicts can
confuse agents. This plugin keeps the classic Knowledge + Documentation + API
combination active because it works well on this machine without adding `uv`
and proxy setup as a hard requirement.
