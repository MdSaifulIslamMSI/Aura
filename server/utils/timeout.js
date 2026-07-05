class TimeoutError extends Error {
    constructor(message, {
        label = 'operation',
        timeoutMs = 0,
        code = 'DEPENDENCY_TIMEOUT',
        statusCode = 503,
    } = {}) {
        super(message || `${label} timed out after ${timeoutMs}ms.`);
        this.name = 'TimeoutError';
        this.code = code;
        this.label = label;
        this.timeoutMs = timeoutMs;
        this.statusCode = statusCode;
        this.expose = false;
    }
}

const parsePositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const withTimeout = async (operation, {
    label = 'operation',
    timeoutMs = 5000,
    code = 'DEPENDENCY_TIMEOUT',
    statusCode = 503,
} = {}) => {
    const effectiveTimeoutMs = parsePositiveInteger(timeoutMs, 5000);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;

    try {
        return await Promise.race([
            Promise.resolve().then(() => operation({ signal: controller?.signal })),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    controller?.abort();
                    reject(new TimeoutError(undefined, {
                        label,
                        timeoutMs: effectiveTimeoutMs,
                        code,
                        statusCode,
                    }));
                }, effectiveTimeoutMs);
                if (typeof timer.unref === 'function') timer.unref();
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
};

module.exports = {
    TimeoutError,
    parsePositiveInteger,
    withTimeout,
};
