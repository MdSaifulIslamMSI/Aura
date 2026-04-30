const crypto = require('crypto');
const Stripe = require('stripe');
const AppError = require('../../../utils/AppError');
const {
    toMinorUnits,
    fromMinorUnits,
    normalizeCurrencyCode,
} = require('../helpers');

const STRIPE_API_VERSION = process.env.STRIPE_API_VERSION || '2026-02-25.clover';

const secureCompare = (left, right) => {
    const leftBuffer = Buffer.from(String(left || ''), 'utf8');
    const rightBuffer = Buffer.from(String(right || ''), 'utf8');
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const normalizeStripeStatus = (status = '') => {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'requires_capture') return 'authorized';
    if (normalized === 'succeeded') return 'captured';
    return normalized;
};

const getExpandedObject = (value) => (value && typeof value === 'object' ? value : null);

const stringifyMetadata = (metadata = {}) => Object.fromEntries(
    Object.entries(metadata || {}).map(([key, value]) => [key, String(value || '')])
);

const summarizeSavedMethod = (savedMethod = null) => {
    if (!savedMethod) return null;
    return {
        id: String(savedMethod._id || ''),
        provider: String(savedMethod.provider || 'stripe'),
        type: String(savedMethod.type || ''),
        brand: String(savedMethod.brand || ''),
        last4: String(savedMethod.last4 || ''),
        isDefault: Boolean(savedMethod.isDefault),
    };
};

class StripeProvider {
    constructor({
        secretKey,
        publishableKey,
        webhookSecret,
        stripeClient = null,
    }) {
        this.name = 'stripe';
        this.secretKey = secretKey;
        this.publishableKey = publishableKey;
        this.webhookSecret = webhookSecret;
        this.baseUrl = 'https://api.stripe.com/v1';
        this.client = stripeClient || new Stripe(secretKey, {
            apiVersion: STRIPE_API_VERSION,
        });
    }

    getConfirmationSignature({ orderId, paymentId }) {
        if (!orderId || !paymentId) return '';
        return crypto
            .createHmac('sha256', this.secretKey)
            .update(`${orderId}|${paymentId}`)
            .digest('hex');
    }

    verifySignature({ orderId, paymentId, signature }) {
        const expected = this.getConfirmationSignature({ orderId, paymentId });
        if (!expected || !signature) return false;
        return secureCompare(expected, signature);
    }

    verifyWebhookSignature({ rawBody, signature }) {
        if (!rawBody || !signature || !this.webhookSecret) return false;
        try {
            this.client.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
            return true;
        } catch {
            return false;
        }
    }

    parseWebhook(rawBody) {
        const event = typeof rawBody === 'string'
            ? JSON.parse(rawBody || '{}')
            : JSON.parse(Buffer.from(rawBody || '').toString('utf8') || '{}');
        const object = event?.data?.object || {};
        const paymentIntentId = object.object === 'payment_intent'
            ? object.id
            : object.payment_intent || '';
        const paymentStatus = normalizeStripeStatus(object.status);
        const eventType = event.type === 'payment_intent.amount_capturable_updated'
            ? 'payment.authorized'
            : event.type === 'payment_intent.succeeded'
                ? 'payment.captured'
                : event.type === 'payment_intent.payment_failed'
                    ? 'payment.failed'
                    : event.type === 'charge.refunded'
                        ? 'refund.processed'
                        : event.type || 'unknown';

        return {
            id: event.id,
            event: eventType,
            payload: {
                provider: 'stripe',
                stripe: event,
                payment: {
                    entity: {
                        ...object,
                        id: paymentIntentId,
                        order_id: paymentIntentId,
                        status: paymentStatus,
                    },
                },
                refund: eventType === 'refund.processed'
                    ? {
                        entity: {
                            id: object.refunds?.data?.[0]?.id || object.id || '',
                            payment_id: paymentIntentId,
                            amount: object.amount_refunded || 0,
                        },
                    }
                    : undefined,
            },
        };
    }

    async createOrder({
        amount,
        currency = 'INR',
        receipt,
        notes = {},
        paymentMethod,
        savedMethod = null,
    }) {
        if (String(paymentMethod || '').trim().toUpperCase() !== 'CARD') {
            throw new AppError('Stripe provider currently supports card checkout only', 409);
        }

        const savedProviderMethodId = String(savedMethod?.providerMethodId || '').trim();
        const payload = {
            amount: toMinorUnits(amount, currency),
            currency: normalizeCurrencyCode(currency).toLowerCase(),
            capture_method: 'manual',
            payment_method_types: ['card'],
            metadata: {
                ...stringifyMetadata(notes),
                receipt: String(receipt || ''),
            },
        };

        if (savedProviderMethodId) {
            payload.payment_method = savedProviderMethodId;
            payload.confirm = true;
            payload.use_stripe_sdk = true;
            payload.metadata.savedPaymentMethodId = String(savedMethod?._id || '');
        }

        return this.client.paymentIntents.create(payload);
    }

    async createSetupIntent({
        user = {},
        metadata = {},
    } = {}) {
        return this.client.setupIntents.create({
            usage: 'off_session',
            payment_method_types: ['card'],
            metadata: {
                ...stringifyMetadata(metadata),
                userId: String(user?._id || metadata?.userId || ''),
                userEmail: String(user?.email || metadata?.userEmail || ''),
                setupSource: String(metadata?.setupSource || 'profile'),
            },
        });
    }

    async fetchSetupIntent(setupIntentId) {
        return this.client.setupIntents.retrieve(setupIntentId, {
            expand: ['payment_method'],
        });
    }

    async fetchSupportedMethods() {
        return {
            card: {
                enabled: true,
                networks: {
                    visa: true,
                    mastercard: true,
                    amex: true,
                    discover: true,
                },
                types: {
                    credit: true,
                    debit: true,
                    prepaid: true,
                },
            },
        };
    }

    buildCheckoutPayload({
        providerOrder,
        providerOrderId,
        amount,
        currency,
        savedMethod = null,
    }) {
        if (!this.publishableKey) {
            throw new AppError('Stripe publishable key is not configured on the server', 503);
        }
        const paymentIntentId = providerOrder?.id || providerOrderId;
        const savedPaymentMethod = summarizeSavedMethod(savedMethod);
        return {
            provider: 'stripe',
            publishableKey: this.publishableKey,
            paymentIntentId,
            clientSecret: providerOrder?.client_secret || '',
            confirmationSignature: this.getConfirmationSignature({
                orderId: paymentIntentId,
                paymentId: paymentIntentId,
            }),
            amount,
            currency,
            status: providerOrder?.status || '',
            requiresAction: providerOrder?.status === 'requires_action',
            savedPaymentMethodId: savedPaymentMethod?.id || '',
            savedPaymentMethod,
        };
    }

    async fetchPayment(paymentId) {
        const paymentIntent = await this.client.paymentIntents.retrieve(paymentId, {
            expand: ['payment_method', 'latest_charge'],
        });
        return {
            ...paymentIntent,
            status: normalizeStripeStatus(paymentIntent.status),
        };
    }

    async capture({ paymentId, amount, currency = 'INR' }) {
        return this.client.paymentIntents.capture(paymentId, {
            amount_to_capture: toMinorUnits(amount, currency),
        });
    }

    async refund({ paymentId, amount, currency = 'INR', notes = {} }) {
        return this.client.refunds.create({
            payment_intent: paymentId,
            amount: toMinorUnits(amount, currency),
            metadata: stringifyMetadata(notes),
        });
    }

    parsePaymentMethod(payment = {}) {
        const paymentMethod = getExpandedObject(payment.payment_method);
        const latestCharge = getExpandedObject(payment.latest_charge);
        const card = paymentMethod?.card || latestCharge?.payment_method_details?.card || {};
        if (card && Object.keys(card).length > 0) {
            return {
                type: 'card',
                brand: String(card.network || card.brand || 'Card'),
                last4: String(card.last4 || ''),
                providerMethodId: String(paymentMethod?.id || payment.payment_method || payment.id || ''),
            };
        }
        return {
            type: 'card',
            brand: 'Card',
            last4: '',
            providerMethodId: String(payment.payment_method || payment.id || ''),
        };
    }

    parseSetupPaymentMethod(setupIntent = {}) {
        const paymentMethod = getExpandedObject(setupIntent.payment_method);
        if (!paymentMethod) {
            return {
                type: 'card',
                brand: 'Card',
                last4: '',
                providerMethodId: String(setupIntent.payment_method || ''),
            };
        }
        return this.parsePaymentMethod({
            id: setupIntent.id,
            payment_method: paymentMethod,
        });
    }

    parsePaymentAmounts(payment = {}) {
        const currency = normalizeCurrencyCode(payment.currency || 'INR');
        const amountMinor = Number(payment.amount || 0);
        const amountReceivedMinor = Number(payment.amount_received || amountMinor || 0);
        return {
            amount: fromMinorUnits(amountReceivedMinor || amountMinor, currency),
            amountMinor: amountReceivedMinor || amountMinor,
            currency,
            amountRefunded: 0,
            amountRefundedMinor: 0,
            baseAmount: null,
            baseAmountMinor: null,
            baseCurrency: '',
            international: false,
        };
    }

    normalizeAmount(amountMinor, currency = 'INR') {
        return fromMinorUnits(amountMinor, currency);
    }
}

module.exports = StripeProvider;
