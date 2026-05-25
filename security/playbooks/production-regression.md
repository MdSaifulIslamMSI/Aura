# Production Regression Playbook

## Trigger

- Health check failure.
- 5xx spike.
- Latency regression.
- Auth, upload, payment, webhook, or email flow breaks.
- Security middleware blocks valid users.

## Immediate Actions

1. Confirm impact, start time, and affected routes.
2. Check latest deploy commit and feature flags.
3. Roll back if a trigger in the release watch plan is met.
4. If small and isolated, open a hotfix branch and run focused tests.
5. Preserve logs, metrics, and deployment event links.

## Evidence

- Release/PR/commit.
- Health and error metrics.
- Request IDs and affected users.
- Rollback or hotfix command.
- Post-fix test result.

## Recovery

- Complete post-release review.
- Add missing canary/alert/test.
- Close 24-hour watch only after stability is confirmed.
