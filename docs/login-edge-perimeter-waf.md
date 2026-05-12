# Login Edge And Perimeter Security

## Scope
This repo now includes a CloudFront-scope AWS WAFv2 WebACL template for the login/API perimeter. It is deployable infrastructure, not a live production mutation.

## Asset
- `infra/aws/waf-login-security-cloudfront.yml`

Deploy the stack in `us-east-1` because CloudFront-scope WAF resources are global through that region. The template outputs a `WebACLArn`; attach that ARN to the CloudFront distribution `WebACLId`.

## Controls
| Control | Implementation |
|---|---|
| DDoS/app-layer baseline | AWS managed IP reputation, common rules, and known bad input rules |
| Login/OTP abuse | IP rate limit scoped to `/api/auth` and `/api/otp` |
| General API flood | IP rate limit scoped to `/api/` |
| Visibility | CloudWatch metrics and sampled requests enabled per rule |
| False-positive posture | Body size rule is excluded initially; tune after observing real request samples |

## Dry Run
```powershell
aws cloudformation validate-template --template-body file://infra/aws/waf-login-security-cloudfront.yml --region us-east-1
```

## Activation
1. Deploy the stack in a non-production account or staging distribution.
2. Review sampled requests for at least one normal login cycle.
3. Attach the `WebACLArn` to the CloudFront distribution.
4. Tune `AuthRateLimitPerFiveMinutes` and `ApiRateLimitPerFiveMinutes` from baseline traffic.
5. Only then promote the same stack parameters to production.
