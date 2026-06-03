# Load Drill Playbook

Allowed targets:

- Local development server.
- Explicitly configured staging owned by Aura.

Forbidden targets:

- Production without written approval and safe read-only limits.
- Third-party domains.
- Any target not owned by Aura.

Drills:

- Public read burst.
- Safe login throttle proof without real OTP/email send.
- Search budget proof.
- Upload budget dry-run.
- AI budget dry-run.
- Status survival.

Stop immediately on elevated provider cost, real user impact, unexpected writes, or missing observability.
