# Security Policy

Aura Marketplace treats security reports as production-sensitive. Please report vulnerabilities privately and give maintainers time to investigate before public disclosure.

## Supported Scope

Security reports are in scope when they affect:

- The code in this repository.
- The public storefront, gateway, API, auth, checkout, payment, upload, admin, realtime, or release-gate surfaces owned by this project.
- Secret handling, environment contracts, CI/CD release workflows, deployment automation, or infrastructure policy in this repository.

Only the default branch and the latest deployed production release are actively supported for security fixes.

## Reporting A Vulnerability

Use GitHub private vulnerability reporting or a GitHub Security Advisory for this repository when available.

If private reporting is not available, contact the maintainer through a private channel first and do not open a public issue with exploit details.

Include:

- A clear description of the issue and affected surface.
- Reproduction steps, proof-of-concept details, or request/response examples.
- The security impact and any required privileges.
- Whether the finding was tested locally, in staging, or read-only against production.

Do not include secrets, tokens, private keys, full customer data, or unrelated personal data in the report.

## Research Rules

Allowed:

- Local testing against your own checkout.
- Read-only production checks that do not access, alter, or exfiltrate another user's data.
- Minimal proof-of-concept requests needed to demonstrate impact.

Not allowed:

- Destructive testing, data deletion, data corruption, persistence, malware, or supply-chain tampering.
- Denial-of-service, load testing, spam, scraping, credential stuffing, social engineering, or physical attacks.
- Accessing, modifying, or exporting data that does not belong to you.
- Public disclosure before the maintainer has confirmed the issue and remediation plan.

## Expected Response

Maintainers aim to acknowledge valid private reports within 72 hours and will prioritize fixes by severity, exploitability, and production blast radius.

Security fixes should follow the repository release discipline:

- Keep the patch surgical.
- Add focused regression coverage when practical.
- Preserve fail-closed behavior for auth, secrets, environment, checkout, and release gates.
- Avoid printing or committing secrets in tests, logs, reports, or screenshots.

## Safe Harbor

Research that follows this policy, avoids privacy harm, and is reported privately in good faith will not be treated as hostile. Activity outside this policy may be considered abusive and may be blocked or reported.
