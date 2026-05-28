class PaymentDomainError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'PaymentDomainError';
        this.code = code;
        this.details = details;
        this.expose = true;
    }

    static invalidTransition(entityType, from, to) {
        return new PaymentDomainError(
            'payment.invalid_state_transition',
            `Invalid ${entityType} state transition from ${from} to ${to}.`,
            { entityType, from, to }
        );
    }

    static invalidInput(message, details = {}) {
        return new PaymentDomainError('payment.invalid_input', message, details);
    }

    static duplicate(key, details = {}) {
        return new PaymentDomainError('payment.duplicate', `Duplicate payment operation for ${key}.`, details);
    }

    static unsafePaymentData(fieldPath) {
        return new PaymentDomainError(
            'payment.unsafe_card_data',
            'Raw card data is not allowed in payment architecture payloads.',
            { fieldPath }
        );
    }
}

class PaymentProviderError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'PaymentProviderError';
        this.code = code;
        this.details = details;
        this.expose = false;
    }
}

module.exports = {
    PaymentDomainError,
    PaymentProviderError,
};
