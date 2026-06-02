# OpenSSL/OQS Staging Lab

This guide is staging/lab only. Do not deploy experimental OQS TLS to production blindly.

## Rules

- Use containers or disposable staging hosts.
- Do not replace system OpenSSL.
- Test OpenSSL 3.5+.
- Test oqs-provider only when it helps answer a specific compatibility question.
- Test hybrid key exchange before any PQ-only experiment.
- Record certificate size, handshake performance, client compatibility, and operational issues.
- Destroy test keys after experiments.

## Example Lab Shape

```text
labs/oqs/
  Dockerfile.openssl-oqs
  docker-compose.yml
  certs/
  README.md
```

Example flow:

```sh
docker compose build
docker compose up
openssl version -a
openssl list -kem-algorithms
```

## Suggested Experiments

- Compare normal TLS 1.3 and hybrid key exchange handshakes.
- Measure certificate and handshake size changes.
- Validate browser, Node.js, curl, and service-client compatibility.
- Confirm rollback to normal TLS 1.3.
- Confirm no production secrets enter lab containers.

## Exit Criteria

- Compatibility report recorded.
- Test keys destroyed.
- No system OpenSSL replaced.
- No production proxy configuration changed.
- Follow-up tracked in `docs/security/post-quantum-readiness.md` or the relevant release notes.

