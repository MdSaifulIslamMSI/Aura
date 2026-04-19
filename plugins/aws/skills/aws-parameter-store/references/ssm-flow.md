# SSM Flow

The repo's sync script is `infra/aws/sync-parameter-store-env.ps1`.

## Inputs

- `-SourceEnvFile`
- `-PathPrefix`
- `-AwsRegion`
- `-AwsProfile`
- `-DryRun`

## Default Repo Commands

- Repo shortcut:

```powershell
npm run aws:ssm:sync
```

- Backend example dry-run:

```powershell
cd server
npm run aws:ssm:sync:example
```

- Contract audit:

```powershell
cd server
npm run aws:ssm:audit
```

## Script Behavior

- Requires `aws` on `PATH`
- Requires an AWS region and a Parameter Store path prefix
- Parses `KEY=VALUE` lines from the source env file
- Skips blank lines, comments, malformed lines, and placeholder values
- Writes publishable entries with `aws ssm put-parameter --type SecureString --overwrite`

## Operational Advice

- Run an audit or dry-run before a live sync
- Use the example secret file to check contract drift without exposing live values
- If path prefix is blank, resolve it from `AWS_PARAMETER_STORE_PATH_PREFIX` or
  pass it explicitly
