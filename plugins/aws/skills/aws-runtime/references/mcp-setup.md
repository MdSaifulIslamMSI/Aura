# MCP Setup

This plugin currently enables two AWS-focused MCP servers:

- `aws-documentation-mcp-server`
  - Local Python package
  - Best for current AWS documentation lookups and exact doc sections
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

The AWS API MCP server needs local AWS credentials. If `aws sts get-caller-identity`
fails, authenticate first with one of:

- `aws login`
- `aws configure sso`
- `aws configure`

This plugin currently targets the `aura-bootstrap` AWS profile for the AWS API
MCP server.

The AWS Knowledge MCP server is not enabled in `.mcp.json` right now because
its remote endpoint has not been consistently handshaking in this environment.
If that endpoint becomes reliable again, revalidate it before re-enabling it.

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
confuse agents. This plugin keeps the Documentation + API combination active
because it works well on this machine without adding `uv` and proxy setup as a
hard requirement.
