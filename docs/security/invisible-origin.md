# Invisible Origin

Trusted edge mode blocks direct backend origin access when enabled.

## Required Edge Setup

Configure the CDN, WAF, reverse proxy, or tunnel to inject the configured header:

```txt
INVISIBLE_TRUSTED_EDGE_HEADER=x-aura-edge-secret
INVISIBLE_TRUSTED_EDGE_SECRET=<runtime secret only>
```

The backend compares this header with a timing-safe check. Missing or wrong headers return a generic not-found response and never include the expected value.

## Safe Rollout

1. Deploy with `INVISIBLE_REQUIRE_TRUSTED_EDGE=false`.
2. Configure the edge to inject the header for app, API, webhook, upload, socket, and health traffic.
3. Smoke test through the edge.
4. Enable `INVISIBLE_REQUIRE_TRUSTED_EDGE=true` in staging.
5. Repeat in production.

## Rollback

Set `INVISIBLE_REQUIRE_TRUSTED_EDGE=false`. Do not remove existing `AURA_CLOUDFRONT_ORIGIN_VERIFY_SECRET` controls unless separately approved.
