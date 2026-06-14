# God-Level Negative Test Design Plan

Last updated: 2026-06-14

This plan adapts the universal negative-testing standard to Aura Marketplace. It is a test-design source of truth, not a claim that the app is bug-free. The goal is to make invalid actors, invalid resources, invalid states, invalid tokens, invalid sequences, replay, races, and side effects fail before dangerous code runs.

Use it with:

- `server/security/sensitiveActionRegistry.js` for canonical sensitive actions.
- `docs/security/route-enforcement-coverage.md` for high-risk route coverage.
- `SECURITY_TEST_PLAN.md` for current security suites and known limitations.
- `server/tests/helpers/securityTestHelpers.js` for reusable test actors, resources, and no-mutation assertions.
- `tests/auth/helpers/matrix-engine.js` and `tests/auth/matrix/auth-test-matrix.json` for auth matrix generation.

## Core Formula

For every sensitive action, design cases with this shape:

```text
ACTOR + AUTH + ACTION + RESOURCE + STATE + INPUT + SEQUENCE + SIDE_EFFECT
```

A strong negative test does not stop at `403`. It proves:

- the response is safely denied,
- the protected resource is unchanged,
- no token, payment, email, upload, refund, room, or order side effect happened,
- the error body does not leak sensitive data,
- the expected audit or security event exists for serious blocked attempts.

## Aura Security Map

| Feature | Routes or actions | Allowed actor | Resource and state | Server-owned fields | Must never happen | Existing evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Login, sessions, recovery, OTP, MFA, passkeys | `authRoutes`, `otpRoutes`, `auth.*`, `session.revoke` | Anonymous only for proof establishment; authenticated user with required freshness/MFA for changes | User, session, OTP, recovery grant, trusted device | `authUid`, `userId`, role, assurance, `auth_time`, OTP purpose, consumed flags | Password or factor change without a fresh valid proof; wrong-purpose grant; replayed recovery code; deleted/suspended user acts | `npm run security:auth`, `npm run security:tokens`, `npm run security:otp-reset`, `npm run test:auth:critical` |
| Admin control plane | `admin*Routes`, `admin.*`, `database.maintenance`, `status.adminupdate` | Active admin/support role with required step-up for the action | Users, products, payments, fraud decisions, status incidents, maintenance jobs | `isAdmin`, `adminRoles`, admin reason, audit actor, target tenant | Normal user or inactive admin mutates data; lower admin performs super-admin action; mutation happens before permission check | `npm run security:admin`, `npm run security:access-control`, `npm run security:routes:coverage:strict` |
| Orders, checkout, refunds, payment intents | `orderRoutes`, `paymentRoutes`, `order.cancel`, `payment.create`, `payment.refund` | Owner for customer actions; admin/support for privileged refund flows | Order, product stock, payment intent, payment method, refund request | Price, tax, stock, owner, currency, payment state, settlement values | Client-set price/payment state wins; wrong owner refunds/cancels; invalid state transition; duplicate order or refund side effect | `npm run security:business-logic`, `npm run security:idor`, `npm run payment:test` |
| Payment webhooks | `/api/payments/webhooks/*`, `payment.webhook.receive` | Verified provider webhook only | Payment intent, order, provider event, replay store | Signature result, event id, amount, currency, provider order/payment binding | Missing/invalid signature mutates state; amount/currency/order mismatch captures; replay creates duplicate effect | `npm run security:webhooks` |
| Listings, trade-ins, saved methods, user resources | `listingRoutes`, `tradeInRoutes`, `userRoutes`, payment-method routes | Authenticated owner or seller where required | Listing, trade-in request, address, saved payment method | Owner, seller id, computed estimated value, default flag | IDOR/BOLA; user attaches another seller listing; attacker-controlled valuation accepted | `npm run security:idor` |
| Upload and review media | `uploadRoutes`, `upload.create`, `upload.remotefetch` | Authenticated owner passing upload policy | Upload intent, object metadata, review media | MIME, magic bytes, size, owner, storage key, public/private state | Executable or oversize file stored; metadata created after validation failure; private object exposed | `npm run security:malware-runtime`, upload security tests |
| AI, internal, data export, status operations | `aiRoutes`, `internal*Routes`, `data.export`, `ai.privilegedaction` | Authenticated owner, authorized service, or stepped-up admin depending on action | AI session, internal job, export, status incident | Service identity, tenant, export scope, action policy | Tool call mutates unauthorized resource; internal route exposed; export crosses tenant boundary | `npm run security:invisible-fabric`, `npm run security:internal-exposure`, `npm run security:logging` |

## Required Negative Families

| Family | Aura cases to generate | Required side-effect assertion |
| --- | --- | --- |
| Authentication | No token, malformed token, expired token, revoked session, deleted/suspended account, stale `auth_time`, missing step-up | No session/token minted; no protected mutation |
| Authorization | User on admin route, buyer on seller route, support/admin below required privilege, wrong tenant/org | Target document unchanged; no sensitive data in response |
| Ownership | Other user's order, address, payment intent, method, listing, trade-in, upload, AI session | Victim document unchanged; list endpoints exclude victim data |
| State machine | Cancel delivered order, refund unpaid order, capture already captured/expired intent, ship before payment, update closed incident | State remains unchanged; no duplicate timeline/event |
| Token or grant | Expired, consumed, wrong-purpose, wrong-user, wrong-factor, wrong-audience/issuer, created before password/security event | Grant remains consumed or invalid; no credential/session change |
| Input tampering | `role=admin`, `isVerified=true`, `paymentState=captured`, `price=1`, `estimatedValue=999999`, owner ids, tenant ids | Server-derived fields win or request is rejected |
| Sequence | Reset before OTP verification, confirm payment before authorization/challenge, refund before payment capture, upload commit before scan | Later-stage resource is not created |
| Replay and idempotency | Duplicate OTP/recovery grant/webhook/refund/order/payment call; same idempotency key; parallel dangerous calls | Exactly one success when allowed; duplicate side effect count stays one |
| Race | Parallel order creation for low stock, two refund approvals, two reset-grant uses, two method-default writes | Invariants hold under `Promise.all`; stock/balance/refund never double-counts |
| Observability | Blocked P0/P1 attempt, admin denial, webhook signature failure, tenant probe | Redacted audit/security event exists; no token/secret/PII in logs |

## Priority Order

Write P0/P1 cases before broad fuzzing:

1. Account takeover: login, recovery, OTP, MFA/passkey, sessions.
2. Money movement: checkout, payment intent, capture, refund, webhook.
3. Cross-user or cross-tenant data access: orders, addresses, payment methods, listings, uploads, exports.
4. Admin privilege escalation: user management, product pricing, refunds, status, maintenance.
5. External side effects: email/SMS, provider calls, uploads, background jobs, AI tool actions.
6. Abuse and availability: rate limits, replay, traffic/backpressure controls.

## Reusable Actors And Resources

Prefer the existing helpers before adding new fixtures:

- Actors: `createTestUser`, `createAdminUser`, `createSuperAdminUser`, `createBlockedUser`, `createDeletedUser`, `createSellerUser`.
- Resources: `createFakeOrder`, `createFakePaymentIntent`, `createFakePaymentMethod`, `createFakeProduct`, `createFakeWebhookEvent`, `objectId`.
- Auth helpers: `buildBearer`, auth matrix fixtures under `tests/auth/fixtures/`.
- Assertions: `assertSafeStatus`, `expectDocumentUnchanged`, count checks for "no new document".

Add new helper assertions only when at least two suites need them. Good candidates:

- `expectNoExternalCall(spy)`
- `expectNoDocumentCreated(Model, filter, beforeCount)`
- `expectSecurityEventLogged(type, matcher)`
- `expectNoSensitiveData(body, sensitiveValues)`
- `expectStateUnchanged(Model, id, before, fields)`

## Test Generation Pattern

For each new high-risk endpoint:

1. Add one happy-path test for the intended actor, resource, state, and input.
2. Add single-variable negative tests for wrong actor, auth, resource, state, token/grant, input, and sequence.
3. Add pairwise tests for realistic abuse chains, such as wrong owner plus client-owned value tampering.
4. Add replay/idempotency coverage for any token, webhook, refund, order, upload, or state transition.
5. Add race coverage when two requests can spend money, consume a grant, change ownership, or deplete stock.
6. Assert no dangerous side effects on every negative path.

Use data-driven cases when the route has repeated policy checks:

```js
const cases = [
    { name: 'anonymous', token: null, expected: 401 },
    { name: 'wrong owner', token: 'token-user-a', resource: 'userBOrder', expected: 404 },
    { name: 'tampered price', body: { totalPrice: 1 }, expected: 409 },
];

for (const c of cases) {
    test(`${c.name} cannot perform sensitive action`, async () => {
        const before = await Model.findById(target._id).lean();

        const response = await request(app)
            .post(route)
            .set('Authorization', c.token ? buildBearer(c.token) : '')
            .send({ ...validBody, ...c.body });

        assertSafeStatus(response, [c.expected]);
        await expectDocumentUnchanged(Model, target._id, before);
    });
}
```

## New Endpoint Checklist

Before merging a new sensitive route, answer all applicable items:

1. Missing, invalid, expired, and revoked auth fail safely.
2. Wrong role, wrong owner, wrong tenant, deleted resource, and malformed id fail safely.
3. Wrong state, wrong sequence, wrong-purpose token/grant, expired token/grant, and replay fail safely.
4. Client-owned authority, ownership, price, role, payment state, order state, and tenant fields are rejected or ignored.
5. Failure happens before database mutation or external side effect.
6. Allowed action creates the required audit/security event.
7. Blocked P0/P1 attempt creates redacted audit/security evidence.
8. Error responses do not leak stack traces, tokens, secrets, PII, or hidden resource details.
9. Rate limits or replay/idempotency controls cover the route's abuse model.
10. The closest `security:*` command includes the new regression.

## CI Gate Mapping

Use the narrowest gate for normal changes:

- Auth/session/token/recovery: `npm run security:auth`, `npm run security:tokens`, `npm run security:otp-reset`, `npm run test:auth:critical`.
- Admin and permissions: `npm run security:admin`, `npm run security:access-control`.
- IDOR/BOLA: `npm run security:idor`.
- Orders/payments/business logic: `npm run security:business-logic`, `npm run payment:test`.
- Webhooks: `npm run security:webhooks`.
- Rate limits and abuse: `npm run security:rate-limit`, traffic fortress tests when touching traffic controls.
- Uploads: `npm run security:malware-runtime` plus touched upload tests.
- Route control coverage: `npm run security:routes:coverage:strict`.
- Broad local security suite: `npm run security:all` when the touched surface crosses several families.

## Current Expansion Targets

These are the highest-value places to keep extending coverage, based on the current docs and route map:

- Complete object-by-object owner/tenant coverage for all high-risk routes, not only the most visible order/payment/user flows.
- Keep permission-matrix coverage aligned with every new admin/support/service action in `docs/security/route-enforcement-coverage.md`.
- Add explicit no-side-effect assertions whenever a suite only checks status codes.
- Turn fuzz findings, SSRF/egress findings, and upload scanner findings into permanent regression tests before closing them.
- Add race tests only where duplicate execution can change money, ownership, stock, grants, sessions, files, or admin state.
