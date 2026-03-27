const crypto = require('crypto');
const AppError = require('../../../utils/AppError');
const {
    toMinorUnits,
    fromMinorUnits,
    normalizeCurrencyCode,
} = require('../helpers');

const secureCompare = (left, right) => {
    const leftBuffer = Buffer.from(String(left || ''), 'utf8');
    const rightBuffer = Buffer.from(String(right || ''), 'utf8');
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};


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

    get keyIdOnlyAuthHeader() {
        const token = Buffer.from(`${this.keyId}:`).toString('base64');
        return `Basic ${token}`;
    }

    async request(path, { method = 'GET', body, authHeader } = {}) {
        const response = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
                Authorization: authHeader || this.authHeader,
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
                amount: toMinorUnits(amount, currency),
                currency,
                receipt,
                notes,
                payment_capture: 0,
            },
        });
    }

    async fetchSupportedMethods() {
        return this.request('/methods', {
            authHeader: this.keyIdOnlyAuthHeader,
        });
    }

    verifySignature({ orderId, paymentId, signature }) {
        if (!orderId || !paymentId || !signature) return false;
        const digest = crypto
            .createHmac('sha256', this.keySecret)
            .update(`${orderId}|${paymentId}`)
            .digest('hex');
        return secureCompare(digest, signature);
    }

    verifyWebhookSignature({ rawBody, signature }) {
        if (!rawBody || !signature || !this.webhookSecret) return false;
        const digest = crypto
            .createHmac('sha256', this.webhookSecret)
            .update(rawBody)
            .digest('hex');
        return secureCompare(digest, signature);
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
                amount: toMinorUnits(amount, currency),
                currency,
            },
        });
    }

    async refund({ paymentId, amount, currency = 'INR', notes = {} }) {
        const payload = {
            amount: toMinorUnits(amount, currency),
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
        if (method === 'netbanking') {
            const bankCode = String(payment.bank || payment.acquirer_data?.bank || '');
            return {
                type: 'bank',
                brand: bankCode || 'NetBanking',
                last4: '',
                providerMethodId: bankCode || String(payment.acquirer_data?.bank_transaction_id || ''),
                bankCode,
                bankName: bankCode || 'NetBanking',
            };
        }
        return {
            type: 'other',
            brand: String(payment.method || ''),
            last4: '',
            providerMethodId: '',
        };
    }

    parsePaymentAmounts(payment = {}) {
        const currency = normalizeCurrencyCode(payment.currency || 'INR');
        const amountMinor = Number(payment.amount || 0);
        const amount = fromMinorUnits(amountMinor, currency);
        const baseCurrency = String(payment.base_currency || '').trim().toUpperCase();
        const baseAmountMinor = Number(payment.base_amount || 0);
        const amountRefundedMinor = Number(payment.amount_refunded || 0);

        return {
            amount,
            amountMinor,
            currency,
            amountRefunded: fromMinorUnits(amountRefundedMinor, currency),
            amountRefundedMinor,
            baseAmount: baseCurrency && Number.isFinite(baseAmountMinor) && baseAmountMinor >= 0
                ? fromMinorUnits(baseAmountMinor, baseCurrency)
                : null,
            baseAmountMinor: baseCurrency && Number.isFinite(baseAmountMinor) ? baseAmountMinor : null,
            baseCurrency: baseCurrency || '',
            international: Boolean(payment.international),
        };
    }

    normalizeAmount(amountMinor, currency = 'INR') {
        return fromMinorUnits(amountMinor, currency);
    }
}

module.exports = RazorpayProvider;

