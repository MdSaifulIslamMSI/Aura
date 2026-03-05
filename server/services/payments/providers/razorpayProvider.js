const crypto = require('crypto');
const AppError = require('../../../utils/AppError');
const { toPaise, fromPaise } = require('../helpers');

class RazorpayProvider {
    constructor({ keyId, keySecret, webhookSecret }) {
        this.name = 'razorpay';
        this.keyId = keyId;
        this.keySecret = keySecret;
        this.webhookSecret = webhookSecret;
        this.baseUrl = 'https://api.razorpay.com/v1';
    }

    get authHeader() {
        const token = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
        return `Basic ${token}`;
    }

    async request(path, { method = 'GET', body } = {}) {
        const response = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
                Authorization: this.authHeader,
                'Content-Type': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new AppError(
                data?.error?.description || data?.message || `Razorpay API error: ${response.status}`,
                response.status >= 500 ? 502 : 400
            );
        }
        return data;
    }

    async createOrder({ amount, currency = 'INR', receipt, notes = {} }) {
        return this.request('/orders', {
            method: 'POST',
            body: {
                amount: toPaise(amount),
                currency,
                receipt,
                notes,
                payment_capture: 0,
            },
        });
    }

    verifySignature({ orderId, paymentId, signature }) {
        if (!orderId || !paymentId || !signature) return false;
        const digest = crypto
            .createHmac('sha256', this.keySecret)
            .update(`${orderId}|${paymentId}`)
            .digest('hex');
        return digest === signature;
    }

    verifyWebhookSignature({ rawBody, signature }) {
        if (!rawBody || !signature || !this.webhookSecret) return false;
        const digest = crypto
            .createHmac('sha256', this.webhookSecret)
            .update(rawBody)
            .digest('hex');
        return digest === signature;
    }

    parseWebhook(rawBody) {
        return JSON.parse(rawBody || '{}');
    }

    async fetchPayment(paymentId) {
        return this.request(`/payments/${paymentId}`);
    }

    async capture({ paymentId, amount, currency = 'INR' }) {
        return this.request(`/payments/${paymentId}/capture`, {
            method: 'POST',
            body: {
                amount: toPaise(amount),
                currency,
            },
        });
    }

    async refund({ paymentId, amount, notes = {} }) {
        const payload = {
            amount: toPaise(amount),
            notes,
        };
        return this.request(`/payments/${paymentId}/refund`, {
            method: 'POST',
            body: payload,
        });
    }

    parsePaymentMethod(payment = {}) {
        const method = String(payment.method || '').toLowerCase();
        if (method === 'card') {
            return {
                type: 'card',
                brand: String(payment.card?.network || payment.card?.issuer || 'Card'),
                last4: String(payment.card?.last4 || ''),
                providerMethodId: String(payment.card_id || ''),
            };
        }
        if (method === 'upi') {
            return {
                type: 'upi',
                brand: 'UPI',
                last4: '',
                providerMethodId: String(payment.vpa || ''),
            };
        }
        if (method === 'wallet') {
            return {
                type: 'wallet',
                brand: String(payment.wallet || 'Wallet'),
                last4: '',
                providerMethodId: String(payment.wallet || ''),
            };
        }
        return {
            type: 'other',
            brand: String(payment.method || ''),
            last4: '',
            providerMethodId: '',
        };
    }

    normalizeAmount(amountPaise) {
        return fromPaise(amountPaise);
    }
}

module.exports = RazorpayProvider;

