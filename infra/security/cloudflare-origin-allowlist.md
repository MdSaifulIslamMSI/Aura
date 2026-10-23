# Cloudflare Origin Allowlist

Cloudflare should be the only internet-facing path to the Aura API origin.

## Boundary

- `originProtectionMiddleware` rejects requests without the CDN-provided origin verification header.
- In production, a missing origin verification secret fails closed with `503 ORIGIN_PROTECTION_MISCONFIGURED`; health, metrics, and signed provider webhooks remain exempt.
- `app.set('trust proxy', 1)` means Express trusts one proxy hop, not arbitrary client-provided `X-Forwarded-For`.
- Forwarded headers such as `X-Forwarded-For`, `CF-Connecting-IP`, and `X-Real-IP` are useful only after the direct-origin path is closed.
- `CloudFront-Viewer-Address` is trusted for rate-limit identity only after the origin verification header is validated (`req.auraOriginVerified`). A direct-origin client cannot select its bucket by sending that header.
- Provider webhooks remain on signed allow paths and must keep signature/replay validation.

## Free Controls

- Orange-cloud the public hostname.
- Keep WAF managed rules enabled.
- Add rate rules from `infra/cloudflare/free-security-rules.json`.
- Prefer Cloudflare tunnel, private load balancer targets, or security-group allowlists when available.

## Evidence

Run:

```sh
node scripts/security/check-origin-exposure.mjs --json --markdown
node scripts/security/check-trusted-proxy-headers.mjs --json --markdown
```
