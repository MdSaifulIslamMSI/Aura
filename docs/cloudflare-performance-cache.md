# Cloudflare Performance Cache

Cloudflare is optional. CI and local tests do not require Cloudflare credentials.

## Safe Free-Plan Rules

Cache aggressively:

- hashed JS and CSS assets
- images
- fonts
- static files with immutable filenames

Do not cache:

- private HTML by default
- authenticated API responses
- requests with `Authorization`
- requests with `Cookie`
- admin, auth, user, payment, upload, uploads, or webhook routes
- mutating methods

Optional short TTL API cache:

- only explicitly public API `GET` routes
- 60 to 120 seconds
- purge after deploy

## Dashboard Steps

1. Open Cloudflare dashboard for the zone.
2. Add a cache rule for static assets:
   - URI path ends with static extensions such as `.js`, `.css`, `.png`, `.webp`, `.svg`, `.woff2`.
   - Browser/cache TTL: one year.
3. Add bypass rules:
   - `Authorization` header exists.
   - `Cookie` header exists.
   - URI path starts with `/api/auth`, `/api/admin`, `/api/user`, `/api/me`, `/api/payment`, `/api/upload`, `/api/uploads`, or `/api/webhooks`.
4. Add optional public API rule only after verifying the endpoint is public and user-independent.
5. Purge cache after deploy.

## Script

```sh
npm run cloudflare:performance:plan
```

With `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID`, the script prints the reviewed plan. Without credentials, it prints dashboard steps and exits 0.
