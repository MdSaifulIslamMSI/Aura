## Summary

- adds fail-closed Vercel staging frontend autopilot
- adds Docker-hosted AWS staging frontend fallback for projects where Vercel custom staging or branch Preview env writes are blocked
- adds frontend staging smoke that proves `/api`, `/health`, `/uploads`, and `/socket.io` route to the isolated AWS staging backend
- adds staging frontend CORS coverage and production fallback scanning
- documents custom environment vs Preview branch fallback behavior

## Safety Guarantees

- staging frontend cannot pass smoke if it points to production backend, production CloudFront, or `/aura/prod`
- generic Vercel Preview remains frontend-only unless the generated deployment passes the staging smoke contract
- Docker staging frontend refuses to deploy bundles containing production hosts or `/aura/prod`
- production Vercel env vars are not overwritten
- CORS remains explicit; no wildcard staging frontend allowlist is introduced

## Tests

- `npm run env:validate`
- `npm run staging:verify`
- `npm run smoke:preflight`
- `npm run smoke:staging`
- `npm run smoke:staging:frontend`
- `npm run scan:prod-fallbacks`
- `npm --prefix server test -- --runTestsByPath tests/stagingSmokeSafety.test.js tests/envContractScripts.test.js tests/corsFlags.test.js tests/stagingFrontendCors.test.js tests/config.headers.security.test.js`
- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run security:secrets`
