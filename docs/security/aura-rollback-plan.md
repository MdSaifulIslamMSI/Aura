# Aura Security Fabric Rollback Plan

## Immediate Rollback

Set:

- `AURA_SECURITY_FABRIC_ENABLED=false`
- `AURA_SECURITY_BRAIN_ENFORCE=false`
- `AURA_SECURITY_FABRIC_ENFORCE=false`
- `AURA_TENANT_GUARD_ENFORCE=false`
- `AURA_INCIDENT_MODE_ENFORCE=false`

Keep `AURA_SECURITY_EVENT_LOGGING_ENABLED=true` unless logging is the confirmed failure source.

## Route Rollback

If flags do not resolve the issue, revert the route middleware integrations for the affected surface:

- Admin user routes.
- Admin status routes.
- Payment routes.
- Admin payment routes.
- Admin analytics export.
- Upload review media routes.
- AI routes and AI tool policy wrapper.

## Verification After Rollback

- Run the focused route test for the affected surface.
- Run `npm --prefix server test -- --runTestsByPath tests/auraSecurityFabric.test.js --forceExit`.
- Confirm auth, checkout, admin, upload, AI, and status routes use their existing behavior.
