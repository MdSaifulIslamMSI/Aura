# Runtime Secrets

## Main files

- `infra/aws/render-runtime-secrets.sh`
- `infra/aws/deploy-release.sh`
- `infra/aws/docker-compose.ec2.yml`

## Flow

- Resolve `AWS_REGION` or `AWS_DEFAULT_REGION`
- Resolve `AWS_PARAMETER_STORE_PATH_PREFIX`
- Read parameters by path with decryption
- Emit `KEY=VALUE` lines into `/opt/aura/shared/runtime-secrets.env` by default
- Set file mode to `600`

## Operational Advice

- Do not log or print the generated env file contents
- Review env file precedence alongside `base.env` and `release.env`
- Preserve newline escaping so multi-line secrets stay valid in env format
