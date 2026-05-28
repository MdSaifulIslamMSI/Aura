const crypto = require('crypto');
const fetch = require('node-fetch');
const { PaymentDomainError, PaymentProviderError } = require('./domainErrors');
const { assertMinorUnitMoney, withTimeout, retryWithBackoff, createCircuitBreaker } = require('./providerContract');
const { assertNoRawPaymentData } = require('./stateMachines');

const BILLING_PROVIDER_METHODS = Object.freeze([
    'createCustomer',
    'createSubscription',
    'cancelSubscription',
    'recordUsage',
    'createInvoice',
    'getInvoice',
    'markInvoicePaid',
]);

const validateBillingProvider = (provider) => {
    BILLING_PROVIDER_METHODS.forEach((method) => {
        if (typeof provider?.[method] !== 'function') {
            throw PaymentDomainError.invalidInput(`Billing provider is missing ${method}.`, { method });
        }
    });
    return provider;
};

const idFrom = (prefix, value) => `${prefix}_${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 18)}`;

class MockBillingProvider {
    constructor() {
        this.name = 'mock';
        this.customers = new Map();
        this.subscriptions = new Map();
        this.invoices = new Map();
        this.usageEvents = new Map();
    }

    async createCustomer(input) {
        assertNoRawPaymentData(input);
        const customerId = input.customerId || idFrom('mock_customer', input.externalCustomerId || input.email);
        const customer = Object.freeze({
            provider: this.name,
            customerId,
            externalCustomerId: input.externalCustomerId,
            email: input.email,
            metadata: Object.freeze({ ...(input.metadata || {}) }),
        });
        this.customers.set(customerId, customer);
        return customer;
    }

    async createSubscription(input) {
        assertNoRawPaymentData(input);
        const subscriptionId = input.subscriptionId || idFrom('mock_sub', `${input.customerId}:${input.planCode}`);
        const subscription = Object.freeze({
            provider: this.name,
            subscriptionId,
            customerId: input.customerId,
            planCode: input.planCode,
            status: 'active',
            metadata: Object.freeze({ ...(input.metadata || {}) }),
        });
        this.subscriptions.set(subscriptionId, subscription);
        return subscription;
    }

    async cancelSubscription(input) {
        const existing = this.subscriptions.get(input.subscriptionId);
        if (!existing) {
            throw PaymentDomainError.invalidInput('Unknown subscription.', { subscriptionId: input.subscriptionId });
        }
        const canceled = Object.freeze({ ...existing, status: 'canceled' });
        this.subscriptions.set(input.subscriptionId, canceled);
        return canceled;
    }

    async recordUsage(input) {
        assertNoRawPaymentData(input);
        if (!input.idempotencyKey) {
            throw PaymentDomainError.invalidInput('idempotencyKey is required for usage events.');
        }
        if (this.usageEvents.has(input.idempotencyKey)) {
            return this.usageEvents.get(input.idempotencyKey);
        }
        const usage = Object.freeze({
            provider: this.name,
            usageEventId: idFrom('mock_usage', input.idempotencyKey),
            customerId: input.customerId,
            subscriptionId: input.subscriptionId,
            metricCode: input.metricCode,
            quantity: input.quantity,
            idempotencyKey: input.idempotencyKey,
            occurredAt: input.occurredAt || new Date().toISOString(),
            metadata: Object.freeze({ ...(input.metadata || {}) }),
        });
        this.usageEvents.set(input.idempotencyKey, usage);
        return usage;
    }

    async createInvoice(input) {
        assertNoRawPaymentData(input);
        assertMinorUnitMoney(input);
        const invoiceId = input.invoiceId || idFrom('mock_invoice', `${input.customerId}:${input.idempotencyKey || Date.now()}`);
        const invoice = Object.freeze({
            provider: this.name,
            invoiceId,
            customerId: input.customerId,
            subscriptionId: input.subscriptionId,
            amountMinor: input.amountMinor,
            currency: input.currency,
            status: 'open',
            metadata: Object.freeze({ ...(input.metadata || {}) }),
        });
        this.invoices.set(invoiceId, invoice);
        return invoice;
    }

    async getInvoice(input) {
        const invoice = this.invoices.get(input.invoiceId);
        if (!invoice) {
            throw PaymentDomainError.invalidInput('Unknown invoice.', { invoiceId: input.invoiceId });
        }
        return invoice;
    }

    async markInvoicePaid(input) {
        const invoice = await this.getInvoice(input);
        const paid = Object.freeze({
            ...invoice,
            status: 'paid',
            paymentIntentId: input.paymentIntentId,
            paidAt: input.paidAt || new Date().toISOString(),
        });
        this.invoices.set(input.invoiceId, paid);
        return paid;
    }
}

class LagoProvider {
    constructor(options = {}) {
        this.name = 'lago';
        this.baseUrl = String(options.baseUrl || '').replace(/\/+$/, '');
        this.apiKey = options.apiKey;
        this.fetchImpl = options.fetchImpl || fetch;
        this.timeoutMs = options.timeoutMs || 5000;
        this.retryOptions = options.retryOptions || { retries: 2, initialDelayMs: 150, maxDelayMs: 1000 };
        this.runWithCircuitBreaker = createCircuitBreaker(options.circuitBreaker);
    }

    assertConfigured() {
        const missing = [];
        if (!this.baseUrl) missing.push('LAGO_BASE_URL');
        if (!this.apiKey) missing.push('LAGO_API_KEY');
        if (missing.length > 0) {
            throw new PaymentProviderError('billing.provider_not_configured', 'Lago provider is not configured.', { missing });
        }
    }

    async request(path, { method = 'GET', body } = {}) {
        this.assertConfigured();
        const response = await this.runWithCircuitBreaker(() => retryWithBackoff(
            () => withTimeout(
                () => this.fetchImpl(`${this.baseUrl}${path}`, {
                    method,
                    headers: {
                        authorization: `Bearer ${this.apiKey}`,
                        'content-type': 'application/json',
                    },
                    body: body ? JSON.stringify(body) : undefined,
                }),
                this.timeoutMs,
                `Lago ${method} ${path}`
            ),
            this.retryOptions
        ));
        const text = await response.text();
        const parsed = text ? JSON.parse(text) : {};
        if (!response.ok) {
            throw new PaymentProviderError('billing.provider_http_error', 'Lago request failed.', {
                status: response.status,
            });
        }
        return parsed;
    }

    async createCustomer(input) {
        assertNoRawPaymentData(input);
        return this.request('/api/v1/customers', {
            method: 'POST',
            body: { customer: input },
        });
    }

    async createSubscription(input) {
        assertNoRawPaymentData(input);
        return this.request('/api/v1/subscriptions', {
            method: 'POST',
            body: { subscription: input },
        });
    }

    async cancelSubscription(input) {
        return this.request(`/api/v1/subscriptions/${encodeURIComponent(input.subscriptionId)}`, {
            method: 'DELETE',
        });
    }

    async recordUsage(input) {
        assertNoRawPaymentData(input);
        return this.request('/api/v1/events', {
            method: 'POST',
            body: { event: input },
        });
    }

    async createInvoice(input) {
        assertNoRawPaymentData(input);
        return this.request('/api/v1/invoices', {
            method: 'POST',
            body: { invoice: input },
        });
    }

    async getInvoice(input) {
        return this.request(`/api/v1/invoices/${encodeURIComponent(input.invoiceId)}`);
    }

    async markInvoicePaid(input) {
        return this.request(`/api/v1/invoices/${encodeURIComponent(input.invoiceId)}/pay`, {
            method: 'POST',
            body: { payment_intent_id: input.paymentIntentId },
        });
    }
}

class KillBillProvider {
    constructor(options = {}) {
        this.name = 'killbill';
        this.baseUrl = options.baseUrl;
        this.apiKey = options.apiKey;
        this.apiSecret = options.apiSecret;
    }

    notEnabled() {
        throw new PaymentProviderError(
            'billing.killbill_contract_only',
            'Kill Bill is documented as a contract only until complex billing requirements need it.'
        );
    }

    async createCustomer() { this.notEnabled(); }
    async createSubscription() { this.notEnabled(); }
    async cancelSubscription() { this.notEnabled(); }
    async recordUsage() { this.notEnabled(); }
    async createInvoice() { this.notEnabled(); }
    async getInvoice() { this.notEnabled(); }
    async markInvoicePaid() { this.notEnabled(); }
}

module.exports = {
    BILLING_PROVIDER_METHODS,
    validateBillingProvider,
    MockBillingProvider,
    LagoProvider,
    KillBillProvider,
};
