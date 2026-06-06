# Containment Runbook

Containment is temporary by default and should not permanently ban users automatically.

## Available actions

- Revoke session.
- Require step-up.
- Put account in temporary protection mode.
- Freeze admin destructive actions.
- Freeze exports.
- Freeze uploads.
- Freeze API key creation.
- Increase rate-limit severity.
- Emit incident event.

## Safe rollback

- Disable `SECURITY_CONTAINMENT_ENABLED=false` if containment creates false positives.
- Clear in-memory containment by restarting the API process in local/test environments.
- Prefer manual review before disabling audit logging.
