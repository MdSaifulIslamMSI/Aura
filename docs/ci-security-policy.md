# CI Security Policy

## Permissions

- Workflows declare least-privilege permissions.
- Quality jobs use `contents: read`.
- CodeQL additionally uses `actions: read` and `security-events: write`.
- Production release permissions remain isolated in deployment workflows.

## Untrusted pull requests

- Never expose repository secrets to pull requests from forks.
- Sonar analysis runs only when the event is trusted enough to access repository secrets.
- Production deploys run from `main`, not from untrusted pull-request events.
- Do not use `pull_request_target` for build or scan execution.

## Production safety

- `.github/workflows/production-on-push.yml` remains the automatic main-push orchestrator.
- `.github/workflows/production-cicd.yml` remains the manual production command center.
- Scanner experiments must stabilize in PR checks before becoming deployment prerequisites.
- Store publishing and signed releases require explicit credentials and release inputs.
