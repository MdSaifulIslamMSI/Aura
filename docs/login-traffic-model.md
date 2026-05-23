# Login Traffic Model & Load Simulation

This document defines the mathematical traffic model and throughput projections for the Aura Marketplace authentication and sign-in routes, forming the design basis for our load test harness.

---

## 1. Traffic Projections & Mathematical Model

Our calculations are based on an active user base of **1,000,000 Monthly Active Users (MAU)** with a peak day concurrency ratio of **5%**.

### 1.1 Calculation Metrics

$$\text{Peak Day Users} = 1,000,000 \times 0.05 = 50,000 \text{ users/day}$$

Assuming a standard peak hour window (e.g. evening sale) containing 40% of daily login transactions:

$$\text{Peak Hour Transactions} = 50,000 \times 0.40 = 20,000 \text{ logins/hour}$$

Calculating the throughput in Transactions Per Second (TPS):

$$\text{Average Peak Load} = \frac{20,000}{3600} \approx 5.5 \text{ TPS}$$

Applying a safety multiplier of **$5\times$** to account for flash-sale traffic spikes and concurrent API requests:

$$\text{Target Peak Elasticity} = 5.5 \times 5 \approx 28 \text{ TPS}$$

---

## 2. Load Testing Scenario Profiles

The k6 test suite (`tests/load/auth-login.k6.js`) implements five target profiles corresponding to real-world operations:

### 2.1 Scenario Details

```
   Baseline Load         Mixed Auth Traffic          Spike Scenario          Rate-Limit Abuse
    (Constant 2 VUs)      (Ramp-up to 10 VUs)       (Ramp-rate to 30/s)      (Constant rate 15/s)
   ┌───────────────┐      ┌─────────┐                ┌───┐                   ┌───────────────┐
   │               │      │         │               /     \                  │               │
  ─┴───────────────┴─    ─┴─────────┴─             ─┴──────┴─               ─┴───────────────┴─
```

1. **Baseline**: 2 VUs constant load. Checks `/health` and `/api/auth/otp/check-user` to set the performance baseline.
2. **Mixed Auth Traffic**: Ramps from 1 to 10 VUs over 30s. Simulates mixed user actions (60% account lookup checks, 30% OTP triggers, 10% health status lookups).
3. **Spike Scenario**: Ramps from 2 to 30 requests/sec arrival rate in 5 seconds. Holds for 10 seconds. Verifies system stability under sudden connection surges.
4. **Rate-Limit Abuse**: Constant arrival rate of 15 requests/sec targeted at a single user's `/api/auth/otp/send` route. Expects rate limiting (429) to trigger and protect SMTP/SMS pipelines.
5. **Soak Test**: Sustained load of 5 VUs for 30s to check memory utilization, MongoDB connection exhaustion, and cache leaks.

---

## 3. SLA Targets & Budgets

* **Target Average Latency**: $<250\text{ ms}$ for health checks; $<500\text{ ms}$ for MongoDB queries.
* **95th Percentile (p95) Latency**: $<1500\text{ ms}$.
* **99th Percentile (p99) Latency**: $<3000\text{ ms}$.
* **Error Rate Target**: $<0.1\%$ under normal mixed traffic; and $100\%$ rate-limit blocking for abusive traffic profiles.
