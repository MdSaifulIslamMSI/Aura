# Login Scalability Bottlenecks & Code Audit

This document highlights critical scalability bottlenecks identified during the staff-level audit of the authentication and session subsystems, along with the implemented code optimizations.

---

## 1. Identified Bottlenecks & Fixes

### 1.1 Cache Invalidation: $O(N)$ Redis Keyspace Scans
* **Vulnerability**: In `authMiddleware.js`, invalidating a user's token cache by email required a full keyspace scan (`client.scan()`) to inspect the contents of every cached token. In a production cluster with millions of active tokens, a single password reset or user suspend event would trigger a massive Redis CPU spike, blocking the single-threaded Redis loop.
* **Refactoring Solution**: Reordered the invalidation path. The optimized `invalidateUserCacheByEmail` now queries MongoDB using the unique `{ email: 1 }` index to obtain the user's `authUid` in $O(1)$ time, and then issues a direct delete (`client.del()`) for that specific cache key. A scan fallback is only triggered if the user profile is missing from MongoDB.

### 1.2 Session Revocation: O(N) Session Scan Lookups
* **Vulnerability**: The `revokeBrowserSessionsForUser` in `browserSessionService.js` scanned the entire Redis keyspace using `scanIterator` matching `auth:session:*` to identify and delete all active sessions for a specific user ID. Under spike traffic, this pattern caused linear performance degradation.
* **Refactoring Solution**: Implemented a Redis Set tracking structure. In `persistSessionRecord`, the active session ID is added to a set `auth:user_sessions:<userId>` with an expiry matching the session TTL. Revocation now performs an $O(1)$ lookup via `sMembers`, deleting only the target keys.

### 1.3 Signup Rate Limiting: In-Memory Isolation
* **Vulnerability**: The signup rate limiting engine in `otpController.js` (`computeSignupIdentifierRateState`) relied on a local `Map` structure. When horizontally scaling to multiple instances, requests from a single attacker could bypass the limiters by hitting different pods.
* **Refactoring Solution**: Migrated the signup rate limiter to use a Redis transaction (`client.multi()`) under prefix `rl:signup_identifier:`. It automatically falls back to the local `Map` if Redis is degraded or unreachable, ensuring resiliency.

---

## 2. The Cryptographic Bottleneck: Bcrypt & CPU Exhaustion

Under spike traffic, the primary hardware bottleneck is the CPU execution time of password and OTP hashing using `bcryptjs`.

```
Concurreny (VUs) ────► [ API Gateway / Router ]
                            │
                            ▼
                      [ Bcrypt Hashing ] ◄─── Consumes ~80-100ms CPU per request
                            │
                            ▼
                      (CPU Thread Exhaustion) ──► Latency Spike & Gateway Timeout (504)
```

> [!WARNING]
> **Staff Recommendation on Bcrypt Tuning**:
> Hashing OTPs and passwords with a high work factor (salt rounds) limits the throughput of a single Node process to roughly 10-15 authentications per second per CPU core.
> To mitigate this under flash-crowd login spikes:
> 1. Delegate core password verification to Firebase Auth (which acts as a distributed CPU shield).
> 2. Ensure OTP verification codes are cached in Redis using lightweight, non-blocking hashes (like SHA-256) rather than bcrypt.
