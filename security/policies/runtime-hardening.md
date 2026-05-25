# Runtime Hardening Policy

Production containers and hosts should meet these requirements:

- Run application processes as non-root.
- Use read-only filesystem where possible.
- Mount only required writable paths as tmpfs or scoped volumes.
- Drop Linux capabilities unless explicitly required.
- Set `no-new-privileges`.
- Apply seccomp/AppArmor profiles where the runtime supports them.
- Define CPU, memory, and PID limits.
- Enforce health checks before traffic.
- Scan images before deploy.
- Detect container escape indicators, suspicious shell execution, unexpected writes, and privilege escalation attempts.
- Export runtime alerts to the monitoring stack.
- Keep rollback to last known-good build available.

Evidence to attach:

- Dockerfile or platform runtime config.
- Trivy image scan artifact.
- Falco or platform runtime alert test.
- Container escape or suspicious behavior drill.
- Resource-limit and read-only filesystem proof.
- Rollback drill record.
