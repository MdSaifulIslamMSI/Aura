# Cloudflare Security Hardening

This repo is prepared for Cloudflare as a defensive edge layer, but live zone changes must be made only from staging or production credentials that are explicitly configured outside git.

## Goals

- Keep all public traffic behind Cloudflare before it reaches the API origin.
- Block direct origin API access except documented health and webhook paths.
- Add edge rate limits for login, OTP, reset, refresh, checkout, admin, and webhook routes.
- Use WAF managed rules and narrowly scoped custom rules for e-commerce abuse patterns.
- Add Turnstile only on abuse-prone flows, with mandatory server-side token validation.
- Preserve deterministic local and CI security tests without depending on live Cloudflare services.

## Required Cloudflare Controls

| Control | Required behavior |
| --- | --- |
| Proxy | Production frontend and API hostnames must be proxied through Cloudflare. |
| TLS | Use Full strict TLS to origin. Do not use Flexible TLS for authenticated APIs. |
| Origin protection | Direct origin requests to sensitive `/api/*` routes must be blocked or require the origin verification secret. |
| Authenticated Origin Pulls | Enable where the origin stack supports mTLS. |
| WAF managed rules | Enable Cloudflare managed application security rules for the zone. |
| Rate limiting rules | Apply route-specific limits to auth, OTP, reset, refresh, checkout, admin, and webhook routes. |
| Bot friction | Add Turnstile to high-risk unauthenticated forms only after server-side validation is implemented. |
| Cache | Do not cache authenticated, account, checkout, payment, admin, or webhook responses. |
| Logs | Export Cloudflare security events to the SIEM/log pipeline without cookies, auth headers, OTPs, JWTs, or payment secrets. |

## Edge Rule Intent

The exact Cloudflare expression syntax should be generated and reviewed in the Cloudflare dashboard, Terraform, or the Cloudflare API for the target zone. The intent is:

- Challenge or block suspicious `POST /api/auth/login` bursts.
- Rate-limit `POST /api/otp/*`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, and refresh-token endpoints.
- Block direct browser access to webhook paths except the payment gateway source/signature flow.
- Block malformed methods on sensitive routes.
- Block requests with obvious NoSQL/prototype pollution payload keys in query strings where the route does not explicitly support filtering.
- Never trust client-supplied `X-Forwarded-For`, `X-Real-IP`, or `CF-Connecting-IP` inside the app unless the request path is known to be from Cloudflare/trusted proxy.

## Turnstile Rules

Turnstile is useful for login, OTP, password reset, contact/support abuse, and suspicious checkout retries. It must not be treated as security by itself:

- Validate every Turnstile token server-side through Cloudflare Siteverify.
- Treat tokens as short-lived and single-use.
- Fail closed when production Turnstile secrets are configured but validation fails.
- Keep local and CI tests on Cloudflare test fixtures only.

Backend Turnstile validation is wired behind `TURNSTILE_ENABLED`. Protected abuse-prone endpoints reject missing or invalid tokens only when Turnstile is enabled:

- `POST /api/otp/send`
- `POST /api/otp/verify`
- `POST /api/otp/reset-password`
- `POST /api/otp/check-user`
- `POST /api/auth/bootstrap-device-challenge`
- `POST /api/auth/recovery-codes/verify`

The frontend API layer forwards an optional `turnstileToken` on these public auth calls. Keep `TURNSTILE_ENABLED=false` until a real Cloudflare Turnstile widget is configured with `VITE_TURNSTILE_SITE_KEY` and the browser supplies a fresh token per request.

## CI Contract

`npm run security:cloudflare` is a static readiness gate. It checks that the repository keeps:

- Deployment security headers.
- Origin-protection smoke test coverage.
- Cloudflare hardening documentation.
- CI execution of the Cloudflare readiness gate.
- Optional Wrangler visibility when credentials are present.

It does not deploy Cloudflare resources and it does not require production secrets.

## CLI Activation

Wrangler can authenticate the local operator:

```powershell
npx wrangler login
npx wrangler whoami
```

This repository also includes a Cloudflare API activation script for free-tier-compatible security posture:

```powershell
npm run cloudflare:security:plan
npm run cloudflare:security:activate -- --zone=example.com
```

The plan command is read-only. The activate command requires a zone in the Cloudflare account and a token with enough permissions for zone settings and WAF rules. If the account has no zone, the script writes a report and exits without changing Cloudflare.

## Manual Activation Checklist

1. Rotate any historical secrets before activating edge protections.
2. Configure Cloudflare DNS records and proxy status for staging first.
3. Enable Full strict TLS and verify origin certificates.
4. Enable WAF managed rules in log/simulate mode, then enforce after review.
5. Add route-specific rate limiting rules.
6. Enable Authenticated Origin Pulls or equivalent origin firewall allowlisting.
7. Run `npm run security:all`.
8. Run `npm run security:origin-protection-smoke` with explicit staging origins.
9. Review Cloudflare security events for false positives.
10. Promote the same rule set to production after staging passes.

## References

- Cloudflare WAF rate limiting rules: https://developers.cloudflare.com/waf/rate-limiting-rules/
- Cloudflare Authenticated Origin Pulls: https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/
- Cloudflare Turnstile server-side validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
