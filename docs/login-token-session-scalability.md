# Token & Session Scalability Architecture

This document details the scalability, lifecycle, and memory footprints of token verification and stateful browser sessions, explaining how opaque session caching improves application throughput.

---

## 1. Firebase Token Validation vs. Browser Sessions

Firebase ID tokens are JSON Web Tokens (JWTs) cryptographically signed by Google. Verifying these tokens on every API request introduces two major scalability challenges:
1. **Network Latency**: Firebase Admin SDK periodically fetches Google's public certificates (JWKS) to verify signatures, introducing unpredictable latency spikes.
2. **CPU Overhead**: Verifying RSA/ECDSA cryptographic signatures on every incoming API request consumes substantial CPU cycles.

```
Incoming Request ──► [ Bearer Token ] ──► verifyIdToken() (CPU crypt check + JWKS fetch) ──► Latency ~20-50ms
                                                                 │
                                                       (Exchange / Sync)
                                                                 │
                                                                 ▼
Incoming Request ──► [ Opaque Cookie ] ──► getRedisSession() ($O(1)$ memory read from Redis) ──► Latency <1ms
```

### 1.1 Cache / Cookie Exchange Flow
To scale, the system uses a **Token-to-Session Exchange** model:
1. The client performs initial authentication via Firebase and receives an ID token.
2. The client calls `/api/auth/exchange` (or `/api/auth/sync`) with the ID token.
3. The server validates the token once and calls `createBrowserSession`, returning a secure, opaque session cookie (`aura_sid`).
4. Subsequent requests use the cookie, which is validated in sub-milliseconds by querying Redis.

---

## 2. Session Lifecycle & TTL Parameters

Browser sessions are governed by two distinct timeouts to balance security and database storage:
* **Idle TTL (`SESSION_IDLE_TTL_MS`)**: 30 minutes. The session is touched (last seen timestamp updated) on activity, resetting this timer.
* **Absolute TTL (`SESSION_ABSOLUTE_TTL_MS`)**: 7 days. The absolute maximum lifetime of a session, regardless of activity.

### 2.1 Set-Based Revocation Scaling
By implementing Redis Set tracking (`auth:user_sessions:<userId>`), we ensure that when a user changes their password, revoking their sessions takes $O(M)$ time (where $M$ is the number of active sessions for that user, typically $\le 5$), rather than an $O(N)$ database scan (where $N$ is all active sessions in the system).

---

## 3. Storage Footprint Calculations

An average browser session record stored in Redis is approximately **500 bytes** of JSON string:

$$\text{Session RAM} = 500 \text{ bytes per session}$$

For a highly concurrent system with **100,000 active sessions**:

$$\text{Total RAM} = 100,000 \times 500 \text{ bytes} \approx 50 \text{ Megabytes (MB)}$$

$$\text{Set tracking memory} = 100,000 \times 100 \text{ bytes} \approx 10 \text{ Megabytes (MB)}$$

$$\text{Total Cache Budget} = 50\text{MB} + 10\text{MB} = 60\text{MB}$$

* **Conclusion**: Storing 100,000 concurrent sessions requires less than 100MB of RAM. This represents an extremely low memory footprint, indicating that our Redis session caching strategy is highly scalable and cost-effective.
