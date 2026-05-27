const endpoint = String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').trim();

if (endpoint) {
    try {
        const { NodeSDK } = require('@opentelemetry/sdk-node');
        const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
        const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
        const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
        const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');

        const normalizedEndpoint = endpoint.replace(/\/+$/, '');
        const sdk = new NodeSDK({
            serviceName: process.env.OTEL_SERVICE_NAME || 'aura-marketplace-api',
            traceExporter: new OTLPTraceExporter({
                url: `${normalizedEndpoint}/v1/traces`,
            }),
            metricReader: new PeriodicExportingMetricReader({
                exporter: new OTLPMetricExporter({
                    url: `${normalizedEndpoint}/v1/metrics`,
                }),
            }),
            instrumentations: [getNodeAutoInstrumentations()],
        });

        sdk.start();

        const shutdown = () => {
            sdk.shutdown().catch(() => undefined);
        };

        process.once('SIGTERM', shutdown);
        process.once('SIGINT', shutdown);
    } catch (error) {
        console.warn('otel.bootstrap_skipped', {
            reason: error && error.message ? error.message : 'unknown_error',
        });
    }
}
