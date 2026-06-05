# Secretless Frontend

Anything shipped to the browser is public. The frontend may use explicitly public configuration such as `VITE_*` Firebase web config or publishable payment keys, but it must never contain backend credentials, database URLs, private keys, JWT secrets, admin tokens, Redis URLs, or provider secret keys.

## Scanner

Run:

```sh
npm run security:frontend-secrets
```

The scanner checks `app/src`, `app/public`, `app/index.html`, Vite config, and `app/dist` when it exists. Findings are written to `reports/security/frontend-secretless-scan.json`. Values are masked in console output.

## Test Fixtures

Fake secret fixtures are allowed only in clearly isolated test files or fixtures. Do not place realistic secret values in production frontend code, public assets, or build output.

## Rollback

If a false positive blocks a release, isolate the fixture under a test path or remove the risky identifier from browser-delivered code. Do not bypass the scanner for real source or build output.
