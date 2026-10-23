# Origin Lockdown

This runbook keeps the API origin private behind the CDN/WAF edge.

## Controls

- Require the `x-aura-origin-verify` header at the app through `originProtectionMiddleware`.
- Configure the CDN to inject the verification header only on origin requests.
- In `NODE_ENV=production`, treat a missing verification secret as a deployment failure: protected routes return `503 ORIGIN_PROTECTION_MISCONFIGURED` rather than falling back to direct-origin access.
- Restrict direct origin ingress to provider edge IP ranges where the platform supports allowlists.
- Keep `/health`, `/metrics`, and signed provider webhooks on the minimal bypass list.
- Use `CloudFront-Viewer-Address` for rate-limit identity only after the origin header is verified. Direct clients must not be able to choose their bucket by sending it.
- Treat direct origin reachability as a critical incident because X-Forwarded-For can only be trusted after the edge boundary is intact.

## Verification

- Run `npm run security:origin-protection-smoke` for the existing app-layer origin guard.
- Run `node scripts/security/check-origin-exposure.mjs --json --markdown` for local evidence.
- Probe production origins only from approved security windows. The default script does not send live probes.

## Rollback

If the edge header is misconfigured, restore the CDN header injection and the matching Parameter Store secret. Do not disable `originProtectionMiddleware` or release a production backend with the secret missing. If emergency access is required, use an explicitly approved break-glass path after the deployment owner confirms direct origin exposure is blocked.
