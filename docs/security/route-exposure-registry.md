# Route Exposure Registry

The route exposure registry lives in `server/security/invisibleFabric/routeExposureRegistry.js`.

## Classifications

- `public`: intentionally discoverable public product, market, status, or auth bootstrap surface.
- `authenticated`: requires a user session or bearer token before returning sensitive data.
- `admin`: requires admin role plus step-up policy where dangerous.
- `internal`: operational route not intended for anonymous public discovery.
- `webhook`: public ingress route that must verify provider signature or token.
- `health`: minimal health or readiness route.
- `honeypot`: defensive canary route that never returns real data.
- `disabled`: production-disabled route such as debug tooling.

## CI Gate

Run:

```sh
npm run security:route-exposure
```

The gate fails for unclassified routes, admin/internal routes marked public, webhook routes without signature markers, stale manifests, production debug exposure without the global blocker, and sensitive routes without policy markers.

Update the manifest after intentional route changes:

```sh
node scripts/security/invisible-route-exposure.mjs --update
```
