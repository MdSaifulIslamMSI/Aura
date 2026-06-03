# WAF And Runtime Shield

This directory contains local, non-secret examples for a free WAF stack.

## Modes

- Start in detection mode to collect false positives.
- Move targeted rules to blocking mode after reviewing samples.
- Keep a webhook allowlist for signed payment and email webhook paths so provider callbacks are not challenged.

## Coverage

- SQL injection: covered by OWASP CRS request rules.
- XSS: covered by OWASP CRS script and HTML injection rules.
- path traversal: covered by protocol and file-access rule groups.
- Bot and scanner noise: collected by CrowdSec acquisition examples and app `abuseShield`.

## Rollback

Return a noisy rule to detection mode, preserve logs, and keep app-layer route budgets enabled while tuning.
