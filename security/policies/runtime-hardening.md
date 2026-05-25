# Runtime Hardening Policy

Production containers and hosts should meet these requirements:

- Run application processes as non-root.
- Use read-only filesystem where possible.
- Mount only required writable paths as tmpfs or scoped volumes.
- Drop Linux capabilities unless explicitly required.
- Set `no-new-privileges`.
- Define CPU, memory, and PID limits.
- Enforce health checks before traffic.
- Scan images before deploy.
- Export runtime alerts to the monitoring stack.
- Keep rollback to last known-good build available.

Evidence to attach:

- Dockerfile or platform runtime config.
- Trivy image scan artifact.
- Falco or platform runtime alert test.
- Rollback drill record.
