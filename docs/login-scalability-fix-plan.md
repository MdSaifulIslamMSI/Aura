# Login Scalability Fix Plan & Roadmap

This document outlines the refactoring fixes completed during the audit, as well as the long-term scalability roadmap for the authentication system.

---

## 1. Completed Refactoring Optimizations

We have successfully implemented and tested three major scalability fixes in the codebase:

1. **Optimized Cache Invalidation (`authMiddleware.js`)**: Eliminated $O(N)$ scanning of Redis keyspace on password reset or suspension. The application now uses MongoDB `{ email: 1 }` index lookup to retrieve the unique `authUid`, then calls a single `client.del()` for that user's cache key.
2. **Optimized Session Revocation (`browserSessionService.js`)**: Added Redis Set-based tracking (`auth:user_sessions:<userId>`). Session creation and revocation update this set, replacing full keyspace scans with direct deletion of the user's specific sessions.
3. **Distributed Signup Rate Limiting (`otpController.js`)**: Shifted signup limiter state from in-process maps to Redis transactions (`client.multi()`), securing distributed scaling without compromising on rate limit enforcement.

---

## 2. Long-Term Scalability Roadmap

| Task / Optimization | Target Component | Impact | Complexity |
| :--- | :--- | :--- | :---: |
| **Bcrypt to SHA-256 for OTPs** | `otpController.js` | CPU reduction of $>80\text{ms}$ per verification attempt. | Low |
| **MongoDB Compound Indexes** | database | Covered index lookup for `check-user` ($<1\text{ms}$ query latency). | Low |
| **Redis Hash Tagging** | `browserSessionService.js` | Cluster slot mapping compatibility. | Medium |
| **Turnstile Circuit Breaker** | WAF Middleware | Protects Node thread pool from external API degradation. | Medium |

### 2.1 Implementation Guidance: SHA-256 OTP Hashing
Currently, OTP verification hashes the code using bcrypt:
```javascript
// Current slow implementation
const hashedOtp = await bcrypt.hash(otp, 10);
```

We recommend migrating to salted SHA-256:
```javascript
// Recommended fast implementation
const crypto = require('crypto');
const salt = crypto.randomBytes(16).toString('hex');
const hashedOtp = crypto.createHmac('sha256', salt).update(otp).digest('hex');
// Save both salt and hashedOtp in the database (OTP session record)
```
* **Performance Impact**: SHA-256 completes in $<0.1\text{ ms}$, freeing up the Node CPU thread loop to handle thousands of concurrent requests without latency degradation.
* **Security Feasibility**: Valid since OTPs have a short validity window (5 minutes) and are expired instantly upon verification, making offline brute-force attacks infeasible.
