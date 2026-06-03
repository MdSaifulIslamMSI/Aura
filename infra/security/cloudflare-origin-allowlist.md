# Cloudflare Origin Allowlist

Cloudflare should be the only internet-facing path to the Aura API origin.

## Boundary

- `originProtectionMiddleware` rejects requests without the CDN-provided origin verification header.
- `app.set('trust proxy', 1)` means Express trusts one proxy hop, not arbitrary client-provided `X-Forwarded-For`.
- Forwarded headers such as `X-Forwarded-For`, `CF-Connecting-IP`, and `X-Real-IP` are useful only after the direct-origin path is closed.
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
