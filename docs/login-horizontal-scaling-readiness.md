# Login Horizontal Scaling Readiness

This document reviews the horizontal scalability characteristics of the Aura Marketplace login and session subsystems, analyzing their stateless design, Redis cluster integration, and cookie routing postures.

---

## 1. Stateless Authentication Design

The application is architected to be state-independent at the application instance (API pod) level. All user session records and rate limit counters are externalized.

```
       [ Client Request ] ────► [ Load Balancer ]
                                  /    |    \
                                 /     |     \
                            [ Pod 1 ] [ Pod 2 ] [ Pod 3 ]  ◄── Stateless API Instances
                                 \     |     /
                                  \    |    /
                              ┌────▼────▼────▼────┐
                              │  Redis Cache Cluster  │  ◄── Shared Session & Rate-Limit Store
                              └─────────┬─────────┘
                                        ▼
                              ┌───────────────────┐
                              │   MongoDB Cluster │  ◄── Persistent Database
                              └───────────────────┘
```

* **Session Sharing**: When a user logs in, their session payload is stored in Redis. Subsequent requests can be routed to *any* API pod. Each pod reads the `aura_sid` cookie, queries Redis, and validates the session in $O(1)$ time.
* **Degradation Posture**: If Redis crashes, the pods fall back to local in-memory session maps. Under this state, the architecture becomes *stateful*, requiring session stickiness at the load balancer (sticky sessions) to prevent users from being logged out when hitting different pods.

---

## 2. Redis Clustering & Sentinel Readiness

The Redis client in `redis.js` uses the standard `redis` npm package, which natively supports Sentinel, Clustering, and TLS connection wrappers:
* **Connection Pooling**: Reconnect strategy is configured to scale delay linearly: `Math.min(attempt * 200, 3000)`.
* **Clustering Support**: We use Redis Sets (`auth:user_sessions:<userId>`) for session tracking. Because keys are structured, to ensure that user session sets and session details hash to the same Redis cluster node, we should use Redis Hash Tags:
  * `{auth:user_sessions}:<userId>`
  * `{auth:session}:<sessionId>`
  *(Staff Recommendation: Implement Redis Hash Tags prior to launching a multi-node Redis Cluster to avoid cross-slot command failures.)*

---

## 3. Cookie Routing & Proxy Considerations

* **SameSite Posture**: The browser session service dynamically configures the `SameSite` cookie parameter:
  * `SameSite=Strict`: When the API origin matches the frontend origin (protects against CSRF).
  * `SameSite=None`: When operating across domains (e.g. secure loopback test environments or Vercel static frontends talking to AWS backends). Enforces `Secure` flag.
* **Proxy Trust**: The server respects standard proxy headers (`X-Forwarded-Proto`, `Host`) to resolve protocol and domain origins correctly when running behind AWS ALBs or Cloudflare tunnels.
