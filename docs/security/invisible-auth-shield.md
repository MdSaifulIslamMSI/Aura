# Aura Invisible Auth Shield

Aura Invisible Auth Shield is a centralized trust decision layer around the existing auth system. It does not replace Firebase/Auth-provider verification, browser sessions, admin middleware, resource owner checks, MFA, trusted device flows, or existing sensitive-action policy.

The shield evaluates a sensitive request as:

```txt
identity + session + action + resource + tenant + relationship + risk + replay + policy + step-up + audit
```

## What It Does

- Extracts server-side identity from `req.user`, `req.authToken`, `req.authIdentity`, and `req.authSession`.
- Builds request/session context with request ID, auth age, method/path, device ID, nonce, proof headers, and body hash.
- Evaluates device trust and DPoP-like proof headers behind disabled-by-default flags.
- Uses Redis-backed replay checks with in-memory test fallback.
- Resolves resources from trusted server-side models when possible.
- Checks owner/buyer/seller/admin relationships.
- Applies local policy decision priority and leaves OPA/OpenFGA adapter boundaries.
- Emits redacted `authshield.decision` audit events.
- Defaults to disabled and shadow-safe behavior.

## What It Does Not Do

- It does not replace existing auth middleware.
- It does not store or log raw tokens, cookies, OTPs, passwords, private keys, card data, or raw request bodies.
- It does not enable DPoP, device trust, or step-up globally by default.
- It does not wrap public read routes in this first rollout.
- It does not merge any production rollout or deployment state.

## Main API

```js
const authShield = require('../security/authShield');

const decision = await authShield.enforce(req, {
    action: 'payment.refund',
    resource: {
        type: 'order',
        id: orderId,
        ownerId,
        buyerId,
        sellerId,
        tenantId,
    },
    sensitivity: 'critical',
    requireFreshAuth: true,
    requireDeviceProof: true,
});
```

Decision shape:

```js
{
    decision: 'allow' | 'deny' | 'step_up_required' | 'shadow_deny',
    action: 'payment.refund',
    sensitivity: 'critical',
    riskLevel: 'low',
    reasons: [],
    policyVersion: '2026-06-05',
    requestId: '...',
    auditId: '...'
}
```

## Route Integration Pattern

Direct middleware use:

```js
const { authShieldMiddleware } = require('../middleware/authShieldMiddleware');
const { resourceResolvers } = require('../security/authShield/resourceResolver');

router.post(
    '/orders/:id/refund',
    protect,
    authShieldMiddleware({
        action: 'payment.refund',
        sensitivity: 'critical',
        resourceResolver: resourceResolvers.paymentRefund,
        requireFreshAuth: true,
        requireDeviceProof: true,
    }),
    controller
);
```

Current first integration composes the middleware into `routeSecurityGuards.routeSensitiveAction`, so existing `sensitiveActions.*` routes are wrapped without replacing route auth.

## Environment Flags

```env
AUTH_SHIELD_ENABLED=false
AUTH_SHIELD_SHADOW_MODE=true
AUTH_SHIELD_AUDIT_ENABLED=true
AUTH_SHIELD_REPLAY_GUARD_ENABLED=true
AUTH_SHIELD_DPOP_ENABLED=false
AUTH_SHIELD_DEVICE_TRUST_ENABLED=false
AUTH_SHIELD_STEP_UP_ENABLED=false
AUTH_SHIELD_RISK_ENGINE_ENABLED=true
AUTH_SHIELD_FAIL_CLOSED_ACTIONS=admin.*,payment.*,auth.mfa.*,auth.password.*,auth.email.*,auth.role.*,security.*
AUTH_SHIELD_STEP_UP_TTL_CRITICAL_SECONDS=300
AUTH_SHIELD_STEP_UP_TTL_HIGH_SECONDS=900
AUTH_SHIELD_REPLAY_TTL_SECONDS=300
AUTH_SHIELD_POLICY_VERSION=2026-06-05
```

Safe defaults mean code can ship with the shield disabled, then move through shadow and fail-closed stages.
