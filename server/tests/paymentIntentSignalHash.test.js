jest.setTimeout(30000);

const mongoose = require('mongoose');
const PaymentIntent = require('../models/PaymentIntent');
const { evaluateRisk } = require('../services/payments/riskEngine');
const { hashSignalValue } = require('../utils/signalHash');

// PaymentIntent used to persist the raw client IP/user agent in metadata and
// risk lookups compared them by plaintext equality. The money collection now
// stores only the truncated hashes (same representation as
// FraudDecision.requestMeta) and every lookup goes through hash equality.
describe('payment intent request-signal hashing', () => {
    test('hashSignalValue is deterministic, truncated to 24 chars, and empty-safe', () => {
        expect(hashSignalValue('203.0.113.7')).toBe(hashSignalValue('203.0.113.7'));
        expect(hashSignalValue('203.0.113.7')).toMatch(/^[0-9a-f]{24}$/);
        expect(hashSignalValue('')).toBe('');
        expect(hashSignalValue(undefined)).toBe('');
    });

    test('evaluateRisk counts 1h ip attempts through metadata.ipHash', async () => {
        const ip = '203.0.113.7';
        const user = new mongoose.Types.ObjectId();
        await PaymentIntent.create(Array.from({ length: 20 }, (_, i) => ({
            intentId: `pi_signal_hash_${i}`,
            user,
            providerOrderId: `order_signal_hash_${i}`,
            amount: 1000,
            method: 'CARD',
            status: 'created',
            metadata: { ipHash: hashSignalValue(ip) },
        })));

        const decision = await evaluateRisk({
            userId: String(user),
            amount: 100,
            deviceContext: { userAgent: 'vitest-agent', platform: 'web' },
            shippingAddress: { postalCode: '560001' },
            requestMeta: { ip },
        });

        expect(decision.factors).toContain('ip_velocity_1h');
    });

    test('plaintext-only intents (pre-cutover rows) no longer match the ip lookup', async () => {
        const ip = '198.51.100.9';
        const user = new mongoose.Types.ObjectId();
        await PaymentIntent.create({
            intentId: 'pi_signal_hash_plaintext',
            user,
            providerOrderId: 'order_signal_hash_plaintext',
            amount: 1000,
            method: 'CARD',
            status: 'created',
            metadata: { ip },
        });

        const decision = await evaluateRisk({
            userId: String(user),
            amount: 100,
            deviceContext: { userAgent: 'vitest-agent', platform: 'web' },
            shippingAddress: { postalCode: '560001' },
            requestMeta: { ip },
        });

        expect(decision.factors).not.toContain('ip_velocity_1h');
    });
});
