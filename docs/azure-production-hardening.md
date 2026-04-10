# Azure Production Hardening

This runbook provisions the managed Azure edge and observability layer used by the live Aura backend.

Warning: this runbook creates extra billable monitoring resources. It is not part of the low-cost default deployment path and should only be used when you explicitly want the additional spend for alerts and deep observability.

Note: Azure for Students blocks Azure Front Door. The script detects that limitation automatically and still applies the telemetry, alerting, replica, and optional Redis hardening against the live Container Apps runtime. Because the Container Apps App Insights telemetry command is still preview, the script also injects the Application Insights connection string directly into the API and worker apps so telemetry does not depend on the preview binding alone.

## What it adds

- Azure Front Door Standard in front of the API Container App
- Azure Front Door WAF policy
- Front Door diagnostics into the existing Log Analytics workspace
- Application Insights telemetry on the Container Apps environment
- Explicit Application Insights connection-string env vars on the API and worker apps
- Action group email notifications
- Metric alerts for:
  - API 5xx spikes
  - API replica loss
  - API restarts
  - worker restarts
- Scheduled query alert for fatal Container Apps platform events
- Optional Azure Cache for Redis migration

## Safe default

The WAF is provisioned in `Detection` mode by default so the edge can be observed before enforcement is enabled. After reviewing WAF logs and confirming no false positives, rerun the script with `-WafMode Prevention`.

## Command

```powershell
powershell -ExecutionPolicy Bypass -File infra\azure\harden-edge-observability.ps1 -EnableBudgetHeavyObservability
```

## Optional Azure Redis migration

```powershell
powershell -ExecutionPolicy Bypass -File infra\azure\harden-edge-observability.ps1 -EnableBudgetHeavyObservability -MigrateRedis
```

## Post-run cutover

After Front Door health is green, set the frontend API base to:

```text
https://<front-door-host>/api
```

Then redeploy Vercel so browser traffic flows through the Azure edge instead of calling the Container App URL directly.
