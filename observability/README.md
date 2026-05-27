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

## Kubernetes Notes

- Prometheus can scrape pods through annotations or a ServiceMonitor if the cluster has the Prometheus Operator.
- Metrics endpoints should be protected in production with `METRICS_SECRET` and a private scrape path.
- Loki collection should be deployed through the official Helm chart in real clusters; the provided config is a local starter.
