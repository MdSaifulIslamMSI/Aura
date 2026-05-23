# Login Architecture Map & Flow Sequence

This document maps the complete authentication and session management architecture of the Aura Marketplace, detailing the sequence of operations from the client through security layers, external identity provider (Firebase), cache (Redis), and primary database (MongoDB).

## 1. Sequence Diagram: Authentication Flow

Below is the execution flow when a client authenticates via a Firebase token (OAuth or Password) and establishes a stateful, secure browser session.

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant API Gateway
    participant AuthMiddleware
    participant Firebase Service
    participant Redis Cache
    participant MongoDB
    participant BrowserSessionService

    Client->>API Gateway: POST /api/users/login (with Authorization: Bearer <ID_Token>)
    API Gateway->>AuthMiddleware: Intercept & inspect Authorization Header
    AuthMiddleware->>Firebase Service: Verify ID Token (verifyIdToken)
    Firebase Service-->>AuthMiddleware: Return Decoded Token (uid, email, phone)
    AuthMiddleware->>MongoDB: Find or Bootstrap User Record (email, phone, authUid)
    MongoDB-->>AuthMiddleware: Return User Document (roles, state, assurance)
    AuthMiddleware->>Redis Cache: Set User Cache (auth:cache:<uid>)
    AuthMiddleware->>BrowserSessionService: createBrowserSession
    BrowserSessionService->>Redis Cache: Add Session to Set (auth:user_sessions:<userId>)
    BrowserSessionService->>Redis Cache: Store Opaque Session (auth:session:<sessionId>)
    BrowserSessionService-->>AuthMiddleware: Return session cookie headers (aura_sid)
    AuthMiddleware-->>Client: Respond with Profile JSON + Secure Cookie Header
```

---

## 2. Dynamic Posture & Continuous Access Policy (CAP)

The Aura auth system enforces a dynamic security posture check on every protected commercial API route.

```mermaid
flowchart TD
    A[Incoming Request] --> B{Bearer Token Present?}
    B -- Yes --> C[Verify with Firebase]
    B -- No --> D{Opaque Cookie aura_sid Present?}
    D -- No --> E[Reject: 401 Unauthorized]
    D -- Yes --> F[Retrieve Session from Redis/Memory]
    F --> G[Fetch User Profile from DB/Cache]
    G --> H{Is Account Suspended?}
    H -- Yes --> I[Appeals Chat Access Only]
    H -- No --> J[Evaluate Continuous Access Posture]
    J --> K{Verify Device ID & Signature?}
    K -- Fail --> L[Require Trusted Device Step-up]
    K -- Pass --> M{Degraded/Sensitive action?}
    M -- Yes --> N{Fresh Auth Age <= Window?}
    N -- No --> O[Prompt for Re-authentication]
    N -- Yes --> P[Allow Access]
    M -- No --> P
```

---

## 3. Component Architecture Matrix

| Layer / Component | Technology | Role | Scalability / Performance Characteristics |
| :--- | :--- | :--- | :--- |
| **Identity Provider** | Firebase Auth | External Auth & Social Federated Sign-in | Bypasses core password-hashing CPU load on API server. Subject to external API latency and rate-limits. |
| **API Gateway / Router** | Express.js | Traffic orchestration, validation, error boundary | Runs statelessly, scales horizontally. Handles gzip, rate-limiting, and schema validation. |
| **Cache & Distributed Store** | Redis | Session state, token invalidation caches, distributed rate limits | Memory-bound, sub-millisecond lookups. Key lookup is $O(1)$, Set-based tracking replaces expensive scans. |
| **Database** | MongoDB | Persistent user profiles, trusted device registries, transactional audit logs | Disk/Memory-bound. Relies heavily on indexes (`email`, `phone`, `authUid`) for low-latency lookups. |

---

## 4. Key Security Boundaries

1. **Opaque Browser Session Cookie (`aura_sid`)**: Hardened with `HttpOnly`, `Secure`, and context-aware `SameSite` flags (automatically falls back to `SameSite=None` when API domain differs from frontend domain).
2. **Cryptographic Device Binding**: Enforces hardware/browser key assertion verification for high-risk operations or elevated risk state profiles.
3. **Emergency Disables**: Uses global memory flags (`DISABLE_SIGNUP`, etc.) to instantly lock down routes when malicious vectors are detected.
