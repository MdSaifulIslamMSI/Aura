# Trust Action Registry

The central registry lives in `server/trust/policies/actionRegistry.js`. Policies are split by domain so route owners can add actions without editing the evaluator.

Each action defines:

- `action`
- `resourceType`
- `allowedRoles`
- `requiresIdentity`
- `requiresOwnership`
- `adminBypassesOwnership`
- `tenantRequired`
- `sensitive`
- `stepUp`
- `audit`
- `riskThreshold`
- `allowedStates`
- `denyStates`
- `requireIdempotency`
- `riskyWrite`

## Initial Actions

- `order.read`
- `order.cancel`
- `order.refund.request`
- `admin.order.refund`
- `admin.product.delete`
- `admin.user.role.update`
- `admin.security.setting.update`
- `payment.webhook.process`
- `payment.refund.create`
- `upload.create`
- `upload.approve`
- `ai.chat.invoke`
- `ai.media.analyze`
- `user.profile.update`
- `user.address.update`
- `auth.mfa.disable`
- `auth.passkey.remove`

## Example

`admin.order.refund` requires an admin actor, is sensitive, prefers passkey step-up, requires audit, has a high-risk threshold of 60, and only allows paid/processing/partially fulfilled/delivered order states.

To add a new route, prefer a named policy over inline options. The route should call `requireTrustDecision` with the registry action and a trusted loader.
