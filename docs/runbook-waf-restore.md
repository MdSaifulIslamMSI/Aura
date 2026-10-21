# Runbook: Restore the Aura Login Edge WAF

Status: **WAF cost-cut off on 2026-08-29, and still off today.** The two
`aura-login-security-*` CloudFormation stacks (each containing only the billable
`AWS::WAFv2::WebACL`) were deleted after the WebACLs were disassociated from all
CloudFront distributions. Traffic protection at the edge is currently handled solely
by the in-app traffic-policy middleware (`server` abuse-score / rate-limit layer).

**Both deleted WebACLs lived in the old AWS account `942679464475`, which is being
closed.** The ARNs previously recorded here are dead — `GetWebACL` on them returns
`WAFNonexistentItemException`. Do not attempt to re-attach them.

**Production today has no WAF either.** The live distribution is
`EZZ7ARQ9QFQ71` in account `517353742644`, and its `WebACLId` is empty:

```
aws cloudfront get-distribution --id EZZ7ARQ9QFQ71 \
  --profile aura-new-admin --query 'Distribution.WebACLId' --output text
```

Restoring WAF means deploying the template **into the new account** and attaching it
to `EZZ7ARQ9QFQ71`.

## What was deleted (old account `942679464475`)

| Stack (us-east-1) | WebACL | ARN (now dead) |
| --- | --- | --- |
| `aura-login-security-production` | `aura-login-security-production` | `arn:aws:wafv2:us-east-1:942679464475:global/webacl/aura-login-security-production/734ca228-8ba7-4f49-9f6f-2871e0f6d85a` |
| `aura-login-security-staging` | `aura-login-security-staging` | `arn:aws:wafv2:us-east-1:942679464475:global/webacl/aura-login-security-staging/0b5f0199-3ee6-4ab1-ad0a-2d57192299ba` |

Each stack contained only the WebACL (5 rules: 2 rate-based, 3 AWS-managed rule
groups; capacity 935). Parameters: `AuthRateLimitPerFiveMinutes=500`,
`ApiRateLimitPerFiveMinutes=3000`.

## Restore procedure (~10 minutes)

1. Deploy the stacks into the **new** account (`517353742644`). WAFv2 CloudFront
   scope must be created in `us-east-1`:

   ```bash
   aws cloudformation deploy \
     --stack-name aura-login-security-production \
     --template-file infra/aws/waf-login-security-cloudfront.yml \
     --parameter-overrides EnvironmentName=production \
     --region us-east-1 \
     --profile aura-new-admin

   aws cloudformation deploy \
     --stack-name aura-login-security-staging \
     --template-file infra/aws/waf-login-security-cloudfront.yml \
     --parameter-overrides EnvironmentName=staging \
     --region us-east-1 \
     --profile aura-new-admin
   ```

2. Read the new WebACL ARN:

   ```bash
   aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1 \
     --profile aura-new-admin --output text --query 'WebACLs[].ARN'
   ```

3. Attach to the production distribution (`EZZ7ARQ9QFQ71`):

   ```bash
   aws cloudfront get-distribution-config --id EZZ7ARQ9QFQ71 --output json
   # -> set DistributionConfig.WebACLId to the production WebACL ARN, then:
   aws cloudfront update-distribution --id EZZ7ARQ9QFQ71 \
     --cli-input-json file://<config-with-IfMatch-and-WebACLId>.json
   ```

   NOTE: use `--cli-input-json`; the `--if-match` + `--distribution-config
   file://` form trips an AWS CLI argument-customization bug.

   The staging edge is currently decommissioned — its old distribution
   `E1SZSF4W3BBBZQ` was deleted with the old account. The `STAGING_*` endpoint
   variables have since been cleared in both the repository scope and the
   `staging` environment scope, so the staging lanes skip instead of probing a
   dead hostname; `STAGING_INFRA_PAUSED` remains `true` and
   `STAGING_DEPLOY_ENABLED` is `false`. Do not attach a staging WebACL until a
   staging distribution exists again.

4. Verify: `get-distribution` shows the new `WebACLId`, status returns to
   `Deployed`, and `scripts/security/waf-smoke-test.mjs` / the security
   maturity scorecard pass again.

## Notes

- The disassociation that preceded this cutoff is verified in
  `reports/waf-disassociate/E34Z9POGIQYOCS-*.json` (pre-change distribution
  config snapshot for the old, now-deleted distribution).
- `scripts/security/disassociate-login-waf-cloudfront.mjs` is the reusable
  disassociate/rollback tool (dry-run by default, `--apply` to mutate).
- While the WAF is absent, edge IP-reputation filtering and the 500/5-min
  auth + 3,000/5-min API edge rate limits are NOT active. In-app rate
  limiting remains.
- The `aura-admin-cli` AWS profile this runbook used to reference was deleted
  with the old account. Use `aura-new-admin`.
