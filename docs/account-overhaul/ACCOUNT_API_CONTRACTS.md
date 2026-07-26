# Account and Profile Overhaul: API Contracts

## Implementation status

The account summary, notification-preference, active-session, and customer-safe security-activity contracts below are implemented in the current branch. Destructive privacy contracts stay blocked until jurisdiction, retention, deletion-grace, and export-delivery policy is approved.

## Contract principles

- The authenticated subject comes only from verified server identity/session middleware.
- Request bodies never choose `userId`, owner, role, account state, price, reward balance, payment authority, or deletion eligibility.
- Mutations use explicit Zod allowlists, content-type/body limits, CSRF/session controls, rate limits, and sensitive-action policy where applicable.
- Error responses use stable machine codes and a safe `requestId`; they do not expose stack traces, tokens, provider payloads, raw database errors, or account-discovery detail.
- Existing endpoints remain compatible during migration.

## Standard response envelope

Successful additive account endpoints:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "server-generated",
    "partial": false
  }
}
```

Errors:

```json
{
  "success": false,
  "error": {
    "code": "ACCOUNT_VALIDATION_FAILED",
    "message": "Review the highlighted fields.",
    "fields": {
      "name": "Enter your full name."
    }
  },
  "requestId": "server-generated"
}
```

Field details are present only for safe validation failures. Authorization failures remain non-enumerating.

## Reused contracts

These existing routes remain the initial source of truth:

| Capability | Contract |
|---|---|
| Profile | `GET /api/users/profile`, `PUT /api/users/profile` |
| Overview | `GET /api/users/dashboard`, `GET /api/users/rewards` |
| Addresses | `POST /api/users/addresses`, `PUT /api/users/addresses/:addressId`, `DELETE /api/users/addresses/:addressId` |
| Wishlist | `/api/users/wishlist` and item routes |
| Orders | Existing `/api/orders` history/detail/command routes |
| Payments | `GET /api/payments/methods` and guarded mutation routes |
| Notifications | `GET /api/notifications`, `PUT /api/notifications/read`, `PUT /api/notifications/read-all` |
| Support | Existing `/api/support` ticket/message routes |
| Listings | `GET /api/listings/my` and owner-guarded mutations |
| Trade-ins | `GET /api/trade-in/my` and owner-guarded mutations |
| Price alerts | `GET /api/price-alerts/my` and owner-guarded mutations |
| MFA/devices | Existing `/api/auth/mfa` and trusted-device routes |

Adapters should normalize these into feature-level query models without weakening the server contracts.

## Additive account summary

### `GET /api/account/summary`

Purpose: bounded first-paint overview.

Query:

```text
include=recentOrder,rewards,notifications,payments,security,marketplace
```

The server intersects requested values with an allowlist and applies a strict maximum. Unknown includes return 400.

Response fields:

```json
{
  "profile": {
    "name": "Maya",
    "memberSince": "2025-01-02T00:00:00.000Z",
    "completion": 80
  },
  "orders": {
    "inTransit": 1,
    "recent": {
      "id": "public-order-id",
      "status": "shipped",
      "totalMinor": 125000,
      "currency": "INR",
      "item": {
        "name": "Display-safe product name",
        "imageUrl": "safe-derived-url"
      }
    }
  },
  "notifications": {
    "unread": 2
  },
  "rewards": {
    "points": 120,
    "tier": "bronze"
  },
  "payments": {
    "savedMethodCount": 2,
    "default": {
      "brand": "visa",
      "last4": "1234"
    }
  },
  "security": {
    "recommendationCode": "ADD_RECOVERY_CODES"
  },
  "marketplace": {
    "activeListings": 1,
    "activeTradeIns": 0,
    "priceAlerts": 3
  }
}
```

Failures in optional sources set `meta.partial=true` and return allowlisted `meta.unavailable` module names. Identity/profile failure fails the request.

## Active sessions

### `GET /api/account/sessions`

- Requires authenticated active session.
- Reads only the authenticated user's Redis session set.
- Maximum returned records: 20.
- Stale or missing records are removed from the set opportunistically.

Public session:

```json
{
  "id": "opaque-public-alias",
  "current": true,
  "client": "Chrome",
  "os": "Windows",
  "createdAt": "2026-07-26T08:00:00.000Z",
  "lastActiveAt": "2026-07-26T09:15:00.000Z",
  "expiresAt": "2026-08-02T08:00:00.000Z"
}
```

Never return raw session IDs, cookies, access/refresh tokens, IPs, user-agent strings, fingerprints, assurance proofs, or Redis keys.

### `DELETE /api/account/sessions/:sessionAlias`

- Resolves the alias inside the authenticated user's current session inventory.
- Rejects aliases not owned by the subject with a non-enumerating 404.
- A current-session row is labeled by server-owned request context. Revoking it clears the browser-session cookie; the UI presents a distinct sign-out confirmation.
- Requires CSRF protection for cookie sessions.

### `POST /api/account/sessions/revoke-others`

- Preserves the current verified session.
- Requires fresh auth/step-up.
- Revokes every other active browser session for the authenticated subject.

### `POST /api/account/sessions/revoke-all`

- Requires fresh auth/step-up and explicit confirmation.
- Revokes all subject sessions and clears the current cookie.

## Redacted security activity

### `GET /api/account/security-activity?cursor=...&limit=20`

- Owner-only, cursor-paginated, maximum limit 50.
- Cursors are HMAC-signed, owner-bound, and stable across equal timestamps; malformed, altered, or cross-user cursors fail closed.
- Maps allowlisted internal event types to customer language.
- Returns only allowlisted event type, normalized outcome, and occurrence time.
- Excludes admin-only rationale, fraud features, raw risk scores, IPs, tokens, provider responses, and other users.

Allowed initial events:

- password changed;
- passkey added/removed;
- TOTP enabled/disabled;
- recovery codes regenerated/used;
- new session established;
- session revoked;
- trusted device renamed/revoked;
- account export/deletion lifecycle change.

## Notification preferences

### `GET /api/account/preferences/notifications`

Returns a versioned allowlist of topic/channel choices and mandatory topics.

### `PATCH /api/account/preferences/notifications`

Example:

```json
{
  "version": 3,
  "preferences": {
    "orderUpdates": { "email": true, "push": true },
    "marketplaceUpdates": { "email": false, "push": true },
    "supportUpdates": { "email": true, "push": true }
  }
}
```

- Rejects unknown topics/channels.
- Prevents disabling legally or operationally mandatory security notices.
- Uses optimistic concurrency through `version`; stale updates return 409 with the current safe state.

## Avatar media

### `POST /api/account/avatar/upload-intents`

Request allowlist: `fileName`, `mimeType`, and `sizeBytes`.

The server allows JPEG, PNG, and WebP up to 2 MB and returns a ten-minute, one-time, owner-bound upload token plus the fixed account upload endpoint. The token never grants bucket, key, ACL, or credential authority.

### `POST /api/account/avatar/uploads`

Requires the one-time upload token and its exact file name and MIME type. The server:

- rejects token replay, owner mismatch, path-bearing names, unsupported extensions, MIME/magic-byte mismatches, oversized files, malformed decodes, animation, images over 4,096 pixels on an axis or 16 megapixels, and unavailable or negative malware scans;
- decodes and auto-orients the image;
- crops it to a 512 by 512 square;
- strips source metadata and encodes WebP;
- writes only the normalized object into private quarantine; and
- returns a separate ten-minute, one-time finalize token.

### `POST /api/account/avatar/finalize`

Requires only the server-issued finalize token. The server verifies token ownership, purpose, object existence, and normalized byte length, promotes the quarantined object, and performs an optimistic-version user update. It stores the randomized object key and derived metadata plus the durable media URL. A database conflict removes the newly promoted object, and successful replacement schedules the previous object for bounded asynchronous deletion.

Client-supplied bucket names, arbitrary keys, public ACLs, and URLs are rejected.

`GET /uploads/avatars/:storageKey` serves only the strict randomized `.webp` key shape with immutable caching and `nosniff`. Quarantine paths are never served. `npm --prefix server run avatar:cleanup` is dry-run by default; `-- --execute` is required to remove stale quarantine and old unreferenced final objects.

## Saved items, reviews, and marketplace activity

### `GET /api/account/marketplace`

Returns an authenticated, owner-scoped Account Center hub over repository-supported domains:

- live-hydrated saved-product previews and the current wishlist revision;
- the owner’s review previews and moderation-visible status;
- the owner’s listing previews;
- the owner’s trade-in previews; and
- the owner’s price-alert previews.

Each domain includes a total count, at most six newest preview rows, and routes into the existing full management workflow. The response is `private, no-store`, uses strict projections, and omits seller/user authority fields, review risk snapshots, trade-in valuation authority, payout claims, moderation controls, and administrative notes. The existing `/api/users/wishlist`, `/api/products/:id/reviews`, `/api/listings/my`, `/api/trade-in/my`, and `/api/price-alerts/my` contracts remain authoritative for mutations and full histories.

## Privacy lifecycle

Contracts remain **blocked** until retention jurisdiction, deletion grace period, reactivation policy, and export delivery are approved. Required shape:

- `POST /api/account/privacy/exports`
- `GET /api/account/privacy/exports/:jobId`
- `POST /api/account/privacy/deactivation`
- `POST /api/account/privacy/deletion-requests`
- `DELETE /api/account/privacy/deletion-requests/:requestId`

All require fresh authentication. Deletion never directly hard-deletes records in the request transaction.

## Pagination

Use cursor pagination for orders, activity, marketplace histories, and long support histories:

```json
{
  "data": [],
  "page": {
    "hasMore": true,
    "nextCursor": "signed-or-opaque-cursor"
  }
}
```

Cursors bind the authenticated subject, sort, filters, and version. Clients cannot alter ownership or broaden the query by editing a cursor.
