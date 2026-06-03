# CloudFront WAF Rate-Limit Guidance

Use AWS WAF rate-based rules in front of CloudFront when Aura is deployed on AWS.

## Rule Groups

- Public read/search: count mode first, then block above the approved request-rate threshold.
- Auth and OTP: low threshold, CAPTCHA/challenge where compatible, block repeated failures.
- Payments and webhooks: never challenge signed provider webhooks; rely on signature, replay, and idempotency checks.
- AI and upload routes: low threshold and short windows because cost and memory blast radius are high.

## Deployment Notes

- Keep app-layer `trafficBudgetPolicy` enabled even when edge rules are active.
- Export sampled WAF logs to S3/CloudWatch for incident review.
- Roll back by moving a rule from blocking mode to count mode, not by disabling all WAF controls.
