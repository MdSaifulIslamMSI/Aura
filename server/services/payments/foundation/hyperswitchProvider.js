const crypto = require('crypto');
const fetch = require('node-fetch');
const { PaymentDomainError, PaymentProviderError } = require('./domainErrors');
const {
    validatePaymentIntentInput,
    assertMinorUnitMoney,
    withTimeout,
    retryWithBackoff,
    createCircuitBreaker,
} = require('./providerContract');
const { assertNoRawPaymentData } = require('./stateMachines');

class HyperswitchProvider {
    constructor(options = {}) {
        this.name = 'hyperswitch';
        this.baseUrl = String(options.baseUrl || '').replace(/\/+$/, '');
        this.apiKey = options.apiKey;
        this.profileId = options.profileId;
        this.merchantId = options.merchantId;
        this.webhookSecret = options.webhookSecret;
        this.timeoutMs = options.timeoutMs || 5000;
        this.fetchImpl = options.fetchImpl || fetch;
        this.runWithCircuitBreaker = createCircuitBreaker(options.circuitBreaker);
        this.retryOptions = options.retryOptions || { retries: 2, initialDelayMs: 150, maxDelayMs: 1000 };
    }

    assertConfigured() {
        const missing = [];
        if (!this.baseUrl) missing.push('HYPERSWITCH_BASE_URL');
        if (!this.apiKey) missing.push('HYPERSWITCH_API_KEY');
        if (!this.profileId) missing.push('HYPERSWITCH_PROFILE_ID');
        if (!this.merchantId) missing.push('HYPERSWITCH_MERCHANT_ID');
        if (missing.length > 0) {
            throw new PaymentProviderError('payment.provider_not_configured', 'Hyperswitch provider is not configured.', {
                missing,
            });
        }
    }

    async request(path, { method = 'GET', body } = {}) {
        this.assertConfigured();
        const url = `${this.baseUrl}${path}`;
        const headers = {
            'content-type': 'application/json',
            'api-key': this.apiKey,
        };
        const response = await this.runWithCircuitBreaker(() => retryWithBackoff(
            () => withTimeout(
                () => this.fetchImpl(url, {
                    method,
                    headers,
                    body: body ? JSON.stringify(body) : undefined,
                }),
                this.timeoutMs,
                `Hyperswitch ${method} ${path}`
            ),
            this.retryOptions
        ));

        const text = await response.text();
        const parsed = text ? JSON.parse(text) : {};
        if (!response.ok) {
            throw new PaymentProviderError('payment.provider_http_error', 'Hyperswitch request failed.', {
                status: response.status,
                providerErrorCode: parsed?.error?.code || parsed?.code,
            });
        }
        return parsed;
    }

    async createPaymentIntent(input) {
        const safeInput = validatePaymentIntentInput(input);
        const response = await this.request('/payments', {
            method: 'POST',
            body: {
                amount: safeInput.amountMinor,
                currency: safeInput.currency,
                profile_id: this.profileId,
                merchant_id: this.merchantId,
                customer_id: safeInput.customerId,
                merchant_order_reference_id: safeInput.orderId,
                confirm: false,
                metadata: safeInput.metadata,
            },
        });
        return Object.freeze({
            provider: this.name,
            providerReference: response.payment_id || response.id,
            status: response.status || 'requires_confirmation',
            amountMinor: safeInput.amountMinor,
            currency: safeInput.currency,
            customerId: safeInput.customerId,
            orderId: safeInput.orderId,
            clientSecretReference: response.client_secret,
            hostedCheckoutUrl: response.payment_link,
            metadata: Object.freeze({ hyperswitchStatus: response.status }),
        });
    }

    async confirmPayment(input) {
        assertNoRawPaymentData(input);
        const response = await this.request(`/payments/${input.providerReference}/confirm`, {
            method: 'POST',
            body: {
                merchant_id: this.merchantId,
                payment_method: input.paymentMethodReference,
            },
        });
        return Object.freeze({
            provider: this.name,
            providerReference: response.payment_id || input.providerReference,
            status: response.status || 'processing',
        });
    }

    async cancelPayment(input) {
        assertNoRawPaymentData(input);
        const response = await this.request(`/payments/${input.providerReference}/cancel`, {
            method: 'POST',
            body: { merchant_id: this.merchantId },
        });
        return Object.freeze({
            provider: this.name,
            providerReference: response.payment_id || input.providerReference,
            status: response.status || 'canceled',
        });
    }

    async refundPayment(input) {
        assertNoRawPaymentData(input);
        assertMinorUnitMoney(input);
        const response = await this.request('/refunds', {
            method: 'POST',
            body: {
                payment_id: input.providerReference,
                amount: input.amountMinor,
                currency: input.currency,
                merchant_id: this.merchantId,
                reason: input.reason,
            },
        });
        return Object.freeze({
            provider: this.name,
            providerReference: response.refund_id || response.id,
            paymentProviderReference: input.providerReference,
            amountMinor: input.amountMinor,
            currency: input.currency,
            status: response.status || 'processing',
        });
    }

    async getPaymentStatus(input) {
        const response = await this.request(`/payments/${input.providerReference}?merchant_id=${encodeURIComponent(this.merchantId)}`);
        return Object.freeze({
            provider: this.name,
            providerReference: response.payment_id || input.providerReference,
            status: response.status,
            amountMinor: response.amount,
            currency: response.currency,
        });
    }

    verifyWebhookSignature(rawBody, headers = {}) {
        if (!this.webhookSecret) {
            return false;
        }
        const signature = headers['x-webhook-signature']
            || headers['x-hyperswitch-signature']
            || headers['X-Webhook-Signature']
            || headers['X-Hyperswitch-Signature'];
        if (!signature) {
            return false;
        }
        const expected = crypto
            .createHmac('sha256', this.webhookSecret)
            .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8'))
            .digest('hex');
        const actualBuffer = Buffer.from(String(signature));
        const expectedBuffer = Buffer.from(expected);
        return actualBuffer.length === expectedBuffer.length
            && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
    }

    parseWebhook(rawBody, headers = {}) {
        if (!this.verifyWebhookSignature(rawBody, headers)) {
            throw PaymentDomainError.invalidInput('Invalid Hyperswitch webhook signature.');
        }
        const payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '{}'));
        return Object.freeze({
            provider: this.name,
            eventId: payload.event_id || payload.id,
            type: payload.event_type || payload.type,
            payload: Object.freeze(payload),
        });
    }
}

module.exports = {
    HyperswitchProvider,
};
