# Observability Foundation

This repo exposes Prometheus metrics at `/metrics`, health at `/health` and `/health/live`, and structured request logs with request ids. The DevOps foundation uses open standards and free tools:

- OpenTelemetry Collector for vendor-neutral traces, metrics, and logs collection.
- Prometheus for metrics and alert rules.
- Grafana for dashboards.
- Loki and Promtail for log aggregation examples.

## Local Stack

```sh
docker compose -f docker-compose.yml -f docker-compose.observability.yml up --build
```

Open:

- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3002` with local example credentials `admin/admin`
- Loki: `http://localhost:3100`
- OTLP HTTP: `http://localhost:4318`

## Node.js Instrumentation

`server/observability/otel.js` is optional and fail-open. It starts only when `OTEL_EXPORTER_OTLP_ENDPOINT` is configured and the OpenTelemetry packages are installed. To enable it in a runtime image or process manager:

```sh
NODE_OPTIONS="--require ./observability/otel.js"
OTEL_SERVICE_NAME=aura-marketplace-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

Recommended packages when enabling full auto-instrumentation:

```sh
npm --prefix server install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http
```

The bootstrap catches missing packages and exporter errors so observability never prevents the API from starting.

## Logging Guidance

- Keep logs structured JSON through `server/utils/logger`.
- Preserve `requestId` and `x-request-id` across services.
- Add trace ids to log fields when OpenTelemetry is enabled.
- Never log tokens, credentials, cookies, authorization headers, or full database URLs.

## Datadog (Optional, Fail-Open)

Runtime observability stays vendor-neutral (Prometheus/Grafana/Loki/OTel above).
Datadog is an opt-in layer; every integration is disabled by default and never
blocks boot, requests, or tests:

- **Server APM** — `server/utils/datadog.js` initializes `dd-trace`
  (auto-instruments Express/HTTP/Mongoose) when `DATADOG_API_KEY` (or
  `DD_API_KEY`) is set. Wired in `server/index.js` before the Express require
  so hooks apply. Install: `npm --prefix server install dd-trace`
  (declared optional; omitting it only disables APM, never boot).
  Knobs: `DD_SERVICE` (default `aura-marketplace-api`), `DD_ENV`,
  `DD_VERSION`, `DD_SITE` (default `datadoghq.com`),
  `DD_TRACES_SAMPLE_RATE` (default `0.1`), `DD_PROFILING_ENABLED`,
  `DD_RUNTIME_METRICS_ENABLED`, kill switch `DD_ENABLED=0`.
- **Server error logs** — `server/middleware/errorMiddleware.js` forwards 5xx
  failures to the Datadog HTTP log intake, fire-and-forget with a 1.5s
  timeout. Toggle with `DD_LOGS_ENABLED` (default on when Datadog is on).
- **Frontend RUM** — `app/src/services/datadogRum.js` loads the official
  browser-agent CDN bundle (zero npm dep, zero app-bundle impact) when
  `VITE_DD_APPLICATION_ID` + `VITE_DD_CLIENT_TOKEN` are set, and bridges the
  client-diagnostics pipeline into `DD_RUM.addError`. Replays are
  privacy-masked. Knobs: `VITE_DD_SITE`, `VITE_DD_SERVICE`,
  `VITE_DD_SESSION_SAMPLE_RATE` (default `10`),
  `VITE_DD_SESSION_REPLAY_SAMPLE_RATE` (default `20`).
- **CI Visibility** — JUnit + coverage uploads, no runtime dependency:

```sh
npm run student-pack:datadog:doctor
npm run student-pack:datadog:junit -- test-results --dry-run
npm run student-pack:datadog:coverage -- coverage --dry-run
```

Requires `DATADOG_API_KEY` (or `DD_API_KEY`). Optional: `DD_SERVICE`
(default `aura-marketplace`), `DD_ENV`, `DD_SITE` (default `datadoghq.com`).

CI uploads run automatically on every CI run once the `DATADOG_API_KEY`
GitHub secret is set: `ci.yml` ships backend (jest-junit) and frontend
(vitest junit) reports per shard, and `quality.yml` ships both LCOV files.
Every upload step is `continue-on-error` and skips cleanly without the
secret, so forks and key-less runs stay green.

## Kubernetes Notes

- Prometheus can scrape pods through annotations or a ServiceMonitor if the cluster has the Prometheus Operator.
- Metrics endpoints should be protected in production with `METRICS_SECRET` and a private scrape path.
- Loki collection should be deployed through the official Helm chart in real clusters; the provided config is a local starter.
