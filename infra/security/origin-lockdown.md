# Origin Lockdown

This runbook keeps the API origin private behind the CDN/WAF edge.

## Controls

- Require the `x-aura-origin-verify` header at the app through `originProtectionMiddleware`.
- Configure the CDN to inject the verification header only on origin requests.
- Restrict direct origin ingress to provider edge IP ranges where the platform supports allowlists.
- Keep `/health`, `/metrics`, and signed provider webhooks on the minimal bypass list.
- Treat direct origin reachability as a critical incident because X-Forwarded-For can only be trusted after the edge boundary is intact.

## Verification

- Run `npm run security:origin-protection-smoke` for the existing app-layer origin guard.
- Run `node scripts/security/check-origin-exposure.mjs --json --markdown` for local evidence.
- Probe production origins only from approved security windows. The default script does not send live probes.

## Rollback

If the edge header is misconfigured, disable the CDN origin-header rule, keep app rate limits enabled, and restore access only after the deployment owner confirms that direct origin exposure is still blocked.
