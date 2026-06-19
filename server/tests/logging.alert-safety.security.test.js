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

    test('pseudonymizes raw user identifiers while preserving stable correlation', () => {
        const rawUserId = 'firebase-user-sensitive-123';
        const redacted = logger.redactSensitiveData({
            userId: rawUserId,
            uid: rawUserId,
            firebaseUid: rawUserId,
            authUid: rawUserId,
            actorId: rawUserId,
            resourceId: rawUserId,
        });

        expect(redacted.userId).toMatch(/^[a-f0-9]{16}$/);
        expect(redacted.uid).toBe(redacted.userId);
        expect(redacted.firebaseUid).toBe(redacted.userId);
        expect(redacted.authUid).toBe(redacted.userId);
        expect(redacted.actorId).toBe(redacted.userId);
        expect(redacted.resourceId).toBe(redacted.userId);
        expect(JSON.stringify(redacted)).not.toContain(rawUserId);
    });

    test('redacts sensitive object-valued metadata before nested traversal', () => {
        const sensitiveObject = {
            uid: 'oidc-subject-sensitive',
            email: 'oidc.user@example.test',
            password: fixture('nested-', 'password-', 'secret'),
            nested: {
                accessToken: 'raw-jwt-secret-fixture',
            },
        };
        const redacted = logger.redactSensitiveData({
            authToken: sensitiveObject,
            credentials: sensitiveObject,
            safe: {
                email: 'safe.user@example.test',
            },
        });
        const serialized = JSON.stringify(redacted);

        expect(redacted.authToken).toBe(logger.REDACTED_PLACEHOLDER);
        expect(redacted.credentials).toBe(logger.REDACTED_PLACEHOLDER);
        expect(redacted.safe.email).toMatch(/sa\*\*\*@example\.test$/);
        expect(serialized).not.toContain('oidc-subject-sensitive');
        expect(serialized).not.toContain('oidc.user@example.test');
        expect(serialized).not.toContain('raw-jwt-secret-fixture');
        expect(serialized).not.toContain(fixture('nested-', 'password-', 'secret'));
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

    test('structured logger strips sensitive query values from request locations and errors', () => {
        const rawEmail = 'recovery.user@example.test';
        const rawPhone = '+919876543210';
        const requestUrl = `/api/otp/challenge?email=${encodeURIComponent(rawEmail)}&phone=${encodeURIComponent(rawPhone)}`;
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const redacted = logger.redactSensitiveData({
            url: requestUrl,
            path: requestUrl,
            clientRoute: `/login?email=${encodeURIComponent(rawEmail)}`,
            error: new Error(`Not Found - ${requestUrl}`),
        });
        const serialized = JSON.stringify(redacted);
        logger.error(`Not Found - ${requestUrl}`, redacted);
        const output = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
        errorSpy.mockRestore();

        expect(redacted.url).toBe(`/api/otp/challenge?${logger.REDACTED_PLACEHOLDER}`);
        expect(redacted.path).toBe(`/api/otp/challenge?${logger.REDACTED_PLACEHOLDER}`);
        expect(redacted.clientRoute).toBe(`/login?${logger.REDACTED_PLACEHOLDER}`);
        expect(redacted.error.message).toBe(`Not Found - /api/otp/challenge?${logger.REDACTED_PLACEHOLDER}`);
        for (const loggedValue of [serialized, output]) {
            expect(loggedValue).not.toContain(rawEmail);
            expect(loggedValue).not.toContain(encodeURIComponent(rawEmail));
            expect(loggedValue).not.toContain(rawPhone);
            expect(loggedValue).not.toContain(encodeURIComponent(rawPhone));
        }
    });
});
