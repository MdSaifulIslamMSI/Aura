const User = require('../models/User');
const PaymentIntent = require('../models/PaymentIntent');
const { saveUserPaymentMethod } = require('../services/payments/paymentService');
const { PAYMENT_STATUSES } = require('../services/payments/constants');

const makeUser = async (overrides = {}) => User.create({
    name: 'Pay User',
    email: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
    isVerified: true,
    ...overrides,
});

const makeBoundIntent = async ({ userId, providerMethodId = 'user@upi' }) => PaymentIntent.create({
    intentId: `pi_${Math.random().toString(36).slice(2, 12)}`,
    user: userId,
    provider: 'simulated',
    providerOrderId: `sim_order_${Math.random().toString(36).slice(2, 10)}`,
    providerPaymentId: `sim_pay_${Math.random().toString(36).slice(2, 10)}`,
    amount: 1999,
    currency: 'INR',
    method: 'UPI',
    status: PAYMENT_STATUSES.AUTHORIZED,
    authorizedAt: new Date(),
    expiresAt: new Date(Date.now() + 20 * 60 * 1000),
    metadata: {
        providerMethodSnapshot: {
            type: 'upi',
            brand: 'UPI',
            last4: '',
            providerMethodId,
        },
    },
});

describe('Payment method enrollment security', () => {
    test('blocks token stuffing when user tries to enroll another user provider method id', async () => {
        const userA = await makeUser();
        const userB = await makeUser();
        await makeBoundIntent({ userId: userB._id, providerMethodId: 'user-b@upi' });

        await expect(saveUserPaymentMethod({
            userId: userA._id,
            method: {
                providerMethodId: 'user-b@upi',
                metadata: { enrollmentSource: 'settings' },
            },
        })).rejects.toMatchObject({
            statusCode: 403,
            message: expect.stringMatching(/ownership/i),
        });
    });

    test('requires explicit paymentIntent binding to belong to current user', async () => {
        const userA = await makeUser();
        const userB = await makeUser();
        const userBIntent = await makeBoundIntent({ userId: userB._id, providerMethodId: 'user-b@upi' });

        await expect(saveUserPaymentMethod({
            userId: userA._id,
            paymentIntentId: userBIntent.intentId,
            method: {
                providerMethodId: 'user-b@upi',
                metadata: { enrollmentSource: 'checkout' },
            },
        })).rejects.toMatchObject({
            statusCode: 403,
            message: expect.stringMatching(/ownership/i),
        });
    });
});
