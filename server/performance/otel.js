const http = require('http');
const https = require('https');
const logger = require('../utils/logger');

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const getOtelConfig = () => ({
    enabled: parseBoolean(process.env.PERFORMANCE_STACK_ENABLED, false)
        && parseBoolean(process.env.OTEL_ENABLED, false),
    serviceName: String(process.env.OTEL_SERVICE_NAME || 'app').trim() || 'app',
    endpoint: String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').trim(),
});

const postJson = (urlString, payload) => new Promise((resolve) => {
    let url;
    try {
        url = new URL(urlString);
    } catch {
        resolve(false);
        return;
    }

    const body = Buffer.from(JSON.stringify(payload));
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request({
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname.replace(/\/$/, '')}/v1/traces`,
        headers: {
            'content-type': 'application/json',
            'content-length': body.length,
        },
        timeout: 1000,
    }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode >= 200 && response.statusCode < 300));
    });

    request.on('timeout', () => {
        request.destroy();
        resolve(false);
    });
    request.on('error', () => resolve(false));
    request.end(body);
});

const recordSpan = async ({ name, durationMs = 0, attributes = {}, error = null } = {}) => {
    const config = getOtelConfig();
    if (!config.enabled || !config.endpoint) return false;

    const nowUnixNano = `${BigInt(Date.now()) * 1000000n}`;
    const durationNano = BigInt(Math.max(0, Math.round(durationMs * 1000000)));
    const startUnixNano = `${BigInt(nowUnixNano) - durationNano}`;
    const traceId = Buffer.from(`${Date.now()}${Math.random()}`).toString('hex').padEnd(32, '0').slice(0, 32);
    const spanId = Buffer.from(`${Math.random()}`).toString('hex').padEnd(16, '0').slice(0, 16);

    const otelAttributes = Object.entries({
        ...attributes,
        'service.name': config.serviceName,
        ...(error ? { 'error.message': error.message || String(error) } : {}),
    }).map(([key, value]) => ({
        key,
        value: { stringValue: String(value) },
    }));

    const payload = {
        resourceSpans: [{
            resource: {
                attributes: [{ key: 'service.name', value: { stringValue: config.serviceName } }],
            },
            scopeSpans: [{
                scope: { name: 'aura-performance-lite' },
                spans: [{
                    traceId,
                    spanId,
                    name: name || 'operation',
                    kind: 1,
                    startTimeUnixNano: startUnixNano,
                    endTimeUnixNano: nowUnixNano,
                    attributes: otelAttributes,
                    status: error ? { code: 2, message: error.message || String(error) } : { code: 1 },
                }],
            }],
        }],
    };

    try {
        return await postJson(config.endpoint, payload);
    } catch (postError) {
        logger.debug('performance.otel_export_failed', { error: postError.message });
        return false;
    }
};

const initOtel = () => {
    const config = getOtelConfig();
    if (!config.enabled) return { enabled: false };
    logger.info('performance.otel_enabled', {
        serviceName: config.serviceName,
        endpointConfigured: Boolean(config.endpoint),
    });
    return { enabled: true, serviceName: config.serviceName, endpointConfigured: Boolean(config.endpoint) };
};

module.exports = {
    getOtelConfig,
    initOtel,
    recordSpan,
};
