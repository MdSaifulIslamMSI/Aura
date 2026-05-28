const { PaymentDomainError, PaymentProviderError } = require('./domainErrors');
const { assertNoRawPaymentData } = require('./stateMachines');

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
            if (attempt >= retries || !shouldRetry(error)) {
                throw error;
            }
            const delayMs = Math.min(maxDelayMs, initialDelayMs * (2 ** attempt));
            await sleep(delayMs);
            attempt += 1;
        }
    }
    throw lastError;
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
    withTimeout,
    retryWithBackoff,
    createCircuitBreaker,
};
