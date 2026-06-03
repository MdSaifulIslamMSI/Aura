# Add PQC real-target and traffic resilience proof

## Summary

Adds a combined PQC real-target proof and Traffic-Resilient Security Fortress campaign.

## PQC Score Before

- PQC readiness: 96%.
- Crypto inventory/policy: 96%.
- CI evidence: 96%.
- Controllable-surface proof: 76%.
- Full end-to-end PQC: 50%, capped by provider/browser/WebPKI limits.

## PQC Score After

- PQC readiness target: 98%.
- Crypto inventory/policy target: 98%.
- CI evidence target: 98%.
- Controllable-surface proof: 80-82% without live target proof; 85-92% with explicit staging/read-only evidence.
- Full end-to-end PQC: 50-55% without live provider evidence; 60-70% maximum realistic with configured read-only evidence.

## Traffic Resilience

Adds route budgets, timeout/body guards, Redis-backed budget policy, load shedding, attack mode, abuse scoring, query/cache guards, safe simulation, WAF/origin docs, observability artifacts, and aggregate proof scripts.

## Safety Boundaries

- No secrets, private keys, or generated certs committed.
- No custom crypto.
- No production DDoS/load testing.
- No production deploy/redeploy rerun.
- No scanner weakening.
- No 100% PQC or DDoS immunity claims.

## Commands

The branch is expected to run the traffic fortress gate, PQC gates, root tests, lint, build, secret scan, and diff check before merge.
