# Invisible App Fabric

The Invisible App Fabric is a defensive exposure-minimization layer around Aura. It does not make the public frontend invisible. It makes sensitive infrastructure, admin, backend origin, internal services, and dangerous actions non-public, policy-gated, and minimized.

## What It Does

- Keeps backend origin shielding behind a trusted-edge header when explicitly enabled.
- Classifies backend route exposure as public, authenticated, admin, internal, webhook, health, honeypot, or disabled.
- Cloaks anonymous admin and internal route probing with generic not-found responses.
- Blocks production debug routes.
- Scans frontend source and build output for server-side secret markers.
- Routes sensitive actions through existing auth, authorization, replay, rate-limit, audit, and response-minimization controls.
- Adds safe honeypots for common probe paths such as `/.env` and `/.git/config`.

## What It Does Not Do

- It does not hide abusive behavior or evade security tools.
- It does not remove the public storefront, SEO content, static assets, or provider webhook ingress.
- It does not replace existing auth, payment, upload, webhook, CSRF, CORS, or rate-limit controls.

## Runtime Flags

Use the checked-in examples as documentation only. Keep `INVISIBLE_TRUSTED_EDGE_SECRET` empty in git and set it in the runtime secret manager.

Trusted edge mode must stay off until the CDN, WAF, tunnel, or reverse proxy injects `INVISIBLE_TRUSTED_EDGE_HEADER` on every valid request to the backend origin.

## Verification

Run:

```sh
npm run security:invisible-fabric
npm run security:route-exposure
npm run security:frontend-secrets
npm run security:authz
npm run security:internal-exposure
```

For broad changes, also run `npm test`, `npm run lint`, and `npm run build`.

## Rollback

Set `INVISIBLE_FABRIC_ENABLED=false` to disable the fabric layer while preserving existing security controls. If only trusted edge mode causes a deployment issue, set `INVISIBLE_REQUIRE_TRUSTED_EDGE=false` first.
