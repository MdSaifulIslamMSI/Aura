const crypto = require('crypto');
const RazorpayProvider = require('../services/payments/providers/razorpayProvider');

const mutateHex = (signature) => {
    if (!signature) return '0';
    const nextChar = signature.endsWith('a') ? 'b' : 'a';
    return `${signature.slice(0, -1)}${nextChar}`;
};

describe('RazorpayProvider signature verification security', () => {
    const provider = new RazorpayProvider({
        keyId: 'rzp_test_key',
        keySecret: 'top-secret-key',
        webhookSecret: 'webhook-secret',
    });

    test('verifies payment signatures with constant-time compare', () => {
        const orderId = 'order_123';
        const paymentId = 'pay_456';
        const validSignature = crypto
            .createHmac('sha256', 'top-secret-key')
            .update(`${orderId}|${paymentId}`)
            .digest('hex');

        expect(provider.verifySignature({ orderId, paymentId, signature: validSignature })).toBe(true);
        expect(provider.verifySignature({ orderId, paymentId, signature: mutateHex(validSignature) })).toBe(false);
        expect(provider.verifySignature({ orderId, paymentId, signature: 'short' })).toBe(false);
    });

    test('verifies webhook signatures with constant-time compare', () => {
        const rawBody = JSON.stringify({ event: 'payment.captured', payload: { id: 'evt_1' } });
        const validSignature = crypto
            .createHmac('sha256', 'webhook-secret')
            .update(rawBody)
            .digest('hex');

        expect(provider.verifyWebhookSignature({ rawBody, signature: validSignature })).toBe(true);
        expect(provider.verifyWebhookSignature({ rawBody, signature: mutateHex(validSignature) })).toBe(false);
        expect(provider.verifyWebhookSignature({ rawBody, signature: 'short' })).toBe(false);
    });

    test('maps netbanking payloads to the shared bank method shape', () => {
        expect(provider.parsePaymentMethod({
            method: 'netbanking',
            bank: 'HDFC',
            acquirer_data: {
                bank_transaction_id: 'nbk_hdfc_123',
            },
        })).toEqual({
            type: 'bank',
            brand: 'HDFC',
            last4: '',
            providerMethodId: 'HDFC',
            bankCode: 'HDFC',
            bankName: 'HDFC',
        });
    });
});
