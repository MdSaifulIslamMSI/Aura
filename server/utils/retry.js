const { parsePositiveInteger } = require('./timeout');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseNonNegativeInteger = (value, fallback) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const normalizeRetryOptions = ({
    maxAttempts,
    retries,
    initialDelayMs = 100,
    maxDelayMs = 1000,
    jitterRatio = 0.2,
    idempotent = false,
    idempotencyKey = '',
    allowNonIdempotentRetry = false,
} = {}) => {
    const configuredMaxAttempts = maxAttempts === undefined
        ? parseNonNegativeInteger(retries, 0) + 1
        : parsePositiveInteger(maxAttempts, 1);
    const retryAllowed = Boolean(idempotent || idempotencyKey || allowNonIdempotentRetry);
    return {
        maxAttempts: retryAllowed ? Math.max(1, configuredMaxAttempts) : 1,
        initialDelayMs: parsePositiveInteger(initialDelayMs, 100),
        maxDelayMs: parsePositiveInteger(maxDelayMs, 1000),
        jitterRatio: Math.max(0, Math.min(Number(jitterRatio) || 0, 1)),
    };
};

const computeJitteredBackoffDelayMs = ({
    attempt = 0,
    initialDelayMs = 100,
    maxDelayMs = 1000,
    jitterRatio = 0.2,
    random = Math.random,
} = {}) => {
    const baseDelayMs = Math.min(
        parsePositiveInteger(maxDelayMs, 1000),
        parsePositiveInteger(initialDelayMs, 100) * (2 ** Math.max(0, Number(attempt) || 0))
    );
    const jitter = Math.max(0, Math.min(Number(jitterRatio) || 0, 1));
    if (!jitter) return baseDelayMs;
    const spread = baseDelayMs * jitter;
    const sample = typeof random === 'function' ? Number(random()) : 0.5;
    const boundedSample = Math.max(0, Math.min(Number.isFinite(sample) ? sample : 0.5, 1));
    const multiplier = 1 - jitter + (boundedSample * jitter * 2);
    return Math.max(0, Math.round(baseDelayMs * multiplier || spread));
};

const retryWithJitter = async (operation, options = {}) => {
    const {
        maxAttempts,
        initialDelayMs,
        maxDelayMs,
        jitterRatio,
    } = normalizeRetryOptions(options);
    const shouldRetry = typeof options.shouldRetry === 'function' ? options.shouldRetry : () => true;
    const sleepFn = typeof options.sleepFn === 'function' ? options.sleepFn : sleep;
    const random = typeof options.random === 'function' ? options.random : Math.random;

    let attempt = 0;
    let lastError = null;
    while (attempt < maxAttempts) {
        try {
            return await operation({ attempt, maxAttempts });
        } catch (error) {
            lastError = error;
            const nextAttempt = attempt + 1;
            if (nextAttempt >= maxAttempts || !shouldRetry(error, { attempt, nextAttempt, maxAttempts })) {
                throw error;
            }
            const delayMs = computeJitteredBackoffDelayMs({
                attempt,
                initialDelayMs,
                maxDelayMs,
                jitterRatio,
                random,
            });
            await sleepFn(delayMs, { attempt, nextAttempt, maxAttempts });
            attempt = nextAttempt;
        }
    }
    throw lastError;
};

module.exports = {
    computeJitteredBackoffDelayMs,
    normalizeRetryOptions,
    retryWithJitter,
    sleep,
};
