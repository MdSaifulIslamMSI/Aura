# Login Observability & Alerting Plan

This document details the observability plan for the authentication and session subsystems, defining key metrics, alert thresholds, critical log structures, and health indicators.

---

## 1. Key Metrics & Alert Thresholds

We recommend instrumenting the following Prometheus counters and histograms to monitor auth performance:

| Metric Name | Type | Description | Alert Condition |
| :--- | :---: | :--- | :--- |
| `auth_login_attempts_total` | Counter | Total login sync and exchange attempts. | N/A (Volume baseline) |
| `auth_login_failures_total` | Counter | Failed logins (bad credentials, expired tokens, blocks). | $>5\%$ failure rate over 5 min |
| `auth_rate_limit_hits_total` | Counter | Hits on distributed rate limiters (429 outputs). | $>15\%$ of total traffic over 5 min |
| `auth_session_validation_duration_seconds` | Histogram | Latency distribution of session validation checks. | p95 $>100\text{ ms}$; p99 $>250\text{ ms}$ |
| `auth_cache_errors_total` | Counter | Redis failures causing fallback to Mongo/memory. | $>5$ errors in 1 minute |

---

## 2. Critical Log Signatures

Monitoring systems (such as Datadog or ELK stack) should monitor application stdout for these structured log identifiers:

### 2.1 Log Entries
* **`auth.cache_invalidate_by_email_failed`**: Logged when the email invalidation query fails. Represents potential DB index or Redis link errors.
* **`browser_session.persist_failed_memory_fallback`**: Logged when Redis is down, forcing memory fallback. High priority alert in production (breaks stateless clustering).
* **`auth.posture.blocked_system_restricted`**: Logged when adaptive security shuts down commercial routes because dependencies are failing.
* **`login_failure`**: Structured security audit log record tracking unsuccessful login attempts and failure reasons.

---

## 3. Health Checks & Adaptive Degradation

The application exposes the `/health` endpoint to reflect system readiness:

```
                  ┌──────────────────────┐
                  │   GET /health Check  │
                  └──────────┬───────────┘
                             │
            ┌────────────────┴────────────────┐
   All OK   │                                 │ DB/Redis Down
            ▼                                 ▼
   [ Status: 200 OK ]             [ Status: 503 Degraded ]
   - dbConnected: true            - dbConnected: false
   - redisConnected: true         - redisConnected: false
                                  - Restrict commercial APIs (CAP)
                                  - Allow Appeals Chat Negotiator
```

* **Liveness Probe**: Confirms the process is running.
* **Readiness Probe**: Queries MongoDB and Redis. If both are online, returns `200 OK`. If one is down, returns `503 Service Unavailable` with details.
* **Continuous Access Posture Interaction**: The Auth Middleware queries the health service cache. If status is `degraded` and adaptive security is enabled, it blocks sensitive transactions but permits login appeals, failing safe.
