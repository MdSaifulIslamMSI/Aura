# Payment Authorization Policy

Foundation policy helper: `server/services/payments/foundation/paymentPolicy.js`.

Rules:

- User can create payment only for their own order/cart resource.
- User can read their own payment intent.
- Admin or `payment:refund` role can refund.
- High-value refunds require an approval marker.
- Support users cannot read sensitive provider metadata unless explicitly granted.
- Webhooks bypass user auth only after signature verification.

OPA/Keycloak path:

- Map Keycloak roles into `principal.roles`.
- Keep OPA-style action names such as `payment:create`, `payment:read`, and `payment:refund`.
- Add persisted policy decisions to audit logs when route integration is added.
