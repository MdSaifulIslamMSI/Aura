const Product = require('../models/Product');
const logger = require('../utils/logger');
const { buildAuthSecurityEventEnvelope } = require('../services/authSecurityEventOutboxService');
const {
    createFakeProduct,
    expectDocumentUnchanged,
} = require('./helpers/securityTestHelpers');

const fixture = (...parts) => parts.join('');

const secretMeta = () => ({
    email: 'alice.sensitive@example.test',
    phone: '+919999999999',
    password: fixture('fixture-', 'password-', 'value'),
    otp: fixture('654', '321'),
    accessToken: 'fake-access-token-redaction-fixture',
    refreshToken: 'refresh-token-raw-value',
    rawJwt: fixture('jwt-', 'redaction-', 'fixture'),
    apiKey: 'fake-api-key-redaction-fixture',
    paymentSecret: fixture('payment-', 'secret-', 'fixture'),
    cardNumber: fixture('4111', '1111', '1111', '1111'),
    nested: {
        authorization: fixture('Bearer ', 'raw-auth-token'),
        smtpPass: 'raw-smtp-password',
    },
});

const rawSecrets = [
    'alice.sensitive@example.test',
    '+919999999999',
    fixture('fixture-', 'password-', 'value'),
    fixture('654', '321'),
    'refresh-token-raw-value',
    fixture('jwt-', 'redaction-', 'fixture'),
    'fake-api-key-redaction-fixture',
    fixture('payment-', 'secret-', 'fixture'),
    fixture('4111', '1111', '1111', '1111'),
    fixture('Bearer ', 'raw-auth-token'),
    'raw-smtp-password',
];

describe('logging and alert safety', () => {
    test('preserves hexadecimal correlation hashes without trusting raw values in hash fields', () => {
        const digest = 'a'.repeat(16);
        const redacted = logger.redactSensitiveData({
            emailHash: digest,
            phoneHash: digest,
            flowTokenHash: digest,
            unsafeEmailHash: 'alice.sensitive@example.test',
        });

        expect(redacted.emailHash).toBe(digest);
        expect(redacted.phoneHash).toBe(digest);
        expect(redacted.flowTokenHash).toBe(digest);
        expect(redacted.unsafeEmailHash).not.toContain('alice.sensitive@example.test');
    });

    test('auth security outbox envelopes redact sensitive meta before persistence', async () => {
        const product = await createFakeProduct({ title: 'Logging Redaction Guard Product' });
        const beforeProduct = await Product.findById(product._id).lean();

        const envelope = buildAuthSecurityEventEnvelope({
            event: 'login_failure',
            outcome: 'blocked',
            reason: 'bad_password',
            meta: secretMeta(),
        });
        const serialized = JSON.stringify(envelope);

        for (const raw of rawSecrets) {
            expect(serialized).not.toContain(raw);
        }
        expect(envelope.meta.password).toBe(logger.REDACTED_PLACEHOLDER);
        expect(envelope.meta.otp).toBe(logger.REDACTED_PLACEHOLDER);
        expect(envelope.meta.accessToken).toBe(logger.REDACTED_PLACEHOLDER);
        expect(envelope.meta.apiKey).toBe(logger.REDACTED_PLACEHOLDER);
        expect(envelope.meta.email).toMatch(/\*\*\*@example\.test$/);

        await expectDocumentUnchanged(Product, product._id, beforeProduct);
    });

    test('structured logger output excludes passwords, OTPs, raw tokens, API keys, and payment secrets', async () => {
        const product = await createFakeProduct({ title: 'Logger Output Guard Product' });
        const beforeProduct = await Product.findById(product._id).lean();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        logger.warn('security.redaction_test', secretMeta());
        const output = warnSpy.mock.calls.map((call) => call.join(' ')).join('\n');

        for (const raw of rawSecrets) {
            expect(output).not.toContain(raw);
        }
        expect(output).toContain(logger.REDACTED_PLACEHOLDER);

        warnSpy.mockRestore();
        await expectDocumentUnchanged(Product, product._id, beforeProduct);
    });
});
