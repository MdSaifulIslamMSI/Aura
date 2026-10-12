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
        const rawBearer = fixture('Bearer ', 'eyJhbGci.raw.fixture');
        const rawWebhookSecret = fixture('whsec_', 'rawwebhookfixture');
        const requestUrl = `/api/otp/challenge?email=${encodeURIComponent(rawEmail)}&phone=${encodeURIComponent(rawPhone)}`;
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const redacted = logger.redactSensitiveData({
            url: requestUrl,
            path: requestUrl,
            clientRoute: `/login?email=${encodeURIComponent(rawEmail)}`,
            error: new Error(`Not Found - ${requestUrl} ${rawBearer} ${rawWebhookSecret}`),
            note: `provider replied with ${rawBearer}`,
        });
        const serialized = JSON.stringify(redacted);
        logger.error(`Not Found - ${requestUrl} ${rawBearer}`, redacted);
        const output = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
        errorSpy.mockRestore();

        expect(redacted.url).toBe(`/api/otp/challenge?${logger.REDACTED_PLACEHOLDER}`);
        expect(redacted.path).toBe(`/api/otp/challenge?${logger.REDACTED_PLACEHOLDER}`);
        expect(redacted.clientRoute).toBe(`/login?${logger.REDACTED_PLACEHOLDER}`);
        expect(redacted.error.message).toBe(`Not Found - /api/otp/challenge?${logger.REDACTED_PLACEHOLDER} ${logger.REDACTED_PLACEHOLDER} ${logger.REDACTED_PLACEHOLDER}`);
        for (const loggedValue of [serialized, output]) {
            expect(loggedValue).not.toContain(rawEmail);
            expect(loggedValue).not.toContain(encodeURIComponent(rawEmail));
            expect(loggedValue).not.toContain(rawPhone);
            expect(loggedValue).not.toContain(encodeURIComponent(rawPhone));
            expect(loggedValue).not.toContain(rawBearer);
            expect(loggedValue).not.toContain(rawWebhookSecret);
        }
    });
});

describe('logger PII coverage (addresses, names, IPs, free-text identifiers)', () => {
    const piiMeta = () => ({
        address: '221B Baker Street, London',
        fullName: 'John Q Public',
        recipientName: 'Jane Doe',
        city: 'Bengaluru',
        pincode: '560001',
        postalCode: '560001',
        state: 'Karnataka',
        country: 'IN',
        ip: '203.0.113.45',
        clientIp: '203.0.113.45',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        mobile: '+919876543210',
        dob: '1990-01-15',
        nested: {
            shippingAddress: { street: '12 MG Road', zip: '560001' },
        },
    });

    const rawPii = [
        '221B Baker Street',
        'John Q Public',
        'Jane Doe',
        'Bengaluru',
        '560001',
        '203.0.113.45',
        'Mozilla/5.0',
        '+919876543210',
        '1990-01-15',
        '12 MG Road',
    ];

    test('redacts PII-bearing keys at every nesting level', () => {
        const redacted = logger.redactSensitiveData(piiMeta());
        const serialized = JSON.stringify(redacted);

        expect(redacted.address).toBe(logger.REDACTED_PLACEHOLDER);
        expect(redacted.fullName).toBe(logger.REDACTED_PLACEHOLDER);
        expect(redacted.city).toBe(logger.REDACTED_PLACEHOLDER);
        expect(redacted.ip).toBe(logger.REDACTED_PLACEHOLDER);
        expect(redacted.clientIp).toBe(logger.REDACTED_PLACEHOLDER);
        expect(redacted.userAgent).toBe(logger.REDACTED_PLACEHOLDER);
        expect(redacted.mobile).toBe(logger.REDACTED_PLACEHOLDER);
        // A parent key that contains a PII family ('shippingAddress' contains
        // 'address') redacts the whole subtree, matching the existing
        // authToken/credentials behavior.
        expect(redacted.nested.shippingAddress).toBe(logger.REDACTED_PLACEHOLDER);

        for (const raw of rawPii) {
            expect(serialized).not.toContain(raw);
        }
    });

    test('redacts emails, phone numbers and card numbers embedded in free text', () => {
        const redacted = logger.redactSensitiveData({
            note: 'checkout failed for user@example.test with card 4111 1111 1111 1111',
            phone: 'call +919876543210 before retry',
        });
        const serialized = JSON.stringify(redacted);

        expect(serialized).not.toContain('user@example.test');
        expect(serialized).not.toContain('4111 1111 1111 1111');
        expect(serialized).not.toContain('+919876543210');
        expect(redacted.note).toContain(logger.REDACTED_PLACEHOLDER);
    });

    test('redacts arrays of PII values passed without a wrapping key', () => {
        const redacted = logger.redactSensitiveData(['user@example.test', '+919876543210']);
        const serialized = JSON.stringify(redacted);

        expect(serialized).not.toContain('user@example.test');
        expect(serialized).not.toContain('+919876543210');
    });

    test('preserves email and phone masking for keyed values', () => {
        const redacted = logger.redactSensitiveData({
            email: 'alice@example.test',
            phone: '+919876543210',
        });

        expect(redacted.email).toMatch(/al\*\*\*@example\.test$/);
        expect(redacted.phone).toBe('***3210');
    });

    test('structured logger output excludes PII meta and message content', () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        // Message-level redaction covers embedded identifiers (emails, phones,
        // cards); addresses are defended by key-based redaction of meta.
        logger.error('address validation failed for user@example.test with phone +919876543210', piiMeta());
        const output = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
        errorSpy.mockRestore();

        for (const raw of [...rawPii.filter((raw) => raw !== '221B Baker Street' && raw !== '12 MG Road'), 'user@example.test', '+919876543210']) {
            expect(output).not.toContain(raw);
        }
        expect(output).toContain(logger.REDACTED_PLACEHOLDER);
    });

    test('does not redact benign keys that merely contain PII-like substrings', () => {
        const redacted = logger.redactSensitiveData({
            productName: 'Aura Wireless Mouse',
            description: 'Ergonomic mouse with 3 buttons',
            orderCount: 7,
            category: 'Electronics',
        });

        expect(redacted.productName).toBe('Aura Wireless Mouse');
        expect(redacted.description).toBe('Ergonomic mouse with 3 buttons');
        expect(redacted.orderCount).toBe(7);
        expect(redacted.category).toBe('Electronics');
    });
});
