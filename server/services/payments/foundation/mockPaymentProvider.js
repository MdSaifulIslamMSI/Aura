const crypto = require('crypto');
const { PaymentDomainError } = require('./domainErrors');
const {
    validatePaymentIntentInput,
    assertMinorUnitMoney,
} = require('./providerContract');
const { assertNoRawPaymentData } = require('./stateMachines');

const safeJson = (value) => JSON.stringify(value || {});

const hmac = (secret, payload) => crypto
    .createHmac('sha256', secret)
    .update(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload || ''), 'utf8'))
    .digest('hex');

class MockPaymentProvider {
    constructor(options = {}) {
        this.name = 'mock';
        this.webhookSecret = options.webhookSecret || 'mock-payment-webhook-secret';
        this.intents = new Map();
        this.refunds = new Map();
        this.idempotency = new Map();
        this.webhookEvents = new Set();
    }

    idFrom(prefix, seed) {
        const digest = crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 16);
        return `${prefix}_${digest}`;
    }

    replayOrStore(idempotencyKey, operation) {
        if (this.idempotency.has(idempotencyKey)) {
            return this.idempotency.get(idempotencyKey);
        }
        const result = operation();
        this.idempotency.set(idempotencyKey, result);
        return result;
    }

    async createPaymentIntent(input) {
        const safeInput = validatePaymentIntentInput(input);
        return this.replayOrStore(safeInput.idempotencyKey, () => {
            const providerReference = this.idFrom('mock_pi', `${safeInput.orderId}:${safeInput.idempotencyKey}`);
            const intent = Object.freeze({
                provider: this.name,
                providerReference,
                status: 'requires_confirmation',
                amountMinor: safeInput.amountMinor,
                currency: safeInput.currency,
                customerId: safeInput.customerId,
                orderId: safeInput.orderId,
                clientSecretReference: this.idFrom('mock_client', providerReference),
                hostedCheckoutUrl: `https://payments.local/mock/checkout/${providerReference}`,
                metadata: safeInput.metadata,
            });
            this.intents.set(providerReference, intent);
            return intent;
        });
    }

    async confirmPayment(input) {
        assertNoRawPaymentData(input);
        const { providerReference, idempotencyKey } = input || {};
        if (!idempotencyKey) {
            throw PaymentDomainError.invalidInput('idempotencyKey is required for payment confirmation.');
        }
        const existing = this.intents.get(providerReference);
        if (!existing) {
            throw PaymentDomainError.invalidInput('Unknown mock payment intent.', { providerReference });
        }
        return this.replayOrStore(idempotencyKey, () => {
            const confirmed = Object.freeze({ ...existing, status: 'succeeded' });
            this.intents.set(providerReference, confirmed);
            return confirmed;
        });
    }

    async cancelPayment(input) {
        const { providerReference, idempotencyKey } = input || {};
        if (!idempotencyKey) {
            throw PaymentDomainError.invalidInput('idempotencyKey is required for payment cancellation.');
        }
        const existing = this.intents.get(providerReference);
        if (!existing) {
            throw PaymentDomainError.invalidInput('Unknown mock payment intent.', { providerReference });
        }
        return this.replayOrStore(idempotencyKey, () => {
            const canceled = Object.freeze({ ...existing, status: 'canceled' });
            this.intents.set(providerReference, canceled);
            return canceled;
        });
    }

    async refundPayment(input) {
        assertNoRawPaymentData(input);
        const { providerReference, amountMinor, currency, idempotencyKey } = input || {};
        assertMinorUnitMoney({ amountMinor, currency });
        if (!idempotencyKey) {
            throw PaymentDomainError.invalidInput('idempotencyKey is required for refunds.');
        }
        const existing = this.intents.get(providerReference);
        if (!existing || existing.status !== 'succeeded') {
            throw PaymentDomainError.invalidInput('Only succeeded mock payments can be refunded.', { providerReference });
        }
        return this.replayOrStore(idempotencyKey, () => {
            const refund = Object.freeze({
                provider: this.name,
                providerReference: this.idFrom('mock_refund', `${providerReference}:${idempotencyKey}`),
                paymentProviderReference: providerReference,
                amountMinor,
                currency,
                status: 'succeeded',
            });
            this.refunds.set(refund.providerReference, refund);
            return refund;
        });
    }

    async getPaymentStatus(input) {
        const intent = this.intents.get(input?.providerReference);
        if (!intent) {
            throw PaymentDomainError.invalidInput('Unknown mock payment intent.', {
                providerReference: input?.providerReference,
            });
        }
        return intent;
    }

    verifyWebhookSignature(rawBody, headers = {}) {
        const signature = headers['x-mock-signature'] || headers['X-Mock-Signature'];
        const expected = hmac(this.webhookSecret, rawBody);
        const actualBuffer = Buffer.from(String(signature || ''));
        const expectedBuffer = Buffer.from(expected);
        return Boolean(signature)
            && actualBuffer.length === expectedBuffer.length
            && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
    }

    parseWebhook(rawBody, headers = {}) {
        if (!this.verifyWebhookSignature(rawBody, headers)) {
            throw PaymentDomainError.invalidInput('Invalid mock webhook signature.');
        }
        const parsed = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '{}'));
        if (!parsed.id || !parsed.type) {
            throw PaymentDomainError.invalidInput('Webhook event id and type are required.');
        }
        const duplicate = this.webhookEvents.has(parsed.id);
        this.webhookEvents.add(parsed.id);
        return Object.freeze({
            provider: this.name,
            eventId: parsed.id,
            type: parsed.type,
            duplicate,
            payload: Object.freeze(parsed),
        });
    }

    signWebhook(payload) {
        const rawBody = safeJson(payload);
        return {
            rawBody,
            headers: {
                'x-mock-signature': hmac(this.webhookSecret, rawBody),
            },
        };
    }
}

module.exports = {
    MockPaymentProvider,
};
