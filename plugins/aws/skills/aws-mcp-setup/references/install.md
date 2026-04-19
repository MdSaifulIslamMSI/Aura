# Install

## Bootstrap the plugin

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\plugins\aws\scripts\bootstrap-aws-mcp.ps1
```

That script:

- installs `awslabs.aws-documentation-mcp-server`
- installs `awslabs.aws-api-mcp-server`
- verifies the Python modules import successfully
- checks that `aws` is available on `PATH`

## Verify readiness

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\plugins\aws\scripts\doctor-aws-plugin.ps1
```

Use `-Json` if a machine-readable report is helpful:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\plugins\aws\scripts\doctor-aws-plugin.ps1 -Json
```

## Configure credentials

If the doctor script or `aws sts get-caller-identity` reports missing
credentials, sign in with one of:

- `aws login`
- `aws configure sso`
- `aws configure`

This plugin currently targets the `aura-bootstrap` AWS profile for the AWS API
MCP server.

## Safer mutation path

The plugin defaults to read-only AWS API MCP usage.

Before enabling writes, generate a security policy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\plugins\aws\scripts\write-aws-api-mcp-security-policy.ps1
```
