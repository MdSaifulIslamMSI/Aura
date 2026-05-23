# Login Security-Scalability Tradeoff Review

This document evaluates the trade-offs between rigorous security controls and system scalability under load, focusing on rate limiting, bot protection, trusted device challenges, and fail-safe designs.

---

## 1. Rate Limiting vs. Resource Protection

Rate limiting is the primary shield protecting external delivery APIs (SMTP/SMS) and CPU-bound pipelines.

```
                  ┌──────────────────────┐
                  │    HTTP Requests     │
                  └──────────┬───────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │ Distributed Rate Limit Check │ ◄── Sub-ms Redis key lookup
              └──────────────┬───────────────┘
                             │
                    ┌────────┴────────┐
              Pass  │                 │ Blocked (429)
         ┌──────────▼─────────┐       ▼
         │ Bcrypt Hashing CPU │   [ Reject Immediately ]
         │ (High CPU load)    │
         └────────────────────┘
```

* **Scalability Trade-off**: Running rate limiters before cryptographic work protects CPU resources. The rate limiter must run in sub-millisecond times (Redis $O(1)$) to prevent rate limiting itself from becoming a bottleneck during denial-of-service (DoS) events.
* **Status**: Satisfied. The system applies distributed rate limiters *before* executing bcrypt or dispatching messages.

---

## 2. Cloudflare Turnstile Integration

The login system requires Turnstile token validation on critical routes:
* `/api/auth/bootstrap-device-challenge`
* `/api/auth/recovery-codes/verify`
* `/api/auth/otp/send`, `/verify`, `/reset-password`, `/check-user`

> [!IMPORTANT]
> **Turnstile Latency Impact**: Turnstile verification requires an external API call to Cloudflare. This introduces a synchronous network hop ($\sim 100\text{-}300\text{ms}$) per request.
> Under extreme spike loads, thread pool exhaustion on the Node API server can occur if Cloudflare experiences slow response times.
> **Mitigation**: Implement a fast circuit breaker. If Turnstile API calls fail or timeout ($>1000\text{ms}$), fail-safe to a local proof-of-work (PoW) challenge or block write operations until Cloudflare recovers.

---

## 3. Cryptographic Challenges & Trusted Devices

High-security users undergo cryptographic trusted device verification (WebAuthn/browser keys).

* **Scalability Benefit**: Unlike asymmetric decryption, verifying WebAuthn assertions involves validating cryptographic signatures using public keys stored in MongoDB. This requires negligible CPU resources compared to bcrypt hashing.
* **Security Benefit**: Bypasses the need for constant password verification on subsequent requests, drastically reducing CPU load during active sessions.

---

## 4. Fail-Closed vs. Fail-Safe Cache Operations

If Redis crashes or becomes unreachable, the session subsystem degrades to in-memory maps or fails closed:

* **Session Validation (Fail-Safe)**: Valid session lookups fall back to checking the MongoDB database. This degrades API performance but preserves user sessions (fail-safe).
* **Session Persistence (Fail-Closed in Production)**: In production environments, if Redis rejects a new session write, the system fails closed (rejects session creation) to prevent session fragmentation across stateless API pods.
