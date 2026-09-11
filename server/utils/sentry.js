// Guarded Sentry init for the API runtime.
// Disabled by default: no DSN (or NODE_ENV=test without an explicit opt-in)
// means every helper below is a safe no-op and @sentry/node is never required.
//
// Call initSentry() before requiring express/http-dependent modules so the
// SDK's auto-instrumentation (request tracing) hooks apply. server/index.js
// does this at the top of the file.

let sentryModule = null;
let initState = { enabled: false, dsnConfigured: false };
let initialized = false;

const trimValue = (value = '') => (typeof value === 'string' ? value.trim() : '');

const clampSampleRate = (value, fallback = 0.1) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(1, Math.max(0, parsed));
};

const resolveSentryConfig = (env = process.env) => {
    const dsn = trimValue(env.SENTRY_DSN);
    const nodeEnv = String(env.NODE_ENV || 'development');
    const killSwitch = String(env.SENTRY_ENABLED || '').trim().toLowerCase();
    const release = trimValue(env.SENTRY_RELEASE || env.RELEASE_ID || env.GITHUB_SHA) || 'server-unknown';
    const environment = trimValue(env.SENTRY_ENVIRONMENT || nodeEnv) || 'development';
    if (['0', 'false', 'no', 'off'].includes(killSwitch)) {
        return {
            dsn,
            dsnConfigured: Boolean(dsn),
            enabled: false,
            release,
            environment,
            tracesSampleRate: 0,
        };
    }
    const explicitlyEnabled = ['1', 'true', 'yes', 'on'].includes(killSwitch);
    const enabled = Boolean(dsn) && (nodeEnv !== 'test' || explicitlyEnabled);
    return {
        dsn,
        dsnConfigured: Boolean(dsn),
        enabled,
        release,
        environment,
        tracesSampleRate: enabled ? clampSampleRate(env.SENTRY_TRACES_SAMPLE_RATE, 0.1) : 0,
    };
};

const initSentry = (env = process.env) => {
    if (initialized) return initState;
    initialized = true;

    const config = resolveSentryConfig(env);
    initState = { enabled: false, dsnConfigured: config.dsnConfigured };
    if (!config.enabled) return initState;

    try {
        // Lazy require so servers without a DSN never pay the SDK cost.
        sentryModule = require('@sentry/node');
        sentryModule.init({
            dsn: config.dsn,
            release: config.release,
            environment: config.environment,
            // Sampled performance tracing (SENTRY_TRACES_SAMPLE_RATE, default 10%).
            tracesSampleRate: config.tracesSampleRate,
            sendDefaultPii: false,
            beforeSend: (event) => {
                try {
                    // Strip request bodies/headers; logger redaction covers log payloads.
                    if (event.request) {
                        delete event.request.data;
                        delete event.request.headers;
                        delete event.request.cookies;
                    }
                    if (event.user) {
                        delete event.user.ip_address;
                        delete event.user.email;
                    }
                } catch {
                    // Never let redaction break error reporting.
                }
                return event;
            },
        });
        initState = { enabled: true, dsnConfigured: true };
    } catch {
        sentryModule = null;
        initState = { enabled: false, dsnConfigured: config.dsnConfigured };
    }
    return initState;
};

const captureServerException = (error, context = {}) => {
    if (!initState.enabled || !sentryModule) return;
    try {
        sentryModule.captureException(error, {
            tags: {
                aura_route: String(context.route || '').slice(0, 200),
            },
            extra: {
                requestId: String(context.requestId || ''),
                method: String(context.method || '').slice(0, 16),
                statusCode: context.statusCode,
            },
            level: 'error',
        });
    } catch {
        // Sentry must never throw into request handling.
    }
};

const isSentryEnabled = () => initState.enabled;

// Sentry Cron monitor wrapper for interval/cron worker ticks.
// Disabled (or on check-in failure) it just runs fn: monitoring must never
// break the worker. Call sites keep their existing .catch logging; the
// helper rethrows after recording the error check-in.
const withCronMonitor = async (slug, fn, { schedule, checkinMargin = 2, maxRuntime = 10 } = {}) => {
    if (!initState.enabled || !sentryModule) return fn();
    let checkInId;
    const startedAt = Date.now();
    try {
        checkInId = sentryModule.captureCheckIn({
            monitorSlug: slug,
            status: 'in_progress',
            ...(schedule ? {
                monitorConfig: {
                    schedule,
                    checkinMargin,
                    maxRuntime,
                    timezone: 'UTC',
                },
            } : {}),
        });
    } catch {
        return fn();
    }
    try {
        const result = await fn();
        try {
            sentryModule.captureCheckIn({
                monitorSlug: slug,
                status: 'ok',
                checkInId,
                duration: (Date.now() - startedAt) / 1000,
            });
        } catch {
            // Check-in failures must not fail the tick.
        }
        return result;
    } catch (error) {
        try {
            sentryModule.captureCheckIn({
                monitorSlug: slug,
                status: 'error',
                checkInId,
                duration: (Date.now() - startedAt) / 1000,
            });
        } catch {
            // Ignore.
        }
        captureServerException(error, { route: `cron:${slug}` });
        throw error;
    }
};

const __testables = {
    reset: () => {
        sentryModule = null;
        initState = { enabled: false, dsnConfigured: false };
        initialized = false;
    },
};

module.exports = {
    resolveSentryConfig,
    initSentry,
    captureServerException,
    isSentryEnabled,
    withCronMonitor,
    __testables,
};
