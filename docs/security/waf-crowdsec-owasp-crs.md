# WAF, CrowdSec, And OWASP CRS

Aura's free WAF path uses OWASP CRS with ModSecurity/Coraza-compatible deployment examples, plus CrowdSec behavior blocking where suitable.

Start in detection mode in staging. Move to blocking mode only after reviewing false positives for auth, checkout, payment webhooks, email webhooks, uploads, and support routes.

Coverage goals:

- SQL injection patterns.
- XSS patterns.
- RCE-like payloads.
- Path traversal.
- Bad bots and suspicious scanners.
- Oversized payloads.
- Abnormal methods and suspicious headers.
