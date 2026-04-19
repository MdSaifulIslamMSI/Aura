# Changelog

## 0.6.1 - 2026-04-20

- fixed `doctor-aws-plugin.ps1` so cached plugin installs resolve the real workspace from `.mcp.json`
- updated command and skill instructions to use `powershell -NoProfile -ExecutionPolicy Bypass -File ...`
- disabled the AWS Knowledge MCP server in `.mcp.json` until the remote endpoint is reliably usable again

## 0.6.0 - 2026-04-20

- expanded the AWS plugin into a more publishable package shape
- added guided solution starter playbooks under `examples/`
- added a copy-paste prompt library for faster onboarding
- added `/aws:solution-map`, `/aws:architecture-review`, `/aws:security-review`, and `/aws:validate-plugin`
- added `scripts/validate-aws-plugin.ps1` for static package validation
- added `assets/aws-skill-map.svg` for a quick visual overview of the plugin surface
- refined metadata and README messaging around 32 focused AWS skills and broader public use

## 0.5.0 - 2026-04-20

- expanded the skill surface to 32 focused AWS skills
- added Elasticache, OpenSearch, Secrets Manager, KMS, Route 53, WAF, analytics, and migration or modernization workflows
- broadened plugin metadata and agent descriptions to reflect wider AWS platform coverage

## 0.4.0 - 2026-04-20

- stabilized AWS MCP bootstrap and doctor flows
- aligned the plugin with the local `aura-bootstrap` AWS profile
- kept the AWS API MCP server in a safer read-only default posture
