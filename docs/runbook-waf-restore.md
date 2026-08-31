# Runbook: Restore the Aura Login Edge WAF

Status: **WAF cost-cut off on 2026-08-29.** Both `aura-login-security-*` CloudFormation
stacks (each containing only the billable `AWS::WAFv2::WebACL`) were deleted after the
WebACLs were disassociated from all CloudFront distributions. Traffic protection at the
edge is currently handled solely by the in-app traffic-policy middleware
(`server` abuse-score / rate-limit layer).

## What was deleted

| Stack (us-east-1) | WebACL | ARN |
| --- | --- | --- |
| `aura-login-security-production` | `aura-login-security-production` | `arn:aws:wafv2:us-east-1:942679464475:global/webacl/aura-login-security-production/734ca228-8ba7-4f49-9f6f-2871e0f6d85a` |
| `aura-login-security-staging` | `aura-login-security-staging` | `arn:aws:wafv2:us-east-1:942679464475:global/webacl/aura-login-security-staging/0b5f0199-3ee6-4ab1-ad0a-2d57192299ba` |

Each stack contained only the WebACL (5 rules: 2 rate-based, 3 AWS-managed rule
groups; capacity 935). Parameters: `AuthRateLimitPerFiveMinutes=500`,
`ApiRateLimitPerFiveMinutes=3000`.

## Restore procedure (~5 minutes)

1. Deploy both stacks (requires admin profile, e.g. `AWS_PROFILE=aura-admin-cli`):

   ```bash
   aws cloudformation deploy \
     --stack-name aura-login-security-production \
     --template-file infra/aws/waf-login-security-cloudfront.yml \
     --parameter-overrides EnvironmentName=production \
     --region us-east-1

   aws cloudformation deploy \
     --stack-name aura-login-security-staging \
     --template-file infra/aws/waf-login-security-cloudfront.yml \
     --parameter-overrides EnvironmentName=staging \
     --region us-east-1
   ```

2. Read the new WebACL ARNs:

   ```bash
   aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1 \
     --output text --query 'WebACLs[].ARN'
   ```

3. Attach to the distributions (CloudFront `WebACLId` takes the WebACL ARN):

   ```bash
   aws cloudfront get-distribution-config --id E34Z9POGIQYOCS --output json
   # -> set DistributionConfig.WebACLId to the production WebACL ARN, then:
   aws cloudfront update-distribution --id E34Z9POGIQYOCS \
     --cli-input-json fileb://<config-with-IfMatch-and-WebACLId>.json
   # staging distribution: E1SZSF4W3BBBZQ
   ```

   NOTE: use `--cli-input-json`; the `--if-match` + `--distribution-config
   fileb://` form trips an AWS CLI argument-customization bug.

4. Verify: `get-distribution` shows the new `WebACLId`, status returns to
   `Deployed`, and `scripts/security/waf-smoke-test.mjs` / the security
   maturity scorecard pass again.

## Notes

- The disassociation that preceded this cutoff is verified in
  `reports/waf-disassociate/E34Z9POGIQYOCS-*.json` (pre-change distribution
  config snapshot).
- `scripts/security/disassociate-login-waf-cloudfront.mjs` is the reusable
  disassociate/rollback tool (dry-run by default, `--apply` to mutate).
- While the WAF is absent, edge IP-reputation filtering and the 500/5-min
  auth + 3,000/5-min API edge rate limits are NOT active. In-app rate
  limiting remains.
