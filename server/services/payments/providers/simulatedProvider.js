const crypto = require('crypto');
const AppError = require('../../../utils/AppError');
const { makeEventId, toPaise, fromPaise } = require('../helpers');

const simulateRef = (seed) => `sim_${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 14)}`;

class SimulatedProvider {
    constructor({ webhookSecret } = {}) {
        this.name = 'simulated';
        this.webhookSecret = String(webhookSecret || '');
    }

    async createOrder({ amount, currency = 'INR', receipt, notes = {} }) {
        const amountPaise = toPaise(amount);
        return {
            id: makeEventId('sim_order'),
            amount: amountPaise,
            currency,
            receipt: receipt || makeEventId('rct'),
            notes,
            status: 'created',
        };
    }

    verifySignature({ orderId, paymentId, signature }) {
        if (!orderId || !paymentId || !signature) return false;
        const expected = simulateRef(`${orderId}|${paymentId}`);
        return expected === signature;
    }

    async fetchPayment(paymentId) {
        return {
            id: paymentId,
            status: 'authorized',
            amount: toPaise(100),
            currency: 'INR',
            method: 'upi',
            card_id: '',
            vpa: 'user@upi',
        };
    }

    async capture({ paymentId, amount, currency = 'INR' }) {
        if (!paymentId) throw new AppError('paymentId is required for capture', 400);
        return {
            id: paymentId,
            status: 'captured',
            amount: toPaise(amount),
            currency,
            captured: true,
        };
    }

    async refund({ paymentId, amount, notes = {} }) {
        if (!paymentId) throw new AppError('paymentId is required for refund', 400);
        return {
            id: makeEventId('sim_refund'),
            payment_id: paymentId,
            amount: toPaise(amount),
            amount_refunded: toPaise(amount),
            currency: 'INR',
            status: 'processed',
            notes,
        };
    }

    parsePaymentMethod(payment = {}) {
        const method = String(payment.method || '').toLowerCase();
        if (method === 'card') {
            return {
                type: 'card',
                brand: String(payment.card?.network || 'Card'),
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
        return { type: 'other', brand: '', last4: '', providerMethodId: '' };
    }

    verifyWebhookSignature({ rawBody, signature }) {
        if (!rawBody || !signature || !this.webhookSecret) return false;
        const expected = crypto
            .createHmac('sha256', this.webhookSecret)
            .update(rawBody)
            .digest('hex');
        if (expected.length !== signature.length) return false;

        return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
    }

    parseWebhook(rawBody) {
        try {
            const event = JSON.parse(rawBody || '{}');
            return event;
        } catch {
            return {};
        }
    }

    normalizeAmount(amountPaise) {
        return fromPaise(amountPaise);
    }
}

module.exports = SimulatedProvider;
