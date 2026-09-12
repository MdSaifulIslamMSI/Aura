// Guarded Datadog init for the API runtime.
// Disabled by default: no API key (or NODE_ENV=test without an explicit
// opt-in) means every helper below is a safe no-op and dd-trace is never
// required. Mirrors server/utils/sentry.js conventions.
//
// Call initDatadog() before requiring express/http-dependent modules so
// dd-trace auto-instrumentation hooks apply. server/index.js does this at
// the top of the file, right after the Sentry block.

let tracerModule = null;
let initState = { enabled: false, apiKeyConfigured: false, tracerLoaded: false };
let initialized = false;

const trimValue = (value = '') => (typeof value === 'string' ? value.trim() : '');

const clampSampleRate = (value, fallback = 0.1) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(1, Math.max(0, parsed));
};

const toBool = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const resolveDatadogConfig = (env = process.env) => {
    const apiKey = trimValue(env.DATADOG_API_KEY || env.DD_API_KEY);
    const nodeEnv = String(env.NODE_ENV || 'development');
    const killSwitch = String(env.DD_ENABLED ?? env.DATADOG_ENABLED ?? '').trim().toLowerCase();
    const site = trimValue(env.DD_SITE || env.DATADOG_SITE) || 'datadoghq.com';
    const service = trimValue(env.DD_SERVICE) || 'aura-marketplace-api';
    const environment = trimValue(env.DD_ENV) || nodeEnv || 'development';
    const version = trimValue(env.DD_VERSION || env.RELEASE_ID || env.GITHUB_SHA) || 'server-unknown';
    if (['0', 'false', 'no', 'off'].includes(killSwitch)) {
        return {
            apiKey, apiKeyConfigured: Boolean(apiKey), enabled: false,
            site, service, environment, version,
            tracesSampleRate: 0, profilingEnabled: false, logsEnabled: false,
            runtimeMetricsEnabled: false,
        };
    }
    const explicitlyEnabled = ['1', 'true', 'yes', 'on'].includes(killSwitch);
    const enabled = Boolean(apiKey) && (nodeEnv !== 'test' || explicitlyEnabled);
    return {
        apiKey,
        apiKeyConfigured: Boolean(apiKey),
        enabled,
        site,
        service,
        environment,
        version,
        tracesSampleRate: enabled ? clampSampleRate(env.DD_TRACES_SAMPLE_RATE, 0.1) : 0,
        profilingEnabled: enabled && toBool(env.DD_PROFILING_ENABLED, false),
        logsEnabled: enabled && toBool(env.DD_LOGS_ENABLED, true),
        runtimeMetricsEnabled: enabled && toBool(env.DD_RUNTIME_METRICS_ENABLED, false),
    };
};

const logIntakeUrl = (site) => `https://http-intake.logs.${site}/api/v2/logs`;

// api.datadoghq.com is itself the US1 API host; every other site prefixes it.
const apiBaseUrl = (site) => {
    const normalized = String(site || '').trim().toLowerCase() || 'datadoghq.com';
    if (normalized.startsWith('api.')) return `https://${normalized}`;
    return `https://api.${normalized}`;
};

// Read-only API key validity probe (GET /api/v1/validate, 200 = valid).
// fetchImpl is injectable so tests never touch the network.
const validateApiKey = async (apiKey, site, { fetchImpl = fetch, timeoutMs = 5000 } = {}) => {
    const key = trimValue(apiKey);
    if (!key) return { ok: false, status: 0, reason: 'missing_api_key' };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(`${apiBaseUrl(site)}/api/v1/validate`, {
            headers: { 'DD-API-KEY': key },
            signal: controller.signal,
        });
        return { ok: response.status === 200, status: response.status };
    } catch (error) {
        return { ok: false, status: 0, reason: error && error.message ? error.message : 'request_failed' };
    } finally {
        clearTimeout(timeout);
    }
};

const defaultTracerLoader = () => require('dd-trace');

const initDatadog = (env = process.env, deps = {}) => {
    if (initialized) return initState;
    initialized = true;

    const config = resolveDatadogConfig(env);
    initState = { enabled: false, apiKeyConfigured: config.apiKeyConfigured, tracerLoaded: false };
    if (!config.enabled) return initState;

    try {
        // Lazy require so servers without Datadog configured never pay the SDK cost.
        // Install with: npm --prefix server install dd-trace
        tracerModule = (deps.tracerLoader || defaultTracerLoader)();
        tracerModule.init({
            service: config.service,
            env: config.environment,
            version: config.version,
            logInjection: true,
            profiling: config.profilingEnabled,
            runtimeMetrics: config.runtimeMetricsEnabled,
        });
        initState = { enabled: true, apiKeyConfigured: true, tracerLoaded: true };
    } catch {
        tracerModule = null;
        initState = { enabled: false, apiKeyConfigured: config.apiKeyConfigured, tracerLoaded: false };
    }
    return initState;
};

const isDatadogEnabled = () => initState.enabled;

const getDatadogStatus = () => ({ ...initState });

// Fire-and-forget 5xx/error log forwarding to the Datadog HTTP intake.
// Never throws, never blocks: disabled (or on send failure) it resolves false.
// Callers must not await it from request handling.
const logToDatadog = async (level = 'error', message = '', context = {}) => {
    try {
        const config = resolveDatadogConfig();
        if (!config.enabled || !config.logsEnabled) return false;
        const status = level === 'warn' || level === 'warning' ? 'warn' : level === 'error' ? 'error' : 'info';
        const error = context.error instanceof Error ? context.error : null;
        const payload = {
            message: String(message || (error && error.message) || 'Datadog log').slice(0, 4000),
            status,
            service: config.service,
            ddsource: 'nodejs',
            ddtags: `env:${config.environment},version:${config.version}`,
            route: String(context.route || '').slice(0, 200),
            request_id: String(context.requestId || '').slice(0, 100),
            http_method: String(context.method || '').slice(0, 16),
            http_status_code: context.statusCode,
            error_kind: error ? String(error.name || 'Error').slice(0, 100) : undefined,
            error_stack: error ? String(error.stack || '').slice(0, 4000) : undefined,
        };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);
        try {
            const response = await fetch(logIntakeUrl(config.site), {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'DD-API-KEY': config.apiKey,
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            if (!response.ok) {
                // Debug-only: observability must explain its own failures
                // without ever leaking the key or breaking the request.
                try {
                    require('./logger').debug('datadog.log_intake_rejected', {
                        status: response.status,
                        site: config.site,
                        service: config.service,
                    });
                } catch {
                    // Logger must never break log forwarding.
                }
            }
            return response.ok;
        } finally {
            clearTimeout(timeout);
        }
    } catch {
        return false;
    }
};

const resetDatadogForTests = () => {
    tracerModule = null;
    initState = { enabled: false, apiKeyConfigured: false, tracerLoaded: false };
    initialized = false;
};

module.exports = {
    resolveDatadogConfig,
    initDatadog,
    isDatadogEnabled,
    getDatadogStatus,
    logToDatadog,
    validateApiKey,
    resetDatadogForTests,
};
