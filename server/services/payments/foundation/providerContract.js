const { PaymentDomainError, PaymentProviderError } = require('./domainErrors');
const { assertNoRawPaymentData } = require('./stateMachines');
const logger = require('../../../utils/logger');

const DEFAULT_PROVIDER_TIMEOUT_MS = 10000;
const DEFAULT_PROVIDER_REFUND_TIMEOUT_MS = 15000;
const DEFAULT_PROVIDER_RETRIES = 1;
const DEFAULT_PROVIDER_RETRY_DELAY_MS = 150;
const RETRYABLE_PROVIDER_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETDOWN',
    'ENETRESET',
    'ENETUNREACH',
    'ETIMEDOUT',
]);

const REQUIRED_PROVIDER_METHODS = Object.freeze([
    'createPaymentIntent',
    'confirmPayment',
    'cancelPayment',
    'refundPayment',
    'getPaymentStatus',
    'verifyWebhookSignature',
    'parseWebhook',
]);

const validatePaymentProvider = (provider) => {
    if (!provider || typeof provider !== 'object') {
        throw PaymentDomainError.invalidInput('Payment provider must be an object.');
    }

    REQUIRED_PROVIDER_METHODS.forEach((method) => {
        if (typeof provider[method] !== 'function') {
            throw PaymentDomainError.invalidInput(`Payment provider is missing ${method}.`, { method });
        }
    });

    return provider;
};

const assertMinorUnitMoney = ({ amountMinor, currency }) => {
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        throw PaymentDomainError.invalidInput('Payment amount must be a positive integer minor-unit value.', {
            amountMinor,
        });
    }

    if (!/^[A-Z]{3}$/.test(String(currency || ''))) {
        throw PaymentDomainError.invalidInput('Payment currency must be a three-letter ISO currency code.', {
            currency,
        });
    }
};

const validatePaymentIntentInput = (input) => {
    assertNoRawPaymentData(input);
    assertMinorUnitMoney(input);

    if (!input.idempotencyKey || typeof input.idempotencyKey !== 'string') {
        throw PaymentDomainError.invalidInput('idempotencyKey is required for payment provider mutations.');
    }

    return Object.freeze({
        amountMinor: input.amountMinor,
        currency: input.currency,
        customerId: input.customerId,
        orderId: input.orderId,
        paymentMethodReference: input.paymentMethodReference,
        idempotencyKey: input.idempotencyKey,
        metadata: Object.freeze({ ...(input.metadata || {}) }),
    });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parsePositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseNonNegativeInteger = (value, fallback) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const resolveProviderResilienceConfig = (options = {}) => ({
    timeoutMs: parsePositiveInteger(
        options.timeoutMs ?? process.env.PAYMENT_PROVIDER_TIMEOUT_MS,
        DEFAULT_PROVIDER_TIMEOUT_MS
    ),
    refundTimeoutMs: parsePositiveInteger(
        options.refundTimeoutMs ?? process.env.PAYMENT_PROVIDER_REFUND_TIMEOUT_MS,
        DEFAULT_PROVIDER_REFUND_TIMEOUT_MS
    ),
    retries: parseNonNegativeInteger(
        options.retries ?? process.env.PAYMENT_PROVIDER_RETRIES,
        DEFAULT_PROVIDER_RETRIES
    ),
    retryDelayMs: parsePositiveInteger(
        options.retryDelayMs ?? process.env.PAYMENT_PROVIDER_RETRY_DELAY_MS,
        DEFAULT_PROVIDER_RETRY_DELAY_MS
    ),
});

const withTimeout = async (operation, timeoutMs, label) => {
    let timer = null;
    try {
        return await Promise.race([
            operation(),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(new PaymentProviderError('payment.provider_timeout', `${label} timed out.`, { timeoutMs }));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
};

const retryWithBackoff = async (operation, options = {}) => {
    const retries = Number.isInteger(options.retries) ? options.retries : 2;
    const initialDelayMs = Number.isInteger(options.initialDelayMs) ? options.initialDelayMs : 100;
    const maxDelayMs = Number.isInteger(options.maxDelayMs) ? options.maxDelayMs : 1000;
    const shouldRetry = typeof options.shouldRetry === 'function'
        ? options.shouldRetry
        : () => true;

    let attempt = 0;
    let lastError = null;
    while (attempt <= retries) {
        try {
            return await operation({ attempt });
        } catch (error) {
            lastError = error;
            if (attempt >= retries || !shouldRetry(error, { attempt, retries })) {
                throw error;
            }
            const delayMs = Math.min(maxDelayMs, initialDelayMs * (2 ** attempt));
            await sleep(delayMs);
            attempt += 1;
        }
    }
    throw lastError;
};

const getProviderStatusCode = (error) => {
    const status = Number(
        error?.providerStatusCode
        || error?.statusCode
        || error?.status
        || error?.details?.providerStatusCode
        || error?.details?.statusCode
        || error?.raw?.statusCode
        || error?.response?.status
    );
    return Number.isFinite(status) ? status : 0;
};

const isRetryableProviderError = (error) => {
    if (!error) return false;
    if (error.code === 'payment.provider_timeout') return true;
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
    if (RETRYABLE_NETWORK_CODES.has(String(error.code || ''))) return true;
    return RETRYABLE_PROVIDER_STATUSES.has(getProviderStatusCode(error));
};

const createProviderTimeoutError = ({ providerName, operationName, timeoutMs, attempt }) => (
    new PaymentProviderError(
        'payment.provider_timeout',
        `${providerName}.${operationName} timed out.`,
        { providerName, operationName, timeoutMs, attempt }
    )
);

const runAbortableAttempt = async ({
    providerName,
    operationName,
    operation,
    timeoutMs,
    attempt,
}) => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    try {
        return await Promise.race([
            operation({ signal: controller?.signal, attempt }),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    controller?.abort();
                    reject(createProviderTimeoutError({
                        providerName,
                        operationName,
                        timeoutMs,
                        attempt,
                    }));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
};

const withProviderTimeout = async (
    providerName,
    operationName,
    operation,
    options = {}
) => {
    const config = resolveProviderResilienceConfig(options);
    const timeoutMs = parsePositiveInteger(options.timeoutMs, config.timeoutMs);
    const retryDelayMs = parsePositiveInteger(options.retryDelayMs, config.retryDelayMs);
    const configuredRetries = parseNonNegativeInteger(options.retries, config.retries);
    const idempotencyKey = String(options.idempotencyKey || '').trim();
    const isMutation = options.mutation !== false;
    const retries = isMutation && !idempotencyKey ? 0 : configuredRetries;
    const meta = {
        providerName,
        operationName,
        mutation: isMutation,
        idempotencyKeyPresent: Boolean(idempotencyKey),
    };

    try {
        return await retryWithBackoff(
            ({ attempt }) => runAbortableAttempt({
                providerName,
                operationName,
                operation,
                timeoutMs,
                attempt,
            }),
            {
                retries,
                initialDelayMs: retryDelayMs,
                maxDelayMs: retryDelayMs * 4,
                shouldRetry: (error, { attempt }) => {
                    const retryable = isRetryableProviderError(error);
                    if (retryable) {
                        logger.warn('Payment provider call retrying', {
                            ...meta,
                            attempt,
                            nextAttempt: attempt + 1,
                            statusCode: getProviderStatusCode(error) || undefined,
                            code: error?.code || error?.name || 'unknown',
                        });
                    }
                    return retryable;
                },
            }
        );
    } catch (error) {
        logger.warn('Payment provider call failed', {
            ...meta,
            statusCode: getProviderStatusCode(error) || undefined,
            code: error?.code || error?.name || 'unknown',
            retryable: isRetryableProviderError(error),
        });
        throw error;
    }
};

const createCircuitBreaker = ({
    failureThreshold = 3,
    resetAfterMs = 30000,
} = {}) => {
    let failures = 0;
    let openedAt = null;

    return async (operation) => {
        if (openedAt && Date.now() - openedAt < resetAfterMs) {
            throw new PaymentProviderError('payment.circuit_open', 'Payment provider circuit breaker is open.');
        }
        if (openedAt && Date.now() - openedAt >= resetAfterMs) {
            failures = 0;
            openedAt = null;
        }

        try {
            const result = await operation();
            failures = 0;
            openedAt = null;
            return result;
        } catch (error) {
            failures += 1;
            if (failures >= failureThreshold) {
                openedAt = Date.now();
            }
            throw error;
        }
    };
};

module.exports = {
    REQUIRED_PROVIDER_METHODS,
    validatePaymentProvider,
    validatePaymentIntentInput,
    assertMinorUnitMoney,
    DEFAULT_PROVIDER_TIMEOUT_MS,
    DEFAULT_PROVIDER_REFUND_TIMEOUT_MS,
    resolveProviderResilienceConfig,
    withTimeout,
    retryWithBackoff,
    isRetryableProviderError,
    withProviderTimeout,
    createCircuitBreaker,
};
