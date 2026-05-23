# Login Scalability Scorecard & Assessment

This scorecard provides a staf-level evaluation of the Aura Marketplace's authentication system components, grading them based on their real-world scalability, performance under load, and architectural readiness.

---

## 1. System Component Grading

| Subsystem / Vector | Grade | Status | Findings & Optimization |
| :--- | :---: | :--- | :--- |
| **Token Cache Invalidation** | **A** | **Optimized** | Replaced $O(N)$ Redis keyspace scans with a MongoDB index lookup followed by a direct $O(1)$ cache invalidation call. |
| **Browser Session Revocation** | **A** | **Optimized** | Replaced expensive $O(N)$ Redis database scans with Set-based session tracking (`auth:user_sessions:<userId>`), reducing lookup time to $O(1)$. |
| **Signup Rate Limiting** | **A** | **Optimized** | Migrated from local memory maps to Redis-backed distributed transactions with a local memory fallback, preventing rate-limit bypass. |
| **OTP Hashing Latency** | **C** | **Bottleneck** | Relying on CPU-heavy bcrypt operations. Hashing OTPs on CPU-constrained pods represents a primary threat to throughput during login surges. |
| **Database Indexes** | **B** | **Adequate** | MongoDB contains unique indexes on `email`, `phone`, and `authUid`. Lacks covered indexes for multi-field queries. |
| **Horizontal Readiness** | **B+** | **Ready** | Session state is fully externalized to Redis. If Redis is unavailable, fallback to local memory breaks state sharing (acceptable risk). |
| **SMTP/SMS Delivery Shield** | **A-** | **Hardened** | OTP request limiters protect delivery networks, but lacks IP-range reputation blocks. |

---

## 2. Key Areas for Improvement

### 2.1 Grade Explanations
* **OTP Hashing Latency (C)**: While bcrypt is secure, it is intentionally slow. We should migrate OTP hashing from bcrypt to SHA-256 with a unique salt, as OTPs are short-lived (5-10 minutes) and don't require the brute-force resistance of permanent passwords.
* **Database Indexes (B)**: Add a compound covered index on `{ email: 1, isVerified: 1 }` and `{ phone: 1, isVerified: 1 }` to optimize the `checkUserExists` route, avoiding collection scans entirely during account discovery lookups.
* **Horizontal Readiness (B+)**: The in-memory fallback is safe from a security standpoint (fail-closed/fail-safe), but causes sessions to become locked to individual API pods. We should ensure load balancers implement sticky sessions if the Redis connection is degraded.
