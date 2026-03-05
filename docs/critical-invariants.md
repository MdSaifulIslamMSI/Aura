# Critical Invariants

1. **No Client Privilege Escalation**
- `PUT /api/users/profile` accepts safe profile fields only.

2. **No OTP-Driven User Deletion**
- OTP expiry must apply to session records, never user documents.

3. **Server-Authoritative Order Pricing**
- Orders are always quoted/recomputed on backend before commit.

4. **Digital Payment Binding**
- Digital orders require payment intent ownership, method match, amount match, and valid status.

5. **Capture Durability**
- Authorized capture tasks are enqueued in the same transaction as order commit.

6. **Idempotent Critical Mutations**
- Intent create/confirm, refund, and order creation are replay-safe.

7. **Auditability**
- Payment and email workflows expose enough structured logs/events for incident reconstruction.
