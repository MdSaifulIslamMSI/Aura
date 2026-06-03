# Cloudflare PQC And DDoS Guidance

Cloudflare controls are provider-managed. Aura can document and verify readiness, but cannot claim end-to-end PQC or unlimited DDoS survival from application code alone.

## Checklist

- Enable TLS 1.3 at the edge.
- Track Cloudflare post-quantum TLS availability for visitor-to-edge and edge-to-origin legs.
- Keep managed WAF rules enabled.
- Apply rate rules for login, OTP, AI, uploads, and search.
- Keep origin lockdown active with the CDN verification header.

## Evidence

- `security:pqc:provider-register` records provider dependency status.
- `security:traffic:proof` records traffic-resilience evidence and the remaining provider cap.
